/**
 * 红包帖（官网 `red_packet` 插件）的离线回归。
 *
 * 官网这一套是**服务端渲染**的，游客看不到（回帖区写着「登录后可见」），
 * 下面这些片段是从登录态的主题页 /topic/21348 与发帖页原样抓下来的。
 *
 *   npm run check:redpacket
 *
 * 三条链路，缺一条用户在 App 里就会觉得「这功能没对齐」：
 *   1. 主题页卡片：`.red-packet-card` → 状态、剩余份数、三格信息、领取规则；
 *   2. 领取：官网没有「抢红包」按钮 —— **回帖即领取**。回帖框里挂着
 *      `data-red-packet-status-url`，回完帖拿它换新卡片；领到的楼层上官方标「+N」；
 *   3. 发帖页表单：`.red-packet-compose` → 类型/规则/字数/份数/金额，提交时要带
 *      `red_packet_confirm=1`（官网用它确认「确实要发红包」）。
 */
import {
  parseComments,
  parseRedPacketCompose,
  parseRedPacketPanel,
  parseTopicRedPacket,
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

console.log('');
if (fails) {
  console.error(`✗ 失败 ${fails} 项`);
  process.exit(1);
}
console.log('✓ 通过：红包帖卡片 / 回帖奖励 / 发帖表单与提交字段都对齐官网');
