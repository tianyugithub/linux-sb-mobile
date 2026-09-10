import type { CaptchaChallengeDto, SessionDto, UserDto } from '../types/api';
import { requestId } from '../utils/time';
import { LINUX_ORIGIN, hydrateUser, isLoginWall, parseCurrentUserId, parseFormErrorMessage } from './live';
import { MockApiError, type MockRequest, type MockResponse } from './mock';
import {
  cookiesForToken,
  createUpstreamSession,
  destroyUpstreamSession,
  rotateUpstreamSession,
  sessionForToken,
  updateUpstreamCookies,
  updateUpstreamUser,
} from './site-session';
import { decodeBase64Json } from '../utils/base64';
import { isNativeApp, siteCredentials } from '../utils/runtime';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

let captchaCache: { at: number; data: CaptchaChallengeDto } | null = null;

function ok(data: unknown, status = 200): MockResponse {
  return { status, data };
}

function setCookiesOf(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    const listed = headers.getSetCookie();
    if (listed?.length) return listed;
  }
  const collected: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie' && value) collected.push(value);
  });
  if (collected.length) return collected;
  const single = headers.get('set-cookie');
  if (!single) return [];
  return single.split(/,(?=\s*[\w-]+=)/).map((item) => item.trim()).filter(Boolean);
}

function applySetCookie(existing: string, setCookies: string[]): string {
  const map = new Map<string, string>();
  for (const part of existing.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  for (const line of setCookies) {
    const pair = line.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    const expired = /max-age=0/i.test(line) || /expires=thu, 01 jan 1970/i.test(line);
    if (!value || expired) {
      map.delete(name);
      continue;
    }
    map.set(name, value);
  }
  return [...map.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function decodeFormError(cookies: string): string | null {
  const match = cookies.match(/(?:^|; )__form_error=([^;]+)/);
  if (!match) return null;
  try {
    const raw = decodeURIComponent(match[1]);
    const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    const parsed = decodeBase64Json<{ message?: string }>(padded);
    return parsed?.message?.trim() || null;
  } catch {
    return null;
  }
}

function browserHeaders(cookies?: string, referer = '/login'): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'User-Agent': BROWSER_UA,
    Referer: referer.startsWith('http') ? referer : `${LINUX_ORIGIN}${referer}`,
  };
  if (cookies) headers.Cookie = cookies;
  return headers;
}

function encodeLoginForm(fields: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) params.append(key, value);
  return params.toString();
}

function loginFailureMessage(html: string, cookies: string, url = ''): string {
  return parseFormErrorMessage(html, cookies, url)
    || decodeFormError(cookies)
    || '登录失败，请重试';
}

function pageTitle(html: string): string {
  return html.match(/<title>([^<]+)/)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
}

function isChallengePage(html: string): boolean {
  return /just a moment|cf-browser-verification|challenge-platform|cf-challenge|attention required/i.test(html);
}

function isLoginForm(html: string): boolean {
  return Boolean(readCsrf(html)) && /name="username"/.test(html) && /name="password"/.test(html) && !/name="password2"/.test(html);
}

function isRegisterForm(html: string): boolean {
  return Boolean(readCsrf(html)) && /name="password2"/.test(html) && /name="email"/.test(html);
}

function readCsrf(html: string): string | null {
  return html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1]
    || html.match(/name="_csrf"[^>]*value="([^"]+)"/)?.[1]
    || html.match(/value="([^"]+)"[^>]*name="_csrf"/)?.[1]
    || html.match(/name='_csrf'\s+value='([^']+)'/)?.[1]
    || null;
}

