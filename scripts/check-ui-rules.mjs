#!/usr/bin/env node
/**
 * UI 规则检查：业务代码里不许写死颜色、不许自造 StyleSheet。
 *
 * 检查项：
 *   1. 业务代码（src/screens、src/components）里不得写死颜色，必须用 src/theme/palette.ts 的令牌
 *   2. 不得在业务文件里新造 StyleSheet（既有历史文件已登记，新增即报错）
 *
 * 运行：npm run check:ui
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/screens', 'src/components'];

/** 历史遗留：允许保留写死颜色，但**改动时不得新增**。迁移后请从名单里删掉。 */
const LEGACY_COLORS = new Set([
  'src/components/TopicGone.tsx',   // 帖子失效插画页，自带插画配色
  'src/screens/MineScreen.tsx',     // 「我的」页 hero 配色
  'src/components/ImageGallery.tsx',// 图片查看器（黑底是刻意的）
  'src/components/TitleBadge.tsx',  // 称号序号角标
]);

/** 历史遗留：允许有本地 StyleSheet，新增即报错。 */
const LEGACY_STYLES = new Set([
  'src/components/account/AccountUi.tsx', // 账户组件自带样式工厂（等价主题文件）
  'src/components/TopicGone.tsx',
  'src/components/ImageGallery.tsx',
  'src/components/TitleBadge.tsx',
  'src/components/TitleShine.tsx',
  'src/components/ContentSkeleton.tsx',
  'src/components/InAppBrowser.tsx',
  'src/components/OAuthBrowser.tsx',
  'src/screens/MineScreen.tsx',
  'src/screens/ForumsScreen.tsx',
  'src/screens/TitlesCenter.tsx',
]);

/** 允许的行内例外 */
const ALLOWED_LINE = [
  /#(?:fff|FFF|ffffff|FFFFFF)\b/, // 彩色底上的白色（主按钮、角标）
  /rgba?\(/,                      // 半透明遮罩 / 阴影
  /colors=\{\[/,                  // 渐变断点（不属于调色板令牌）
  /accent\?\.startsWith\('/,      // 数据驱动的用户色
];

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const STYLESHEET = /StyleSheet\.create\(/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
const colorErrors = [];
const styleErrors = [];
const legacyColorHits = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');

  text.split('\n').forEach((line, index) => {
    if (!HEX.test(line)) return;
    if (ALLOWED_LINE.some((re) => re.test(line))) return;
    const where = `${rel}:${index + 1}`;
    if (LEGACY_COLORS.has(rel)) legacyColorHits.push(where);
    else colorErrors.push(`${where}  ${line.trim().slice(0, 100)}`);
  });

  if (STYLESHEET.test(text) && !LEGACY_STYLES.has(rel)) {
    styleErrors.push(rel);
  }
}

const report = (title, list, hint) => {
  if (!list.length) return;
  console.log(`\n✗ ${title}（${list.length}）`);
  list.slice(0, 25).forEach((item) => console.log(`   ${item}`));
  if (list.length > 25) console.log(`   … 其余 ${list.length - 25} 条省略`);
  if (hint) console.log(`   → ${hint}`);
};

console.log('UI 规则检查（写死颜色 / 自造 StyleSheet）');
console.log(`扫描 ${files.length} 个文件`);

report('写死颜色：请改用 palette.ts 的令牌', colorErrors, '深色/浅色都要成立，新增颜色请同时补两套');
report('业务文件里新造了 StyleSheet：请加进 src/theme/app-styles.ts', styleErrors, '共享样式只有一个来源');

if (legacyColorHits.length) {
  console.log(`\n⚠ 历史遗留文件仍有写死颜色（${legacyColorHits.length} 处，已登记在 LEGACY_COLORS，不阻塞）`);
  console.log(`   改动这些文件时请顺手收敛，不要新增。`);
}

const failed = colorErrors.length + styleErrors.length;
if (failed) {
  console.log(`\n✗ 未通过：${failed} 项违规`);
  process.exit(1);
}
console.log('\n✓ 通过：没有新增写死颜色，也没有新造 StyleSheet');
