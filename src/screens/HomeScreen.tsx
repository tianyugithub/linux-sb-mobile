import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { sorts, type Topic } from '../../data';
import { api, mapTopic, type DailyHotTopicDto } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { usePagedList } from '../hooks/usePagedList';
import { usePrefs } from '../hooks/usePrefs';
import { useTopicFilter } from '../hooks/useTopicFilter';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { chromePad, stubTopic, useAppInsets, useNav } from '../navigation/nav';
import { cacheGet, cacheSet } from '../services/query-cache';
import { FilterBar, Icon, IconButton, ListFooter, Logo, StatusBlock, UserAvatar,
  RowSeparator,
} from '../components/ui';
import { TopicRow } from '../components/TopicRow';
import { topicShowsUnread } from '../utils/topic-seen';
import {
  TOPIC_FILTER_BADGE_LABEL,
  TOPIC_FILTER_EMPTY_LIST,
  TOPIC_FILTER_EMPTY_LIST_COPY,
  topicFilterRules,
  topicHiddenByFilter,
} from '../data/topic-filter';

export const NOTICE_TEXT = '本站仍然不能讨论翻墙以及其他违法违规内容';

export function Header({ onSearch, onProfile }: { onSearch: () => void; onProfile: () => void }) {
  const nav = useNav();
  const unread = nav.loggedIn ? nav.unread : 0;
  const insets = useAppInsets();
  return (
    <View style={[styles.header, chromePad(insets.top)]}>
      <Logo />
      <View style={styles.headerActions}>
        <IconButton name="search-outline" onPress={onSearch} />
        <IconButton name="menu-outline" onPress={() => nav.open({ name: 'menu' })} />
        <Pressable
          onPress={unread > 0 ? () => nav.openTab('messages') : onProfile}
          accessibilityLabel={unread > 0 ? `${unread} 条未读通知` : '我的'}
          style={[styles.profileDot, nav.loggedIn && { backgroundColor: nav.me.accent }]}
        >
          {nav.loggedIn ? <UserAvatar name={nav.me.name} url={nav.me.avatarUrl} accent={nav.me.accent} size={28} radius={14} online /> : <Icon name="person-outline" size={16} color={C.muted} />}
          {unread > 0 ? (
            <View style={styles.profileBadge}>
              <Text style={styles.profileBadgeText}>{unread > 99 ? '99+' : String(unread)}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

export function HomeScreen({
  onTopic,
  onSearch,
  onProfile,
  jumpSort,
  onJumpApplied,
}: {
  onTopic: (topic: Topic, opts?: { latest?: boolean }) => void;
  onSearch: () => void;
  onProfile: () => void;
  jumpSort?: { sort: string; nonce: number } | null;
  onJumpApplied?: () => void;
}) {
  const nav = useNav();
  const { hotTopicsOpen, setHotTopicsOpen } = usePrefs();
  /**
   * 每日热帖（官方首页侧栏 `daily-hot-topics-card`）。
   *
   * 数据跟着首页第一页一起回来 —— 那块 HTML 本来就在我们抓的文档里，所以是 0 额外请求；
   * 先读冷启动快照，进页面立刻就有，再随第一页刷新。
   */
  const [hotTopics, setHotTopics] = useState<DailyHotTopicDto[] | null>(() => cacheGet<DailyHotTopicDto[]>('home:hot') ?? null);
  const topicFilter = useTopicFilter();
  const [forum, setForum] = useState('全部');
  // 版块屏蔽只在首页列表生效（官方：currentForumId === '0' 时才启用）
  const filterRules = useMemo(
    () => topicFilterRules(topicFilter.settings, topicFilter.context, forum === '全部'),
    [topicFilter.settings, topicFilter.context, forum],
  );
  const [sort, setSort] = useState(jumpSort?.sort && jumpSort.sort !== '足迹' ? jumpSort.sort : '新评论');
  const forumsQuery = useAsync(() => api.forums().then((result) => result.items.map((item) => item.name)), [], 'forums:names');
  const homeTabs = ['全部', ...(forumsQuery.data ?? [])];
  // 「足迹」与官方一致：仅登录后展示，列出我浏览过且仍有新回复的主题。
  const sortTabs = nav.loggedIn ? sorts : sorts.filter((item) => item !== '足迹');
  const footprint = sort === '足迹';
  const applyFeatured = sort === '申精';
  const changeSort = (next: string) => {
    if (next === '足迹' || next === '申精') setForum('全部');
    setSort(next);
  };
  const changeForum = (next: string) => {
    setForum(next);
    // 官方点左侧版块会离开申精页，回到该版块的普通列表。
    if (sort === '申精') setSort('新评论');
  };
  useEffect(() => {
    if (!nav.loggedIn && sort === '足迹') setSort('新评论');
  }, [nav.loggedIn, sort]);
  useEffect(() => {
    if (!jumpSort?.sort) return;
    if (jumpSort.sort === '足迹' && !nav.loggedIn) return;
    changeSort(jumpSort.sort);
    onJumpApplied?.();
  }, [jumpSort?.nonce, jumpSort?.sort, nav.loggedIn]);
  const listRef = useRef<FlatList<Topic>>(null);
  const feed = usePagedList(
    (cursor) => api.homeFeed({ forum, sort, cursor }).then((result) => {
      // 「精华 / 足迹」这两个模板官方没有热帖块 → 保留上一次的结果，别让区块闪掉
      if (!cursor && result.hotTopics) {
        cacheSet('home:hot', result.hotTopics);
        setHotTopics(result.hotTopics);
      }
      return {
        items: result.items.map(mapTopic),
        nextCursor: result.nextCursor,
      };
    }),
    [forum, sort],
  );
  /**
   * 帖子列表屏蔽（官方 home_keyword_filter）：只在首页列表生效，
   * 进入具体版块时版块屏蔽不生效，与官方一致。
   */
  const visibleFeed = useMemo(
    () => feed.items.filter((item) => !topicHiddenByFilter(item, filterRules)),
    [feed.items, filterRules],
  );

  const hiddenCount = feed.items.length - visibleFeed.length;
  const allHidden = feed.items.length > 0 && visibleFeed.length === 0;
  // 整页被屏蔽时继续往下取，别让用户对着空列表停住（官方是继续滚动加载）。
  useEffect(() => {
    if (!allHidden || !feed.hasMore || feed.loadingMore) return;
    const timer = setTimeout(() => feed.loadMore(), 400);
    return () => clearTimeout(timer);
  }, [allHidden, feed.hasMore, feed.loadingMore]);
  const notice = feed.items.find((item) => item.status === '置顶') ?? feed.items[0];
  const allowMore = useRef(false);
  useEffect(() => {
    allowMore.current = false;
    const timer = setTimeout(() => {
      allowMore.current = true;
    }, 500);
    return () => clearTimeout(timer);
  }, [forum, sort]);

  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [forum, sort]);

  return (
    <View style={styles.flex}>
      <Header onSearch={onSearch} onProfile={onProfile} />
      <View style={styles.homeChrome}>
        {footprint || applyFeatured ? null : (
          <Pressable
            onPress={() => {
              if (!notice) return;
              onTopic(notice, { latest: topicShowsUnread(notice.id, notice.replies, notice.hasUnread) });
            }}
            style={styles.noticeBar}
          >
            <Icon name="megaphone-outline" size={14} color={C.orange} />
            <Text numberOfLines={1} style={styles.noticeText}>{notice?.title || NOTICE_TEXT}</Text>
          </Pressable>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.forumScroll}>
          {homeTabs.map((item) => (
            <Pressable key={item} onPress={() => changeForum(item)} style={[styles.forumTab, forum === item && styles.forumTabActive]}>
              <Text numberOfLines={1} style={[styles.forumText, forum === item && styles.forumTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <FilterBar
          items={sortTabs}
          value={sort}
          onChange={changeSort}
          right={nav.loggedIn ? (
            <Pressable
              onPress={() => nav.open({ name: 'topic-filter' })}
              accessibilityLabel={TOPIC_FILTER_BADGE_LABEL}
              hitSlop={6}
              style={styles.topicFilterButton}
            >
              <Icon
                name="funnel-outline"
                size={15}
                color={filterRules.ruleCount > 0 ? C.red : C.muted}
              />
              {hiddenCount > 0 ? (
                <View style={styles.topicFilterCount}>
                  <Text style={styles.topicFilterCountText}>{hiddenCount}</Text>
                </View>
              ) : null}
            </Pressable>
          ) : undefined}
        />
      </View>
      <FlatList
        ref={listRef}
        data={visibleFeed}
        removeClippedSubviews
        windowSize={7}
        maxToRenderPerBatch={8}
        initialNumToRender={8}
        updateCellsBatchingPeriod={40}
        extraData={`${forum}-${sort}-${feed.loading}-${hiddenCount}-${hotTopicsOpen}-${hotTopics?.length ?? 0}`}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.feedContent}
        onRefresh={feed.reload}
        refreshing={feed.refreshing}
        onEndReached={() => {
          if (allowMore.current && feed.hasMore) feed.loadMore();
        }}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => <TopicRow topic={item} onPress={() => onTopic(item)} onUnread={() => onTopic(item, { latest: true })} />}
        ListHeaderComponent={hotTopics?.length ? (
          <View style={styles.hotCard}>
            <Pressable
              onPress={() => void setHotTopicsOpen(!hotTopicsOpen)}
              accessibilityLabel={hotTopicsOpen ? '收起每日热帖' : '展开每日热帖'}
              style={styles.hotHead}
            >
              <Icon name="flame-outline" size={15} color={C.orange} />
              <Text style={styles.hotTitle}>每日热帖</Text>
              <Text numberOfLines={1} style={styles.hotHint}>
                {hotTopics[0]?.window || '近 24 小时'} · {hotTopics.length} 条
              </Text>
              <Icon name={hotTopicsOpen ? 'chevron-up' : 'chevron-down'} size={15} color={C.dim} />
            </Pressable>
            {hotTopicsOpen
              ? hotTopics.map((item, index) => (
                <Pressable
                  key={item.id}
                  onPress={() => onTopic(stubTopic(item.id, item.title, item.replies))}
                  style={styles.hotRow}
                >
                  <Text style={[styles.hotRank, index < 3 && styles.hotRankTop]}>{index + 1}</Text>
                  <Text numberOfLines={2} style={styles.hotRowTitle}>{item.title}</Text>
                  <Text style={styles.hotRowMeta}>{item.replies} 回复</Text>
                </Pressable>
              ))
              : null}
          </View>
        ) : null}
        ItemSeparatorComponent={RowSeparator}
        ListEmptyComponent={<StatusBlock loading={feed.loading} error={feed.error} onRetry={feed.reload} empty={!feed.loading && !feed.error} emptyTitle={allHidden ? TOPIC_FILTER_EMPTY_LIST : footprint ? '暂时没有新回复' : applyFeatured ? '暂时没有申精主题' : '暂时没有内容'} emptyCopy={allHidden ? TOPIC_FILTER_EMPTY_LIST_COPY : footprint ? '你浏览过、并且有新回复的主题会出现在这里' : applyFeatured ? '正在投票加精的主题会出现在这里' : '换个版块看看吧'} skeleton />}
        ListFooterComponent={<ListFooter loadingMore={feed.loadingMore} hasMore={feed.hasMore} count={feed.items.length} />}
      />
    </View>
  );
}
