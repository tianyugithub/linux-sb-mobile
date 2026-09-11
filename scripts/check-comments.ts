/**
 * 主题评论空态：游客页是「登录后可见」，不是零回复。
 * 登录态却拿到游客皮时，也不能写「还没有回复」。
 *
 *   node scripts/run-stubbed.mjs scripts/check-comments.ts
 */
import { commentsHidden, commentsRequireLogin, parseComments } from '../src/services/live';
import { commentsEmptyKind } from '../src/utils/comments-empty';

let failed = 0;
function check(label: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
}

/** 2026-09-11 /topic/21270 游客页：楼层在「登录后可见」后面。 */
const guestTopic = '<article class="post-entry" id="post-21270"></article>'
  + '<div class="replies-login-visible" data-replies-login-visible="1">共有 56 条评论，登录后可见</div>';

const loginWall = '<title>登录 - LINUX SB</title><a class="nav-mine nav-mine-guest" href="/login">登录</a>'
  + '<form><input name="_csrf"><input name="username"><input name="password"></form>';

const replyHtml = '<ul><li class="post-item post-reply" id="post-174299" data-floor="1">'
  + '<div class="post-info"><a class="post-author" href="/user/119">饼友</a></div>'
  + '<div class="post-content"><div class="nb-editor-post-content"><p>一条回复</p></div></div></li></ul>';

console.log('评论区：登录可见 vs 真的没有回复');
check('游客标记认得出', commentsHidden(guestTopic) === true);
check('游客页零楼层 = 需要登录', commentsRequireLogin(guestTopic, 0) === true);
check('有楼层就不算登录墙', commentsRequireLogin(guestTopic, 3) === false);
check('登录墙也算需要登录', commentsRequireLogin(loginWall, 0) === true);
check('登录态楼层能解析', parseComments(replyHtml, '21348').length === 1);
check('普通回复页不误判登录墙', commentsRequireLogin(replyHtml, 1) === false);

check(
  '游客 + 56 条回复 → 文案是登录可见',
  commentsEmptyKind({ hasComments: false, loading: false, replyCount: 56, loggedIn: false, loginRequired: true }) === 'login',
);
check(
  '已登录却拿到游客皮 → 重试，不写还没有回复',
  commentsEmptyKind({ hasComments: false, loading: false, replyCount: 56, loggedIn: true, loginRequired: true }) === 'retry',
);
check(
  '已登录、有回复数、解析空 → 重试',
  commentsEmptyKind({ hasComments: false, loading: false, replyCount: 12, loggedIn: true }) === 'retry',
);
check(
  '已登录、零回复 → 还没有回复',
  commentsEmptyKind({ hasComments: false, loading: false, replyCount: 0, loggedIn: true }) === 'empty',
);
check(
  '加载中不抢空态',
  commentsEmptyKind({ hasComments: false, loading: true, replyCount: 12, loggedIn: true }) === null,
);
check(
  '缓存是空的但还在重拉 → 不抢空态',
  commentsEmptyKind({ hasComments: false, loading: false, fetching: true, replyCount: 56, loggedIn: true }) === null,
);
check(
  '已经有楼层不显示空态',
  commentsEmptyKind({ hasComments: true, loading: false, replyCount: 12, loggedIn: true }) === null,
);

console.log(failed ? `\n✗ ${failed} 项未通过` : '\n✓ 通过：评论空态回归正常');
process.exit(failed ? 1 : 0);
