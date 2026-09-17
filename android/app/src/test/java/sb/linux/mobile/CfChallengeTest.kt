package sb.linux.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CfChallengeTest {

  @Test
  fun recognizesCloudflareChallengeMarkers() {
    assertTrue(CfChallenge.isChallengeSample("<title>Just a moment...</title>"))
    assertTrue(CfChallenge.isChallengeSample("<script>window._cf_chl_opt={}</script>"))
    assertTrue(CfChallenge.isChallengeSample("<div id=\"challenge-platform\"></div>"))
  }

  @Test
  fun ordinaryCloudflareWordsAreNotAChallenge() {
    assertFalse(CfChallenge.isChallengeSample("<p>cf-turnstile 是一个验证组件</p>"))
    assertFalse(CfChallenge.isChallengeSample("<title>LINUX SB</title><p>正常页面</p>"))
  }

  /**
   * 官网实际的 managed 挑战页（2026-09 抓的片段）。
   * 中文版标题是「请稍候…」，但 `_cf_chl_opt` / `challenge-platform` 一定在。
   */
  @Test
  fun recognizesLiveManagedChallengePage() {
    val live = "<title>请稍候…</title>" +
      "<script>(function(){window._cf_chl_opt = {cType: 'managed',cZone: 'linux.sb'};})()</script>" +
      "<script src=\"/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1\"></script>"
    assertTrue(CfChallenge.isChallengeSample(live))
  }

  /** 过盾成功后返回的是真站点，不能被误判成挑战页。 */
  @Test
  fun realSiteAfterClearanceIsNotAChallenge() {
    val real = "<title>LINUX SB - 人人都有饼吃的AI社区！</title><main class=\"post-list\"></main>"
    assertFalse(CfChallenge.isChallengeSample(real))
  }
}
