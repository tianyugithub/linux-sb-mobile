import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Cookie } from '@react-native-cookies/cookies';
import { LINUX_CAP_MIRROR_ORIGIN, LINUX_CAP_ORIGIN, LINUX_MIRROR_ORIGIN, LINUX_ORIGIN } from './linux-access';

const COOKIE_URLS = [LINUX_ORIGIN, LINUX_MIRROR_ORIGIN, LINUX_CAP_ORIGIN, LINUX_CAP_MIRROR_ORIGIN];

type LinuxCookiesNative = {
  get(url: string): Promise<string>;
  merged?(): Promise<string>;
  put?(header: string): Promise<void>;
  clearSite?(): Promise<void>;
  flush(): Promise<void>;
};

type NativeCookieManager = {
  get(url: string, useWebKit?: boolean): Promise<Record<string, Cookie>>;
  set(
    url: string,
    cookie: { name: string; value: string; domain: string; path: string; secure?: boolean; expires?: string },
  ): Promise<boolean>;
  clearByName?(url: string, name: string, useWebKit?: boolean): Promise<boolean>;
  clearAll?(useWebKit?: boolean): Promise<boolean>;
  flush(): Promise<void>;
};

const LinuxCookies = requireOptionalNativeModule<LinuxCookiesNative>('LinuxCookies');

// `@react-native-cookies/cookies` throws on import in the web build, so it is
// required lazily on native only. The type-only import above is erased at runtime.
let cookieManagerCache: NativeCookieManager | null | undefined;

function cookieManager(): NativeCookieManager | null {
  if (Platform.OS === 'web') return null;
  if (cookieManagerCache === undefined) {
    try {
      const mod = require('@react-native-cookies/cookies') as { default: NativeCookieManager };
      cookieManagerCache = mod.default;
    } catch {
      cookieManagerCache = null;
    }
  }
  return cookieManagerCache;
}

function cookieHeader(bag: Record<string, Cookie>): string {
  return Object.values(bag)
    .filter((item) => item?.name)
    .map((item) => `${item.name}=${item.value ?? ''}`)
    .join('; ');
}

export function mergeCookieHeaders(...headers: string[]): string {
  const map = new Map<string, string>();
  for (const header of headers) {
    if (!header) continue;
    for (const part of header.split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1);
      if (!name) continue;
      map.set(name, value);
    }
  }
  return [...map.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function hasLinuxSessionCookie(header: string): boolean {
  return /(?:^|;\s*)bbs_auth=([^\s;]+)/i.test(header);
}

export async function readLinuxCookies(documentCookie = ''): Promise<string> {
  if (Platform.OS === 'web') {
    return mergeCookieHeaders(typeof document !== 'undefined' ? document.cookie : '', documentCookie);
  }
  const chunks: string[] = [];
  if (LinuxCookies) {
    try {
      await LinuxCookies.flush();
    } catch {
      /* ignore */
    }
    try {
      if (LinuxCookies.merged) {
        const header = await LinuxCookies.merged();
        if (header) chunks.push(header);
      } else {
        for (const url of COOKIE_URLS) {
          const header = await LinuxCookies.get(url);
          if (header) chunks.push(header);
        }
      }
    } catch {
      /* fall through */
    }
  }
  const manager = cookieManager();
  try {
    if (manager && Platform.OS === 'android') await manager.flush();
  } catch {
    /* ignore */
  }
  try {
    if (manager) {
      for (const url of COOKIE_URLS) {
        const header = cookieHeader(await manager.get(url, true));
        if (header) chunks.push(header);
      }
    }
  } catch {
    /* native module missing */
  }
  return mergeCookieHeaders(...chunks, documentCookie);
}

export async function writeLinuxCookies(header: string): Promise<void> {
  if (Platform.OS === 'web' || !header.trim()) return;
  if (LinuxCookies?.put) {
    try {
      await LinuxCookies.put(header);
      return;
    } catch {
      /* fall through to JS CookieManager */
    }
  }
  const manager = cookieManager();
  if (!manager) return;
  const parts = header.split(';').map((item) => item.trim()).filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    for (const url of COOKIE_URLS) {
      try {
        await manager.set(url, {
          name,
          value,
          domain: new URL(url).hostname,
          path: '/',
          secure: true,
        });
      } catch {
        /* skip a malformed cookie */
      }
    }
  }
  try {
    if (Platform.OS === 'android') await manager.flush();
  } catch {
    /* ignore */
  }
}

export async function clearLinuxCookies(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (LinuxCookies?.clearSite) {
    try {
      await LinuxCookies.clearSite();
    } catch {
      /* still try JS CookieManager */
    }
  }
  const manager = cookieManager();
  if (!manager) return;
  try {
    if (manager.clearAll) await manager.clearAll(true);
  } catch {
    /* older native module */
  }
  try {
    if (Platform.OS === 'android') await manager.flush();
  } catch {
    /* ignore */
  }
  for (const url of COOKIE_URLS) {
    let bag: Record<string, Cookie> = {};
    try {
      bag = await manager.get(url, true);
    } catch {
      bag = {};
    }
    const names = Object.keys(bag);
    for (const name of names) {
      try {
        if (manager.clearByName) await manager.clearByName(url, name, true);
        else {
          await manager.set(url, {
            name,
            value: '',
            domain: new URL(url).hostname,
            path: '/',
            secure: true,
            expires: '1970-01-01T00:00:00.000Z',
          });
        }
      } catch {
        /* skip */
      }
    }
  }
  try {
    if (Platform.OS === 'android') await manager.flush();
  } catch {
    /* ignore */
  }
}
