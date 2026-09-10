import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'lsb.remember_login';

export type RememberedLogin = { username: string; password: string };

function webStore(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export async function loadRememberedLogin(): Promise<RememberedLogin | null> {
  try {
    const raw = Platform.OS === 'web'
      ? webStore()?.getItem(KEY) ?? null
      : await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    if (!parsed.username || typeof parsed.password !== 'string') return null;
    return { username: parsed.username, password: parsed.password };
  } catch {
    return null;
  }
}

export function saveRememberedLogin(input: RememberedLogin) {
  const raw = JSON.stringify(input);
  if (Platform.OS === 'web') {
    try {
      webStore()?.setItem(KEY, raw);
    } catch {
      /* ignore */
    }
    return;
  }
  void SecureStore.setItemAsync(KEY, raw).catch(() => undefined);
}

export function clearRememberedLogin() {
  if (Platform.OS === 'web') {
    try {
      webStore()?.removeItem(KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  void SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}
