/**
 * 帖子外链：官网写成 `/jump?to=…&amp;sig=…`，原样打开会 400「跳转地址无效」。
 */
import { parseArticle } from '../src/utils/article';
import { classifyAppHref, unwrapLinuxJump } from '../src/utils/links';
import { hasLinuxSessionCookie, mergeCookieHeaders } from '../src/utils/site-cookies';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

console.log('帖子外链 · /jump 解码与分流');

const rawJump = '/jump?to=https%3A%2F%2Fsharellm.net%2F&amp;sig=c8bd0250dcab6bdf7ff52cb0a8c9c236e4f642ce9f75db982807a19bfc6e7104';
const absJump = `https://linux.sb${rawJump}`;
const html = `<p>ShareLLM：<a href="${rawJump}" target="_blank" rel="nofollow noopener noreferrer">https://sharellm.net/</a></p>`;

const blocks = parseArticle(html);
const link = blocks.flatMap((block) => (block.type === 'p' ? block.spans : [])).find((span) => span.type === 'link');
check('正文能解析出链接', Boolean(link && link.type === 'link'), JSON.stringify(link));
check(
  'href 里的 &amp; 被解成 &',
  Boolean(link && link.type === 'link' && link.href.includes('&sig=') && !link.href.includes('&amp;')),
  link && link.type === 'link' ? link.href : '',
);

check(
  'unwrap 抽出真实地址',
  unwrapLinuxJump(`https://linux.sb${rawJump.replace(/&amp;/g, '&')}`) === 'https://sharellm.net/',
);
check(
  '带 &amp; 的绝对地址也能 unwrap',
  unwrapLinuxJump(absJump) === 'https://sharellm.net/',
);

const fromRelative = classifyAppHref(rawJump);
check(
  '相对 /jump 打开目标站',
  fromRelative.type === 'browser' && fromRelative.url === 'https://sharellm.net/',
  JSON.stringify(fromRelative),
);
const fromAbsolute = classifyAppHref(absJump);
check(
  '绝对 /jump 打开目标站',
  fromAbsolute.type === 'browser' && fromAbsolute.url === 'https://sharellm.net/',
  JSON.stringify(fromAbsolute),
);

const toTopic = classifyAppHref('/jump?to=https%3A%2F%2Flinux.sb%2Ftopic%2F10532&amp;sig=abc');
check(
  '跳到站内帖子仍进主题页',
  toTopic.type === 'topic' && toTopic.id === '10532',
  JSON.stringify(toTopic),
);

const plain = classifyAppHref('https://github.com/tianyugithub/linux-sb-mobile');
check(
  '普通 https 仍走内置浏览器',
  plain.type === 'browser' && plain.url === 'https://github.com/tianyugithub/linux-sb-mobile',
);

const topic = classifyAppHref('https://linux.sb/topic/15751');
check('站内帖子不受影响', topic.type === 'topic' && topic.id === '15751');

const mirrorTopic = classifyAppHref('https://lsb.miapi.cc/topic/15751');
check('镜像域名的帖子仍进主题页', mirrorTopic.type === 'topic' && mirrorTopic.id === '15751');

check('javascript 仍忽略', classifyAppHref('javascript:alert(1)').type === 'ignore');

const merged = mergeCookieHeaders('bbs_csrf=from-site', 'bbs_auth=secret; bbs_csrf=from-mirror');
check('官网和镜像 cookie 合成一份', merged.includes('bbs_auth=secret') && merged.includes('bbs_csrf=from-mirror'));
check('能认出登录 cookie', hasLinuxSessionCookie(merged) && !hasLinuxSessionCookie('bbs_csrf=only'));

console.log(fails ? `\n✗ 未通过：${fails} 项` : '\n✓ 通过：外链 /jump 分流正常');
process.exit(fails ? 1 : 0);
