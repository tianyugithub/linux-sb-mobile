import { useCallback, useEffect, useRef, useState } from 'react';
import { secureDelete, secureGet, secureSet } from '../services/secure-value';
import { api } from '../services/api';
import { titleRarityOf, type TitleRarity } from '../data/title-catalog';
import {
  analyzeLedger,
  computeLucky,
  fetchFloor,
  LEDGER_RANGES,
  type LedgerAnalysis,
  type LedgerRange,
  type LedgerRow,
  type LuckyStats,
} from '../plugins/helper/points';
import { parseSynthNotification, summarizeSynth, type SynthEntry, type SynthSummary } from '../plugins/helper/synth';
import type { MarketWatch } from '../plugins/helper/market';
import type { RangeLabel } from '../plugins/helper/range';
import {
  cacheCoversFloor,
  EMPTY_SNAPSHOT,
  mergeLedgerRows,
  mergeSynthEntries,
  overlapsCache,
  readHelperSnapshot,
  writeHelperSnapshot,
  type HelperSnapshot,
} from '../plugins/helper/store';

/**
 * 「饼友助手」的数据层：**缓存为主，网络只补最新**。
 *
 * 第一次进页面：抓到七天前为止（1 页/秒，最多 40 页），把解析后的流水/合成条目落盘；
 * 以后每次：先同步读盘秒开，再只抓第 1 页（必要时第 2 页），
 * 一旦发现这一页里出现了缓存里已有的记录就立刻停 —— 通常只有一个请求。
 * 需要完整重抓时用 `reload({ full: true })`（页面上的「抓取全部」）。
 */

const PAGE_DELAY_MS = 1000;
const MAX_PAGES = 40;
const NOTIFICATION_MAX_PAGES = 12;

export type LedgerLoader = {
  rows: LedgerRow[];
  analysis: LedgerAnalysis;
  loading: boolean;
  error: string;
  page: number;
  truncated: boolean;
  at: number;
  /** 缓存里已有的老数据是否够用（不够时后台还在补）。 */
  complete: boolean;
  reload: (opts?: { full?: boolean }) => void;
};

let cache: HelperSnapshot | null = null;
let listeners = new Set<() => void>();
/** 上一次「补最新」的时间：多个面板共用一个缓存，避免来回切标签各抓一次。 */
let lastPullAt = 0;
const MIN_PULL_INTERVAL_MS = 60_000;

function notify() {
  listeners.forEach((fn) => fn());
}

function snapshotFor(uid: string): HelperSnapshot {
  if (!cache || cache.uid !== uid) cache = readHelperSnapshot(uid);
  return cache;
}

function commit(next: HelperSnapshot) {
  cache = next;
  writeHelperSnapshot(next);
  notify();
}

