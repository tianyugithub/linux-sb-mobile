import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Platform, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Screen, ScreenStack, ScreenStackHeaderConfig, enableScreens } from 'react-native-screens';
import { guest, type Member, type Topic } from './data';
import { InAppBrowser } from './src/components/InAppBrowser';
import { Icon, ToastHost, ConfirmDialog, pickUserId, type DialogState } from './src/components/ui';
import { NavCtx, STACK_PUSH_ANIMATION, TAB_SWITCH_FADE_MS, openAppHref, stubMember, useAppInsets, type Extra, type Nav } from './src/navigation/nav';
import { PrefsProvider, usePrefs } from './src/hooks/usePrefs';
import { applyScheme, C } from './src/theme/palette';
import { styles } from './src/theme/app-styles';
import { api, mapUser } from './src/services/api';
import { ApiError } from './src/services/client';
import { getAccessToken, hydrateSession, markSignedOut, sessionGeneration, sessionIsLive } from './src/services/session';
import { pollAndNotify, rememberUnread, setPushHooks, startPushRuntime } from './src/services/push';
import { sessionForToken, updateUpstreamUser } from './src/services/site-session';
import { cacheClear, cacheDelete, cacheGet, preloadQueryCache } from './src/services/query-cache';
import { resetOfficialUploadCapability } from './src/services/r2-config';
import { bustUnreadCount } from './src/services/live';
import { classifyAppHref, resolveAppHref } from './src/utils/links';
import { githubBrowseUrl } from './src/utils/github-access';
import { viaAccess } from './src/utils/linux-access';
import { checkForUpdate, updatePromptText } from './src/services/app-update';
import { downloadAndInstallUpdate, rememberSkippedUpdate, wasUpdateSkipped } from './src/services/app-install';
import { installCrashLog } from './src/services/crash-log';
import { hydrateTopicSeen } from './src/utils/topic-seen';
import { AuthScreen } from './src/screens/AuthScreen';
import { CheckinScreen } from './src/screens/CheckinScreen';
import { CollectionsScreen, CollectionDetail } from './src/screens/CollectionsScreen';
import { ComposeScreen } from './src/screens/ComposeScreen';
import { DirectMessageScreen } from './src/screens/DirectMessageScreen';
import { EditCommentScreen } from './src/screens/EditCommentScreen';
import { ForumFeed } from './src/screens/ForumFeed';
import { ForumsScreen } from './src/screens/ForumsScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { IdentityScreen } from './src/screens/IdentityScreen';
import { InviteScreen } from './src/screens/InviteScreen';
import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
import { MenuScreen } from './src/screens/MenuScreen';
import { InboxScreen, MessagesScreen } from './src/screens/MessagesScreen';
import { MyListScreen } from './src/screens/MyListScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ReportScreen } from './src/screens/ReportScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { CodeSettingsScreen } from './src/screens/CodeSettingsScreen';
import { ImageHostSettingsScreen } from './src/screens/ImageHostSettingsScreen';
import { AccountScreen } from './src/screens/AccountScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { AboutScreen } from './src/screens/AboutScreen';
import { TitlesScreen } from './src/screens/TitlesScreen';
import { TopicFilterScreen } from './src/screens/TopicFilterScreen';
import { PluginListScreen } from './src/screens/PluginListScreen';
import { HelperScreen } from './src/screens/helper/HelperScreen';
import { TopicDetailScreen } from './src/screens/TopicDetailScreen';
import { UserScreen } from './src/screens/UserScreen';
import { WalletScreen } from './src/screens/WalletScreen';

enableScreens();

function extraPageKey(extra: Extra | null | undefined): string {
  if (!extra) return '';
  if (extra.name === 'topic') return `topic:${extra.topic.id}`;
  if (extra.name === 'user') return `user:${String(extra.member.id || extra.member.uid || extra.member.name)}`;
  if (extra.name === 'dm') return `dm:${extra.userId}`;
  if (extra.name === 'browser') return `browser:${extra.url}`;
  if (extra.name === 'edit-comment') return `edit-comment:${extra.comment.id}`;
  if (extra.name === 'edit-topic') return `edit-topic:${extra.topic.id}`;
  if (extra.name === 'collection') return `collection:${extra.album.id}`;
  if (extra.name === 'my') return `my:${extra.kind}`;
  return extra.name;
}

