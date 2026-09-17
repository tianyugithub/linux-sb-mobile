/**
 * 「饼友助手」聚合逻辑的离线回归。
 *
 * 样本取自真实官网页面（通知文案、积分流水、市场挂牌），不联网。
 *
 *   npm run check:helper
 */
import { parseSynthNotification, summarizeSynth } from '../src/plugins/helper/synth';
import { analyzeLedger, computeLucky, formatDelta, type LedgerRow } from '../src/plugins/helper/points';
import { estimateLucky, parseLuckyRules, LUCKY_FALLBACK_RULES } from '../src/plugins/helper/lucky';
import { matchWatchList, pickFreshHits, type MarketWatch } from '../src/plugins/helper/market';
import { isInRangeLabel } from '../src/plugins/helper/range';
import {
  cacheCoversFloor,
  mergeLedgerRows,
  mergeSynthEntries,
  overlapsCache,
  snapshotAgeText,
} from '../src/plugins/helper/cache';
import type { NotificationDto, TitleListingDto } from '../src/types/api';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

/* ── 真实通知文案（来自 /user/<uid>?tab=notifications） ───────────────── */
const REAL_NOTIFICATIONS: string[] = [
  '你消耗了 56 个 SR 称号，批量熔炼获得 7 个 SSR：氪金大佬 ×3、全站偶像 ×3、传说之龙 ×1。',
  '你消耗了 99 个 R 称号，批量熔炼获得 33 个 SR：精华收割机 ×8、社交达人 ×9、论坛之星 ×6、键盘侠 ×5、万人迷 ×5。',
  '你消耗了 189 个 N 称号，批量熔炼获得 63 个 R：表情包大户 ×13、夜猫子 ×9、回复达人 ×11、话题王 ×21、常客 ×9。',
  '你回收了 9 个 SSR，今日回收价为每个 200 积分，共到账 1800 积分。可前往我的称号查看。',
  '在主题《称号价格这两天突然贬值这么多？》中提到你：@miapi #10 所以，还是看看人家就好了',
  '用户「南柯一梦」打赏了你的主题，积分+99',
];

const poolRarity: Record<string, string> = {
  氪金大佬: 'SSR', 全站偶像: 'SSR', 传说之龙: 'SSR',
  精华收割机: 'SR', 社交达人: 'SR', 论坛之星: 'SR', 键盘侠: 'SR', 万人迷: 'SR',
  表情包大户: 'R', 夜猫子: 'R', 回复达人: 'R', 话题王: 'R', 常客: 'R',
};
const rarityOf = (name: string) => (poolRarity[name] ?? '') as never;

console.log('饼友助手 · 聚合逻辑回归');

/* ── 1. 称号合成 ─────────────────────────────────────────────────── */
const first = parseSynthNotification(REAL_NOTIFICATIONS[0], 'n1', '2026-09-10T02:00:00.000Z', rarityOf);
check('熔炼通知能解析', Boolean(first));
check('消耗稀有度与个数', first?.consumed.length === 1 && first.consumed[0].rarity === 'SR' && first.consumed[0].count === 56, JSON.stringify(first?.consumed));
check('产出三条明细', first?.gains.length === 3, JSON.stringify(first?.gains));
check('产出标注级别（来自称号池）', Boolean(first?.gains.length) && first!.gains.every((gain) => gain.rarity === 'SSR'), JSON.stringify(first?.gains.map((g) => g.rarity)));
check('产出总数 = 明细之和', first?.gainTotal === 7, String(first?.gainTotal));

const quoted = parseSynthNotification('你消耗了 10 个 N 称号，合成了 UR 称号「非必要不抽奖」。', 'n2', '2026-09-10T03:00:00.000Z', rarityOf);
check('配方合成（引号写法）解析', Boolean(quoted));
check('引号写法个数=1（不会误取消耗数量）', quoted?.gains[0]?.count === 1 && quoted.gains[0].rarity === 'UR', JSON.stringify(quoted?.gains));

check('回收通知被过滤', parseSynthNotification(REAL_NOTIFICATIONS[3], 'n3', '', rarityOf) === null);
check('提及通知被过滤', parseSynthNotification(REAL_NOTIFICATIONS[4], 'n4', '', rarityOf) === null);
check('打赏通知被过滤', parseSynthNotification(REAL_NOTIFICATIONS[5], 'n5', '', rarityOf) === null);

const items: NotificationDto[] = REAL_NOTIFICATIONS.map((text, index) => ({
  id: `n${index}`,
  kind: 'system',
  actorName: '饼友',
  actorAvatar: '?',
  accent: '#6FA8FF',
  text,
  topicId: null,
  topicTitle: '',
  createdAt: `2026-09-10T0${index}:00:00.000Z`,
  unread: false,
}));
const summary = summarizeSynth(items, '今日', rarityOf);
check('合成统计：3 次合成', summary.count === 3, String(summary.count));
check('合成统计：消耗 344 个', summary.consumedTotal === 56 + 99 + 189, String(summary.consumedTotal));
check('合成统计：获得 103 个', summary.gainTotal === 7 + 33 + 63, String(summary.gainTotal));
check('合成统计：过滤 3 条非合成', summary.filtered === 3, String(summary.filtered));
check('消耗按级别汇总', summary.consumedByRarity.map((row) => `${row.rarity}:${row.count}`).join(',') === 'SR:56,R:99,N:189', JSON.stringify(summary.consumedByRarity));
check('产出按级别汇总', summary.gainsByRarity.map((row) => `${row.rarity}:${row.count}`).join(',') === 'SSR:7,SR:33,R:63', JSON.stringify(summary.gainsByRarity));

