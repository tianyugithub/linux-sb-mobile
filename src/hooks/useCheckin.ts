import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { PointsDto } from '../types/api';
import {
  checkinAgeText,
  readCheckinSnapshot,
  writeCheckinSnapshot,
  type CheckinRecord,
  type CheckinSnapshot,
} from '../services/checkin-store';
import {
  initialCheckinState,
  mergeCheckinBatch,
  planCheckinBatch,
  type CheckinBatchState,
} from '../services/checkin-paging';

/**
 * 签到数据加载：**首屏一个往返，历史后台并发补齐 + 落盘**。
 *
 * 为什么这么设计：
 *   - 签到一天才 1 条，记录散在几百条流水里；要列全 10 条得翻 8 页（实测第 8 页才有 6 条）；
 *   - 串行翻 8 页实测 6.3 秒，用户等不起；
 *   - 所以首屏只并行取「签到页 + 流水第 1 页」（路由内部已经并行），立刻能显示状态与最近记录；
 *   - 剩下的页**每批 3 页并发**在后台补，边到边显示，每批落盘一次；
 *   - 下次进来先读盘秒开（完整列表），再只补第 1 页把最新的并进去。
 *
 * 两条踩过的坑，别改回去：
 *   1. 翻页的结束信号是官方分页器（`hasRows` / `nextCursor`），**不是**「这页筛出几条签到」——
 *      第 2、4、6 页一条签到都没有，用筛选结果判断会在第 2 页就把历史截断。
 *   2. `reload` 不能把 `points` 放进依赖：`setPoints` 会让 `reload` 换标识，
 *      而 effect 依赖 `reload`，于是每次拉完又触发一次，变成自激循环。状态改用 ref 存。
 */

/** 每批并发几页。官网每页 50 条流水、单页 ~0.7s，3 页并发够快又不至于压官网。 */
const BATCH = 3;
/** 兜底上限：真出问题也不会无限翻页。 */
const MAX_PAGES = 40;
/** 多久之内不重新补历史（只补第 1 页）。 */
const FRESH_TTL_MS = 10 * 60_000;

export type CheckinLoader = {
  points: PointsDto | null;
  records: CheckinRecord[];
  loading: boolean;
  /** 后台还在补齐历史。 */
  filling: boolean;
  error: string;
  /** 已抓到的最后一页页码。 */
  pages: number;
  /** 历史是否已经抓到底。 */
  complete: boolean;
  /** 快照时间戳（用于「x 分钟前更新」）。 */
  at: number;
  reload: (opts?: { full?: boolean }) => void;
};

let cache: CheckinSnapshot | null = null;
let lastPullAt = 0;

function snapshotFor(uid: string): CheckinSnapshot {
  if (!cache || cache.uid !== uid) cache = readCheckinSnapshot(uid);
  return cache;
}

function commit(next: CheckinSnapshot) {
  cache = next;
  writeCheckinSnapshot(next);
}

export function useCheckin(uid: string, loggedIn: boolean): CheckinLoader {
  const [points, setPoints] = useState<PointsDto | null>(null);
  const [snapshot, setSnapshot] = useState<CheckinSnapshot>(() => readCheckinSnapshot(uid));
  const [loading, setLoading] = useState(false);
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const hasDataRef = useRef(false);
  /** 补齐还在跑时用户又点了刷新/签到 → 记下来，等这一轮结束再补拉一次，别把请求丢掉。 */
  const pendingRef = useRef<{ full?: boolean } | null>(null);
  const startRef = useRef<(opts: { full?: boolean }) => void>(() => {});
  /** 换账号时旧请求回来就别再写了。 */
  const uidRef = useRef(uid);
  uidRef.current = uid;

  const publish = (next: CheckinSnapshot) => {
    commit(next);
    if (uidRef.current === next.uid) setSnapshot(next);
  };

  const reload = useCallback((opts: { full?: boolean } = {}) => {
    if (!loggedIn || !uid) return;
    if (busyRef.current) {
      // 后台补齐通常要几秒，这期间点「签到」「刷新」不能白点
      pendingRef.current = opts;
      return;
    }
    const start = (options: { full?: boolean }) => {
      busyRef.current = true;
      const local = snapshotFor(uid);
      setSnapshot(local);
      setError('');
      setLoading(!hasDataRef.current && local.records.length === 0);
      // 盘上的快照也算「刚拉过」，否则每次冷启动都要重翻 8 页
      const seenAt = Math.max(lastPullAt, local.at);
      const stale = options.full === true || Date.now() - seenAt > FRESH_TTL_MS;
      void (async () => {
        try {
          // ① 首屏：签到页（新鲜）+ 流水第 1 页（路由内部并行）
          const first = await api.points({ history: true });
          if (uidRef.current !== uid) return;
          lastPullAt = Date.now();
          setPoints(first);
          hasDataRef.current = true;
          // 盘上已经抓到底、也没过期 → 只把最新的并进来，不再翻页
          const state = initialCheckinState(local, {
            history: first.history as CheckinRecord[],
            historyCursor: first.historyCursor,
            total: first.total,
            historyLastPage: first.historyLastPage,
          });
          if (local.complete && !stale) state.cursor = null;
          let current: CheckinBatchState = { ...state, complete: state.complete || local.complete };
          publish({ uid, records: current.records, pages: current.pages, complete: current.complete, at: Date.now() });
          setLoading(false);
          if (!current.cursor) {
            publish({ uid, records: current.records, pages: current.pages, complete: true, at: Date.now() });
            return;
          }

          // ② 后台补齐：每批 3 页并发（规则见 services/checkin-paging.ts）
          setFilling(true);
          while (current.cursor && current.pages < MAX_PAGES && uidRef.current === uid) {
            const batch = planCheckinBatch(current.cursor, BATCH, current.lastPage);
            const results = await Promise.allSettled(batch.map((page) => api.checkinPage(page)));
            current = mergeCheckinBatch(
              current,
              results.map((result) => (result.status === 'fulfilled' ? result.value : null)),
            );
            publish({ uid, records: current.records, pages: current.pages, complete: current.complete, at: Date.now() });
            if (!current.cursor) break;
            if (current.pages >= MAX_PAGES) break;
          }
          publish({ uid, records: current.records, pages: current.pages, complete: true, at: Date.now() });
        } catch (err) {
          if (uidRef.current === uid) {
            setError(err instanceof Error ? err.message : '签到数据加载失败');
          }
        } finally {
          if (uidRef.current === uid) {
            setFilling(false);
            setLoading(false);
          }
          busyRef.current = false;
          const queued = pendingRef.current;
          pendingRef.current = null;
          if (queued) startRef.current(queued);
        }
      })();
      };
    startRef.current = start;
    start(opts);
  }, [loggedIn, uid]);

  useEffect(() => {
    if (!loggedIn || !uid) return;
    setSnapshot(snapshotFor(uid));
    reload({ full: false });
  }, [loggedIn, uid, reload]);

  return {
    points,
    records: snapshot.records,
    loading,
    filling,
    error,
    pages: snapshot.pages,
    complete: snapshot.complete,
    at: snapshot.at,
    reload,
  };
}

export { checkinAgeText };
