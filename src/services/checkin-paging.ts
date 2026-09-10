/**
 * 签到记录的分页装配（纯逻辑，不碰网络与存储）。
 *
 * 单独拆出来是为了能离线回归（`npm run check:checkin`）：这里的两条规则
 * 都踩过坑，且都不好看出来：
 *   1. 一批要抓哪几页 —— 游标就是页码，所以并发批次能直接推出来；
 *   2. **什么时候算抓到底** —— 只能看官方分页器（`hasRows` / `nextCursor`），
 *      不能看「这页筛出几条签到」，否则第 2 页（0 条签到）就把历史截断了。
 */
import type { CheckinRecord, CheckinSnapshot } from './checkin-store';
import { mergeCheckinRecords } from './checkin-store';

/** 路由 `/points/checkins` 返回的一页。 */
export type CheckinPageResult = {
  page: number;
  items: CheckinRecord[];
  nextCursor: string | null;
  /** 这一页上游有没有流水行（false = 已经翻过头了）。 */
  hasRows?: boolean;
  /** 分页器上的最后一页（官方给的，用来封顶并发批次）。 */
  lastPage?: number;
};

/**
 * 算出这一批该并发抓哪几页。
 *
 * 只是「推」出候选页码，不做存在性校验：真超范围的那页会返回 `hasRows: false`，
 * 由 `mergeCheckinBatch` 判定到底。
 */
export function planCheckinBatch(cursor: string | null, size: number, lastPage = 0): string[] {
  const out: string[] = [];
  let probe = cursor;
  while (probe && out.length < size) {
    const n = Number(probe);
    // 分页器写着最后一页是几就封顶，别去猜「下一页应该存在」
    if (lastPage > 0 && Number.isFinite(n) && n > lastPage) break;
    out.push(probe);
    probe = /^\d+$/.test(probe) ? String(n + 1) : null;
  }
  return out;
}

export type CheckinBatchState = {
  records: CheckinRecord[];
  /** 已抓到的最后一页页码。 */
  pages: number;
  /** 下一批从哪里开始；null = 不用再抓了。 */
  cursor: string | null;
  complete: boolean;
  /** 「累计签到」次数，凑够就可以收手（拿不到的页也不会白抓）。 */
  target: number;
  /** 分页器上的最后一页（0 = 还不知道）。 */
  lastPage: number;
};

/**
 * 合并一批（并发）页的结果，给出新状态。
 *
 * @param results 已完成的页；失败的传 null（跳过，不当作到底）
 */
export function mergeCheckinBatch(
  prev: CheckinBatchState,
  results: (CheckinPageResult | null)[],
): CheckinBatchState {
  let records = prev.records;
  let pages = prev.pages;
  let lastPage = prev.lastPage;
  let complete = false;
  let progressed = false;
  let lastCursor: string | null = null;
  results.forEach((data) => {
    if (!data) return;
    progressed = true;
    // 只有真有流水的页才算「抓到了第 N 页」，翻过头的空页不参与
    if (data.hasRows !== false) pages = Math.max(pages, Number(data.page) || pages);
    if (Number(data.lastPage) > lastPage) lastPage = Number(data.lastPage);
    records = mergeCheckinRecords(records, data.items);
    // 整页没有流水行 = 翻过头了；分页器没有「下一页」= 最后一页
    if (data.hasRows === false || !data.nextCursor) complete = true;
    if (data.nextCursor) lastCursor = data.nextCursor;
  });
  if (!progressed) complete = true;
  if (lastPage > 0 && pages >= lastPage) complete = true;
  const enough = prev.target > 0 && records.length >= prev.target;
  const done = complete || enough;
  return {
    records,
    pages,
    lastPage,
    cursor: done ? null : lastCursor,
    complete,
    target: prev.target,
  };
}

/** 从快照 + 第一页结果组装初始状态。 */
export function initialCheckinState(
  snapshot: CheckinSnapshot,
  first: { history: CheckinRecord[]; historyCursor?: string | null; total?: number; historyLastPage?: number },
): CheckinBatchState {
  const records = mergeCheckinRecords(snapshot.records, first.history);
  const cursor = first.historyCursor ?? null;
  return {
    records,
    pages: Math.max(snapshot.pages, 1),
    cursor,
    // 第一页就没有下一页 = 本来就只有这一页
    complete: !cursor,
    target: Number(first.total) || 0,
    lastPage: Math.max(1, Number(first.historyLastPage) || 1),
  };
}
