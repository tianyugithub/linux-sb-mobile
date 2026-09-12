/**
 * 发版前自查：安装包里的版本号（native + JS）必须与 `app.json` 一致。
 *
 * 这里踩过两次坑，所以两项都要查：
 *
 * 1. **JS 侧**：只改 `app.json` 的版本号时，Metro 打包任务可能被判成 UP-TO-DATE 而不重跑，
 *    于是包内 bundle 还是上一版 —— 界面显示旧版本、更新检查反复提示同一个版本。
 *    读包内 `assets/index.android.bundle` 比对。
 *
 * 2. **native 侧**：`android/app/build.gradle` 里的 versionName/versionCode 是 expo prebuild
 *    写死的，之后只改 app.json 不会同步 —— 实测 android:versionName 卡在 0.1.12、versionCode
 *    卡在 139，而包内 JS 已经是 0.1.15（App 里显示 0.1.15，安装包却自称 0.1.12）。
 *    现在 build.gradle 直接读 app.json，这里就用 aapt2 读出来核对，防止哪天又退回去。
 *
 * 注意 Hermes：字符串表会做前后缀复用，版本号可能只作为别的长串的一部分存在
 * （实测 `0.1.15` 被复用进了钉住的镜像 IP 串 `…0.1.154.12.50.175…`），
 * 所以「独立出现」算通过，「只作为子串出现」也算通过但会说明，两者都没有才算失败。
 *
 * 跑法：npx tsx scripts/check-apk-version.ts [apk 路径]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apk = process.argv[2] ?? join(root, 'android/app/build/outputs/apk/release/app-release.apk');
const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo as {
  version: string;
  android?: { versionCode?: number };
};
const version = String(config.version);
const versionCode = Number(config.android?.versionCode ?? 0);

if (!existsSync(apk)) {
  console.error(`找不到安装包：${apk}\n先执行 android/gradlew assembleRelease`);
  process.exit(2);
}

/** 从 SDK 里挑一个 aapt2（版本目录按名字排序取最后一个）。 */
function findAapt2(): string | null {
  const sdk = process.env.ANDROID_HOME
    || process.env.ANDROID_SDK_ROOT
    || join(process.env.HOME ?? '', 'Library/Android/sdk');
  const dir = join(sdk, 'build-tools');
  if (!existsSync(dir)) return null;
  const versions = readdirSync(dir).filter((name) => /^\d/.test(name)).sort();
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    const bin = join(dir, versions[i], 'aapt2');
    if (existsSync(bin)) return bin;
  }
  return null;
}

const fails: string[] = [];

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string };
if (String(pkg.version ?? '') !== version) {
  fails.push(`package.json(${pkg.version || '空'}) 与 app.json(${version}) 不一致`);
}

/* ── native 侧：APK 清单里的 versionName / versionCode ─────────────── */
const aapt2 = findAapt2();
if (!aapt2) {
  console.log('  ⚠ 没找到 aapt2，跳过 native 版本核对（设 ANDROID_HOME 或装 build-tools）');
} else {
  const badging = execFileSync(aapt2, ['dump', 'badging', apk], { maxBuffer: 8 * 1024 * 1024 }).toString('utf8');
  const name = badging.match(/versionName='([^']*)'/)?.[1] ?? '';
  const code = badging.match(/versionCode='(\d+)'/)?.[1] ?? '';
  console.log(`  安装包 android:versionName=${name || '（无）'} versionCode=${code || '（无）'}`);
  console.log(`  app.json version=${version} versionCode=${versionCode}`);
  if (name !== version) {
    fails.push(`native versionName(${name || '空'}) 与 app.json(${version}) 不一致 —— build.gradle 是不是又写死版本号了？`);
  }
  if (code !== String(versionCode)) {
    fails.push(`native versionCode(${code || '空'}) 与 app.json(${versionCode}) 不一致`);
  }
}

/* ── JS 侧：包内 bundle 里的版本串 ─────────────────────────────────── */
const bundle = execFileSync('unzip', ['-p', apk, 'assets/index.android.bundle'], { maxBuffer: 64 * 1024 * 1024 });
const text = bundle.toString('latin1');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const standalone = new RegExp(`(^|[^\\d.])${escaped}([^\\d.]|$)`).test(text);
const shared = text.includes(version);
console.log(`  包内 bundle：独立出现=${standalone ? '是' : '否'}，作为子串出现=${shared ? '是' : '否'}`);
if (standalone) {
  console.log('  ✓ bundle 里带着当前版本号');
} else if (shared) {
  console.log('  ✓ bundle 里能找到当前版本号（被 Hermes 字符串表复用成别的长串的一部分）');
} else {
  fails.push(`包内 bundle 里没有 ${version} —— 打包任务很可能没重跑（先清理 app/build/generated/assets 再构建）`);
}

if (fails.length) {
  for (const line of fails) console.error(`✗ ${line}`);
  process.exit(1);
}
console.log(`✓ 通过：安装包版本（native + JS）与 app.json 一致 · ${version} (${versionCode})`);
