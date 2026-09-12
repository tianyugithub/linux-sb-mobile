import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { api, mapUser } from '../services/api';
import { ApiError } from '../services/client';
import { useAsync } from '../hooks/useAsync';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import {
  ConfirmDialog,
  HubChips,
  Icon,
  ScreenHeader,
  StatusBlock,
  UserAvatar,
  type DialogState,
} from '../components/ui';
import { formatRelative } from '../utils/time';
import type { SearchHitDto, SearchResultDto, SearchScope, SearchSort } from '../types/api';

const SCOPE_TABS = ['全部内容', '标题', '主题正文', '回帖', '用户'] as const;
const SCOPE_VALUE: Record<(typeof SCOPE_TABS)[number], SearchScope> = {
  全部内容: 'all',
  标题: 'title',
  主题正文: 'body',
  回帖: 'reply',
  用户: 'user',
};
const SORT_TABS = ['相关性', '最新回复', '最新发布', '回复最多', '浏览最多'] as const;
const SORT_VALUE: Record<(typeof SORT_TABS)[number], SearchSort> = {
  相关性: 'relevance',
  最新回复: 'latest',
  最新发布: 'created',
  回复最多: 'replies',
  浏览最多: 'views',
};

function hitMeta(hit: SearchHitDto) {
  const parts = [hit.forumName, hit.createdAt ? formatRelative(hit.createdAt) : '', hit.replyCount ? `${hit.replyCount} 条回复` : '', hit.viewCount ? `${hit.viewCount} 次浏览` : '', hit.hasImage ? '包含图片' : ''];
  return parts.filter(Boolean).join(' · ');
}

