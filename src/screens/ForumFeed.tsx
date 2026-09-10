import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import type { Topic } from '../../data';
import { api, mapForum, mapTopic } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { usePagedList } from '../hooks/usePagedList';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { FilterBar, IconButton, ListFooter, ScreenHeader, StatusBlock,
  RowSeparator,
} from '../components/ui';
import { TopicRow } from '../components/TopicRow';

export function ForumFeed({ forum, onTopic, onBack }: { forum: string; onTopic: (topic: Topic, opts?: { latest?: boolean }) => void; onBack: () => void }) {
  const nav = useNav();
  const [sort, setSort] = useState('新评论');
  const [siteBoard, setSiteBoard] = useState<{ desc: string; topics: number } | null>(null);
  const boardQuery = useAsync(() => api.forums().then((result) => result.items.map(mapForum).find((item) => item.name === forum) ?? null), [forum]);
  const feed = usePagedList(
    async (cursor) => {
      const result = await api.forumTopics(forum, { sort, cursor });
      if (!cursor && result.board) {
        setSiteBoard({ desc: result.board.desc, topics: result.board.topics });
      }
      return { items: result.items.map(mapTopic), nextCursor: result.nextCursor };
    },
    [forum, sort],
  );
  const allowMore = useRef(false);
  useEffect(() => {
    setSiteBoard(null);
  }, [forum]);
  useEffect(() => {
    allowMore.current = false;
    const timer = setTimeout(() => {
      allowMore.current = true;
    }, 500);
    return () => clearTimeout(timer);
  }, [forum, sort]);
  const board = boardQuery.data;
  const desc = siteBoard?.desc || board?.desc || '';
  const topics = siteBoard?.topics || board?.topics || 0;
  const forumSorts = ['新评论', '新帖子'] as const;
  return (
    <View style={styles.flex}>
      <ScreenHeader title={forum} onBack={onBack} right={<IconButton name="search-outline" onPress={() => nav.open({ name: 'search' })} />} />
      <View style={styles.homeChrome}>
        <FilterBar items={forumSorts} value={sort} onChange={setSort} />
      </View>
      <FlatList
        data={feed.items}
        removeClippedSubviews
        windowSize={7}
        maxToRenderPerBatch={8}
        initialNumToRender={8}
        updateCellsBatchingPeriod={40}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.feedContent}
        onRefresh={feed.reload}
        refreshing={feed.refreshing}
        onEndReached={() => {
          if (allowMore.current && feed.hasMore) feed.loadMore();
        }}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={desc || topics ? (
          <View style={styles.forumIntro}>
            {desc ? <Text style={styles.forumIntroDesc}>{desc}</Text> : null}
            {topics ? <Text style={styles.forumIntroStats}>{topics} 个主题</Text> : null}
          </View>
        ) : null}
        renderItem={({ item }) => <TopicRow topic={item} onPress={() => onTopic(item)} onUnread={() => onTopic(item, { latest: true })} />}
        ItemSeparatorComponent={RowSeparator}
        ListEmptyComponent={<StatusBlock loading={feed.loading} error={feed.error} onRetry={feed.reload} empty={!feed.loading && !feed.error} emptyTitle="这个版块还没有主题" emptyCopy="去做第一个发帖的人吧" skeleton />}
        ListFooterComponent={<ListFooter loadingMore={feed.loadingMore} hasMore={feed.hasMore} count={feed.items.length} />}
      />
    </View>
  );
}
