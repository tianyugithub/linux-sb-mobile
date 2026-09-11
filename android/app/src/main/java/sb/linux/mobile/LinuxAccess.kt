package sb.linux.mobile

import android.content.Context
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response

/**
 * 镜像通道：linux.sb / cap.linux.sb 改写到 lsb.miapi.cc / cap-lsb.miapi.cc，
 * DNS 钉到美国机 154.12.50.175，由那边 HTTP 反代到官网。
 * DoH / 直连：请求仍是官网域名；旧镜像地址折回官网；ClientHello 拆成两个 TLS 记录。
 */
object LinuxAccess {
  const val PREFS = "lsb_access"
  const val KEY_CHANNEL = "channel"
  const val MIRROR = "mirror"
  const val DOH = "doh"
  const val DIRECT = "direct"
  const val MIRROR_HOST = "lsb.miapi.cc"
  const val CAP_MIRROR_HOST = "cap-lsb.miapi.cc"
  const val CAP_PREFIX = "/__cap__"
  const val MIRROR_A = 154
  const val MIRROR_B = 12
  const val MIRROR_C = 50
  const val MIRROR_D = 175

  @Volatile
  private var app: Context? = null

  @Volatile
  private var channel: String = MIRROR

  fun init(context: Context) {
    val ctx = context.applicationContext
    app = ctx
    channel = normalize(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_CHANNEL, MIRROR))
    applyTransport()
  }

  @JvmStatic
  fun setChannel(value: String) {
    val next = normalize(value)
    channel = next
    app?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.edit()?.putString(KEY_CHANNEL, next)?.apply()
    applyTransport()
    DohDns.instance.clearLinux()
    LinuxHttp.evict()
  }

  fun usingMirror(): Boolean = channel == MIRROR

  fun usingDoh(): Boolean = channel == DOH

  fun rewrite(url: HttpUrl): HttpUrl? {
    val host = url.host.lowercase()
    val path = url.encodedPath
    if (usingMirror()) {
      if (host == "cap.linux.sb" || host == CAP_MIRROR_HOST) {
        return if (host == CAP_MIRROR_HOST) null else url.newBuilder().host(CAP_MIRROR_HOST).build()
      }
      if (host == "linux.sb" || host == MIRROR_HOST) {
        if (path == CAP_PREFIX || path.startsWith("$CAP_PREFIX/")) {
          val stripped = if (path == CAP_PREFIX) "/" else path.substring(CAP_PREFIX.length)
          return url.newBuilder().host(CAP_MIRROR_HOST).encodedPath(stripped).build()
        }
        return if (host == MIRROR_HOST) null else url.newBuilder().host(MIRROR_HOST).build()
      }
      return null
    }
    if (host == CAP_MIRROR_HOST) {
      return url.newBuilder().host("cap.linux.sb").build()
    }
    if (host == MIRROR_HOST) {
      if (path == CAP_PREFIX || path.startsWith("$CAP_PREFIX/")) {
        val stripped = if (path == CAP_PREFIX) "/" else path.substring(CAP_PREFIX.length)
        return url.newBuilder().host("cap.linux.sb").encodedPath(stripped).build()
      }
      return url.newBuilder().host("linux.sb").build()
    }
    return null
  }

  private fun applyTransport() {
    val split = channel != MIRROR
    TlsFrag.configure(split)
    if (split) {
      TlsEch.prefetch("linux.sb")
      TlsEch.prefetch("cap.linux.sb")
    } else {
      TlsEch.forget()
    }
  }

  private fun normalize(value: String?): String {
    return when (value) {
      DIRECT -> DIRECT
      DOH -> DOH
      else -> MIRROR
    }
  }
}

class LinuxMirrorInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val rewritten = LinuxAccess.rewrite(request.url)
    val next = rewritten?.let { request.newBuilder().url(it).build() } ?: request
    android.util.Log.i("lsb-http", "${next.method} ${next.url}")
    return chain.proceed(next)
  }
}
