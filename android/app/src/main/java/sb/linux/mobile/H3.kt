package sb.linux.mobile

import android.content.Context
import android.util.Log
import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.chromium.net.CronetEngine
import org.chromium.net.ExperimentalCronetEngine
import org.chromium.net.CronetException
import org.chromium.net.UploadDataProviders
import org.chromium.net.UrlRequest
import org.chromium.net.UrlResponseInfo
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * HTTP/3（QUIC）传输层：给 DoH / 直连通道加一条「TCP 被封时还能走」的路。
 *
 * 实测（2026-09，国内线路）：对 linux.sb 的封锁发生在 **TCP 的 SNI** 上 ——
 * TCP SYN 能通，TLS ClientHello 一发就被重置（连打 3 次全失败）；而**同一个 IP**
 * 走 UDP/443 的 QUIC，HTTP/3 直接 200 拿到真页面（`<title>LINUX SB …`）。
 * 所以这里是「先试 QUIC，失败再落回 TlsFrag 那条老路」，不是替换。
 *
 * 两个关键开关（缺一不可）：
 *   • `addQuicHint` —— 让**第一个**请求就走 QUIC。否则 Chromium 要先有一次 TCP 成功
 *     拿到 Alt-Svc 才敢用 H3，而 TCP 正好被封，会卡成死循环。
 *   • `HostResolverRules` —— 把 `DohDns` 已经探好的 Cloudflare 真 IP 钉进 Cronet，
 *     不依赖会被污染的系统 DNS。
 *
 * 镜像通道不用它：镜像域名（lsb.miapi.cc）的 SNI 本来就不在封锁名单里。
 */
object H3 {
  private const val TAG = "LinuxH3"
  private const val PREFS = "lsb_access"
  private const val KEY_ENABLED = "h3_first"
  private const val PREFS_STATUS = "lsb_h3"
  private const val KEY_STATUS = "last_transport"
  private const val CALL_TIMEOUT_MS = 40_000L
  private const val MAX_BODY = 24 * 1024 * 1024

  /** Cronet 不允许自己设的请求头，交给它自己算。 */
  private val RESERVED_HEADERS = setOf(
    "host", "connection", "content-length", "transfer-encoding",
    "accept-encoding", "upgrade", "keep-alive", "proxy-connection",
  )

  @Volatile private var appContext: Context? = null
  @Volatile private var enabled = true
  private val engines = HashMap<String, CronetEngine>()
  /** host → 当前钉住的地址，失败时拿去 DohDns 标记，下次换一个。 */
  private val pinnedHosts = HashMap<String, java.net.InetAddress>()
  private val executor = Executors.newFixedThreadPool(4) { runnable ->
    Thread(runnable, "LinuxH3-io").apply { isDaemon = true }
  }

