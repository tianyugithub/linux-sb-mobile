/**
 * 红包帖（官网 `red_packet` 插件）的离线回归。
 *
 * 官网这一套是**服务端渲染**的，游客看不到（回帖区写着「登录后可见」），
 * 下面这些片段是从登录态的主题页 /topic/21348、发帖页与编辑页 /topic_edit?id=21531 原样抓下来的。
 *
 *   npm run check:redpacket
 *
 * 四条链路，缺一条用户在 App 里就会觉得「这功能没对齐」：
 *   1. 主题页卡片：`.red-packet-card` → 状态、剩余份数、三格信息、领取规则；
 *   2. 领取：现行官网是「楼主认可」（楼层 `.red-packet-review-state` + `POST /red_packet_review`），
 *      不是 App 自己造「抢红包」按钮。旧帖仍可能是回帖即领，楼层上标「+N」；
 *   3. 发帖页表单：`.red-packet-compose` → 类型/规则/份数/金额，提交时要带
 *      `red_packet_confirm=1`（官网用它确认「确实要发红包」）；
 *   4. 已发布红包帖的编辑页：设置段只读（`red-packet-readonly`）、`topic_special_type`
 *      是 hidden，提交只带原类型 —— 认不出来就会把类型覆盖成空，保存必被拒。
 */
import {
  extractRedPacketReviewForm,
  isTopicEditorPage,
  parseComments,
  parseRedPacketCompose,
  parseRedPacketPanel,
  parseTopicEditor,
  parseTopicRedPacket,
  parseTopicRedPacketTopup,
  redPacketReviewPagePath,
  topicSpecialPostFields,
} from '../src/services/live';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

/* ── 真实片段 1：主题页的红包卡片 + 回帖框里的刷新地址（/topic/21348） ── */
const CARD = '<section class="red-packet-card is-open"><header><div><strong>积分红包</strong>'
  + '<span>进行中</span></div><b>剩余红包 63 份</b></header>'
  + '<div class="red-packet-card-grid">'
  + '<div><span>红包类型</span><strong>固定金额红包</strong><small>每份 1 积分</small></div>'
  + '<div><span>剩余积分</span><strong>63</strong><small>共 100 积分</small></div>'
  + '<div><span>回帖要求</span><strong>不少于 30 个字</strong><small>触发行为：回复帖子</small></div>'
  + '</div>'
  + '<p>领取规则：随机获得；每人仅有一次随机获得机会。发帖人不能领取，同一用户只能领取一次。</p>'
  + '</section>';

const TOPIC_PAGE = `<html><body><div class="post-topic-title"><h1 class="post-content-title">`
  + `<a href="/topic/21348">试试红包🧧</a></h1><span class="red-packet-title-status">红包帖</span></div>`
  + CARD
  + `<form class="ajax-reply-form"><textarea name="body"></textarea>`
  + `<span hidden data-red-packet-live data-red-packet-status-url="/red_packet_status?topic_id=21348"></span>`
  + `<button type="submit">回复</button></form></body></html>`;

console.log('主题页卡片（真实片段）');
const card = parseTopicRedPacket(TOPIC_PAGE);
check('认出卡片', Boolean(card));
check('标题', card?.title === '积分红包', card?.title);
check('状态', card?.status === '进行中', card?.status);
check('剩余份数', card?.remaining === '剩余红包 63 份', card?.remaining);
check('进行中态', card?.state === 'open', card?.state);
check('三格信息', card?.cells.length === 3, `cells=${card?.cells.length}`);
check('格子文案取自页面',
  card?.cells[0]?.label === '红包类型' && card?.cells[0]?.value === '固定金额红包' && card?.cells[0]?.note === '每份 1 积分',
  JSON.stringify(card?.cells[0]));
check('回帖门槛那格', card?.cells[2]?.value === '不少于 30 个字' && card?.cells[2]?.note === '触发行为：回复帖子',
  JSON.stringify(card?.cells[2]));
