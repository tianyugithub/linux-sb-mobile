package expo.modules.linuxnotify

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

object NotifyPoller {
  const val PREFS = "lsb_notify"
  const val KEY_ENABLED = "guard_enabled"
  const val KEY_COOKIE = "session_cookie"
  const val KEY_LAST_UNREAD = "last_unread"
  const val KEY_BASELINED = "baselined"

  const val ACTION_POLL = "sb.linux.mobile.NOTIFY_POLL"
  private const val CHANNEL = "linux-sb-messages"
  private const val ALARM_REQ = 56102
  private const val NOTICE_ID = 56103
  const val INTERVAL_MS = 4 * 60 * 1000L
  const val FIRST_DELAY_MS = 20_000L
  const val BOOT_DELAY_MS = 45_000L
  private const val ORIGIN = "https://linux.sb"
  private const val UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

  fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setEnabled(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
    if (!enabled) cancel(context)
  }

  fun setSession(context: Context, cookie: String, unread: Int? = null, baselined: Boolean? = null) {
    val editor = prefs(context).edit()
    if (cookie.isNotBlank()) editor.putString(KEY_COOKIE, cookie)
    else editor.remove(KEY_COOKIE)
    if (unread != null && unread >= 0) editor.putInt(KEY_LAST_UNREAD, unread)
    if (baselined != null) editor.putBoolean(KEY_BASELINED, baselined)
    editor.apply()
  }

  fun schedule(context: Context, delayMs: Long = INTERVAL_MS) {
    val app = context.applicationContext
    if (!prefs(app).getBoolean(KEY_ENABLED, false)) {
      cancel(app)
      return
    }
    val am = app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val trigger = SystemClock.elapsedRealtime() + delayMs.coerceAtLeast(5_000L)
    val pending = pending(app)
    try {
      if (Build.VERSION.SDK_INT >= 31 && am.canScheduleExactAlarms()) {
        am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pending)
      } else if (Build.VERSION.SDK_INT >= 23) {
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pending)
      } else {
        @Suppress("DEPRECATION")
        am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pending)
      }
    } catch (_: SecurityException) {
      if (Build.VERSION.SDK_INT >= 23) {
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pending)
      }
    }
  }

  fun cancel(context: Context) {
    val app = context.applicationContext
    val am = app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(pending(app))
  }

  fun runAsync(context: Context, done: (() -> Unit)? = null) {
    val app = context.applicationContext
    thread(name = "lsb-notify-poll") {
      val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
      val lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lsb:notify")
      lock.setReferenceCounted(false)
      try {
        lock.acquire(15_000)
        poll(app)
      } finally {
        if (lock.isHeld) lock.release()
        schedule(app, INTERVAL_MS)
        done?.invoke()
      }
    }
  }

  fun poll(context: Context) {
    val store = prefs(context)
    if (!store.getBoolean(KEY_ENABLED, false)) return
    val cookie = cookieHeader(context)
    if (cookie.isBlank()) return
    val unread = fetchUnread(cookie) ?: return
    val baselined = store.getBoolean(KEY_BASELINED, false)
    val last = if (store.contains(KEY_LAST_UNREAD)) store.getInt(KEY_LAST_UNREAD, 0) else null
    if (!baselined || last == null) {
      store.edit()
        .putInt(KEY_LAST_UNREAD, unread)
        .putBoolean(KEY_BASELINED, true)
        .apply()
      return
    }
    if (unread > last) present(context, unread)
    store.edit().putInt(KEY_LAST_UNREAD, unread).apply()
  }

  private fun cookieHeader(context: Context): String {
    return prefs(context).getString(KEY_COOKIE, "").orEmpty().trim()
  }

  private fun fetchUnread(cookie: String): Int? {
    val endpoints = listOf(
      "$ORIGIN/notification_live_badge_status" to "application/json",
      "$ORIGIN/" to "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    )
    val client = notifyClient()
    for ((url, accept) in endpoints) {
      try {
        val body = if (client != null) {
          val request = Request.Builder()
            .url(url)
            .header("Cookie", cookie)
            .header("User-Agent", UA)
            .header("Accept", accept)
            .header("Accept-Language", "zh-CN,zh;q=0.9")
            .header("Referer", "$ORIGIN/")
            .header("X-Requested-With", "XMLHttpRequest")
            .build()
          client.newCall(request).execute().use { response ->
            response.body?.string().orEmpty()
          }
        } else {
          val conn = URL(url).openConnection() as HttpURLConnection
          conn.connectTimeout = 8_000
          conn.readTimeout = 8_000
          conn.instanceFollowRedirects = true
          conn.requestMethod = "GET"
          conn.setRequestProperty("Cookie", cookie)
          conn.setRequestProperty("User-Agent", UA)
          conn.setRequestProperty("Accept", accept)
          conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9")
          conn.setRequestProperty("Referer", "$ORIGIN/")
          conn.setRequestProperty("X-Requested-With", "XMLHttpRequest")
          val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
          val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
          conn.disconnect()
          text
        }
        parseUnread(body)?.let { return it }
      } catch (_: Exception) {
        /* try next endpoint */
      }
    }
    return null
  }

  private fun notifyClient(): OkHttpClient? {
    return try {
      OkHttpClientProvider.getOkHttpClient().newBuilder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    } catch (_: Exception) {
      null
    }
  }

  private fun parseUnread(body: String): Int? {
    val text = body.trim()
    if (text.startsWith("{")) {
      try {
        val json = JSONObject(text)
        for (key in listOf("unread", "count", "unread_count")) {
          if (!json.has(key)) continue
          val n = json.optInt(key, -1)
          if (n >= 0) return n
        }
      } catch (_: Exception) {
        /* fall through to HTML */
      }
    }
    Regex("""aria-label="(\d+)\s*条未读通知"""").find(text)?.groupValues?.getOrNull(1)?.toIntOrNull()?.let { return it }
    Regex("""class="(?:notify-badge|mobile-nav-unread)"[^>]*>\s*(9\+|\d+)""").find(text)?.groupValues?.getOrNull(1)?.let { raw ->
      return if (raw == "9+") 10 else raw.toIntOrNull()
    }
    return null
  }

  private fun present(context: Context, unread: Int) {
    if (Build.VERSION.SDK_INT >= 33) {
      val ok = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
      if (ok != PackageManager.PERMISSION_GRANTED) return
    }
    ensureChannel(context)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_VIEW, Uri.parse(ORIGIN)).setPackage(context.packageName)
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val tap = PendingIntent.getActivity(
      context,
      NOTICE_ID,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val icon = context.resources.getIdentifier("ic_linux_sb", "mipmap", context.packageName)
      .takeIf { it != 0 }
      ?: android.R.drawable.stat_notify_chat
    val body = if (unread <= 1) "你有 1 条新消息" else "你有 ${unread} 条未读消息"
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(icon)
      .setContentTitle("LINUX SB")
      .setContentText(body)
      .setContentIntent(tap)
      .setAutoCancel(true)
      .setOnlyAlertOnce(false)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setNumber(unread)
      .build()
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTICE_ID, notification)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, "社区消息", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "回复、提及、打赏和系统通知"
        enableVibration(true)
        setShowBadge(true)
      },
    )
  }

  private fun pending(context: Context): PendingIntent {
    val intent = Intent(context, NotifyAlarmReceiver::class.java).setAction(ACTION_POLL)
    return PendingIntent.getBroadcast(
      context,
      ALARM_REQ,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
