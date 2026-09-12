package sb.linux.mobile

import org.junit.Assert.assertEquals
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

  private fun ipv4(host: String, a: Int, b: Int, c: Int, d: Int): InetAddress {
    return InetAddress.getByAddress(host, byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))
  }
}
