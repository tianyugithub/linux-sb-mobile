import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import type { DirectThread, IonName, MessageItem } from '../../data';
import { api, mapDirect, mapNotification } from '../services/api';
import { markNotificationsSeen, rememberUnread } from '../services/push';
import { useAsync } from '../hooks/useAsync';
import { usePagedList } from '../hooks/usePagedList';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { chromePad, useAppInsets, useNav } from '../navigation/nav';
import { Icon, ListFooter, PrimaryButton, ScreenHeader, StatusBlock, UserAvatar, pickUserId } from '../components/ui';

export const MSG_FILTERS = ['全部', '提及', '打赏', '系统'] as const;
export type MsgFilter = typeof MSG_FILTERS[number];

export function msgKindUi(kind: MessageItem['kind']) {
  const map: Record<MessageItem['kind'], { label: string; icon: IonName; bg: string; fg: string }> = {
    reply: { label: '回复', icon: 'chatbubbles', bg: C.kindReplyBg, fg: C.kindReplyFg },
    mention: { label: '提及', icon: 'at', bg: C.kindMentionBg, fg: C.kindMentionFg },
    reward: { label: '打赏', icon: 'gift', bg: C.kindRewardBg, fg: C.kindRewardFg },
    system: { label: '系统', icon: 'notifications', bg: C.kindSystemBg, fg: C.kindSystemFg },
  };
  return map[kind];
}

function noticePreview(value?: string | null) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function MessageCard({ item, onPress }: { item: MessageItem; onPress: () => void }) {
  const theme = msgKindUi(item.kind);
  const system = item.kind === 'system';
  const text = noticePreview(item.text);
  const topic = noticePreview(item.topic);
  const showTopic = Boolean(topic && !text.includes(topic));
  const body = (
    <>
      <View style={styles.jdMsgIconWrap}>
        {system ? (
          <View style={[styles.jdMsgGlyph, { backgroundColor: theme.bg }]}>
            <Icon name={theme.icon} size={22} color={theme.fg} />
          </View>
        ) : (
          <UserAvatar name={item.name} url={item.avatarUrl} accent={item.accent} size={44} radius={12} />
        )}
      </View>
      <View style={styles.jdMsgBody}>
        <View style={styles.jdMsgTop}>
          <Text style={styles.jdMsgTitle}>{item.name}</Text>
          <Text style={styles.jdMsgTime}>{item.time}</Text>
        </View>
        <View style={styles.jdMsgKindRow}>
          <View style={[styles.jdMsgKindTag, { backgroundColor: theme.bg }]}>
            <Icon name={theme.icon} size={11} color={theme.fg} />
            <Text style={[styles.jdMsgKindText, { color: theme.fg }]}>{theme.label}</Text>
          </View>
        </View>
        {text ? <Text selectable style={styles.jdMsgText}>{text}</Text> : null}
        {showTopic ? (
          <View style={styles.jdMsgFoot}>
            <Text style={styles.jdMsgLink}>{topic}</Text>
            <Icon name="chevron-forward" size={12} color={C.dim} />
          </View>
        ) : null}
      </View>
    </>
  );
  if (!item.topicId) return <View style={styles.jdMsgCard}>{body}</View>;
  return (
    <Pressable onPress={onPress} android_ripple={{ color: 'rgba(225,37,27,0.12)' }} style={styles.jdMsgCard}>
      {body}
    </Pressable>
  );
}

