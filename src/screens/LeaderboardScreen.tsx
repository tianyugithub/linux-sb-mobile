import React, { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { RankRow } from '../../data';
import { api, mapRank } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { HubChips, HubHero, ScreenHeader, StatusBlock, UserAvatar } from '../components/ui';

import { LEADERBOARD_TABS as TABS } from '../data/feed-nav';

export const LEADERBOARD_TABS = TABS.map((tab) => tab.label);

function rankTone(rank: number) {
  if (rank === 1) return { ring: '#E7C15A', fill: 'rgba(231,193,90,0.18)', text: '#E7C15A' };
  if (rank === 2) return { ring: '#C8D0DC', fill: 'rgba(200,208,220,0.16)', text: '#C8D0DC' };
  if (rank === 3) return { ring: '#D0925A', fill: 'rgba(208,146,90,0.16)', text: '#D0925A' };
  return { ring: C.line, fill: C.surface, text: C.dim };
}

function RankItem({ item, onPress }: { item: RankRow; onPress: () => void }) {
  const tone = rankTone(item.rank);
  return (
    <Pressable onPress={onPress} style={styles.lbRow}>
      <Text numberOfLines={1} style={[styles.rankIndex, { color: tone.text }]}>{item.rank}</Text>
      <UserAvatar name={item.name} url={item.avatarUrl} accent={item.accent} />
      <View style={styles.flexGrow}>
        <Text numberOfLines={1} style={styles.rankName}>{item.name}</Text>
        <Text style={styles.meta}>{item.group}</Text>
      </View>
      <Text style={styles.rankValue}>{item.value}</Text>
    </Pressable>
  );
}

export function LeaderboardScreen() {
  const nav = useNav();
  const [tab, setTab] = useState<(typeof LEADERBOARD_TABS)[number]>('富豪榜');
  const query = useAsync(async () => {
    const result = await api.leaderboard(tab);
    return {
      subtitle: result.subtitle,
      items: result.items.map(mapRank),
      self: result.self ? mapRank(result.self) : null,
    };
  }, [tab], `leaderboard:${tab}`);
  const items = query.data?.items ?? [];
  const podium = [2, 1, 3].map((rank) => items.find((item) => item.rank === rank)).filter(Boolean) as RankRow[];
  const list = items.filter((item) => item.rank > 3);
  const openUser = (item: RankRow) => nav.openUser(item.userId ?? item.name);
  return (
    <View style={styles.flex}>
      <ScreenHeader title="用户榜单" />
      <FlatList
        data={list}
        keyExtractor={(item) => item.userId || item.name + item.rank}
        contentContainerStyle={styles.lbList}
        onRefresh={query.reload}
        refreshing={Boolean(query.fetching && query.data)}
        ListEmptyComponent={<StatusBlock loading={query.loading && !query.data} error={query.error} onRetry={query.reload} empty />}
        ListHeaderComponent={(
          <View style={styles.lbHead}>
            <HubHero
              kicker="RANKING"
              title="用户榜单"
              lead={query.data?.subtitle || '社区成员实时排名'}
              icon="trophy-outline"
              colors={['#121A2C', '#1E3A5F', '#3D6BB3']}
            />
            <HubChips items={LEADERBOARD_TABS} value={tab} onChange={setTab} />
            {podium.length ? (
              <View style={styles.lbPodium}>
                {podium.map((item) => {
                  const first = item.rank === 1;
                  const tone = rankTone(item.rank);
                  return (
                    <Pressable
                      key={item.userId || item.rank}
                      onPress={() => openUser(item)}
                      style={[styles.lbPodiumCol, first && styles.lbPodiumCol1]}
                    >
                      <View style={[styles.lbRing, { borderColor: tone.ring, backgroundColor: tone.fill }]}>
                        <UserAvatar
                          name={item.name}
                          url={item.avatarUrl}
                          accent={item.accent}
                          size={first ? 64 : 48}
                          radius={first ? 32 : 24}
                        />
                      </View>
                      <Text numberOfLines={1} style={styles.lbPodiumName}>{item.name}</Text>
                      <Text numberOfLines={1} style={styles.lbPodiumMeta}>{item.group}</Text>
                      <Text numberOfLines={1} style={styles.lbPodiumValue}>{item.value}</Text>
                      <View style={[styles.lbStep, { backgroundColor: tone.ring }]}>
                        <Text style={styles.lbStepText}>{item.rank}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        )}
        renderItem={({ item }) => <RankItem item={item} onPress={() => openUser(item)} />}
      />
      {query.data?.self ? (
        <Pressable onPress={() => openUser(query.data!.self!)} style={styles.lbSelf}>
          <Text numberOfLines={1} style={[styles.rankIndex, { color: rankTone(query.data.self.rank).text }]}>{query.data.self.rank}</Text>
          <UserAvatar name={query.data.self.name} url={query.data.self.avatarUrl} accent={query.data.self.accent} />
          <View style={styles.flexGrow}>
            <Text numberOfLines={1} style={styles.rankName}>{query.data.self.name}</Text>
            <Text style={styles.meta}>{query.data.self.group}</Text>
          </View>
          <Text style={styles.rankValue}>{query.data.self.value}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
