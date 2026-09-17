package sb.linux.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

class DohDnsTest {

  @Test
  fun githubPrefersSystemWhenUnpoisoned() {
    val vpn = ipv4("github.com", 140, 82, 112, 3)
    val hk = ipv4("github.com", 20, 205, 243, 166)
    assertEquals(listOf(vpn), DohDns.preferUnpoisoned(listOf(vpn), listOf(hk)))
  }

  @Test
  fun githubFallsBackWhenSystemIsPoisoned() {
    val poison = ipv4("github.com", 31, 13, 24, 1)
    val hk = ipv4("github.com", 20, 205, 243, 166)
    assertEquals(listOf(hk), DohDns.preferUnpoisoned(listOf(poison), listOf(hk)))
  }

  @Test
  fun githubEmptyWhenBothPoisoned() {
    val loopback = ipv4("github.com", 127, 0, 0, 1)
    val zero = ipv4("github.com", 0, 0, 0, 0)
    assertEquals(emptyList<InetAddress>(), DohDns.preferUnpoisoned(listOf(loopback), listOf(zero)))
  }

  @Test
  fun githubFamilyMatchesAuthorizeHosts() {
    assertTrue(DohDns.isGithubFamily("github.com"))
    assertTrue(DohDns.isGithubFamily("gist.github.com"))
    assertTrue(DohDns.isGithubFamily("github.githubassets.com"))
    assertTrue(DohDns.isGithubFamily("avatars.githubusercontent.com"))
  }

  /**
   * 回归：网络地址 / 广播地址不能钉进 Cronet。
   *
   * 实测闪退链：DoH 把 linux.sb 解成 `188.114.96.0`（段基址）→ Cloudflare Anycast
   * 在段内任何 IP 都应答 443，所以 `tlsReachable` 放行 → `MAP linux.sb 188.114.96.0`
   * 进 Cronet → CronetNet 线程致命 CHECK（SIGTRAP）→ 整个 App 崩溃。
   */
  @Test
  fun networkAndBroadcastAddressesAreUnusable() {
    assertTrue(DohDns.isUnusableHost(ipv4("linux.sb", 188, 114, 96, 0)))
    assertTrue(DohDns.isUnusableHost(ipv4("linux.sb", 104, 21, 8, 0)))
    assertTrue(DohDns.isUnusableHost(ipv4("linux.sb", 104, 21, 8, 255)))
    assertTrue(DohDns.isUnusableHost(ipv4("linux.sb", 169, 254, 1, 1)))
  }

  /** 正常主机地址必须照旧放行，否则会退化成全部走系统 DNS。 */
  @Test
  fun normalHostAddressesStayUsable() {
    assertFalse(DohDns.isUnusableHost(ipv4("linux.sb", 104, 21, 8, 48)))
    assertFalse(DohDns.isUnusableHost(ipv4("linux.sb", 172, 67, 156, 216)))
    assertFalse(DohDns.isUnusableHost(ipv4("linux.sb", 188, 114, 96, 1)))
  }

  private fun ipv4(host: String, a: Int, b: Int, c: Int, d: Int): InetAddress {
    return InetAddress.getByAddress(host, byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))
  }
}
