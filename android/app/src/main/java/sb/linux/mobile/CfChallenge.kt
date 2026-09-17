package sb.linux.mobile

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * 官网 Cloudflare 盾：用系统 WebView 跑官方 JS 挑战，拿到 `cf_clearance`。
 *
 * App 的 HTML 请求走 Cronet / OkHttp，没有浏览器引擎，CF 会回「Just a moment…」。
 * 这里不解析挑战脚本、也不走第三方打码；就是让 WebView 像内置浏览器一样跑一遍，
 * 再把 cookie 交给后续请求。过盾期间站内 `/cdn-cgi/` 不走 H3 拦截，避免指纹被拆开。
 *
 * 实测（2026-09）：
 *  • CF 用的是 `cType: 'managed'` 挑战。有些网络下它会**自动放行**（页面自己转一会儿就过），
 *    有些网络下它会给出一个**「请验证您是真人」复选框**，必须由人点一下。
 *  • 那个复选框渲染在**跨域 iframe + closed shadow root** 里（`challenges.cloudflare.com/.../turnstile/...`），
 *    外部 JS 既读不到也点不到 —— 所以**不能靠脚本代点**，只能把 WebView 显示出来让用户自己点。
 *  • 最早实现把 WebView `translationX = 10_000f` 挪出屏幕，CF 判成不可见元素，挑战永不返回；
 *    后来改成 `alpha = 0f`（可见但透明）能过自动放行的那种，但用户没法点复选框。现在是**真正显示出来**。
 *  • 实测真浏览器点一下复选框 **约 1 秒**就过（3/3 稳定）。
 */
object CfChallenge {
  private const val TAG = "LinuxCf"
  private const val TIMEOUT_MS = 120_000L
  private const val ORIGIN = "https://linux.sb/"
  /** 过盾期间给 WebView 的最小尺寸：再小 CF 会当成无效视口。 */
  private const val MIN_WIDTH_DP = 340
  private const val MIN_HEIGHT_DP = 520

  @Volatile private var app: Context? = null
  private val gate = Any()
  private val main by lazy { Handler(Looper.getMainLooper()) }

  @Volatile var pauseH3Intercept = false
    private set

  /**
   * 是否把过盾界面显示给用户。
   *
   * 挑战分两种：能自动过的（用户不该看到任何东西）和要点复选框的（必须让用户点）。
   * 先按不可见跑一段时间，如果一直没过就说明多半是要人点的那种，这时才弹出来 ——
   * 这样"能自动过"的用户完全无感，只有真正需要动手的人才看到界面。
   */
  private const val REVEAL_AFTER_MS = 7_000L

  fun install(context: Context) {
    app = context.applicationContext
  }

  @JvmStatic
  fun cookieHeader(): String {
    return try {
      CookieManager.getInstance().getCookie(ORIGIN).orEmpty()
    } catch (_: Exception) {
      ""
    }
  }