check('领取规则', Boolean(card?.rule.startsWith('领取规则：随机获得')), card?.rule.slice(0, 24));
check('回帖后刷新地址', card?.statusUrl === '/red_packet_status?topic_id=21348', card?.statusUrl);
check('不是红包帖就不出卡片', parseTopicRedPacket('<html><body>普通帖子</body></html>') === null);

console.log('领完 / 取消两态（官网用 class 区分，文案仍以页面为准）');
const exhausted = parseTopicRedPacket(CARD.replace('is-open', 'is-exhausted')
  .replace('<span>进行中</span>', '<span>已领完</span>'));
check('领完态', exhausted?.state === 'exhausted' && exhausted?.status === '已领完', `${exhausted?.state}/${exhausted?.status}`);
const cancelled = parseTopicRedPacket(CARD.replace('is-open', 'is-cancelled')
  .replace('<span>进行中</span>', '<span>已取消</span>'));
check('取消态', cancelled?.state === 'cancelled' && cancelled?.status === '已取消', `${cancelled?.state}/${cancelled?.status}`);
check('没有状态文案时按 class 兜底',
  parseTopicRedPacket(CARD.replace('is-open', 'is-exhausted').replace('<span>进行中</span>', ''))?.status === '已领完');

console.log('回帖即领取：楼层上的「+N」奖励标记（真实片段，/topic/21348 #1）');
const REWARD = '<span class="red-packet-reply-reward" tabindex="0" aria-label="红包奖励 +1 积分，财源滚滚！">'
  + '<span class="red-packet-reply-gift" aria-hidden="true"><svg viewBox="0 0 24 24"></svg></span>'
  + '<span class="red-packet-reply-points">+1</span>'
  + '<span class="red-packet-reply-tooltip" role="tooltip">红包奖励 +1 积分，财源滚滚！</span></span>';
const reply = (extra: string) => `<ul><li class="post-item post-reply" id="post-174299" data-floor="1">`
  + `<div class="post-info"><a class="post-author" href="/user/119">九天揽月</a></div>`
  + `<div class="post-meta"><span class="post-time">3小时前</span>${extra}</div>`
  + `<div class="post-content"><div class="nb-editor-post-content"><p>抢到红包了</p></div></div></li></ul>`;
const rewarded = parseComments(reply(REWARD), '21348')[0];
check('认出奖励金额', rewarded?.redPacket?.points === 1, String(rewarded?.redPacket?.points));
check('认出奖励说明', rewarded?.redPacket?.tip === '红包奖励 +1 积分，财源滚滚！', rewarded?.redPacket?.tip);
check('没领到的楼层不误标', parseComments(reply(''), '21348')[0]?.redPacket === null);
check('只有 aria-label 时也能认',
  parseComments(reply('<span class="red-packet-reply-reward" aria-label="红包奖励 +5 积分，手气最佳！"></span>'), '21348')[0]
    ?.redPacket?.tip === '红包奖励 +5 积分，手气最佳！');

console.log('楼主认可（真实结构，/topic/21531 #4）：待审状态 + 楼主才有的表单');
const PENDING = '<span class="red-packet-review-state is-pending">待楼主认可</span>'
  + '<div class="red-packet-review-actions">'
  + '<div class="red-packet-review-actions-inner"><span>占位</span></div>'
  + '<form method="post" action="/red_packet_review">'
  + '<input type="hidden" name="_csrf" value="x">'
  + '<input type="hidden" name="topic_id" value="21531">'
  + '<input type="hidden" name="reply_id" value="177318">'
  + '<input type="hidden" name="decision" value="valuable">'
  + '<button type="submit">楼主认可</button></form></div>';
const pending = parseComments(reply(PENDING), '21531')[0];
check('认出待审文案', pending?.redPacketReview?.label === '待楼主认可', pending?.redPacketReview?.label);
check('认出 pending class', pending?.redPacketReview?.state === 'pending', pending?.redPacketReview?.state);
check('楼主能看到认可按钮', pending?.redPacketReview?.actions[0]?.label === '楼主认可'
  && pending?.redPacketReview?.actions[0]?.decision === 'valuable',
  JSON.stringify(pending?.redPacketReview?.actions));