async function linuxGet(path: string, cookies: string, referer = '/'): Promise<{ cookies: string; html: string; url: string }> {
  const credentials = siteCredentials();
  const response = await fetch(`${LINUX_ORIGIN}${path}`, {
    headers: {
      ...browserHeaders(cookies, referer),
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    redirect: 'follow',
    credentials,
  });
  const html = await response.text();
  return {
    cookies: applySetCookie(cookies, setCookiesOf(response)),
    html,
    url: response.url,
  };
}

async function postLogout(cookies: string, html: string): Promise<string> {
  let jar = cookies;
  let csrf = readCsrf(html);
  if (!csrf) {
    const editor = await linuxGet('/topic_edit', jar);
    jar = editor.cookies;
    csrf = readCsrf(editor.html);
    if (isLoginForm(editor.html) || isRegisterForm(editor.html)) return jar;
  }
  if (!csrf) return jar;
  try {
    const posted = await fetch(`${LINUX_ORIGIN}/logout`, {
      method: 'POST',
      headers: {
        ...browserHeaders(jar, '/'),
        Origin: LINUX_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: encodeLoginForm({ _csrf: csrf }),
      credentials: siteCredentials(),
      redirect: 'follow',
    });
    return applySetCookie(jar, setCookiesOf(posted));
  } catch {
    return jar;
  }
}

async function loadAuthPage(kind: 'login' | 'register'): Promise<{ cookies: string; html: string }> {
  const path = kind === 'login' ? '/login' : '/register';
  const matches = kind === 'login' ? isLoginForm : isRegisterForm;
  const fail = (html: string): never => {
    const title = pageTitle(html);
    throw new MockApiError(502, 'UPSTREAM', `无法读取${kind === 'login' ? '登录' : '注册'}页${title ? `（${title}）` : ''}`);
  };

  let page = await linuxGet(path, '', path);
  if (isChallengePage(page.html)) throw new MockApiError(502, 'UPSTREAM', '登录页被网络校验拦截，请稍后重试');
  if (matches(page.html)) return page;

  page = { ...page, cookies: await postLogout(page.cookies, page.html) };
  page = await linuxGet(path, page.cookies, path);
  if (matches(page.html)) return page;

  const fallbackPath = kind === 'login' ? '/topic_edit' : '/register';
  const fallback = await linuxGet(fallbackPath, page.cookies, path);
  if (matches(fallback.html)) return fallback;
  if (readCsrf(fallback.html) && !matches(fallback.html)) {
    const cleared = await postLogout(fallback.cookies, fallback.html);
    page = await linuxGet(path, cleared, path);
    if (matches(page.html)) return page;
  }
  return fail(page.html);
}

function capConfigFromHtml(html: string): CaptchaChallengeDto {
  const endpoint = html.match(/data-cap-api-endpoint="([^"]+)"/)?.[1] ?? 'https://cap.linux.sb/60c41af707/';
  const widgetScript = html.match(/data-cap-widget-script="([^"]+)"/)?.[1] ?? 'https://cap.linux.sb/assets/widget.js';
  const wasmUrl = html.match(/data-cap-wasm-url="([^"]+)"/)?.[1] ?? 'https://cap.linux.sb/assets/cap_wasm_bg.wasm';
  const key = endpoint.match(/cap\.linux\.sb\/([a-f0-9]+)/i)?.[1] ?? '60c41af707';
  return {
    endpoint: endpoint.startsWith('http') ? endpoint : `https://cap.linux.sb/${key}/`,
    widgetScript,
    wasmUrl,
  };
}

async function resolveUser(cookies: string, html: string): Promise<{ cookies: string; user: UserDto }> {
  let userId = parseCurrentUserId(html);
  let jar = cookies;
  if (!userId) {
    const menu = await linuxGet('/mobile_menu', jar);
    jar = menu.cookies;
    userId = parseCurrentUserId(menu.html) || menu.html.match(/href="\/user\/(\d+)"/)?.[1] || null;
  }
  if (!userId) {
    throw new MockApiError(401, 'LOGIN_FAILED', parseFormErrorMessage(html, jar) || '登录状态未同步，请重试');
  }
  const user = await hydrateUser(userId, jar, true);
  return { cookies: jar, user };
}

