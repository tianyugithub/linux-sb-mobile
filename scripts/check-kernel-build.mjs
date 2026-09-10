#!/usr/bin/env node
/**
 * 内核实现在源码里、生成物却可能是旧的：改了 `src/editor/kernel/**` 忘记跑 `npm run build:editor`，
 * 发出去的 App 跑的还是老内核，而 `scripts/check-kernel.ts` 测的是源码、照样全绿。
 *
 * 这个脚本用与 build-editor 完全相同的配置重新打包一次，和 `src/editor/kernel.generated.ts`
 * 逐字对比：
 *   - 一致：通过；
 *   - 不一致：报错并提示跑 npm run build:editor（带 --write 可直接重新生成）。
 *
 *   node scripts/check-kernel-build.mjs          # 检查
 *   node scripts/check-kernel-build.mjs --write  # 检查并重新生成
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleKernel, kernelFileText } from './build-editor.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src/editor/kernel.generated.ts');
const write = process.argv.includes('--write');

const code = await bundleKernel();
const expected = kernelFileText(code);
const actual = readFileSync(out, 'utf8');

if (actual === expected) {
  console.log(`✓ 内核生成物与源码一致（${(code.length / 1024).toFixed(1)} KB）`);
  process.exit(0);
}

if (write) {
  writeFileSync(out, expected, 'utf8');
  console.log(`✓ 已重新生成 kernel.generated.ts（${(code.length / 1024).toFixed(1)} KB）`);
  process.exit(0);
}

const actualSize = actual.length;
console.log('✗ 内核生成物与源码不一致：App 里跑的是旧内核');
console.log(`  源码打包后 ${expected.length} 字节，kernel.generated.ts 现在 ${actualSize} 字节`);
console.log('  修复：npm run build:editor（或 node scripts/check-kernel-build.mjs --write）');
process.exit(1);
