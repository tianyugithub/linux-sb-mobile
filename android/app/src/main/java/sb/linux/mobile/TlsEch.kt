package sb.linux.mobile

import android.util.Base64
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.InetAddress
import java.net.Socket
import java.net.URLEncoder
import java.security.KeyStore
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * Android 17 才有 ECH API。有公钥就把真实 SNI 加密发出去，外层只剩
 * cloudflare-ech.com。这台设备没有接口时 apply() 直接返回 false，握手仍走分片。
 */
object TlsEch {
  const val PARAM_ECH = 5
  const val VERSION = 0xFE0D
  const val TTL_MS = 30 * 60 * 1000L

  private class Api(val make: java.lang.reflect.Constructor<*>, val set: java.lang.reflect.Method, val socketFirst: Boolean)

  private val api: Api? by lazy { discover() }

  val available: Boolean get() = api != null

  private class Hit(val config: ByteArray?, val until: Long)

  private val cache = ConcurrentHashMap<String, Hit>()

  private val http by lazy {
    OkHttpClient.Builder()
      .connectTimeout(4, TimeUnit.SECONDS)
      .readTimeout(4, TimeUnit.SECONDS)
      .dns(object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
          if (hostname.equals("stellafortuna.ddd.oaifree.com", true)) {
            return listOf(
              InetAddress.getByAddress(hostname, byteArrayOf(104.toByte(), 21, 16, 56)),
              InetAddress.getByAddress(hostname, byteArrayOf(172.toByte(), 67.toByte(), 210.toByte(), 33)),
            )
          }
          return Dns.SYSTEM.lookup(hostname)
        }
      })
      .build()
  }

  fun prefetch(host: String) {
    if (!available) return
    Thread({ configFor(host) }, "lsb-ech").apply { isDaemon = true; start() }
  }

  fun forget() = cache.clear()

  fun configFor(host: String): ByteArray? {
    val now = System.currentTimeMillis()
    cache[host]?.let { if (it.until > now) return it.config }
    val fetched = runCatching { fetchEch(host) }.getOrNull()?.takeIf { it.isNotEmpty() }
    cache[host] = Hit(fetched, now + TTL_MS)
    if (fetched != null) {
      android.util.Log.i("lsb-tls", "ech $host ${fetched.size}B names=${publicNames(fetched)}")
    }
    return fetched
  }

  fun apply(socket: SSLSocket, host: String): Boolean {
    val handles = api ?: return false
    val now = System.currentTimeMillis()
    val config = cache[host]?.takeIf { it.until > now }?.config ?: return false
    return runCatching {
      val list = handles.make.newInstance(config)
      if (handles.socketFirst) handles.set.invoke(null, socket, list)
      else handles.set.invoke(null, list, socket)
      true
    }.getOrDefault(false)
  }

  fun trustManager(): X509TrustManager? = runCatching {
    TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
      .apply { init(null as KeyStore?) }
      .trustManagers
      .filterIsInstance<X509TrustManager>()
      .firstOrNull()
  }.getOrNull()

  fun publicNames(config: ByteArray): List<String> = try {
    names(config)
  } catch (_: RuntimeException) {
    emptyList()
  }

  private fun fetchEch(host: String): ByteArray? {
    val encoded = URLEncoder.encode(host, "UTF-8")
    for (url in listOf(
      "https://stellafortuna.ddd.oaifree.com/query-dns?name=$encoded&type=HTTPS",
      "https://stellafortuna.ddd.oaifree.com/query-dns?name=$encoded&type=65",
    )) {
      val request = Request.Builder().url(url).header("Accept", "application/dns-json").build()
      http.newCall(request).execute().use { response ->
        if (!response.isSuccessful) return@use
        val body = response.body?.string() ?: return@use
        parseEch(body)?.let { return it }
      }
    }
    return null
  }

  internal fun parseEch(json: String): ByteArray? {
    val answers = JSONObject(json).optJSONArray("Answer") ?: return null
    for (i in 0 until answers.length()) {
      val item = answers.getJSONObject(i)
      val type = item.optInt("type")
      if (type != 65 && type != PARAM_ECH) continue
      decodeEch(item.optString("data")).takeIf { it.isNotEmpty() }?.let { return it }
    }
    return null
  }

  internal fun decodeEch(data: String): ByteArray {
    val raw = data.trim()
    val token = Regex("""(?:^|\s)ech=([A-Za-z0-9+/_=-]+)""", RegexOption.IGNORE_CASE)
      .find(raw)
      ?.groupValues
      ?.get(1)
      ?: if (raw.matches(Regex("^[A-Za-z0-9+/_=-]+$"))) raw else return ByteArray(0)
    val decoded = decodeB64(token) ?: return ByteArray(0)
    if (decoded.size >= 2) {
      val listed = ((decoded[0].toInt() and 0xFF) shl 8) or (decoded[1].toInt() and 0xFF)
      if (listed == decoded.size - 2) return decoded
    }
    val prefixed = ByteArray(decoded.size + 2)
    prefixed[0] = ((decoded.size shr 8) and 0xFF).toByte()
    prefixed[1] = (decoded.size and 0xFF).toByte()
    System.arraycopy(decoded, 0, prefixed, 2, decoded.size)
    return prefixed
  }

  private fun decodeB64(token: String): ByteArray? {
    val padded = token.replace('-', '+').replace('_', '/')
    val withPad = padded + "=".repeat((4 - padded.length % 4) % 4)
    return try {
      Base64.decode(withPad, Base64.DEFAULT)
    } catch (_: Exception) {
      null
    }
  }

  private fun names(b: ByteArray): List<String> {
    if (b.size < 2) return emptyList()
    val end = minOf(2 + (((b[0].toInt() and 0xFF) shl 8) or (b[1].toInt() and 0xFF)), b.size)
    val found = ArrayList<String>()
    var i = 2
    while (i + 4 <= end) {
      val version = ((b[i].toInt() and 0xFF) shl 8) or (b[i + 1].toInt() and 0xFF)
      val length = ((b[i + 2].toInt() and 0xFF) shl 8) or (b[i + 3].toInt() and 0xFF)
      val body = i + 4
      if (body + length > end) break
      if (version == VERSION) publicName(b, body, body + length)?.let { found += it }
      i = body + length
    }
    return found
  }

  private fun publicName(b: ByteArray, start: Int, end: Int): String? {
    var i = start + 1 + 2
    if (i + 2 > end) return null
    i += 2 + (((b[i].toInt() and 0xFF) shl 8) or (b[i + 1].toInt() and 0xFF))
    if (i + 2 > end) return null
    i += 2 + (((b[i].toInt() and 0xFF) shl 8) or (b[i + 1].toInt() and 0xFF))
    i += 1
    if (i + 1 > end) return null
    val size = b[i].toInt() and 0xFF
    val at = i + 1
    if (size == 0 || at + size > end) return null
    return String(b, at, size, Charsets.US_ASCII)
  }

  private fun discover(): Api? = runCatching {
    val listClass = Class.forName("android.net.ssl.EchConfigList")
    val make = listClass.declaredConstructors.firstOrNull {
      it.parameterTypes.size == 1 && it.parameterTypes[0] == ByteArray::class.java
    } ?: return@runCatching null
    val set = Class.forName("android.net.ssl.SSLSockets").declaredMethods.firstOrNull {
      it.name == "setEchConfigList" && it.parameterTypes.size == 2 &&
        it.parameterTypes.any { p -> p.isAssignableFrom(SSLSocket::class.java) } &&
        it.parameterTypes.any { p -> p == listClass }
    } ?: return@runCatching null
    make.isAccessible = true
    Api(make, set, socketFirst = set.parameterTypes[0] != listClass)
  }.getOrNull()
}

class EchSocketFactory(
  private val inner: SSLSocketFactory,
) : SSLSocketFactory() {
  override fun getDefaultCipherSuites(): Array<String> = inner.defaultCipherSuites
  override fun getSupportedCipherSuites(): Array<String> = inner.supportedCipherSuites

  override fun createSocket(s: Socket, host: String, port: Int, autoClose: Boolean): Socket =
    arm(inner.createSocket(s, host, port, autoClose), host)

  override fun createSocket(host: String, port: Int): Socket =
    arm(inner.createSocket(host, port), host)

  override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
    arm(inner.createSocket(host, port, localHost, localPort), host)

  override fun createSocket(host: InetAddress, port: Int): Socket = inner.createSocket(host, port)

  override fun createSocket(
    address: InetAddress,
    port: Int,
    localAddress: InetAddress,
    localPort: Int,
  ): Socket = inner.createSocket(address, port, localAddress, localPort)

  private fun arm(socket: Socket, host: String): Socket {
    if (socket is SSLSocket) TlsEch.apply(socket, host)
    return socket
  }
}
