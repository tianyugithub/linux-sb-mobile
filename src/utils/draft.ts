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

const COMMENT_KEY = 'lsb.comment-drafts';
const COMMENT_FILE = 'comment-drafts.json';
const COMMENT_SILENT_MS = 10 * 60 * 1000;

export type CommentDraft = {
  topicId: string;
  body: string;
  replyToId?: string;
  replyToName?: string;
  replyToFloor?: string;
  at?: number;
};

type CommentDraftStore = Record<string, CommentDraft>;

let commentStore: CommentDraftStore = {};
let commentHydrated = false;
const commentVisitAt = new Map<string, number>();

function commentFile(): File {
  return new File(Paths.document, COMMENT_FILE);
}

function pruneComments(store: CommentDraftStore): CommentDraftStore {
  const next: CommentDraftStore = {};
  const now = Date.now();
  for (const [id, draft] of Object.entries(store)) {
    if (!draft?.body?.trim()) continue;
    if (draft.at && now - draft.at > MAX_AGE) continue;
    next[id] = draft;
  }
  return next;
}

function persistComments() {
  const payload = JSON.stringify(commentStore);
  if (Platform.OS === 'web') {
    try {
      sessionStorage.setItem(COMMENT_KEY, payload);
    } catch {
      /* ignore quota */
    }
    return;
  }
  try {
    commentFile().write(payload);
  } catch {
    /* 磁盘写失败不影响编辑 */
  }
}

async function hydrateComments(): Promise<void> {
  if (commentHydrated) return;
  commentHydrated = true;
  try {
    if (Platform.OS === 'web') {
      const raw = sessionStorage.getItem(COMMENT_KEY);
      commentStore = pruneComments(raw ? JSON.parse(raw) as CommentDraftStore : {});
      return;
    }
    const target = commentFile();
    if (!target.exists) {
      commentStore = {};
      return;
    }
    commentStore = pruneComments(JSON.parse(await target.text()) as CommentDraftStore);
  } catch {
    commentStore = {};
  }
}

export async function preloadCommentDraft(topicId: string): Promise<CommentDraft | null> {
  await hydrateComments();
  return commentStore[topicId] ?? null;
}

export function saveCommentDraft(draft: CommentDraft): void {
  const body = draft.body.trim();
  if (!body) {
    clearCommentDraft(draft.topicId);
    return;
  }
  commentStore = {
    ...commentStore,
    [draft.topicId]: { ...draft, body, at: Date.now() },
  };
  persistComments();
}

export function clearCommentDraft(topicId: string): void {
  if (!commentStore[topicId]) return;
  const next = { ...commentStore };
  delete next[topicId];
  commentStore = next;
  persistComments();
}

/** 主题页被其它子页盖住时记下时刻，回来就静默恢复，不再弹草稿提示。 */
export function markCommentDraftVisit(topicId: string) {
  commentVisitAt.set(topicId, Date.now());
}

/** 真正离开主题后清掉访问标记，下次进来要弹「继续编辑 / 放弃」。 */
export function clearCommentDraftVisit(topicId: string) {
  commentVisitAt.delete(topicId);
}

export function commentDraftVisitIsRecent(topicId: string): boolean {
  const at = commentVisitAt.get(topicId);
  return Boolean(at && Date.now() - at < COMMENT_SILENT_MS);
}

