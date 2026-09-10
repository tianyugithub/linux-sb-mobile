import { Platform } from 'react-native';
import { secureDelete, secureGet, secureSet } from '../services/secure-value';

type Seen = { today: number; latest: string; day: string };

const KEY = 'lsb.forum_seen';
let map: Record<string, Seen> = {};
let hydrated = false;

function cstDay() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function persist() {
  const raw = JSON.stringify(map);
  if (Platform.OS === 'web') {
    try {
      localStorage.setItem(KEY, raw);
    } catch {
      /* ignore */
    }
    return;
  }
  void secureSet(KEY, raw).catch(() => undefined);
}

export async function hydrateForumSeen() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem(KEY)
      : await secureGet(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Seen>;
    map = { ...parsed, ...map };
  } catch {
    /* ignore */
  }
}

export function forumHasDot(board: { name: string; today: number; latest?: string }) {
  if (board.today <= 0) return false;
  const seen = map[board.name];
  if (!seen || seen.day !== cstDay()) return true;
  if (board.today > seen.today) return true;
  if ((board.latest || '') !== seen.latest) return true;
  return false;
}

export function markForumSeen(board: { name: string; today: number; latest?: string }) {
  map[board.name] = {
    today: board.today,
    latest: board.latest || '',
    day: cstDay(),
  };
  persist();
}