/** 原生栈的一页：系统做进出动画，JS 不再位移整页（位移会顶偏评论区 WebView）。 */
function AppStackScreen({
  screenId,
  animation,
  children,
  onDismissed,
}: {
  screenId?: string;
  animation?: typeof STACK_PUSH_ANIMATION;
  children: React.ReactNode;
  onDismissed?: (event: { nativeEvent: { dismissCount: number } }) => void;
}) {
  return (
    <Screen
      screenId={screenId}
      enabled
      isNativeStack
      style={styles.stackLayer}
      stackAnimation={animation ? (Platform.OS === 'android' ? 'slide_from_right' : animation) : undefined}
      stackPresentation="push"
      replaceAnimation="push"
      freezeOnBlur={false}
      gestureEnabled={false}
      nativeBackButtonDismissalEnabled={false}
      onDismissed={onDismissed}
    >
      {children}
      <ScreenStackHeaderConfig hidden />
    </Screen>
  );
}

/** 登录 / 注册 / 退出时清掉查询缓存与未读记忆，避免串号显示上一个账号的数据。 */
function resetAccountCaches() {
  cacheClear();
  bustUnreadCount();
  resetOfficialUploadCapability();
}

/** JS 启动时刻 + 冷启动静默窗口：这期间到达的通知点击不跳页，保证「打开 App 先看到首页」。 */
const JS_START_AT = Date.now();
const LAUNCH_NAV_GUARD_MS = 1500;

/**
 * Toast 里的用户名要截断：站内有 40 多个字的用户名（实测，
 * 「九天揽明月五洋缚蛟龙…」那种），整串弹出来会占满整屏。
 */
function toastName(name: string): string {
  const text = (name || '').trim();
  return text.length > 10 ? `${text.slice(0, 10)}…` : text;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PrefsProvider>
        <ThemedRoot />
      </PrefsProvider>
    </SafeAreaProvider>
  );
}

function ThemedRoot() {
  const { scheme, prefsReady } = usePrefs();
  applyScheme(scheme);
  if (!prefsReady) return null;
  return <AppRoot key={scheme} />;
}

