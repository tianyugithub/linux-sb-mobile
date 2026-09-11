import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

type BootScheme = 'light' | 'dark';

/**
 * 色系冷启动快照。完整偏好在 SecureStore 里，读完要等一轮异步；
 * 在那之前 palette 默认深色，浅色用户会先看到一帧深色再跳回来。
 * 这里只存 `light` / `dark` 两个字，跟查询缓存一样同步读盘，首帧就能对上。
 */
const FILE = 'lsb.scheme';
const WEB_KEY = 'lsb.scheme';

function bootFile() {
  return new File(Paths.document, FILE);
}

function readRaw(): string | null {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(WEB_KEY) ?? null;
    } catch {
      return null;
    }
  }
  try {
    const file = bootFile();
    if (!file.exists) return null;
    return String(file.textSync() ?? '').trim();
  } catch {
    return null;
  }
}

function parseScheme(raw: string | null): BootScheme | null {
  if (raw === 'light' || raw === 'dark') return raw;
  return null;
}

export function readBootScheme(): BootScheme {
  return parseScheme(readRaw()) ?? 'dark';
}

export function hasBootScheme(): boolean {
  return parseScheme(readRaw()) != null;
}

export function writeBootScheme(scheme: BootScheme) {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem(WEB_KEY, scheme);
    } catch {
      /* 配额满就放弃，下次冷启动再等 hydrate */
    }
    return;
  }
  try {
    bootFile().write(scheme);
  } catch {
    /* 写失败不影响功能，只是下次冷启动还可能闪一帧 */
  }
}
