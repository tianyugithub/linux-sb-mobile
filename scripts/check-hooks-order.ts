/**
 * hooks 顺序回归：**hook 调用不能出现在函数体里任何 return 之后**。
 *
 * 为什么需要这个脚本：项目没配 ESLint，而 React 的规则里这条一旦违反是**运行时崩溃** ——
 * 首屏少走几个 hook、下一帧多走几个，React 会抛
 * 「Rendered fewer hooks than expected. This may be caused by an accidental early return statement.」
 * 并且因为没有错误边界，整个 App 直接退出。
 * 真实案例：插件页的 HelperPointsPane 把 useRef/useEffect 写在「加载中」早返回之后，
 * 启用插件后打开插件页必闪退，静态检查（tsc、纯逻辑回归）全都没抓到。
 *
 *   npm run check:hooks
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const isHookCall = (node: ts.Node): string | null => {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
      ? callee.expression.text
      : '';
  return /^use[A-Z]/.test(name) ? name : null;
};

/** 找出函数体里「顶层 return」之后仍然出现的 hook 调用。 */
function offendingHooks(fn: ts.SignatureDeclaration & { body?: ts.Node }): { line: number; hook: string; afterLine: number }[] {
  const body = fn.body;
  if (!body) return [];
  const statements = ts.isBlock(body) ? [...body.statements] : [body as unknown as ts.Statement];
  let returnedAt: { line: number } | null = null;
  const hits: { line: number; hook: string; afterLine: number }[] = [];
  for (const stmt of statements) {
    // 顶层 return（含 `if (...) return x;` 这种把 return 写在同一层的）
    const returns = (node: ts.Node): boolean => {
      if (ts.isReturnStatement(node)) return true;
      let found = false;
      node.forEachChild((child) => {
        // 不下钻进嵌套函数：里面的 return 属于它自己
        if (ts.isFunctionLike(child)) return;
        if (!found && returns(child)) found = true;
      });
      return found;
    };
    if (!returnedAt && returns(stmt)) {
      returnedAt = { line: sourceLine(stmt) };
      continue;
    }
    // 语句里的 hook 调用（不下钻嵌套函数）
    const visit = (node: ts.Node) => {
      const hook = isHookCall(node);
      if (hook && returnedAt) hits.push({ line: sourceLine(node), hook, afterLine: returnedAt.line });
      node.forEachChild((child) => {
        if (ts.isFunctionLike(child)) return;
        visit(child);
      });
    };
    visit(stmt);
  }
  return hits;
}

let sourceFile: ts.SourceFile | null = null;
function sourceLine(node: ts.Node): number {
  return sourceFile ? sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1 : 0;
}

let fails = 0;
console.log('hooks 顺序回归（hook 不能出现在 return 之后）');
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = relative(root, file);
  const problems: string[] = [];
  const visitFn = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
      for (const hit of offendingHooks(node as ts.SignatureDeclaration & { body?: ts.Node })) {
        problems.push(`  ${rel}:${hit.line}  ${hit.hook}() 出现在第 ${hit.afterLine} 行的 return 之后`);
      }
    }
    node.forEachChild(visitFn);
  };
  visitFn(sourceFile);
  if (problems.length) {
    fails += problems.length;
    console.log(`✗ ${rel}`);
    problems.forEach((line) => console.log(line));
  }
}
console.log(fails ? `\n✗ 未通过：${fails} 处 hooks 顺序问题` : '\n✓ 通过：没有 hook 出现在 return 之后');
process.exit(fails ? 1 : 0);
