import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * 大值安全存储：安卓的 `expo-secure-store` 单值上限约 2KB。
 *
 * 超限时它只打一条 `Value being stored in SecureStore is larger than 2048 bytes` 警告，
 * **写入会静默失败**（未来 SDK 会直接抛错）。session.ts 把整个 cookie jar 存一个键、
 * prefs.ts 把全部偏好存一个键，登录态的 cookie 一串就超过 2KB —— 结果就是用户什么都没干、
 * App 被系统回收一次后登录态就没了。
 *
 * 这里按 1800 字节切片分到 `<key>.0`、`<key>.1`…，用 `<key>.n` 记片数；
 * 读的时候先看分片，没有就回退读老的单键（老数据平滑迁移）。
 */
/**
 * 每片的上限，单位是 **UTF-8 字节**，不是字符 —— SecureStore 的 2048 是按字节算的，
 * 按字符切的话中文一片 1800 字就是 5400 字节，照样超限、照样静默失败。
 */
const CHUNK_BYTES = 1700;

function utf8Size(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/** 按字节切片，不劈开代理对。 */
function splitByBytes(value: string): string[] {
  const parts: string[] = [];
  let buffer = '';
  let bytes = 0;
  for (const char of value) {
    const size = utf8Size(char);
    if (bytes + size > CHUNK_BYTES && buffer) {
      parts.push(buffer);
      buffer = '';
      bytes = 0;
    }
    buffer += char;
    bytes += size;
  }
  if (buffer) parts.push(buffer);
  return parts;
}

function countKey(key: string) {
  return `${key}.n`;
}

function chunkKey(key: string, index: number) {
  return `${key}.${index}`;
}

function isWeb() {
  return Platform.OS === 'web';
}

function webStore(): Storage | null {
  if (!isWeb()) return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

async function dropChunks(key: string) {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const count = raw ? Number.parseInt(raw, 10) : 0;
  for (let index = 0; index < (Number.isFinite(count) ? count : 0); index += 1) {
    try {
      await SecureStore.deleteItemAsync(chunkKey(key, index));
    } catch {
      /* ignore */
    }
  }
  try {
    await SecureStore.deleteItemAsync(countKey(key));
  } catch {
    /* ignore */
  }
}

export async function secureGet(key: string): Promise<string | null> {
  if (isWeb()) return webStore()?.getItem(key) ?? null;
  try {
    const raw = await SecureStore.getItemAsync(countKey(key));
    const count = raw ? Number.parseInt(raw, 10) : 0;
    if (!Number.isFinite(count) || count <= 0) {
      // 老数据：还在单键里
      return await SecureStore.getItemAsync(key);
    }
    let out = '';
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, index));
      if (part === null) return null; // 缺片当作没有，避免读出半个会话
      out += part;
    }
    return out;
  } catch {
    return null;
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (isWeb()) {
    webStore()?.setItem(key, value);
    return;
  }
  const parts = splitByBytes(value);
  try {
    await dropChunks(key);
    for (let index = 0; index < parts.length; index += 1) {
      await SecureStore.setItemAsync(chunkKey(key, index), parts[index]);
    }
    await SecureStore.setItemAsync(countKey(key), String(parts.length));
    // 迁完就把老的单键清掉，免得下次读到过期副本
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}

export async function secureDelete(key: string): Promise<void> {
  if (isWeb()) {
    webStore()?.removeItem(key);
    return;
  }
  try {
    await dropChunks(key);
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}
