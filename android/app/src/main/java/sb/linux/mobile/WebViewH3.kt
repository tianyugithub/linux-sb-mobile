package sb.linux.mobile

import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import okhttp3.Request
import java.io.ByteArrayInputStream

/**
 * 内置浏览器（WebView）的 HTTP/3 接管点。
 *
 * WebView 自己的网络栈只会走 TCP，而国内对 linux.sb 的封锁就在 TCP 的 SNI 上（TLS 一发就被重置），
 * 所以站内页面在封锁网络下打不开。这里由 `RNCWebViewClient.shouldInterceptRequest`（见
 * scripts/patch-rn-webview.mjs 注入的钩子）把站内请求交过来，用 App 的 H3 层取回，再还给 WebView 渲染。
 *
 * 不接管的几种情况，一律返回 null 让它走原来的路（WebDnsProxy + TLS 分片）：
 *   • 镜像通道 —— 那条路本来就是走镜像域名，不需要也不应该绕过去；
 *   • 非 GET —— 拦截拿不到请求体，POST 交回代理；
 *   • Range / Upgrade —— 断点续传与 WebSocket 不适合整段缓冲。
 *
 * 注意：拦截返回的响应**不会**自动写进 WebView 的 cookie jar，所以 Set-Cookie 要手动补，
 * 否则站内登录态在内置浏览器里会失效。
 */
object WebViewH3 {
  private const val TAG = "LinuxH3"

  @JvmStatic
  fun intercept(request: WebResourceRequest): WebResourceResponse? {
    if (!H3.isEnabled()) return null
    // 与 H3.shouldUse 保持一致：DoH / 直连接管，镜像通道保持原样。
    if (LinuxAccess.usingMirror()) return null
    val url = request.url ?: return null
    if (!"https".equals(url.scheme, ignoreCase = true)) return null
    val host = url.host?.lowercase() ?: return null
    if (host != "linux.sb" && !host.endsWith(".linux.sb")) return null
    if (!"GET".equals(request.method, ignoreCase = true)) return null

    val incoming = request.requestHeaders ?: emptyMap()
    val keys = incoming.keys.map { it.lowercase() }
    if (keys.contains("range") || keys.contains("upgrade")) return null

    val target = url.toString()
    val builder = Request.Builder().url(target).get()
    incoming.forEach { (name, value) ->
      if (!name.startsWith(":")) builder.addHeader(name, value)
    }
    val response = try {
      H3.execute(builder.build()) { false }
    } catch (error: Exception) {
      Log.i(TAG, "WebView 回落：$target（${error.message}）")
      return null
    }

    val bytes = try {
      response.body?.bytes() ?: ByteArray(0)
    } catch (error: Exception) {
      Log.i(TAG, "WebView 读取响应失败：$target（${error.message}）")
      return null
    }
    response.close()

    // 拦截响应不会写 cookie jar，手动补上，否则登录态在内置浏览器里会丢。
    response.headers("Set-Cookie").forEach { cookie ->
      try {
        CookieManager.getInstance().setCookie(target, cookie)
      } catch (_: Exception) {
        /* ignore */
      }
    }

    val outgoing = HashMap<String, String>()
    for (index in 0 until response.headers.size) {
      val name = response.headers.name(index)
      if (name.startsWith(":")) continue
      outgoing[name] = response.headers.value(index)
    }
    // Cronet 可能已经把 gzip 解开了却留着 Content-Encoding —— 按实际字节判断，别让 WebView 再解一次。
    val gzipped = bytes.size > 2 && bytes[0] == 0x1f.toByte() && bytes[1] == 0x8b.toByte()
    if (!gzipped) outgoing.remove("Content-Encoding")
    outgoing.remove("Content-Length")
    outgoing.remove("Transfer-Encoding")

    val contentType = response.header("Content-Type") ?: "application/octet-stream"
    val mime = contentType.substringBefore(';').trim().ifBlank { "application/octet-stream" }
    val charset = Regex("charset=([^;\\s]+)", RegexOption.IGNORE_CASE)
      .find(contentType)?.groupValues?.get(1)?.trim('"')
    Log.i(TAG, "WebView QUIC 命中：$target ${response.code}")
    return WebResourceResponse(
      mime,
      charset,
      response.code,
      response.message.ifBlank { "OK" },
      outgoing,
      ByteArrayInputStream(bytes),
    )
  }
}
