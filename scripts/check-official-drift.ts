/**
 * 官方漂移自检：直接抓 linux.sb，逐项比对 App 里仍然「抄了一份」的官网数据，
 * 以及 App 依赖的页面结构标记是否还在。
 *
 *   npm run check:drift                 # 匿名检查（结构 + 可公开读取的数据）
 *   LSB_COOKIE="bbs_auth=...; bbs_csrf=..." npm run check:drift   # 额外核对称号池等登录后内容
 *
 * 退出码非 0 表示有项目漂移或页面结构变化，需要人工跟进（或已被运行时读取机制自动兜住）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { EMOJI_PACKS } from '../src/data/emoji-packs';
import {
  POSTING_NOTICE_CONFIRM,
  POSTING_NOTICE_CONSEQUENCE,
  POSTING_NOTICE_HINT,
  POSTING_NOTICE_INLINE,
  POSTING_NOTICE_INTRO,
  POSTING_NOTICE_RULES,
  POSTING_NOTICE_TITLE,
} from '../src/data/posting-notice';
import { parseOfficialAssets } from '../src/data/official-assets';
import { TOPIC_STAMPS } from '../src/data/topic-stamp';
import { TITLE_DEFS, TITLE_SPECIALS } from '../src/data/title-catalog';
import { VIDEO_LABEL } from '../src/utils/article';
import { sorts } from '../data';
import { parseVideoShare } from '../src/utils/video-link';
import { parseCapConfig, parseDailyHotTopics, pageNeedsReplyCaptcha } from '../src/services/live';
import { ESSENCE_REASON_MAX, ESSENCE_REASON_MIN } from '../src/data/essence';

const ORIGIN = 'https://linux.sb';

function cookie(): string {
  const fromEnv = (process.env.LSB_COOKIE || '').trim();
  if (fromEnv) return fromEnv;
  const file = process.env.LSB_COOKIE_FILE || '/tmp/cookie.txt';
  try {
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  } catch {
    /* 读不到就当匿名 */
  }
  return '';
}

const jar = cookie();

async function get(path: string, opts: { accept?: string } = {}): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Accept: opts.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.7',
    Referer: `${ORIGIN}/`,
  };
  if (jar) headers.Cookie = jar;
  const res = await fetch(`${ORIGIN}${path}`, { headers });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.text();
}

