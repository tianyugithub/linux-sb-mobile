import {
  EMPTY_OFFICIAL_ASSETS,
  type OfficialAssets,
} from '../data/official-assets';
import { secureDelete, secureGet, secureSet } from './secure-value';
import {
  POSTING_NOTICE_CONSEQUENCE,
  POSTING_NOTICE_CONSEQUENCE_LABEL,
  POSTING_NOTICE_HINT,
  POSTING_NOTICE_INLINE,
  POSTING_NOTICE_INTRO,
  POSTING_NOTICE_RULES,
  POSTING_NOTICE_TITLE,
  POSTING_NOTICE_CONFIRM,
} from '../data/posting-notice';
import { EMOJI_PACKS, type EmojiPack } from '../data/emoji-packs';
import {
  TOPIC_FILTER_CUSTOM_MAXLEN,
  TOPIC_FILTER_MAX_USERS,
  TOPIC_FILTER_MAX_WORDS,
  TOPIC_FILTER_USERS_MAXLEN,
} from '../data/topic-filter';
import { parseOfficialAssets, OFFICIAL_PLUGINS_PATH } from '../data/official-assets';

export { OFFICIAL_PLUGINS_PATH, parseOfficialAssets, EMPTY_OFFICIAL_ASSETS };
export type { OfficialAssets };

/**
 * 官网 plugins.js 的运行时缓存层：读一次、存 SecureStore、读不到就用内置副本。
 * 纯解析在 data/official-assets.ts（可离线校验），这里只管缓存与订阅。
 */

const CACHE_KEY = 'lsb.official.assets.v1';
const CACHE_TTL = 24 * 60 * 60 * 1000;

let assets: OfficialAssets = EMPTY_OFFICIAL_ASSETS;
let hydrated = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeOfficialAssets(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function officialAssets(): OfficialAssets {
  return assets;
}

/** 官方文案 → App 显示：读到用官方的，没读到用内置副本。 */
export function postingNoticeContent() {
  const official = assets.postingNotice;
  return {
    title: official?.title || POSTING_NOTICE_TITLE,
    intro: official?.intro || POSTING_NOTICE_INTRO,
    hint: official?.hint || POSTING_NOTICE_HINT,
    confirm: official?.confirm || POSTING_NOTICE_CONFIRM,
    inline: official?.inline || POSTING_NOTICE_INLINE,
    consequenceLabel: official?.consequenceLabel || POSTING_NOTICE_CONSEQUENCE_LABEL,
    consequence: official?.consequence || POSTING_NOTICE_CONSEQUENCE,
    rules: official?.rules?.length ? official.rules : POSTING_NOTICE_RULES,
  };
}

export function emojiPacks(): EmojiPack[] {
  return assets.emojiPacks?.length ? assets.emojiPacks : EMOJI_PACKS;
}

export function keywordFilterLimits() {
  return assets.keywordFilter ?? {
    customMaxLen: TOPIC_FILTER_CUSTOM_MAXLEN,
    usersMaxLen: TOPIC_FILTER_USERS_MAXLEN,
    maxWords: TOPIC_FILTER_MAX_WORDS,
    maxUsers: TOPIC_FILTER_MAX_USERS,
  };
}

async function persist(next: OfficialAssets) {
  try {
    await secureSet(CACHE_KEY, JSON.stringify({ at: Date.now(), assets: next }));
  } catch {
    /* 写失败只是下次再读一遍官网 */
  }
}

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await secureGet(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { at?: number; assets?: OfficialAssets };
    if (!parsed?.assets || Date.now() - Number(parsed.at || 0) > CACHE_TTL) return;
    assets = { ...EMPTY_OFFICIAL_ASSETS, ...parsed.assets };
    notify();
  } catch {
    /* 忽略损坏缓存 */
  }
}

/**
 * 启动或进发帖页时调用：读官网 plugins.js 并解析。
 * `loadText` 由调用方注入（live.ts 的 linuxAsset），避免这里反向依赖 live.ts。
 */
export async function ensureOfficialAssets(loadText: () => Promise<string>): Promise<void> {
  await hydrate();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const parsed = parseOfficialAssets(await loadText());
      assets = parsed;
      notify();
      await persist(parsed);
    } catch {
      /* 读不到就用内置副本 */
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