check('路人只看见状态、没有按钮',
  parseComments(reply('<span class="red-packet-review-state is-pending">待楼主认可</span>'), '21531')[0]
    ?.redPacketReview?.actions.length === 0);
check('已领到的楼层没有待审条', rewarded?.redPacketReview == null);
const expired = parseComments(
  reply('<span class="red-packet-review-state is-expired">结算期已结束</span>'),
  '21531',
)[0];
check('结算结束态', expired?.redPacketReview?.state === 'expired'
  && expired?.redPacketReview?.label === '结算期已结束');
check('提交前按 replyid 定位楼层，不回主题第 1 页',
  redPacketReviewPagePath('21531', '177318') === '/topic/21531?replyid=177318',
  redPacketReviewPagePath('21531', '177318'));
const laterFloor = '<ul>'
  + '<li class="post-item post-reply" id="post-100001" data-floor="1">'
  + '<div class="post-info"><a class="post-author" href="/user/1">甲</a></div>'
  + '<div class="post-meta"><span class="post-time">1小时前</span>'
  + '<span class="red-packet-review-state is-pending">待楼主认可</span>'
  + '<div class="red-packet-review-actions"><form method="post" action="/red_packet_review">'
  + '<input type="hidden" name="_csrf" value="page1">'
  + '<input type="hidden" name="topic_id" value="21531">'
  + '<input type="hidden" name="reply_id" value="100001">'
  + '<input type="hidden" name="decision" value="valuable">'
  + '<button type="submit">楼主认可</button></form></div></div>'
  + '<div class="post-content"><div class="nb-editor-post-content"><p>第一页</p></div></div></li>'
  + '<li class="post-item post-reply" id="post-177318" data-floor="24">'
  + '<div class="post-info"><a class="post-author" href="/user/2">乙</a></div>'
  + '<div class="post-meta"><span class="post-time">3小时前</span>'
  + PENDING
  + '</div>'
  + '<div class="post-content"><div class="nb-editor-post-content"><p>后面页</p></div></div></li></ul>';
const laterForm = extractRedPacketReviewForm(laterFloor, '177318', 'valuable');
check('同一页多条待审时认对 reply_id，不拿第一楼的表单',
  laterForm?.fields.reply_id === '177318' && laterForm?.fields._csrf === 'x',
  JSON.stringify(laterForm?.fields));
check('第 1 页 HTML 里没有这一楼时，不能误用别人的认可表单',
  extractRedPacketReviewForm(laterFloor.replace(/<li class="post-item post-reply" id="post-177318"[\s\S]*?<\/li>/, ''), '177318', 'valuable') === null);

console.log('回帖后刷新卡片：官网 /red_packet_status 回 {ok, panel_html}');
check('panel_html 能解析', parseRedPacketPanel(CARD)?.remaining === '剩余红包 63 份');
check('返回的不是卡片时返回 null', parseRedPacketPanel('{"ok":0}') === null);
check('领取后剩余份数变少也能跟上',
  parseRedPacketPanel(CARD.replace('剩余红包 63 份', '剩余红包 62 份'))?.remaining === '剩余红包 62 份');

