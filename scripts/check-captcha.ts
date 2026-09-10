/**
 * 人机验证（Cap）与申精理由上限的离线回归。
 *
 * 官方有两套「验证」痕迹，别搞混：
 *   - **Cap**（cap.linux.sb）：真在用的一套。游客的 /login、/register，以及
 *     **抽奖帖的回帖框**（作者保留「回帖需要验证码」，默认开启）都会挂组件，
 *     提交时必须带 `cap_token`；
 *   - `data-native-captcha`（plugins.js 里的 `nativeCaptchaSolve`，SHA-256 工作量证明）：
 *     目前页面里没有渲染，属于备用机制。
 *
 *   npm run check:captcha
 */
import { findPostedReviewComment, isAlreadyVotedMessage, parseCapConfig, pageNeedsReplyCaptcha } from '../src/services/live';
import { ESSENCE_REASON_MAX, ESSENCE_REASON_MIN } from '../src/data/essence';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

/* ── 真实标记：抽奖帖回帖框上方（/topic/21230） ─────────────────────── */
const LOTTERY_REPLY = '<div class="cap-verification-widget" data-cap-verification'
  + ' data-cap-widget-script="https://cap.linux.sb/assets/widget.js"'
  + ' data-cap-wasm-url="https://cap.linux.sb/assets/cap_wasm_bg.wasm">'
  + '<cap-widget required data-cap-api-endpoint="https://cap.linux.sb/60c41af707/"'
  + ' data-cap-hidden-field-name="cap_token"></cap-widget>'
  + '<p class="cap-verification-status" data-cap-verification-status>正在加载人机验证…</p>'
  + '<noscript><p class="cap-verification-noscript">请启用 JavaScript 后完成人机验证。</p></noscript></div>';

/* ── 真实标记：游客登录页（/login）—— 与回帖框是同一套组件 ─────────── */
const LOGIN_PAGE = '<form method="post"><input type="hidden" name="_csrf" value="x">'
  + '<label class="grid"><span>用户名</span><input name="username" type="text" required></label>'
  + '<div class="cap-verification-widget" data-cap-verification'
  + ' data-cap-widget-script="https://cap.linux.sb/assets/widget.js"'
  + ' data-cap-wasm-url="https://cap.linux.sb/assets/cap_wasm_bg.wasm">'
  + '<cap-widget required data-cap-api-endpoint="https://cap.linux.sb/60c41af707/"'
  + ' data-cap-hidden-field-name="cap_token"></cap-widget>'
  + '<p class="cap-verification-status" data-cap-verification-status>正在加载人机验证…</p></div>'
  + '<button>登录</button></form>';

/* ── 真实标记：普通帖回帖表单（/topic/21205，没有验证组件） ───────── */
const PLAIN_REPLY = '<form class="ajax-reply-form" method="post" action="/reply_edit">'
  + '<textarea name="body" rows="6"></textarea><button type="submit">回复</button></form>';

console.log('人机验证（Cap）与申精理由上限回归');

const lottery = parseCapConfig(LOTTERY_REPLY);
check('能识别抽奖帖回帖框上的验证组件', pageNeedsReplyCaptcha(LOTTERY_REPLY) === true);
check('解析出接口端点', lottery?.endpoint === 'https://cap.linux.sb/60c41af707/', lottery?.endpoint);
check('解析出组件脚本', lottery?.widgetScript === 'https://cap.linux.sb/assets/widget.js', lottery?.widgetScript);
check('解析出 wasm 地址', lottery?.wasmUrl === 'https://cap.linux.sb/assets/cap_wasm_bg.wasm', lottery?.wasmUrl);

const login = parseCapConfig(LOGIN_PAGE);
check('登录页的验证组件同样能解析', pageNeedsReplyCaptcha(LOGIN_PAGE) === true && login?.endpoint === 'https://cap.linux.sb/60c41af707/');

check('普通帖不误判为需要验证', pageNeedsReplyCaptcha(PLAIN_REPLY) === false && parseCapConfig(PLAIN_REPLY) === null);
check('空页面不误判', parseCapConfig('') === null);

/* 老版本文案里只有 native_captcha（PoW）时不该当成 Cap */
check('只有 native_captcha 时不算 Cap', parseCapConfig('<input name="native_captcha_pow"><span data-native-captcha-status></span>') === null);

/* ── 申精理由：上限 300（页面属性）+ 下限与「只能一次」都是服务端规则 ── */
const OFFICIAL_REASON_FIELD = '<textarea name="reason" rows="3" maxlength="300" '
  + 'placeholder="请填写竞猜理由，提交后会作为一条评议回帖发布" required></textarea>';
const officialMax = Number(OFFICIAL_REASON_FIELD.match(/maxlength="(\d+)"/)?.[1] ?? 0);
check('官方竞猜理由上限与 App 常量一致', officialMax === ESSENCE_REASON_MAX, `官方 ${officialMax} / App ${ESSENCE_REASON_MAX}`);
/* 下限（至少 5 字）与「竞猜过的不能再竞猜」在页面属性/脚本里都查不到：
   三个脚本（script.js / index.js / plugins.js）里连「竞猜」「essence」都没有，只能由服务端拦。
   所以这两个规则靠本地先拦 + 服务端兜底，别指望从页面上读出来。 */
