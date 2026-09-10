import React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { HubHero, Icon, PrimaryButton, ScreenHeader, StatusBlock, UserAvatar } from '../components/ui';
import { copyText } from '../utils/share';

export function InviteScreen() {
  const nav = useNav();
  const query = useAsync(async () => {
    if (!nav.loggedIn) return null;
    return api.invites();
  }, [nav.loggedIn], `invites:${nav.loggedIn ? '1' : '0'}`);
  const data = query.data;

  if (!nav.loggedIn) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="邀请中心" />
        <View style={styles.empty}>
          <Icon name="gift-outline" size={36} color={C.dim} />
          <Text style={styles.emptyTitle}>登录后查看分享链接</Text>
          <PrimaryButton label="登录" onPress={() => nav.open({ name: 'login' })} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="邀请中心" />
      <ScrollView
        contentContainerStyle={styles.hubPage}
        refreshControl={<RefreshControl refreshing={Boolean(query.fetching && data)} onRefresh={query.reload} tintColor={C.muted} />}
      >
        {query.loading && !data ? <StatusBlock loading error={query.error} onRetry={query.reload} /> : null}
        {query.error && !data ? <StatusBlock error={query.error} onRetry={query.reload} /> : null}
        {data ? (
          <>
            <HubHero
              kicker="INVITE"
              title={data.title}
              lead={data.lead}
              icon="gift-outline"
              colors={['#3A2410', '#B45309', '#F5A623']}
              awards={[
                { label: '首奖', value: `+${data.firstAward}` },
                { label: '二奖', value: `+${data.secondAward}` },
              ]}
            />

            <View style={styles.hubCard}>
              <Text style={styles.hubCardTitle}>{data.linkTitle}</Text>
              <View style={styles.ivLinkBox}>
                <Text selectable style={styles.ivLinkText}>{data.link || '登录后生成分享链接'}</Text>
              </View>
              <PrimaryButton
                block
                label={data.copyLabel}
                onPress={async () => {
                  if (!data.link) {
                    nav.toast('暂无分享链接');
                    return;
                  }
                  await copyText(data.link);
                  nav.toast('邀请链接已复制');
                }}
              />
            </View>

            <View style={[styles.hubCard, styles.ivStatsCard]}>
              <View style={styles.ivStat}>
                <Text style={styles.ivStatValue}>{data.invited}</Text>
                <Text style={styles.ivStatLabel}>{data.invitedLabel}</Text>
              </View>
              <View style={styles.ivStatSplit} />
              <View style={styles.ivStat}>
                <Text style={styles.ivStatValue}>{data.firstPoints}</Text>
                <Text style={styles.ivStatLabel}>{data.firstLabel}</Text>
              </View>
              <View style={styles.ivStatSplit} />
              <View style={styles.ivStat}>
                <Text style={styles.ivStatValue}>{data.secondPoints}</Text>
                <Text style={styles.ivStatLabel}>{data.secondLabel}</Text>
              </View>
            </View>

            <View style={styles.hubCard}>
              <Text style={styles.hubCardTitle}>{data.listTitle}</Text>
              {data.guests.length ? data.guests.map((item) => (
                <Pressable
                  key={`${item.userId}-${item.name}`}
                  onPress={() => {
                    if (item.userId) nav.openUser(item.userId);
                  }}
                  style={styles.ivGuest}
                >
                  <UserAvatar name={item.name} url={item.avatar.includes('/') ? item.avatar : undefined} accent={item.accent} />
                  <View style={styles.flexGrow}>
                    <Text style={styles.rankName}>{item.name}</Text>
                    {item.note ? <Text style={styles.meta}>{item.note}</Text> : null}
                  </View>
                  {item.userId ? <Icon name="chevron-forward" size={16} color={C.dim} /> : null}
                </Pressable>
              )) : (
                <View style={styles.ivEmpty}>
                  <Icon name="people-outline" size={28} color={C.dim} />
                  <Text style={styles.hubEmptyHint}>{data.empty}</Text>
                </View>
              )}
            </View>

            {data.rule ? (
              <View style={styles.ivRule}>
                <Icon name="warning-outline" size={16} color={C.orange} />
                <Text style={styles.ivRuleText}>{data.rule}</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
