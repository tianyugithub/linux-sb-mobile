package expo.modules.linuxnotify

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

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

    Function("canInstallPackages") {
      val context = appCtx() ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function true
      context.packageManager.canRequestPackageInstalls()
    }

    Function("openInstallPermission") {
      val activity = appContext.currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function true
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
        data = Uri.parse("package:${activity.packageName}")
      }
      activity.startActivity(intent)
      true
    }

    AsyncFunction("installApk") { path: String ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      val file = apkFile(path)
      if (!file.exists() || file.length() < 1024) {
        throw Exception("安装包下载不完整，请重试")
      }
      val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.linuxupdate", file)
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      true
    }
  }

  private fun apkFile(path: String): File {
    val decoded = path.trim()
    if (decoded.startsWith("file:")) {
      return File(Uri.parse(decoded).path ?: decoded.removePrefix("file://"))
    }
    return File(decoded)
  }

  private fun appCtx(): Context? =
    appContext.reactContext?.applicationContext
      ?: appContext.currentActivity?.applicationContext
}
