import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { Cookie } from '@react-native-cookies/cookies';

const SITE = 'https://linux.sb';

type LinuxCookiesNative = {
  get(url: string): Promise<string>;
  flush(): Promise<void>;
};

type NativeCookieManager = {
  get(url: string, useWebKit?: boolean): Promise<Record<string, Cookie>>;
  set(
    url: string,
    cookie: { name: string; value: string; domain: string; path: string; secure?: boolean },
  ): Promise<boolean>;
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

export async function readLinuxCookies(documentCookie = ''): Promise<string> {
  if (Platform.OS === 'web') {
    return (typeof document !== 'undefined' ? document.cookie : '') || documentCookie;
  }
  if (LinuxCookies) {
    try {
      await LinuxCookies.flush();
    } catch {
      /* ignore */
    }
    try {
      const header = await LinuxCookies.get(SITE);
      if (header) return header;
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
    const bag = manager ? await manager.get(SITE, true) : {};
    const header = cookieHeader(bag);
    if (header) return header;
  } catch {
    /* native module missing */
  }
  return documentCookie;
}

export async function writeLinuxCookies(header: string): Promise<void> {
  if (Platform.OS === 'web' || !header.trim()) return;
  const manager = cookieManager();
  if (!manager) return;
  const parts = header.split(';').map((item) => item.trim()).filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    try {
      await manager.set(SITE, {
        name,
        value,
        domain: 'linux.sb',
        path: '/',
        secure: true,
      });
    } catch {
      /* skip a malformed cookie */
    }
  }
  try {
    if (Platform.OS === 'android') await manager.flush();
  } catch {
    /* ignore */
  }
}
