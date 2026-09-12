/**
 * 导航：点用户必须立刻进页；返回不能再走进入动画。
 */
import { stackMotion, stubMember, stubTopic } from '../src/navigation/stack';

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

console.log(fails ? `\n✗ 未通过：${fails} 项` : '\n✓ 通过：用户页占位先跳、返回与进入方向分开');
process.exit(fails ? 1 : 0);