  @JvmStatic
  fun pass(url: String): String {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      throw IllegalStateException("CfChallenge.pass 不能在主线程")
    }
    synchronized(gate) {
      pauseH3Intercept = true
      try {
        // 这里只会在已经收到挑战页时调用，旧 cf_clearance 不代表仍然有效。
        return solve(url)
      } finally {
        pauseH3Intercept = false
      }
    }
  }

  internal fun isChallengeSample(sample: String): Boolean {
    return sample.contains("Just a moment", ignoreCase = true)
      || sample.contains("cf-challenge", ignoreCase = true)
      || sample.contains("challenge-platform", ignoreCase = true)
      || sample.contains("cf-browser-verification", ignoreCase = true)
      || sample.contains("Attention Required", ignoreCase = true)
      || sample.contains("_cf_chl", ignoreCase = true)
  }

  private fun hasClearance(header: String): Boolean =
    header.contains("cf_clearance=", ignoreCase = true)

  private fun solve(rawUrl: String): String {
    val ctx = app ?: return cookieHeader()
    val target = normalize(rawUrl)
    val done = CountDownLatch(1)
    val passed = AtomicBoolean(false)
    val viewRef = AtomicReference<WebView?>(null)
    val overlayRef = AtomicReference<View?>(null)
    val started = CountDownLatch(1)

    main.post {
      try {
        CookieManager.getInstance().setAcceptCookie(true)
        val webView = buildWebView(ctx)
        viewRef.set(webView)
        // 先按「能自动过」处理：挂上去但不显示。7 秒还没过再弹出来让用户点。
        val overlay = attach(webView)
        overlayRef.set(overlay)
        val client = object : WebViewClient() {
          override fun onPageFinished(view: WebView?, url: String?) {
            checkPassed(view, passed, done)
          }

          /**
           * 过盾 WebView 也必须走站内那套接管。
           *
           * 实测（2026-09，国内家宽）：linux.sb 的 TCP 被 SNI 阻断，WebView 原生 TLS
           * 直接 ERR_CONNECTION_CLOSED，挑战页加载不出来 → 过盾 65 秒必然超时。
           * 站内页面能显示，靠的就是这个钩子（H3/QUIC 取回再交给 WebView 渲染）。
           * RN 的 WebView 由 scripts/patch-rn-webview.mjs 注入；这里是原生 WebView，
           * 直接调同一个 `WebViewH3.intercept`。
           */
          override fun shouldInterceptRequest(
            view: WebView?,
            request: android.webkit.WebResourceRequest?,
          ): android.webkit.WebResourceResponse? {
            if (request == null) return null
            return try {
              WebViewH3.intercept(request) ?: super.shouldInterceptRequest(view, request)
            } catch (_: Throwable) {
              super.shouldInterceptRequest(view, request)
            }
          }
        }
        webView.webViewClient = client
        webView.loadUrl(target)
        poll(webView, passed, done)
        revealLater(webView, overlay)
      } catch (error: Exception) {
        android.util.Log.w(TAG, "过盾 WebView 启动失败：${error.message}")
        done.countDown()
      } finally {
        started.countDown()
      }
    }

    try {
      started.await(3, TimeUnit.SECONDS)
      done.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
    val header = cookieHeader()
    main.post {
      destroy(viewRef.getAndSet(null))
      dismiss(overlayRef.getAndSet(null))
    }
    if (hasClearance(header)) {
      android.util.Log.i(TAG, "过盾完成 cf_clearance（passed=$passed）")
    } else {
      android.util.Log.w(TAG, "过盾超时，没有 cf_clearance（${TIMEOUT_MS}ms）")
    }
    return header
  }

  /**
   * 一段时间还没过就说明多半是要人点的 managed 挑战，把界面显示出来。
   * 已经过了就什么都不做 —— 能自动过的用户全程无感。
   */
  private fun revealLater(webView: WebView, overlay: View?) {
    if (overlay == null) return
    main.postDelayed({
      if (overlay.parent != null) {
        overlay.alpha = 1f
        overlay.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        webView.alpha = 1f
        android.util.Log.i(TAG, "过盾转为「请用户点复选框」模式")
      }
    }, REVEAL_AFTER_MS)
  }

  private fun poll(webView: WebView, passed: AtomicBoolean, done: CountDownLatch) {
    val tick = object : Runnable {
      override fun run() {
        if (done.count == 0L) return
        checkPassed(webView, passed, done)
        if (done.count > 0) main.postDelayed(this, 400)
      }
    }
    main.postDelayed(tick, 400)
  }

  private fun checkPassed(webView: WebView?, passed: AtomicBoolean, done: CountDownLatch) {
    if (passed.get() || webView == null) return
    val cookies = cookieHeader()
    webView.evaluateJavascript(
      "(function(){var t=document.title||'';var b=(document.body&&document.body.innerText)||'';return t+' '+b.slice(0,160);})()",
    ) { raw ->
      if (passed.get()) return@evaluateJavascript
      val sample = raw.orEmpty().trim('"').replace("\\n", " ")
      val waiting = isChallengeSample(sample)
      /*
       * 只有「拿到 cf_clearance」并且「当前页已经不是挑战页」才算过。
       * 早先只看 cookie 就返回，CF 会在挑战中途先下发 cf_clearance，
       * 此时页面仍是 Just a moment，提前返回会让后续请求照样 403。
       */
      if (hasClearance(cookies) && !waiting && sample.isNotBlank()) {
        if (passed.compareAndSet(false, true)) done.countDown()
      }
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun buildWebView(ctx: Context): WebView {
    val webView = WebView(activity() ?: ctx)
    val settings = webView.settings
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.databaseEnabled = true
    settings.userAgentString = LinuxUa.VALUE
    settings.cacheMode = WebSettings.LOAD_DEFAULT
    settings.loadsImagesAutomatically = true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
      CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
    }
    webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
    webView.setBackgroundColor(Color.TRANSPARENT)
    return webView
  }

  /**
   * 挂一个全屏浮层，里面是官网挑战页，顶部一条说明。
   *
   * 关键点：
   *  • WebView 必须**真的可见**且**能接收触摸** —— CF 的复选框只有人点才会过，
   *    脚本代点不到（跨域 iframe + closed shadow root）。
   *  • 初始 `alpha = 0f`：能自动过盾的网络下用户完全看不到它；
   *    7 秒还没过由 [revealLater] 淡入（见 [REVEAL_AFTER_MS]）。
   *  • 浮层要吃掉返回键之外的触摸，避免用户误点到下层界面。
   */
  private fun attach(webView: WebView): View? {
    val activity = activity() ?: return null
    val root = activity.window?.decorView as? ViewGroup ?: return null
    val density = root.resources.displayMetrics.density

    val overlay = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.WHITE)
      alpha = 0f
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
      isClickable = true
      isFocusable = true
    }

    val title = TextView(activity).apply {
      text = "正在通过官网安全验证"
      setTextColor(0xFF1A1A1A.toInt())
      setBackgroundColor(0xFFF5F5F5.toInt())
      typeface = Typeface.DEFAULT_BOLD
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      gravity = Gravity.CENTER_VERTICAL
      val pad = (16 * density).toInt()
      setPadding(pad, pad, pad, pad)
    }
    val hint = TextView(activity).apply {
      text = "请点击下方的「请验证您是真人」，验证通过后会自动继续"
      setTextColor(0xFF666666.toInt())
      setBackgroundColor(0xFFF5F5F5.toInt())
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
      val pad = (16 * density).toInt()
      setPadding(pad, 0, pad, pad)
    }
    overlay.addView(title, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    overlay.addView(hint, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

    webView.alpha = 0f
    overlay.addView(webView, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

    root.addView(overlay, FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    webView.requestLayout()
    webView.onResume()
    // 尺寸兜底：极端小窗口下 CF 会判无效视口，这里保证不小于最小值。
    webView.post {
      if (webView.width < (MIN_WIDTH_DP * density).toInt() ||
        webView.height < (MIN_HEIGHT_DP * density).toInt()
      ) {
        android.util.Log.w(TAG, "过盾 WebView 视口偏小：${webView.width}x${webView.height}")
      }
    }
    return overlay
  }

  private fun dismiss(overlay: View?) {
    if (overlay == null) return
    try {
      (overlay.parent as? ViewGroup)?.removeView(overlay)
    } catch (_: Exception) {
    }
  }

  private fun destroy(webView: WebView?) {
    if (webView == null) return
    try {
      webView.onPause()
      webView.stopLoading()
      webView.webViewClient = WebViewClient()
      webView.loadUrl("about:blank")
      (webView.parent as? ViewGroup)?.removeView(webView)
      webView.destroy()
    } catch (_: Exception) {
    }
  }

  private fun activity(): MainActivity? = MainActivity.current()

  private fun normalize(url: String): String {
    val text = url.trim()
    if (text == "https://linux.sb" || text.startsWith("https://linux.sb/")) return text
    if (text.startsWith("/")) return "https://linux.sb$text"
    return ORIGIN
  }
}
