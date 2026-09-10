/**
 * 三个模块共用的时间范围（与脚本的 today / yesterday / week 一致）。
 */
export const RANGE_CHIPS = ['今日', '昨日', '近七天'] as const;
export type RangeLabel = (typeof RANGE_CHIPS)[number];

export function rangeStart(daysBack: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime();
}

export function isInRangeLabel(iso: string, label: RangeLabel): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (label === '今日') return t >= rangeStart(0);
  if (label === '昨日') return t >= rangeStart(1) && t < rangeStart(0);
  return t >= rangeStart(6);
}
