/**
 * 帖子评论区空态：官网游客看不到楼层（「登录后可见」），解析失败时列表也是空的。
 * 这两种都不能写成「还没有回复」——有回复的帖子会看起来像评论丢了。
 */
export type CommentsEmptyKind = 'login' | 'retry' | 'empty' | null;

export function commentsEmptyKind(input: {
  hasComments: boolean;
  loading: boolean;
  /** 有缓存空列表时 loading=false，但后台还在重拉，这时不该先弹出「没加载出来」。 */
  fetching?: boolean;
  error?: string | null;
  replyCount: number;
  loggedIn: boolean;
  loginRequired?: boolean;
}): CommentsEmptyKind {
  if (input.loading || input.fetching || input.error || input.hasComments) return null;
  if (input.loginRequired) return input.loggedIn ? 'retry' : 'login';
  if (input.replyCount > 0) return 'retry';
  return input.loggedIn ? 'empty' : 'login';
}