async function loginWithLinux(username: string, password: string, capToken: string): Promise<SessionDto> {
  const loginPage = await loadAuthPage('login');
  const csrf = readCsrf(loginPage.html);
  if (!csrf) throw new MockApiError(502, 'UPSTREAM', '无法读取登录页');
  // RN fetch hides Set-Cookie; the CSRF cookie value is the same as the hidden field.
  let cookies = applySetCookie(loginPage.cookies, [`bbs_csrf=${csrf}`]);

  const credentials = siteCredentials();
  const postInit: RequestInit = {
    method: 'POST',
    headers: {
      ...browserHeaders(cookies),
      Origin: LINUX_ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeLoginForm({
      _csrf: csrf,
      username,
      password,
      cap_token: capToken,
    }),
    credentials,
  };
  let posted: Response;
  try {
    posted = await fetch(`${LINUX_ORIGIN}/login`, { ...postInit, redirect: 'manual' });
  } catch {
    posted = await fetch(`${LINUX_ORIGIN}/login`, { ...postInit, redirect: 'follow' });
  }
  cookies = applySetCookie(cookies, setCookiesOf(posted));
  const location = posted.headers.get('location') || posted.url || '';

  let html = '';
  if (posted.status >= 300 && posted.status < 400 && location) {
    const next = new URL(location, LINUX_ORIGIN);
    const landed = await fetch(next, { headers: browserHeaders(cookies), redirect: 'follow', credentials });
    cookies = applySetCookie(cookies, setCookiesOf(landed));
    html = await landed.text();
    const failed = loginFailureMessage(html, cookies, landed.url || next.toString());
    if (/form_error/i.test(next.pathname) || parseFormErrorMessage(html, cookies, landed.url || next.toString())) {
      throw new MockApiError(401, 'LOGIN_FAILED', failed);
    }
  } else {
    html = await posted.text();
  }

  const failed = parseFormErrorMessage(html, cookies, posted.url || location);
  if (failed) {
    throw new MockApiError(401, 'LOGIN_FAILED', failed);
  }
  if (isLoginWall(html) || (/name="password"/.test(html) && /name="_csrf"/.test(html))) {
    throw new MockApiError(401, 'INVALID_CREDENTIALS', decodeFormError(cookies) || '用户名或密码错误');
  }

  const resolved = await resolveUser(cookies, html);
  return createUpstreamSession(resolved.cookies, resolved.user);
}

async function loginWithOAuth(cookies: string): Promise<SessionDto> {
  const home = await linuxGet('/', cookies);
  if (isLoginWall(home.html) || /nav-mine-guest/.test(home.html)) {
    throw new MockApiError(401, 'OAUTH_FAILED', parseFormErrorMessage(home.html, home.cookies) || '授权未完成或已取消');
  }
  const resolved = await resolveUser(home.cookies || cookies, home.html);
  return createUpstreamSession(resolved.cookies, resolved.user);
}

async function sendRegisterEmailCode(email: string): Promise<{ ok: true }> {
  const page = await loadAuthPage('register');
  const csrf = readCsrf(page.html);
  if (!csrf) throw new MockApiError(502, 'UPSTREAM', '无法读取注册页');
  const cookies = applySetCookie(page.cookies, [`bbs_csrf=${csrf}`]);
  const posted = await fetch(`${LINUX_ORIGIN}/user_review_email_code`, {
    method: 'POST',
    headers: {
      ...browserHeaders(cookies, '/register'),
      Origin: LINUX_ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json,text/plain,*/*',
    },
    body: encodeLoginForm({ _csrf: csrf, email }),
    credentials: siteCredentials(),
  });
  const text = await posted.text();
  let data: { ok?: boolean; message?: string } | null = null;
  try {
    data = JSON.parse(text) as { ok?: boolean; message?: string };
  } catch {
    data = null;
  }
  if (!posted.ok || !data?.ok) {
    throw new MockApiError(400, 'EMAIL_CODE', data?.message || parseFormErrorMessage(text, cookies) || '验证码发送失败');
  }
  return { ok: true };
}

async function registerWithLinux(input: {
  username: string;
  password: string;
  email: string;
  emailCode: string;
  captchaToken: string;
}): Promise<SessionDto> {
  const page = await loadAuthPage('register');
  const csrf = readCsrf(page.html);
  if (!csrf) throw new MockApiError(502, 'UPSTREAM', '无法读取注册页');
  let cookies = applySetCookie(page.cookies, [`bbs_csrf=${csrf}`]);
  const credentials = siteCredentials();
  const postInit: RequestInit = {
    method: 'POST',
    headers: {
      ...browserHeaders(cookies, '/register'),
      Origin: LINUX_ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeLoginForm({
      _csrf: csrf,
      username: input.username,
      password: input.password,
      password2: input.password,
      email: input.email,
      email_code: input.emailCode,
      cap_token: input.captchaToken,
    }),
    credentials,
  };
  let posted: Response;
  try {
    posted = await fetch(`${LINUX_ORIGIN}/register`, { ...postInit, redirect: 'manual' });
  } catch {
    posted = await fetch(`${LINUX_ORIGIN}/register`, { ...postInit, redirect: 'follow' });
  }
  cookies = applySetCookie(cookies, setCookiesOf(posted));
  const location = posted.headers.get('location') || posted.url || '';
  let html = '';
  let landedUrl = posted.url || location;
  if (posted.status >= 300 && posted.status < 400 && location) {
    const next = new URL(location, LINUX_ORIGIN);
    const landed = await fetch(next, { headers: browserHeaders(cookies, '/register'), redirect: 'follow', credentials });
    cookies = applySetCookie(cookies, setCookiesOf(landed));
    html = await landed.text();
    landedUrl = landed.url || next.toString();
    const failed = loginFailureMessage(html, cookies, landedUrl);
    if (/form_error/i.test(next.pathname) || parseFormErrorMessage(html, cookies, landedUrl)) {
      throw new MockApiError(400, 'REGISTER_FAILED', failed);
    }
  } else {
    html = await posted.text();
  }

  const failed = parseFormErrorMessage(html, cookies, landedUrl);
  if (failed) throw new MockApiError(400, 'REGISTER_FAILED', failed);
  if (/name="username"/.test(html) && /name="password2"/.test(html) && /name="_csrf"/.test(html)) {
    throw new MockApiError(400, 'REGISTER_FAILED', decodeFormError(cookies) || '注册失败，请检查填写信息');
  }

  try {
    const resolved = await resolveUser(cookies, html);
    return createUpstreamSession(resolved.cookies, resolved.user);
  } catch {
    try {
      return await loginWithLinux(input.username, input.password, input.captchaToken);
    } catch {
      throw new MockApiError(409, 'REGISTERED_NEED_LOGIN', '注册成功，请返回登录');
    }
  }
}

async function currentUser(token: string | null): Promise<UserDto> {
  const session = sessionForToken(token);
  if (!session) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
  try {
    const home = await linuxGet('/', session.cookies);
    updateUpstreamCookies(token!, home.cookies);
    if (isLoginWall(home.html) || /nav-mine-guest/.test(home.html)) {
      destroyUpstreamSession(token);
      throw new MockApiError(401, 'UNAUTHORIZED', '登录已失效，请重新登录');
    }
    const resolved = await resolveUser(home.cookies, home.html);
    updateUpstreamCookies(token!, resolved.cookies);
    updateUpstreamUser(token!, resolved.user);
    return resolved.user;
  } catch (error) {
    if (error instanceof MockApiError) throw error;
    return session.user;
  }
}

export async function getCaptchaConfig(): Promise<CaptchaChallengeDto> {
  if (captchaCache && Date.now() - captchaCache.at < 5 * 60_000) return captchaCache.data;
  const page = await linuxGet('/login', '');
  const data = capConfigFromHtml(page.html);
  captchaCache = { at: Date.now(), data };
  return data;
}

export function captchaWidgetPage(cfg: CaptchaChallengeDto, theme?: { surface: string; surfaceRaised: string; surfaceSoft: string; line: string; text: string; red: string }): string {
  const endpoint = cfg.endpoint.endsWith('/') ? cfg.endpoint : `${cfg.endpoint}/`;
  const wasm = cfg.wasmUrl || 'https://cap.linux.sb/assets/cap_wasm_bg.wasm';
  const script = cfg.widgetScript || 'https://cap.linux.sb/assets/widget.js';
  const colors = theme ?? {
    surface: '#151A23',
    surfaceRaised: '#1C2330',
    surfaceSoft: '#222A38',
    line: '#2A3342',
    text: '#F3F5F7',
    red: '#E1251B',
  };
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    html, body { margin: 0; padding: 8px; background: ${colors.surface}; }
    cap-widget {
      --cap-background: ${colors.surface};
      --cap-border-color: ${colors.line};
      --cap-color: ${colors.text};
      --cap-checkbox-background: ${colors.surfaceRaised};
      --cap-checkbox-border: 1px solid ${colors.line};
      --cap-spinner-color: ${colors.red};
      --cap-spinner-background-color: ${colors.surfaceSoft};
    }
  </style>
</head>
<body>
  <script>
    window.CAP_CUSTOM_WASM_URL = ${JSON.stringify(wasm)};
    window.CAP_LANG = 'zh-cn';
    function send(payload) {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
    function boot() {
      var widget = document.createElement('cap-widget');
      widget.setAttribute('data-cap-api-endpoint', ${JSON.stringify(endpoint)});
      widget.setAttribute('data-cap-hidden-field-name', 'cap_token');
      widget.addEventListener('solve', function (event) {
        send({ type: 'solve', token: (event.detail && event.detail.token) || event.token || (widget && widget.token) });
      });
      widget.addEventListener('error', function () { send({ type: 'error' }); });
      widget.addEventListener('reset', function () { send({ type: 'reset' }); });
      document.body.appendChild(widget);
    }
    var script = document.createElement('script');
    script.src = ${JSON.stringify(script)};
    script.onload = boot;
    script.onerror = function () { send({ type: 'error', message: 'widget' }); };
    document.head.appendChild(script);
  </script>
</body>
</html>`;
}

async function dispatch(req: MockRequest): Promise<unknown> {
  const { method, path, body, token } = req;
  const payload = (body ?? {}) as Record<string, unknown>;

  if (method === 'GET' && path === '/auth/captcha') {
    return getCaptchaConfig();
  }

  if (method === 'POST' && path === '/auth/captcha/verify') {
    throw new MockApiError(400, 'CAPTCHA', '请使用页面上的人机验证');
  }

  if (method === 'POST' && path === '/auth/email-code') {
    const email = String(payload.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) throw new MockApiError(400, 'VALIDATION', '请输入有效邮箱');
    return sendRegisterEmailCode(email);
  }

  if (method === 'POST' && path === '/auth/login') {
    const username = String(payload.username ?? '').trim();
    const password = String(payload.password ?? '');
    const provider = String(payload.provider ?? '');
    const captchaToken = String(payload.captchaToken ?? '');
    const oauthCookies = String(payload.oauthCookies ?? '');
    if (provider === 'github' || provider === 'google') {
      if (!oauthCookies) throw new MockApiError(400, 'OAUTH', '请先完成授权');
      return loginWithOAuth(oauthCookies);
    }
    if (provider) throw new MockApiError(501, 'OAUTH_UNAVAILABLE', '该登录方式尚未接入');
    if (!username) throw new MockApiError(400, 'VALIDATION', '请输入用户名');
    if (username.includes('@')) throw new MockApiError(400, 'VALIDATION', '请使用用户名登录，不要使用邮箱');
    if (!password) throw new MockApiError(400, 'VALIDATION', '请输入密码');
    if (!captchaToken) throw new MockApiError(400, 'CAPTCHA', '请先完成人机验证');
    return loginWithLinux(username, password, captchaToken);
  }

  if (method === 'POST' && path === '/auth/register') {
    const username = String(payload.username ?? '').trim();
    const password = String(payload.password ?? '');
    const email = String(payload.email ?? '').trim().toLowerCase();
    const emailCode = String(payload.emailCode ?? '').trim();
    const captchaToken = String(payload.captchaToken ?? '');
    if (!username) throw new MockApiError(400, 'VALIDATION', '请输入用户名');
    if (/\s/.test(username) || username.length > 20) throw new MockApiError(400, 'VALIDATION', '用户名不能包含空白，且不超过 20 个字符');
    if (password.length < 6) throw new MockApiError(400, 'VALIDATION', '密码至少 6 位');
    if (!email || !email.includes('@')) throw new MockApiError(400, 'VALIDATION', '请输入有效邮箱');
    if (!emailCode) throw new MockApiError(400, 'VALIDATION', '请输入邮箱验证码');
    if (!captchaToken) throw new MockApiError(400, 'CAPTCHA', '请先完成人机验证');
    return registerWithLinux({ username, password, email, emailCode, captchaToken });
  }

  if (method === 'POST' && path === '/auth/refresh') {
    const refreshToken = String(payload.refreshToken ?? '');
    const rotated = rotateUpstreamSession(refreshToken);
    if (!rotated) throw new MockApiError(401, 'UNAUTHORIZED', '会话已失效');
    return rotated;
  }

  if (method === 'POST' && path === '/auth/logout') {
    const cookies = cookiesForToken(token) ?? '';
    destroyUpstreamSession(token);
    try {
      const page = await linuxGet('/', cookies);
      await postLogout(page.cookies || cookies, page.html);
    } catch {
      /* still signed out locally */
    }
    return { ok: true };
  }

  if (method === 'GET' && path === '/users/me') {
    return currentUser(token);
  }

  throw new MockApiError(404, 'NOT_FOUND', '接口不存在');
}

export async function handleAuthRequest(req: MockRequest): Promise<MockResponse> {
  try {
    const data = await dispatch(req);
    return ok(data);
  } catch (error) {
    if (error instanceof MockApiError) {
      return {
        status: error.status,
        error: { code: error.code, message: error.message, requestId: error.requestId },
      };
    }
    return {
      status: 502,
      error: { code: 'UPSTREAM', message: error instanceof Error ? error.message : '无法连接 linux.sb', requestId: requestId() },
    };
  }
}