export function MessagesScreen() {
  const nav = useNav();
  const insets = useAppInsets();
  const [filter, setFilter] = useState<MsgFilter>('全部');
  const kindOf = (label: MsgFilter) => (label === '全部' ? null : ({ 提及: 'mention', 打赏: 'reward', 系统: 'system' } as const)[label]);
  const list = usePagedList(async (cursor) => {
    if (!nav.loggedIn) return { items: [] as MessageItem[], nextCursor: null };
    const result = await api.notifications('全部', cursor);
    if (!cursor) {
      nav.setUnread(result.unread);
      void rememberUnread(result.unread);
      void markNotificationsSeen(result.items.map((item) => item.id));
    }
    return { items: result.items.map(mapNotification), nextCursor: result.nextCursor };
  }, [nav.loggedIn]);
  const kind = kindOf(filter);
  const items = list.items.filter((item) => !kind || item.kind === kind);
  const allowMore = useRef(false);
  useEffect(() => {
    allowMore.current = false;
    const timer = setTimeout(() => { allowMore.current = true; }, 400);
    return () => clearTimeout(timer);
  }, [nav.loggedIn, filter]);
  const openItem = (item: MessageItem) => {
    if (!item.topicId) return;
    nav.open({
      name: 'topic',
      topic: {
        id: item.topicId,
        title: item.topic || item.text || '主题',
        author: item.name,
        forum: '综合',
        time: item.time,
        replies: 0,
        avatar: item.avatar,
        avatarUrl: item.avatarUrl,
        accent: item.accent,
      },
      replyId: item.replyId,
    });
  };
  return (
    <View style={styles.flex}>
      <View style={[styles.jdMsgHeader, chromePad(insets.top)]}>
        <Text style={styles.jdMsgPageTitle}>消息</Text>
        <View style={styles.jdMsgHeadActions}>
          {nav.loggedIn && nav.unread > 0 ? (
            <View style={styles.jdMsgCount}>
              <Text style={styles.jdMsgCountText}>{nav.unread > 99 ? '99+' : `${nav.unread}条未读`}</Text>
            </View>
          ) : (
            <Text style={styles.jdMsgHeadHint}>{!nav.sessionReady ? '同步中…' : nav.loggedIn ? '暂无未读' : '登录后查看'}</Text>
          )}
          <Pressable onPress={() => nav.open({ name: 'inbox' })} style={styles.jdMsgInboxBtn} hitSlop={8}>
            <Text style={styles.jdMsgInboxText}>私信</Text>
            <Icon name="chevron-forward" size={14} color={C.muted} />
          </Pressable>
        </View>
      </View>
      <View style={styles.jdChipBar}>
        <View style={styles.jdChipRow}>
          {MSG_FILTERS.map((item) => {
            const on = filter === item;
            return (
              <Pressable key={item} onPress={() => setFilter(item)} style={[styles.jdChip, on && styles.jdChipOn]}>
                <Text style={[styles.jdChipText, on && styles.jdChipTextOn]}>{item}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <FlatList
        style={styles.jdMsgFeed}
        data={nav.loggedIn ? items : []}
        keyExtractor={(item, index) => `${item.id}:${index}`}
        extraData={`${filter}-${nav.unread}`}
        removeClippedSubviews={false}
        contentContainerStyle={styles.jdMsgList}
        onRefresh={nav.loggedIn ? list.reload : undefined}
        refreshing={list.refreshing}
        onEndReached={() => {
          if (allowMore.current && list.hasMore) list.loadMore();
        }}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => (
          <MessageCard item={item} onPress={() => openItem(item)} />
        )}
        ListFooterComponent={nav.loggedIn ? <ListFooter loadingMore={list.loadingMore} hasMore={list.hasMore} count={items.length} /> : null}
        ListEmptyComponent={(
          !nav.sessionReady || (list.loading && !list.items.length)
            ? <StatusBlock loading error={list.error} onRetry={list.reload} skeleton />
            : list.error && !items.length
              ? <StatusBlock error={list.error} onRetry={list.reload} />
            : (
              <View style={styles.emptyPage}>
                <View style={styles.jdEmptyIcon}>
                  <Icon name="notifications-outline" size={28} color={C.muted} />
                </View>
                <Text style={styles.emptyTitle}>{nav.loggedIn ? '没有这类通知' : '登录后查看通知'}</Text>
                <Text style={styles.emptyCopy}>通知、私信和积分需在 linux.sb 登录后同步。</Text>
                {!nav.loggedIn ? <PrimaryButton label="去登录" onPress={() => nav.open({ name: 'login' })} /> : null}
              </View>
            )
        )}
      />
    </View>
  );
}

function previewParts(preview: string) {
  const match = preview.match(/^(我[：:])\s*(.*)$/);
  if (match) return { mine: true, prefix: match[1], text: match[2] };
  return { mine: false, prefix: '', text: preview };
}

function InboxThreadRow({ item, onOpen, onUser }: { item: DirectThread; onOpen: () => void; onUser: () => void }) {
  const preview = previewParts(item.preview);
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [styles.inboxRow, pressed && styles.inboxRowPressed]}
    >
      <Pressable onPress={onUser} hitSlop={6} accessibilityLabel={`${item.name} 的主页`}>
        <UserAvatar name={item.name} url={item.avatarUrl} accent={item.accent} size={44} radius={22} />
      </Pressable>
      <View style={styles.inboxBody}>
        <View style={styles.inboxTop}>
          <View style={styles.inboxNameClip} collapsable={false}>
            <Text style={styles.inboxName}>{item.name}</Text>
          </View>
          <Text numberOfLines={1} style={styles.inboxTime}>{item.time}</Text>
        </View>
        <View style={styles.inboxPreviewClip} collapsable={false}>
          <Text style={styles.inboxPreview}>
            {preview.mine ? <Text style={styles.inboxMine}>{preview.prefix} </Text> : null}
            {preview.text}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export function InboxScreen() {
  const nav = useNav();
  const [keyword, setKeyword] = useState('');
  const query = useAsync(async () => {
    if (!nav.loggedIn) return [];
    const result = await api.directMessages();
    return result.items.map(mapDirect);
  }, [nav.loggedIn], nav.loggedIn ? 'inbox:1' : 'inbox:0');
  const threads = query.data ?? [];
  const needle = keyword.trim();
  const shown = useMemo(() => {
    const q = needle.toLowerCase();
    if (!q) return threads;
    return threads.filter((item) => (
      item.name.toLowerCase().includes(q) || item.preview.toLowerCase().includes(q)
    ));
  }, [threads, needle]);
  const uid = /^\d+$/.test(needle) ? needle : '';
  const uidKnown = Boolean(uid && threads.some((item) => pickUserId(item.userId, item.id) === uid));
  const openThread = (item: DirectThread) => {
    const userId = pickUserId(item.userId, item.id) || item.userId;
    if (!userId) return;
    nav.open({ name: 'dm', userId, title: item.name });
  };
  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="私信"
        right={nav.loggedIn ? (
          <Pressable onPress={query.reload} hitSlop={8} accessibilityLabel="刷新">
            <Icon name="refresh-outline" size={20} color={C.muted} />
          </Pressable>
        ) : undefined}
      />
      {nav.loggedIn ? (
        <View style={styles.inboxSearchWrap}>
          <View style={styles.inboxSearch}>
            <Icon name="search-outline" size={16} color={C.dim} />
            <TextInput
              value={keyword}
              onChangeText={setKeyword}
              placeholder={threads.length ? `搜索 ${threads.length} 个联系人` : '搜索联系人或输入 UID'}
              placeholderTextColor={C.dim}
              style={styles.inboxSearchInput}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            {keyword ? (
              <Pressable onPress={() => setKeyword('')} hitSlop={8} accessibilityLabel="清除">
                <Icon name="close-circle" size={16} color={C.dim} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      <FlatList
        data={nav.loggedIn ? shown : []}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.inboxList}
        ItemSeparatorComponent={() => <View style={styles.inboxSep} />}
        onRefresh={nav.loggedIn ? query.reload : undefined}
        refreshing={Boolean(nav.loggedIn && query.fetching && query.data)}
        renderItem={({ item }) => (
          <InboxThreadRow
            item={item}
            onOpen={() => openThread(item)}
            onUser={() => {
              const userId = pickUserId(item.userId, item.id) || item.userId;
              if (userId) nav.openUser(userId);
            }}
          />
        )}
        ListHeaderComponent={uid && !uidKnown ? (
          <Pressable
            onPress={() => nav.open({ name: 'dm', userId: uid, title: `UID ${uid}` })}
            style={({ pressed }) => [styles.inboxUidRow, pressed && styles.inboxRowPressed]}
          >
            <View style={styles.inboxUidMark}>
              <Icon name="chatbubble-ellipses-outline" size={18} color={C.blue} />
            </View>
            <View style={styles.inboxBody}>
              <Text style={styles.inboxUidTitle}>用 UID {uid} 发起对话</Text>
              <Text style={styles.inboxUidHint}>站点按用户编号打开私信，没有用户名搜索</Text>
            </View>
            <Icon name="chevron-forward" size={14} color={C.dim} />
          </Pressable>
        ) : null}
        ListEmptyComponent={(
          uid && !uidKnown
            ? null
          : !nav.sessionReady || (query.loading && !query.data)
            ? <StatusBlock loading error={query.error} onRetry={query.reload} />
            : query.error && !threads.length
              ? <StatusBlock error={query.error} onRetry={query.reload} />
            : (
              <View style={styles.emptyPage}>
                <View style={styles.jdEmptyIcon}>
                  <Icon name="chatbubble-outline" size={28} color={C.muted} />
                </View>
                <Text style={styles.emptyTitle}>
                  {!nav.loggedIn ? '登录后查看私信' : needle ? '没有匹配的联系人' : '还没有私信'}
                </Text>
                <Text style={styles.emptyCopy}>
                  {!nav.loggedIn
                    ? '通知、私信和积分需在 linux.sb 登录后同步。'
                    : needle
                      ? '可以改关键词，或输入对方的数字 UID。'
                      : '从对方主页点「私信」就能发起新对话。'}
                </Text>
                {!nav.loggedIn ? <PrimaryButton label="去登录" onPress={() => nav.open({ name: 'login' })} /> : null}
              </View>
            )
        )}
        ListFooterComponent={nav.loggedIn && threads.length ? (
          <View style={styles.inboxFoot}>
            <Text style={styles.inboxFootText}>站点只保留最近 {threads.length} 个联系人，往来会按会话集中显示。</Text>
            <Text style={styles.inboxFootText}>新对话请到对方主页点「私信」，或在上方输入数字 UID。</Text>
          </View>
        ) : null}
      />
    </View>
  );
}
