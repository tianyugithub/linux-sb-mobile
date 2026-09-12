package sb.linux.mobile

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 本机崩溃日志。不上传。
 *
 * 闪退当时进程已经没了，不能指望用户再点进「关于项目」。
 * 下次 [install] 一跑（还在 WebView 代理之前）就把记录落到
 * 系统「下载 / LINUX-SB-崩溃日志.txt」。能打开 App 时首页直接弹复制；
 * 一直打不开就用文件管理去下载目录拿。
 */
object CrashLog {
  private const val LOG = "crash-log.txt"
  private const val BOOT = "crash-boot.txt"
  private const val PUBLIC_NAME = "LINUX-SB-崩溃日志.txt"
  private const val PREFS = "lsb_crash"
  private const val KEY_EXIT = "last_exit_stamp"
  private const val MAX_BYTES = 48 * 1024

  @Volatile private var app: Context? = null
  @Volatile private var newThisLaunch = false

  fun install(context: Context) {
    val ctx = context.applicationContext
    app = ctx
    try {
      recordIncompleteBoot(ctx)
      markBoot(ctx, "onCreate")
      recordProcessExits(ctx)
    } catch (_: Exception) {
    }
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      append(ctx, "uncaught", "thread=${thread.name}\n${error.stackTraceToString()}")
      if (previous != null) previous.uncaughtException(thread, error)
      else throw error
    }
  }

  fun markNativeStarted() {
    app?.let { markBoot(it, "native-started") }
  }

  @JvmStatic
  fun markJsReady() {
    val ctx = app ?: return
    clearBoot(ctx)
  }

  @JvmStatic
  fun readText(): String {
    val ctx = app ?: return ""
    return try {
      logFile(ctx).takeIf { it.exists() }?.readText().orEmpty()
    } catch (_: Exception) {
      ""
    }
  }

  @JvmStatic
  fun hasNewReport(): Boolean = newThisLaunch && readText().isNotBlank()

  @JvmStatic
  fun clearAll() {
    val ctx = app ?: return
    newThisLaunch = false
    try {
      logFile(ctx).delete()
    } catch (_: Exception) {
    }
    clearBoot(ctx)
    try {
      ctx.getExternalFilesDir(null)?.let { File(it, LOG).delete() }
    } catch (_: Exception) {
    }
    try {
      deleteDownloads(ctx)
    } catch (_: Exception) {
    }
  }

  @JvmStatic
  fun appendJs(text: String) {
    val ctx = app ?: return
    append(ctx, "js", text)
  }

  fun caught(kind: String, error: Throwable) {
    val ctx = app ?: return
    append(ctx, kind, error.stackTraceToString())
  }

  internal fun scrub(text: String): String {
    return text
      .replace(Regex("bbs_auth=[^;\\s]+", RegexOption.IGNORE_CASE), "bbs_auth=***")
      .replace(Regex("bbs_csrf=[^;\\s]+", RegexOption.IGNORE_CASE), "bbs_csrf=***")
      .replace(Regex("(?i)Authorization:\\s*\\S+"), "Authorization: ***")
  }

  private fun recordIncompleteBoot(ctx: Context) {
    val leftover = readBoot(ctx)
    clearBoot(ctx)
    if (leftover.isBlank()) return
    append(ctx, "incomplete-boot", "上次启动没有走完（多半是原生闪退）：\n$leftover")
  }

  private fun readBoot(ctx: Context): String {
    val internal = try {
      bootFile(ctx).takeIf { it.exists() }?.readText().orEmpty().trim()
    } catch (_: Exception) {
      ""
    }
    if (internal.isNotBlank()) return internal
    return try {
      ctx.getExternalFilesDir(null)?.let { File(it, BOOT).takeIf { f -> f.exists() }?.readText() }
        .orEmpty().trim()
    } catch (_: Exception) {
      ""
    }
  }

  private fun clearBoot(ctx: Context) {
    try {
      bootFile(ctx).delete()
    } catch (_: Exception) {
    }
    try {
      ctx.getExternalFilesDir(null)?.let { File(it, BOOT).delete() }
    } catch (_: Exception) {
    }
  }

  private fun markBoot(ctx: Context, stage: String) {
    val line = "${now()} $stage v${versionName(ctx)} (${versionCode(ctx)})"
    try {
      bootFile(ctx).writeText(line)
    } catch (_: Exception) {
    }
    try {
      ctx.getExternalFilesDir(null)?.let { File(it, BOOT).writeText(line) }
    } catch (_: Exception) {
    }
  }

  private fun recordProcessExits(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return
    val exits = try {
      am.getHistoricalProcessExitReasons(ctx.packageName, 0, 3)
    } catch (_: Exception) {
      return
    }
    if (exits.isNullOrEmpty()) return
    val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val seen = prefs.getLong(KEY_EXIT, 0L)
    var newest = seen
    val chunks = ArrayList<String>()
    for (info in exits) {
      val stamp = info.timestamp
      if (stamp <= seen) continue
      if (stamp > newest) newest = stamp
      chunks += formatExit(info)
    }
    if (newest != seen) prefs.edit().putLong(KEY_EXIT, newest).apply()
    if (chunks.isEmpty()) return
    append(ctx, "process-exit", chunks.joinToString("\n\n"))
  }

  private fun formatExit(info: ApplicationExitInfo): String {
    val reason = when (info.reason) {
      ApplicationExitInfo.REASON_CRASH -> "Java 崩溃"
      ApplicationExitInfo.REASON_CRASH_NATIVE -> "原生闪退"
      ApplicationExitInfo.REASON_ANR -> "无响应"
      ApplicationExitInfo.REASON_SIGNALED -> "信号杀死"
      ApplicationExitInfo.REASON_LOW_MEMORY -> "内存不足"
      else -> "reason=${info.reason}"
    }
    val trace = try {
      info.traceInputStream?.bufferedReader()?.use { it.readText() }.orEmpty()
    } catch (_: Exception) {
      ""
    }
    val clipped = if (trace.length > 8_000) trace.take(8_000) + "\n…(截断)" else trace
    return buildString {
      append(now(info.timestamp))
      append(" ")
      append(reason)
      append(" pid=")
      append(info.pid)
      append(" status=")
      append(info.status)
      val desc = info.description.orEmpty()
      if (desc.isNotBlank()) {
        append("\n")
        append(desc)
      }
      if (clipped.isNotBlank()) {
        append("\n")
        append(clipped.trim())
      }
    }
  }

  private fun append(ctx: Context, kind: String, body: String) {
    val block = buildString {
      append("===== ")
      append(now())
      append(" =====\n")
      append("version ")
      append(versionName(ctx))
      append(" (")
      append(versionCode(ctx))
      append(")\n")
      append("kind ")
      append(kind)
      append("\n")
      append(scrub(body).trim())
      append("\n\n")
    }
    val snapshot = try {
      synchronized(this) {
        val file = logFile(ctx)
        val prev = if (file.exists()) file.readText() else ""
        var next = prev + block
        if (next.length > MAX_BYTES) next = next.takeLast(MAX_BYTES)
        file.writeText(next)
        next
      }
    } catch (_: Exception) {
      block
    }
    newThisLaunch = true
    publishVisible(ctx, snapshot)
  }

  private fun publishVisible(ctx: Context, text: String) {
    try {
      ctx.getExternalFilesDir(null)?.let { File(it, LOG).writeText(text) }
    } catch (_: Exception) {
    }
    try {
      writeDownloads(ctx, text)
    } catch (_: Exception) {
    }
  }

  private fun writeDownloads(ctx: Context, text: String) {
    val bytes = text.toByteArray(Charsets.UTF_8)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val resolver = ctx.contentResolver
      val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
      deleteDownloads(ctx)
      val pending = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, PUBLIC_NAME)
        put(MediaStore.Downloads.MIME_TYPE, "text/plain")
        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        put(MediaStore.Downloads.IS_PENDING, 1)
      }
      val uri = resolver.insert(collection, pending) ?: return
      resolver.openOutputStream(uri)?.use { it.write(bytes) }
      val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
      resolver.update(uri, done, null, null)
      return
    }
    @Suppress("DEPRECATION")
    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    if (!dir.exists()) dir.mkdirs()
    File(dir, PUBLIC_NAME).writeBytes(bytes)
  }

  private fun deleteDownloads(ctx: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val resolver = ctx.contentResolver
      val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
      resolver.query(
        collection,
        arrayOf(MediaStore.Downloads._ID),
        "${MediaStore.Downloads.DISPLAY_NAME}=?",
        arrayOf(PUBLIC_NAME),
        null,
      )?.use { cursor ->
        while (cursor.moveToNext()) {
          val id = cursor.getLong(0)
          resolver.delete(ContentUris.withAppendedId(collection, id), null, null)
        }
      }
      return
    }
    @Suppress("DEPRECATION")
    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    File(dir, PUBLIC_NAME).delete()
  }

  private fun logFile(ctx: Context) = File(ctx.filesDir, LOG)
  private fun bootFile(ctx: Context) = File(ctx.filesDir, BOOT)

  private fun now(at: Long = System.currentTimeMillis()): String {
    return SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date(at))
  }

  private fun versionName(ctx: Context): String = try {
    ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "?"
  } catch (_: Exception) {
    "?"
  }

  private fun versionCode(ctx: Context): Int = try {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      ctx.packageManager.getPackageInfo(ctx.packageName, 0).longVersionCode.toInt()
    } else {
      @Suppress("DEPRECATION")
      ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionCode
    }
  } catch (_: Exception) {
    0
  }
}
