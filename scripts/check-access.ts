/**
 * 国内访问通道：DoH（stellafortuna query-dns）/ 直连。
 * 旧镜像通道已下线；遗留 lsb.miapi.cc 地址一律折回官网。
 * DoH / 直连会拆 TLS ClientHello（RECORD）。
 *
 *   npx tsx scripts/check-access.ts
 */
import {
  ACCESS_CHANNEL_LABEL,
  ACCESS_CHANNELS,
  LINUX_CAP_MIRROR_ORIGIN,
  LINUX_CAP_ORIGIN,
  LINUX_DOH_QUERY,
  LINUX_MIRROR_ORIGIN,
  LINUX_ORIGIN,
  adoptAccessUrl,
  configureAccessChannel,
  liveBase,
  liveCapBase,
  normalizeAccessChannel,
  officialLinuxUrl,
  rewriteLinuxUrl,
  viaAccess,
} from '../src/utils/linux-access';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

console.log('官网访问通道 · DoH / 直连');

const topic = `${LINUX_ORIGIN}/topic/21287`;
const upload = `${LINUX_ORIGIN}/app/upload/69/a.png`;
const cap = `${LINUX_CAP_ORIGIN}/assets/widget.js`;
const oauth = `${LINUX_ORIGIN}/oauth_login?provider=github`;
const oauthCode = `${LINUX_ORIGIN}/oauth_login?provider=google&code=x`;
const mirrorTopic = `${LINUX_MIRROR_ORIGIN}/topic/21287`;
const mirrorCap = `${LINUX_CAP_MIRROR_ORIGIN}/assets/widget.js`;
const mirrorOauthCode = `${LINUX_MIRROR_ORIGIN}/oauth_login?provider=google&code=x`;
const oldMirrorCap = `${LINUX_MIRROR_ORIGIN}/__cap__/assets/widget.js`;

configureAccessChannel('doh');

check('旧镜像设置折成 DoH', normalizeAccessChannel('mirror') === 'doh');
check('空值折成 DoH', normalizeAccessChannel(undefined) === 'doh' && normalizeAccessChannel('') === 'doh');
check('直连仍是直连', normalizeAccessChannel('direct') === 'direct');
check('默认基址是官网', liveBase() === LINUX_ORIGIN && liveCapBase() === LINUX_CAP_ORIGIN);
check('DoH 基址是官网', liveBase('doh') === LINUX_ORIGIN && liveCapBase('doh') === LINUX_CAP_ORIGIN);
check('直连基址是官网', liveBase('direct') === LINUX_ORIGIN && liveCapBase('direct') === LINUX_CAP_ORIGIN);
check('DoH 不改写帖子', rewriteLinuxUrl(topic, 'doh') === topic);
check('DoH 不改写 cap', rewriteLinuxUrl(cap, 'doh') === cap);
check('DoH OAuth 仍是官网', rewriteLinuxUrl(oauth, 'doh') === oauth);
check('直连保持官网', rewriteLinuxUrl(topic, 'direct') === topic && rewriteLinuxUrl(cap, 'direct') === cap);
check('直连 OAuth 仍是官网', rewriteLinuxUrl(oauth, 'direct') === oauth);
check('遗留镜像帖子折回官网', officialLinuxUrl(mirrorTopic) === topic && rewriteLinuxUrl(mirrorTopic, 'doh') === topic);
check('遗留 cap 镜像折回官网', officialLinuxUrl(mirrorCap) === cap && rewriteLinuxUrl(mirrorCap) === cap);
check('遗留 __cap__ 折回 cap', officialLinuxUrl(oldMirrorCap) === cap && rewriteLinuxUrl(oldMirrorCap) === cap);
check('遗留上传图折回官网', rewriteLinuxUrl(`${LINUX_MIRROR_ORIGIN}/app/upload/69/a.png`) === upload);
check('WebView 把镜像回调折回官网', adoptAccessUrl(mirrorOauthCode, 'doh') === oauthCode);
check('WebView 已在官网则不跳', adoptAccessUrl(oauthCode, 'doh') === null);
check('Google 授权页不改写', adoptAccessUrl('https://accounts.google.com/o/oauth2/v2/auth') === null);
check('外链不改', viaAccess('https://github.com/tianyugithub/linux-sb-mobile', 'doh') === 'https://github.com/tianyugithub/linux-sb-mobile');
check('默认通道不改写到镜像', rewriteLinuxUrl(topic) === topic);
check('DoH 问 stellafortuna', LINUX_DOH_QUERY === 'https://stellafortuna.ddd.oaifree.com/query-dns');
check('通道名单只有 DoH / 直连', ACCESS_CHANNELS.join(',') === 'doh,direct');
check('通道名称', ACCESS_CHANNEL_LABEL.doh === 'DoH' && ACCESS_CHANNEL_LABEL.direct === '直连');

console.log(fails ? `\n✗ 未通过：${fails} 项` : '\n✓ 通过：访问通道改写正常');
process.exit(fails ? 1 : 0);