/* ── 2. 积分账本 ─────────────────────────────────────────────────── */
/* 用例时间必须落在「近七天」里：写死日期会随日历过期（2026-09-10 的夹具一过 7 天窗口，
   第 3 节的过滤就剩空集、三项全 0），一律按今天生成。 */
const atToday = (hour: number, minute = 0, second = 0) => {
  const d = new Date();
  d.setHours(hour, minute, second, 0);
  return d.toISOString();
};
const ledger: LedgerRow[] = [
  { reason: '每日签到', time: atToday(0, 5), delta: 10 },
  // 紧接着第二条签到：排序后与上一条相邻，用来验证「连续同类合并」
  { reason: '每日签到', time: atToday(0, 6), delta: 10 },
  { reason: '给用户「caicai」的主题打赏', time: atToday(1), delta: -20 },
  { reason: '幸运打赏奖励', time: atToday(1, 0, 30), delta: 60 },
  { reason: '购买称号：万人迷', time: atToday(2), delta: -300 },
  { reason: '发表回帖奖励', time: atToday(3), delta: 5 },
  { reason: '用户「南柯一梦」打赏了你的主题', time: atToday(4), delta: 99 },
];
const analysis = analyzeLedger(ledger);
check('收入合计', analysis.income === 10 + 10 + 60 + 5 + 99, String(analysis.income));
check('支出合计', analysis.expense === 20 + 300, String(analysis.expense));
check('净变化', analysis.net === analysis.income - analysis.expense, String(analysis.net));
check('分类桶正确', analysis.buckets.map((b) => `${b.label}:${b.amount}`).join(',') === '幸运奖励:60,被打赏:99,其他收入:25,称号系统:-300,打赏支出:-20', JSON.stringify(analysis.buckets.map((b) => `${b.label}:${b.amount}`)));
const checkinSegment = analysis.timeline.find((item) => item.key === 'checkin');
check('时间线连续同类合并（两条相邻签到合成一段）', analysis.timeline.length === 6 && checkinSegment?.count === 2, `段数=${analysis.timeline.length} 签到段=${checkinSegment?.count}`);
check('净变化格式化', formatDelta(-310) === '−310' && formatDelta(60) === '+60', `${formatDelta(-310)} ${formatDelta(60)}`);

/* ── 3. 幸运打赏 ─────────────────────────────────────────────────── */
const weekRows = ledger.filter((row) => isInRangeLabel(row.time, '近七天'));
check('用例时间落在近七天内（空集会让下面三项静默变 0）', weekRows.length === ledger.length, `${weekRows.length}/${ledger.length}`);
const lucky = computeLucky(weekRows);
check('打赏次数/花费', lucky.tips === 1 && lucky.spent === 20, `${lucky.tips}/${lucky.spent}`);
check('幸运奖励次数与金额', lucky.lucky === 1 && lucky.luckyGained === 60, `${lucky.lucky}/${lucky.luckyGained}`);
check('收到打赏次数', lucky.received === 1, String(lucky.received));

const locked = estimateLucky(lucky, 3);
check('回帖不足 → 概率锁定', locked.locked === true && locked.prob === 0, locked.note);
const over = estimateLucky({ ...lucky, lucky: 10 }, 999999);
check('达到每日上限 → 不触发', over.tier === 'over', over.note);
const zero = estimateLucky({ ...lucky, luckyGained: 1200, lucky: 2 }, 999999);
check('累计奖励超阈值 → 概率归零', zero.prob === 0 && zero.tier === 'over', zero.note);
const low = estimateLucky({ ...lucky, luckyGained: 60, lucky: 2 }, 999999);
check('正常档位给初始概率', low.prob === LUCKY_FALLBACK_RULES.baseProb && low.tier === 'low', `${low.prob}% ${low.note}`);

const parsedRules = parseLuckyRules('幸运打赏规则：每日最多 8 次，单日累计 800 积分后中奖率归 0，回帖 5 次解锁，中奖率为 40%，倍率 2-30。');
check('规则帖数字解析', parsedRules.dailyCap === 8 && parsedRules.highThreshold === 800 && parsedRules.replyCap === 5, JSON.stringify(parsedRules));
check('规则帖解析不到时保留兜底', parseLuckyRules('本页没有数字').dailyCap === LUCKY_FALLBACK_RULES.dailyCap);

