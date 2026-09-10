import React, { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { Member } from '../../data';
import { api, mapTopic, mapUser } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { Icon, ScreenHeader, StatusBlock, UserAvatar, RowSeparator } from '../components/ui';
import { TitleBadges } from '../components/TitleBadge';
import { TopicRow } from '../components/TopicRow';
import { copyText } from '../utils/share';

const TABS = ['主题', '回帖', '收藏'] as const;
type UserTab = typeof TABS[number];

export function UserScreen({ member }: { member: Member }) {
  const nav = useNav();
  const [tab, setTab] = useState<UserTab>('主题');
  const profile = useAsync(() => api.user(member.id).then(mapUser), [member.id], `user:${member.id}`);
  const current = profile.data ?? member;
  const mine = nav.loggedIn && nav.me.id === current.id;
  const query = useAsync(async () => {
    if (tab === '主题') return (await api.userTopics(member.id)).items.map(mapTopic);
    if (tab === '回帖') return (await api.userReplies(member.id)).items.map(mapTopic);
    if (mine) return (await api.userFavorites(member.id)).items.map(mapTopic);
    return (await api.userTopics(member.id)).items.map(mapTopic).filter((item) => item.featured);
  }, [tab, member.id, mine]);
  const emptyCopy = tab === '主题' ? '还没有主题' : tab === '回帖' ? '还没有回帖' : mine ? '还没有收藏' : '没有公开的精华主题';
  const refresh = () => {
    profile.reload();
    query.reload();
  };
  const openDm = () => nav.open({ name: 'dm', userId: current.id, title: current.name });
  const copyUid = () => {
    const uid = String(current.uid || '').trim();
    if (!uid) return;
    void copyText(uid).then(() => nav.toast('已复制 UID'));
  };
  return (
    <View style={styles.flex}>
      <ScreenHeader
        title={current.name}
        right={!mine && nav.loggedIn ? (
          <Pressable onPress={openDm} hitSlop={8} accessibilityLabel="私信">
            <Icon name="mail-outline" size={20} color={C.muted} />
          </Pressable>
        ) : undefined}
      />
      <FlatList
        data={query.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.feedContent}
        onRefresh={refresh}
        refreshing={Boolean((profile.fetching || query.fetching) && (profile.data || query.data))}
        ListHeaderComponent={(
          <>
            <View style={styles.userHero}>
              <View style={styles.userIdentity}>
                <UserAvatar name={current.name} url={current.avatarUrl} accent={current.accent} size={64} radius={32} online={Boolean(current.online)} dotRing={C.surface} />
                <View style={styles.userIdentityText}>
                  <Text numberOfLines={1} style={styles.userName}>{current.name}</Text>
                  <TitleBadges title={current.title} groupLabel={current.groupLabel} size="md" onPress={() => nav.open({ name: 'titles', tab: '称号抽取' })} />
                  <Pressable onPress={copyUid} hitSlop={6} accessibilityLabel="复制 UID">
                    <Text style={styles.userUid}>UID {current.uid} · 复制</Text>
                  </Pressable>
                </View>
              </View>
              {current.bio ? <Text selectable style={styles.userBio}>{current.bio}</Text> : null}
              <View style={styles.userStats}>
                <View style={styles.userStat}>
                  <Text style={styles.userStatValue}>{current.points}</Text>
                  <Text style={styles.userStatLabel}>积分</Text>
                </View>
                <View style={styles.userStatSplit} />
                <Pressable onPress={() => setTab('主题')} style={styles.userStat}>
                  <Text style={styles.userStatValue}>{current.topicCount}</Text>
                  <Text style={styles.userStatLabel}>主题</Text>
                </Pressable>
                <View style={styles.userStatSplit} />
                <Pressable onPress={() => setTab('回帖')} style={styles.userStat}>
                  <Text style={styles.userStatValue}>{current.replyCount}</Text>
                  <Text style={styles.userStatLabel}>回帖</Text>
                </Pressable>
              </View>
              {current.joined && current.joined !== '-' ? (
                <Text style={styles.userJoined}>{current.joined} 加入</Text>
              ) : null}
              {!mine && nav.loggedIn ? (
                <Pressable onPress={openDm} style={styles.userMsgBtn} accessibilityLabel="发私信">
                  <Icon name="chatbubble-ellipses-outline" size={16} color="#fff" />
                  <Text style={styles.userMsgText}>发私信</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.userTabs}>
              {TABS.map((item) => {
                const on = tab === item;
                const count = item === '主题' ? current.topicCount : item === '回帖' ? current.replyCount : undefined;
                return (
                  <Pressable key={item} onPress={() => setTab(item)} style={[styles.userTab, on && styles.userTabOn]}>
                    <Text style={[styles.userTabText, on && styles.userTabTextOn]}>{item}</Text>
                    {count != null ? (
                      <Text style={[styles.userTabCount, on && styles.userTabCountOn]}>{count}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
        ListEmptyComponent={(
          <StatusBlock
            loading={query.loading && !query.data}
            error={query.error}
            onRetry={query.reload}
            empty
            emptyTitle={emptyCopy}
          />
        )}
        renderItem={({ item }) => (
          <TopicRow
            topic={item}
            onPress={() => nav.open({ name: 'topic', topic: item })}
            onUnread={() => nav.open({ name: 'topic', topic: item, latest: true })}
          />
        )}
        ItemSeparatorComponent={RowSeparator}
      />
    </View>
  );
}
