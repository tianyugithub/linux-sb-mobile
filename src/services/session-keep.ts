/**
 * 登录态保活：哪些 HTML / cookie 变化足以把本地会话清掉。
 *
 * 官网没有独立的 session API。以前用首页 `nav-mine-guest` 当「已退出」，
 * 但 `/` 走镜像时经常被缓存成游客页，而 cookie 里的 `bbs_auth` 还在。
 * 一次误判就会 destroy 会话、persist 把磁盘写成空，下次进来就是未登录。
 */

export function hasBbsAuth(jar: string | null | undefined): boolean {
  return /(?:^|;\s*)bbs_auth=([^\s;]+)/i.test(jar ?? '');
}

/** 新 jar 丢掉了 bbs_auth 时，把旧的接回去（CDN / 游客页的 Set-Cookie 经常这样）。 */
export function keepAuthCookie(next: string, previous: string): string {
  if (hasBbsAuth(next) || !hasBbsAuth(previous)) return next;
  const auth = previous
    .split(';')
    .map((item) => item.trim())
    .find((item) => /^bbs_auth=/i.test(item));
  if (!auth) return next;
  const base = next.replace(/;\s*$/, '').trim();
  return base ? `${base}; ${auth}` : auth;
}

export function isChallengeHtml(html: string): boolean {
  return /just a moment|cf-browser-verification|challenge-platform|cf-challenge|attention required/i.test(html);
}

function parseNavUserId(html: string): string | null {
  const mine = html.match(/class="nav-mine(?![^"]*guest)[^"]*"[^>]*href="\/user\/(\d+)/)
    || html.match(/href="\/user\/(\d+)"[^>]*class="[^"]*nav-mine(?![^"]*guest)/);
  if (mine?.[1]) return mine[1];
  const menu = html.match(/我的菜单[\s\S]{0,1200}?href="\/user\/(\d+)/);
  return menu?.[1] ?? null;
}

function isLoginWallHtml(html: string): boolean {
  return /<title>登录/.test(html) && !html.includes('class="post-list"');
}

function isLoginFormHtml(html: string): boolean {
  return Boolean(
    /name="_csrf"/.test(html)
    && /name="username"/.test(html)
    && /name="password"/.test(html)
    && !/name="password2"/.test(html),
  );
}

/** 官方 `/mobile_menu` 游客段：我的菜单里只有登录/注册，没有 `/user/id`。 */
function isGuestMineMenu(html: string): boolean {
  const section = html.match(/<h3>\s*我的菜单\s*<\/h3>([\s\S]*?)<\/section>/);
  if (!section) return false;
  const body = section[1];
  return /href="\/login"/.test(body) && !/href="\/user\/\d+"/.test(body);
}

export type SessionLook = 'logged-in' | 'logged-out' | 'unknown';

export function pageSessionLook(html: string): SessionLook {
  if (!html.trim() || isChallengeHtml(html)) return 'unknown';
  if (parseNavUserId(html)) return 'logged-in';
  if (isLoginWallHtml(html) || /nav-mine-guest/.test(html) || isLoginFormHtml(html) || isGuestMineMenu(html)) {
    return 'logged-out';
  }
  return 'unknown';
}

/**
 * 是否把本地会话清掉。
 *
 * - 任一页能认出登录用户 → 保留
 * - 挑战页 / 空页 / 认不出来 → 保留（网络或镜像抽风）
 * - 两页都明确是游客皮 → 官网已经不认这张 cookie，可以清
 */
export function decideSessionRefresh(primary: SessionLook, confirm: SessionLook | null): 'ok' | 'keep' | 'drop' {
  if (primary === 'logged-in' || confirm === 'logged-in') return 'ok';
  if (primary === 'unknown' || confirm == null || confirm === 'unknown') return 'keep';
  return 'drop';
}

export function pickPersistRecord<T extends { cookies: string }>(
  sessions: Record<string, T>,
  token: string | null,
): T | null {
  if (token && sessions[token]) return sessions[token];
  const all = Object.values(sessions);
  return all.find((item) => hasBbsAuth(item.cookies)) ?? all.at(-1) ?? null;
}

/** 本地 refresh token 对不上时，还留着 bbs_auth 就不要把磁盘清掉。 */
export function shouldClearSessionOnRefreshFailure(opts: {
  signedOut: boolean;
  hasAuthCookie: boolean;
}): boolean {
  if (opts.signedOut) return true;
  if (opts.hasAuthCookie) return false;
  return true;
}

/**
 * 退出后的善后（延迟清 CookieManager、后台 POST /logout）只能跟着「这一次退出」。
 *
 * 实测：登录 → 切通道 → 退出 → 再切回来 → 马上再登录。退出时挂起的
 * GET / + POST /logout 还在飞（切通道会 evict 连接、DoH/QUIC 更慢），
 * 登录成功后才落到官网，把刚发的 bbs_auth 作废，界面就跳回未登录。
 */
export function shouldFollowThroughSignedOutWork(opts: {
  startedGeneration: number;
  currentGeneration: number;
  signedOut: boolean;
}): boolean {
  return opts.signedOut && opts.startedGeneration === opts.currentGeneration;
}
