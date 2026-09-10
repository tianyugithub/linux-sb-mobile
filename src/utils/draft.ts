import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

/**
 * 发帖草稿：与官方编辑器一致（自动保存、保留 7 天后过期）。
 *
 * 官方用 localStorage；App 在原生端用应用文档目录里的一个 JSON 文件，
 * web 端继续用 sessionStorage。磁盘读取是异步的，用 preloadDraft 预取到
 * 模块级缓存后，loadDraft() 仍可同步调用。
 */

const KEY = 'lsb.topic-draft';
const FILE = 'topic-draft.json';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export type TopicDraft = {
  forum: string;
  title: string;
  body: string;
  at?: number;
};

let cache: TopicDraft | null = null;
let hydrated = false;

function draftFile(): File {
  return new File(Paths.document, FILE);
}

function fresh(draft: TopicDraft | null): TopicDraft | null {
  if (!draft) return null;
  if (draft.at && Date.now() - draft.at > MAX_AGE) return null;
  return draft;
}

function readWeb(): TopicDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TopicDraft) : null;
  } catch {
    return null;
  }
}

/** 同步读取：返回已预取的草稿（未预取时为 null）。 */
export function loadDraft(): TopicDraft | null {
  return cache;
}

/** 从磁盘/会话存储预取草稿，过期即丢弃。重复调用只生效一次。 */
export async function preloadDraft(): Promise<TopicDraft | null> {
  if (hydrated) return cache;
  hydrated = true;
  if (Platform.OS === 'web') {
    const draft = fresh(readWeb());
    if (!draft) clearDraft();
    cache = draft;
    return cache;
  }
  try {
    const target = draftFile();
    if (!target.exists) return null;
    const parsed = JSON.parse(await target.text()) as TopicDraft;
    const draft = fresh(parsed);
    if (!draft) clearDraft();
    cache = draft;
  } catch {
    cache = null;
  }
  return cache;
}

export function saveDraft(draft: TopicDraft): void {
  const next: TopicDraft = { ...draft, at: Date.now() };
  cache = next;
  if (Platform.OS === 'web') {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore quota */
    }
    return;
  }
  try {
    draftFile().write(JSON.stringify(next));
  } catch {
    /* 磁盘写失败不影响编辑 */
  }
}

export function clearDraft(): void {
  cache = null;
  if (Platform.OS === 'web') {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const target = draftFile();
    if (target.exists) target.delete();
  } catch {
    /* ignore */
  }
}
