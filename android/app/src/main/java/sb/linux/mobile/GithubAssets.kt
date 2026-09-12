package sb.linux.mobile

import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayInputStream
import java.util.concurrent.TimeUnit

/**
 * GitHub 页面的 CSS/JS/字体在 github.githubassets.com（Fastly），国内常连不上。
 * 内置 WebView 拦截这些请求：先试原 URL（VPN / 海外出口通常直接通），再回落到
 * gh-proxy。URL 对外仍是原域名，不破坏 CSP。
 */
object GithubAssets {
  private val proxies = listOf("https://gh-proxy.com/", "https://ghfast.top/")

  private val proxyClient: OkHttpClient by lazy { buildClient(8, 20) }
  private val directClient: OkHttpClient by lazy { buildClient(2, 6) }

  private fun buildClient(connectSec: Long, readSec: Long): OkHttpClient {
    return try {
      OkHttpClientProvider.getOkHttpClient().newBuilder()
        .connectTimeout(connectSec, TimeUnit.SECONDS)
        .readTimeout(readSec, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    } catch (_: Exception) {
      OkHttpClient.Builder()
        .connectTimeout(connectSec, TimeUnit.SECONDS)
        .readTimeout(readSec, TimeUnit.SECONDS)
        .dns(DohDns.instance)
        .build()
    }
  }

  @JvmStatic
  fun intercept(request: WebResourceRequest?): WebResourceResponse? {
    if (request == null) return null
    val method = request.method.orEmpty().uppercase()
    if (method != "GET" && method != "HEAD") return null
    val url = request.url?.toString().orEmpty()
    if (!isStatic(url)) return null
    if (hasHeader(request, "Range")) return null
    fetch(directClient, url, request)?.let { return it }
    for (prefix in proxies) {
      fetch(proxyClient, prefix + url, request)?.let { return it }
    }
    return null
  }

  private fun isStatic(url: String): Boolean {
    val host = try {
      Uri.parse(url).host?.lowercase()
    } catch (_: Exception) {
      null
    } ?: return false
    return host == "github.githubassets.com"
      || host.endsWith(".githubassets.com")
      || host == "avatars.githubusercontent.com"
      || host == "camo.githubusercontent.com"
      || host == "media.githubusercontent.com"
      || host == "user-images.githubusercontent.com"
      || host == "opengraph.githubassets.com"
      || host == "repository-images.githubusercontent.com"
      || host == "identicons.github.com"
  }

  private fun fetch(http: OkHttpClient, url: String, request: WebResourceRequest): WebResourceResponse? {
    return try {
      val builder = Request.Builder().url(url)
      request.requestHeaders?.forEach { (key, value) ->
        if (key.isNullOrBlank() || value.isNullOrBlank()) return@forEach
        if (key.equals("Host", true) || key.equals("Cookie", true)) return@forEach
        builder.header(key, value)
      }
      http.newCall(builder.build()).execute().use { response ->
        if (!response.isSuccessful) return null
        val body = response.body ?: return null
        val contentType = response.header("Content-Type").orEmpty()
        val mime = mimeOf(url, contentType)
        val charset = charsetOf(contentType, mime)
        val bytes = body.bytes()
        if (bytes.isEmpty()) return null
        val result = WebResourceResponse(mime, charset, ByteArrayInputStream(bytes))
        val headers = HashMap<String, String>()
        headers["Access-Control-Allow-Origin"] = "*"
        response.header("Cache-Control")?.let { headers["Cache-Control"] = it }
        result.responseHeaders = headers
        result
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun hasHeader(request: WebResourceRequest, name: String): Boolean {
    return request.requestHeaders?.keys?.any { it.equals(name, true) } == true
  }

  private fun mimeOf(url: String, contentType: String): String {
    val fromHeader = contentType.substringBefore(";").trim().lowercase()
    if (fromHeader.isNotBlank() && fromHeader != "text/plain" && fromHeader != "application/octet-stream") {
      return fromHeader
    }
    val path = try {
      Uri.parse(url).path.orEmpty().lowercase()
    } catch (_: Exception) {
      ""
    }
    return when {
      path.endsWith(".css") -> "text/css"
      path.endsWith(".js") || path.endsWith(".mjs") -> "application/javascript"
      path.endsWith(".woff2") -> "font/woff2"
      path.endsWith(".woff") -> "font/woff"
      path.endsWith(".ttf") -> "font/ttf"
      path.endsWith(".png") -> "image/png"
      path.endsWith(".svg") -> "image/svg+xml"
      path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
      path.endsWith(".gif") -> "image/gif"
      path.endsWith(".webp") -> "image/webp"
      path.endsWith(".ico") -> "image/x-icon"
      path.endsWith(".json") -> "application/json"
      fromHeader.isNotBlank() -> fromHeader
      else -> "application/octet-stream"
    }
  }

  private fun charsetOf(contentType: String, mime: String): String? {
    val match = Regex("charset=([^;\\s]+)", RegexOption.IGNORE_CASE).find(contentType)
    if (match != null) return match.groupValues[1]
    return if (mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg")) {
      "utf-8"
    } else {
      null
    }
  }
}
