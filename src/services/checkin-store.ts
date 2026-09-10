import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

/**
 * 签到记录的本机快照。
 *
 * 签到记录散落在几百条积分流水里（一天 50 条，签到一天才一条），
 * 想列全必须翻很多页。所以：**首次抓完落盘，之后先读盘秒开，再在后台并发补齐**。
 * 与插件一样用应用文档目录的 JSON（安卓 SecureStore 单值只有 2KB 级别，装不下）。
 */

const FILE_PREFIX = 'checkin-history-';
const WEB_KEY = (uid: string) => `lsb.checkin.history.${uid}`;
const KEEP_DAYS = 400;

export type CheckinRecord = { date: string; gain: number | null };

export type CheckinSnapshot = {
  uid: string;
  at: number;
  records: CheckinRecord[];
  /** 是否已经抓到「累计签到」那么多条（false = 还可以继续补）。 */
  complete: boolean;
  pages: number;
};

export const EMPTY_CHECKIN_SNAPSHOT = (uid = ''): CheckinSnapshot => ({
  uid,
  at: 0,
  records: [],
  complete: false,
  pages: 0,
});

function snapshotFile(uid: string): File {
  return new File(Paths.document, `${FILE_PREFIX}${uid}.json`);
}

function readRaw(uid: string): string | null {
  if (!uid) return null;
  if (Platform.OS === 'web') {
    try {
      return sessionStorage.getItem(WEB_KEY(uid));
    } catch {
      return null;
    }
  }
  try {
    const file = snapshotFile(uid);
    return file.exists ? file.textSync() : null;
  } catch {
    return null;
  }
}

function writeRaw(uid: string, text: string | null) {
  if (!uid) return;
  if (Platform.OS === 'web') {
    try {
      if (text) sessionStorage.setItem(WEB_KEY(uid), text);
      else sessionStorage.removeItem(WEB_KEY(uid));
    } catch {
      /* 配额不足就放弃快照 */
    }
    return;
  }
  try {
    const file = snapshotFile(uid);
    if (text) file.write(text);
    else if (file.exists) file.delete();
  } catch {
    /* 写失败只是下次重新抓 */
  }
}

/** 记录去重键：日期 + 积分（同一天签到只会有一条）。 */
function recordKey(record: CheckinRecord): string {
  return `${record.date}|${record.gain ?? ''}`;
}

/** 合并记录：按「日期+积分」去重，按时间倒序；顺带丢掉过老的记录。 */
export function mergeCheckinRecords(cached: CheckinRecord[], fresh: CheckinRecord[]): CheckinRecord[] {
  const map = new Map<string, CheckinRecord>();
  cached.forEach((record) => map.set(recordKey(record), record));
  fresh.forEach((record) => map.set(recordKey(record), record));
  const floor = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  return [...map.values()]
    .filter((record) => {
      const t = new Date(record.date.replace(' ', 'T')).getTime();
      return Number.isNaN(t) || t >= floor;
    })
    .sort((a, b) => new Date(b.date.replace(' ', 'T')).getTime() - new Date(a.date.replace(' ', 'T')).getTime());
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 把记录时间拆成列表要用的三段：日期 / 星期 / 时间。 */
export function checkinRecordMeta(date: string): { day: string; weekday: string; time: string } {
  const text = String(date ?? '');
  const day = text.slice(0, 10);
  const time = text.slice(11, 16);
  const parsed = new Date(`${day}T${time || '00:00'}:00`);
  return {
    day: day || text,
    weekday: Number.isNaN(parsed.getTime()) ? '' : WEEKDAYS[parsed.getDay()],
    time,
  };
}

/** 近 N 天里哪些天签到了（用于日历条）。 */
export function checkinDayMap(records: CheckinRecord[], days = 14): { date: Date; checked: boolean }[] {
  const checked = new Set(
    records.map((record) => String(record.date).slice(0, 10)).filter(Boolean),
  );
  const out: { date: Date; checked: boolean }[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    out.push({ date, checked: checked.has(key) });
  }
  return out;
}

export function readCheckinSnapshot(uid: string): CheckinSnapshot {
  const raw = readRaw(uid);
  if (!raw) return EMPTY_CHECKIN_SNAPSHOT(uid);
  try {
    const parsed = JSON.parse(raw) as Partial<CheckinSnapshot>;
    return {
      uid,
      at: Number(parsed.at) || 0,
      records: Array.isArray(parsed.records) ? mergeCheckinRecords(parsed.records as CheckinRecord[], []) : [],
      complete: parsed.complete === true,
      pages: Number(parsed.pages) || 0,
    };
  } catch {
    return EMPTY_CHECKIN_SNAPSHOT(uid);
  }
}

export function writeCheckinSnapshot(snapshot: CheckinSnapshot): void {
  if (!snapshot.uid) return;
  try {
    writeRaw(snapshot.uid, JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}

export function clearCheckinSnapshot(uid: string): void {
  writeRaw(uid, null);
}

export function checkinAgeText(at: number, now = Date.now()): string {
  if (!at) return '还没有缓存';
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return '刚刚更新';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  return `${Math.floor(hours / 24)} 天前更新`;
}
