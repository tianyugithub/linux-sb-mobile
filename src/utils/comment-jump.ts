/**
 * 主题评论的「跳到未读 / 最新」只负责第一次落地。
 * 落地之后分页、新回复都不该再把人拽回去。
 */

export type CommentJumpFollow = 'auto' | 'idle';

export function topicJumpPage(
  topic: { unreadPage?: number; unreadFloor?: string; lastPage?: number },
  latest?: boolean,
) {
  if (!latest) return 1;
  if (topic.unreadPage && topic.unreadPage > 0) return topic.unreadPage;
  if (topic.unreadFloor) return 1;
  return Math.max(1, topic.lastPage ?? 1);
}

export function shouldChaseLatestPage(input: {
  follow: CommentJumpFollow;
  latest?: boolean;
  replyLocked?: boolean;
  unreadPage?: number;
  unreadFloor?: string;
  commentPage: number;
  lastPage: number;
}): boolean {
  if (input.follow !== 'auto') return false;
  if (!input.latest || input.replyLocked) return false;
  if ((input.unreadPage && input.unreadPage > 0) || input.unreadFloor) return false;
  return input.commentPage > 0 && input.lastPage > input.commentPage;
}

/** 当前评论数据和正在看的页是否对得上（切页瞬间还可能是上一页的缓存）。 */
export function commentsPageMatches(commentPage: number, dataPage?: number): boolean {
  if (commentPage === 0) return true;
  if (dataPage == null) return false;
  if (commentPage <= 1) return dataPage === 1;
  return dataPage === commentPage;
}
