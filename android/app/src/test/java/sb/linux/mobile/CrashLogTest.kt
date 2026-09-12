package sb.linux.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CrashLogTest {

  @Test
  fun scrubRemovesAuthCookie() {
    val raw = "Cookie: bbs_auth=secret-token; bbs_csrf=abc\nAuthorization: Bearer xyz"
    val clean = CrashLog.scrub(raw)
    assertFalse(clean.contains("secret-token"))
    assertFalse(clean.contains("Bearer xyz"))
    assertEquals(true, clean.contains("bbs_auth=***"))
    assertEquals(true, clean.contains("bbs_csrf=***"))
    assertEquals(true, clean.contains("Authorization: ***"))
  }

  @Test
  fun scrubLeavesOrdinaryStack() {
    val stack = "java.lang.RuntimeException: boom\n\tat sb.linux.mobile.WebDnsProxy.attachWebView(WebDnsProxy.kt:53)"
    assertEquals(stack, CrashLog.scrub(stack))
  }
}
