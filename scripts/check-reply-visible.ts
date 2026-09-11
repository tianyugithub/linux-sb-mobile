/**
 * 官网「回复可见」（编辑器 `[回复可见]…[/回复可见]`）的离线回归。
 *
 * 这是主题正文里的隐藏块，不是评论区的「登录可见」，也不是新的回帖种类。
 * 锁定/解锁由服务端渲染；回帖成功后官网重拉主题页替换 `.nb-editor-reply-visible-locked`。
 *
 * 样本取自真实页面：
 *   /topic/21326、/topic/21376 游客锁定态；登录后 /topic/21376 的解锁态。
 *
 *   npm run check:reply-visible
 */
import {
  REPLY_VISIBLE_CLOSE,
  REPLY_VISIBLE_LABEL,
  REPLY_VISIBLE_LOCKED_HINT,
  REPLY_VISIBLE_LOCKED_TITLE,
  REPLY_VISIBLE_OPEN,
  articleImageSrcs,
  blocksToMarkdown,
  hasLockedReplyVisible,
  htmlToSource,
  parseEditableArticle,
} from '../src/utils/article';
import { blocksToHtml } from '../src/editor/blocks-html';
import { insertReplyVisible } from '../src/utils/markdown-edit';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

/** /topic/21326、/topic/21376 游客正文（服务端不吐隐藏内容）。 */
const LOCKED = '<section class="nb-editor-reply-visible nb-editor-reply-visible-locked">'
  + '<div class="nb-editor-reply-visible-notice"><span aria-hidden="true">🔒</span>'
  + '<div><strong>回复后可见</strong><span>回复本主题后即可查看这部分内容。</span></div></div></section>';

/** 登录且已回帖后的 /topic/21376。 */
const OPEN = '<section class="nb-editor-reply-visible nb-editor-reply-visible-open">'
  + '<div class="nb-editor-reply-visible-label">回复可见内容</div><p>爱你哟！</p></section>';

const GUEST_BODY = `${LOCKED}<p>刚才因为BUG错扣的积分已经退回了</p>`;
const AUTH_BODY = `${OPEN}<p>刚才因为BUG错扣的积分已经退回了</p>`;

console.log('主题页锁定态（真实片段，游客 /topic/21376）');
const lockedBlocks = parseEditableArticle(GUEST_BODY);
const locked = lockedBlocks.find((block) => block.type === 'reply_visible');
check('认出锁定块', locked?.type === 'reply_visible' && locked.locked === true);
check('标题取自页面', locked?.type === 'reply_visible' && locked.label === REPLY_VISIBLE_LOCKED_TITLE, locked && locked.type === 'reply_visible' ? locked.label : '');
check('说明取自页面', locked?.type === 'reply_visible' && locked.notice === REPLY_VISIBLE_LOCKED_HINT);
check('锁定块没有正文', locked?.type === 'reply_visible' && locked.blocks.length === 0);
check('后面的公开段落还在', lockedBlocks.some((block) => (
  block.type === 'p' && block.spans.some((span) => span.type === 'text' && span.text.includes('积分已经退回'))
)));
check('hasLockedReplyVisible', hasLockedReplyVisible(GUEST_BODY));
check('锁定 HTML 不进 markdown 源', !htmlToSource(GUEST_BODY).includes('回复后可见') && !htmlToSource(GUEST_BODY).includes(REPLY_VISIBLE_OPEN));
check('序列化锁定块不泄露', !blocksToMarkdown(lockedBlocks).includes(REPLY_VISIBLE_OPEN));
check('没有这块就不是锁定', !hasLockedReplyVisible('<p>普通帖子</p>'));

