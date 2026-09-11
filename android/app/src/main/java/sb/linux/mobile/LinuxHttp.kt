package sb.linux.mobile

import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.EventListener
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import com.facebook.react.modules.network.CookieJarContainer
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

/**
 * 国内直连 Cloudflare 常被重置；镜像走 lsb.miapi.cc。
 * 这里统一：HTTP/1.1、短超时、失败换 IP 再试、丢掉坏连接。
 */
object LinuxHttp {
  @Volatile
  var client: OkHttpClient? = null

  fun build(base: OkHttpClient.Builder): OkHttpClient {
    val built = base
      .dns(DohDns.instance)
      .socketFactory(TlsFrag.factory)
      .cookieJar(LockedEmptyCookieJar)
      .connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(25, TimeUnit.SECONDS)
      .writeTimeout(25, TimeUnit.SECONDS)
      .callTimeout(40, TimeUnit.SECONDS)
      .retryOnConnectionFailure(true)
      .protocols(listOf(Protocol.HTTP_1_1))
      .connectionPool(ConnectionPool(4, 30, TimeUnit.SECONDS))
      .eventListener(RouteWatcher())
      .addInterceptor(H3Interceptor())
      .addInterceptor(LinuxMirrorInterceptor())
      .addInterceptor(RetryInterceptor())
      .addNetworkInterceptor(ExposeSetCookieInterceptor())
      .apply {
        if (TlsEch.available) {
          val trust = TlsEch.trustManager()
          val inner = javax.net.ssl.SSLSocketFactory.getDefault() as javax.net.ssl.SSLSocketFactory
          if (trust != null) sslSocketFactory(EchSocketFactory(inner), trust)
        }
      }
      .build()
    client = built
    return built
  }

  fun evict() {
    try {
      client?.connectionPool?.evictAll()
    } catch (_: Exception) {
      /* ignore */
    }
  }
}

/**
 * 先试 HTTP/3（QUIC），失败再交给后面的 TlsFrag 路径。
 * 放在镜像拦截器之前：要看到官网域名，才判断得出该不该走 QUIC。
 */
private class H3Interceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    if (!H3.shouldUse(request.url)) return chain.proceed(request)
    // 写请求（登录/回帖/投票）伴随跳转与 Set-Cookie，QUIC 这条路的跳转收集还不完善，
    // 交回原来的 TLS 分片路径，见 H3.supportsMethod 的说明。
    if (!H3.supportsMethod(request.method)) return chain.proceed(request)
    return try {
      H3.execute(request) { chain.call().isCanceled() }
    } catch (error: Exception) {
      android.util.Log.i("LinuxH3", "回落 TCP：${error.message}")
      chain.proceed(request)
    }
  }
}

private class RetryInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val retryable = request.method == "GET" || request.method == "HEAD"
    val tries = if (retryable) 2 else 1
    var last: IOException? = null
    for (attempt in 0 until tries) {
      try {
        val response = chain.proceed(request)
        if (response.code < 500 || attempt == tries - 1 || !retryable) return response
        response.close()
      } catch (error: IOException) {
        last = error
        DohDns.instance.markFailed(request.url.host)
        if (attempt == tries - 1) throw error
      }
      try {
        Thread.sleep(250L * (attempt + 1))
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        break
      }
    }
    throw last ?: IOException("retry failed")
  }
}

private class RouteWatcher : EventListener() {
  override fun connectFailed(
    call: Call,
    inetSocketAddress: InetSocketAddress,
    proxy: Proxy,
    protocol: Protocol?,
    ioe: IOException,
  ) {
    DohDns.instance.markFailed(call.request().url.host, inetSocketAddress.address)
  }
}

/**
 * RN 的 fetch 经常把 Set-Cookie 从 Response 里摘掉。
 * 复制一份给 JS（live.ts / upstream-auth），cookie 只走我们自己的 jar，
 * 不再进系统 CookieManager。
 */
internal fun Headers.withExposedSetCookies(): Headers {
  val cookies = ArrayList<String>()
  for (index in 0 until size) {
    if (name(index).equals("Set-Cookie", ignoreCase = true)) cookies.add(value(index))
  }
  if (cookies.isEmpty()) return this
  /*
   * 用 JSON 数组而不是换行拼接：HTTP 头里不允许出现换行（0x0a），
   * 否则 OkHttp 抛 IllegalArgumentException: Unexpected char 0x0a —— 每个请求都会崩。
   */
  return newBuilder().set("X-Lsb-Set-Cookie", org.json.JSONArray(cookies as Collection<Any>).toString()).build()
}

private class ExposeSetCookieInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val response = chain.proceed(chain.request())
    return response.newBuilder().headers(response.headers.withExposedSetCookies()).build()
  }
}

/**
 * 给 RN / Fresco 一个 CookieJarContainer，但拒绝接上系统 CookieManager。
 * 会话 cookie 只走 JS 自己带的 `Cookie` 头；否则退出后飞着的请求会把 bbs_auth 写回系统。
 */
private object LockedEmptyCookieJar : CookieJarContainer {
  override fun setCookieJar(cookieJar: CookieJar) { /* ignore */ }
  override fun removeCookieJar() { /* ignore */ }
  override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) { /* ignore */ }
  override fun loadForRequest(url: HttpUrl): List<Cookie> = emptyList()
}
