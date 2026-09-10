import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export type IonName = ComponentProps<typeof Ionicons>['name'];

export type Topic = {
  id: string;
  title: string;
  author: string;
  authorId?: string;
  authorTitle?: string;
  authorTitleSerial?: string;
  authorGroup?: string;
  forum: string;
  /** 版块 id（官方帖子列表屏蔽按版块 id 匹配）。 */
  forumId?: string;
  time: string;
  replies: number;
  heat?: boolean;
  featured?: boolean;
  status?: string;
  tags?: { type: string; label: string }[];
  lastPage?: number;
  hasUnread?: boolean;
  unreadPage?: number;
  unreadFloor?: string;
  lastReplier?: string;
  lastReplierId?: string;
  avatar: string;
  avatarUrl?: string;
  accent: string;
  body?: string;
  online?: boolean;
  editedBy?: string;
  editedById?: string;
  editedAt?: string;
};

export type ForumBoard = {
  name: string;
  group: string;
  desc: string;
  topics: number;
  posts: number;
  today: number;
  accent: string;
  icon: IonName;
  latest: string;
  latestTime: string;
};

export type Member = {
  id: string;
  name: string;
  title: string;
  group: '访客' | '饼友' | '创作者' | '社区主理人';
  groupLabel?: string;
  points: number;
  uid: string;
  avatar: string;
  avatarUrl?: string;
  accent: string;
  bio: string;
  topicCount: number;
  replyCount: number;
  joined: string;
};

export type MessageItem = {
  id: string;
  kind: 'mention' | 'reward' | 'system' | 'reply';
  name: string;
  text: string;
  topic: string;
  topicId?: string;
  replyId?: string;
  time: string;
  avatar: string;
  avatarUrl?: string;
  accent: string;
  unread?: boolean;
};

export type DirectThread = {
  id: string;
  userId?: string;
  name: string;
  preview: string;
  time: string;
  avatar: string;
  avatarUrl?: string;
  accent: string;
};

export type RankRow = {
  rank: number;
  name: string;
  group: string;
  value: string;
  avatar: string;
  avatarUrl?: string;
  userId?: string;
  accent: string;
  self?: boolean;
};

export type InviteCode = {
  code: string;
  status: '未使用' | '待达标' | '已生效';
  usedBy?: string;
  time: string;
};

export type TitleItem = {
  name: string;
  rarity: 'N' | 'R' | 'SR' | 'SSR' | 'UR';
  owned: boolean;
  desc: string;
};

export type Album = {
  id: string;
  title: string;
  author: string;
  count: number;
  updated: string;
  desc: string;
  accent: string;
  public: boolean;
};

export { sorts } from './src/data/feed-nav';

export const guest: Member = {
  id: '0',
  name: '访客',
  title: '未登录',
  group: '访客',
  points: 0,
  uid: '-',
  avatar: 'P',
  accent: '#222A38',
  bio: '登录后同步主题、收藏和积分',
  topicCount: 0,
  replyCount: 0,
  joined: '-',
};

export type ServicePage = 'leaderboard' | 'invite' | 'titles' | 'collections' | 'identity';

export const menuItems: { key: string; label: string; icon: IonName; page: ServicePage }[] = [
  { key: 'leaderboard', label: '用户榜单', icon: 'trophy-outline', page: 'leaderboard' },
  { key: 'invite', label: '邀请中心', icon: 'person-add-outline', page: 'invite' },
  { key: 'titles', label: '称号中心', icon: 'ribbon-outline', page: 'titles' },
  { key: 'collections', label: '淘帖中心', icon: 'albums-outline', page: 'collections' },
  { key: 'identity', label: '认证中心', icon: 'shield-checkmark-outline', page: 'identity' },
];