check('官方页面没有 minlength（下限是服务端规则）', !/\bminlength=/i.test(OFFICIAL_REASON_FIELD));
check('App 的理由下限是 5 字', ESSENCE_REASON_MIN === 5, String(ESSENCE_REASON_MIN));
check('下限小于上限', ESSENCE_REASON_MIN < ESSENCE_REASON_MAX);
check('理由字段是必填', /\brequired\b/.test(OFFICIAL_REASON_FIELD));
check('官方说明「会作为一条评议回帖发布」', OFFICIAL_REASON_FIELD.includes('作为一条评议回帖发布'));

/* ── 作者申请加精：官方没有理由字段，只有一键提交 ───────────────────── */
const APPLY_FORM = '<form class="topic-essence-review-apply-form" method="post" action="/topic_essence_review_apply"'
  + ' data-confirm="注意：精华评判以审核标准为依据…是否确认提交精华申请？">'
  + '<input type="hidden" name="_csrf" value="x"><input type="hidden" name="topic_id" value="20991">'
  + '<button type="submit" disabled>暂不能申请</button></form>';
check('申请表没有理由字段（一键提交 + 官方确认文案）', !/name="reason"/.test(APPLY_FORM) && /data-confirm=/.test(APPLY_FORM));

/* ── 提交竞猜的服务端限制：实测 JSON 文案 ─────────────────────────
   官方页面不体现「我投过」，也没有 minlength，两条规则都只在提交时由服务端拒。
   下面这两句是从真接口拿到的原话（POST /topic_essence_review_vote → JSON）。 */
const SHORT_REASON_JSON = '{"ok":0,"message":"竞猜理由至少需要 5 个字"}';
const ALREADY_VOTED_JSON = '{"ok":0,"message":"你已经参与过竞猜，请勿重复竞猜"}';
const shortMsg = JSON.parse(SHORT_REASON_JSON).message as string;
const votedMsg = JSON.parse(ALREADY_VOTED_JSON).message as string;
check('服务端的下限文案与 App 常量一致', Number(shortMsg.match(/(\d+)\s*个字/)?.[1]) === ESSENCE_REASON_MIN, shortMsg);
check('能识别「已经参与过竞猜」', isAlreadyVotedMessage(votedMsg) === true, votedMsg);
check('其它报错不会被误判成已投票', isAlreadyVotedMessage('竞猜理由至少需要 5 个字') === false
  && isAlreadyVotedMessage('当前主题没有进行中的竞猜') === false
  && isAlreadyVotedMessage('请选择会加精或不会加精') === false);

/* ── 竞猜理由发布成评议回帖后，要能定位到它（真实标记） ────────────── */
const REPLY_BODY = '这个方案我实测过，写法清晰而且省额度，支持加精。';
const reviewReply = (id: string, body: string, label: string | null = '精华竞猜 · 预测会加精') => (
  '<li class="post-item post-entry" id="post-' + id + '" data-slot="reply.after_render" data-floor="2">'
  + '<div class="post-avatar"><a class="avatar-profile-link" href="/user/10695" aria-label="查看 miapi 的个人主页">'
  + '<img class="avatar-img" src="/app/avatars/fun-emoji_36.svg" alt="miapi"></a></div>'
  + '<div class="post-body"><div class="post-head has-floor"><div class="post-info">'
  + '<a class="post-title post-author" href="/user/10695">miapi</a>'
  + '<span class="post-user-group user-uid-badge" title="用户 UID">UID 10695</span></div></div>'
  + '<div class="post-meta"><span class="post-time">刚刚</span>'
  + (label ? '<span class="topic-essence-review-reply-label is-support">' + label + '</span>' : '')
  + '<div class="post-ops"><a class="post-floor" href="/topic/21205?replyid=' + id + '">#2</a></div></div>'
  + '<div class="post-content"><div class="long-content-fold-content"><div class="nb-editor-post-content"><p>' + body + '</p></div></div></div>'
  + '</div></li>'
);
const PAGE = (rows: string) => '<ul class="post-list">' + rows + '</ul>';

const found = findPostedReviewComment(PAGE(reviewReply('165240', REPLY_BODY)), '21205', REPLY_BODY);
check('提交竞猜后能在返回页里认出那条评议回帖', found?.id === '165240', found?.id);
check('认出后带上官方的竞猜标签', found?.essenceLabel === '精华竞猜 · 预测会加精', found?.essenceLabel);
check('正文被上游改写时靠标签兜底', findPostedReviewComment(
  PAGE(reviewReply('165241', '完全不同的正文（上游可能做了处理）')),
  '21205',
  REPLY_BODY,
)?.id === '165241');
check('页面里没有评议回帖时不瞎跳（返回 null，前台退回重新拉列表）',
  findPostedReviewComment(PAGE(reviewReply('165242', '一条普通回帖', null)), '21205', '我写的理由') === null);
check('空理由不误认', findPostedReviewComment(PAGE(reviewReply('165243', REPLY_BODY)), '21205', '') === null);

console.log(fails ? `\n✗ 未通过：${fails} 项` : '\n✓ 通过：验证组件与申精约束解析正常');
process.exit(fails ? 1 : 0);
