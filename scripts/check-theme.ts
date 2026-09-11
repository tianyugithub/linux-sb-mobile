/**
 * 浅/深色冷启动：色系快照必须同步可读，applyScheme 要落盘。
 * 否则浅色用户重开 App 会先按默认深色画一帧。
 *
 *   node scripts/run-stubbed.mjs scripts/check-theme.ts
 */
import { applyScheme, getPalette, getScheme } from '../src/theme/palette';
import { hasBootScheme, readBootScheme, writeBootScheme } from '../src/services/scheme-boot';

let failed = 0;
function check(label: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
}

console.log('色系冷启动快照');
check('未写入时没有快照', hasBootScheme() === false);
check('未写入时按深色兜底', readBootScheme() === 'dark');

writeBootScheme('light');
check('写入浅色后能同步读到', hasBootScheme() && readBootScheme() === 'light');

writeBootScheme('dark');
check('写入深色后能同步读到', hasBootScheme() && readBootScheme() === 'dark');

applyScheme('light');
check('applyScheme 切换后 palette 是浅色', getScheme() === 'light' && getPalette().scheme === 'light');
check('applyScheme 会把浅色写入快照', readBootScheme() === 'light');

applyScheme('light');
check('重复 apply 同一色系不炸', getScheme() === 'light');

console.log(failed ? `\n✗ ${failed} 项未通过` : '\n✓ 通过：色系冷启动快照正常');
process.exit(failed ? 1 : 0);