export function subscribeHelperSnapshot(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 抓积分流水：先补最新，缓存不够时继续往回翻。 */
async function pullLedger(uid: string, opts: { full?: boolean; onPage?: (page: number) => void } = {}) {
  const current = snapshotFor(uid);
  const floor = fetchFloor();
  const full = opts.full === true || !current.rows.length || !cacheCoversFloor(current.rows, floor);
  let rows = current.rows;
  let pages = current.ledgerPages;
  let complete = current.ledgerComplete;
  let truncated = false;
  let cursor = 1;

  while (cursor <= MAX_PAGES) {
    const result = await api.pointsLedger(String(cursor));
    pages = Math.max(pages, cursor);
    opts.onPage?.(cursor);
    if (!result.items.length) {
      complete = true;
      break;
    }
    const fresh: LedgerRow[] = result.items.map((row) => ({ reason: row.reason, time: row.time, delta: row.delta }));
    const hitCache = overlapsCache(rows, fresh);
    rows = mergeLedgerRows(rows, fresh);
    // 增量模式：这一页已经和缓存重叠 = 老数据都在缓存里了，停
    if (!full && hitCache) {
      complete = true;
      break;
    }
    const oldest = fresh.reduce((min, row) => {
      const t = new Date(row.time).getTime();
      return Number.isNaN(t) ? min : Math.min(min, t);
    }, Number.POSITIVE_INFINITY);
    if (Number.isFinite(oldest) && oldest < floor) {
      truncated = true;
      complete = true;
      break;
    }
    if (!result.nextCursor) {
      complete = true;
      break;
    }
    cursor += 1;
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  }

  const next: HelperSnapshot = { ...current, uid, rows, ledgerPages: pages, ledgerComplete: complete, at: Date.now() };
  commit(next);
  return { pages, truncated, complete };
}

/** 抓通知并解析出合成条目（同样先补最新，命中缓存即停）。 */
async function pullSynth(uid: string, rarityOf: (name: string) => TitleRarity | '', opts: { full?: boolean } = {}) {
  const current = snapshotFor(uid);
  const floor = fetchFloor();
  const full = opts.full === true || !current.synth.length;
  let entries = current.synth;
  let complete = current.synthComplete;
  let cursor: string | null = null;

  for (let page = 0; page < NOTIFICATION_MAX_PAGES; page += 1) {
    const result = await api.notifications('全部', cursor);
    let older = false;
    const fresh: SynthEntry[] = [];
    const known = new Set(entries.map((entry) => entry.id));
    let hitCache = false;
    result.items.forEach((item) => {
      const t = new Date(item.createdAt).getTime();
      if (Number.isNaN(t) || t < floor) older = true;
      const entry = parseSynthNotification(item.text, item.id, item.createdAt, rarityOf);
      if (!entry) return;
      if (known.has(entry.id)) hitCache = true;
      fresh.push(entry);
    });
    entries = mergeSynthEntries(entries, fresh);
    if (!full && hitCache) {
      complete = true;
      break;
    }
    if (older || !result.nextCursor) {
      complete = true;
      break;
    }
    cursor = result.nextCursor;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  const next: HelperSnapshot = { ...snapshotFor(uid), uid, synth: entries, synthAt: Date.now(), synthComplete: complete };
  commit(next);
  return { complete };
}

export function useLedger(uid: string, enabled: boolean): LedgerLoader {
  const [snapshot, setSnapshot] = useState<HelperSnapshot>(() => (uid ? snapshotFor(uid) : EMPTY_SNAPSHOT()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => subscribeHelperSnapshot(() => setSnapshot(cache ?? EMPTY_SNAPSHOT(uid))), [uid]);

  const reload = useCallback((opts: { full?: boolean } = {}) => {
    if (!enabled || !uid || busyRef.current) return;
    if (!opts.full && Date.now() - lastPullAt < MIN_PULL_INTERVAL_MS) {
      setSnapshot(snapshotFor(uid));
      return;
    }
    busyRef.current = true;
    setLoading(true);
    setError('');
    setPage(0);
    void (async () => {
      try {
        lastPullAt = Date.now();
        await pullLedger(uid, { full: opts.full, onPage: setPage });
      } catch (err) {
        setError(err instanceof Error ? err.message : '积分流水抓取失败');
      } finally {
        busyRef.current = false;
        setLoading(false);
      }
    })();
  }, [enabled, uid]);

  useEffect(() => {
    if (!enabled || !uid) return;
    // 先读盘渲染，再后台补最新；缓存已经覆盖到七天前就不必再翻
    setSnapshot(snapshotFor(uid));
    reload({ full: false });
  }, [enabled, uid, reload]);

  const rows = snapshot.rows;
  return {
    rows,
    analysis: analyzeLedger(rows),
    loading,
    error,
    page,
    truncated: snapshot.ledgerComplete,
    at: snapshot.at,
    complete: snapshot.ledgerComplete,
    reload,
  };
}

export function ledgerRowsForRange(rows: LedgerRow[], range: LedgerRange): LedgerRow[] {
  const hit = LEDGER_RANGES.find((item) => item.id === range) ?? LEDGER_RANGES[0];
  const start = new Date();
  const lower = new Date(start.getFullYear(), start.getMonth(), start.getDate() - hit.days).getTime();
  if (range === 'yesterday') {
    const today = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    return rows.filter((row) => {
      const t = new Date(row.time).getTime();
      return !Number.isNaN(t) && t >= lower && t < today;
    });
  }
  return rows.filter((row) => {
    const t = new Date(row.time).getTime();
    return !Number.isNaN(t) && t >= lower;
  });
}

export function useLuckyStats(rows: LedgerRow[], uid: string, enabled: boolean): { stats: LuckyStats; repliesToday: number | null } {
  const [repliesToday, setRepliesToday] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !uid) return;
    let alive = true;
    void (async () => {
      const start = new Date();
      const lower = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
      let count = 0;
      let cursor: string | null = null;
      try {
        for (let page = 0; page < 3; page += 1) {
          const result = await api.userReplies(uid, cursor);
          let older = false;
          result.items.forEach((item) => {
            const t = new Date(item.createdAt).getTime();
            if (Number.isNaN(t) || t < lower) older = true;
            else count += 1;
          });
          if (older || !result.nextCursor) break;
          cursor = result.nextCursor;
        }
        if (alive) setRepliesToday(count);
      } catch {
        if (alive) setRepliesToday(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, uid]);
  return { stats: computeLucky(ledgerRowsForRange(rows, 'today')), repliesToday };
}

/** 称号名 → 级别：先用自己已有的称号（含池里抽到的），再用内置目录兜底。 */
export function useTitleRarityMap(enabled: boolean): (name: string) => TitleRarity | '' {
  const [map, setMap] = useState<Record<string, TitleRarity>>({});
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      try {
        const result = await api.titles();
        if (!alive) return;
        const next: Record<string, TitleRarity> = {};
        result.items.forEach((item) => {
          next[item.name] = item.rarity;
        });
        setMap(next);
      } catch {
        /* 拿不到就只靠内置目录 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);
  return useCallback((name: string) => map[name] ?? titleRarityOf(name, 'N'), [map]);
}

export type SynthLoader = {
  entries: SynthEntry[];
  summary: (range: RangeLabel) => SynthSummary;
  loading: boolean;
  error: string;
  at: number;
  complete: boolean;
  reload: (opts?: { full?: boolean }) => void;
};

export function useSynth(uid: string, enabled: boolean, rarityOf: (name: string) => TitleRarity | ''): SynthLoader {
  const [snapshot, setSnapshot] = useState<HelperSnapshot>(() => (uid ? snapshotFor(uid) : EMPTY_SNAPSHOT()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  useEffect(() => subscribeHelperSnapshot(() => setSnapshot(cache ?? EMPTY_SNAPSHOT(uid))), [uid]);

  const reload = useCallback((opts: { full?: boolean } = {}) => {
    if (!enabled || !uid || busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        await pullSynth(uid, rarityOf, { full: opts.full });
      } catch (err) {
        setError(err instanceof Error ? err.message : '通知抓取失败');
      } finally {
        busyRef.current = false;
        setLoading(false);
      }
    })();
  }, [enabled, uid, rarityOf]);

  useEffect(() => {
    if (!enabled || !uid) return;
    setSnapshot(snapshotFor(uid));
    reload({ full: false });
  }, [enabled, uid, reload]);

  return {
    entries: snapshot.synth,
    summary: (range: RangeLabel) => summarizeSynth(
      // summarizeSynth 吃通知形状；这里把已解析条目还原成最小通知对象，避免重复解析
      snapshot.synth.map((entry) => ({
        id: entry.id,
        kind: 'system' as const,
        actorName: '',
        actorAvatar: '',
        accent: '',
        text: entry.text,
        topicId: null,
        topicTitle: '',
        createdAt: entry.time,
        unread: false,
      })).filter((item) => isInRange(item.createdAt, range)),
      range,
      rarityOf,
    ),
    loading,
    error,
    at: snapshot.synthAt,
    complete: snapshot.synthComplete,
    reload,
  };
}

function isInRange(iso: string, range: RangeLabel): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const now = new Date();
  const floor = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime();
  if (range === '今日') return t >= floor(0);
  if (range === '昨日') return t >= floor(1) && t < floor(0);
  return t >= floor(6);
}

/* ── 称号监控：监控项与「已提醒挂单」的本地存储（体积很小，继续用 SecureStore） ── */

const MARKET_KEY = (uid: string) => `lsb.helper.market.v1.${uid}`;

export type MarketStore = {
  watches: MarketWatch[];
  notified: Record<string, string[]>;
};

export const EMPTY_MARKET_STORE: MarketStore = { watches: [], notified: {} };

export async function loadMarketStore(uid: string): Promise<MarketStore> {
  if (!uid) return EMPTY_MARKET_STORE;
  try {
    const raw = await secureGet(MARKET_KEY(uid));
    if (!raw) return EMPTY_MARKET_STORE;
    const parsed = JSON.parse(raw) as Partial<MarketStore>;
    const watches = Array.isArray(parsed.watches)
      ? parsed.watches
        .filter((item): item is MarketWatch => Boolean(item && typeof item.keyword === 'string'))
        .map((item, index) => ({
          id: String(item.id || `w${index}`),
          keyword: String(item.keyword),
          price: Number(item.price) || 0,
        }))
      : [];
    return { watches, notified: parsed.notified && typeof parsed.notified === 'object' ? parsed.notified : {} };
  } catch {
    return EMPTY_MARKET_STORE;
  }
}

export async function saveMarketStore(uid: string, store: MarketStore): Promise<void> {
  if (!uid) return;
  try {
    await secureSet(MARKET_KEY(uid), JSON.stringify(store));
  } catch {
    /* 写失败只是下次打开丢监控项 */
  }
}
