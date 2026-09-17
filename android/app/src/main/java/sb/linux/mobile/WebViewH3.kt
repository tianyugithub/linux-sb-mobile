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
 *   • 非 GET —— 拦截拿不到请求体，POST 交回代理；
 *   • Range / Upgrade —— 断点续传与 WebSocket 不适合整段缓冲；
 *   • `/cdn-cgi/` —— 挑战脚本自己的一次性 XHR/POST 必须由 WebView 直连 CF。
 *
 * 注意：**过盾页面文档本身是要接管的**（历史上曾经不接管，见 `intercept` 里的说明）。
 * 国内 TCP 被 SNI 阻断时，不接管 = 挑战页加载不出来 = 过盾必然超时。
 *
 * 注意：拦截返回的响应**不会**自动写进 WebView 的 cookie jar，所以 Set-Cookie 要手动补，
 * 否则站内登录态在内置浏览器里会失效。
 */
object WebViewH3 {
  private const val TAG = "LinuxH3"

  @JvmStatic
  fun intercept(request: WebResourceRequest): WebResourceResponse? {
    if (!H3.isEnabled()) return null
    /*
     * 过盾期间**照旧接管**。
     *
     * 早先这里写了「过盾中的请求不接管，CF 必须走 WebView 自己的 TLS」。那条假设只在
     * “WebView 原生 TLS 能通”的网络下成立；实测（2026-09，国内家宽）linux.sb 的 TCP
     * 被 SNI 阻断，原生 TLS 直接 ERR_CONNECTION_CLOSED —— 挑战页根本加载不出来，
     * 于是过盾 65 秒必然超时（用户看到的是一张「网页无法打开」）。
     *
     * 现在改成：过盾也走同一条 H3/QUIC 链路。实测真浏览器在同一条网络下跑完挑战脚本
     * 约 5 秒自动放行（3/3），所以只要挑战页能加载，过盾就能过。
     * 代价是挑战期的页面字节经我们的链路取回再交给 WebView 渲染 —— 挑战脚本本身仍由
     * WebView 正常执行，`cf_clearance` 也照常落到 CookieManager。
     */
    if (CfChallenge.pauseH3Intercept) return null
    val url = request.url ?: return null
    if (!"https".equals(url.scheme, ignoreCase = true)) return null
    val host = url.host?.lowercase() ?: return null
    if (host != "linux.sb" && !host.endsWith(".linux.sb")) return null
    val path = url.path ?: ""
    /*
     * `/cdn-cgi/` 仍然不接管。
     *
     * 挑战脚本自己的 XHR/POST 必须由 WebView 直连 —— 它们带的是 CF 种在浏览器里的
     * 一次性令牌，绕一层会破坏 `cf_clearance` 的签发。页面文档本身（上面的 GET）
     * 走我们的链路把挑战载进来，脚本再自己直连回 CF 完成校验。
     */
    if (path.startsWith("/cdn-cgi/")) return null
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
