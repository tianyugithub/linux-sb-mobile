import type { TopicTagType } from '../types/api';

/**
 * 官方 `topic_stamp` 插件的印章（标题后面的小圆标）。
 *
 * 页面标记：<span class="topic-stamp-badge topic-stamp-recommend" title="推荐">荐</span>
 *
 * 两类信息分开处理，保证官网以后加新印章时 App 不用改代码也能显示：
 *   1. 文字：一律用页面自己给的字（`>荐<`），没给才退回官方 title，再退回已知表的兜底字。
 *   2. 配色：已知四类按官方 CSS 写死（recommend=success/essence=danger/hot=warning/new=info）；
 *      遇到没见过的种类，由 services/topic-stamp-tones 去官方 CSS 里读它的语义变量（一次，之后缓存）。
 */
export type TopicStampTone = 'success' | 'danger' | 'warning' | 'info' | 'default';

export type TopicStampDef = {
  type: TopicTagType;
  /** 页面没给文字时的兜底字（官方也是单字）。 */
  label: string;
  tone: TopicStampTone;
  /** 官方 title 属性里的完整说法。 */
  title: string;
};

/** 官方 CSS 里已明确含义的印章。键就是 `topic-stamp-<kind>` 的 kind。 */
export const TOPIC_STAMPS: Record<string, TopicStampDef> = {
  recommend: { type: 'recommend', label: '荐', tone: 'success', title: '推荐' },
  essence: { type: 'essence', label: '精', tone: 'danger', title: '精华' },
  hot: { type: 'hot', label: '热', tone: 'warning', title: '热门' },
  new: { type: 'new', label: '新', tone: 'info', title: '新帖' },
};

/** 官方 CSS 变量名 → App 色调（变量的语义就是官方 CSS 里的 --success / --danger …）。 */
export const STAMP_TONE_BY_CSS_VAR: Record<string, TopicStampTone> = {
  success: 'success',
  danger: 'danger',
  error: 'danger',
  warning: 'warning',
  info: 'info',
  brand: 'danger',
  primary: 'danger',
  accent: 'danger',
  neutral: 'default',
  muted: 'default',
  subtle: 'default',
};

const STAMP_CLASS = /topic-stamp-([a-z0-9]+)/gi;

/** 从 `topic-stamp-badge topic-stamp-recommend` 里取出种类（跳过公共的 badge）。认不出返回 null。 */
export function topicStampKind(className: string): string | null {
  const kinds = [...String(className ?? '').matchAll(STAMP_CLASS)].map((hit) => hit[1].toLowerCase());
  return kinds.find((item) => item !== 'badge') ?? null;
}

export function topicStampDef(kind: string | null | undefined): TopicStampDef | null {
  return kind ? TOPIC_STAMPS[kind] ?? null : null;
}

export function topicStampByType(type: string): TopicStampDef | null {
  const hit = Object.values(TOPIC_STAMPS).find((def) => def.type === type);
  return hit ?? null;
}

/** 官方 CSS 里学到的配色（未知种类用），进程内 + 磁盘各一份。 */
let learnedTones: Record<string, TopicStampTone> = {};

export function learnedStampTones(): Record<string, TopicStampTone> {
  return learnedTones;
}

export function rememberStampTones(next: Record<string, TopicStampTone>) {
  learnedTones = { ...learnedTones, ...next };
}

/**
 * 解析官方样式表里的 `.topic-stamp-<kind>{background:var(--xxx-soft);color:var(--xxx)}`，
 * 学到新种类的色调。认不出的变量不写，交给调用方退回 default。
 */
export function parseStampTonesFromCss(css: string): Record<string, TopicStampTone> {
  const found: Record<string, TopicStampTone> = {};
  const rule = /\.topic-stamp-([a-z0-9]+)(?![\w-])[^{}]*\{([^}]*)\}/gi;
  let hit = rule.exec(css);
  while (hit) {
    const kind = hit[1].toLowerCase();
    if (kind === 'badge' || kind in TOPIC_STAMPS || kind in found) {
      hit = rule.exec(css);
      continue;
    }
    // 只有带配色的规则才算印章（`.topic-stamp-admin{display:grid}` 是后台面板，不是印章）
    if (!/background|color\s*:/.test(hit[2])) {
      hit = rule.exec(css);
      continue;
    }
    const vars = [...hit[2].matchAll(/var\(\s*--([a-z0-9-]+)/gi)].map((item) => item[1].toLowerCase());
    const tone = vars.map((name) => STAMP_TONE_BY_CSS_VAR[name.replace(/-(soft|fill|bg|strong|fg)$/, '')]).find(Boolean);
    if (tone && tone !== 'default') found[kind] = tone;
    hit = rule.exec(css);
  }
  return found;
}

export function stampToneForKind(kind: string | null | undefined): TopicStampTone {
  if (!kind) return 'default';
  return TOPIC_STAMPS[kind]?.tone ?? learnedTones[kind] ?? 'default';
}

/** 页面里所有印章种类（含未知的）。 */
export function stampKindsInHtml(html: string): string[] {
  const kinds = new Set<string>();
  const re = /class="([^"]*topic-stamp-badge[^"]*)"/gi;
  let hit = re.exec(html);
  while (hit) {
    const kind = topicStampKind(hit[1]);
    if (kind && kind !== 'badge') kinds.add(kind);
    hit = re.exec(html);
  }
  return [...kinds];
}
