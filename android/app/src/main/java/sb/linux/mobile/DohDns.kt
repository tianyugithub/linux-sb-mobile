package sb.linux.mobile

import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.InetAddress
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * DNS over HTTPS。
 *
 * linux.sb 在 Cloudflare 上。国内运营商 DNS、以及阿里云 / DNSPod 的 DoH，
 * 都会把解析污染成 Dropbox / Facebook 的地址，TLS 必然失败。
 * 这里改走 1.1.1.1 / 8.8.8.8（URL 里直接写 IP，不再解析 DoH 域名），
 * 并丢掉明显的污染结果；若仍失败，回退到已知的 Cloudflare Anycast。
 *
 * GitHub 用阿里云 DoH / 香港节点（20.205.243.x）；网页走内置浏览器即可打开。
 * 安装包和 API 另走 gh-proxy 镜像。
 */
class DohDns : Dns {
  private val cache = ConcurrentHashMap<String, Cached>()
  private val bootstrap = OkHttpClient.Builder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(2, TimeUnit.SECONDS)
    .dns(Dns.SYSTEM)
    .build()

  override fun lookup(hostname: String): List<InetAddress> {
    val host = hostname.lowercase()
    if (host in BOOTSTRAP_HOSTS) return Dns.SYSTEM.lookup(hostname)
    if (!needsDoh(host)) return Dns.SYSTEM.lookup(hostname)

    val now = System.currentTimeMillis()
    cache[host]?.let { if (it.until > now && it.addresses.isNotEmpty()) return it.addresses }

    if (isLinuxHost(host)) {
      val fallback = fallbackLinux(host)
      cache[host] = Cached(fallback, now + 30_000)
      Thread({ refreshLinux(host) }, "lsb-doh").apply { isDaemon = true; start() }
      return fallback
    }

    fallbackGithub(host)?.let { fallback ->
      cache[host] = Cached(fallback, now + 30_000)
      Thread({ refreshGithub(host) }, "gh-doh").apply { isDaemon = true; start() }
      return fallback
    }

    for (endpoint in GITHUB_DOH) {
      val resolved = query(endpoint, host) ?: continue
      val accepted = resolved.addresses.filterNot { isPoison(it) }
      if (accepted.isEmpty()) continue
      cache[host] = Cached(accepted, resolved.until)
      return accepted
    }
    return Dns.SYSTEM.lookup(hostname)
  }

  private fun refreshLinux(host: String) {
    for (endpoint in LINUX_DOH) {
      val resolved = query(endpoint, host) ?: continue
      val accepted = resolved.addresses.filter { isCloudflare(it) }
      if (accepted.isEmpty()) continue
      cache[host] = Cached(accepted, resolved.until)
      return
    }
  }

  private fun refreshGithub(host: String) {
    for (endpoint in GITHUB_DOH) {
      val resolved = query(endpoint, host) ?: continue
      val accepted = resolved.addresses.filterNot { isPoison(it) }
      if (accepted.isEmpty()) continue
      cache[host] = Cached(accepted, resolved.until)
      return
    }
  }

  private fun query(endpoint: String, hostname: String): Cached? {
    return try {
      val encoded = URLEncoder.encode(hostname, "UTF-8")
      val request = Request.Builder()
        .url(endpoint.replace("{name}", encoded))
        .header("Accept", "application/dns-json")
        .build()
      bootstrap.newCall(request).execute().use { response ->
        if (!response.isSuccessful) return null
        val body = response.body?.string() ?: return null
        parseAnswers(hostname, body)
      }
    } catch (_: Exception) {
      null
    }
  }

  private data class Cached(val addresses: List<InetAddress>, val until: Long)