/* ── 真实片段 2：发帖页的 `.red-packet-compose`（限制值来自 data-red-packet-*） ── */
const EDITOR = '<form id="topic-edit"><section class="red-packet-compose topic-extension-panel" data-topic-extension>'
  + '<details><summary><span>红包帖</span></summary>'
  + '<fieldset data-topic-extension-fields>'
  + '<label class="red-packet-choice"><input type="radio" name="topic_special_type" value="red_packet" data-topic-extension-toggle>'
  + '<span><strong>红包帖</strong><small>用户合格回复后领取积分红包</small></span></label>'
  + '<div class="red-packet-fields" data-red-packet-fields data-red-packet-max-unit="1000"'
  + ' data-red-packet-minimum-unit="50" data-red-packet-minimum-total="500" hidden>'
  + '<div class="red-packet-grid">'
  + '<label><span>红包类型</span><select name="red_packet_distribution" data-red-packet-distribution>'
  + '<option value="fixed">固定金额红包</option><option value="random">随机金额红包</option></select></label>'
  + '<label><span>领取规则</span><select name="red_packet_claim_rule">'
  + '<option value="first_come">先到先得</option><option value="random_chance">随机获得</option></select></label>'
  + '<label><span>触发行为</span><input value="回复帖子" readonly></label>'
  + '<label><span>最低回复字数</span><input name="red_packet_min_reply_chars" type="number" min="5" max="50" value="5" required></label>'
  + '<label><span>红包份数</span><input name="red_packet_count" type="number" min="1" max="1000" value="1" required></label>'
  + '<label data-red-packet-fixed><span>单个红包</span><input name="red_packet_fixed_amount" type="number" min="50" max="1000" value="500"></label>'
  + '<label data-red-packet-random hidden><span>红包总额</span><input name="red_packet_total_amount" type="number" min="500" max="1000" value="500"></label>'
  + '</div>'
  + '<div class="red-packet-balance" data-red-packet-balance data-points="489">'
  + '<span>积分余额：<b data-red-packet-current>489</b></span>'
  + '<span>本次总消耗：<b data-red-packet-cost>500</b></span>'
  + '<span>发布后余额：<b data-red-packet-after>0</b></span></div>'
  + '</div></fieldset></details></section></form>';

console.log('发帖页表单（真实片段）');
const form = parseRedPacketCompose(EDITOR);
check('认出红包表单', Boolean(form));
check('默认类型', form?.distribution === 'fixed', form?.distribution);
check('默认领取规则', form?.claimRule === 'first_come', form?.claimRule);
check('默认字数门槛', form?.minReplyChars === '5', form?.minReplyChars);
check('默认份数', form?.count === '1', form?.count);
check('默认单份金额', form?.fixedAmount === '500', form?.fixedAmount);
check('默认总额', form?.totalAmount === '500', form?.totalAmount);
check('限值取自 data-red-packet-*',
  form?.maxUnit === 1000 && form?.minUnit === 50 && form?.minTotal === 500,
  `${form?.minUnit}-${form?.maxUnit}/${form?.minTotal}`);
check('积分余额取自 data-points', form?.points === 489, String(form?.points));
check('不是发帖页就不出表单', parseRedPacketCompose('<form></form>') === null);

console.log('提交字段（官网 red_packet_confirm 用来确认「确实要发红包」）');
const fixedPost = topicSpecialPostFields({
  title: 't', body: 'b', forum: 'f', specialType: 'red_packet',
  redPacket: { distribution: 'fixed', claimRule: 'first_come', minReplyChars: '30', count: '10', fixedAmount: '80', totalAmount: '999' },
});
check('主题类型', fixedPost.topic_special_type === 'red_packet', String(fixedPost.topic_special_type));
check('固定金额：只发单份金额',
  fixedPost.red_packet_fixed_amount === '80' && fixedPost.red_packet_total_amount === undefined,
  `${fixedPost.red_packet_fixed_amount}/${fixedPost.red_packet_total_amount}`);
check('规则与门槛', fixedPost.red_packet_claim_rule === 'first_come'
  && fixedPost.red_packet_min_reply_chars === '30' && fixedPost.red_packet_count === '10');
check('带上确认字段', fixedPost.red_packet_confirm === '1', String(fixedPost.red_packet_confirm));
const randomPost = topicSpecialPostFields({
  title: 't', body: 'b', forum: 'f', specialType: 'red_packet',
  redPacket: { distribution: 'random', claimRule: 'random_chance', minReplyChars: '5', count: '3', fixedAmount: '80', totalAmount: '1000' },
});
check('随机金额：只发总额',
  randomPost.red_packet_total_amount === '1000' && randomPost.red_packet_fixed_amount === undefined,
  `${randomPost.red_packet_total_amount}/${randomPost.red_packet_fixed_amount}`);
check('随机获得规则', randomPost.red_packet_claim_rule === 'random_chance');
check('普通帖不带红包字段',
  topicSpecialPostFields({ title: 't', body: 'b', forum: 'f', specialType: '' }).red_packet_confirm === undefined);

