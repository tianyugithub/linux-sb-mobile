package sb.linux.mobile

import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * DNS over HTTPS。
 *
 * DoH 通道：只问 stellafortuna query-dns，拿到 Cloudflare IP 后再直连 linux.sb。
 * 直连通道：先探测写死的 Cloudflare Anycast，后台再用 1.1.1.1 / 8.8.8.8。
 * 国内运营商 DNS、以及阿里云 / DNSPod 的 DoH，会把 linux.sb 污染成
 * Dropbox / Facebook 的地址，TLS 必然失败。
 *
 * GitHub：先信系统 DNS（用户 VPN 会给出 140.82.x 这类真地址），污染再回落到
 * 香港节点（20.205.243.x）和阿里云 DoH。挂了 VPN 时不能一上来就钉香港。
 */
class DohDns : Dns {
  private val cache = ConcurrentHashMap<String, Cached>()
  private val failedUntil = ConcurrentHashMap<String, Long>()
  private val linuxLock = Any()
  private val probePool = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "lsb-probe").apply { isDaemon = true }
  }
  private val bootstrap = OkHttpClient.Builder()
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(2, TimeUnit.SECONDS)
    .dns(object : Dns {
      override fun lookup(hostname: String): List<InetAddress> {
        return pinned(hostname) ?: Dns.SYSTEM.lookup(hostname)
      }
    })
    .build()

  override fun lookup(hostname: String): List<InetAddress> {
    val host = hostname.lowercase()
    pinned(host)?.let { pinned ->
      android.util.Log.i("lsb-dns", "pin $host ${pinned.joinToString { addrKey(it) }}")
      return pinned
    }
    if (host in BOOTSTRAP_HOSTS) return Dns.SYSTEM.lookup(hostname)
    if (!needsDoh(host)) return Dns.SYSTEM.lookup(hostname)

    val now = System.currentTimeMillis()
    cache[host]?.let { cached ->
      val live = cached.addresses.filter { (failedUntil[addrKey(it)] ?: 0L) <= now }
      if (cached.until > now && live.isNotEmpty()) return live
    }

    if (isLinuxHost(host)) {
      synchronized(linuxLock) {
        val again = System.currentTimeMillis()
        cache[host]?.let { cached ->
          val live = cached.addresses.filter { (failedUntil[addrKey(it)] ?: 0L) <= again }
          if (cached.until > again && live.isNotEmpty()) return live
        }
        val probed = if (LinuxAccess.usingDoh()) resolveStella(host) else probeLinux(host)
        cache[host] = Cached(probed, again + LINUX_TTL_MS)
        if (!LinuxAccess.usingDoh()) {
          Thread({ refreshLinux(host) }, "lsb-doh").apply { isDaemon = true; start() }
        }
        return probed
      }
    }

    if (isGithubFamily(host)) {
      return lookupGithub(hostname, host, now)
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

  fun clearLinux() {
    cache.keys.filter { isLinuxHost(it) || isMirrorHost(it) }.forEach { cache.remove(it) }
  }

  fun markFailed(hostname: String, address: InetAddress? = null) {
    val host = hostname.lowercase()
    if (!isLinuxHost(host) && !isMirrorHost(host)) return
    val now = System.currentTimeMillis()
    if (address != null) failedUntil[addrKey(address)] = now + 90_000
    val cached = cache[host] ?: return
    val remain = cached.addresses.filter { (failedUntil[addrKey(it)] ?: 0L) <= now }
    if (remain.size == cached.addresses.size) return
    if (remain.isNotEmpty()) {
      cache[host] = Cached(remain, cached.until)
    } else {
      cache.remove(host)
      LinuxHttp.evict()
    }
  }

  private fun refreshLinux(host: String) {
    val extras = ArrayList<InetAddress>()
    for (endpoint in DIRECT_DOH) {
      val resolved = query(endpoint, host) ?: continue
      extras += resolved.addresses.filter { isCloudflare(it) }
      if (extras.isNotEmpty()) break
    }
    if (extras.isEmpty()) return
    val probed = probeCandidates(host, extras)
    if (probed.isEmpty()) return
    synchronized(linuxLock) {
      val now = System.currentTimeMillis()
      val current = cache[host]?.addresses.orEmpty()
      val merged = linkedSetOf<InetAddress>()
      probed.forEach { merged += it }
      current.filter { (failedUntil[addrKey(it)] ?: 0L) <= now }.forEach { merged += it }
      if (merged.isEmpty()) return
      cache[host] = Cached(merged.toList(), now + LINUX_TTL_MS)
    }
  }

  private fun lookupGithub(hostname: String, host: String, now: Long): List<InetAddress> {
    val system = try {
      Dns.SYSTEM.lookup(hostname)
    } catch (_: Exception) {
      emptyList()
    }
    val pin = fallbackGithub(host).orEmpty()
    val chosen = preferUnpoisoned(system, pin)
    val systemClean = system.filterNot { isPoison(it) }
    if (chosen.isNotEmpty()) {
      cache[host] = Cached(chosen, now + 30_000)
      if (systemClean.isEmpty()) {
        Thread({ refreshGithub(host) }, "gh-doh").apply { isDaemon = true; start() }
      }
      android.util.Log.i(
        "lsb-dns",
        "github $host via ${if (systemClean.isNotEmpty()) "system" else "pin"} ${chosen.joinToString { addrKey(it) }}",
      )
      return chosen
    }
    for (endpoint in GITHUB_DOH) {
      val resolved = query(endpoint, host) ?: continue
      val accepted = resolved.addresses.filterNot { isPoison(it) }
      if (accepted.isEmpty()) continue
      cache[host] = Cached(accepted, resolved.until)
      return accepted
    }
    return if (pin.isNotEmpty()) pin else Dns.SYSTEM.lookup(hostname)
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

  private fun resolveStella(host: String): List<InetAddress> {
    val resolved = query(STELLA_DOH, host)
    val accepted = resolved?.addresses.orEmpty().filter { !isPoison(it) && isCloudflare(it) }
    if (accepted.isEmpty()) {
      android.util.Log.w("lsb-dns", "stella empty $host")
      return probeLinux(host)
    }
    val probed = probeCandidates(host, accepted)
    val used = if (probed.isNotEmpty()) probed else accepted
    android.util.Log.i("lsb-dns", "stella $host ${used.joinToString { addrKey(it) }}")
    return used
  }

  private fun probeLinux(host: String): List<InetAddress> {
    val official = probeCandidates(host, fallbackLinux(host))
    if (official.isNotEmpty()) return official
    val extra = probeCandidates(host, extraCloudflare(host))
    if (extra.isNotEmpty()) return extra
    return fallbackLinux(host)
  }

  private fun probeCandidates(host: String, candidates: List<InetAddress>): List<InetAddress> {
    val usable = candidates.filter { !isUnusableHost(it) }
    if (usable.isEmpty()) return emptyList()
    val ok = CopyOnWriteArrayList<InetAddress>()
    val latch = CountDownLatch(1)
    usable.forEach { ip ->
      probePool.execute {
        if (tlsReachable(host, ip, 1_800)) {
          ok += ip
          latch.countDown()
        }
      }
    }
    try {
      latch.await(1_800, TimeUnit.MILLISECONDS)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
    if (ok.isNotEmpty()) {
      try {
        Thread.sleep(120)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }
    val now = System.currentTimeMillis()
    return ok.filter { (failedUntil[addrKey(it)] ?: 0L) <= now }.distinctBy { addrKey(it) }
  }

  private fun tlsReachable(host: String, ip: InetAddress, timeoutMs: Int): Boolean {
    var raw: Socket? = null
    var ssl: SSLSocket? = null
    return try {
      raw = FragSocket(TlsFrag.style)
      raw.connect(InetSocketAddress(ip, 443), timeoutMs)
      raw.soTimeout = timeoutMs
      raw.tcpNoDelay = true
      val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
      val tls = factory.createSocket(raw, host, 443, true) as SSLSocket
      ssl = tls
      tls.soTimeout = timeoutMs
      TlsEch.apply(tls, host)
      tls.startHandshake()
      true
    } catch (_: Exception) {
      false
    } finally {
      try {
        ssl?.close()
      } catch (_: Exception) {
      }
      try {
        raw?.close()
      } catch (_: Exception) {
      }
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

    private const val LINUX_TTL_MS = 5 * 60_000L

    private val BOOTSTRAP_HOSTS = setOf(
      "dns.alidns.com",
    )

    /**
     * DoH 通道只问 stellafortuna。域名本身常能在国内解析，IP 钉在 Cloudflare。
     */
    private const val STELLA_DOH =
      "https://stellafortuna.ddd.oaifree.com/query-dns?name={name}&type=A"
    /** 直连通道：1.1.1.1 / 8.8.8.8，URL 里的 IP 条目不再解析 DoH 域名。 */
    private val DIRECT_DOH = listOf(
      "https://1.1.1.1/dns-query?name={name}&type=A",
      "https://1.0.0.1/dns-query?name={name}&type=A",
      "https://8.8.8.8/resolve?name={name}&type=A",
    )
    private val GITHUB_DOH = listOf(
      "https://dns.alidns.com/resolve?name={name}&type=A",
      "https://1.1.1.1/dns-query?name={name}&type=A",
    )

    private fun needsDoh(host: String): Boolean {
      return isLinuxHost(host) || isMirrorHost(host) || isGithubFamily(host)
    }

    internal fun isGithubFamily(host: String): Boolean {
      return host == "github.com"
        || host.endsWith(".github.com")
        || host == "github.githubassets.com"
        || host.endsWith(".githubassets.com")
        || host.endsWith(".githubusercontent.com")
        || host == "githubusercontent.com"
    }

    internal fun preferUnpoisoned(
      system: List<InetAddress>,
      fallback: List<InetAddress>,
    ): List<InetAddress> {
      val clean = system.filterNot { isPoison(it) }
      if (clean.isNotEmpty()) return clean
      return fallback.filterNot { isPoison(it) }
    }

    private fun isLinuxHost(host: String): Boolean {
      return host == "linux.sb" || host.endsWith(".linux.sb")
    }

    private fun isMirrorHost(host: String): Boolean {
      return host == LinuxAccess.MIRROR_HOST || host == LinuxAccess.CAP_MIRROR_HOST
    }

    private fun pinned(hostname: String): List<InetAddress>? {
      val host = hostname.lowercase()
      if (host == "stellafortuna.ddd.oaifree.com") {
        return listOf(
          ipv4(host, 104, 21, 16, 56),
          ipv4(host, 172, 67, 210, 33),
        )
      }
      return null
    }

    private fun addrKey(addr: InetAddress): String {
      return addr.address?.joinToString(".") { (it.toInt() and 0xFF).toString() } ?: addr.hostAddress.orEmpty()
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

    /**
     * Cloudflare Anycast：任意边缘 IP + SNI linux.sb 都能出站。
     * 官网两条 A 都挂的时候，换一条常见 104.16–19 再试。
     */
    private fun extraCloudflare(host: String): List<InetAddress> {
      return listOf(
        ipv4(host, 104, 16, 1, 1),
        ipv4(host, 104, 17, 1, 1),
        ipv4(host, 104, 18, 1, 1),
        ipv4(host, 104, 19, 1, 1),
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
      if (isUnusableHost(addr)) return false
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

    /**
     * 网络地址 / 广播地址不能当主机用。
     *
     * 实测踩到的坑：`isCloudflare` 认「188.114.96.0/20」整段，而 DoH 有时会把
     * linux.sb 解成 **`188.114.96.0`**（段基址、主机位全 0，是网络地址）。
     * Cloudflare Anycast 在任何段内 IP 上都会应答 443，于是 `tlsReachable` 放行，
     * 这个非法地址被 `H3.engineFor` 塞进 Cronet 的 `HostResolverRules` →
     * Cronet 在 `CronetNet` 线程上致命 `CHECK` → SIGTRAP，**整个 App 闪退**。
     *
     * 所以凡是主机位为 0（网络地址）或全 1（广播地址）的一律丢掉，
     * 让它回落到下一条候选，而不是进 Cronet。
     */
    internal fun isUnusableHost(addr: InetAddress): Boolean {
      val bytes = addr.address ?: return true
      if (bytes.size != 4) return false
      val d = bytes[3].toInt() and 0xFF
      if (d == 0 || d == 255) return true
      // 169.254.0.0/16 链路本地：连不上官网，别浪费探测。
      val a = bytes[0].toInt() and 0xFF
      val b = bytes[1].toInt() and 0xFF
      if (a == 169 && b == 254) return true
      return false
    }

    internal fun isPoison(addr: InetAddress): Boolean {
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
      if (a == 104 && b == 244) return true
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
