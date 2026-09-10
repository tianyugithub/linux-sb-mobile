package expo.modules.linuxcookies

import android.webkit.CookieManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LinuxCookiesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LinuxCookies")

    AsyncFunction("get") { url: String ->
      CookieManager.getInstance().getCookie(url) ?: ""
    }

    AsyncFunction("flush") {
      CookieManager.getInstance().flush()
    }
  }
}
