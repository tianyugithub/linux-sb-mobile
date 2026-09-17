import type { Member, Topic } from '../../data';
import { C } from '../theme/palette';

export type UserPreview = {
  name?: string;
  uid?: string;
  avatar?: string;
  avatarUrl?: string;
  accent?: string;
};

export function stubTopic(id: string, title: string, replies = 0, forum = '综合'): Topic {
  return { id, title, author: '', forum, time: '', replies, avatar: '?', accent: C.blue };
}

/**
 * 用户主页占位。点头像必须马上进页，资料在页里再拉，
 * 不能先等 `/users/:id` 再 setStack（否则会停在当前页干等）。
 */
export function stubMember(id: string, preview?: UserPreview): Member {
  const name = (preview?.name || '').trim();
  const uid = (preview?.uid || (/^\d+$/.test(id) ? id : '')).trim();
  return {
    id,
    name: name || '用户',
    title: '',
    group: '饼友',
    points: 0,
    uid: uid || id,
    avatar: preview?.avatar || (name || '?').slice(0, 1),
    avatarUrl: preview?.avatarUrl,
    accent: preview?.accent || C.blue,
    bio: '',
    topicCount: 0,
    replyCount: 0,
    joined: '',
  };
}

/** 栈长度变化：变长是进入，变短是返回。返回不能再用进入动画。 */
export function stackMotion(prevLen: number, nextLen: number): 'push' | 'pop' | 'idle' {
  if (nextLen > prevLen) return 'push';
  if (nextLen < prevLen) return 'pop';
  return 'idle';
}

/**
 * 进出动画交给 `react-native-screens` 的原生栈（和 React Navigation native-stack、
 * Expo Router 同一套）。Android 用 iOS 式右进，系统合成，不在 JS 里位移整页。
 */
export const STACK_PUSH_ANIMATION = 'ios_from_right' as const;

/**
 * 主 Tab 切换的淡入时长（ms）。栈式页面走原生动画，只有 Tab 这一层用 JS 淡入：
 * 无位移（位移会顶偏 WebView），淡入只做合成器透明度，不触发布局。
 */
export const TAB_SWITCH_FADE_MS = 180;
