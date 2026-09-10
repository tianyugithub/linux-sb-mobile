import { Platform } from 'react-native';
import { secureDelete, secureGet, secureSet } from './secure-value';
import {
  getSiteSessionSnapshot,
  restoreSiteSession,
  setSiteSessionPersist,
  type SiteSessionSnapshot,
} from './site-session';
import { writeLinuxCookies } from '../utils/site-cookies';

const TOKEN_KEY = 'lsb.access';
const REFRESH_KEY = 'lsb.refresh';
const COOKIE_KEY = 'lsb.cookies';
const USER_KEY = 'lsb.user';

const memory: { token: string | null; refreshToken: string | null; hydrated: boolean } = {
  token: null,
  refreshToken: null,
  hydrated: false,
};

function webStore(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

async function nativeGet(key: string): Promise<string | null> {
  // 分片读写：cookie jar 很容易超过安卓 SecureStore 的 2KB 单值上限，
  // 超限是**静默失败**，表现就是「什么都没干登录态就没了」。见 secure-value.ts。
  return secureGet(key);
}

function nativeSet(key: string, value: string | null) {
  void (value ? secureSet(key, value) : secureDelete(key)).catch(() => undefined);
}

function writeLocal(key: string, value: string | null) {
  if (Platform.OS === 'web') {
    const store = webStore();
    if (!store) return;
    if (value) store.setItem(key, value);
    else store.removeItem(key);
    return;
  }
  nativeSet(key, value);
}

const hasSessionCookie = (jar: string | null | undefined) => /(^|;\s*)bbs_auth=/.test(jar ?? '');

/** 最近一次写入的 cookie jar，用来判断「这次要写的会不会把登录态写没了」。 */
let lastCookies: string | null = null;

/**
 * 写入 cookie jar，并挡住「用游客 jar 覆盖登录态」。
 *
 * 实测过的事故：`persistSite` 在找不到当前 token 的会话时会退而取快照里的最后一条，
 * 那条可能是游客会话（不含 `bbs_auth`），一写就把登录 cookie 抹了 —— 表现就是
 * 「什么都没干，重进就退出登录」。这里做一道保底：新 jar 不含 `bbs_auth` 而旧的有，
 * 就把旧的会话 cookie 接回去。真正的退出走 clearSession（写 null），不受此限。
 */
function writeCookies(next: string) {
  const apply = (value: string) => {
    lastCookies = value;
    writeLocal(COOKIE_KEY, value);
    void writeLinuxCookies(value);
  };
  if (hasSessionCookie(next)) {
    apply(next);
    return;
  }
  if (lastCookies !== null) {
    if (!hasSessionCookie(lastCookies)) {
      apply(next);
      return;
    }
    console.warn('[session] 新 jar 不含 bbs_auth，保留原会话 cookie');
    apply(mergeSessionCookie(next, lastCookies));
    return;
  }
  void nativeGet(COOKIE_KEY).then((previous) => {
    if (previous && hasSessionCookie(previous)) {
      console.warn('[session] 新 jar 不含 bbs_auth（冷启动），保留原会话 cookie');
      apply(mergeSessionCookie(next, previous));
      return;
    }
    apply(next);
  }).catch(() => apply(next));
}

/** 把旧 jar 里的 bbs_auth 接回新 jar。 */
function mergeSessionCookie(next: string, previous: string): string {
  const auth = previous
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith('bbs_auth='));
  if (!auth) return next;
  const base = next.replace(/;\s*$/, '').trim();
  return base ? `${base}; ${auth}` : auth;
}

function persistSite(snapshot: SiteSessionSnapshot) {
  const token = memory.token;
  const record = (token && snapshot.sessions[token]) || Object.values(snapshot.sessions).at(-1);
  if (!record) {
    writeLocal(COOKIE_KEY, null);
    writeLocal(USER_KEY, null);
    return;
  }
  console.warn(
    '[session] 保存会话',
    `len=${record.cookies.length}`,
    `bbs_auth=${hasSessionCookie(record.cookies) ? 'yes' : 'no'}`,
  );
  writeCookies(record.cookies);
  writeLocal(USER_KEY, JSON.stringify(record.user));
}

export async function hydrateSession(): Promise<void> {
  if (memory.hydrated) return;
  if (Platform.OS === 'web') {
    const store = webStore();
    memory.token = store?.getItem(TOKEN_KEY) ?? null;
    memory.refreshToken = store?.getItem(REFRESH_KEY) ?? null;
  } else {
    memory.token = await nativeGet(TOKEN_KEY);
    memory.refreshToken = await nativeGet(REFRESH_KEY);
  }
  const cookies = Platform.OS === 'web' ? (webStore()?.getItem(COOKIE_KEY) ?? null) : await nativeGet(COOKIE_KEY);
  // 飞行记录器：登录态再出问题时，日志里能直接看到「读到的 jar 有多大、含不含登录 cookie」。
  console.warn(
    '[session] 读取会话',
    `len=${(cookies ?? '').length}`,
    `bbs_auth=${/(^|;\s*)bbs_auth=/.test(cookies ?? '') ? 'yes' : 'no'}`,
  );
  const userRaw = Platform.OS === 'web' ? (webStore()?.getItem(USER_KEY) ?? null) : await nativeGet(USER_KEY);
  if (memory.token && memory.refreshToken && userRaw) {
    try {
      restoreSiteSession({
        sessions: {
          [memory.token]: {
            cookies: cookies ?? '',
            refreshToken: memory.refreshToken,
            user: JSON.parse(userRaw),
          },
        },
        refresh: { [memory.refreshToken]: memory.token },
      });
    } catch {
      restoreSiteSession(null);
    }
  }
  setSiteSessionPersist(persistSite);
  if (cookies) void writeLinuxCookies(cookies);
  memory.hydrated = true;
}

export function getAccessToken(): string | null {
  if (memory.token) return memory.token;
  if (Platform.OS === 'web') return webStore()?.getItem(TOKEN_KEY) ?? null;
  return null;
}

export function getRefreshToken(): string | null {
  if (memory.refreshToken) return memory.refreshToken;
  if (Platform.OS === 'web') return webStore()?.getItem(REFRESH_KEY) ?? null;
  return null;
}

export function setSession(token: string, refreshToken: string): void {
  memory.token = token;
  memory.refreshToken = refreshToken;
  memory.hydrated = true;
  writeLocal(TOKEN_KEY, token);
  writeLocal(REFRESH_KEY, refreshToken);
  persistSite(getSiteSessionSnapshot());
}

export function clearSession(): void {
  memory.token = null;
  memory.refreshToken = null;
  memory.hydrated = true;
  writeLocal(TOKEN_KEY, null);
  writeLocal(REFRESH_KEY, null);
  writeLocal(COOKIE_KEY, null);
  writeLocal(USER_KEY, null);
}
