/**
 * 官方 topic_stamp 印章的识别回归：类名 → 种类 → 文字/配色（含「官网新加印章」的自动识别）。
 *
 *   npx tsx scripts/check-topic-stamp.ts
 *
 * 页面标记形如：
 *   <span class="topic-stamp-badge topic-stamp-recommend" title="推荐">荐</span>
 * 官方 CSS 里的四种：recommend=success、essence=danger、hot=warning、new=info。
 */
import {
  TOPIC_STAMPS,
  learnedStampTones,
  parseStampTonesFromCss,
  rememberStampTones,
  stampKindsInHtml,
  stampToneForKind,
  topicStampByType,
  topicStampDef,
  topicStampKind,
} from '../src/data/topic-stamp';

const EXPECTED: Record<string, { label: string; tone: string; title: string }> = {
  recommend: { label: '荐', tone: 'success', title: '推荐' },
  essence: { label: '精', tone: 'danger', title: '精华' },
  hot: { label: '热', tone: 'warning', title: '热门' },
  new: { label: '新', tone: 'info', title: '新帖' },
};

const CLASSES: [string, string | null][] = [
  ['topic-stamp-badge topic-stamp-recommend', 'recommend'],
  ['topic-stamp-badge topic-stamp-essence', 'essence'],
  ['topic-stamp-badge topic-stamp-hot', 'hot'],
  ['topic-stamp-badge topic-stamp-new', 'new'],
  ['topic-stamp-hot topic-stamp-badge', 'hot'],
  // 官网以后新加的种类也要认出来（不再是「不识别」）
  ['topic-stamp-badge topic-stamp-quality', 'quality'],
  ['topic-stamp-badge', null],
  ['post-tag post-forum-badge', null],
  ['topic-badge pinned', null],
];

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

console.log('官方 topic_stamp 印章识别检查');

Object.entries(EXPECTED).forEach(([kind, want]) => {
  const def = TOPIC_STAMPS[kind];
  check(
    `${kind} → ${want.label}/${want.tone}/${want.title}`,
    Boolean(def) && def.label === want.label && def.tone === want.tone && def.title === want.title,
    def ? `实际 ${def.label}/${def.tone}/${def.title}` : '缺失',
  );
});

CLASSES.forEach(([className, want]) => {
  const got = topicStampKind(className);
  check(`class「${className}」→ ${want ?? '不算印章'}`, got === want, got === want ? '' : `实际 ${got}`);
});

check('topicStampByType 只认印章类型', topicStampByType('recommend')?.type === 'recommend' && topicStampByType('pinned') === null);

// 页面里出现的印章种类（含未知）
const html = `
<li class="post-item"><a class="post-title" href="/topic/1">a</a>
  <span class="topic-stamp-badge topic-stamp-hot" title="热">热</span>
  <span class="topic-stamp-badge topic-stamp-quality" title="优质">优</span></li>`;
const kinds = stampKindsInHtml(html).sort();
check('页面里扫出全部印章种类', kinds.join(',') === 'hot,quality', kinds.join(','));
check('未知种类暂时没有配色', stampToneForKind('quality') === 'default', stampToneForKind('quality'));
check('未知种类没有兜底字（标签文字以页面为准）', topicStampDef('quality') === null);

// 从官方样式表学习未知种类的配色
const css = `
/* topic_stamp */
.topic-stamp-badge{display:inline-flex;align-items:center}
.topic-stamp-recommend{background:var(--success-soft);color:var(--success)}
.topic-stamp-quality{background:var(--info-soft);color:var(--info)}
.topic-stamp-turbo{background:var(--brand-soft);color:var(--brand)}
.topic-stamp-mystery{background:var(--whatever-soft);color:var(--whatever)}
@media(max-width:720px){.topic-stamp-quality{padding:0 5px}}
`;
const learned = parseStampTonesFromCss(css);
check('学到未知种类的配色', learned.quality === 'info', JSON.stringify(learned));
check('品牌色归到 danger', learned.turbo === 'danger', String(learned.turbo));
check('没见过的变量不硬猜', learned.mystery === undefined, String(learned.mystery));
check('已知种类不被 CSS 覆盖', learned.recommend === undefined);

rememberStampTones(learned);
check('学完之后未知种类就有颜色了', stampToneForKind('quality') === 'info', stampToneForKind('quality'));
check('学到的颜色已存住', learnedStampTones().quality === 'info');

console.log(fails ? `✗ ${fails} 项失败` : '✓ 全部通过');
process.exit(fails ? 1 : 0);
