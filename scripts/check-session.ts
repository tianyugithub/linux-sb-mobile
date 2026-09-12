/**
 * 登录态保活回归。
 *
 * 覆盖三层：
 * 1. 纯函数（游客首页不得单独清盘、bbs_auth 保留）
 * 2. 官网真实 HTML（`/mobile_menu` 游客段没有 nav-mine-guest）
 * 3. stub 掉 fetch 后走完整 `GET /users/me`：镜像吐游客皮时会话还在
 *
 * 跑法：node scripts/run-stubbed.mjs scripts/check-session.ts
 */
import {
  decideSessionRefresh,
  hasBbsAuth,
  keepAuthCookie,
  pageSessionLook,
  pickPersistRecord,
  shouldClearSessionOnRefreshFailure,
  shouldFollowThroughSignedOutWork,
} from '../src/services/session-keep';
import { handleAuthRequest } from '../src/services/upstream-auth';
import {
  destroyUpstreamSession,
  restoreSiteSession,
  sessionForToken,
  updateUpstreamCookies,
} from '../src/services/site-session';
import { getAccessToken, hydrateSession, markSignedOut, setSession } from '../src/services/session';
import { secureGet } from '../src/services/secure-value';

let failed = 0;
function check(label: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
}

const guestHome = `<title>LINUX SB - 人人都有饼吃的AI社区！</title>
<div class="post-list"></div>
<a class="nav-mine nav-mine-guest" href="/login">登录</a>
<a href="/register">注册</a>`;

/** 2026-09-11 从 https://linux.sb/mobile_menu 游客抓到的原文 */
const officialGuestMenu = `<section class="mobile-menu-section"><h3>版块列表</h3><nav class="mobile-menu-links"><a class="mobile-menu-link" href="/">全部</a></nav></section><section class="mobile-menu-section"><h3>我的菜单</h3><nav class="mobile-menu-links"><a class="mobile-menu-link" href="/login">登录</a><a class="mobile-menu-link" href="/register">注册</a></nav></section><section class="mobile-menu-section"><h3>快捷功能</h3><nav class="mobile-menu-links"><a class="mobile-menu-link" href="/color_scheme">切换色系</a></nav></section>`;

/** 登录后 `/mobile_menu` 的「我的菜单」段（用户 id 换成固定夹具） */
const officialLoggedMenu = `<section class="mobile-menu-section"><h3>我的菜单</h3><nav class="mobile-menu-links"><a class="mobile-menu-link" href="/user/42">我的主页</a><a class="mobile-menu-link" href="/user/42?tab=topics">我的主题</a><a class="mobile-menu-link" href="/profile">个人设置</a></nav></section>`;

const loginWall = `<title>登录 - LINUX SB - 人人都有饼吃的AI社区！</title>
<a class="nav-mine nav-mine-guest" href="/login">登录</a>
<form><input name="_csrf" value="x"><input name="username"><input name="password"></form>`;

const composePage = `<title>发表主题 - LINUX SB</title>
<a class="nav-mine" href="/user/42">我的</a>
<form><input name="_csrf"><input name="title"></form>`;

const challenge = `<title>Just a moment...</title><div class="cf-challenge"></div>`;

const USER = {
  id: '42',
  name: 'tester',
  title: '饼友',
  group: '饼友' as const,
  groupLabel: '饼友',
  points: 10,
  uid: '42',
  avatar: 'T',
  accent: '#222A38',
  bio: '',
  topicCount: 0,
  replyCount: 0,
  joinedAt: '2024-01',
};

console.log('1) 页面形态');
check('游客首页认成 logged-out', pageSessionLook(guestHome) === 'logged-out');
check('官网游客菜单认成 logged-out（没有 nav-mine-guest）', pageSessionLook(officialGuestMenu) === 'logged-out');
check('登录后菜单认成 logged-in', pageSessionLook(officialLoggedMenu) === 'logged-in');
check('登录墙认成 logged-out', pageSessionLook(loginWall) === 'logged-out');
check('发帖页认成 logged-in', pageSessionLook(composePage) === 'logged-in');
check('挑战页认成 unknown', pageSessionLook(challenge) === 'unknown');
check('空页认成 unknown', pageSessionLook('   ') === 'unknown');

