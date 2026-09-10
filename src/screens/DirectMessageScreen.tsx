import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import type { DirectMessageDto } from '../types/api';
import { api } from '../services/api';
import { ApiError } from '../services/client';
import { useAsync } from '../hooks/useAsync';
import { useKeyboardLift } from '../hooks/useKeyboardLift';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useAppInsets, useNav } from '../navigation/nav';
import {
  ActionSheet,
  Icon,
  PrimaryButton,
  ScreenHeader,
  StatusBlock,
  UserAvatar,
  type SheetItem,
} from '../components/ui';
import { useNbEditor } from '../components/NbEditor';
import { buildQuoteDraft, parseInlineMarkdown, splitQuoteLines } from '../utils/markdown';
import { copyText } from '../utils/share';
import { formatRelative } from '../utils/time';

// 与官方一致：会话内定时拉取新消息（官方网页端为 2s，这里放宽到 20s）。
const POLL_MS = 20_000;
const MAX_LEN = 500;

function MessageBubble({ item, onLongPress }: { item: DirectMessageDto; onLongPress: () => void }) {
  const nav = useNav();
  const parsed = useMemo(() => {
    if (item.quote) return { quote: item.quote, body: item.content };
    return splitQuoteLines(item.content);
  }, [item.quote, item.content]);
  const spans = useMemo(() => parseInlineMarkdown(parsed.body), [parsed.body]);
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={260}
      style={[styles.dmRow, item.mine && styles.dmRowMine]}
    >
      <UserAvatar
        name={item.authorName}
        url={item.avatar.includes('/') ? item.avatar : undefined}
        accent={item.accent}
        size={32}
        radius={16}
      />
      <View style={[styles.dmBubbleWrap, item.mine && styles.dmBubbleWrapMine]}>
        {parsed.quote ? (
          <View style={styles.dmQuote}>
            <Text numberOfLines={3} style={styles.dmQuoteText}>{parsed.quote}</Text>
          </View>
        ) : null}
        <View style={[styles.dmBubble, item.mine ? styles.dmBubbleMine : styles.dmBubbleTheirs]}>
          <Text style={[styles.dmText, item.mine && styles.dmTextMine]}>
            {spans.map((span, index) => (
              span.href ? (
                <Text
                  key={index}
                  style={[styles.dmLink, item.mine && styles.dmLinkMine]}
                  onPress={() => nav.openBrowser(span.href as string)}
                >
                  {span.text}
                </Text>
              ) : (
                <Text
                  key={index}
                  style={[
                    span.bold && styles.dmBold,
                    span.italic && styles.dmItalic,
                    span.strike && styles.dmStrike,
                    span.code && (item.mine ? styles.dmCodeMine : styles.dmCode),
                  ]}
                >
                  {span.text}
                </Text>
              )
            ))}
          </Text>
        </View>
        <Text style={[styles.dmTime, item.mine && styles.dmTimeMine]}>{formatRelative(item.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

export function DirectMessageScreen({ userId, title }: { userId: string; title?: string }) {
  const nav = useNav();
  // 与评论区回帖框用同一套安全区与内边距，两处输入栏才会落在同一条线上。
  const insets = useAppInsets();
  const kb = useKeyboardLift();
  const kbLift = kb.lift >= 80 ? kb.lift : 0;
  const listRef = useRef<FlatList<DirectMessageDto>>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  /** Markdown 工具条默认收起（与评论区回帖框一致），点输入栏右侧的展开按钮才出来。 */
  const [tools, setTools] = useState(false);
  const [quoteTarget, setQuoteTarget] = useState<DirectMessageDto | null>(null);
  const [menu, setMenu] = useState<SheetItem[] | null>(null);
  const query = useAsync(
    () => (nav.loggedIn ? api.directThread(userId) : Promise.resolve(null)),
    [userId, nav.loggedIn],
    `dm:${userId}:${nav.loggedIn ? '1' : '0'}`,
  );
  const messages = query.data?.messages ?? [];
  // inverted 列表：数据倒序，最新一条始终在底部，无需依赖滚动时序。
  const ordered = useMemo(() => [...messages].reverse(), [messages]);
  const partner = query.data?.name || title || '私信';
  /**
   * 私信用与「评论区回帖框」完全同一套编辑器（useNbEditor）：同一个 WebView 编辑器、
   * 同一个表情库、同一个全屏（全屏后就是完整编辑器）。
   *
   * 注意：官方私信表单其实只是 `<textarea maxlength="500">`（「纯文本消息」），
   * 所以这里不接图片上传；markdown 由 App 自己的气泡渲染，官网那边会原样显示。
   */
  const dmEditor = useNbEditor({
    value: text,
    onChange: setText,
    placeholder: `给 ${partner} 发私信`,
    minHeight: 36,
    docked: true,
    inputStyle: styles.commentEditorInput,
    // 极简（内联）状态保持纯 markdown，富文本只在全屏里给 —— 与回帖框一致
    richText: 'fullscreen',
    onLink: (href) => nav.openBrowser(href),
    onFocus: () => dmEditor.setEmojiOpen(false),
  });

  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  }, []);

  useEffect(() => {
    if (!nav.loggedIn) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await api.directThread(userId, { fresh: true });
        if (cancelled) return;
        query.setData((prev) => {
          if (!prev) return next;
          const known = new Set(prev.messages.map((item) => item.id));
          const added = next.messages.filter((item) => !known.has(item.id));
          if (!added.length) return prev.lastId === next.lastId ? prev : { ...prev, lastId: next.lastId };
          return { ...next, messages: [...prev.messages, ...added] };
        });
      } catch {
        /* 保留当前会话，等下次轮询 */
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId, nav.loggedIn, query.setData]);

  const payload = quoteTarget ? buildQuoteDraft(quoteTarget.content, text) : text;
  const overLimit = payload.length > MAX_LEN;
  const canSend = Boolean(payload.trim()) && !overLimit && !sending;

  const openMenu = (item: DirectMessageDto) => {
    setMenu([
      { label: '引用', onPress: () => setQuoteTarget(item) },
      {
        label: '复制',
        onPress: () => {
          void copyText(item.content).then(() => nav.toast('已复制'));
        },
      },
    ]);
  };

  const send = async () => {
    // 所见即所得模式下先把活文档拉平回 markdown（与回帖一致）
    const body = (await dmEditor.flush()).trim();
    const content = (quoteTarget ? buildQuoteDraft(quoteTarget.content, body) : body).trim();
    if (!content || sending) return;
    if (content.length > MAX_LEN) {
      nav.toast(`私信最多 ${MAX_LEN} 字`);
      return;
    }
    setSending(true);
    try {
      const result = await api.sendDirectMessage(userId, content);
      dmEditor.clear();
      dmEditor.setEmojiOpen(false);
      setTools(false);
      setQuoteTarget(null);
      if (result.message) {
        query.setData((prev) => prev
          ? { ...prev, lastId: result.lastId ?? prev.lastId, messages: [...prev.messages, result.message as DirectMessageDto] }
          : prev);
        scrollToLatest();
      } else {
        query.reload();
      }
    } catch (err) {
      nav.toast(err instanceof ApiError ? err.message : '私信发送失败');
    } finally {
      setSending(false);
    }
  };

  if (!nav.loggedIn) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title={partner} />
        <View style={styles.emptyPage}>
          <Text style={styles.emptyTitle}>登录后才能收发私信</Text>
          <PrimaryButton label="去登录" onPress={() => nav.open({ name: 'login' })} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title={partner}
        right={<Pressable onPress={() => query.reload()} hitSlop={8} accessibilityLabel="刷新"><Icon name="refresh-outline" size={20} color={C.muted} /></Pressable>}
      />
      <View style={[styles.flex, kbLift ? { paddingBottom: kbLift } : null]}>
        {messages.length ? (
          <FlatList
            ref={listRef}
            inverted
            data={ordered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.dmContent}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <MessageBubble item={item} onLongPress={() => openMenu(item)} />}
          />
        ) : (
          query.loading && !query.data
            ? <StatusBlock loading error={query.error} onRetry={query.reload} />
            : query.error
              ? <StatusBlock error={query.error} onRetry={query.reload} />
              : <View style={styles.emptyPage}><Icon name="chatbubble-outline" size={34} color={C.dim} /><Text style={styles.emptyTitle}>还没有私信，发第一条吧</Text></View>
        )}
        {/* 与评论区回帖框完全同构：同一个 commentBar 内边距、左侧头像列、右侧图标列（展开工具 + 圆形发送）。 */}
        <View style={[styles.commentBar, { paddingBottom: 8 + insets.bottom }]}>
          {quoteTarget ? (
            <Pressable onPress={() => setQuoteTarget(null)} style={styles.replyChip}>
              <Text numberOfLines={1} style={styles.replyChipText}>
                引用 {quoteTarget.mine ? '我' : quoteTarget.authorName}：{quoteTarget.content}
              </Text>
              <Icon name="close" size={12} color={C.muted} />
            </Pressable>
          ) : null}
          {dmEditor.emojiOpen ? dmEditor.emoji : null}
          {tools ? dmEditor.toolbar : null}
          <View style={styles.commentComposer}>
            <UserAvatar
              name={nav.me.name || '我'}
              url={nav.me.avatarUrl}
              accent={nav.me.accent}
              size={32}
              radius={16}
            />
            {dmEditor.field}
            <View style={styles.commentComposerIcons}>
              {overLimit ? (
                <Text style={styles.dmCounter}>超出 {payload.length - MAX_LEN} 字</Text>
              ) : null}
              <Pressable
                onPress={() => {
                  dmEditor.focus();
                  setTools(true);
                  dmEditor.toggleEmoji();
                }}
                hitSlop={8}
                accessibilityLabel="表情"
              >
                <Icon name="happy-outline" size={20} color={dmEditor.emojiOpen ? C.text : C.dim} />
              </Pressable>
              <Pressable
                onPress={() => {
                  dmEditor.focus();
                  setTools((open) => !open);
                }}
                hitSlop={8}
                accessibilityLabel={tools ? '收起编辑工具' : '展开编辑工具（与回帖一致，可全屏）'}
              >
                <Icon name={tools ? 'contract-outline' : 'expand-outline'} size={18} color={tools ? C.text : C.dim} />
              </Pressable>
              <Pressable
                disabled={!canSend}
                onPress={() => { void send(); }}
                style={[styles.commentSend, !canSend && styles.commentSendOff]}
                accessibilityLabel="发送私信"
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon name="arrow-up" size={16} color="#fff" />
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
      <ActionSheet items={menu} onClose={() => setMenu(null)} />
    </View>
  );
}