/* ── 真实片段 3：已发布红包帖的编辑页 /topic_edit?id=21531（设置段只读） ──
 * 与发帖页的三点差别就是「红包帖改不动」的根因：
 *   1. `topic_special_type` 从 radio 变成 hidden（值就是原类型，没有 checked）；
 *   2. 设置段多了 `red-packet-readonly`，且没有 `[data-red-packet-fields]`；
 *   3. 表单里一个 red_packet_* 设置字段都没有（官网不提交、也不让你改）。
 */
const EDIT_FORM = '<form method="post" enctype="multipart/form-data" data-slot="attachment.uploader topic.form_extra">'
  + '<input type="hidden" name="_csrf" value="x">'
  + '<input type="hidden" name="id" value="21531">'
  + '<select name="forum_id"><option value="1" selected>错误地方</option></select>'
  + '<input type="text" name="title" value="APP客户端建议反馈帖">'
  + '<textarea name="body">正文</textarea>'
  + '<div class="grid attachment-field attachment-field-muted">'
  + '<div class="attachment-uploader" data-upload-url="/attachment_upload" data-upload-max-mb="20"'
  + ' data-upload-storage-key="bbs1_attachment_upload_history_v1_10695">'
  + '<label class="attachment-drop"><input class="attachment-input" type="file" multiple data-attachment-input'
  + ' accept=".zip,.jpg,.png,.jepg,.gif,.webp,.svg,.jpeg"><strong><span>上传附件</span></strong></label>'
  + '<div class="attachment-upload-toolbar" data-attachment-upload-toolbar hidden>'
  + '<span data-attachment-upload-summary></span>'
  + '<button type="button" class="attachment-upload-insert" data-attachment-insert-all>批量插入</button></div>'
  + '<div class="attachment-upload-list" data-attachment-upload-list aria-live="polite" hidden></div>'
  + '</div></div>'
  + '<label class="grid"><span>回帖排序</span><select name="reply_order">'
  + '<option value="0" selected>发帖时间顺序</option><option value="1">发帖时间倒序</option></select></label>'
  + '<input type="hidden" name="red_packet_original_type" value="red_packet">'
  + '<input type="hidden" name="topic_special_type" value="red_packet">'
  + '<section class="red-packet-compose red-packet-readonly"><strong>红包帖设置</strong>'
  + '<span>随机金额红包 · 楼主认可获得 · 50 份 · 楼主认可后必得 · 认可条件：有价值的讨论 · 结算期 3 天</span>'
  + '<small>发布后只能编辑主题内容，不能修改红包设置、主动结束或删除红包帖；结算期结束后由平台接管审核，管理员删除时不退还托管积分。</small>'
  + '</section>'
  + '<section class="sb-limit-edit-time-quote"><strong>编辑主帖</strong>'
  + '<span>本次免费；免费期 30 天，之后 5 积分起，每满 1 天 增加 2 积分，不足一个周期不加价，最高 100 积分。</span>'
  + '<input type="hidden" name="sb_limit_edit_time_operation_key" value="b0fec901c161eb05c2c07ecae1b2c504">'
  + '<input type="hidden" name="sb_limit_edit_time_quoted_cost" value="0">'
  + '<span hidden data-sb-limit-edit-time-edit-confirm="本次编辑免费。计费公式（超出免费期后）：起步价 5 + 完整递增周期数 × 2，最高 100 积分；每个递增周期为 1 天，不足一个周期不加价。"'
  + ' data-rules-url="/sb_limit_edit_time_rules"></span></section>'
  + '<section class="sb-limit-edit-time-inline-delete"><span>删除主帖会同时影响其全部回帖。</span>'
  + '<input type="hidden" name="content_type" value="topic"><input type="hidden" name="content_id" value="21531">'
  + '<input type="hidden" name="quoted_cost" value="0"><input type="hidden" name="operation_key" value="3262689ee97aca8c9d0c2141a34c10e3">'
  + '<button class="icon-action icon-delete sb-limit-edit-time-inline-delete-button" type="submit"'
  + ' formaction="/sb_limit_edit_time_delete" formmethod="post"'
  + ' data-confirm="该主帖仍在 1 天免费删除期限内，剩余约 不足 1 天，本次删除免费。计费公式（超出免费期后）：起步价 10 + 完整递增周期数 × 5，最高 300 积分；每个递增周期为 1 天，不足一个周期不加价。删除后不可自行恢复，是否确认删除？"'
  + ' data-sb-limit-edit-time-rules-url="/sb_limit_edit_time_rules" title="删除主帖"><span>删除主帖</span></button></section>'
  + '<button type="submit">保存</button></form>';