export function SearchScreen() {
  const nav = useNav();
  const meta = useAsync(() => api.search({}), [nav.loggedIn], `search:meta:${nav.loggedIn ? '1' : '0'}`);
  const [draft, setDraft] = useState('');
  const [scopeTab, setScopeTab] = useState<(typeof SCOPE_TABS)[number]>('全部内容');
  const [sortTab, setSortTab] = useState<(typeof SORT_TABS)[number]>('相关性');
  const [result, setResult] = useState<SearchResultDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const scope = SCOPE_VALUE[scopeTab];
  const sort = SORT_VALUE[sortTab];
  const free = Boolean(result?.free ?? meta.data?.free);
  const cost = free ? 0 : (result?.cost ?? meta.data?.cost ?? 1);
  const costNote = result?.costNote ?? meta.data?.costNote ?? (free ? '搜索免积分' : '每次提交搜索扣除 1 积分。确认后才会执行搜索。');
  const placeholder = scope === 'user'
    ? '搜索用户名'
    : (meta.data?.placeholder || '搜索标题、主题内容和回帖');
  const emptyHint = result?.summary
    ? (scope === 'user' ? '没有匹配的用户' : '没有匹配的主题')
    : (scope === 'user' ? '输入用户名搜索' : (meta.data?.emptyHint || '输入关键词，搜索社区中的主题和回帖。'));
  const users = result?.users ?? [];

  const runGet = async (next: { scope?: SearchScope; sort?: SearchSort; page?: number; append?: boolean }) => {
    const q = (result?.q || draft).trim();
    if (!q) return;
    const page = next.page ?? 1;
    if (next.append) setPaging(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await api.search({
        q,
        scope: next.scope ?? scope,
        sort: next.sort ?? sort,
        page,
        access: result?.access,
      });
      setResult((prev) => {
        if (!next.append || !prev) return data;
        return {
          ...data,
          hits: [...prev.hits, ...data.hits],
          users: [...prev.users, ...data.users],
          topics: [...prev.topics, ...data.topics],
          access: data.access || prev.access,
          free: data.free || prev.free,
        };
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '搜索失败');
    } finally {
      setLoading(false);
      setPaging(false);
    }
  };

  const performSearch = async () => {
    const q = draft.trim();
    setLoading(true);
    setError(null);
    try {
      const data = await api.search({
        q,
        scope,
        sort: scope === 'user' ? undefined : sort,
        charge: true,
        free,
      });
      setResult(data);
      if (data.balance) await nav.refreshMe(data.balance);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '搜索失败');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const submit = () => {
    const q = draft.trim();
    if (q.length < 2) {
      nav.toast('请输入至少 2 个字符');
      return;
    }
    if (q.length > 120) {
      nav.toast('搜索词最多 120 个字符');
      return;
    }
    if (!nav.loggedIn) {
      nav.open({ name: 'login' });
      return;
    }
    if (meta.loading && meta.data === undefined) {
      nav.toast('正在读取搜索规则…');
      return;
    }
    if (free || cost <= 0) {
      void performSearch().catch(() => undefined);
      return;
    }
    setDialog({
      title: '确认操作',
      text: `本次搜索将扣除 ${cost} 积分，确认继续吗？`,
      onConfirm: performSearch,
    });
  };

  const changeScope = (tab: (typeof SCOPE_TABS)[number]) => {
    setScopeTab(tab);
    if (result?.q) void runGet({ scope: SCOPE_VALUE[tab], page: 1 });
  };
  const changeSort = (tab: (typeof SORT_TABS)[number]) => {
    setSortTab(tab);
    if (result?.q && scope !== 'user') void runGet({ sort: SORT_VALUE[tab], page: 1 });
  };

  const footer = result?.nextPage ? (
    <Pressable disabled={paging} onPress={() => void runGet({ page: Number(result.nextPage), append: true })} style={styles.srMore}>
      {paging ? <ActivityIndicator color={C.muted} /> : <Text style={styles.srMoreText}>下一页</Text>}
    </Pressable>
  ) : null;

  return (
    <View style={styles.flex}>
      <ScreenHeader title="搜索" />
      <View style={styles.srHero}>
        <View style={styles.srFieldWrap}>
          <Icon name="search-outline" size={18} color={C.dim} />
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={C.dim}
            style={styles.srField}
            returnKeyType="search"
            maxLength={120}
            onSubmitEditing={submit}
          />
          {draft ? (
            <Pressable onPress={() => setDraft('')} hitSlop={8}>
              <Icon name="close-circle" size={16} color={C.dim} />
            </Pressable>
          ) : null}
          <Pressable onPress={submit} style={styles.srGo}>
            <Text style={styles.srGoText}>搜索</Text>
          </Pressable>
        </View>
        <View style={[styles.srCostPill, free && styles.srCostPillFree]}>
          <Icon name={free ? 'checkmark-circle-outline' : 'information-circle-outline'} size={14} color={free ? C.green : C.orange} />
          <Text style={[styles.srCostText, free && styles.srCostTextFree]}>{costNote}</Text>
        </View>
      </View>
      <View style={styles.srChips}>
        <HubChips items={SCOPE_TABS} value={scopeTab} onChange={changeScope} />
        {scope !== 'user' && result?.q ? <HubChips items={SORT_TABS} value={sortTab} onChange={changeSort} /> : null}
      </View>
      {result?.summary ? <Text style={styles.srSummary}>{result.summary}</Text> : null}
      {loading && !result ? <StatusBlock loading error={error} onRetry={submit} /> : error && !result ? (
        <StatusBlock error={error} onRetry={submit} />
      ) : scope === 'user' ? (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.srList}
          ListEmptyComponent={(
            <View style={styles.srEmpty}>
              <View style={styles.srEmptyIcon}><Icon name="person-outline" size={28} color={C.dim} /></View>
              <Text style={styles.emptyTitle}>{emptyHint}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const member = mapUser(item);
            return (
              <Pressable onPress={() => nav.open({ name: 'user', member })} style={styles.srUser}>
                <UserAvatar name={member.name} url={member.avatarUrl} accent={member.accent} size={42} radius={21} />
                <View style={styles.flexGrow}>
                  <Text style={styles.rankName}>{member.name}</Text>
                  <Text style={styles.meta}>{[item.groupLabel || item.group, item.joinedAt ? `注册于 ${item.joinedAt}` : ''].filter(Boolean).join(' · ')}</Text>
                </View>
                <Icon name="chevron-forward" size={16} color={C.dim} />
              </Pressable>
            );
          }}
          ListFooterComponent={footer}
        />
      ) : (
        <FlatList
          data={result?.hits ?? []}
          keyExtractor={(item) => item.id + item.match}
          contentContainerStyle={styles.srList}
          ListEmptyComponent={(
            <View style={styles.srEmpty}>
              <View style={styles.srEmptyIcon}><Icon name="search-outline" size={28} color={C.dim} /></View>
              <Text style={styles.emptyTitle}>{emptyHint}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => nav.open({
                name: 'topic',
                topic: {
                  id: item.id,
                  title: item.title,
                  author: '',
                  forum: item.forumName || '综合',
                  time: item.createdAt ? formatRelative(item.createdAt) : '',
                  replies: item.replyCount,
                  avatar: '?',
                  accent: C.blue,
                  body: item.snippet,
                },
              })}
              style={styles.srHit}
            >
              {item.match ? (
                <View style={styles.srMatch}><Text style={styles.srMatchText}>{item.match}</Text></View>
              ) : null}
              <Text style={styles.srHitTitle}>{item.title}</Text>
              {item.snippet ? <Text numberOfLines={3} style={styles.srHitSnippet}>{item.snippet}</Text> : null}
              <Text style={styles.srHitMeta}>{hitMeta(item)}</Text>
            </Pressable>
          )}
          ListFooterComponent={footer}
        />
      )}
      <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}
