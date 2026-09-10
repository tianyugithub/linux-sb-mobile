/**
 * 签到中心 · 数据装配的离线回归。
 *
 * 样本是真实官网页面的标记（`li.post-item.points-rewards-detail` + 官方分页器），不联网。
 *
 * 这里盯的是两个真踩过的坑：
 *   1. **第 2 页 0 条签到就把历史截断**：签到一天才 1 条，中间第 2、4、6 页一条都没有；
 *      曾经用「筛出来的条数」当翻页信号，于是只抓到 1 条。
 *   2. **首屏请求数**：首屏必须只有 1 个往返（签到页 + 流水第 1 页，路由内部并行），
 *      历史靠后台分批并发补，且每批只抓 3 页。
 *
 *   npm run check:checkin
 */
import { parseCheckinPage } from '../src/services/live';
import {
  initialCheckinState,
  mergeCheckinBatch,
  planCheckinBatch,
  type CheckinBatchState,
} from '../src/services/checkin-paging';
import {
  checkinAgeText,
  checkinDayMap,
  checkinRecordMeta,
  mergeCheckinRecords,
  EMPTY_CHECKIN_SNAPSHOT,
  type CheckinRecord,
} from '../src/services/checkin-store';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

/* ── 真实标记（取自 /user/10695?tab=points_rewards） ─────────────────── */
const row = (reason: string, datetime: string, gain: string) => (
  '<li class="post-item points-rewards-detail positive">'
  + '<div class="post-avatar points-rewards-avatar"><a class="avatar-profile-link" href="/user/10695">'
  + '<img class="avatar-img" src="/app/avatars/fun-emoji_36.svg" alt="miapi" loading="lazy"></a></div>'
  + '<div class="points-rewards-detail-main">'
  + `<strong class="points-rewards-reason">${reason}</strong>`
  + `<div class="points-rewards-detail-meta"><time class="points-rewards-time" datetime="${datetime}">${datetime.slice(0, 16).replace('T', ' ')}</time></div>`
  + '</div>'
  + '<div class="points-rewards-detail-side">'
  + `<span class="points-rewards-change-value positive"><b>${gain}</b><small>积分</small></span></div></li>`
);
const CHECKIN_ROW = (day: string, gain = '+40') => row('每日签到', `${day}T00:16:54+08:00`, gain);
const REPLY_ROW = (datetime: string) => row('主题《ip地址太垃圾，会被x拒绝登录》中的回帖收到投币', datetime, '+5');

/** 官方分页器：只列出「当前页附近 + 首末页」，最后一页没有下一页链接。 */
const pager = (page: number, last: number) => {
  const links: string[] = [];
  for (let n = Math.max(1, page - 1); n <= Math.min(last, page + 1); n += 1) {
    links.push(`<li${n === page ? ' class="active"' : ''}><a href="/user/10695?tab=points_rewards&amp;p=${n}">${n}</a></li>`);
  }
  if (last > page + 1) links.push('<li><span class="ellipsis">...</span></li>', `<li><a href="/user/10695?tab=points_rewards&amp;p=${last}">${last}</a></li>`);
  return `<div class="pagination-bar"><div class="pagination"><ul>${links.join('')}</ul></div></div>`;
};

/**
 * 造一页：`checkins` 条签到 + 若干普通回帖行，页内共 `size` 行（官网每页 50 条）。
 * 每页的行数与签到位置都照抄实测数据：p1..p8 的签到条数是 [1,0,1,0,1,0,1,6]，最后一页 33 行。
 */
function pageHtml(page: number, checkins: number, size: number, last: number): string {
  const rows: string[] = [];
  // 签到行落在页首（官网按时间倒序，签到在凌晨，一天里最早）
  for (let i = 0; i < checkins; i += 1) rows.push(CHECKIN_ROW(`2026-09-${String(10 - i - page).padStart(2, '0')}`));
  while (rows.length < size) rows.push(REPLY_ROW(`2026-09-10T${String(16 - (rows.length % 12)).padStart(2, '0')}:54:16+08:00`));
  return `${pager(page, last)}${rows.join('')}`;
}

console.log('签到中心 · 数据装配回归');

/* ── 1. 一页的解析与翻页信号 ───────────────────────────────────────── */
const shape: [number, number][] = [[1, 1], [2, 0], [3, 1], [4, 0], [5, 1], [6, 0], [7, 1], [8, 6]];
const LAST = shape.length;
const pages = shape.map(([page, checkins]) => {
  const html = pageHtml(page, checkins, page === LAST ? 33 : 50, LAST);
  return { ...parseCheckinPage(html, page), page };
});

const p1 = pages[0];
check('第 1 页解析出 1 条签到', p1.items.length === 1, JSON.stringify(p1.items));
check('签到行取到日期与积分', p1.items[0]?.date === '2026-09-09 00:16' && p1.items[0]?.gain === 40, JSON.stringify(p1.items[0]));
check('回帖行不会被当成签到', p1.items.every((item) => item.gain === 40), JSON.stringify(p1.items.map((i) => i.gain)));

const p2 = pages[1];
check('第 2 页筛出 0 条签到（真实数据就是这样）', p2.items.length === 0);
check('第 2 页仍然有流水行 → hasRows=true', p2.hasRows === true);
check('第 2 页仍然给出下一页游标（旧逻辑在这里把历史截断了）', p2.nextCursor === '3', String(p2.nextCursor));

const p8 = pages[LAST - 1];
check('最后一页能解析出 6 条签到', p8.items.length === 6, String(p8.items.length));
check('最后一页没有下一页 → 游标为 null', p8.nextCursor === null);

