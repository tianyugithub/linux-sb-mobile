import { AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { api } from './api';
import { getAccessToken, hydrateSession } from './session';
import {
  isIgnoringBattery,
  requestBatteryExemption,
  setNotifyGuardEnabled,
  startNotifyGuard,
  stopNotifyGuard,
  syncNotifySession,
} from 'linux-notify';
import { cookiesForToken } from './site-session';
import type { NotificationDto, NotificationKind } from '../types/api';

const TASK = 'lsb-notify-poll';
const ENABLED_KEY = 'lsb.push.enabled';
const LAST_COUNT_KEY = 'lsb.push.lastUnread';
const DM_SNAPSHOT_KEY = 'lsb.push.dmSnapshot';
const SEEN_IDS_KEY = 'lsb.push.seenIds';
const BASELINE_KEY = 'lsb.push.baselined';
const RESPONSE_KEY = 'lsb.push.handledResponse';
const CHANNEL = 'linux-sb-messages';

type DmTarget = { userId: string; name: string; preview: string };

type PushHooks = {
  openMessages: () => void;
  openDm: (userId: string, title?: string) => void;
  openTopic: (topicId: string, replyId?: string, title?: string) => void;
  setUnread: (count: number) => void;
  viewingMessages: () => boolean;
};

const KIND_TITLE: Record<NotificationKind, string> = {
  mention: '有人提及了你',
  reply: '有人回复了你',
  reward: '收到打赏',
  system: '系统通知',
};

let hooks: PushHooks | null = null;
let pendingResponse: Notifications.NotificationResponse | null = null;
let started = false;
let inflight: Promise<number> | null = null;

function native(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

async function storeGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function storeSet(key: string, value: string | null) {
  try {
    if (value == null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    /* ignore */
  }
}

export async function isPushEnabled(): Promise<boolean> {
  if (!native()) return false;
  const stored = await storeGet(ENABLED_KEY);
  return stored !== '0';
}

async function lastUnread(): Promise<number | null> {
  const raw = await storeGet(LAST_COUNT_KEY);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function setLastUnread(count: number) {
  await storeSet(LAST_COUNT_KEY, String(Math.max(0, count)));
  syncNotifySession(cookiesForToken(getAccessToken()) ?? '', Math.max(0, count), true);
}

async function readSeenIds(): Promise<string[]> {
  const raw = await storeGet(SEEN_IDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function writeSeenIds(ids: string[]) {
  const unique = [...new Set(ids)].slice(-120);
  await storeSet(SEEN_IDS_KEY, JSON.stringify(unique));
}

export async function markNotificationsSeen(ids: string[]) {
  if (!ids.length) return;
  const prev = await readSeenIds();
  await writeSeenIds([...prev, ...ids]);
}

async function readDmSnapshot(): Promise<Record<string, string> | null> {
  const raw = await storeGet(DM_SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
}

function dmSignature(items: Array<{ userId: string; preview: string }>): Record<string, string> {
  const next: Record<string, string> = {};
  items.slice(0, 12).forEach((item) => {
    next[item.userId] = item.preview;
  });
  return next;
}

async function detectNewDm(commit: boolean): Promise<DmTarget | null> {
  try {
    const { items } = await api.directMessages();
    if (!items.length) return null;
    const prev = await readDmSnapshot();
    const next = dmSignature(items);
    if (commit) await storeSet(DM_SNAPSHOT_KEY, JSON.stringify(next));
    if (!prev) {
      if (commit) return null;
      return null;
    }
    const changed = items.find((item) => prev[item.userId] !== item.preview);
    if (!changed) return null;
    return { userId: changed.userId, name: changed.name, preview: changed.preview };
  } catch {
    return null;
  }
}

async function commitDmSnapshot() {
  try {
    const { items } = await api.directMessages();
    if (items.length) await storeSet(DM_SNAPSHOT_KEY, JSON.stringify(dmSignature(items)));
  } catch {
    /* ignore */
  }
}

if (native()) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const id = notification.request.identifier;
      const guard = id === 'lsb-guard' || notification.request.content.data?.kind === 'guard';
      if (guard) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      };
    },
  });
  TaskManager.defineTask(TASK, async () => {
    try {
      await pollAndNotify(true);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: '社区消息',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 220, 160, 220],
    lightColor: '#E1251B',
    sound: 'default',
    showBadge: true,
    enableVibrate: true,
    description: '回复、提及、打赏和系统通知',
  });
}

function noticeBody(item: NotificationDto) {
  const text = (item.text || item.topicTitle || '').replace(/\s+/g, ' ').trim();
  return `${item.actorName}${text ? `：${text}` : ''}`.slice(0, 140);
}

async function presentItem(item: NotificationDto, unread: number) {
  await Notifications.scheduleNotificationAsync({
    identifier: `lsb-${item.id}`,
    content: {
      title: KIND_TITLE[item.kind] || 'LINUX SB',
      body: noticeBody(item),
      sound: true,
      badge: unread,
      data: {
        screen: item.topicId ? 'topic' : 'messages',
        topicId: item.topicId || '',
        replyId: item.replyId || '',
        title: item.topicTitle || '',
        kind: item.kind,
      },
    },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
}

async function presentDm(dm: DmTarget, unread: number) {
  await Notifications.scheduleNotificationAsync({
    identifier: `lsb-dm-${dm.userId}`,
    content: {
      title: '新的私信',
      body: `${dm.name}：${dm.preview}`.replace(/\s+/g, ' ').slice(0, 140),
      sound: true,
      badge: unread,
      data: { screen: 'dm', userId: dm.userId, title: dm.name },
    },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
}

export async function sendTestNotification() {
  if (!native()) return false;
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: `lsb-test-${Date.now()}`,
    content: {
      title: '有人提及了你',
      body: '测试通知：若能看到这条，系统通知通道正常。',
      sound: true,
      data: { screen: 'messages', kind: 'mention' },
    },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
  return true;
}

export async function rememberUnread(unread: number) {
  await setLastUnread(unread);
  if (native() && unread >= 0) {
    try {
      await Notifications.setBadgeCountAsync(unread);
    } catch {
      /* web / unsupported */
    }
  }
}

async function pollAndNotifyInner(_fromBackground = false) {
  if (!native()) return 0;
  if (!(await isPushEnabled())) return 0;
  await hydrateSession();
  if (!getAccessToken()) return 0;
  await ensureChannel();
  const { unread } = await api.notificationUnread();
  hooks?.setUnread(unread);
  const viewing = hooks?.viewingMessages() ?? false;
  const dm = await detectNewDm(false);
  const baselined = (await storeGet(BASELINE_KEY)) === '1';
  if (!baselined) {
    await storeSet(BASELINE_KEY, '1');
    await commitDmSnapshot();
    await rememberUnread(unread);
    return unread;
  }

  if (viewing) {
    await commitDmSnapshot();
    await rememberUnread(unread);
    return unread;
  }

  const prev = (await lastUnread()) ?? 0;
  if (unread > prev && !dm) {
    await Notifications.scheduleNotificationAsync({
      identifier: 'lsb-unread',
      content: {
        title: 'LINUX SB',
        body: unread <= 1 ? '你有 1 条新消息' : `你有 ${unread} 条未读消息`,
        sound: true,
        badge: unread,
        data: { screen: 'messages' },
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
  }
  if (dm) {
    await presentDm(dm, unread);
    await commitDmSnapshot();
  }
  await rememberUnread(unread);
  return unread;
}

export async function pollAndNotify(fromBackground = false) {
  if (inflight) return inflight;
  inflight = pollAndNotifyInner(fromBackground).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function registerBackground() {
  // ColorOS defers WorkManager heavily; native AlarmManager poller is the real path.
  if (!native()) return;
  if (await TaskManager.isTaskRegisteredAsync(TASK)) {
    await BackgroundTask.unregisterTaskAsync(TASK);
  }
}

async function unregisterBackground() {
  if (!native()) return;
  if (await TaskManager.isTaskRegisteredAsync(TASK)) {
    await BackgroundTask.unregisterTaskAsync(TASK);
  }
}

function syncGuard(state: string) {
  if (Platform.OS !== 'android') return;
  if (state !== 'active') startNotifyGuard();
}

export async function requestPushPermission(): Promise<boolean> {
  if (!native()) return false;
  const current = await Notifications.getPermissionsAsync();
  const next = current.granted ? current : await Notifications.requestPermissionsAsync();
  return Boolean(next.granted || next.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
}

export async function enablePush(): Promise<boolean> {
  if (!native()) return false;
  const ok = await requestPushPermission();
  if (!ok) {
    await storeSet(ENABLED_KEY, '0');
    setNotifyGuardEnabled(false);
    return false;
  }
  await storeSet(ENABLED_KEY, '1');
  setNotifyGuardEnabled(true);
  await ensureChannel();
  await registerBackground();
  const unread = await pollAndNotify(false);
  await rememberUnread(unread);
  startNotifyGuard();
  requestBatteryExemption();
  return true;
}

export async function disablePush() {
  await storeSet(ENABLED_KEY, '0');
  setNotifyGuardEnabled(false);
  stopNotifyGuard();
  await unregisterBackground();
  if (native()) {
    try {
      await Notifications.dismissAllNotificationsAsync();
      await Notifications.setBadgeCountAsync(0);
    } catch {
      /* ignore */
    }
  }
}

export { isIgnoringBattery, requestBatteryExemption };

export async function openSystemNotificationSettings() {
  if (Platform.OS === 'android') {
    await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: 'sb.linux.mobile' },
    ]).catch(() => Linking.openSettings());
    return;
  }
  await Linking.openSettings();
}

export function setPushHooks(next: PushHooks | null) {
  hooks = next;
  if (next && pendingResponse) {
    const response = pendingResponse;
    pendingResponse = null;
    handleResponse(response);
  }
}

function responseStamp(response: Notifications.NotificationResponse): string {
  const { identifier } = response.notification.request;
  return `${identifier}:${response.notification.date}`;
}

async function handleResponse(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  if (!hooks) {
    pendingResponse = response;
    return;
  }
  /**
   * 安卓（尤其 ColorOS 回收后台后从最近任务恢复）会把上一次点击的通知响应
   * 当成冷启动的启动响应再交一次，于是「每次重开 App 都先进消息页」。
   * 记下已经处理过的响应，同一条不再导航。
   */
  const stamp = responseStamp(response);
  if ((await storeGet(RESPONSE_KEY)) === stamp) {
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    return;
  }
  await storeSet(RESPONSE_KEY, stamp);
  const data = response.notification.request.content.data ?? {};
  const screen = data.screen;
  const userId = data.userId == null ? '' : String(data.userId);
  const topicId = data.topicId == null ? '' : String(data.topicId);
  const replyId = data.replyId == null ? '' : String(data.replyId);
  const title = typeof data.title === 'string' ? data.title : undefined;
  if (screen === 'dm' && userId) hooks.openDm(userId, title);
  else if (screen === 'topic' && topicId) hooks.openTopic(topicId, replyId || undefined, title);
  else if (screen === 'messages' || !screen) hooks.openMessages();
  void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
}

export async function startPushRuntime() {
  if (!native() || started) return;
  started = true;
  await ensureChannel();
  const enabled = await isPushEnabled();
  if (enabled) {
    const granted = await requestPushPermission();
    if (granted) {
      setNotifyGuardEnabled(true);
      await registerBackground();
      startNotifyGuard();
    } else {
      await storeSet(ENABLED_KEY, '0');
      setNotifyGuardEnabled(false);
    }
  }
  Notifications.addNotificationResponseReceivedListener((response) => {
    handleResponse(response);
  });
  /**
   * 冷启动这一次的「启动响应」不再导航：软件打开默认进首页。
   * （安卓被回收后从最近任务恢复时，会把上次点击的响应重放成启动响应。）
   * 记成已处理，免得它稍后又从监听器冒出来把用户推进消息页。
   */
  const launch = Notifications.getLastNotificationResponse();
  if (launch) await storeSet(RESPONSE_KEY, responseStamp(launch));
  void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  AppState.addEventListener('change', (state) => {
    syncGuard(state);
    if (state !== 'active') void pollAndNotify(true);
    else void pollAndNotify(false);
  });
  if (enabled && getAccessToken()) void pollAndNotify(false);
}
