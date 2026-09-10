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
    `bbs_auth=${/(^|;\s*)bbs_auth=/.test(record.cookies) ? 'yes' : 'no'}`,
  );
  writeLocal(COOKIE_KEY, record.cookies);
  writeLocal(USER_KEY, JSON.stringify(record.user));
  void writeLinuxCookies(record.cookies);
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