console.log('2) 清盘决策');
check('游客皮但还没确认 → 保留', decideSessionRefresh('logged-out', null) === 'keep');
check('菜单游客 + 发帖页仍登录 → 保留', decideSessionRefresh('logged-out', 'logged-in') === 'ok');
check('菜单游客 + 挑战页 → 保留', decideSessionRefresh('logged-out', 'unknown') === 'keep');
check('菜单游客 + 登录墙 → 可以清盘', decideSessionRefresh('logged-out', 'logged-out') === 'drop');
check('菜单已登录 → 不必再确认', decideSessionRefresh('logged-in', null) === 'ok');

console.log('3) cookie 保活');
const prev = 'bbs_csrf=a; bbs_auth=secret; other=1';
const guestJar = 'bbs_csrf=b; __online_users=1';
check('hasBbsAuth 认得到', hasBbsAuth(prev) && !hasBbsAuth(guestJar));
check(
  '游客 Set-Cookie 不得把 bbs_auth 抹掉',
  keepAuthCookie(guestJar, prev).includes('bbs_auth=secret') && keepAuthCookie(guestJar, prev).includes('bbs_csrf=b'),
);
check('新 jar 自己带着 bbs_auth 时用新的', keepAuthCookie('bbs_auth=new', prev) === 'bbs_auth=new');

const token = 'lsb.now';
const guestSession = { cookies: 'bbs_csrf=x', user: { id: '0' } };
const liveSession = { cookies: 'bbs_auth=keep', user: { id: '42' } };
check('persist 优先当前 token', pickPersistRecord({ [token]: liveSession, other: guestSession }, token) === liveSession);
check(
  'token 对不上时不要拿最后一条游客会话',
  pickPersistRecord({ a: guestSession, b: liveSession }, 'missing') === liveSession,
);
check('快照空时不写盘（保留磁盘）', pickPersistRecord({}, token) === null);
check(
  'refresh 失败但磁盘还有 bbs_auth → 不清盘',
  shouldClearSessionOnRefreshFailure({ signedOut: false, hasAuthCookie: true }) === false,
);
check(
  '用户点了退出 → refresh 失败也清盘',
  shouldClearSessionOnRefreshFailure({ signedOut: true, hasAuthCookie: true }) === true,
);
check(
  'cookie 没了才清盘',
  shouldClearSessionOnRefreshFailure({ signedOut: false, hasAuthCookie: false }) === true,
);
check(
  '退出善后：仍是这一次退出才继续',
  shouldFollowThroughSignedOutWork({ startedGeneration: 3, currentGeneration: 3, signedOut: true }) === true,
);
check(
  '退出善后：已经重新登录就停',
  shouldFollowThroughSignedOutWork({ startedGeneration: 3, currentGeneration: 4, signedOut: false }) === false,
);
check(
  '退出善后：generation 变了，旧的 POST /logout 停',
  shouldFollowThroughSignedOutWork({ startedGeneration: 3, currentGeneration: 4, signedOut: true }) === false,
);

type Pages = Record<string, { html: string; setCookie?: string }>;
let pages: Pages = {};
const hits: string[] = [];
let mockEnabled = false;
const realFetch = globalThis.fetch.bind(globalThis);

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
  try {
    return new URL(raw).pathname;
  } catch {
    return raw;
  }
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!mockEnabled) return realFetch(input, init);
  const path = pathOf(input);
  hits.push(path);
  const page = pages[path] ?? pages['*'];
  if (!page) return new Response('not found', { status: 404 });
  const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
  if (page.setCookie) headers['set-cookie'] = page.setCookie;
  return new Response(page.html, { status: 200, headers });
}) as typeof fetch;

