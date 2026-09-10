/**
 * 首页「每日热帖」解析的离线回归。
 *
 * 样本照抄官网首页侧栏（`card sidebar-card quick-card daily-hot-topics-card`），不联网。
 *
 * 这块数据**本来就在 App 抓的首页 HTML 里**（`/index.php?sort=comment` 每页都带 8 条），
 * 所以放首页展示是零额外请求；这个脚本守住三件事：
 *   1. 三条锚点（title / count / href）还能解析出 id、标题、回复数、统计窗口；
 *   2. 「精华 / 足迹」这两个模板没有这块 → 返回 null，页面保留上一次结果（不能闪掉）；
 *   3. 卡片在、却一条都解不出来 → 返回空数组，让 live.ts 的解析哨兵报「官网可能改版」。
 *
 *   npm run check:hot
 */
import { parseDailyHotTopics } from '../src/services/live';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

/* ── 真实标记（取自 linux.sb 首页，取前 3 条） ───────────────────────── */
const HEAD = '<div class="card sidebar-card quick-card daily-hot-topics-card"><div class="quick-wrap">'
  + '<div class="daily-hot-topics-head"><div class="quick-title">每日热帖</div><span>近 24 小时</span></div>'
  + '<ul class="quick-links daily-hot-topics-list">';
const ROW = (id: string, title: string, count: string) => (
  `<li><a href="/topic/${id}"><span class="daily-hot-topics-content">`
  + `<span class="daily-hot-topics-title">${title}</span>`
  + `<span class="daily-hot-topics-count">${count}</span></span></a></li>`
);
const REAL = HEAD
  + ROW('20948', '随机抽些称号奖吧   评论随机送', '近 24 小时 177 回复')
  + ROW('20784', '给烧饼站发展路上的一些小建议和最近事件的整理', '近 24 小时 111 回复')
  + ROW('20953', '【幸运打赏活动下线通知】感谢大家的参与！本次幸运打赏活动告一段落！', '近 24 小时 78 回复')
  + '</ul></div></div>'
  + '<div class="card sidebar-card stats-card">站点统计：主题 11479 · 回复 171480</div>';

console.log('首页 · 每日热帖解析回归');

const items = parseDailyHotTopics(REAL);
check('能解析出卡片里的每一条', items?.length === 3, String(items?.length));
check('第一条 id', items?.[0]?.id === '20948', items?.[0]?.id);
check('标题原样（含连续空格）', items?.[0]?.title === '随机抽些称号奖吧   评论随机送', JSON.stringify(items?.[0]?.title));
check('回复数取数字', items?.[0]?.replies === 177, String(items?.[0]?.replies));
check('统计窗口来自卡片头部', items?.[0]?.window === '近 24 小时', items?.[0]?.window);
check('官方顺序不重排（按 24 小时回复数）', items?.map((item) => item.replies).join(',') === '177,111,78', items?.map((item) => item.replies).join(','));
check('只认热帖列表，不会把站点统计当成热帖', items?.every((item) => /^\d+$/.test(item.id)) === true);

/* ── 没有这块的模板（精华 / 足迹） ───────────────────────────────── */
const NO_CARD = '<div class="card sidebar-card stats-card">站点统计：主题 11479</div>';
check('没有热帖卡片时返回 null（页面保留上一次结果）', parseDailyHotTopics(NO_CARD) === null);
check('空 HTML 返回 null', parseDailyHotTopics('') === null);

/* ── 卡片在但结构变了 → 空数组，哨兵会报错 ───────────────────────── */
const BROKEN = HEAD + '<li><a href="/topic/1"><span class="something-else">变了</span></a></li></ul>';
check('卡片在但解不出条目 → 空数组（交给哨兵报官网改版）', Array.isArray(parseDailyHotTopics(BROKEN)) && parseDailyHotTopics(BROKEN)!.length === 0);

/* ── 边界 ───────────────────────────────────────────────────────── */
const entities = parseDailyHotTopics(HEAD + ROW('21000', 'A &amp; B &quot;引号&quot; &#39;撇&#39;', '近 24 小时 12 回复') + '</ul>');
check('标题里的实体被解码', entities?.[0]?.title === 'A & B "引号" \'撇\'', JSON.stringify(entities?.[0]?.title));
const noCount = parseDailyHotTopics(HEAD + ROW('21001', '只有标题', '近 24 小时 回复') + '</ul>');
check('回复数缺失时按 0 处理，不崩', noCount?.[0]?.replies === 0 && noCount?.[0]?.window === '近 24 小时', JSON.stringify(noCount?.[0]));
const missingId = parseDailyHotTopics(HEAD + '<li><a href="/topic/"><span class="daily-hot-topics-title">没有 id</span></a></li>' + ROW('21002', '正常一条', '近 24 小时 5 回复') + '</ul>');
check('缺 id 的条目被丢掉，其余照常', missingId?.length === 1 && missingId[0].id === '21002', JSON.stringify(missingId?.map((item) => item.id)));
const headless = parseDailyHotTopics(
  '<ul class="quick-links daily-hot-topics-list">' + ROW('21003', '没有头部', '近 24 小时 9 回复') + '</ul>',
);
check('没有头部时窗口回退到行内文案', headless?.[0]?.window === '近 24 小时', JSON.stringify(headless?.[0]));

console.log(fails ? `\n✗ 未通过：${fails} 项` : '\n✓ 通过：每日热帖解析正常');
process.exit(fails ? 1 : 0);
