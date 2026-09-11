import { Platform } from 'react-native';
import type { UserDto } from '../types/api';
import { secureDelete, secureGet, secureSet } from './secure-value';
import {
  getSiteSessionSnapshot,
  restoreSiteSession,
  setSiteSessionPersist,
  type SiteSessionSnapshot,
} from './site-session';
import { writeLinuxCookies } from '../utils/site-cookies';
import {
  hasBbsAuth,
  keepAuthCookie,
  pickPersistRecord,
  shouldClearSessionOnRefreshFailure,
} from './session-keep';

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

/** 每次退出加一，挡住「退出之后才完成的 secureSet」把会话写回来。 */
let storeEpoch = 0;
let signedOut = false;
const inFlight = new Set<Promise<void>>();

function nativeSet(key: string, value: string | null): Promise<void> {
  const epoch = storeEpoch;
  const job = (async () => {
    try {
      if (value) await secureSet(key, value);
      else await secureDelete(key);
    } catch {
      /* ignore */
    }
    if (epoch !== storeEpoch) {
      try {
        await secureDelete(key);
      } catch {
        /* ignore */
      }
    }
  })();
  inFlight.add(job);
  void job.finally(() => inFlight.delete(job));
  return job;
}

function writeLocal(key: string, value: string | null) {
  if (Platform.OS === 'web') {
    const store = webStore();
    if (!store) return;
    if (value) store.setItem(key, value);
    else store.removeItem(key);
    return;
  }
  void nativeSet(key, value);
}

const hasSessionCookie = hasBbsAuth;

const PLACEHOLDER_USER: UserDto = {
  id: 'local',
  name: '饼友',
  title: '饼友',
  group: '饼友',
  groupLabel: '饼友',
  points: 0,
  uid: '-',
  avatar: 'P',
  accent: '#222A38',
  bio: '',
  topicCount: 0,
  replyCount: 0,
  joinedAt: '',
};

function mintLocalToken(prefix: 'lsb' | 'lsr'): string {
  return `${prefix}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
}

function parseStoredUser(raw: string | null): UserDto | null {
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as UserDto;
    if (user && typeof user === 'object' && user.id && user.id !== '0') return user;
  } catch {
    /* 坏 JSON 当没有 */
  }
  return null;
}

/** 最近一次写入的 cookie jar，用来判断「这次要写的会不会把登录态写没了」。 */
let lastCookies: string | null = null;

/** 退出之后飞着的请求不得再把 bbs_auth 写回 jar / CookieManager。 */
export function sessionAcceptsCookies(): boolean {
  return !signedOut;
}

/** 界面已变游客时立刻挡住回写，不必等 clearSession 写盘结束。 */
export function markSignedOut() {
  signedOut = true;
  lastCookies = '';
}

/**
 * 写入 cookie jar，并挡住「用游客 jar 覆盖登录态」。
 *
 * 实测过的事故：`persistSite` 在找不到当前 token 的会话时会退而取快照里的最后一条，
 * 那条可能是游客会话（不含 `bbs_auth`），一写就把登录 cookie 抹了 —— 表现就是
 * 「什么都没干，重进就退出登录」。这里做一道保底：新 jar 不含 `bbs_auth` 而旧的有，
 * 就把旧的会话 cookie 接回去。真正的退出走 clearSession（写 null），不受此限。
 */
function writeCookies(next: string) {
  if (signedOut && hasSessionCookie(next)) {
    console.warn('[session] 已退出，丢弃 bbs_auth');
    return;
  }
  const apply = (value: string) => {
    lastCookies = value;
    writeLocal(COOKIE_KEY, value);
    void writeLinuxCookies(value);
  };
  if (hasSessionCookie(next)) {
    apply(next);
    return;
  }
  // clearSession 把 lastCookies 置成 ''：允许空 jar，不再把 bbs_auth 接回去。
  if (lastCookies === '') {
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

function mergeSessionCookie(next: string, previous: string): string {
  return keepAuthCookie(next, previous);
}

function persistSite(snapshot: SiteSessionSnapshot) {
  if (signedOut) return;
  const record = pickPersistRecord(snapshot.sessions, memory.token);
  if (!record) {
    // 内存快照空不等于用户退出：destroy 的误判曾经从这里把磁盘写成 null。
    console.warn('[session] 快照空，保留磁盘上的会话');
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
  if (cookies != null) lastCookies = cookies;
  const user = parseStoredUser(userRaw);
  const jar = cookies ?? '';
  if (hasSessionCookie(jar)) {
    if (!memory.token) {
      memory.token = mintLocalToken('lsb');
      writeLocal(TOKEN_KEY, memory.token);
    }
    if (!memory.refreshToken) {
      memory.refreshToken = mintLocalToken('lsr');
      writeLocal(REFRESH_KEY, memory.refreshToken);
    }
  }
  if (memory.token && memory.refreshToken && (user || hasSessionCookie(jar))) {
    restoreSiteSession({
      sessions: {
        [memory.token]: {
          cookies: jar,
          refreshToken: memory.refreshToken,
          user: user ?? PLACEHOLDER_USER,
        },
      },
      refresh: { [memory.refreshToken]: memory.token },
    });
  }
  setSiteSessionPersist(persistSite);
  if (jar && memory.token) void writeLinuxCookies(jar);
  memory.hydrated = true;
}

/** 本地还留着 bbs_auth 时，refresh 失败不得清盘。 */
export function shouldWipeOnRefreshFailure(): boolean {
  return shouldClearSessionOnRefreshFailure({
    signedOut,
    hasAuthCookie: hasSessionCookie(lastCookies),
  });
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
  signedOut = false;
  memory.token = token;
  memory.refreshToken = refreshToken;
  memory.hydrated = true;
  writeLocal(TOKEN_KEY, token);
  writeLocal(REFRESH_KEY, refreshToken);
  persistSite(getSiteSessionSnapshot());
}

export async function clearSession(): Promise<void> {
  storeEpoch += 1;
  signedOut = true;
  memory.token = null;
  memory.refreshToken = null;
  memory.hydrated = true;
  lastCookies = '';
  if (Platform.OS === 'web') {
    writeLocal(TOKEN_KEY, null);
    writeLocal(REFRESH_KEY, null);
    writeLocal(COOKIE_KEY, null);
    writeLocal(USER_KEY, null);
    return;
  }
  nativeSet(TOKEN_KEY, null);
  nativeSet(REFRESH_KEY, null);
  nativeSet(COOKIE_KEY, null);
  nativeSet(USER_KEY, null);
  await Promise.all([...inFlight]);
}