const beyond = parseCheckinPage('<div class="pagination-bar"></div>', LAST + 1);
check('翻过头的空页 → hasRows=false 且无游标', beyond.hasRows === false && beyond.nextCursor === null);

/* ── 2. 批次规划 ─────────────────────────────────────────────────── */
check('每批 3 页：从第 2 页起 → 2/3/4', JSON.stringify(planCheckinBatch('2', 3)) === '["2","3","4"]', JSON.stringify(planCheckinBatch('2', 3)));
check('已知最后一页 = 8 时，从第 8 页起只抓 8', JSON.stringify(planCheckinBatch('8', 3, 8)) === '["8"]', JSON.stringify(planCheckinBatch('8', 3, 8)));
check('最后一页在批次中间时截断（7 → 7/8）', JSON.stringify(planCheckinBatch('7', 3, 8)) === '["7","8"]', JSON.stringify(planCheckinBatch('7', 3, 8)));
check('没有游标就不抓', planCheckinBatch(null, 3).length === 0);

/* ── 3. 完整走一遍补齐流程（照 useCheckin 的循环规则） ─────────────── */
function fill(first: (typeof pages)[number], firstPage: number, total: number, batch = 3) {
  let state: CheckinBatchState = initialCheckinState(EMPTY_CHECKIN_SNAPSHOT('10695'), {
    history: first.items,
    historyCursor: first.nextCursor,
    total,
    historyLastPage: first.lastPage,
  });
  const requests: number[] = [firstPage];
  let batches = 0;
  // 循环规则与 useCheckin 一致：游标 + 分页器封顶
  while (state.cursor && state.pages < 40) {
    const batchPages = planCheckinBatch(state.cursor, batch, state.lastPage);
    requests.push(...batchPages.map(Number));
    batches += 1;
    state = mergeCheckinBatch(
      state,
      batchPages.map((page) => pages.find((item) => String(item.page) === page)
        ?? { page: Number(page), items: [], nextCursor: null, hasRows: false, lastPage: LAST }),
    );
  }
  return { state, requests, batches };
}

const run = fill(pages[0], 1, 10);
check('补齐后拿到全部 10 条签到', run.state.records.length === 10, String(run.state.records.length));
check('10 条互不重复', new Set(run.state.records.map((r) => r.date)).size === 10);
check('抓到最后一页（第 8 页）', run.state.pages === 8, String(run.state.pages));
check('标记为已抓到底', run.state.complete === true);
check('恰好抓 8 页、一次不多（分页器封顶，不会白抓 9/10 页）', JSON.stringify(run.requests) === '[1,2,3,4,5,6,7,8]', JSON.stringify(run.requests));
check('并发批次 = 3 批（8 页：1 首屏 + 3 + 3 + 1）', run.batches === 3, String(run.batches));
check('首屏只有 1 个请求', run.requests[0] === 1);
check('凑够「累计签到」就不再翻页', fill(pages[0], 1, 1).state.cursor === null);

/* ── 4. 缓存与增量 ───────────────────────────────────────────────── */
const cached: CheckinRecord[] = [{ date: '2026-09-09 00:16', gain: 40 }, { date: '2026-09-08 00:16', gain: 40 }];
const merged = mergeCheckinRecords(cached, [{ date: '2026-09-09 00:16', gain: 40 }, { date: '2026-09-10 00:16', gain: 40 }]);
check('同一条记录不会重复', merged.length === 3, JSON.stringify(merged.map((r) => r.date)));
check('按时间倒序', merged[0].date === '2026-09-10 00:16', JSON.stringify(merged.map((r) => r.date)));
const old = mergeCheckinRecords([{ date: '2000-01-01 00:00', gain: 40 }], []);
check('一年以外的记录会被丢掉', old.length === 0);
const rerun = fill(pages[0], 1, 10);
check('重复补齐结果稳定（幂等）', JSON.stringify(rerun.state.records) === JSON.stringify(run.state.records));

/* ── 5. 近 14 天日历 ─────────────────────────────────────────────── */
const todayKey = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
})();
const days = checkinDayMap([{ date: `${todayKey} 00:16`, gain: 40 }], 14);
check('日历固定 14 格', days.length === 14);
check('最后一格是今天', days[13].date.getDate() === new Date().getDate());
check('今天的记录点亮今天', days[13].checked === true && days[12].checked === false);
check('没有记录时全灭', checkinDayMap([], 14).every((day) => !day.checked));

/* ── 6. 记录行文案 ───────────────────────────────────────────────── */
const meta = checkinRecordMeta('2026-09-10 00:16');
check('拆出日期', meta.day === '2026-09-10', meta.day);
check('拆出星期（2026-09-10 是周四）', meta.weekday === '周四', meta.weekday);
check('拆出时间', meta.time === '00:16', meta.time);
check('空值不炸', checkinRecordMeta('').day === '');

/* ── 7. 文案 ─────────────────────────────────────────────────────── */
check('无缓存时的更新时间文案', checkinAgeText(0) === '还没有缓存');
check('刚刚更新', checkinAgeText(Date.now() - 5_000) === '刚刚更新');
check('分钟级', checkinAgeText(Date.now() - 5 * 60_000) === '5 分钟前更新');
check('小时级', checkinAgeText(Date.now() - 3 * 3600_000) === '3 小时前更新');

console.log(fails ? `\n✗ 未通过：${fails} 项` : '\n✓ 通过：签到中心数据装配正常');
process.exit(fails ? 1 : 0);
