package sb.linux.mobile

import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.EventListener
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
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
