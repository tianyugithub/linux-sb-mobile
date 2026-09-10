package expo.modules.linuxnotify

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LinuxNotifyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LinuxNotify")

    Function("setEnabled") { enabled: Boolean ->
      val context = appCtx() ?: return@Function null
      NotifyPoller.setEnabled(context, enabled)
      null
    }

    Function("isEnabled") {
      val context = appCtx() ?: return@Function false
      NotifyPoller.prefs(context).getBoolean(NotifyPoller.KEY_ENABLED, false)
    }

    Function("syncSession") { cookie: String, unread: Int, baselined: Boolean ->
      val context = appCtx() ?: return@Function null
      NotifyPoller.setSession(context, cookie, unread.takeIf { it >= 0 }, baselined)
      null
    }

    Function("start") {
      val context = appCtx() ?: return@Function false
      NotifyPoller.schedule(context, NotifyPoller.FIRST_DELAY_MS)
      true
    }

    Function("stop") {
      val context = appCtx() ?: return@Function false
      NotifyPoller.cancel(context)
      true
    }

    Function("isIgnoringBattery") {
      val context = appCtx() ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function true
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("requestBattery") {
      val activity = appContext.currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function true
      val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (pm.isIgnoringBatteryOptimizations(activity.packageName)) return@Function true
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${activity.packageName}")
      }
      activity.startActivity(intent)
      true
    }
  }

  private fun appCtx(): Context? =
    appContext.reactContext?.applicationContext
      ?: appContext.currentActivity?.applicationContext
}
