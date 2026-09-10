/** Official linux.sb `posting_notice` copy from `/app/assets/plugins.js`. */
export const POSTING_NOTICE_TITLE = '本站严禁发布以下内容';
export const POSTING_NOTICE_INTRO = '请完整阅读社区发帖规范，确认后方可继续发布内容。';
export const POSTING_NOTICE_HINT = '点击确认即表示您已阅读并同意遵守以上规范。';
export const POSTING_NOTICE_CONFIRM = '我已阅读并确认';
/** 官方弹窗没有这一段，是本站自加的「不再提示」选项。 */
export const POSTING_NOTICE_SKIP_TITLE = '不再提示';
export const POSTING_NOTICE_SKIP_HINT = '确认后不再自动弹出，可在「设置 → 发帖须知提示」里重新打开';
export const POSTING_NOTICE_INLINE = '注意：发帖默认没有积分，优质内容才会得到打赏积分。删帖扣10分，请不要发布无意义帖子！';
export const POSTING_NOTICE_CONSEQUENCE_LABEL = '违规后果：';
export const POSTING_NOTICE_CONSEQUENCE = '严禁发布的内容经核实后，第一时间删除相关内容，并且禁言相关用户。视情节严重程度，最高可永久封禁账号，并由发布者自行承担法律责任。';

export type PostingNoticeRule = { title: string; text: string };

export const POSTING_NOTICE_RULES: PostingNoticeRule[] = [
  { title: '政治相关', text: '不讨论任何涉及政治相关的内容，包括但不限于国家领导人、国家政策、制度等。' },
  { title: '违法暴力', text: '禁止发布血腥、暴力、赌博、毒品、涉黑等内容。' },
  { title: '色情内容', text: '禁止任何色情及擦边内容。' },
  { title: '人身攻击', text: '禁止发布诋毁、侮辱、辱骂他人的言论，包括挂人行为。' },
  { title: '欺诈黑产', text: '禁止发布谣言、欺诈及黑产类内容。' },
  { title: '恶意程序', text: '禁止发布包含病毒程序、恶意软件及网站的相关内容。' },
  { title: '垃圾信息', text: '禁止恶意刷帖、自动发帖、无意义内容。' },
  { title: '盗版内容', text: '禁止发布侵犯知识产权的盗版资源。' },
  { title: '违规推广', text: '任何带 aff 的内容只能发布在【我要推广区】，禁止刷帖推广。' },
  { title: '骚扰行为', text: '禁止通过私聊、回帖发送骚扰和广告内容。' },
  { title: '泄露隐私', text: '禁止发布泄露他人隐私的内容；禁止发布收集用户个人信息的帖子，例如要求用户回复邮箱领取福利。' },
  { title: '纯 AI 生成内容', text: '禁止发布纯 AI 生成的内容；引用 AI 生成内容时，需要原创写入问题描述和场景，并注明为 AI 生成。' },
];
