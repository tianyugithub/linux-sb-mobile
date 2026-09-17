package expo.modules.linuxnotify

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.modules.network.OkHttpClientProvider
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

class LinuxNotifyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LinuxNotify")

    Function("setEnabled") { enabled: Boolean ->
      val context = appCtx() ?: return@Function null
      NotifyPoller.setEnabled(context, enabled)
      null
    }

    Function("setH3Enabled") { value: Boolean ->
      val context = appCtx() ?: return@Function null
      try {
        Class.forName("sb.linux.mobile.H3")
          .getMethod("setEnabled", Boolean::class.javaPrimitiveType)
          .invoke(null, value)
      } catch (_: Exception) {
        context.getSharedPreferences("lsb_access", Context.MODE_PRIVATE)
          .edit()
          .putBoolean("h3_first", value)
          .apply()
      }
      null
    }

    Function("h3Status") {
      try {
        Class.forName("sb.linux.mobile.H3").getMethod("statusText").invoke(null) as? String ?: ""
      } catch (_: Exception) {
        ""
      }
    }

    Function("crashLog") {
      try {
        Class.forName("sb.linux.mobile.CrashLog").getMethod("readText").invoke(null) as? String ?: ""
      } catch (_: Exception) {
        ""
      }
    }

    Function("clearCrashLog") {
      try {
        Class.forName("sb.linux.mobile.CrashLog").getMethod("clearAll").invoke(null)
      } catch (_: Exception) {
      }
      null
    }

    Function("hasNewCrashReport") {
      try {
        Class.forName("sb.linux.mobile.CrashLog").getMethod("hasNewReport").invoke(null) as? Boolean ?: false
      } catch (_: Exception) {
        false
      }
    }

    Function("markCrashLogAlive") {
      try {
        Class.forName("sb.linux.mobile.CrashLog").getMethod("markJsReady").invoke(null)
      } catch (_: Exception) {
      }
      null
    }

    Function("recordJsCrash") { text: String ->
      try {
        Class.forName("sb.linux.mobile.CrashLog").getMethod("appendJs", String::class.java).invoke(null, text)
      } catch (_: Exception) {
      }
      null
    }

    Function("cloudflareCookies") {
      try {
        Class.forName("sb.linux.mobile.CfChallenge").getMethod("cookieHeader").invoke(null) as? String ?: ""
      } catch (_: Exception) {
        ""
      }
    }

    AsyncFunction("passCloudflareChallenge") Coroutine { url: String ->
      withContext(Dispatchers.IO) {
        try {
          Class.forName("sb.linux.mobile.CfChallenge")
            .getMethod("pass", String::class.java)
            .invoke(null, url) as? String ?: ""
        } catch (_: Exception) {
          ""
        }
      }
    }

    Function("setAccessChannel") { channel: String ->
      val context = appCtx() ?: return@Function null
      try {
        val cls = Class.forName("sb.linux.mobile.LinuxAccess")
        cls.getMethod("setChannel", String::class.java).invoke(null, channel)
      } catch (_: Exception) {
        val value = if (channel == "direct") "direct" else "doh"
        context.getSharedPreferences("lsb_access", Context.MODE_PRIVATE)
          .edit()
          .putString("channel", value)
          .apply()
      }
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

    AsyncFunction("downloadApk") Coroutine { url: String, destPath: String ->
      withContext(Dispatchers.IO) {
        val dest = apkFile(destPath)
        dest.parentFile?.mkdirs()
        if (dest.exists()) dest.delete()
        val client = try {
          OkHttpClientProvider.getOkHttpClient().newBuilder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
        } catch (_: Exception) {
          OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .build()
        }
        val request = Request.Builder().url(url.trim()).build()
        client.newCall(request).execute().use { response ->
          if (!response.isSuccessful) throw Exception("下载失败 HTTP ${response.code}")
          val body = response.body ?: throw Exception("安装包为空")
          dest.outputStream().use { output -> body.byteStream().copyTo(output) }
        }
        if (!dest.exists() || dest.length() < 1024L * 1024L) {
          dest.delete()
          throw Exception("安装包不完整，请重试")
        }
        dest.toURI().toString()
      }
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