console.log('主题页解锁态（真实片段，已回帖 /topic/21376）');
const openBlocks = parseEditableArticle(AUTH_BODY);
const opened = openBlocks.find((block) => block.type === 'reply_visible');
check('认出解锁块', opened?.type === 'reply_visible' && opened.locked === false);
check('标签取自页面', opened?.type === 'reply_visible' && opened.label === REPLY_VISIBLE_LABEL, opened && opened.type === 'reply_visible' ? opened.label : '');
check('正文是「爱你哟！」', opened?.type === 'reply_visible' && opened.blocks.some((block) => (
  block.type === 'p' && block.spans.some((span) => span.type === 'text' && span.text === '爱你哟！')
)));
check('公开段落仍在后面', openBlocks.some((block) => (
  block.type === 'p' && block.spans.some((span) => span.type === 'text' && span.text.includes('积分已经退回'))
)));
check('解锁后不再算锁定', !hasLockedReplyVisible(AUTH_BODY));
const openSource = htmlToSource(AUTH_BODY);
check('解锁 HTML 回到官方标签', openSource.includes(REPLY_VISIBLE_OPEN) && openSource.includes(REPLY_VISIBLE_CLOSE) && openSource.includes('爱你哟！'));
check('htmlToSource 丢掉标签行', !openSource.includes(REPLY_VISIBLE_LABEL));

console.log('编辑器 markdown（官网 insertReplyVisible）');
const md = [
  '开头段落',
  '',
  `${REPLY_VISIBLE_OPEN}`,
  '秘密 **加粗**',
  `${REPLY_VISIBLE_CLOSE}`,
  '',
  '结尾段落',
].join('\n');
const mdBlocks = parseEditableArticle(md);
const hidden = mdBlocks.find((block) => block.type === 'reply_visible');
check('markdown 认出块', hidden?.type === 'reply_visible' && hidden.locked === false);
check('块内加粗', hidden?.type === 'reply_visible' && hidden.blocks.some((block) => (
  block.type === 'p' && block.spans.some((span) => span.type === 'strong' && span.text === '加粗')
)));
const roundTrip = blocksToMarkdown(mdBlocks);
check('往返仍是官方标签', roundTrip.includes(`${REPLY_VISIBLE_OPEN}\n秘密 **加粗**\n${REPLY_VISIBLE_CLOSE}`), roundTrip);
const fencedInner = parseEditableArticle([
  REPLY_VISIBLE_OPEN,
  '```js',
  'const a = 1;',
  '```',
  REPLY_VISIBLE_CLOSE,
].join('\n'));
const fencedBlock = fencedInner.find((block) => block.type === 'reply_visible');
check('块内代码围栏仍是代码', Boolean(fencedBlock && fencedBlock.type === 'reply_visible'
  && fencedBlock.blocks.some((block) => block.type === 'code' && block.text.includes('const a = 1;'))));

console.log('所见即所得 HTML 投影');
const html = blocksToHtml(mdBlocks);
check('产出官方 section', html.includes('nb-editor-reply-visible-open') && html.includes(REPLY_VISIBLE_LABEL));
check('内核 HTML 再解回 markdown', blocksToMarkdown(parseEditableArticle(html)).includes('秘密 **加粗**'));
const imageMd = `${REPLY_VISIBLE_OPEN}\n![图](https://linux.sb/img/a.png)\n${REPLY_VISIBLE_CLOSE}`;
check('块内图片进相册', articleImageSrcs(parseEditableArticle(imageMd)).includes('https://linux.sb/img/a.png'));

console.log('源码插入（与官网 insertBlock 选区一致）');
const inserted = insertReplyVisible('前文', { start: 2, end: 2 }, '隐藏内容');
check('插在光标处', inserted.value.includes(`${REPLY_VISIBLE_OPEN}\n隐藏内容\n${REPLY_VISIBLE_CLOSE}`), inserted.value);
check('选中块内正文', inserted.value.slice(inserted.caret.start, inserted.caret.end) === '隐藏内容');
const wrapped = insertReplyVisible('选中这段', { start: 0, end: 4 }, '选中这段');
check('选区被包进标签', wrapped.value.startsWith(`${REPLY_VISIBLE_OPEN}\n选中这段\n${REPLY_VISIBLE_CLOSE}`));
const empty = insertReplyVisible('前文', { start: 2, end: 2 }, '   ');
check('空内容不插入', empty.value === '前文');

console.log(fails ? `\n✗ ${fails} 项未通过` : '\n✓ 通过：回复可见与官网一致');
process.exit(fails ? 1 : 0);
