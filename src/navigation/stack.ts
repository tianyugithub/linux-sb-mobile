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
