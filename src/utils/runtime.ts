export function isNativeApp(): boolean {
  return typeof navigator !== 'undefined' && (navigator as { product?: string }).product === 'ReactNative';
}

/**
 * 一律 omit：cookie 只走我们自己塞的 `Cookie` 头（JS jar），
 * 不让 OkHttp / CookieManager 偷偷存 Set-Cookie。
 * 以前 native 用 include，退出后飞着的请求把 bbs_auth 写回系统，
 * 冷启动再按网页 cookie 自动登回去。
 */
export function siteCredentials(): RequestCredentials {
  return 'omit';
}
