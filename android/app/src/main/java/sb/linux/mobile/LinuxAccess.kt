package sb.linux.mobile

import android.content.Context
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response

/**
 * DoH / 直连：请求仍是官网域名；旧镜像地址（lsb.miapi.cc）折回官网；
 * ClientHello 拆成两个 TLS 记录。旧版「镜像」通道已下线，偏好里的 mirror 折成 doh。
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

  @Volatile
  private var app: Context? = null

  @Volatile
  private var channel: String = DOH

  fun init(context: Context) {
    val ctx = context.applicationContext
    app = ctx
    channel = normalize(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_CHANNEL, DOH))
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
    H3.onAccessChannelChanged()
  }

  fun usingMirror(): Boolean = false

  fun usingDoh(): Boolean = channel == DOH

  fun rewrite(url: HttpUrl): HttpUrl? {
    val host = url.host.lowercase()
    val path = url.encodedPath
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
    TlsFrag.configure(true)
    TlsEch.prefetch("linux.sb")
    TlsEch.prefetch("cap.linux.sb")
  }

  private fun normalize(value: String?): String {
    return when (value) {
      DIRECT -> DIRECT
      else -> DOH
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
