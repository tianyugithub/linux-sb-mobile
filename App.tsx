import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { guest, type Member, type Topic } from './data';
import { InAppBrowser } from './src/components/InAppBrowser';
import { Icon, ToastHost, ConfirmDialog, pickUserId, type DialogState } from './src/components/ui';
import { NavCtx, openAppHref, useAppInsets, type Extra, type Nav } from './src/navigation/nav';
import { PrefsProvider, usePrefs } from './src/hooks/usePrefs';
import { applyScheme, C } from './src/theme/palette';
import { styles } from './src/theme/app-styles';
import { api, mapUser } from './src/services/api';
import { ApiError } from './src/services/client';
import { getAccessToken, hydrateSession, markSignedOut } from './src/services/session';
import { pollAndNotify, rememberUnread, setPushHooks, startPushRuntime } from './src/services/push';
import { sessionForToken, updateUpstreamUser } from './src/services/site-session';
import { cacheClear, cacheDelete, preloadQueryCache } from './src/services/query-cache';
import { resetOfficialUploadCapability } from './src/services/r2-config';
import { bustUnreadCount } from './src/services/live';
import { classifyAppHref, resolveAppHref } from './src/utils/links';
import { githubBrowseUrl } from './src/utils/github-access';
import { viaAccess } from './src/utils/linux-access';
import { checkForUpdate, updatePromptText } from './src/services/app-update';
import { downloadAndInstallUpdate, rememberSkippedUpdate, wasUpdateSkipped } from './src/services/app-install';
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
    if (Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stackRef.current.length) {
        setStack((current) => current.slice(0, -1));
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
  }, []);

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
        setStack([]);
        setTab('messages');
      },
      // 私信通知直接进对应会话，拿不到 id 时退回消息列表。
      openDm: (userId, title) => {
        if (!pushNavAllowed()) return;
        const key = pickUserId(userId);
        if (!key) {
          setStack([]);
          setTab('messages');
          return;
        }
        setStack([{ name: 'dm', userId: key, title }]);
      },
      openTopic: (topicId, replyId, title) => {
        if (!pushNavAllowed()) return;
        setStack([{
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
  }, []);

  const refreshMe = useCallback(async (balance?: number) => {
    if (!getAccessToken()) return;
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
              await downloadAndInstallUpdate(next, (message) => showToastRef.current(message));
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
    open: (page) => setStack((current) => {
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
    close: () => setStack((current) => current.slice(0, -1)),
    openForum: (forum) => {
      setStack([]);
      setTab('forums');
      setOpenForum(forum);
    },
    openTab: (key) => {
      setStack([]);
      setTab(key);
    },
    openHomeSort: (sort) => {
      setHomeJump({ sort, nonce: Date.now() });
      setStack([]);
      setTab('home');
      setOpenForum(null);
    },
    openUser: (id) => {
      const key = pickUserId(id);
      if (!key) {
        showToast('无法打开该用户');
        return;
      }
      api.user(key).then((dto) => {
        setStack((current) => {
          const last = current[current.length - 1];
          if (last?.name === 'user' && (last.member.id === dto.id || last.member.uid === dto.uid)) return current;
          return [...current, { name: 'user', member: mapUser(dto) }];
        });
      }).catch((err) => {
        showToast(err instanceof ApiError ? err.message : '无法打开用户主页');
      });
    },
    openWeb: (url, title) => {
      const abs = viaAccess(githubBrowseUrl(resolveAppHref(url) ?? url));
      setStack((current) => {
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
      setStack((current) => {
        const last = current[current.length - 1];
        if (last?.name === 'browser' && last.url === abs) return current;
        return [...current, { name: 'browser', url: abs, title }];
      });
    },
    completeAuth: (member) => {
      setMe(member);
      resetAccountCaches();
      setStack([]);
      setTab('profile');
      api.notificationUnread().then((result) => {
        setUnread(result.unread);
        void rememberUnread(result.unread);
      }).catch(() => setUnread(0));
      api.points().then((result) => setCheckedIn(result.checkedIn)).catch(() => {});
    },
    me,
    loggedIn: me.id !== '0',
    sessionReady,
    signIn: async (input) => {
      const session = await api.login(input);
      setMe(mapUser(session.user));
      resetAccountCaches();
      setStack([]);
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
      setStack([]);
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
      setStack([]);
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
  }, [me, checkedIn, unread, refreshMe, sessionReady]);

  const switchTab = (key: typeof tab) => {
    setStack([]);
    if (key === 'forums' && tab === 'forums') setOpenForum(null);
    if (key !== 'forums') setOpenForum(null);
    setTab(key);
  };

  const openTopic = (topic: Topic, opts?: { latest?: boolean }) => setStack((current) => [...current, { name: 'topic', topic, latest: Boolean(opts?.latest) }]);

  let extraView: React.ReactNode = null;
  if (extra?.name === 'topic') extraView = <TopicDetailScreen key={`${extra.topic.id}:${extra.replyId || extra.floor || ''}`} topic={extra.topic} latest={extra.latest} replyId={extra.replyId} floor={extra.floor} editedComment={extra.editedComment} onBack={() => setStack((current) => current.slice(0, -1))} />;
  else if (extra?.name === 'edit-topic') extraView = (
    <ComposeScreen
      edit={extra.topic}
      onBack={() => setStack((current) => current.slice(0, -1))}
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
  else if (extra?.name === 'edit-comment') extraView = (
    <EditCommentScreen
      topic={extra.topic}
      comment={extra.comment}
      onBack={() => setStack((current) => current.slice(0, -1))}
      onSaved={(saved) => {
        cacheDelete(`comments:${extra.topic.id}:`);
        cacheDelete(`topic:${extra.topic.id}:`);
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
  else if (extra?.name === 'login') extraView = <AuthScreen mode="login" />;
  else if (extra?.name === 'register') extraView = <AuthScreen mode="register" />;
  else if (extra?.name === 'search') extraView = <SearchScreen />;
  else if (extra?.name === 'leaderboard') extraView = <LeaderboardScreen />;
  else if (extra?.name === 'invite') extraView = <InviteScreen />;
  else if (extra?.name === 'wallet') extraView = <WalletScreen />;
  else if (extra?.name === 'titles') extraView = <TitlesScreen initialTab={extra.tab ?? '称号抽取'} />;
  else if (extra?.name === 'collections') extraView = <CollectionsScreen initialTab={extra.tab === 'mine' ? '我的淘帖' : '大家的淘帖'} />;
  else if (extra?.name === 'collection') extraView = <CollectionDetail album={extra.album} />;
  else if (extra?.name === 'identity') extraView = <IdentityScreen />;
  else if (extra?.name === 'checkin') extraView = <CheckinScreen />;
  else if (extra?.name === 'settings') extraView = <SettingsScreen />;
  else if (extra?.name === 'about') extraView = <AboutScreen />;
  else if (extra?.name === 'account') extraView = <AccountScreen />;
  else if (extra?.name === 'code-settings') extraView = <CodeSettingsScreen />;
  else if (extra?.name === 'image-host') extraView = <ImageHostSettingsScreen />;
  else if (extra?.name === 'topic-filter') extraView = <TopicFilterScreen />;
  else if (extra?.name === 'plugins') extraView = <PluginListScreen />;
  else if (extra?.name === 'helper') extraView = <HelperScreen />;
  else if (extra?.name === 'my') extraView = <MyListScreen kind={extra.kind} />;
  else if (extra?.name === 'user') extraView = <UserScreen key={extra.member.id} member={extra.member} />;
  else if (extra?.name === 'menu') extraView = <MenuScreen />;
  else if (extra?.name === 'inbox') extraView = <InboxScreen />;
  else if (extra?.name === 'dm') extraView = <DirectMessageScreen userId={extra.userId} title={extra.title} />;
  else if (extra?.name === 'report') extraView = (
    <ReportScreen
      targetType={extra.targetType}
      targetId={extra.targetId}
      targetUser={extra.targetUser}
      topicTitle={extra.topicTitle}
    />
  );
  else if (extra?.name === 'browser')       extraView = (
        <InAppBrowser
          url={extra.url}
          title={extra.title}
          onClose={() => {
            setStack((current) => current.slice(0, -1));
            if (getAccessToken()) void refreshMe();
          }}
          onToast={showToast}
          onAppHref={(href) => openAppHref(nav, href)}
        />
      );

  const content = (
    <View style={styles.flex}>
      <View
        style={extraView ? styles.hiddenScreen : styles.flex}
        collapsable={false}
        pointerEvents={extraView ? 'none' : 'auto'}
        accessibilityElementsHidden={Boolean(extraView)}
        importantForAccessibility={extraView ? 'no-hide-descendants' : 'auto'}
      >
        {tab === 'home' ? <HomeScreen jumpSort={homeJump} onJumpApplied={() => setHomeJump(null)} onTopic={openTopic} onSearch={() => setStack([{ name: 'search' }])} onProfile={() => setTab('profile')} />
          : tab === 'compose' ? <ComposeScreen onBack={() => setTab('home')} />
          : tab === 'profile' ? <ProfileScreen />
          : tab === 'forums' ? (openForum ? <ForumFeed forum={openForum} onTopic={openTopic} onBack={() => setOpenForum(null)} /> : <ForumsScreen onOpenForum={setOpenForum} onSearch={() => setStack([{ name: 'search' }])} />)
          : <MessagesScreen />}
      </View>
      {extraView ? (
        <View style={styles.flex} pointerEvents="auto" collapsable={false}>
          {extraView}
        </View>
      ) : null}
    </View>
  );

  const showTab = !extra && tab !== 'compose';
  const lightChrome = scheme === 'light' || (showTab && tab === 'profile');
  const tabBarPad = Math.max(insets.bottom, 8);
  const toastOffset = 16 + (showTab ? 52 + tabBarPad : 56 + insets.bottom);
  const app = (
    <NavCtx.Provider value={nav}>
      <View style={styles.safe}>
        <StatusBar style={lightChrome ? 'dark' : 'light'} translucent />
        <View style={[styles.statusInset, { height: insets.top, backgroundColor: showTab && tab === 'profile' && scheme === 'dark' ? '#F3F3F3' : C.canvas }]} />
        <View style={styles.flex}>{content}</View>
        {showTab ? (
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
        ) : extra?.name !== 'topic' && extra?.name !== 'dm' ? (
          // 帖子详情和私信会话自带底部输入栏，已经包含安全区，不再叠加占位。
          <View style={{ height: insets.bottom, backgroundColor: C.canvas }} />
        ) : null}
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