/* ── 4. 称号监控 ─────────────────────────────────────────────────── */
const watches: MarketWatch[] = [
  { id: 'w1', keyword: '万人迷', price: 300 },
  { id: 'w2', keyword: '龙', price: 1000 },
];
const listings: TitleListingDto[] = [
  { id: 'l1', name: '万人迷', rarity: 'SR', price: 320, stock: 1, remain: '2 天', max: 1 },
  { id: 'l2', name: '万人迷', rarity: 'SR', price: 280, stock: 2, remain: '1 天', max: 2 },
  { id: 'l3', name: '传说之龙', rarity: 'SSR', price: 900, stock: 1, remain: '3 天', max: 1 },
  { id: 'l4', name: '夜猫子', rarity: 'R', price: 50, stock: 1, remain: '5 小时', max: 1 },
];
const hits = matchWatchList(watches, listings);
check('部分匹配 + 价格阈值命中 2 项', hits.length === 2, JSON.stringify(hits.map((hit) => `${hit.watch.keyword}→${hit.listing.name}@${hit.listing.price}`)));
check('每个监控项只报最便宜的一条', hits[0].listing.id === 'l2', hits[0].listing.id);
check('不达标不命中（夜猫子不在监控里 / 万人迷 320 超阈值的那条被价格过滤）', !hits.some((hit) => hit.listing.id === 'l1'));

const live = new Set(listings.map((item) => item.id));
const round1 = pickFreshHits(hits, {}, live);
check('首次命中全部要提醒', round1.fresh.length === 2, String(round1.fresh.length));
const round2 = pickFreshHits(hits, round1.notified, live);
check('同一挂单不再重复提醒', round2.fresh.length === 0, String(round2.fresh.length));
const round3 = pickFreshHits(hits, round2.notified, new Set(['l3']));
check('下架后清掉记录（重新上架会再提醒）', round3.fresh.length === 1 && round3.fresh[0].listing.id === 'l2', JSON.stringify(round3.fresh.map((hit) => hit.listing.id)));

/* ── 5. 增量抓取：缓存合并与「命中缓存即停」 ─────────────────────── */
const cachedRows: LedgerRow[] = [
  { reason: '每日签到', time: '2026-09-09T00:05:00.000Z', delta: 10 },
  { reason: '给用户「caicai」的主题打赏', time: '2026-09-09T02:00:00.000Z', delta: -20 },
  { reason: '购买称号：万人迷', time: '2026-09-08T02:00:00.000Z', delta: -300 },
];
const pageOne: LedgerRow[] = [
  { reason: '发表回帖奖励', time: '2026-09-10T03:00:00.000Z', delta: 5 },
  { reason: '每日签到', time: '2026-09-09T00:05:00.000Z', delta: 10 },   // 与缓存重叠
  { reason: '给用户「caicai」的主题打赏', time: '2026-09-09T02:00:00.000Z', delta: -20 },
];
check('增量：第一页与缓存重叠 → 可以停', overlapsCache(cachedRows, pageOne) === true);
check('增量：全新数据不算重叠（继续往下抓）', overlapsCache(cachedRows, [{ reason: '新', time: '2026-09-10T09:00:00.000Z', delta: 1 }]) === false);
check('增量：缓存为空时不算重叠', overlapsCache([], pageOne) === false);
const merged = mergeLedgerRows(cachedRows, pageOne);
check('合并去重（3 条缓存 + 3 条新页 − 2 条重复 = 4 条）', merged.length === 4, String(merged.length));
check('合并后按时间倒序', merged.map((row) => row.time).join(' > ') === [...merged].map((row) => row.time).sort().reverse().join(' > '), merged.map((row) => row.time.slice(5, 16)).join(' , '));
const floor = new Date(Date.now() - 6 * 24 * 3600 * 1000).getTime();
check('缓存已覆盖七天前 → 不必全量重抓', cacheCoversFloor([{ reason: 'x', time: new Date(floor - 3600_000).toISOString(), delta: 1 }], floor) === true);
check('缓存没覆盖到七天前 → 需要补抓', cacheCoversFloor([{ reason: 'x', time: new Date().toISOString(), delta: 1 }], floor) === false);

const cachedSynth = parseSynthNotification(REAL_NOTIFICATIONS[0], 'n1', '2026-09-10T02:00:00.000Z', rarityOf)!;
const freshSynth = parseSynthNotification(REAL_NOTIFICATIONS[0], 'n1', '2026-09-10T02:00:00.000Z', rarityOf)!;
check('合成条目按通知 id 去重', mergeSynthEntries([cachedSynth], [freshSynth]).length === 1);
check('合成条目合并保留新记录', mergeSynthEntries([cachedSynth], [parseSynthNotification(REAL_NOTIFICATIONS[1], 'n2', '2026-09-10T01:00:00.000Z', rarityOf)!]).length === 2);
check('缓存时间文案', snapshotAgeText(Date.now() - 30_000) === '刚刚更新' && snapshotAgeText(0) === '还没有缓存', `${snapshotAgeText(Date.now() - 30_000)} / ${snapshotAgeText(0)}`);

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
