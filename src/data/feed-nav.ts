import type { FeedSort } from '../types/api';

/**
 * 首页排序 / 榜单入口的**唯一**来源。
 *
 * 以前这三份表分散在三处（`data.ts` 的标签、`services/api.ts` 的映射、
 * `services/live.ts` 的 URL 分支），任一处改了就对不上：官方换个排序 tab，
 * App 里要么没入口，要么悄悄退成「新评论」。这里合并成一张表：
 * 标签 ↔ App 内部 slug ↔ 官方路径 / 榜单 type。
 *
 * 官方实际路径（可对照 `npm run check:drift` 抓到的首页 tab-bar / 榜单 leaderboard-tab）：
 *   /index.php?sort=comment | post | lucky | card、/topic_featured、
 *   /unread_topic_notice_footprint、/topic_essence_review_list
 */

export type FeedTabDef = {
  label: string;
  /** App 内部排序标识（与官方路径一一对应）。 */
  slug: FeedSort;
  /** 官方列表页路径（不带版块与页码）。 */
  path: string;
  /** 仅登录可见（官方「足迹」）。 */
  authOnly?: boolean;
  /** 全局列表：与版块筛选无关，进了版块也走这个路径。 */
  global?: boolean;
};

export const FEED_TABS: FeedTabDef[] = [
  { label: '新评论', slug: 'latest_comment', path: '/index.php?sort=comment' },
  { label: '新帖子', slug: 'latest_topic', path: '/index.php?sort=post' },
  { label: '精华', slug: 'featured', path: '/topic_featured' },
  { label: '抽奖', slug: 'lottery', path: '/index.php?sort=lucky' },
  { label: '发卡', slug: 'card', path: '/index.php?sort=card' },
  { label: '足迹', slug: 'footprint', path: '/unread_topic_notice_footprint', authOnly: true, global: true },
  { label: '申精', slug: 'apply_featured', path: '/topic_essence_review_list', global: true },
];

/** 首页排序标签（顺序与官方 tab-bar 一致）。 */
export const sorts: string[] = FEED_TABS.map((tab) => tab.label);

export const FEED_TAB_BY_LABEL = new Map(FEED_TABS.map((tab) => [tab.label, tab]));
export const FEED_TAB_BY_SLUG = new Map(FEED_TABS.map((tab) => [tab.slug, tab]));

export function feedSlugOf(label: string): FeedSort {
  return FEED_TAB_BY_LABEL.get(label)?.slug ?? 'latest_comment';
}

export type LeaderboardTabDef = {
  label: string;
  /** 官方 `/leaderboard?type=` 的值。 */
  type: string;
};

/** 榜单入口（官方 `/leaderboard` 的 leaderboard-tab）。 */
export const LEADERBOARD_TABS: LeaderboardTabDef[] = [
  { label: '富豪榜', type: 'points' },
  { label: '评论榜', type: 'replies' },
  { label: '发帖榜', type: 'topics' },
  { label: '签到榜', type: 'checkin' },
  { label: '打赏榜', type: 'donation' },
];

export const LEADERBOARD_TYPES = LEADERBOARD_TABS.map((tab) => tab.type);

export function leaderboardTypeOf(label: string): string {
  return LEADERBOARD_TABS.find((tab) => tab.label === label)?.type ?? 'points';
}
