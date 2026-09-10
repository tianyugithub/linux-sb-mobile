import type { LedgerRow } from './points';
import type { SynthEntry } from './synth';

/**
 * 增量抓取的纯逻辑：合并去重、判断「这一页是否已经和缓存重叠」、缓存时间文案。
 * 与文件读写分开，这样能直接进 `npm run check:helper` 离线回归（不依赖 RN / 文件系统）。
 */

/** 只保留最近 N 天的流水（存储用）。 */
export function pruneLedgerRows(rows: LedgerRow[], days: number): LedgerRow[] {
  const now = new Date();
  const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime();
  return rows.filter((row) => {
    const t = new Date(row.time).getTime();
    return Number.isNaN(t) || t >= floor;
  });
}

function rowKey(row: LedgerRow): string {
  return `${row.time}|${row.reason}|${row.delta}`;
}

export function mergeLedgerRows(cached: LedgerRow[], fresh: LedgerRow[]): LedgerRow[] {
  const map = new Map<string, LedgerRow>();
  cached.forEach((row) => map.set(rowKey(row), row));
  fresh.forEach((row) => map.set(rowKey(row), row));
  return [...map.values()].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

/** 合并合成条目：按通知 id 去重（同一条通知永远只统计一次）。 */
export function mergeSynthEntries(cached: SynthEntry[], fresh: SynthEntry[]): SynthEntry[] {
  const map = new Map<string, SynthEntry>();
  cached.forEach((entry) => map.set(entry.id, entry));
  fresh.forEach((entry) => map.set(entry.id, entry));
  return [...map.values()].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

/** 新抓到的页里是否已经出现缓存中的记录（出现即可停止继续翻页）。 */
export function overlapsCache(cached: LedgerRow[], fresh: LedgerRow[]): boolean {
  if (!cached.length || !fresh.length) return false;
  const keys = new Set(cached.map(rowKey));
  return fresh.some((row) => keys.has(rowKey(row)));
}

/** 缓存里最老的一条是否已经覆盖到需要的最早时间。 */
export function cacheCoversFloor(cached: LedgerRow[], floor: number): boolean {
  if (!cached.length) return false;
  const oldest = cached.reduce((min, row) => {
    const t = new Date(row.time).getTime();
    return Number.isNaN(t) ? min : Math.min(min, t);
  }, Number.POSITIVE_INFINITY);
  return Number.isFinite(oldest) && oldest <= floor;
}

export function snapshotAgeText(at: number, now = Date.now()): string {
  if (!at) return '还没有缓存';
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚更新';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  return `${Math.floor(hours / 24)} 天前更新`;
}