console.log('已发布红包帖的编辑页（真实片段，/topic_edit?id=21531）');
const editDto = parseTopicEditor(EDIT_FORM);
check('hidden 的类型也要认出来', editDto.specialType === 'red_packet', editDto.specialType || '(空)');
check('只读段没有可编辑的红包字段', parseRedPacketCompose(EDIT_FORM) === null);
check('只读段原文照抄',
  editDto.specialLock?.title === '红包帖设置' && /发布后只能编辑主题内容/.test(editDto.specialLock?.note ?? ''),
  JSON.stringify(editDto.specialLock));
check('回帖排序（字段名/默认值/选项都取自页面）',
  editDto.replyOrder?.label === '回帖排序' && editDto.replyOrder?.value === '0'
  && editDto.replyOrder?.options.length === 2 && editDto.replyOrder?.options[1]?.label === '发帖时间倒序',
  JSON.stringify(editDto.replyOrder));
check('编辑计费：说明 + 保存确认原文 + 规则地址',
  editDto.editCost?.title === '编辑主帖' && editDto.editCost?.cost === 0
  && /^本次免费/.test(editDto.editCost?.note ?? '')
  && /起步价 5/.test(editDto.editCost?.confirm ?? '')
  && editDto.editCost?.rulesUrl === '/sb_limit_edit_time_rules',
  JSON.stringify(editDto.editCost));
check('删除主帖：影响说明 + data-confirm 原文',
  /删除主帖会同时影响其全部回帖/.test(editDto.deleteLock?.note ?? '')
  && /是否确认删除？$/.test(editDto.deleteLock?.confirm ?? ''),
  JSON.stringify(editDto.deleteLock));
check('附件上传：地址 / 上限 / 多选 / accept / 按钮原文',
  editDto.attachment?.url === '/attachment_upload' && editDto.attachment?.maxMb === 20
  && editDto.attachment?.multiple === true && editDto.attachment?.label === '上传附件'
  && /\.zip/.test(editDto.attachment?.accept ?? ''),
  JSON.stringify(editDto.attachment));
const lockPost = topicSpecialPostFields({ title: 't', body: 'b', forum: 'f', specialType: editDto.specialType });
check('只读编辑仍带上原类型', lockPost.topic_special_type === 'red_packet', String(lockPost.topic_special_type));
check('只读编辑不提交红包设置字段',
  Object.keys(lockPost).every((key) => !/^red_packet_(distribution|claim_rule|min_reply_chars|count|fixed_amount|total_amount|confirm)$/.test(key)),
  Object.keys(lockPost).join(','));
check('回吐的编辑页会被认成「没存上」', isTopicEditorPage(EDIT_FORM));
check('主题页不会被误判',
  !isTopicEditorPage('<div class="post-content"><form class="ajax-reply-form"><textarea name="body"></textarea></form></div>'));
const freshDto = parseTopicEditor('<form method="post" data-slot="attachment.uploader topic.form_extra">'
  + '<input type="radio" name="topic_special_type" value="lottery">'
  + '<input type="radio" name="topic_special_type" value="red_packet">'
  + '<input type="text" name="title" value="">'
  + '<textarea name="body"></textarea></form>');
check('发帖页未勾选类型＝普通帖', freshDto.specialType === '', freshDto.specialType || '(空)');
check('发帖页没有回帖排序 / 计费 / 删除段',
  freshDto.replyOrder === null && freshDto.editCost === null && freshDto.deleteLock === null);