const store = (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore
  ?? new Map<string, string>();
(globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore = store;

async function me(access: string) {
  return handleAuthRequest({
    method: 'GET',
    path: '/users/me',
    query: {},
    body: null,
    token: access,
  });
}

async function liveOfficial(): Promise<void> {
  console.log('4) 官网现网结构');
  const UA = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
  const grab = async (origin: string, path: string) => {
    const res = await fetch(`${origin}${path}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN', 'Cache-Control': 'no-cache' },
      redirect: 'follow',
    });
    return { status: res.status, url: res.url, html: await res.text() };
  };
  try {
    const mirrorHome = await grab('https://linux.sb', '/');
    check(
      '游客首页仍是 logged-out',
      pageSessionLook(mirrorHome.html) === 'logged-out',
      `look=${pageSessionLook(mirrorHome.html)} len=${mirrorHome.html.length}`,
    );
    const menu = await grab('https://linux.sb', '/mobile_menu');
    check(
      '官网游客菜单现网仍能认出 logged-out',
      pageSessionLook(menu.html) === 'logged-out',
      `look=${pageSessionLook(menu.html)} len=${menu.html.length}`,
    );
    const editor = await grab('https://linux.sb', '/topic_edit');
    check(
      '游客发帖页会落到登录墙',
      pageSessionLook(editor.html) === 'logged-out',
      `look=${pageSessionLook(editor.html)} url=${editor.url}`,
    );
  } catch (error) {
    console.log(`  ⚠ 官网抓取失败，跳过现网核：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function integration(): Promise<void> {
  console.log('5) GET /users/me 整条链路');
  mockEnabled = true;
  store.set('lsb.access', 'lsb.test');
  store.set('lsb.refresh', 'lsr.test');
  store.set('lsb.cookies', 'bbs_auth=secret; bbs_csrf=x');
  store.set('lsb.user', JSON.stringify(USER));
  await hydrateSession();
  const access = getAccessToken();
  check('冷启动能从磁盘恢复 token', access === 'lsb.test');
  check('冷启动能恢复内存会话', Boolean(sessionForToken(access)) && sessionForToken(access)?.user.id === '42');
  check('冷启动 cookie 仍有 bbs_auth', hasBbsAuth(sessionForToken(access)?.cookies ?? ''));

  hits.length = 0;
  pages = { '/mobile_menu': { html: officialGuestMenu }, '/topic_edit': { html: composePage } };
  let result = await me(access!);
  check(
    '游客菜单 + 发帖页仍登录 → 200 且会话还在',
    result.status === 200 && Boolean(sessionForToken(access)) && hasBbsAuth(sessionForToken(access)?.cookies ?? ''),
    `status=${result.status} code=${result.error?.code ?? ''}`,
  );
  check('这条不会去抓首页 /', !hits.some((path) => path === '/'));

  hits.length = 0;
  pages = { '/mobile_menu': { html: challenge } };
  result = await me(access!);
  check(
    '挑战页 → 保留本地用户',
    result.status === 200 && (result.data as { id?: string } | undefined)?.id === '42',
    `status=${result.status}`,
  );
  check('挑战页不去发帖页确认', !hits.some((path) => path.includes('topic_edit')));

  pages = {
    '/mobile_menu': {
      html: officialLoggedMenu,
      setCookie: 'bbs_auth=; Max-Age=0; Path=/',
    },
  };
  result = await me(access!);
  check(
    '登录菜单但 Set-Cookie 清掉 bbs_auth → 内存仍留着',
    result.status === 200 && hasBbsAuth(sessionForToken(access)?.cookies ?? ''),
    `jar=${sessionForToken(access)?.cookies ?? ''}`,
  );

  pages = { '/mobile_menu': { html: guestHome } };
  updateUpstreamCookies(access!, 'bbs_csrf=only');
  check(
    'updateUpstreamCookies 被游客 jar 调用时仍保留 bbs_auth',
    hasBbsAuth(sessionForToken(access)?.cookies ?? ''),
  );

  destroyUpstreamSession(access);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const disk = await secureGet('lsb.cookies');
  check(
    'destroy 后磁盘 cookie 还在（persist 空快照不得写 null）',
    hasBbsAuth(disk),
    `disk=${disk ? `len=${disk.length}` : 'null'}`,
  );

  // 重新挂上会话，测真正过期
  store.set('lsb.access', 'lsb.test');
  store.set('lsb.refresh', 'lsr.test');
  store.set('lsb.cookies', 'bbs_auth=secret; bbs_csrf=x');
  store.set('lsb.user', JSON.stringify(USER));
  setSession('lsb.test', 'lsr.test');
  restoreSiteSession({
    sessions: {
      'lsb.test': { cookies: 'bbs_auth=secret; bbs_csrf=x', refreshToken: 'lsr.test', user: USER },
    },
    refresh: { 'lsr.test': 'lsb.test' },
  });

  pages = { '/mobile_menu': { html: officialGuestMenu }, '/topic_edit': { html: loginWall } };
  result = await me('lsb.test');
  check(
    '游客菜单 + 登录墙 → 确认过期',
    result.status === 401 && result.error?.code === 'SESSION_EXPIRED',
    `status=${result.status} code=${result.error?.code ?? ''}`,
  );
  check('确认过期后内存会话拆掉', sessionForToken('lsb.test') == null);

  // 重新挂上会话，测「退出还在飞时又登录」不得 POST /logout 把新 cookie 作废
  restoreSiteSession({
    sessions: {
      'lsb.test': { cookies: 'bbs_auth=secret; bbs_csrf=x', refreshToken: 'lsr.test', user: USER },
    },
    refresh: { 'lsr.test': 'lsb.test' },
  });
  markSignedOut();
  const logoutHits: string[] = [];
  let resumeHome = () => {};
  const homeLock = new Promise<void>((resolve) => {
    resumeHome = resolve;
  });
  const innerFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    logoutHits.push(`${String(init?.method ?? 'GET').toUpperCase()} ${path}`);
    if (path === '/') await homeLock;
    if (path === '/logout') return new Response('', { status: 302, headers: { location: '/' } });
    return innerFetch(input, init);
  }) as typeof fetch;
  await handleAuthRequest({
    method: 'POST',
    path: '/auth/logout',
    query: {},
    body: null,
    token: 'lsb.test',
  });
  restoreSiteSession({
    sessions: {
      'lsb.fresh': { cookies: 'bbs_auth=fresh; bbs_csrf=x', refreshToken: 'lsr.fresh', user: USER },
    },
    refresh: { 'lsr.fresh': 'lsb.fresh' },
  });
  setSession('lsb.fresh', 'lsr.fresh');
  resumeHome();
  await new Promise((resolve) => setTimeout(resolve, 80));
  check(
    '重新登录后后台不得 POST /logout',
    !logoutHits.some((hit) => hit.includes('/logout')),
    `hits=${logoutHits.join(',')}`,
  );
  check(
    '新会话还在',
    Boolean(sessionForToken('lsb.fresh')) && hasBbsAuth(sessionForToken('lsb.fresh')?.cookies ?? ''),
  );

  restoreSiteSession({
    sessions: {
      'lsb.stale': { cookies: 'bbs_auth=stale; bbs_csrf=x', refreshToken: 'lsr.stale', user: USER },
    },
    refresh: { 'lsr.stale': 'lsb.stale' },
  });
  setSession('lsb.stale', 'lsr.stale');
  let resumeMe = () => {};
  const meLock = new Promise<void>((resolve) => {
    resumeMe = resolve;
  });
  const fetchBeforeMe = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    if (path === '/mobile_menu') await meLock;
    return fetchBeforeMe(input, init);
  }) as typeof fetch;
  pages = { '/mobile_menu': { html: challenge } };
  const pendingMe = me('lsb.stale');
  markSignedOut();
  destroyUpstreamSession('lsb.stale');
  resumeMe();
  result = await pendingMe;
  check(
    '退出后飞着的 /users/me 不得把旧用户写回来',
    result.status === 401,
    `status=${result.status} code=${result.error?.code ?? ''}`,
  );
}

async function main() {
  await liveOfficial();
  await integration();
  console.log(failed ? `\n✗ ${failed} 项未通过` : '\n✓ 通过：登录态保活（含现网菜单结构 + /users/me + 退出善后）');
  process.exit(failed ? 1 : 0);
}

void main();