function AppRoot() {
  const insets = useAppInsets();
  const { scheme } = usePrefs();
  const [tab, setTab] = useState<'home' | 'forums' | 'compose' | 'messages' | 'profile'>('home');
  /** 进过的主 Tab 不再卸载：切走保留滚动位置与页面状态，回来直接显示（首次进才挂载，冷启动不加压）。 */
  const [visitedTabs, setVisitedTabs] = useState<typeof tab[]>(['home']);
  /** Tab 切换淡入：只做合成器透明度（160–220ms），无位移，不触发布局、不顶偏 WebView。 */
  const tabFade = useRef(new Animated.Value(1)).current;
  const tabFadePending = useRef(false);
  const [stack, setStack] = useState<Extra[]>([]);
  const [openForum, setOpenForum] = useState<string | null>(null);
  const [homeJump, setHomeJump] = useState<{ sort: string; nonce: number } | null>(null);
  const [me, setMe] = useState<Member>(guest);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [updateDialog, setUpdateDialog] = useState<DialogState | null>(null);
  const updateTagRef = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 启动流程（本地会话恢复）是否已完成：完成前不接受通知带来的页面跳转，保证冷启动先落首页。 */
  const bootedRef = useRef(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const extra = stack[stack.length - 1] ?? null;
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const stackKeys = useRef(new WeakMap<Extra, string>());
  const stackKeySeq = useRef(0);
  const keyForPage = (page: Extra) => {
    const existing = stackKeys.current.get(page);
    if (existing) return existing;
    const next = `${extraPageKey(page)}#${stackKeySeq.current++}`;
    stackKeys.current.set(page, next);
    return next;
  };
  const closeStack = useCallback(() => {
    setStack((current) => (current.length ? current.slice(0, -1) : current));
  }, []);
  const resetStack = useCallback(() => {
    setStack([]);
  }, []);
  const commitStack = useCallback((update: (current: Extra[]) => Extra[]) => {
    setStack((current) => {
      const next = update(current);
      return next === current ? current : next;
    });
  }, []);
  const forumRef = useRef(openForum);
  forumRef.current = openForum;
  const lastBackAt = useRef(0);
  const showToastRef = useRef<(message: string) => void>(() => {});

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), Math.min(4200, 2200 + message.length * 18));
  };
  showToastRef.current = showToast;

  useEffect(() => {
    installCrashLog();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stackRef.current.length) {
        closeStack();
        return true;
      }
      if (tabRef.current === 'forums' && forumRef.current) {
        setOpenForum(null);
        return true;
      }
      if (tabRef.current !== 'home') {
        setTab('home');
        setOpenForum(null);
        return true;
      }
      const now = Date.now();
      if (now - lastBackAt.current < 2000) return false;
      lastBackAt.current = now;
      showToastRef.current('再按一次退出应用');
      return true;
    });
    return () => sub.remove();
  }, [closeStack]);

  useEffect(() => {
    /**
     * 冷启动一律落在首页：通知带来的跳转只在「本地会话已恢复 + 过了启动静默窗口」后才执行。
     * 安卓（尤其被 ColorOS 回收后从最近任务恢复）会把上一次点击的通知响应当成启动响应重放，
     * 之前就表现为「每次重开都先进消息页」。
     */
    const pushNavAllowed = () => bootedRef.current && Date.now() - JS_START_AT > LAUNCH_NAV_GUARD_MS;
    setPushHooks({
      openMessages: () => {
        if (!pushNavAllowed()) return;
        resetStack();
        setTab('messages');
      },
      // 私信通知直接进对应会话，拿不到 id 时退回消息列表。
      openDm: (userId, title) => {
        if (!pushNavAllowed()) return;
        const key = pickUserId(userId);
        if (!key) {
          resetStack();
          setTab('messages');
          return;
        }
        commitStack(() => [{ name: 'dm', userId: key, title }]);
      },
      openTopic: (topicId, replyId, title) => {
        if (!pushNavAllowed()) return;
        commitStack(() => [{
          name: 'topic',
          topic: {
            id: topicId,
            title: title || '主题',
            author: '',
            forum: '综合',
            time: '',
            replies: 0,
            avatar: '?',
            accent: C.blue,
          },
          replyId,
        }]);
      },
      setUnread,
      viewingMessages: () => tabRef.current === 'messages' && stackRef.current.length === 0,
    });
    return () => setPushHooks(null);
  }, [commitStack, resetStack]);

  const refreshMe = useCallback(async (balance?: number) => {
    if (!sessionIsLive()) return;
    const gen = sessionGeneration();
    const stillThisSession = () => sessionGeneration() === gen && sessionIsLive();
    cacheDelete('identity:');
    cacheDelete('titles:');
    cacheDelete('notifs:');
    if (balance && balance > 0) {
      setMe((prev) => (prev.points === balance ? prev : { ...prev, points: balance }));
      const token = getAccessToken();
      const session = token ? sessionForToken(token) : null;
      if (token && session) updateUpstreamUser(token, { ...session.user, points: balance });
    }
    try {
      const [user, points, notes] = await Promise.all([
        api.me(),
        api.points().catch(() => null),
        api.notificationUnread().catch(() => null),
      ]);
      if (!stillThisSession()) return;
      setMe((prev) => {
        const mapped = mapUser(user);
        const nextPoints = (points && points.balance > 0)
          ? points.balance
          : (mapped.points > 0 ? mapped.points : (balance && balance > 0 ? balance : prev.points));
        return {
          ...mapped,
          points: nextPoints,
          topicCount: mapped.topicCount || prev.topicCount,
          replyCount: mapped.replyCount || prev.replyCount,
          title: mapped.title && mapped.title !== '饼友' ? mapped.title : (prev.title || mapped.title),
          joined: mapped.joined || prev.joined,
        };
      });
      if (points) setCheckedIn(points.checkedIn);
      if (notes) {
        if (tabRef.current !== 'messages') setUnread(notes.unread);
        void rememberUnread(notes.unread);
      }
      const token = getAccessToken();
      const session = token ? sessionForToken(token) : null;
      if (token && session) {
        const livePoints = (points && points.balance > 0) ? points.balance : (user.points || session.user.points);
        updateUpstreamUser(token, { ...session.user, ...user, points: livePoints });
      }
    } catch (error) {
      if (!stillThisSession()) return;
      // 上游会话真的失效了（两页都确认游客）：本地快照不能让人以为还登着
      if (error instanceof ApiError && error.status === 401) {
        if (!sessionForToken(getAccessToken())) setMe(guest);
        return;
      }
      /* 其余情况保留当前快照 */
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && getAccessToken()) void refreshMe();
    });
    return () => sub.remove();
  }, [refreshMe]);

  useEffect(() => {
    if (extra || !getAccessToken()) return;
    if (tab === 'profile') void refreshMe();
  }, [tab, extra, refreshMe]);

  useEffect(() => {
    if (me.id === '0') return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        await pollAndNotify(false);
      } catch {
        /* keep current badge */
      }
    };
    void tick();
    const id = setInterval(() => { void tick(); }, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [me.id]);

  useEffect(() => {
    let cancelled = false;
    let booted = false;
    /** 本地会话恢复完就算启动完成：此后到达的通知点击才允许跳页，冷启动一律留在首页。 */
    const finishBoot = () => {
      if (cancelled || booted) return;
      booted = true;
      setSessionReady(true);
      bootedRef.current = true;
    };
    /**
     * 兜底：恢复会话本身要是卡住（SecureStore / 原生模块偶发不回调），
     * 也不能让「未完成启动」一直挂着 —— 消息页、私信页的骨架与「同步中…」都看这个标记。
     * 游客态尤其明显：他们本来就没有会话可恢复，没有任何理由等。
     */
    const watchdog = setTimeout(finishBoot, 2500);
    (async () => {
      try {
        preloadQueryCache();
        await hydrateTopicSeen();
        await hydrateSession();
        void startPushRuntime();
        const token = getAccessToken();
        const session = token ? sessionForToken(token) : null;
        /**
         * 本地会话里就存着上次的用户信息：先立刻进入登录态。
         * 以前要等 refreshMe() 把 /users/me + 积分页 + 未读数都跑完才 setMe，
         * 那几百毫秒里界面是「未登录」，于是每次重开都会先闪一下「登录后查看通知 / 去登录」。
         */
        if (cancelled) return;
        setMe(session ? mapUser(session.user) : guest);
        finishBoot();
        if (session) await refreshMe();
      } catch {
        // 恢复本地会话本身失败才算游客；refreshMe 之后的失败不影响登录态
        if (!booted && !cancelled) setMe(guest);
        finishBoot();
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, [refreshMe]);

  useEffect(() => {
    if (!sessionReady || Platform.OS !== 'android') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const next = await checkForUpdate();
        if (cancelled || next.status !== 'available' || !next.apkUrl) return;
        if (await wasUpdateSkipped(next.latest)) return;
        if (cancelled) return;
        updateTagRef.current = next.latest;
        setUpdateDialog({
          title: `发现新版本 v${next.latest.replace(/^[vV]/, '')}`,
          text: updatePromptText(next),
          confirmLabel: '下载安装',
          onConfirm: async () => {
            try {
              await downloadAndInstallUpdate(next, (message) => showToastRef.current(message), {
                onProgress: (hint) => {
                  setUpdateDialog((cur) => (cur ? { ...cur, busyLabel: hint } : cur));
                },
                onBeforeInstall: () => setUpdateDialog(null),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : '下载失败';
              if (message !== 'NEED_PERMISSION') showToastRef.current(message);
              throw err;
            }
          },
        });
      })();
    }, 1800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionReady]);

  const nav = useMemo<Nav>(() => {
    const next: Nav = {
    open: (page) => commitStack((current) => {
      const last = current[current.length - 1];
      if (last?.name === 'menu' && page.name !== 'menu') return [...current.slice(0, -1), page];
      if ((last?.name === 'login' || last?.name === 'register') && (page.name === 'login' || page.name === 'register')) {
        return [...current.slice(0, -1), page];
      }
      if (last?.name === 'titles' && page.name === 'titles') {
        const lastTab = last.tab ?? '称号抽取';
        const nextTab = page.tab ?? '称号抽取';
        if (lastTab === nextTab) return current;
        return [...current.slice(0, -1), page];
      }
      if (last?.name === 'wallet' && page.name === 'wallet') return current;
      return [...current, page];
    }),
    close: () => closeStack(),
    openForum: (forum) => {
      resetStack();
      setTab('forums');
      setOpenForum(forum);
    },
    openTab: (key) => {
      resetStack();
      setTab(key);
    },
    openHomeSort: (sort) => {
      setHomeJump({ sort, nonce: Date.now() });
      resetStack();
      setTab('home');
      setOpenForum(null);
    },
    openUser: (id, preview) => {
      const key = pickUserId(id, preview?.uid);
      if (!key) {
        showToast('无法打开该用户');
        return;
      }
      const cached = cacheGet<Member>(`user:${key}`);
      const member = cached ?? stubMember(key, preview);
      commitStack((current) => {
        const last = current[current.length - 1];
        if (last?.name === 'user' && (last.member.id === member.id || last.member.uid === member.uid || last.member.id === key)) {
          return current;
        }
        return [...current, { name: 'user', member }];
      });
    },
    openWeb: (url, title) => {
      const abs = viaAccess(githubBrowseUrl(resolveAppHref(url) ?? url));
      commitStack((current) => {
        const last = current[current.length - 1];
        if (last?.name === 'browser' && last.url === abs) return current;
        return [...current, { name: 'browser', url: abs, title }];
      });
    },
    openBrowser: (url, title) => {
      const action = classifyAppHref(url);
      if (action.type !== 'browser' && action.type !== 'ignore') {
        openAppHref(next, url);
        return;
      }
      const abs = viaAccess(githubBrowseUrl(action.type === 'browser' ? action.url : (resolveAppHref(url) ?? url)));
      commitStack((current) => {
        const last = current[current.length - 1];
        if (last?.name === 'browser' && last.url === abs) return current;
        return [...current, { name: 'browser', url: abs, title }];
      });
    },
    completeAuth: (member) => {
      setMe(member);
      resetAccountCaches();
      resetStack();
      setTab('profile');
      api.notificationUnread().then((result) => {
        setUnread(result.unread);
        void rememberUnread(result.unread);
      }).catch(() => setUnread(0));
      api.points().then((result) => setCheckedIn(result.checkedIn)).catch(() => {});
    },
    me,
    loggedIn: me.id !== '0' && sessionIsLive(),
    sessionReady,
    signIn: async (input) => {
      const session = await api.login(input);
      setMe(mapUser(session.user));
      resetAccountCaches();
      resetStack();
      setTab('profile');
      /*
       * 登录成功后必须给一句反馈：以前这里只是静默切到「我的」，
       * 用户点完「登录」看不出到底成没成（尤其是网络慢、界面没变化的那一两秒）。
       * 积分/未读数在后台补，提示先弹 —— 别让提示等这两个请求。
       */
      showToast(`登录成功，欢迎回来 ${toastName(session.user.name)}`.trim());
      try {
        const points = await api.points();
        setCheckedIn(points.checkedIn);
      } catch {
        /* ignore */
      }
      try {
        const notes = await api.notificationUnread();
        setUnread(notes.unread);
        void rememberUnread(notes.unread);
      } catch {
        setUnread(0);
      }
    },
    signUp: async (input) => {
      const session = await api.register(input);
      setMe(mapUser(session.user));
      resetAccountCaches();
      resetStack();
      setTab('profile');
      showToast(`注册成功，已自动登录 ${toastName(session.user.name)}`.trim());
      try {
        const points = await api.points();
        setCheckedIn(points.checkedIn);
      } catch {
        /* ignore */
      }
      try {
        const notes = await api.notificationUnread();
        setUnread(notes.unread);
        void rememberUnread(notes.unread);
      } catch {
        setUnread(0);
      }
    },
    signOut: async () => {
      markSignedOut();
      setMe(guest);
      resetAccountCaches();
      setCheckedIn(false);
      setUnread(0);
      void rememberUnread(0);
      resetStack();
      // 与登录对称：退出也要有反馈，否则界面只是「变回访客」，用户不确定退没退成
      showToast('已退出登录');
      try {
        await api.logout();
      } catch {
        /* 本地已经按游客显示，官网退出失败不挡 */
      }
    },
    checkedIn,
    checkIn: async () => {
      const result = await api.checkin();
      setCheckedIn(true);
      setMe((prev) => ({ ...prev, points: result.balance || prev.points }));
      const token = getAccessToken();
      const session = token ? sessionForToken(token) : null;
      if (token && session && result.balance > 0) {
        updateUpstreamUser(token, { ...session.user, points: result.balance });
      }
      return result.gain;
    },
    toast: showToast,
    refreshMe,
    patchMe: (patch) => {
      setMe((prev) => ({ ...prev, ...patch }));
      const token = getAccessToken();
      const session = token ? sessionForToken(token) : null;
      if (token && session) {
        updateUpstreamUser(token, {
          ...session.user,
          points: patch.points ?? session.user.points,
          title: patch.title ?? session.user.title,
          topicCount: patch.topicCount ?? session.user.topicCount,
          replyCount: patch.replyCount ?? session.user.replyCount,
        });
      }
    },
    unread,
    setUnread,
    };
    return next;
    /*
     * sessionReady 必须在依赖里：它只喂 nav 的同名字段。
     *
     * 踩过的坑：游客态启动时 me 本来就是模块常量 `guest`，`setMe(guest)` 是同一个引用，
     * React 直接 bail out；这一轮**唯一**变化的状态就是 setSessionReady(true)。
     * 少了这个依赖，nav 就不会重算，nav.sessionReady 永远停在 false ——
     * 消息页 / 私信页于是永远显示「同步中…」+ 骨架，游客等不到「登录后查看」。
     * 登录用户碰巧不出问题：refreshMe 会改 me，顺带把整个 memo 重算了一遍，所以只坑游客。
     */
  }, [me, checkedIn, unread, refreshMe, sessionReady, commitStack, closeStack, resetStack]);

  const switchTab = (key: typeof tab) => {
    const same = key === tab;
    resetStack();
    if (key === 'forums' && tab === 'forums') setOpenForum(null);
    if (key !== 'forums') setOpenForum(null);
    // 点当前 Tab 只回根（上面已做），不重播淡入、不重复导航。
    if (same) return;
    setVisitedTabs((seen) => (seen.includes(key) ? seen : [...seen, key]));
    tabFade.stopAnimation();
    tabFade.setValue(0);
    tabFadePending.current = true;
    setTab(key);
  };

  useLayoutEffect(() => {
    if (!tabFadePending.current) return;
    tabFadePending.current = false;
    // 必须等 setTab 提交完再淡入：同一拍里 start() 会把还没卸掉的旧页淡进来，
    // 用户看到的就是「闪一下之前的页面」。
    Animated.timing(tabFade, { toValue: 1, duration: TAB_SWITCH_FADE_MS, useNativeDriver: true }).start();
  }, [tab, tabFade]);

  const openTopic = useCallback((topic: Topic, opts?: { latest?: boolean }) => {
    commitStack((current) => [...current, { name: 'topic', topic, latest: Boolean(opts?.latest) }]);
  }, [commitStack]);

  /** 主 Tab 内容：命名用小写 helper 而不是组件，避免被当成条件挂载的 Screen。 */
  const renderTabPage = (key: typeof tab) => {
    if (key === 'home') {
      return <HomeScreen jumpSort={homeJump} onJumpApplied={() => setHomeJump(null)} onTopic={openTopic} onSearch={() => commitStack(() => [{ name: 'search' }])} onProfile={() => switchTab('profile')} />;
    }
    if (key === 'compose') return <ComposeScreen onBack={() => switchTab('home')} />;
    if (key === 'profile') return <ProfileScreen />;
    if (key === 'forums') {
      return openForum
        ? <ForumFeed forum={openForum} onTopic={openTopic} onBack={() => setOpenForum(null)} />
        : <ForumsScreen onOpenForum={setOpenForum} onSearch={() => commitStack(() => [{ name: 'search' }])} />;
    }
    return <MessagesScreen />;
  };

  const renderStackPage = (page: Extra): React.ReactNode => {
    if (page.name === 'topic') {
      return (
        <TopicDetailScreen
          topic={page.topic}
          latest={page.latest}
          replyId={page.replyId}
          floor={page.floor}
          editedComment={page.editedComment}
          onBack={closeStack}
        />
      );
    }
    if (page.name === 'edit-topic') {
      return (
        <ComposeScreen
          edit={page.topic}
          onBack={closeStack}
          onSaved={(topic) => {
            cacheDelete(`topic:${topic.id}:`);
            setStack((current) => {
              const withoutEdit = current.slice(0, -1);
              const last = withoutEdit[withoutEdit.length - 1];
              if (last?.name === 'topic') {
                return [...withoutEdit.slice(0, -1), { ...last, topic: { ...last.topic, ...topic } }];
              }
              return withoutEdit;
            });
          }}
        />
      );
    }
    if (page.name === 'edit-comment') {
      return (
        <EditCommentScreen
          topic={page.topic}
          comment={page.comment}
          onBack={closeStack}
          onSaved={(saved) => {
            cacheDelete(`comments:${page.topic.id}:`);
            cacheDelete(`topic:${page.topic.id}:`);
            setStack((current) => {
              const withoutEdit = current.slice(0, -1);
              const last = withoutEdit[withoutEdit.length - 1];
              if (last?.name === 'topic') {
                return [...withoutEdit.slice(0, -1), { ...last, editedComment: saved }];
              }
              return withoutEdit;
            });
          }}
        />
      );
    }
    if (page.name === 'login') return <AuthScreen mode="login" />;
    if (page.name === 'register') return <AuthScreen mode="register" />;
    if (page.name === 'search') return <SearchScreen />;
    if (page.name === 'leaderboard') return <LeaderboardScreen />;
    if (page.name === 'invite') return <InviteScreen />;
    if (page.name === 'wallet') return <WalletScreen />;
    if (page.name === 'titles') return <TitlesScreen initialTab={page.tab ?? '称号抽取'} />;
    if (page.name === 'collections') return <CollectionsScreen initialTab={page.tab === 'mine' ? '我的淘帖' : '大家的淘帖'} />;
    if (page.name === 'collection') return <CollectionDetail album={page.album} />;
    if (page.name === 'identity') return <IdentityScreen />;
    if (page.name === 'checkin') return <CheckinScreen />;
    if (page.name === 'settings') return <SettingsScreen />;
    if (page.name === 'about') return <AboutScreen />;
    if (page.name === 'account') return <AccountScreen />;
    if (page.name === 'code-settings') return <CodeSettingsScreen />;
    if (page.name === 'image-host') return <ImageHostSettingsScreen />;
    if (page.name === 'topic-filter') return <TopicFilterScreen />;
    if (page.name === 'plugins') return <PluginListScreen />;
    if (page.name === 'helper') return <HelperScreen />;
    if (page.name === 'my') return <MyListScreen kind={page.kind} />;
    if (page.name === 'user') return <UserScreen member={page.member} />;
    if (page.name === 'menu') return <MenuScreen />;
    if (page.name === 'inbox') return <InboxScreen />;
    if (page.name === 'dm') return <DirectMessageScreen userId={page.userId} title={page.title} />;
    if (page.name === 'report') {
      return (
        <ReportScreen
          targetType={page.targetType}
          targetId={page.targetId}
          targetUser={page.targetUser}
          topicTitle={page.topicTitle}
        />
      );
    }
    if (page.name === 'browser') {
      return (
        <InAppBrowser
          url={page.url}
          title={page.title}
          onClose={() => {
            closeStack();
            if (getAccessToken()) void refreshMe();
          }}
          onToast={showToast}
          onAppHref={(href) => openAppHref(nav, href)}
        />
      );
    }
    return null;
  };

  const tabBarOnRoot = tab !== 'compose';
  const lightChrome = scheme === 'light';
  const tabBarPad = Math.max(insets.bottom, 8);
  const toastOffset = 16 + (!extra && tabBarOnRoot ? 52 + tabBarPad : 56 + insets.bottom);
  const tabBar = tabBarOnRoot ? (
    <View style={[styles.tabbar, { paddingBottom: tabBarPad }]}>
      {([
        { key: 'home', icon: 'home-outline', iconActive: 'home', label: '首页' },
        { key: 'forums', icon: 'grid-outline', iconActive: 'grid', label: '版块' },
        { key: 'compose', icon: 'add', iconActive: 'add', label: '发布' },
        { key: 'messages', icon: 'chatbubble-outline', iconActive: 'chatbubble', label: '消息' },
        { key: 'profile', icon: 'person-outline', iconActive: 'person', label: '我的' },
      ] as const).map((item) => {
        const active = tab === item.key;
        return (
          <Pressable key={item.key} onPress={() => switchTab(item.key)} style={styles.tabItem}>
            <View style={[styles.tabIconWrap, item.key === 'compose' && styles.composeTab]}>
              <Icon name={active ? item.iconActive : item.icon} size={item.key === 'compose' ? 22 : 20} color={item.key === 'compose' ? '#fff' : active ? C.redBright : C.muted} />
            </View>
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
            {item.key === 'messages' && unread > 0 ? (
              <View style={styles.tabCountBadge}>
                <Text style={styles.tabCountText}>{unread > 99 ? '99+' : String(unread)}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  ) : null;

  const content = (
    <ScreenStack style={styles.flex}>
      <AppStackScreen>
        <View style={styles.flex} collapsable={false}>
          <Animated.View style={[styles.flex, styles.tabStage, { opacity: tabFade }]}>
            {(['home', 'forums', 'compose', 'messages', 'profile'] as const).map((key) => (
              // 兜底 `key === tab`：nav 直调 setTab 时也能画出来，永远不给空白页。
              key === tab || visitedTabs.includes(key) ? (
                <View
                  key={key}
                  pointerEvents={key === tab ? 'auto' : 'none'}
                  style={key === tab ? [styles.flex, styles.tabPageActive] : styles.hiddenScreen}
                >
                  {renderTabPage(key)}
                </View>
              ) : null
            ))}
          </Animated.View>
          {tabBar}
        </View>
      </AppStackScreen>
      {stack.map((page) => {
        const id = keyForPage(page);
        const needsBottomGap = page.name !== 'topic' && page.name !== 'dm';
        return (
          <AppStackScreen
            key={id}
            screenId={id}
            animation={STACK_PUSH_ANIMATION}
            onDismissed={(event) => {
              const count = Math.max(1, event.nativeEvent.dismissCount || 1);
              setStack((current) => {
                const idx = current.lastIndexOf(page);
                if (idx < 0) return current;
                return current.slice(0, Math.max(0, idx - count + 1));
              });
            }}
          >
            <View style={styles.flex} collapsable={false}>
              <View style={styles.flex}>{renderStackPage(page)}</View>
              {needsBottomGap ? <View style={{ height: insets.bottom, backgroundColor: C.canvas }} /> : null}
            </View>
          </AppStackScreen>
        );
      })}
    </ScreenStack>
  );

  const app = (
    <NavCtx.Provider value={nav}>
      <View style={styles.safe}>
        <StatusBar style={lightChrome ? 'dark' : 'light'} translucent />
        <View style={styles.flex}>{content}</View>
        <ToastHost message={toast} offset={toastOffset} />
        <ConfirmDialog
          dialog={updateDialog}
          onClose={() => {
            const tag = updateTagRef.current;
            setUpdateDialog(null);
            if (tag) void rememberSkippedUpdate(tag);
          }}
        />
      </View>
    </NavCtx.Provider>
  );
  if (Platform.OS !== 'web') return app;
  return <View style={styles.webStage}><View style={styles.phoneShell}>{app}</View></View>;
}