/* ── 真实片段 4：红包卡片里的「追加红包」（/topic/21531，只有楼主可见） ── */
const TOPUP = '<section class="red-packet-card is-open"><header><div><strong>积分红包</strong>'
  + '<span>楼主审核中</span></div><b>剩余红包 47 份</b></header>'
  + '<div class="red-packet-card-grid"><div><span>红包类型</span><strong>随机金额红包</strong>'
  + '<small>随机分配剩余积分</small></div></div>'
  + '<p>领取规则：楼主认可获得。结算期 3 天，截止 2026-09-15 02:24。</p>'
  + '<section class="red-packet-topup"><strong>追加红包</strong>'
  + '<small>结算期截止 2026-09-15 02:24，追加后不延长结算期。</small>'
  + '<form class="red-packet-topup-form" method="post" action="/red_packet_topup"'
  + ' data-red-packet-topup-distribution="random" data-red-packet-topup-minimum-amount="10"'
  + ' data-red-packet-topup-maximum-amount="1000" data-red-packet-topup-points-capacity="99999500">'
  + '<input type="hidden" name="_csrf" value="x">'
  + '<input type="hidden" name="topic_id" value="21531">'
  + '<input type="hidden" name="expected_packet_count" value="50">'
  + '<input type="hidden" name="expected_total_amount" value="500">'
  + '<input type="hidden" name="expected_remaining_count" value="47">'
  + '<input type="hidden" name="expected_remaining_amount" value="470">'
  + '<div class="red-packet-topup-fields">'
  + '<label><span>追加份数</span><input type="number" name="red_packet_topup_count" min="1" max="950" value="1" required></label>'
  + '<label><span>追加总积分</span><input type="number" name="red_packet_topup_total_amount" min="10" max="950000" value="10" required></label>'
  + '<span class="red-packet-topup-total">每份至少 10 积分，最多 1000 积分</span>'
  + '</div><button type="submit">追加红包</button></form></section></section>';

console.log('追加红包（真实片段，/topic/21531 的楼主视图）');
const topup = parseTopicRedPacketTopup(TOPUP);
check('认出追加表单', Boolean(topup));
check('标题与说明取自页面',
  topup?.title === '追加红包' && /不延长结算期/.test(topup?.note ?? ''), topup?.note);
check('限值取自 data-red-packet-topup-*',
  topup?.minUnit === 10 && topup?.maxUnit === 1000 && topup?.capacity === 99999500
  && topup?.distribution === 'random',
  `${topup?.minUnit}-${topup?.maxUnit}/${topup?.capacity}`);
check('字段名与份数上限取自页面',
  topup?.countLabel === '追加份数' && topup?.count === '1' && topup?.countMin === 1 && topup?.countMax === 950,
  `${topup?.countLabel} ${topup?.countMin}-${topup?.countMax}`);
check('总积分上限取自页面',
  topup?.amountLabel === '追加总积分' && topup?.amount === '10' && topup?.amountMax === 950000,
  `${topup?.amountLabel} ${topup?.amountMin}-${topup?.amountMax}`);
check('每份下限文案取自页面', topup?.hint === '每份至少 10 积分，最多 1000 积分', topup?.hint);
check('expected_* 乐观锁原样带上',
  topup?.fields.expected_packet_count === '50' && topup?.fields.expected_total_amount === '500'
  && topup?.fields.expected_remaining_count === '47' && topup?.fields.expected_remaining_amount === '470'
  && topup?.fields.topic_id === '21531',
  JSON.stringify(topup?.fields));
check('提交地址', topup?.action === '/red_packet_topup', topup?.action);
check('没有追加表单时返回 null', parseTopicRedPacketTopup(CARD) === null);

console.log('');
if (fails) {
  console.error(`✗ 失败 ${fails} 项`);
  process.exit(1);
}
console.log('✓ 通过：红包帖卡片 / 回帖奖励 / 发帖表单与提交字段都对齐官网');
