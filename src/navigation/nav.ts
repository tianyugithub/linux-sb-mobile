import { createContext, useContext, useEffect, useRef } from 'react';
import { BackHandler, Platform, StatusBar as RNStatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Album, Member, Topic } from '../../data';
import type { CommentDto } from '../types/api';
import type { TitleTab } from '../screens/TitlesCenter';
import { C } from '../theme/palette';
import { classifyAppHref } from '../utils/links';

export type Extra =
  | { name: 'topic'; topic: Topic; latest?: boolean; editedComment?: CommentDto; replyId?: string; floor?: string }
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'search' }
  | { name: 'leaderboard' }
  | { name: 'invite' }
  | { name: 'titles'; tab?: TitleTab }
  | { name: 'collections'; tab?: 'mine' | 'everyone' }
  | { name: 'edit-topic'; topic: Topic }
  | { name: 'edit-comment'; topic: Topic; comment: CommentDto }
  | { name: 'collection'; album: Album }
  | { name: 'identity' }
  | { name: 'checkin' }
  | { name: 'settings' }
  /** 设置 → 关于项目 */
  | { name: 'about' }
  | { name: 'account' }
  | { name: 'code-settings' }
  | { name: 'image-host' }
  | { name: 'topic-filter' }
  /** 设置 → 插件列表 */
  | { name: 'plugins' }
  /** 插件页：饼友助手 */
  | { name: 'helper' }
  | { name: 'my'; kind: 'topics' | 'replies' | 'saved' }
  | { name: 'user'; member: Member }
  | { name: 'menu' }
  | { name: 'inbox' }
  | { name: 'dm'; userId: string; title?: string }
  | { name: 'report'; targetType: 'reply' | 'topic'; targetId: string; targetUser?: string; topicTitle?: string }
  | { name: 'browser'; url: string; title?: string }
  | { name: 'wallet' };

export type Nav = {
  open: (page: Extra) => void;
  close: () => void;
  openForum: (forum: string) => void;
  openTab: (tab: 'home' | 'forums' | 'compose' | 'messages' | 'profile') => void;
  openHomeSort: (sort: string) => void;
  openUser: (id: string) => void;
  openBrowser: (url: string, title?: string) => void;
  /**
   * 强制用内置浏览器打开：站内地址也不转成 App 页面。
   * 主题页右上角的「网页访问」用它 —— 那个按钮就是要看官网原页面，
   * 若走 openBrowser 会被识别成 /topic/<id> 而推一个一模一样的 App 页面（看起来像按钮坏了）。
   */
  openWeb: (url: string, title?: string) => void;
  completeAuth: (member: Member) => void;
  me: Member;
  loggedIn: boolean;
  /** 本地会话是否已经恢复：false 时登录态还未知，界面不要显示「登录后查看」这类结论。 */
  sessionReady: boolean;
  signIn: (input: { username?: string; password?: string; provider?: 'github' | 'google'; captchaToken?: string; oauthCookies?: string }) => Promise<void>;
  signUp: (input: { username: string; password: string; email: string; emailCode: string; captchaToken: string }) => Promise<void>;
  signOut: () => Promise<void>;
  checkedIn: boolean;
  checkIn: () => Promise<number>;
  toast: (message: string) => void;
  refreshMe: (balance?: number) => Promise<void>;
  patchMe: (patch: Partial<Member>) => void;
  unread: number;
  setUnread: (count: number) => void;
};

export const NavCtx = createContext<Nav | null>(null);
export function useNav() {
  const nav = useContext(NavCtx);
  if (!nav) throw new Error('Nav missing');
  return nav;
}

export function useAppInsets() {
  const insets = useSafeAreaInsets();
  const androidTop = RNStatusBar.currentHeight && RNStatusBar.currentHeight > 0 ? RNStatusBar.currentHeight : 44;
  const top = Platform.OS === 'android' ? Math.max(insets.top, androidTop) : insets.top;
  // 只做很小的兜底：真实导航栏高度交给系统 inset，避免手势导航机型底部空一大块。
  const bottom = Platform.OS === 'android' ? Math.max(insets.bottom, 8) : insets.bottom;
  return { top, bottom };
}

/** 标题栏高度 48 + 状态栏，让渐变/头图铺到屏幕顶。 */
export function chromePad(top: number, base = 48) {
  return { height: base + top, paddingTop: top };
}

export function useAndroidBack(enabled: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (Platform.OS === 'web' || !enabled) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, [enabled]);
}

/**
 * 只有 id / 标题的占位主题。
 *
 * 详情页拿到 id 后会重新抓完整数据，所以从「链接」或「每日热帖」这种
 * 只知道 id + 标题的地方进详情页时，用它拼一个占位对象即可。
 */
export function stubTopic(id: string, title: string, replies = 0, forum = '综合'): Topic {
  return { id, title, author: '', forum, time: '', replies, avatar: '?', accent: C.blue };
}

export function openAppHref(nav: Nav, href: string, forum = '综合') {
  const action = classifyAppHref(href);
  if (action.type === 'ignore') return;
  if (action.type === 'topic') {
    nav.open({
      name: 'topic',
      topic: stubTopic(action.id, href, 0, forum),
      replyId: action.replyId,
      floor: action.floor,
    });
    return;
  }
  if (action.type === 'user') {
    nav.openUser(action.id);
    return;
  }
  if (action.type === 'login') {
    nav.open({ name: 'login' });
    return;
  }
  if (action.type === 'register') {
    nav.open({ name: 'register' });
    return;
  }
  if (action.type === 'home') {
    nav.openHomeSort(action.sort);
    return;
  }
  if (action.type === 'wallet') {
    nav.open({ name: 'wallet' });
    return;
  }
  nav.openBrowser(action.url);
}
