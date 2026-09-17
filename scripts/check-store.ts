/**
 * 安全存储回归：登录态绝不能因为「写到一半」而丢。
 *
 * 背景：安卓 expo-secure-store 单值上限约 2KB，超限静默失败；而登录 cookie jar 会超。
 * 第一版修法是「先删旧、再写新」，结果 cookie 每次响应都在重写，那个窗口里被系统回收
 * 就等于两头都没了 —— 用户看到的正是「啥也没干就掉登录」。现在改成：写新一代 → 最后翻指针，
 * 并保留上一代当备份、兼容两版老布局。
 *
 * 跑法：node scripts/run-stubbed.mjs scripts/check-store.ts
 * （SecureStore 是内存 Map，测试直接操纵它来模拟各种残缺状态）
 */
import { chunkKey, countKey, pointerKey, secureGet, secureSet, splitByBytes } from '../src/services/secure-value';
import { parseRememberedLogin } from '../src/utils/remember-login';

const mem: Map<string, string> = (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore
  ?? new Map();
(globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore = mem;

let failed = 0;
function check(label: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed += 1;
}

const byteLen = (text: string) => new TextEncoder().encode(text).length;
const KEY = 'lsb.cookies';

async function main() {
  // 1) 分片必须按「字节」算：中文一字 3 字节
  const cjk = '技术交流;'.repeat(600);
  const parts = splitByBytes(cjk);
  check('分片按 UTF-8 字节限制', parts.every((part) => byteLen(part) <= 1700), `${parts.length} 片，最大 ${Math.max(...parts.map(byteLen))} 字节`);
  check('分片内容无损', parts.join('') === cjk);

  // 2) 基本往返：一大串中文 cookie
  mem.clear();
  await secureSet(KEY, cjk);
  check('大值往返一致', (await secureGet(KEY)) === cjk, `${byteLen(cjk)} 字节`);
  check('指针已提交', mem.get(pointerKey(KEY)) === '0');

  // 3) 第二次写入后，上一代仍在（备份）
  const second = `${cjk}|bbs_auth=abc`;
  await secureSet(KEY, second);
  check('新值可读', (await secureGet(KEY)) === second);
  check('保留上一代做备份', mem.has(countKey(KEY, 0)) && mem.has(chunkKey(KEY, 1, 0)), 'gen0 仍在');

  // 4) 模拟「写到一半被杀」：新一代只写了分片，指针没翻
  mem.set(chunkKey(KEY, 2, 0), '半个会话');
  mem.set(countKey(KEY, 2), '1');
  check('未提交的新代不影响读取', (await secureGet(KEY)) === second, '仍返回已提交的 gen1');

  // 5) 模拟「指针翻了但新代缺片」：必须回退上一代，不能返回半个会话
  mem.set(pointerKey(KEY), '2');
  mem.set(countKey(KEY, 2), '3'); // 声称 3 片，实际只有 1 片
  check('新代残缺时回退备份', (await secureGet(KEY)) === second, '返回 gen1 而不是半截');

  // 6) 空值不得覆盖已有内容
  mem.clear();
  await secureSet(KEY, second);
  await secureSet(KEY, '   ');
  check('拒绝空值覆盖', (await secureGet(KEY)) === second);

  // 7) 兼容更早的分片布局（`<key>.n` + `<key>.<i>`）
  mem.clear();
  mem.set(`${KEY}.n`, '2');
  mem.set(`${KEY}.0`, 'bbs_auth=old');
  mem.set(`${KEY}.1`, ';bbs_csrf=x');
  check('能读老分片布局', (await secureGet(KEY)) === 'bbs_auth=old;bbs_csrf=x');

  // 8) 兼容完全没有分片的单键老数据
  mem.clear();
  mem.set(KEY, 'bbs_auth=single');
  check('能读单键老数据', (await secureGet(KEY)) === 'bbs_auth=single');

  console.log('\n记住的账号密码');
  check('能解析用户名和密码', parseRememberedLogin('{"username":"饼友","password":"secret"}')?.password === 'secret');
  check('用户名会去掉首尾空格', parseRememberedLogin('{"username":"  a  ","password":"b"}')?.username === 'a');
  check('空用户名丢掉', parseRememberedLogin('{"username":"  ","password":"x"}') === null);
  check('坏 JSON 丢掉', parseRememberedLogin('{') === null);
  mem.clear();
  await secureSet('lsb.remember_login', JSON.stringify({ username: 'pie', password: 'pw' }));
  check('账号密码能写进安全存储', parseRememberedLogin(await secureGet('lsb.remember_login'))?.password === 'pw');

  console.log(failed ? `\n✗ ${failed} 项未通过` : '\n✓ 通过：登录态存储回归正常');
  process.exit(failed ? 1 : 0);
}

void main();
