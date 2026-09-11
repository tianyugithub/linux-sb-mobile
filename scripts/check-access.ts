/**
 * 国内访问通道：镜像 / DoH（stellafortuna query-dns）/ 直连。
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
  LINUX_MIRROR_PIN_HOST,
  LINUX_ORIGIN,
  adoptAccessUrl,
  configureAccessChannel,
  liveBase,
  liveCapBase,
  officialLinuxUrl,
  rewriteLinuxUrl,
  viaAccess,
} from '../src/utils/linux-access';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

console.log('官网访问通道 · 镜像 / DoH / 直连');

const topic = `${LINUX_ORIGIN}/topic/21287`;
const upload = `${LINUX_ORIGIN}/app/upload/69/a.png`;
const cap = `${LINUX_CAP_ORIGIN}/assets/widget.js`;
const oauth = `${LINUX_ORIGIN}/oauth_login?provider=github`;
const oauthCode = `${LINUX_ORIGIN}/oauth_login?provider=google&code=x`;
const mirrorTopic = `${LINUX_MIRROR_ORIGIN}/topic/21287`;
const mirrorCap = `${LINUX_CAP_MIRROR_ORIGIN}/assets/widget.js`;
const mirrorOauth = `${LINUX_MIRROR_ORIGIN}/oauth_login?provider=github`;
const mirrorOauthCode = `${LINUX_MIRROR_ORIGIN}/oauth_login?provider=google&code=x`;
const oldMirrorCap = `${LINUX_MIRROR_ORIGIN}/__cap__/assets/widget.js`;

configureAccessChannel('mirror');

check('镜像钉在美国机', LINUX_MIRROR_PIN_HOST === '154.12.50.175');
check('镜像基址', liveBase('mirror') === LINUX_MIRROR_ORIGIN);
check('镜像 cap 基址', liveCapBase('mirror') === LINUX_CAP_MIRROR_ORIGIN);
check('镜像改写帖子', rewriteLinuxUrl(topic, 'mirror') === mirrorTopic, rewriteLinuxUrl(topic, 'mirror'));
check('镜像改写上传图', rewriteLinuxUrl(upload, 'mirror') === `${LINUX_MIRROR_ORIGIN}/app/upload/69/a.png`);
check('镜像改写 cap', rewriteLinuxUrl(cap, 'mirror') === mirrorCap, rewriteLinuxUrl(cap, 'mirror'));
check('镜像规范化旧 __cap__', rewriteLinuxUrl(oldMirrorCap, 'mirror') === mirrorCap, rewriteLinuxUrl(oldMirrorCap, 'mirror'));
check('镜像帖子保持镜像域名', rewriteLinuxUrl(mirrorTopic, 'mirror') === mirrorTopic);
check('镜像 cap 保持镜像域名', rewriteLinuxUrl(mirrorCap, 'mirror') === mirrorCap);
check('镜像 OAuth 走镜像', rewriteLinuxUrl(oauth, 'mirror') === mirrorOauth);
check('直连 OAuth 仍是官网', rewriteLinuxUrl(oauth, 'direct') === oauth);
check('WebView 把官网回调改走镜像', adoptAccessUrl(oauthCode, 'mirror') === mirrorOauthCode);
check('WebView 已在镜像则不跳', adoptAccessUrl(mirrorOauthCode, 'mirror') === null);
check('Google 授权页不改写', adoptAccessUrl('https://accounts.google.com/o/oauth2/v2/auth') === null);
check('直连保持官网', rewriteLinuxUrl(topic, 'direct') === topic && rewriteLinuxUrl(cap, 'direct') === cap);
check('直连把镜像还原成官网', officialLinuxUrl(mirrorTopic) === topic && rewriteLinuxUrl(mirrorTopic, 'direct') === topic);
check('直连把 cap 镜像还原', officialLinuxUrl(mirrorCap) === cap);
check('直连把旧 __cap__ 还原', officialLinuxUrl(oldMirrorCap) === cap);
check('直连 WebView 把镜像回调折回官网', adoptAccessUrl(mirrorOauthCode, 'direct') === oauthCode);
check('外链不改', viaAccess('https://github.com/tianyugithub/linux-sb-mobile', 'mirror') === 'https://github.com/tianyugithub/linux-sb-mobile');
check('默认通道改写到镜像', rewriteLinuxUrl(topic) === mirrorTopic);
check('直连基址是官网', liveBase('direct') === LINUX_ORIGIN && liveCapBase('direct') === LINUX_CAP_ORIGIN);
check('DoH 问 stellafortuna', LINUX_DOH_QUERY === 'https://stellafortuna.ddd.oaifree.com/query-dns');
check('DoH 基址是官网', liveBase('doh') === LINUX_ORIGIN && liveCapBase('doh') === LINUX_CAP_ORIGIN);
check('DoH 不改写帖子', rewriteLinuxUrl(topic, 'doh') === topic);
check('DoH 不改写 cap', rewriteLinuxUrl(cap, 'doh') === cap);
check('DoH OAuth 仍是官网', rewriteLinuxUrl(oauth, 'doh') === oauth);
check('DoH 把镜像折回官网', rewriteLinuxUrl(mirrorTopic, 'doh') === topic && rewriteLinuxUrl(mirrorCap, 'doh') === cap);
check('DoH WebView 把镜像回调折回官网', adoptAccessUrl(mirrorOauthCode, 'doh') === oauthCode);
check('通道名单含 DoH', ACCESS_CHANNELS.join(',') === 'mirror,doh,direct' && ACCESS_CHANNEL_LABEL.doh === 'DoH');
check('通道只有名称', ACCESS_CHANNEL_LABEL.mirror === '镜像' && ACCESS_CHANNEL_LABEL.direct === '直连');

console.log(fails ? `\n✗ 未通过：${fails} 项` : '\n✓ 通过：访问通道改写正常');
process.exit(fails ? 1 : 0);