  fun init(context: Context) {
    val ctx = context.applicationContext
    appContext = ctx
    enabled = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true)
    Log.i(TAG, "init: enabled=$enabled")
  }

  @JvmStatic
  fun setEnabled(value: Boolean) {
    enabled = value
    appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      ?.edit()?.putBoolean(KEY_ENABLED, value)?.apply()
    if (!value) dropEngines()
    Log.i(TAG, "setEnabled: $value")
  }

  fun isEnabled(): Boolean = enabled

  /** 给设置页看的：上一次请求实际走的传输。反射调用，必须是静态方法。 */
  @JvmStatic
  fun statusText(): String = appContext
    ?.getSharedPreferences(PREFS_STATUS, Context.MODE_PRIVATE)
    ?.getString(KEY_STATUS, "")
    .orEmpty()

  /**
   * DoH 与直连通道下、且是 linux.sb 系域名时才用 QUIC。
   *
   * 直连仍是「干净直连」：路由与域名一概不动（不改写、不经镜像），这里只多给一层传输，
   * 失败照旧回落到原来的 TLS 分片路径。镜像通道不接管 —— 它的 SNI 是镜像域名，本来就不被封。
   */
  fun shouldUse(url: okhttp3.HttpUrl): Boolean {
    if (!enabled) return false
    if (LinuxAccess.usingMirror()) return false
    val host = url.host.lowercase()
    return host == "linux.sb" || host.endsWith(".linux.sb")
  }

  fun execute(request: Request, cancelled: () -> Boolean): Response {
    val ctx = appContext ?: throw IOException("H3 未初始化")
    val host = request.url.host.lowercase()
    val engine = engineFor(ctx, host)
    val latch = CountDownLatch(1)
    val done = AtomicReference<Response>()
    val failure = AtomicReference<Throwable>()
    val callback = Callback(request, done, failure, latch)
    val builder = engine.newUrlRequestBuilder(request.url.toString(), callback, executor)
      .setHttpMethod(request.method)
      .disableCache()
    val headers = request.headers
    for (index in 0 until headers.size) {
      val name = headers.name(index)
      if (RESERVED_HEADERS.contains(name.lowercase())) continue
      try {
        builder.addHeader(name, headers.value(index))
      } catch (_: IllegalArgumentException) {
        /* 个别头 Cronet 不认，跳过即可 */
      }
    }
    val body = request.body?.let { toBytes(it) }
    /*
     * 只有真的带内容时才挂 upload provider。
     *
     * Cronet 的规矩：只要设置了上传数据，就**必须**有 Content-Type，否则 build() 直接抛
     * 「Requests with upload data must have a Content-Type.」—— 而 Cap 人机验证的挑战是
     * 「POST 但空 body」，App 这时不会设 Content-Type，于是整个验证在内置浏览器里永远失败
     * （只有走 H3 的 DoH 通道会中招，镜像通道正常）。
     *
     * 用三参数重载：单参数版会自带 `application/x-www-form-urlencoded`，会和请求里已有的
     * Content-Type 撞成两个头。请求已带 Content-Type 时也不重复添加。
     */
    if (body != null && body.isNotEmpty()) {
      builder.setUploadDataProvider(UploadDataProviders.create(body, 0, body.size), executor)
      if (request.header("Content-Type") == null) {
        builder.addHeader("Content-Type", "application/octet-stream")
      }
    }
    val urlRequest = builder.build()
    urlRequest.start()
    val deadline = System.currentTimeMillis() + CALL_TIMEOUT_MS
    while (System.currentTimeMillis() < deadline) {
      if (latch.await(200, TimeUnit.MILLISECONDS)) break
      if (cancelled()) {
        urlRequest.cancel()
        throw IOException("H3 已取消")
      }
    }
    if (latch.count > 0) {
      urlRequest.cancel()
      throw IOException("H3 超时")
    }
    failure.get()?.let { error ->
      throw if (error is IOException) error else IOException("H3 失败：${error.message}", error)
    }
    return done.get() ?: throw IOException("H3 无响应")
  }

  private fun engineFor(ctx: Context, host: String): CronetEngine = synchronized(engines) {
    engines.getOrPut(host) {
      val address = try {
        DohDns.instance.lookup(host).firstOrNull()
      } catch (error: Exception) {
        Log.i(TAG, "取 $host 的真 IP 失败：${error.message}")
        null
      }
      if (address != null) pinnedHosts[host] = address
      val ip = address?.hostAddress
      val builder = ExperimentalCronetEngine.Builder(ctx)
        .enableHttp2(true)
        .enableQuic(true)
        .addQuicHint(host, 443, 443)
        .enableHttpCache(CronetEngine.Builder.HTTP_CACHE_DISABLED, 0)
        .setUserAgent(BROWSER_UA)
      if (ip != null && ip.contains('.')) {
        builder.setExperimentalOptions(
          """{"HostResolverRules":{"host_resolver_rules":"MAP $host $ip"}}"""
        )
      }
      val engine = builder.build()
      Log.i(TAG, "engine: $host -> ${ip ?: "系统 DNS"}")
      engine
    }
  }

  /**
   * H3 失败时调用：把这个地址标记为坏（DohDns 90 秒内不再用它），并丢掉引擎。
   *
   * 原来的 TCP 路径有 RetryInterceptor + RouteWatcher 做这件事，QUIC 这条路一开始没有——
   * 钉住的那个 Cloudflare IP 一旦变慢或不可达，所有请求就会一起卡到重启为止。
   */
  fun markFailed(request: okhttp3.Request) {
    val host = request.url.host.lowercase()
    val address = synchronized(engines) {
      engines.remove(host)?.let { engine ->
        try {
          engine.shutdown()
        } catch (_: Exception) {
          /* ignore */
        }
      }
      pinnedHosts.remove(host)
    }
    try {
      DohDns.instance.markFailed(host, address)
    } catch (_: Exception) {
      /* ignore */
    }
    Log.i(TAG, "H3 失败，已标记 ${address?.hostAddress ?: "当前 IP"} 并丢弃引擎：$host")
  }

  private fun dropEngines() = synchronized(engines) {
    engines.values.forEach { engine ->
      try {
        engine.shutdown()
      } catch (_: Exception) {
        /* ignore */
      }
    }
    engines.clear()
  }

  private fun record(transport: String) {
    appContext?.getSharedPreferences(PREFS_STATUS, Context.MODE_PRIVATE)
      ?.edit()?.putString(KEY_STATUS, transport)?.apply()
  }

  private fun toBytes(body: okhttp3.RequestBody): ByteArray? {
    return try {
      val buffer = okio.Buffer()
      body.writeTo(buffer)
      buffer.readByteArray()
    } catch (error: Exception) {
      Log.i(TAG, "读请求体失败：${error.message}")
      null
    }
  }

  private class Callback(
    private val request: Request,
    private val done: AtomicReference<Response>,
    private val failure: AtomicReference<Throwable>,
    private val latch: CountDownLatch,
  ) : UrlRequest.Callback() {
    private val sink = ByteArrayOutputStream()
    private val buffer = ByteBuffer.allocateDirect(64 * 1024)
    private var info: UrlResponseInfo? = null

    override fun onRedirectReceived(
      urlRequest: UrlRequest,
      responseInfo: UrlResponseInfo,
      newLocationUrl: String,
    ) {
      /*
       * 一律不跟随：3xx 原样交给 JS。
       *
       * live.ts 自己按跳转重发（要读 Location、并按 hop 累积 Set-Cookie 维持会话），
       * 而 Cronet 这边没开 cookie jar —— 若我们替它跳，中间那几跳的 Set-Cookie 就丢了，
       * 登录/会话会静默失效。宁可返回 3xx，也不要悄悄丢 cookie。
       */
      info = responseInfo
      urlRequest.cancel()
    }

    override fun onResponseStarted(urlRequest: UrlRequest, responseInfo: UrlResponseInfo) {
      info = responseInfo
      urlRequest.read(buffer)
    }

    override fun onReadCompleted(
      urlRequest: UrlRequest,
      responseInfo: UrlResponseInfo,
      byteBuffer: ByteBuffer,
    ) {
      byteBuffer.flip()
      val chunk = ByteArray(byteBuffer.remaining())
      byteBuffer.get(chunk)
      sink.write(chunk)
      byteBuffer.clear()
      if (sink.size() > MAX_BODY) {
        urlRequest.cancel()
        return
      }
      urlRequest.read(byteBuffer)
    }

    override fun onSucceeded(urlRequest: UrlRequest, responseInfo: UrlResponseInfo) {
      finish(responseInfo)
    }

    override fun onCanceled(urlRequest: UrlRequest, responseInfo: UrlResponseInfo?) {
      // 手动不跟随重定向时会走到这里，响应仍是有效的 3xx。
      if (info != null) finish(info!!) else fail(IOException("H3 已取消"))
    }

    override fun onFailed(
      urlRequest: UrlRequest,
      responseInfo: UrlResponseInfo?,
      error: CronetException,
    ) {
      fail(error)
    }

    private fun finish(responseInfo: UrlResponseInfo) {
      val headers = Headers.Builder()
      responseInfo.allHeaders.forEach { (name, values) ->
        if (!name.startsWith(":")) values.forEach { headers.add(name, it) }
      }
      val bytes = sink.toByteArray()
      /*
       * Cronet 已经在传输层把 gzip 解开了，却仍然留着 `Content-Encoding: gzip`。
       * 若把这个头原样交给 OkHttp，BridgeInterceptor 会**再解一次**（对着明文 gunzip）并抛错，
       * 上层看到的就是「暂时连不上官网」。所以按实际字节判断：不是 gzip 魔数就把头摘掉。
       */
      val gzipped = bytes.size > 2 && bytes[0] == 0x1f.toByte() && bytes[1] == 0x8b.toByte()
      if (!gzipped) headers.removeAll("Content-Encoding")
      val built = headers.build()
      val magic = if (bytes.size > 1) "%02x%02x".format(bytes[0], bytes[1]) else "--"
      Log.d(
        TAG,
        "resp ${responseInfo.httpStatusCode} ${request.method} ${request.url.encodedPath} " +
          "ct=${built["Content-Type"]} ce=${built["Content-Encoding"]} " +
          "cl=${built["Content-Length"]} len=${bytes.size} head=$magic",
      )
      val http3 = responseInfo.negotiatedProtocol?.contains("h3") == true
      H3.record(if (http3) "HTTP/3" else "回落 TCP（${responseInfo.negotiatedProtocol ?: "?"}）")
      if (http3) Log.i(TAG, "QUIC 命中：${request.url} ${responseInfo.httpStatusCode}")
      done.set(
        Response.Builder()
          .request(request)
          .protocol(Protocol.QUIC)
          .code(responseInfo.httpStatusCode)
          .message(responseInfo.httpStatusText.orEmpty())
          .headers(built)
          .body(sink.toByteArray().toResponseBody(built["Content-Type"]?.toMediaTypeOrNull()))
          .build()
      )
      latch.countDown()
    }

    private fun fail(error: Throwable) {
      H3.record("失败")
      failure.set(error)
      latch.countDown()
    }
  }
}

private const val BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
