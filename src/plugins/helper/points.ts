/**
 * 积分账本的聚合逻辑（纯函数，无 UI / 无网络）。
 *
 * 与 App 原有的「签到历史」不同，这里要的是**完整流水**：
 * 每条记录 = {reason, time, delta}，分类规则照搬 LINUX.SB助手脚本，
 * 再归成「收入：幸运奖励 / 被打赏 / 其他」「支出：称号系统 / 打赏支出 / 其他」。
 */

export type LedgerRange = 'today' | 'yesterday' | 'week';

export const LEDGER_RANGES: { id: LedgerRange; label: string; days: number }[] = [
  { id: 'today', label: '今日', days: 0 },
  { id: 'yesterday', label: '昨日', days: 1 },
  { id: 'week', label: '近七天', days: 6 },
];

export type LedgerRow = {
  reason: string;
  /** ISO 时间（官网 datetime 属性）。 */
  time: string;
  delta: number;
};

type CategoryRule = { key: string; label: string; re: RegExp };

/** 与脚本一致的分类规则（顺序敏感：先匹配先算）。 */
const RULES: CategoryRule[] = [
  { key: 'donate_out', label: '打赏用户', re: /^给用户「.+?」的主题打赏$/ },
  { key: 'donate_in', label: '被打赏', re: /^用户「.+?」打赏了你的主题$/ },
  { key: 'lucky', label: '幸运奖励', re: /幸运(?:打赏)?奖励/ },
  { key: 'gacha', label: '抽奖', re: /十连抽|百连抽|十抽|抽奖|称号系统/ },
  { key: 'title_buy', label: '称号购买', re: /购买称号/ },
  { key: 'checkin', label: '每日签到', re: /每日签到|签到/ },
  { key: 'topic', label: '发表主题', re: /发表主题/ },
  { key: 'reply', label: '发表回帖', re: /发表回帖|回帖奖励/ },
  { key: 'search', label: '搜索', re: /搜索/ },
  { key: 'direct', label: '私信', re: /私信/ },
  { key: 'attachment', label: '下载附件', re: /附件/ },
];

export const TIP_RE = /^给用户「(.+?)」的主题打赏$/;
export const LUCKY_RE = /幸运(?:打赏)?奖励/;
export const RECEIVED_RE = /^用户「.+?」打赏了你的主题$/;

export type LedgerBucketKey =
  | 'in_lucky' | 'in_donate' | 'in_other'
  | 'out_gacha' | 'out_donate' | 'out_other';

export const BUCKET_LABEL: Record<LedgerBucketKey, string> = {
  in_lucky: '幸运奖励',
  in_donate: '被打赏',
  in_other: '其他收入',
  out_gacha: '称号系统',
  out_donate: '打赏支出',
  out_other: '其他支出',
};

function startOfDay(offset: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset).getTime();
}

export function rangeFloor(range: LedgerRange): number {
  const hit = LEDGER_RANGES.find((item) => item.id === range) ?? LEDGER_RANGES[0];
  return startOfDay(hit.days);
}

export function inRange(iso: string, range: LedgerRange): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const lower = rangeFloor(range);
  if (range === 'yesterday') return t >= lower && t < startOfDay(0);
  return t >= lower;
}

/** 抓取下界：一次性抓够最宽范围（近七天）。 */
export function fetchFloor(): number {
  return startOfDay(6);
}

export type LedgerTimelineEntry = {
  key: string;
  label: string;
  count: number;
  amount: number;
  start: string;
  end: string;
};

export type LedgerAnalysis = {
  income: number;
  expense: number;
  net: number;
  count: number;
  buckets: { key: LedgerBucketKey; label: string; amount: number; count: number }[];
  timeline: LedgerTimelineEntry[];
  topReasons: { label: string; amount: number; count: number }[];
};

function categorize(row: LedgerRow): CategoryRule {
  for (const rule of RULES) {
    if (rule.re.test(row.reason)) return rule;
  }
  return row.delta >= 0
    ? { key: 'other_in', label: '其他收入', re: /$^/ }
    : { key: 'other_out', label: '其他支出', re: /$^/ };
}