  companion object {
    val instance: DohDns by lazy { DohDns() }

    private val BOOTSTRAP_HOSTS = setOf(
      "dns.alidns.com",
    )

    /** URL 里直接写 IP，避免再去解析 DoH 服务器自己的域名。 */
    private val LINUX_DOH = listOf(
      "https://1.1.1.1/dns-query?name={name}&type=A",
      "https://1.0.0.1/dns-query?name={name}&type=A",
      "https://8.8.8.8/resolve?name={name}&type=A",
    )
    private val GITHUB_DOH = listOf(
      "https://dns.alidns.com/resolve?name={name}&type=A",
      "https://1.1.1.1/dns-query?name={name}&type=A",
    )

    private fun needsDoh(host: String): Boolean {
      return isLinuxHost(host)
        || host == "github.com"
        || host.endsWith(".github.com")
        || host == "github.githubassets.com"
        || host.endsWith(".githubassets.com")
        || host.endsWith(".githubusercontent.com")
        || host == "githubusercontent.com"
    }

    private fun isLinuxHost(host: String): Boolean {
      return host == "linux.sb" || host.endsWith(".linux.sb")
    }

    private fun parseIpv4(hostname: String, data: String): InetAddress? {
      val parts = data.trim().split('.')
      if (parts.size != 4) return null
      val bytes = ByteArray(4)
      for (i in 0..3) {
        val n = parts[i].toIntOrNull() ?: return null
        if (n !in 0..255) return null
        bytes[i] = n.toByte()
      }
      return try {
        InetAddress.getByAddress(hostname, bytes)
      } catch (_: Exception) {
        null
      }
    }

    private fun ipv4(host: String, a: Int, b: Int, c: Int, d: Int): InetAddress {
      return InetAddress.getByAddress(host, byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))
    }

    private fun fallbackLinux(host: String): List<InetAddress> {
      return listOf(
        ipv4(host, 104, 21, 8, 48),
        ipv4(host, 172, 67, 156, 216),
      )
    }

    /** 国内能通的 GitHub 香港节点（Azure 20.205.243.x）。 */
    private fun fallbackGithub(host: String): List<InetAddress>? {
      return when (host) {
        "github.com", "www.github.com", "gist.github.com" -> listOf(ipv4(host, 20, 205, 243, 166))
        "api.github.com" -> listOf(ipv4(host, 20, 205, 243, 168))
        "codeload.github.com" -> listOf(ipv4(host, 20, 205, 243, 165))
        else -> null
      }
    }

    /** Cloudflare 对外 Anycast 常见段。linux.sb 真实解析应落在这里。 */
    private fun isCloudflare(addr: InetAddress): Boolean {
      val bytes = addr.address ?: return false
      if (bytes.size != 4) return false
      val a = bytes[0].toInt() and 0xFF
      val b = bytes[1].toInt() and 0xFF
      val c = bytes[2].toInt() and 0xFF
      if (a == 104 && b in 16..31) return true
      if (a == 172 && b in 64..71) return true
      if (a == 162 && b in 158..159) return true
      if (a == 188 && b == 114 && c in 96..111) return true
      if (a == 198 && b == 41 && c >= 128) return true
      if (a == 141 && b == 101 && c >= 64) return true
      if (a == 108 && b == 162 && c >= 192) return true
      if (a == 173 && b == 245 && c in 48..63) return true
      return false
    }

    private fun isPoison(addr: InetAddress): Boolean {
      val bytes = addr.address ?: return true
      if (bytes.size != 4) return true
      val a = bytes[0].toInt() and 0xFF
      val b = bytes[1].toInt() and 0xFF
      if (a == 0 || a == 127 || a == 255) return true
      if (a == 162 && b == 125) return true
      if (a == 31 && b == 13) return true
      if (a == 157 && b == 240) return true
      if (a == 198 && (b == 18 || b == 19)) return true
      if (a == 46 && b == 82) return true
      return false
    }

    private fun parseAnswers(hostname: String, json: String): Cached? {
      val root = JSONObject(json)
      if (root.optInt("Status", 0) != 0) return null
      val answers = root.optJSONArray("Answer") ?: return null
      val addresses = ArrayList<InetAddress>()
      var ttlSec = 120
      for (index in 0 until answers.length()) {
        val item = answers.getJSONObject(index)
        if (item.optInt("type") != 1) continue
        val parsed = parseIpv4(hostname, item.optString("data")) ?: continue
        addresses += parsed
        val ttl = item.optInt("TTL", ttlSec)
        if (ttl > 0) ttlSec = ttl.coerceIn(30, 300)
      }
      if (addresses.isEmpty()) return null
      return Cached(addresses, System.currentTimeMillis() + ttlSec * 1000L)
    }
  }
}
