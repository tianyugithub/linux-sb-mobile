/**
 * 发版前自查：安装包里的 JS 必须带着**当前**版本号。
 *
 * 踩过的坑：只改 `app.json` 的版本号时，Metro 打包任务可能被判成 UP-TO-DATE 而不重跑，
 * 于是清单写的 0.1.6、包内 app.json 还是 0.1.5 —— App 界面显示旧版本、更新检查还会
 * 反复提示同一个版本。这里直接读 APK 里的 bundle 比对，避免再靠人眼验证。
 *
 * 跑法：npx tsx scripts/check-apk-version.ts [apk 路径]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apk = process.argv[2] ?? join(root, 'android/app/build/outputs/apk/release/app-release.apk');
const version = String(JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.version);

if (!existsSync(apk)) {
  console.error(`找不到安装包：${apk}\n先执行 android/gradlew assembleRelease`);
  process.exit(2);
}

const bundle = execFileSync('unzip', ['-p', apk, 'assets/index.android.bundle'], { maxBuffer: 64 * 1024 * 1024 });
const text = bundle.toString('latin1');
const found = Array.from(new Set(text.match(/0\.\d+\.\d+/g) ?? []));
const ok = found.includes(version);

console.log(`  app.json 版本: ${version}`);
console.log(`  包内 bundle 里的版本串: ${found.join(', ') || '（无）'}`);
console.log(ok ? '✓ 通过：安装包内的版本号与 app.json 一致' : `✗ 包内没有 ${version} —— 打包任务很可能没重跑（先清理 app/build/generated/assets 再构建）`);
process.exit(ok ? 0 : 1);
