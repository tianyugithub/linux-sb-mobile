import {
  POSTING_NOTICE_CONFIRM,
  POSTING_NOTICE_CONSEQUENCE,
  POSTING_NOTICE_CONSEQUENCE_LABEL,
  POSTING_NOTICE_HINT,
  POSTING_NOTICE_INLINE,
  POSTING_NOTICE_INTRO,
  POSTING_NOTICE_RULES,
  POSTING_NOTICE_TITLE,
  type PostingNoticeRule,
} from './posting-notice';
import { EMOJI_PACKS, type EmojiPack } from './emoji-packs';
import {
  TOPIC_FILTER_CUSTOM_MAXLEN,
  TOPIC_FILTER_MAX_USERS,
  TOPIC_FILTER_MAX_WORDS,
  TOPIC_FILTER_USERS_MAXLEN,
} from './topic-filter';

/**
 * 官网 `/app/assets/plugins.js` 里 App 需要跟随的几份数据（纯解析，不碰网络/存储）：
 * 发帖须知文案、表情面板、屏蔽设置的文案与上限。
 *
 * 这些内容官网就是明文写在这个文件里的，App 再抄一份就必然漂移（官网加一条禁止项、
 * 加一个表情包，App 还是旧的）。所以运行时读一次官网、缓存，读不到才退回内置副本。
 */

export const OFFICIAL_PLUGINS_PATH = '/app/assets/plugins.js';

export type OfficialAssets = {
  postingNotice: {
    title: string;
    intro: string;
    hint: string;
    confirm: string;
    inline: string;
    consequenceLabel: string;
    consequence: string;
    rules: PostingNoticeRule[];
  } | null;
  emojiPacks: EmojiPack[] | null;
  keywordFilter: {
    customMaxLen: number;
    usersMaxLen: number;
    maxWords: number;
    maxUsers: number;
  } | null;
};

function str(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

export const EMPTY_OFFICIAL_ASSETS: OfficialAssets = {
  postingNotice: null,
  emojiPacks: null,
  keywordFilter: null,
};

/** 解析 `plugins.js` 里的 `var rules=[[...]]` / `var PACKS=[...]` / 文案字面量。 */
export function parseOfficialAssets(js: string): OfficialAssets {
  /** 从官方模板里取某个类名标签包裹的文案。 */
  const innerText = (className: string, tag: string): string => {
    const hit = js.match(new RegExp(`class="${className}"[^>]*>([^<]{2,300})<\\/${tag}>`));
    return hit ? hit[1].trim() : '';
  };
  const rules: PostingNoticeRule[] = [];
  const rulesBlock = js.match(/var rules=\[([\s\S]*?)\];/)?.[1] ?? '';
  [...rulesBlock.matchAll(/\['([^']*)','((?:[^'\\]|\\.)*)'\]/g)].forEach((hit) => {
    rules.push({ title: hit[1].trim(), text: hit[2].trim() });
  });

  const title = innerText('posting-notice-title', 'h2');
  const intro = innerText('posting-notice-intro', 'p');
  const hint = innerText('posting-notice-hint', 'span');
  const confirm = js.match(/textContent='(我已阅读[^']*)'/)?.[1] ?? '';
  const inline = js.match(/textContent='(注意：发帖[^']*)'/)?.[1] ?? '';
  const consequenceBlock = js.match(/posting-notice-consequence[^>]*>([\s\S]{0,400}?)<\/p>/)?.[1] ?? '';
  const consequence = consequenceBlock.match(/<strong>[^<]*<\/strong>([^<]{4,300})/)?.[1]?.trim() ?? '';

  const packs: EmojiPack[] = [];
  const packsBlock = js.match(/var PACKS\s*=\s*\[([\s\S]*?)\n\s{0,8}\];/)?.[1] ?? '';
  [...packsBlock.matchAll(/name:\s*'([^']+)',\s*(?:type:\s*'text',\s*)?items:\s*\[([\s\S]*?)\]\s*\}/g)].forEach((hit) => {
    const raw = hit[2];
    const pairs = [...raw.matchAll(/\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\]/g)];
    if (pairs.length) {
      packs.push({ name: hit[1], type: 'text', items: pairs.map((row): [string, string] => [row[1], row[2]]) });
      return;
    }
    const items = [...raw.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((row) => row[1]).filter((item) => item !== '');
    if (items.length) packs.push({ name: hit[1], items });
  });

  const customMaxLen = Number(js.match(/data-home-keyword-filter-custom\s+maxlength="(\d+)"/)?.[1] ?? 0);
  const usersMaxLen = Number(js.match(/data-home-keyword-filter-users\s+maxlength="(\d+)"/)?.[1] ?? 0);
  const maxWords = Number(js.match(/最多\s*(\d+)\s*个关键词/)?.[1] ?? 0);
  const maxUsers = Number(js.match(/最多\s*(\d+)\s*个用户名/)?.[1] ?? 0);

  const hasNotice = Boolean(title || intro || rules.length);
  return {
    postingNotice: hasNotice ? {
      title: str(title, POSTING_NOTICE_TITLE),
      intro: str(intro, POSTING_NOTICE_INTRO),
      hint: str(hint, POSTING_NOTICE_HINT),
      confirm: str(confirm, POSTING_NOTICE_CONFIRM),
      inline: str(inline, POSTING_NOTICE_INLINE),
      consequenceLabel: POSTING_NOTICE_CONSEQUENCE_LABEL,
      consequence: str(consequence, POSTING_NOTICE_CONSEQUENCE),
      rules: rules.length ? rules : POSTING_NOTICE_RULES,
    } : null,
    emojiPacks: packs.length ? packs : null,
    keywordFilter: customMaxLen || usersMaxLen || maxWords || maxUsers
      ? {
        customMaxLen: customMaxLen || TOPIC_FILTER_CUSTOM_MAXLEN,
        usersMaxLen: usersMaxLen || TOPIC_FILTER_USERS_MAXLEN,
        maxWords: maxWords || TOPIC_FILTER_MAX_WORDS,
        maxUsers: maxUsers || TOPIC_FILTER_MAX_USERS,
      }
      : null,
  };
}