function bucketFor(cat: CategoryRule, delta: number): LedgerBucketKey {
  if (delta >= 0) {
    if (cat.key === 'lucky') return 'in_lucky';
    if (cat.key === 'donate_in') return 'in_donate';
    return 'in_other';
  }
  if (cat.key === 'gacha' || cat.key === 'title_buy') return 'out_gacha';
  if (cat.key === 'donate_out') return 'out_donate';
  return 'out_other';
}

/** 与脚本 analyze() 对齐：收支合计、分类占比、时间线（连续同类合并）、原因排行。 */
export function analyzeLedger(rows: LedgerRow[]): LedgerAnalysis {
  let income = 0;
  let expense = 0;
  const bucketMap = new Map<LedgerBucketKey, { amount: number; count: number }>();
  const reasonMap = new Map<string, { amount: number; count: number }>();

  rows.forEach((row) => {
    if (row.delta >= 0) income += row.delta;
    else expense += Math.abs(row.delta);
    const cat = categorize(row);
    const key = bucketFor(cat, row.delta);
    const bucket = bucketMap.get(key) ?? { amount: 0, count: 0 };
    bucket.amount += row.delta;
    bucket.count += 1;
    bucketMap.set(key, bucket);
    const reason = reasonMap.get(cat.label) ?? { amount: 0, count: 0 };
    reason.amount += row.delta;
    reason.count += 1;
    reasonMap.set(cat.label, reason);
  });

  const order: LedgerBucketKey[] = ['in_lucky', 'in_donate', 'in_other', 'out_gacha', 'out_donate', 'out_other'];
  const buckets = order
    .filter((key) => bucketMap.has(key))
    .map((key) => ({
      key,
      label: BUCKET_LABEL[key],
      amount: bucketMap.get(key)?.amount ?? 0,
      count: bucketMap.get(key)?.count ?? 0,
    }));

  const sorted = rows.slice().sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const timeline: LedgerTimelineEntry[] = [];
  sorted.forEach((row) => {
    const cat = categorize(row);
    const last = timeline[timeline.length - 1];
    if (last && last.key === cat.key) {
      last.count += 1;
      last.amount += row.delta;
      last.end = row.time;
      return;
    }
    timeline.push({ key: cat.key, label: cat.label, count: 1, amount: row.delta, start: row.time, end: row.time });
  });

  const topReasons = [...reasonMap.entries()]
    .map(([label, item]) => ({ label, amount: item.amount, count: item.count }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 8);

  return {
    income,
    expense,
    net: income - expense,
    count: rows.length,
    buckets,
    timeline: timeline.slice(0, 200),
    topReasons,
  };
}

/** 打赏相关统计（幸运打赏模块与积分账本共用同一批数据）。 */
export type LuckyStats = {
  tips: number;
  spent: number;
  lucky: number;
  luckyGained: number;
  received: number;
  players: string[];
  distinctPlayers: number;
  duplicateTips: number;
};

export function computeLucky(rows: LedgerRow[]): LuckyStats {
  const stats: LuckyStats = {
    tips: 0, spent: 0, lucky: 0, luckyGained: 0, received: 0,
    players: [], distinctPlayers: 0, duplicateTips: 0,
  };
  const distinct = new Set<string>();
  rows.forEach((row) => {
    const tip = row.reason.match(TIP_RE);
    if (tip) {
      stats.tips += 1;
      stats.spent += Math.abs(row.delta);
      stats.players.push(tip[1]);
      if (distinct.has(tip[1])) stats.duplicateTips += 1;
      distinct.add(tip[1]);
      return;
    }
    if (LUCKY_RE.test(row.reason)) {
      stats.lucky += 1;
      stats.luckyGained += Math.max(0, row.delta);
      return;
    }
    if (RECEIVED_RE.test(row.reason)) stats.received += 1;
  });
  stats.distinctPlayers = distinct.size;
  return stats;
}

export function formatDelta(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}`;
}

export function fmtDayTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
