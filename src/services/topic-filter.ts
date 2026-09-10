import * as SecureStore from 'expo-secure-store';
import {
  EMPTY_TOPIC_FILTER,
  EMPTY_TOPIC_FILTER_CONTEXT,
  sanitizeFilterSettings,
  type TopicFilterContext,
  type TopicFilterSettings,
} from '../data/topic-filter';
import { api } from './api';

/**
 * 帖子列表屏蔽设置的状态与同步（官方插件 home_keyword_filter 的客户端部分）。
 *
 * 官方逻辑：设置存 localStorage（key 带 userId），同时 POST 到 /home_keyword_filter_settings
 * 同步到账号，同步间隔 5 分钟；离线改动标记 pending，下次再推。
 * App 里把 localStorage 换成 SecureStore，其余语义保持一致。
 */

const KEY_PREFIX = 'lsb.topic-filter.v2.';
const SYNC_TTL = 5 * 60 * 1000;

export type TopicFilterCache = {
  settings: TopicFilterSettings;
  pending: boolean;
  syncedAt: number;
};

export type TopicFilterState = {
  /** 当前账号（未登录为空串）。 */
  userId: string;
  settings: TopicFilterSettings;
  context: TopicFilterContext;
  /** 已保存但还没同步到账号。 */
  pending: boolean;
  /** 本地缓存是否已读完（读完前不要急着按规则过滤）。 */
  ready: boolean;
};

let userId = '';
let cache: TopicFilterCache | null = null;
let ready = false;
let context: TopicFilterContext | null = null;
let preparing: Promise<void> | null = null;
let lastError = '';
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function keyFor(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

function currentSettings(): TopicFilterSettings {
  return cache?.settings ?? EMPTY_TOPIC_FILTER;
}

function currentContext(): TopicFilterContext {
  return context ?? EMPTY_TOPIC_FILTER_CONTEXT;
}

/** 上下文是否已经拿到（常用关键词或可屏蔽版块任一非空即视为已知）。 */
function contextKnown(): boolean {
  return Boolean(context && (context.presets.length > 0 || context.forums.length > 0 || context.settingsUrl));
}

/** 页面解析出来的上下文（常用关键词 / 可屏蔽版块 / 默认屏蔽版块），官方也是从页面读。 */
export function setTopicFilterContext(next: TopicFilterContext | null) {
  if (!next || (!next.presets.length && !next.forums.length && !next.settingsUrl)) return;
  context = next;
  notify();
}

export function getTopicFilterState(): TopicFilterState {
  return {
    userId,
    settings: currentSettings(),
    context: currentContext(),
    pending: Boolean(cache?.pending),
    ready,
  };
}

export function getTopicFilterSettings(): TopicFilterSettings {
  return currentSettings();
}

export function getTopicFilterRulesContext(): { settings: TopicFilterSettings; context: TopicFilterContext } {
  return { settings: currentSettings(), context: currentContext() };
}

export function topicFilterError(): string {
  return lastError;
}

export function subscribeTopicFilter(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function writeCache(next: TopicFilterCache | null) {
  cache = next;
  notify();
  if (!userId) return;
  try {
    if (next) await SecureStore.setItemAsync(keyFor(userId), JSON.stringify(next));
    else await SecureStore.deleteItemAsync(keyFor(userId));
  } catch {
    /* 写失败只是下次冷启动没有缓存 */
  }
}

async function readCache(id: string): Promise<TopicFilterCache | null> {
  try {
    const raw = await SecureStore.getItemAsync(keyFor(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TopicFilterCache>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      settings: sanitizeFilterSettings(parsed.settings, currentContext()),
      pending: parsed.pending === true,
      syncedAt: Number(parsed.syncedAt) || 0,
    };
  } catch {
    return null;
  }
}

async function push(next: TopicFilterSettings): Promise<TopicFilterSettings> {
  const result = await api.saveTopicFilter(next);
  await writeCache({ settings: result.settings, pending: false, syncedAt: Date.now() });
  lastError = '';
  return result.settings;
}

/**
 * 进入首页时调用：读本地缓存，必要时与账号同步（官方 syncSettings）。
 * 未登录时清空（官方对 userId < 1 直接不启用这套屏蔽）。
 */
export async function prepareTopicFilter(id: string): Promise<void> {
  if (id !== userId) {
    userId = id;
    cache = null;
    ready = false;
    notify();
  }
  if (!id) {
    ready = true;
    notify();
    return;
  }
  if (preparing) return preparing;
  preparing = (async () => {
    if (!cache) {
      cache = await readCache(id);
      notify();
    }
    const local = cache;
    const fresh = Boolean(local && !local.pending && Date.now() - local.syncedAt < SYNC_TTL);
    /**
     * 上下文（官网的常用关键词、可屏蔽版块、默认屏蔽版块）来自页面，只有接口能带回来。
     * 它跟「设置新鲜度」是两回事：本地设置刚同步过、5 分钟内不再拉取时，
     * 也必须把上下文补齐 —— 否则屏蔽设置页里「常用关键词 / 屏蔽版块」会是空的。
     */
    if (fresh && contextKnown()) {
      ready = true;
      notify();
      return;
    }
    ready = true;
    notify();
    try {
      const remote = await api.topicFilter();
      setTopicFilterContext(remote.context);
      if (local?.pending) {
        await push(local.settings);
        return;
      }
      if (fresh) return;
      if (remote.exists) {
        await writeCache({
          settings: sanitizeFilterSettings(remote.settings, remote.context),
          pending: false,
          syncedAt: Date.now(),
        });
        return;
      }
      const settings = currentSettings();
      const configured = settings.presets.length || settings.custom.length || settings.users.length
        || settings.forumExcludedIds.length || settings.forumExtraIds.length;
      if (configured) await push(settings);
      else await writeCache({ settings, pending: false, syncedAt: Date.now() });
    } catch (error) {
      lastError = error instanceof Error ? error.message : '同步失败';
    }
  })().finally(() => {
    preparing = null;
  });
  return preparing;
}

/** 保存：先落本地（离线优先），再推账号；推失败保留 pending 稍后重试。 */
export async function saveTopicFilterSettings(input: TopicFilterSettings): Promise<boolean> {
  const next = sanitizeFilterSettings(input, currentContext());
  await writeCache({ settings: next, pending: true, syncedAt: 0 });
  try {
    await push(next);
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : '同步失败';
    notify();
    return false;
  }
}

/** 清空个人屏蔽 = 恢复系统默认（官方同样是把空设置推上去）。 */
export async function clearTopicFilterSettings(): Promise<boolean> {
  return saveTopicFilterSettings(EMPTY_TOPIC_FILTER);
}
