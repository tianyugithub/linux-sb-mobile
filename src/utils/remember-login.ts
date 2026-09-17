import { Platform } from 'react-native';
import { secureDelete, secureGet, secureSet } from '../services/secure-value';

const KEY = 'lsb.remember_login';

export type RememberedLogin = { username: string; password: string };

export function parseRememberedLogin(raw: string | null | undefined): RememberedLogin | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    const username = typeof parsed.username === 'string' ? parsed.username.trim() : '';
    if (!username || typeof parsed.password !== 'string') return null;
    return { username, password: parsed.password };
  } catch {
    return null;
  }
}

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
      : await secureGet(KEY);
    return parseRememberedLogin(raw);
  } catch {
    return null;
  }
}

export async function saveRememberedLogin(input: RememberedLogin): Promise<void> {
  const username = input.username.trim();
  if (!username) return;
  const raw = JSON.stringify({ username, password: input.password });
  try {
    if (Platform.OS === 'web') {
      webStore()?.setItem(KEY, raw);
      return;
    }
    await secureSet(KEY, raw);
  } catch {
    /* 本机写失败就下次再试，不能挡登录 */
  }
}

export async function clearRememberedLogin(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      webStore()?.removeItem(KEY);
      return;
    }
    await secureDelete(KEY);
  } catch {
    /* ignore */
  }
}
