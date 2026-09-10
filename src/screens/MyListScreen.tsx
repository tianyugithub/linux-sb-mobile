import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { api, mapTopic } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { Icon, PrimaryButton, ScreenHeader, StatusBlock,
  RowSeparator,
} from '../components/ui';
import { TopicRow } from '../components/TopicRow';

export function MyListScreen({ kind }: { kind: 'topics' | 'replies' | 'saved' }) {
  const nav = useNav();
  const title = kind === 'topics' ? '我的主题' : kind === 'replies' ? '我的回帖' : '我的收藏';
  const query = useAsync(async () => {
    if (!nav.loggedIn) return [];
    if (kind === 'topics') return (await api.userTopics(nav.me.id)).items.map(mapTopic);
    if (kind === 'replies') return (await api.userReplies(nav.me.id)).items.map(mapTopic);
    return (await api.userFavorites(nav.me.id)).items.map(mapTopic);
  }, [kind, nav.loggedIn, nav.me.id]);
  return (
    <View style={styles.flex}>
      <ScreenHeader title={title} />
      <FlatList
        data={nav.loggedIn ? (query.data ?? []) : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.feedContent}
        renderItem={({ item }) => <TopicRow topic={item} onPress={() => nav.open({ name: 'topic', topic: item })} onUnread={() => nav.open({ name: 'topic', topic: item, latest: true })} />}
        ItemSeparatorComponent={RowSeparator}
        ListEmptyComponent={(
          query.loading && !query.data
            ? <StatusBlock loading error={query.error} onRetry={query.reload} />
            : query.error
            ? <StatusBlock error={query.error} onRetry={query.reload} />
            : (
              <View style={styles.emptyPage}>
                <Icon name="file-tray-outline" size={34} color={C.dim} />
                <Text style={styles.emptyTitle}>{nav.loggedIn ? '还没有内容' : '登录后查看'}</Text>
                {!nav.loggedIn ? <PrimaryButton label="去登录" onPress={() => nav.open({ name: 'login' })} /> : null}
              </View>
            )
        )}
      />
    </View>
  );
}
