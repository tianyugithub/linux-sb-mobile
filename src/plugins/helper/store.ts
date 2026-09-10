import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import type { LedgerRow } from './points';
import type { SynthEntry } from './synth';
import { pruneLedgerRows } from './cache';

/**
 * 「饼友助手」的落盘快照。
 *
 * 为什么不用 SecureStore：安卓上 expo-secure-store 的单个值有大小限制（2KB 级别），
 * 积分流水几百条会直接超限；这里跟草稿/查询缓存一样用应用文档目录里的一个 JSON 文件。
 *
 * 存的是**解析后的数据**（流水行、合成条目），不是 HTML：
 *   1. 体积小一到两个数量级；
 *   2. 再打开时可以直接渲染，网络只用来补最新那几页。
 */

const FILE_PREFIX = 'helper-snapshot-';
const WEB_KEY = (uid: string) => `lsb.helper.snapshot.${uid}`;
/** 快照保留上限：超过就只保近 14 天的行（流水只用到 7 天）。 */
const KEEP_DAYS = 14;

export type HelperSnapshot = {
  uid: string;
  /** 积分流水抓取时间。 */
  at: number;
  rows: LedgerRow[];
  ledgerPages: number;
  /** 是否已经抓到七天前（false = 还可以继续往下翻）。 */
  ledgerComplete: boolean;
  /** 合成条目（已解析，通知原文也留着便于回溯）。 */
  synth: SynthEntry[];
  synthAt: number;
  synthComplete: boolean;
};

export const EMPTY_SNAPSHOT = (uid = ''): HelperSnapshot => ({
  uid,
  at: 0,
  rows: [],
  ledgerPages: 0,
  ledgerComplete: false,
  synth: [],
  synthAt: 0,
  synthComplete: false,
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

function pruneRows(rows: LedgerRow[]): LedgerRow[] {
  return pruneLedgerRows(rows, KEEP_DAYS);
}

/** 同步读快照：冷启动进插件页时先渲染它，再后台补最新。 */
export function readHelperSnapshot(uid: string): HelperSnapshot {
  const raw = readRaw(uid);
  if (!raw) return EMPTY_SNAPSHOT(uid);
  try {
    const parsed = JSON.parse(raw) as Partial<HelperSnapshot>;
    return {
      uid,
      at: Number(parsed.at) || 0,
      rows: Array.isArray(parsed.rows) ? pruneRows(parsed.rows as LedgerRow[]) : [],
      ledgerPages: Number(parsed.ledgerPages) || 0,
      ledgerComplete: parsed.ledgerComplete === true,
      synth: Array.isArray(parsed.synth) ? (parsed.synth as SynthEntry[]) : [],
      synthAt: Number(parsed.synthAt) || 0,
      synthComplete: parsed.synthComplete === true,
    };
  } catch {
    return EMPTY_SNAPSHOT(uid);
  }
}

export function writeHelperSnapshot(snapshot: HelperSnapshot): void {
  if (!snapshot.uid) return;
  try {
    writeRaw(snapshot.uid, JSON.stringify({ ...snapshot, rows: pruneRows(snapshot.rows) }));
  } catch {
    /* 忽略序列化失败 */
  }
}

export function clearHelperSnapshot(uid: string): void {
  writeRaw(uid, null);
}

/** 合并流水：以时间+原因+变动去重，按时间倒序（新抓到的覆盖旧的同一条）。 */

export {
  mergeLedgerRows,
  mergeSynthEntries,
  overlapsCache,
  cacheCoversFloor,
  snapshotAgeText,
} from './cache';