let failures = 0;
let warns = 0;
const ok = (name: string, detail = '') => console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`);
const warn = (name: string, detail = '') => {
  warns += 1;
  console.log(`  ⚠ ${name}${detail ? `  ${detail}` : ''}`);
};
const bad = (name: string, detail = '') => {
  failures += 1;
  console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
};

/** 比较数组集合：返回官方有而 App 没有的、App 有而官方没有的。 */
function diff(appList: string[], officialList: string[]) {
  const app = new Set(appList);
  const official = new Set(officialList);
  return {
    missing: officialList.filter((item) => !app.has(item)),
    extra: appList.filter((item) => !official.has(item)),
  };
}


async function main() {
  console.log(`官方漂移自检（${jar ? '带登录 cookie' : '匿名'}）`);

  // ── 1. 页面结构：App 依赖的核心标记还在不在 ────────────────────────────────
  const home = await get('/');
  const structure: [string, RegExp][] = [
    ['首页列表行 <li class="post-item">', /<li\b[^>]*class="[^"]*post-item/],
    ['列表容器 class="post-list"', /class="[^"]*post-list/],
    ['标题链接 class="post-title"', /class="[^"]*post-title/],
    ['排序 tab-bar', /class="[^"]*tab-bar/],
    ['列表行时间 data-performance-time', /data-performance-time/],
    ['帖子印章容器 topic-stamp-badge', /topic-stamp-badge/],
    ['屏蔽设置按钮 data-home-keyword-filter-open', /data-home-keyword-filter-open/],
    ['每日热帖卡片 daily-hot-topics-card', /daily-hot-topics-card/],
    ['每日热帖条目 daily-hot-topics-title', /daily-hot-topics-title/],
  ];
  console.log('\n[页面结构标记]');
  structure.forEach(([name, re]) => {
    if (re.test(home)) ok(name);
    else bad(name, '首页已找不到，App 对应解析会失效（哨兵会报「页面结构可能已变化」）');
  });
  // 每日热帖：不光看标记在不在，还要用 App 真正的解析器跑一遍（这块就在首页 HTML 里）
  const hot = parseDailyHotTopics(home);
  if (!hot) {
    bad('每日热帖可解析', '首页找不到 daily-hot-topics-list，首页热帖区块会消失');
  } else if (!hot.length) {
    bad('每日热帖可解析', '卡片在但一条都没解出来（title/count/href 锚点可能改名了）');
  } else {
    const sample = hot[0];
    ok(`每日热帖 ${hot.length} 条`, `#1 ${sample.title.slice(0, 18)}… · ${sample.window} ${sample.replies} 回复`);
    if (!hot.every((item) => item.replies > 0)) warn('每日热帖有条目回复数为 0', '官方可能改了 count 文案');
    if (!hot.every((item) => item.window)) warn('每日热帖统计窗口为空', '官方可能改了头部文案');
  }
  /**
   * 抽奖帖回帖的人机验证：作者保留「回帖需要验证码」（默认开）时，
   * 回帖框上方会挂 Cap 组件，提交必须带 cap_token。这里抓一个真实抽奖帖验证解析器。
   */
  console.log('\n[人机验证 / 申精约束]');
  const lucky = await get('/index.php?sort=lucky');
  const luckyIds = [...new Set([...lucky.matchAll(/href="\/topic\/(\d+)"/g)].map((m) => m[1]))].slice(0, 6);
  let capHit: { id: string; endpoint: string } | null = null;
  for (const id of luckyIds) {
    const page = await get(`/topic/${id}`);
    if (!pageNeedsReplyCaptcha(page)) continue;
    const cfg = parseCapConfig(page);
    capHit = { id, endpoint: cfg?.endpoint || '' };
    break;
  }
  if (capHit) {
    if (capHit.endpoint) ok('抽奖帖回帖人机验证可解析', `/topic/${capHit.id} → ${capHit.endpoint}`);
    else warn('抽奖帖回帖人机验证缺少端点', `/topic/${capHit.id} 有组件但没解析出 data-cap-api-endpoint`);
  } else if (luckyIds.length) {
    warn('抽查的抽奖帖都没开回帖验证', '可能都被作者关掉了；功能仍在，只是这次没样本');
  } else {
    warn('找不到抽奖帖', '首页 ?sort=lucky 里没有主题链接');
  }

  /* 竞猜理由：官方上限 + 「会作为一条评议回帖发布」 + 写过之后不再给表单
     （样本取自申精列表页 —— 那里的主题都处在竞猜/待审核状态） */
  const essenceList = await get('/topic_essence_review_list');
  const essenceIds = [...new Set([...essenceList.matchAll(/href="\/topic\/(\d+)"/g)].map((m) => m[1]))];
  let voteTopic = '';
  for (const id of essenceIds.slice(0, 5)) {
    const page = await get(`/topic/${id}`);
    if (/topic-essence-review-vote-form/.test(page)) {
      voteTopic = page;
      break;
    }
  }
  if (!voteTopic) warn('申精列表里没找到进行中的竞猜', '前 5 个主题都不是竞猜状态');
  const reasonField = voteTopic.match(/<textarea[^>]*name="reason"[^>]*>/)?.[0] ?? '';
  const votePanel = Boolean(voteTopic);
  if (!votePanel) {
    /* 上面已经 warn 过 */
  } else if (!reasonField) {
    bad('竞猜理由输入框消失', '面板在但没有 name="reason" 的 textarea，App 的提交会失败');
  } else {
    const liveMax = Number(reasonField.match(/maxlength="(\d+)"/)?.[1] ?? 0);
    if (liveMax === ESSENCE_REASON_MAX) ok('竞猜理由上限一致', `${liveMax} 字`);
    else warn('竞猜理由上限已变', `官方 ${liveMax} / App ${ESSENCE_REASON_MAX}（改 src/data/essence.ts）`);
    /* 下限与「只能竞猜一次」是服务端规则（页面属性/脚本里都没有）。
       哪天官方把 minlength 写进页面，这里会提醒我们把 App 的 5 字对齐过去。 */
    const liveMin = Number(reasonField.match(/minlength="(\d+)"/)?.[1] ?? 0);
    if (liveMin && liveMin !== ESSENCE_REASON_MIN) {
      warn('官方给理由框加了下限', `页面 minlength=${liveMin}，App 用的是 ${ESSENCE_REASON_MIN}（改 src/data/essence.ts）`);
    }
    if (/\brequired\b/.test(reasonField)) ok('竞猜理由仍为必填');
    else warn('竞猜理由不再是必填', 'App 仍然按必填校验，可能过于严格');
    if (/作为一条评议回帖发布/.test(voteTopic)) ok('理由仍会作为评议回帖发布', 'App 提交成功后会定位到该回帖');
    else warn('理由发布说明文案已变', '确认是否仍会生成回帖（影响提交后的定位）');
  }
  /* 作者申请加精：官方一键提交、无理由字段；哪天加了理由字段这里会提醒 */
  let applyForm = '';
  if (jar) {
    const uid = home.match(/href="\/user\/(\d+)"[^>]*class="[^"]*nav-mine/)?.at(1)
      || home.match(/data-online-users-ids="[^"]*?(\d+)/)?.at(1)
      || '';
    const mine = uid ? await get(`/user/${uid}?tab=topics`).catch(() => '') : '';
    const ownId = [...new Set([...mine.matchAll(/href="\/topic\/(\d+)"/g)].map((m) => m[1]))][0];
    if (ownId) {
      const own = await get(`/topic/${ownId}`);
      applyForm = own.match(/<form class="topic-essence-review-apply-form"[\s\S]*?<\/form>/)?.[0] || '';
    }
  }
  if (!applyForm) {
    warn('这次没抓到申请加精表单', '通常是当前主题已申请过或不可申请');
  } else if (/name="reason"/.test(applyForm)) {
    warn('官方申请加精表单出现了理由字段', 'App 的申精入口需要跟着加输入框');
  } else {
    ok('申请加精仍是一键提交（无理由字段）');
  }

  const emptyState = /class="[^"]*empty-state[^"]*"/.test(home);
  console.log(`  · 空态标记 empty-state：${emptyState ? '出现在首页' : '首页没有（正常，空列表时才有）'}`);

  // ── 2. plugins.js：可运行时读取的数据 vs App 内置副本 ──────────────────────
  const plugins = await get('/app/assets/plugins.js');
  const parsed = parseOfficialAssets(plugins);
  console.log('\n[plugins.js → 运行时读取（已自动跟随，只做一致性自检）]');
  if (!parsed.postingNotice) {
    bad('发帖须知可解析', 'plugins.js 里没解析到 posting_notice，App 会退回内置副本');
  } else {
    const notice = parsed.postingNotice;
    const checks: [string, string, string][] = [
      ['标题', notice.title, POSTING_NOTICE_TITLE],
      ['导语', notice.intro, POSTING_NOTICE_INTRO],
      ['提示', notice.hint, POSTING_NOTICE_HINT],
      ['确认按钮', notice.confirm, POSTING_NOTICE_CONFIRM],
      ['内联提醒', notice.inline, POSTING_NOTICE_INLINE],
      ['违规后果', notice.consequence, POSTING_NOTICE_CONSEQUENCE],
    ];
    checks.forEach(([label, live, builtin]) => {
      if (live === builtin) ok(`发帖须知${label}`);
      else warn(`发帖须知${label}已变`, `官方「${live.slice(0, 24)}…」/ 内置「${builtin.slice(0, 24)}…」（App 运行时用官方的那份，内置只是兜底）`);
    });
    const rules = diff(notice.rules.map((r) => r.title), POSTING_NOTICE_RULES.map((r) => r.title));
    if (!rules.missing.length && !rules.extra.length) ok(`发帖须知规则 ${notice.rules.length} 条`);
    else warn('发帖须知规则已变', `官方多出 [${rules.missing.join(',')}]，App 内置多出 [${rules.extra.join(',')}]`);
  }
  if (!parsed.emojiPacks) {
    bad('表情包可解析', 'plugins.js 里没解析到 PACKS');
  } else {
    const livePacks = parsed.emojiPacks.map((p) => `${p.name}:${p.items.length}`);
    const builtinPacks = EMOJI_PACKS.map((p) => `${p.name}:${p.items.length}`);
    const packs = diff(builtinPacks, livePacks);
    if (!packs.missing.length && !packs.extra.length) ok(`表情包 ${livePacks.join(' | ')}`);
    else warn('表情包已变', `官方 [${livePacks.join(' | ')}] / 内置 [${builtinPacks.join(' | ')}]（App 运行时用官方那份）`);
  }
  if (parsed.keywordFilter) {
    ok('屏蔽设置上限', JSON.stringify(parsed.keywordFilter));
  } else {
    warn('屏蔽设置上限未解析到', 'App 会用内置的 820/205/20/5');
  }

  // ── 3. 首页 / 榜单：排序与榜单入口（App 目前仍写死一份） ────────────────────
  console.log('\n[排序与榜单入口（单一来源 src/data/feed-nav.ts，仍需与官方核对）]');
  const tabLabels = [...home.matchAll(/class="tab(?: active)?"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
  const sortDiff = diff([...sorts], tabLabels.filter((t) => !t.startsWith('+')));
  if (!sortDiff.missing.length && !sortDiff.extra.length) ok(`首页排序 ${tabLabels.length} 个`, tabLabels.join('/'));
  else warn('首页排序已变', `官方 [${tabLabels.join('/')}] / App [${sorts.join('/')}]`);

  let leaderboard = '';
  try {
    leaderboard = await get('/leaderboard');
    const lbLabels = [...leaderboard.matchAll(/class="leaderboard-tab[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
    const lbTypes = [...leaderboard.matchAll(/leaderboard-tab[^"]*"\s+href="\/leaderboard\?type=([a-z]+)"/g)].map((m) => m[1]);
    ok(`榜单入口 ${lbLabels.length} 个`, `${lbLabels.join('/')}  →  ${lbTypes.join(',')}`);
  } catch (error) {
    warn('榜单页读取失败', error instanceof Error ? error.message : String(error));
  }

  // ── 4. plugins.css：印章种类（App 已知 4 类，未知种类会自动学配色） ────────
  console.log('\n[印章（插件 css）]');
  const css = await get('/app/assets/plugins.css', { accept: 'text/css,*/*;q=0.8' });
  // 只认「真的有配色」的印章规则：`.topic-stamp-admin{display:grid}` 是同名前缀的后台面板，不是印章
  const stampKinds = [...new Set(
    [...css.matchAll(/\.topic-stamp-([a-z0-9]+)(?![\w-])[^{}]*\{([^}]*)\}/g)]
      .filter((hit) => /background|color\s*:/.test(hit[2]))
      .map((hit) => hit[1]),
  )].filter((kind) => kind !== 'badge');
  const unknownStamps = stampKinds.filter((kind) => !(kind in TOPIC_STAMPS));
  if (!unknownStamps.length) ok(`印章种类 ${stampKinds.join(',')}`);
  else warn('官方新增印章种类', `${unknownStamps.join(',')} —— App 会自动显示并按官方 CSS 学配色，可把常用色补进 TOPIC_STAMPS`);
  const highlightVersion = plugins.match(/highlight\.js\/([\d.]+)\//)?.[1] ?? '';
  if (highlightVersion) {
    warn('官方代码高亮版本', `highlight.js ${highlightVersion}；App 自带渲染器只覆盖 15 种语言（人工同步项）`);
  } else {
    warn('未在 plugins.js 里找到 highlight.js 版本', '官网可能换了高亮方案，人工确认');
  }

  // ── 5. 视频平台（App 仍按官方正则抄了一份） ───────────────────────────────
  console.log('\n[视频平台]');
  const hosts: [keyof typeof VIDEO_LABEL, string][] = [
    ['douyin', 'https://www.douyin.com/video/741234567890123456'],
    ['bilibili', 'https://www.bilibili.com/video/BV1xx411c7mD'],
    ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ];
  for (const [provider, url] of hosts) {
    const hit = await parseVideoShare(url);
    if (hit) ok(`${VIDEO_LABEL[provider]}识别`, hit.url);
    else bad(`${VIDEO_LABEL[provider]}识别失败`, `${url} 认不出来，官方可能改了地址格式`);
  }
  const platformWords = ['douyin', 'bilibili', 'youtube'].filter((name) => plugins.includes(name));
  console.log(`  · plugins.js 里出现过的平台关键字：${platformWords.join(', ')}`);

  // ── 6. 登录后内容（称号池 / 通知页标记） ──────────────────────────────────
  console.log('\n[登录后内容]');
  if (!jar) {
    warn('未提供 LSB_COOKIE', '跳过称号池与通知页结构核对（设置 LSB_COOKIE 或放 /tmp/cookie.txt 可开启）');
  } else {
    try {
      const gacha = await get('/gacha');
      const liveTitles = [...new Set([...gacha.matchAll(/gacha-title-name">([^<]+)/g)].map((m) => m[1].trim()))];
      const builtin = [...TITLE_DEFS, ...TITLE_SPECIALS].map((item) => item.name);
      const titles = diff(builtin, liveTitles);
      if (!titles.missing.length) ok(`称号池 ${liveTitles.length} 个都在 App 目录里`);
      else bad('官方新称号不在 App 目录', `${titles.missing.join('、')} —— gacha 解析会用 catalogTitleIn 过滤掉它们（静默丢数据）`);
      if (titles.extra.length) console.log(`  · App 目录里官方当前页没出现的：${titles.extra.join('、')}（可能只是本页没渲染）`);
    } catch (error) {
      warn('称号池读取失败', error instanceof Error ? error.message : String(error));
    }
    try {
      const notif = await get('/user/10695?tab=notifications');
      const hasRows = /<li\b[^>]*class="[^"]*post-item/.test(notif);
      const hasNotif = /notification-item/.test(notif);
      if (hasRows && hasNotif) ok('通知页结构', 'post-item + notification-item 都在');
      else warn('通知页结构已变', `post-item=${hasRows} notification-item=${hasNotif}（App 有容错与哨兵，仍建议人工确认）`);
    } catch (error) {
      warn('通知页读取失败', error instanceof Error ? error.message : String(error));
    }
  }

  console.log(`\n${failures ? `✗ ${failures} 项需要处理` : '✓ 没有硬性漂移'}${warns ? `，${warns} 项提示` : ''}`);
  if (failures) process.exitCode = 1;

}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
