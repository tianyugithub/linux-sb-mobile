/**
 * 帖子列表屏蔽设置（官方插件 `home_keyword_filter`）。
 *
 * 官方的规则与文案全部照搬：命中关键词、用户名或版块的帖子只在帖子列表隐藏；
 * 设置按账号同步到 linux.sb（/home_keyword_filter_settings），本地留一份缓存做离线优先。
 * 常用关键词、可屏蔽版块、默认屏蔽版块都由服务端页面提供（按钮上的 data-* 属性），
 * 所以 App 不写死这些列表，跟官方一样从页面里读。
 */

export const TOPIC_FILTER_TITLE = '帖子列表屏蔽设置';
export const TOPIC_FILTER_INTRO = '命中关键词、用户名或版块的帖子只在帖子列表隐藏，不影响论坛数据、搜索和其他用户。';
export const TOPIC_FILTER_PRESET_LABEL = '常用关键词';
export const TOPIC_FILTER_PRESET_EMPTY = '管理员暂未设置常用关键词';
export const TOPIC_FILTER_FORUM_LABEL = '屏蔽版块';
export const TOPIC_FILTER_FORUM_HELP = '可选择首页想要屏蔽的版块，进入具体版块时，版块屏蔽不生效。';
export const TOPIC_FILTER_FORUM_WARNING_TITLE = '版块屏蔽暂不可用';
export const TOPIC_FILTER_CUSTOM_LABEL = '自定义关键词（每行一个）';
export const TOPIC_FILTER_CUSTOM_PLACEHOLDER = '最多 20 个关键词';
export const TOPIC_FILTER_CUSTOM_HELP = '按帖子标题进行包含匹配，不区分英文字母大小写。设置会同步到当前账号，日常浏览仍在本地完成。';
export const TOPIC_FILTER_USERS_LABEL = '屏蔽用户（每行一个）';
export const TOPIC_FILTER_USERS_PLACEHOLDER = '最多 5 个用户名';
export const TOPIC_FILTER_USERS_HELP = '精确匹配用户名，只隐藏该用户发布的主题。';
export const TOPIC_FILTER_CLEAR_HELP = '清空个人屏蔽会清除关键词和用户设置，并恢复系统默认屏蔽版块。';
export const TOPIC_FILTER_SAVE = '保存';
export const TOPIC_FILTER_CLEAR = '清空个人屏蔽';
export const TOPIC_FILTER_SAVED = '帖子列表屏蔽设置已保存';
export const TOPIC_FILTER_RESET = '帖子列表屏蔽已恢复默认';
export const TOPIC_FILTER_SYNCING = '正在同步到账号…';
export const TOPIC_FILTER_SYNC_FAILED = '已保存在当前设备，账号同步失败，稍后会自动重试。';
export const TOPIC_FILTER_EMPTY_LIST = '本页帖子已全部被屏蔽';
export const TOPIC_FILTER_EMPTY_LIST_COPY = '命中的帖子只在列表隐藏，论坛数据、搜索和其他用户都不受影响。';
export const TOPIC_FILTER_BADGE_LABEL = '设置帖子列表屏蔽';

export const TOPIC_FILTER_MAX_WORDS = 20;
export const TOPIC_FILTER_MAX_USERS = 5;
export const TOPIC_FILTER_ITEM_MAX = 40;
/** 官方 maxlength：自定义关键词 820 字，屏蔽用户 205 字。 */
export const TOPIC_FILTER_CUSTOM_MAXLEN = 820;
export const TOPIC_FILTER_USERS_MAXLEN = 205;

export type TopicFilterSettings = {
  /** 勾选的常用关键词（只允许服务端提供的那些）。 */
  presets: string[];
  /** 自定义关键词。 */
  custom: string[];
  /** 屏蔽的用户名（精确匹配）。 */
  users: string[];
  /** 从默认屏蔽版块里取消勾选的。 */
  forumExcludedIds: string[];
  /** 额外勾选屏蔽的版块。 */
  forumExtraIds: string[];
};

export type TopicFilterForum = { id: string; name: string; default: boolean };

/** 服务端页面提供的上下文（按钮上的 data-*）。 */
export type TopicFilterContext = {
  userId: string;
  settingsUrl: string;
  csrf: string;
  /** 管理员配置的常用关键词。 */
  presets: string[];
  forums: TopicFilterForum[];
  defaultForumIds: string[];
  /** 版块屏蔽开关（关闭或 warning 非空时不可用）。 */
  forumEnabled: boolean;
  forumWarning: string;
};

