import {
  TOPIC_STAMPS,
  learnedStampTones,
  parseStampTonesFromCss,
  rememberStampTones,
  stampKindsInHtml,
  stampToneForKind,
  type TopicStampTone,
} from '../data/topic-stamp';
import { secureDelete, secureGet, secureSet } from './secure-value';
/**
 * 让「官网以后新加的印章」也能自动上色。
 *
 * App 里已知的四类（荐/精/热/新）按官方 CSS 写死了配色；遇到没见过的 kind，
 * 读一次官方样式表 `/app/assets/plugins.css`，把它 `.topic-stamp-<kind>` 规则里的
 * 语义变量（--success / --danger / --warning / --info …）映射成 App 的色调，
 * 结果缓存到 SecureStore，之后不再请求。文字本来就取自页面，所以新印章至少一定显示得出来。
 */

const KEY = 'lsb.topic-stamp.tones';
/** 官方样式表：印章配色都在这里。 */
export const TOPIC_STAMP_CSS_PATH = '/app/assets/plugins.css';

let hydrated = false;
let inflight: Promise<void> | null = null;
let cssFetched = false;

async function persist() {
  try {
    await secureSet(KEY, JSON.stringify(learnedStampTones()));
  } catch {
    /* 缓存写失败只是下次多读一次 CSS */
  }
}

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await secureGet(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, TopicStampTone>;
    if (parsed && typeof parsed === 'object') rememberStampTones(parsed);
  } catch {
    /* 忽略损坏的缓存 */
  }
}

function unknownKinds(html: string): string[] {
  return stampKindsInHtml(html).filter((kind) => !(kind in TOPIC_STAMPS) && stampToneForKind(kind) === 'default');
}

/**
 * 解析一个列表页时调用：只在出现未知印章时才去读官方 CSS（每个进程最多一次）。
 * 调用方可以 await（首页/版块列表，保证首帧颜色就对），也可以直接 void。
 */
export async function ensureStampTones(html: string, loadCss: () => Promise<string>): Promise<void> {
  await hydrate();
  if (!unknownKinds(html).length) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      if (cssFetched) return;
      cssFetched = true;
      const css = await loadCss();
      const learned = parseStampTonesFromCss(css);
      if (Object.keys(learned).length) {
        rememberStampTones(learned);
        await persist();
      }
    } catch {
      cssFetched = false;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
