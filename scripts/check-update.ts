/**
 * 检查更新的纯逻辑回归（不联网）。
 *
 * 版本来源是项目仓库：优先 GitHub 的 latest release，没有 release 就回退读默认分支的 app.json。
 * 这里守住三件事：主页地址能解析出 owner/repo、版本比较符合直觉、以及当前版本与仓库一致。
 */
import { APP_VERSION, PROJECT_URL } from '../src/data/app-info';
import { compareVersions, formatApkSize, parseRepo, parseVersion, pickReleaseApk, updatePromptText } from '../src/services/app-update';
import { githubAccessUrls, githubBrowseUrl, isGithubUrl } from '../src/utils/github-access';
import pkg from '../package.json';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

console.log('检查更新 · 纯逻辑回归');

/* ── 项目主页 → owner/repo ─────────────────────────────────────── */
const ref = parseRepo(PROJECT_URL);
check('package.json 与 app.json 同版本', pkg.version === APP_VERSION, `${pkg.version} / ${APP_VERSION}`);
check('项目主页已配置', Boolean(PROJECT_URL), PROJECT_URL || '（空）');
check('能解析出 owner/repo', ref?.owner === 'tianyugithub' && ref?.repo === 'linux-sb-mobile', JSON.stringify(ref));
check('带 .git 后缀也能解析', parseRepo('https://github.com/a/b.git')?.repo === 'b');
check('带尾部斜杠也能解析', parseRepo('https://github.com/a/b/')?.repo === 'b');
check('非 GitHub 地址返回 null', parseRepo('https://gitee.com/a/b') === null && parseRepo('') === null);

/* ── 版本号解析 ───────────────────────────────────────────────── */
check('去掉 v 前缀', JSON.stringify(parseVersion('v0.1.0')) === '[0,1,0]', JSON.stringify(parseVersion('v0.1.0')));
check('多段数字', JSON.stringify(parseVersion('1.2.10')) === '[1,2,10]', JSON.stringify(parseVersion('1.2.10')));
check('预发布后缀被忽略', JSON.stringify(parseVersion('0.2.0-beta.1')) === '[0,2,0]', JSON.stringify(parseVersion('0.2.0-beta.1')));
check('预发布版不比同号正式版新', compareVersions('0.2.0-beta.1', '0.2.0') === 0);
check('构建元数据被忽略', JSON.stringify(parseVersion('0.2.0+61')) === '[0,2,0]', JSON.stringify(parseVersion('0.2.0+61')));
check('空值当 0', JSON.stringify(parseVersion('')) === '[0]', JSON.stringify(parseVersion('')));

/* ── 版本比较 ─────────────────────────────────────────────────── */
check('相同版本相等', compareVersions('0.1.0', 'v0.1.0') === 0);
check('补零后相等', compareVersions('0.1', '0.1.0') === 0);
check('高位更大', compareVersions('9.0.0', APP_VERSION) > 0);
check('按数值比而不是字符串', compareVersions('0.1.10', '0.1.9') > 0);
check('低位更小', compareVersions('0.0.9', APP_VERSION) < 0);
check(
  '从 release 资源里挑 APK',
  pickReleaseApk([
    { name: 'Source code', browser_download_url: 'https://github.com/x/zip' },
    { name: 'linux-sb-0.1.2-release.apk', browser_download_url: 'https://github.com/x/app.apk', size: 28_000_000, content_type: 'application/vnd.android.package-archive' },
  ])?.url === 'https://github.com/x/app.apk',
);
check('没有 APK 时返回空', pickReleaseApk([{ name: 'notes.md', browser_download_url: 'https://x' }]) === null);
check('体积格式化', formatApkSize(28_311_457) === '27M', formatApkSize(28_311_457));
check('空体积不显示', formatApkSize(0) === '');
check(
  '更新文案会写下载安装',
  /下载安装包/.test(updatePromptText({
    status: 'available',
    current: '0.1.0',
    latest: '0.1.2',
    url: 'https://github.com/x',
    notes: '修了外链',
    apkUrl: 'https://github.com/x/app.apk',
    apkSize: 28_000_000,
  })),
);

/* ── 国内访问 GitHub：直连 + 镜像 ─────────────────────────────── */
const apkUrl = 'https://github.com/tianyugithub/linux-sb-mobile/releases/download/v0.1.3/linux-sb-0.1.3-release.apk';
const apkMirrors = githubAccessUrls(apkUrl);
check('识别 GitHub 地址', isGithubUrl(apkUrl) && isGithubUrl('https://api.github.com/repos/a/b'));
check('linux.sb 不走 GitHub 镜像', githubAccessUrls('https://linux.sb/wallet')[0] === 'https://linux.sb/wallet' && githubAccessUrls('https://linux.sb/wallet').length === 1);
check('安装包候选含直连', apkMirrors.includes(apkUrl));
check('安装包优先走 gh-proxy', apkMirrors[0] === `https://gh-proxy.com/${apkUrl}`);
check('安装包候选含 ghfast', apkMirrors.some((item) => item.startsWith('https://ghfast.top/https://github.com/')));
check(
  'raw 回退 jsDelivr',
  githubAccessUrls('https://raw.githubusercontent.com/tianyugithub/linux-sb-mobile/main/app.json').includes(
    'https://cdn.jsdelivr.net/gh/tianyugithub/linux-sb-mobile@main/app.json',
  ),
);
check('仓库页仍开 github.com', githubBrowseUrl(PROJECT_URL) === PROJECT_URL);
check('非 GitHub 浏览地址不变', githubBrowseUrl('https://linux.sb/') === 'https://linux.sb/');

console.log(fails ? `\n✗ 未通过：${fails} 项` : '\n✓ 通过：检查更新逻辑正常');
process.exit(fails ? 1 : 0);
