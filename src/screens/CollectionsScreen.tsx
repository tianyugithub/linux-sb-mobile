import React, { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { Album } from '../../data';
import { api, mapCollection, mapTopic } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { usePagedList } from '../hooks/usePagedList';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { CompactTag, FilterBar, ListFooter, ScreenHeader, StatusBlock,
  RowSeparator,
} from '../components/ui';
import { TopicRow } from '../components/TopicRow';

export function CollectionsScreen({ initialTab = '大家的淘帖' }: { initialTab?: '大家的淘帖' | '我的淘帖' }) {
  const [tab, setTab] = useState<'大家的淘帖' | '我的淘帖'>(initialTab);
  const query = useAsync(() => api.collections(tab === '我的淘帖' ? 'mine' : 'everyone').then((result) => result.items.map(mapCollection)), [tab], `collections:${tab}`);
  const list = query.data ?? [];
  const nav = useNav();
  return (
    <View style={styles.flex}>
      <ScreenHeader title="淘帖中心" />
      <FilterBar items={['大家的淘帖', '我的淘帖'] as const} value={tab} onChange={setTab} />
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.pagePad}
        ListHeaderComponent={<Text style={styles.pageLead}>{tab === '大家的淘帖' ? '站内公开分享的淘帖专辑，欢迎订阅或收录。' : '只有自己看得见的专辑。'}</Text>}
        ListEmptyComponent={<StatusBlock loading={query.loading && !query.data} error={query.error} onRetry={query.reload} empty />}
        renderItem={({ item }) => (
          <Pressable onPress={() => nav.open({ name: 'collection', album: item })} style={styles.albumRow}>
            <View style={[styles.albumMark, { backgroundColor: item.accent }]} />
            <View style={styles.flexGrow}>
              <View style={styles.forumCardTop}>
                <Text numberOfLines={1} style={styles.rankName}>{item.title}</Text>
                <CompactTag>{item.public ? '公开' : '私密'}</CompactTag>
              </View>
              <Text numberOfLines={1} style={styles.meta}>{item.author} · {item.count} 篇文章 · {item.updated}</Text>
              <Text numberOfLines={1} style={styles.albumDesc}>{item.desc}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

export function CollectionDetail({ album }: { album: Album }) {
  const nav = useNav();
  const feed = usePagedList(
    (cursor) => api.collectionTopics(album.id, cursor).then((result) => ({ items: result.items.map(mapTopic), nextCursor: result.nextCursor })),
    [album.id],
  );
  return (
    <View style={styles.flex}>
      <ScreenHeader title={album.title} />
      <FlatList
        data={feed.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.feedContent}
        onRefresh={feed.reload}
        refreshing={feed.refreshing}
        onEndReached={() => { if (feed.hasMore) feed.loadMore(); }}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={(
          <View style={styles.forumIntro}>
            <Text style={styles.forumIntroDesc}>{album.desc}</Text>
            <Text style={styles.forumIntroStats}>{album.author} · {album.count} 篇 · 更新于 {album.updated}</Text>
          </View>
        )}
        ListEmptyComponent={<StatusBlock loading={feed.loading && !feed.items.length} error={feed.error} onRetry={feed.reload} empty />}
        renderItem={({ item }) => <TopicRow topic={item} onPress={() => nav.open({ name: 'topic', topic: item })} onUnread={() => nav.open({ name: 'topic', topic: item, latest: true })} />}
        ItemSeparatorComponent={RowSeparator}
        ListFooterComponent={<ListFooter loadingMore={feed.loadingMore} hasMore={feed.hasMore} count={feed.items.length} />}
      />
    </View>
  );
}
