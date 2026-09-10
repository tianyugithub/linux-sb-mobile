/**
 * 冷启动快照回归（src/services/query-cache.ts 的磁盘部分）。
 *
 * 做法：把 query-cache.ts 用 esbuild 打包成 node 模块，react-native 与 expo-file-system
 * 换成内存假实现；每次 import 一个新的模块实例 = 一次「冷启动」，假文件系统跨实例保留。
 *
 *   node scripts/check-query-cache.mjs
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(os.tmpdir(), `lsb-query-cache-${process.pid}.mjs`);
const files = (globalThis.__files ??= new Map());

const stubPlugin = {
  name: 'stub-native',
  setup(b) {
    const stubs = {
      'react-native': `export const Platform = { OS: 'android', select: (o) => o.android ?? o.default };
export default { Platform };`,
      'expo-file-system': `const files = globalThis.__files;
class File {
  constructor(...parts) { this.uri = parts.map((p) => String(p?.uri ?? p)).join('/'); }
  get exists() { return files.has(this.uri); }
  textSync() { if (!files.has(this.uri)) throw new Error('ENOENT'); return files.get(this.uri); }
  write(text) { files.set(this.uri, String(text)); }
  delete() { files.delete(this.uri); }
}
export const Paths = { document: { uri: 'doc:' }, cache: { uri: 'cache:' } };
export { File };
export default { File, Paths };`,
    };
    b.onResolve({ filter: /^(react-native|expo-file-system)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubs[a.path] ?? 'export default {};', loader: 'js' }));
  },
};

await build({
  entryPoints: [path.join(ROOT, 'src/services/query-cache.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: OUT,
  logLevel: 'warning',
  plugins: [stubPlugin],
});

let gen = 0;
/** 重新加载模块 = 冷启动：内存缓存清空，磁盘「文件」保留。 */
const coldStart = () => import(`${OUT}?v=${++gen}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

console.log('查询缓存冷启动快照检查');

{
  const c = await coldStart();
  c.cacheSet('list:true', { items: [1, 2, 3], nextCursor: '2' });
  await sleep(1500);
  check('写入防抖落盘', files.size === 1, [...files.keys()].join(','));
}

{
  const c = await coldStart();
  const got = c.cacheGet('list:true');
  check('冷启动读回快照', JSON.stringify(got) === JSON.stringify({ items: [1, 2, 3], nextCursor: '2' }), JSON.stringify(got));
}

{
  const c = await coldStart();
  c.cacheDelete('list:');
  await sleep(1500);
  const d = await coldStart();
  check('删除后冷启动不再命中', d.cacheGet('list:true') === undefined);
}

{
  const c = await coldStart();
  c.cacheSet('identity:1', { name: 'miapi' });
  await sleep(1500);
  check('清空前有快照', files.size === 1);
  c.cacheClear();
  check('cacheClear 清掉磁盘快照', files.size === 0);
  const d = await coldStart();
  check('cacheClear 后冷启动为空', d.cacheGet('identity:1') === undefined);
}

{
  const c = await coldStart();
  c.cacheSet('topic:1', { blob: 'x'.repeat(200_000) });
  c.cacheSet('inbox:1', [{ id: '1' }]);
  await sleep(1500);
  const raw = [...files.values()].sort((a, b) => b.length - a.length)[0] ?? '[]';
  check('超大条目不入快照', !raw.includes('xxxx'));
  check('小条目保留', raw.includes('inbox:1'));
}

{
  const [first] = [...files.keys()];
  files.set(first ?? 'doc:/query-cache.json', '{oops');
  const c = await coldStart();
  check('损坏快照当作没有', c.cacheGet('inbox:1') === undefined);
}

files.clear();
try {
  rmSync(OUT, { force: true });
} catch {
  /* 临时产物清理失败无所谓 */
}
console.log(fails ? `✗ ${fails} 项失败` : '✓ 全部通过');
process.exit(fails ? 1 : 0);