export const EMPTY_TOPIC_FILTER: TopicFilterSettings = {
  presets: [],
  custom: [],
  users: [],
  forumExcludedIds: [],
  forumExtraIds: [],
};

export const EMPTY_TOPIC_FILTER_CONTEXT: TopicFilterContext = {
  userId: '',
  settingsUrl: '',
  csrf: '',
  presets: [],
  forums: [],
  defaultForumIds: [],
  forumEnabled: false,
  forumWarning: '',
};

export function normalizeFilterValue(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase();
}

export function filterWords(values: unknown): string[] {
  const list = Array.isArray(values) ? values : [];
  return Array.from(new Set(list.map(normalizeFilterValue).filter(Boolean))).slice(0, TOPIC_FILTER_MAX_WORDS);
}

/** 与官方 sanitizeSettings 一一对应。 */
export function sanitizeFilterSettings(
  value: Partial<TopicFilterSettings> | null | undefined,
  context: TopicFilterContext,
): TopicFilterSettings {
  const allowedForums = new Set(context.forums.map((forum) => forum.id));
  const allowedPresets = new Set(context.presets.map(normalizeFilterValue));
  const cleanForumIds = (ids: unknown) => Array.from(new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(Number.parseInt(String(id), 10) || 0))
      .filter((id) => Number(id) > 0 && allowedForums.has(id)),
  ));
  const forumExcludedIds = cleanForumIds(value?.forumExcludedIds);
  const excluded = new Set(forumExcludedIds);
  return {
    presets: filterWords(value?.presets).filter((word) => allowedPresets.has(word)),
    custom: filterWords(value?.custom).map((word) => word.slice(0, TOPIC_FILTER_ITEM_MAX)),
    users: filterWords(value?.users).slice(0, TOPIC_FILTER_MAX_USERS).map((word) => word.slice(0, TOPIC_FILTER_ITEM_MAX)),
    forumExcludedIds,
    forumExtraIds: cleanForumIds(value?.forumExtraIds).filter((id) => !excluded.has(id)),
  };
}

/** 勾选状态下的最终屏蔽版块：默认集合 - 取消的 + 额外的。 */
export function configuredForumIds(settings: TopicFilterSettings, context: TopicFilterContext): Set<string> {
  const ids = new Set(context.defaultForumIds);
  settings.forumExcludedIds.forEach((id) => ids.delete(id));
  settings.forumExtraIds.forEach((id) => ids.add(id));
  return ids;
}

export function filterForumAvailable(context: TopicFilterContext): boolean {
  return context.forumEnabled && context.forums.length > 0 && !context.forumWarning;
}

export type TopicFilterRules = {
  words: string[];
  users: Set<string>;
  forumIds: Set<string>;
  /** 已启用的规则条数（关键词 + 用户 + 版块），官方用来算按钮提示。 */
  ruleCount: number;
};

/**
 * 生成生效规则。`withForums` 对应官方的 forumBlockEnabled：
 * 只有在首页列表才生效，进入具体版块时版块屏蔽不生效。
 */
export function topicFilterRules(
  settings: TopicFilterSettings,
  context: TopicFilterContext,
  withForums: boolean,
): TopicFilterRules {
  const words = filterWords([...settings.presets, ...settings.custom]);
  const users = new Set(settings.users);
  const forumIds = withForums && filterForumAvailable(context)
    ? configuredForumIds(settings, context)
    : new Set<string>();
  return { words, users, forumIds, ruleCount: words.length + users.size + forumIds.size };
}

export function topicHiddenByFilter(
  topic: { title: string; author: string; forumId?: string },
  rules: TopicFilterRules,
): boolean {
  if (!rules.ruleCount) return false;
  const title = normalizeFilterValue(topic.title);
  if (rules.words.length > 0 && rules.words.some((word) => title.includes(word))) return true;
  const author = normalizeFilterValue(topic.author);
  if (author && rules.users.has(author)) return true;
  const forumId = String(topic.forumId ?? '');
  return Boolean(forumId && rules.forumIds.has(forumId));
}

/** 「每行一个」输入框的解析（官方按 换行/逗号/分号 切分）。 */
export function parseFilterLines(value: string, max: number): string[] {
  return filterWords(String(value ?? '').split(/[\n,，;；]+/))
    .slice(0, max)
    .map((word) => word.slice(0, TOPIC_FILTER_ITEM_MAX));
}
