import type { TitleListingDto } from '../../types/api';

/**
 * 称号监控：按「称号名（支持部分匹配）+ 期望价」盯交易市场最新挂牌。
 *
 * 与脚本一致的判定：
 *   - 名称命中 = 挂牌称号名包含关键词（不区分大小写）；
 *   - 价格命中 = 单价 ≤ 期望价；
 *   - 同一挂单只提醒一次（按 listing id 去重），下架/涨价后清掉「已提醒」标记。
 */

export type MarketWatch = {
  /** 本地 id，便于增删改。 */
  id: string;
  keyword: string;
  price: number;
};

export type MarketHit = {
  watch: MarketWatch;
  listing: TitleListingDto;
};

export function normalizeKeyword(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function watchMatches(watch: MarketWatch, listing: TitleListingDto): boolean {
  const keyword = normalizeKeyword(watch.keyword);
  if (!keyword) return false;
  if (!listing.name.toLocaleLowerCase().includes(keyword)) return false;
  if (!Number.isFinite(listing.price) || listing.price <= 0) return false;
  return listing.price <= watch.price;
}

/** 每个监控项只报当前页里最便宜的那条（与脚本一致）。 */
export function matchWatchList(watches: MarketWatch[], listings: TitleListingDto[]): MarketHit[] {
  const hits: MarketHit[] = [];
  watches.forEach((watch) => {
    let best: TitleListingDto | null = null;
    listings.forEach((listing) => {
      if (!watchMatches(watch, listing)) return;
      if (!best || listing.price < best.price) best = listing;
    });
    if (best) hits.push({ watch, listing: best });
  });
  return hits;
}

/**
 * 过滤掉已经提醒过的挂单；返回需要提醒的命中。
 * `notified` 会被就地更新：新增本轮通知的 id，并清掉已经不在挂牌里的旧 id。
 */
export function pickFreshHits(
  hits: MarketHit[],
  notified: Record<string, string[]>,
  liveListingIds: Set<string>,
): { fresh: MarketHit[]; notified: Record<string, string[]> } {
  const next: Record<string, string[]> = {};
  const fresh: MarketHit[] = [];
  hits.forEach((hit) => {
    const previous = (notified[hit.watch.id] ?? []).filter((id) => liveListingIds.has(id));
    if (!previous.includes(hit.listing.id)) fresh.push(hit);
    next[hit.watch.id] = [...new Set([...previous, hit.listing.id])];
  });
  return { fresh, notified: next };
}

export function describeWatch(watch: MarketWatch): string {
  return `${watch.keyword} ≤ ${watch.price}`;
}
