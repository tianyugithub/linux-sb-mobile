import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  getSiteSessionSnapshot,
  restoreSiteSession,
  setSiteSessionPersist,
  type SiteSessionSnapshot,
} from './site-session';

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
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

function nativeSet(key: string, value: string | null) {
  const task = value ? SecureStore.setItemAsync(key, value) : SecureStore.deleteItemAsync(key);
  void task.catch(() => undefined);
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
  writeLocal(COOKIE_KEY, record.cookies);
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
