package sb.linux.mobile

/**
 * 官网请求、Cronet、过盾 WebView 必须用同一条 UA。
 * Cloudflare 的 `cf_clearance` 会绑 UA；JS 侧常量在 `src/utils/linux-access.ts`。
 */
object LinuxUa {
  const val VALUE =
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
}
