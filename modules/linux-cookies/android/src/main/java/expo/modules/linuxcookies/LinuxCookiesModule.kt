package expo.modules.linuxcookies

import android.os.Looper
import android.webkit.CookieManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 官网 linux.sb 和镜像 lsb.miapi.cc 在浏览器里是两个 host，cookie 不能自动共用。
 * 服务端认的是同一份 bbs_auth，这里读写时都往两个域名各写一份。
 */
class LinuxCookiesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LinuxCookies")

    AsyncFunction("get") { url: String ->
      CookieManager.getInstance().getCookie(url) ?: ""
    }

    AsyncFunction("merged") {
      mergedHeader()
    }

    AsyncFunction("put") { header: String ->
      putHeader(header)
    }

    AsyncFunction("clearSite") {
      clearSite()
    }

    AsyncFunction("flush") {
      CookieManager.getInstance().flush()
    }
  }
}

private val SITE_URLS = listOf(
  "https://linux.sb/",
  "https://lsb.miapi.cc/",
  "https://cap.linux.sb/",
  "https://cap-lsb.miapi.cc/",
)

private val SITE_DOMAINS = listOf(
  "linux.sb",
  ".linux.sb",
  "lsb.miapi.cc",
  ".lsb.miapi.cc",
  "cap.linux.sb",
  "cap-lsb.miapi.cc",
)

private fun pairs(header: String): List<Pair<String, String>> {
  return header.split(';').map { it.trim() }.mapNotNull { part ->
    val eq = part.indexOf('=')
    if (eq <= 0) return@mapNotNull null
    val name = part.substring(0, eq).trim()
    val value = part.substring(eq + 1)
    if (name.isEmpty()) null else name to value
  }
}

private fun merge(vararg headers: String): String {
  val map = LinkedHashMap<String, String>()
  for (header in headers) {
    for ((name, value) in pairs(header)) {
      if (value.isNotEmpty()) map[name] = value
    }
  }
  return map.entries.joinToString("; ") { "${it.key}=${it.value}" }
}

private fun mergedHeader(): String {
  val cm = CookieManager.getInstance()
  return merge(*SITE_URLS.map { cm.getCookie(it).orEmpty() }.toTypedArray())
}

private fun putHeader(header: String) {
  val cm = CookieManager.getInstance()
  cm.setAcceptCookie(true)
  for ((name, value) in pairs(header)) {
    val line = "$name=$value; Path=/; Secure"
    for (url in SITE_URLS) {
      cm.setCookie(url, line)
    }
  }
  cm.flush()
}

private fun clearSite() {
  val cm = CookieManager.getInstance()
  val names = LinkedHashSet<String>()
  for (url in SITE_URLS) {
    for ((name, _) in pairs(cm.getCookie(url).orEmpty())) names += name
  }
  for (name in names) {
    for (url in SITE_URLS) {
      cm.setCookie(url, "$name=; Path=/; Secure; Max-Age=0")
      for (domain in SITE_DOMAINS) {
        cm.setCookie(url, "$name=; Path=/; Domain=$domain; Secure; Max-Age=0")
      }
    }
  }
  cm.removeSessionCookies(null)
  if (Looper.myLooper() == Looper.getMainLooper()) {
    cm.removeAllCookies { cm.flush() }
    return
  }
  val done = CountDownLatch(1)
  cm.removeAllCookies {
    cm.flush()
    done.countDown()
  }
  try {
    done.await(2, TimeUnit.SECONDS)
  } catch (_: InterruptedException) {
    Thread.currentThread().interrupt()
  }
  cm.flush()
}
