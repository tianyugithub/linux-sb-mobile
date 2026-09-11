import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * 大值安全存储：安卓的 `expo-secure-store` 单值上限约 2KB，超限只打一条警告、
 * **写入静默失败**。登录 cookie jar 一串就超，于是「什么都没干登录态就没了」。
 *
 * 这里做三件事，缺一不可：
 *
 * 1. **按 UTF-8 字节分片**（1700 字节/片）。注意是字节不是字符 —— 中文一字 3 字节，
 *    按字符切等于没切。
 * 2. **原子提交**：先写「新一代」的全部分片，最后才把指针翻到新一代；中途被杀掉时旧的一代
 *    仍然完整可用。曾经写成「先删旧、再写新」，而 cookie 每次响应都在重写，在那个窗口里被
 *    系统回收就等于两头都没了 —— 这正是「啥也没干就掉登录」的成因。
 * 3. **保留上一代当备份**：当前代残缺（缺片）就回退上一代，绝不把半个会话当成登录态。
 *
 * 另外拒绝用空白值覆盖已有内容（显式删除请走 `secureDelete`）——防的是某处算出一个空 jar
 * 就把会话抹掉。
 */
const CHUNK_BYTES = 1700;
/** 保留的代数：当前代 + 上一代（备份）。 */
const GENERATIONS = 2;
const TAG = '[secure]';

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

function utf8Size(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/** 按字节切片，不劈开代理对（导出给回归脚本用）。 */
export function splitByBytes(value: string): string[] {
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

export function chunkKey(key: string, generation: number, index: number): string {
  return `${key}.${generation}.${index}`;
}

export function countKey(key: string, generation: number): string {
  return `${key}.${generation}.n`;
}

export function pointerKey(key: string): string {
  return `${key}.p`;
}

export function parsePointer(raw: string | null): number {
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(value) && value >= 0 ? value : -1;
}

async function readPointer(key: string): Promise<number> {
  try {
    return parsePointer(await SecureStore.getItemAsync(pointerKey(key)));
  } catch {
    return -1;
  }
}

async function readGeneration(key: string, generation: number): Promise<string | null> {
  if (generation < 0) return null;
  try {
    const rawCount = await SecureStore.getItemAsync(countKey(key, generation));
    const count = rawCount ? Number.parseInt(rawCount, 10) : 0;
    if (!Number.isFinite(count) || count <= 0) return null;
    let out = '';
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, generation, index));
      if (part === null) return null; // 缺片：这一代不完整，交给调用方回退
      out += part;
    }
    return out;
  } catch {
    return null;
  }
}

async function dropGeneration(key: string, generation: number): Promise<void> {
  if (generation < 0) return;
  try {
    const rawCount = await SecureStore.getItemAsync(countKey(key, generation));
    const count = rawCount ? Number.parseInt(rawCount, 10) : 0;
    for (let index = 0; index < (Number.isFinite(count) ? count : 0); index += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, generation, index));
    }
    await SecureStore.deleteItemAsync(countKey(key, generation));
  } catch {
    /* 清理是尽力而为 */
  }
}

/**
 * 更早一版的布局：`<key>.n` 记片数、`<key>.<i>` 是分片（0.1.5 短暂用过）。
 * 指针不存在时要能读出来，否则更新一次就等于把登录态清零。
 */
async function readLegacyChunks(key: string): Promise<string | null> {
  try {
    const rawCount = await SecureStore.getItemAsync(`${key}.n`);
    const count = rawCount ? Number.parseInt(rawCount, 10) : 0;
    if (!Number.isFinite(count) || count <= 0) return null;
    let out = '';
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(`${key}.${index}`);
      if (part === null) return null;
      out += part;
    }
    return out;
  } catch {
    return null;
  }
}

export async function secureGet(key: string): Promise<string | null> {
  if (isWeb()) return webStore()?.getItem(key) ?? null;
  const pointer = await readPointer(key);
  for (let offset = 0; offset < GENERATIONS; offset += 1) {
    const value = await readGeneration(key, pointer - offset);
    if (value !== null) return value;
  }
  const legacy = await readLegacyChunks(key);
  if (legacy !== null) return legacy;
  // 还没迁到分片的老数据（单键）
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (isWeb()) {
    webStore()?.setItem(key, value);
    return;
  }
  if (!value.trim()) {
    const existing = await secureGet(key);
    if (existing && existing.trim()) {
      console.warn(TAG, `拒绝用空值覆盖 ${key}`);
      return;
    }
  }
  const parts = splitByBytes(value);
  const previous = await readPointer(key);
  const generation = previous + 1;
  try {
    for (let index = 0; index < parts.length; index += 1) {
      await SecureStore.setItemAsync(chunkKey(key, generation, index), parts[index]);
    }
    await SecureStore.setItemAsync(countKey(key, generation), String(parts.length));
    // ← 提交点：这一行没写成，旧的一代仍然完好
    await SecureStore.setItemAsync(pointerKey(key), String(generation));
  } catch (error) {
    console.warn(TAG, `写入 ${key} 未提交：${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  // 提交成功后再清理：只保留最近 GENERATIONS 代
  for (let old = 0; old <= previous - GENERATIONS + 1; old += 1) {
    await dropGeneration(key, old);
  }
  // 迁完清掉老的单键，免得下次读到过期副本
  try {
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
  const pointer = await readPointer(key);
  const last = Math.max(pointer, GENERATIONS);
  for (let generation = 0; generation <= last; generation += 1) {
    await dropGeneration(key, generation);
  }
  try {
    const rawCount = await SecureStore.getItemAsync(`${key}.n`);
    const count = rawCount ? Number.parseInt(rawCount, 10) : 0;
    for (let index = 0; index < (Number.isFinite(count) ? count : 0); index += 1) {
      await SecureStore.deleteItemAsync(`${key}.${index}`);
    }
    await SecureStore.deleteItemAsync(`${key}.n`);
    await SecureStore.deleteItemAsync(pointerKey(key));
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}
