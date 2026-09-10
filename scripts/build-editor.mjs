#!/usr/bin/env node
/**
 * 内核构建：把 ProseMirror 内核打成单个 IIFE，并生成 src/editor/kernel.generated.ts。
 *
 * 产物直接内联进 WebView 页面（不联网、不依赖 CDN），见 docs/wysiwyg-design.md §8。
 * 修改 src/editor/kernel/** 后需要重新执行：npm run build:editor
 * 忘了执行的话，App 跑的还是旧内核 —— scripts/check-kernel-build.mjs 会检查这件事。
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src/editor/kernel/entry.ts');
const out = join(root, 'src/editor/kernel.generated.ts');

export const KERNEL_BANNER = [
  '// 本文件由 scripts/build-editor.mjs 生成，请勿手改。',
  '// 源：src/editor/kernel/**  重新生成：npm run build:editor',
  '',
].join('\n');

/** 真正打包内核，返回内联用的 IIFE 源码。build-editor 与 check-kernel-build 共用同一份配置。 */
export async function bundleKernel() {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2019',
    minify: true,
    legalComments: 'none',
  });
  return result.outputFiles[0].text;
}

export function kernelFileText(code) {
  return `${KERNEL_BANNER}export const KERNEL_JS: string = ${JSON.stringify(code)};\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await bundleKernel();
  writeFileSync(out, kernelFileText(code), 'utf8');
  console.log(`kernel.generated.ts 已生成：${(code.length / 1024).toFixed(1)} KB`);
}
