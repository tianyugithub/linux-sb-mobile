import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

/**
 * 查询缓存：内存 + 冷启动快照。
 *
 * 内存部分保证同一次运行内来回切页面秒开；但进程一重启就空了，
 * 于是「第一次进某个页面」永远只剩一条路——把整条上游链路跑完才有内容，
 * 消息页这种要连打两个上游接口的页面就会明显卡在骨架上。
 *
 * 所以这里再存一份磁盘快照：冷启动第一次 cacheGet 时同步读回（原生端 textSync），
 * 有数据就先渲染上次的内容，随后 hook 照旧的 stale-while-revalidate 流程后台刷新。
 * 约定与草稿（utils/draft.ts）一致：读取同步，写入防抖异步。
 */

type Entry = { at: number; data: unknown };
type Row = { key: string; at: number; data: unknown };

const store = new Map<string, Entry>();
const DEFAULT_TTL_MS = 45_000;

const SNAPSHOT_FILE = 'query-cache.json';
const SNAPSHOT_KEY = 'lsb.query-cache';
const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
const SNAPSHOT_MAX_CHARS = 400_000;
const ROW_MAX_CHARS = 120_000;
const WRITE_DELAY_MS = 1200;

let hydrated = false;
let dirty = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function snapshotFile(): File {
  return new File(Paths.document, SNAPSHOT_FILE);
}

function readSnapshot(): string | null {
  if (Platform.OS === 'web') {
    try {
      return sessionStorage.getItem(SNAPSHOT_KEY);
    } catch {
      return null;
    }
  }
  try {
    const file = snapshotFile();
    return file.exists ? file.textSync() : null;
  } catch {
    return null;
  }
}

function writeSnapshot(text: string | null) {
  if (Platform.OS === 'web') {
    try {
      if (text) sessionStorage.setItem(SNAPSHOT_KEY, text);
      else sessionStorage.removeItem(SNAPSHOT_KEY);
    } catch {
      /* 配额不足就放弃快照 */
    }
    return;
  }
  try {
    const file = snapshotFile();
    if (text) file.write(text);
    else if (file.exists) file.delete();
  } catch {
    /* 写失败不影响功能，只是下次冷启动没有快照 */
  }
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  const raw = readSnapshot();
  if (!raw) return;
  try {
    const rows = JSON.parse(raw) as Row[];
    if (!Array.isArray(rows)) return;
    const now = Date.now();
    rows.forEach((row) => {
      if (!row || typeof row.key !== 'string' || typeof row.at !== 'number') return;
      if (now - row.at > SNAPSHOT_TTL_MS) return;
      store.set(row.key, { at: row.at, data: row.data });
    });
  } catch {
    /* 快照损坏当作没有 */
  }
}

/** 启动时预热，避免首帧里做磁盘读。同步读，重复调用只生效一次。 */
export function preloadQueryCache() {
  hydrate();
}

function serialize(): string | null {
  const now = Date.now();
  const rows = [...store.entries()]
    .filter(([, entry]) => now - entry.at <= SNAPSHOT_TTL_MS)
    .map(([key, entry]): Row => ({ key, at: entry.at, data: entry.data }))
    .sort((a, b) => b.at - a.at);
  const kept: Row[] = [];
  let size = 2;
  for (const row of rows) {
    let text: string;
    try {
      text = JSON.stringify(row);
    } catch {
      continue;
    }
    if (text.length > ROW_MAX_CHARS) continue;
    if (size + text.length + 1 > SNAPSHOT_MAX_CHARS) break;
    size += text.length + 1;
    kept.push(row);
  }
  if (!kept.length) return null;
  try {
    return JSON.stringify(kept);
  } catch {
    return null;
  }
}

function flush() {
  writeTimer = null;
  if (!dirty) return;
  dirty = false;
  writeSnapshot(serialize());
}

function scheduleWrite() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(flush, WRITE_DELAY_MS);
}

export function cacheGet<T>(key: string): T | undefined {
  hydrate();
  const entry = store.get(key);
  return entry ? (entry.data as T) : undefined;
}

export function cacheSet<T>(key: string, data: T) {
  store.set(key, { at: Date.now(), data });
  scheduleWrite();
}

export function cacheFresh(key: string, ttlMs = DEFAULT_TTL_MS): boolean {
  hydrate();
  const entry = store.get(key);
  return Boolean(entry && Date.now() - entry.at < ttlMs);
}

export function cacheDelete(match: string) {
  hydrate();
  let hit = false;
  for (const key of [...store.keys()]) {
    if (key === match || key.startsWith(match)) {
      store.delete(key);
      hit = true;
    }
  }
  if (hit) scheduleWrite();
}

/** 清空内存与磁盘快照（退出登录时调用，避免串号显示上一个账号的数据）。 */
export function cacheClear() {
  hydrate();
  store.clear();
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  dirty = false;
  writeSnapshot(null);
}
