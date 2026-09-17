/**
 * 导航：点用户必须立刻进页；返回不能再走进入动画。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STACK_PUSH_ANIMATION, TAB_SWITCH_FADE_MS, stackMotion, stubMember, stubTopic } from '../src/navigation/stack';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

console.log('导航 · 用户页占位与进出方向');

const stub = stubMember('42', { name: '饼友甲', uid: '42' });
check('点头像立刻有用户占位，不先等接口', stub.id === '42' && stub.name === '饼友甲');
check('占位带上预览名字和 uid', stub.uid === '42');
check('没有预览时也能进页', stubMember('99').name === '用户');

const topic = stubTopic('10532', '标题');
check('主题页同样是占位先推栈', topic.id === '10532' && topic.title === '标题');

check('进页是 push', stackMotion(1, 2) === 'push');
check('返回是 pop', stackMotion(2, 1) === 'pop');
check('进出不是同一种动作', stackMotion(1, 2) !== stackMotion(2, 1));
check('长度不变不算进出', stackMotion(2, 2) === 'idle');
check('进出走原生栈动画，不是 JS translateX', STACK_PUSH_ANIMATION === 'ios_from_right');
check('主 Tab 切换是轻量淡入（160–220ms），无位移', TAB_SWITCH_FADE_MS >= 160 && TAB_SWITCH_FADE_MS <= 220);
{
  const app = readFileSync(join(process.cwd(), 'App.tsx'), 'utf8');
  check(
    'Tab 淡入等 setTab 提交后再 start，避免闪旧页',
    app.includes('tabFadePending') && app.includes('useLayoutEffect') && !/setTab\(key\);\s*Animated\.timing\(tabFade/.test(app),
  );
}

console.log(fails ? `\n✗ 未通过：${fails} 项` : '\n✓ 通过：用户页占位先跳、返回与进入方向分开');
process.exit(fails ? 1 : 0);
