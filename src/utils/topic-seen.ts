import { Platform } from 'react-native';
import { secureDelete, secureGet, secureSet } from '../services/secure-value';

type Seen = { replies: number; at: number };

const KEY = 'lsb.topic_seen';
const CAP = 4000;
let map: Record<string, Seen> = {};
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribeTopicSeen(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persist() {
  const entries = Object.entries(map).sort((a, b) => b[1].at - a[1].at).slice(0, CAP);
  map = Object.fromEntries(entries);
  const raw = JSON.stringify(map);
  if (Platform.OS === 'web') {
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      /* ignore */
    }
    notify();
    return;
  }
  void secureSet(KEY, raw).catch(() => undefined);
  notify();
}

export async function hydrateTopicSeen() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem(KEY)
      : await secureGet(KEY);
    if (!raw) {
      notify();
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, Seen>;
    map = { ...parsed, ...map };
  } catch {
    /* ignore */
  }
  notify();
}

export function topicWasRead(id: string) {
  return Boolean(map[id]);
}

export function topicHasUnread(id: string, replies: number) {
  const seen = map[id];
  if (!seen) return false;
  return Math.max(0, replies) > seen.replies;
}

export function topicShowsUnread(id: string, replies: number, htmlUnread?: boolean) {
  const seen = map[id];
  if (seen) return Math.max(0, replies) > seen.replies;
  return Boolean(htmlUnread);
}

export function markTopicSeen(id: string, replies: number) {
  if (!id) return;
  const prev = map[id];
  map[id] = {
    replies: Math.max(prev?.replies ?? 0, Math.max(0, replies)),
    at: Date.now(),
  };
  persist();
}
