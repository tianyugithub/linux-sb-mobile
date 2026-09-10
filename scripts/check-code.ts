/**
 * 代码块渲染回归：压缩代码不能把文本引擎拖死。
 *
 * 背景见 src/utils/highlight.ts 的 collapseHeavyLine：一行上万字符的压缩代码曾被切成约 4500 个
 * 片段，每个片段都是一个嵌套 Text —— 打开 linux.sb/topic/21279 时进程满载 8 秒以上。
 * 这里盯住两件事：超长行的片段必须合并、正常代码仍要逐段着色。
 */
import { prepareCode, tokensToLines, longestLineLength } from '../src/utils/highlight';

let failed = 0;
function check(label: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
}

const normal = 'function add(a, b) {\n  return a + b; // 加法\n}\n';
const normalLines = tokensToLines(prepareCode(normal, 'js', false).tokens);
check('正常代码仍然逐段着色', normalLines.some((line) => line.length > 2), `每行片段 ${normalLines.map((l) => l.length).join(',')}`);

// 一行 18K 字符的压缩代码（真实帖子里就是这种）
const minified = `// ==UserScript==\n// @name Reader\n!function(){${'const a=1;'.repeat(2000)}}\n`;
const minifiedLines = tokensToLines(prepareCode(minified, 'js', false).tokens);
check('超长行的片段被合并', minifiedLines.every((line) => line.length <= 1), `每行片段 ${minifiedLines.map((l) => l.length).join(',')}`);
// 逐行比对（换行符本身用于分行，不进片段）
const srcLines = minified.replace(/\r\n?/g, '\n').split('\n');
const gotLines = minifiedLines.map((line) => line.map((tok) => tok.t).join(''));
check(
  '合并后每一行内容不丢',
  srcLines.length === gotLines.length && srcLines.every((text, index) => text === gotLines[index]),
  `原始 ${srcLines.length} 行 / 渲染 ${gotLines.length} 行`,
);

const longest = longestLineLength(minifiedLines);
check('能算出最长行长度（用于决定不换行）', longest > 1000, `最长 ${longest} 字符`);
const emptyLines = tokensToLines([]);
check('空代码不炸', emptyLines.length === 1 && longestLineLength(emptyLines) === 0);

console.log(failed ? `\n✗ ${failed} 项未通过` : '\n✓ 通过：代码块渲染回归正常');
process.exit(failed ? 1 : 0);
