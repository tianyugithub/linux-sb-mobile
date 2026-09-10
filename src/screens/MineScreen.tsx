import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { ImageBackground, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Cell, ConfigProvider, Grid, GridItem } from '@nutui/nutui-react-native';
import type { Member } from '../../data';
import type { IonName } from '../../data';
import { TitleBadges } from '../components/TitleBadge';
import { UserAvatar } from '../components/ui';
import { C, registerStyleSync, type Palette } from '../theme/palette';
import { nutThemeFor } from '../theme/nut-mine';

const HERO_BG = require('../../assets/mine-hero.png');

type MineActions = {
  me: Member;
  loggedIn: boolean;
  checkedIn: boolean;
  unread: number;
  onLogin: () => void;
  onSettings: () => void;
  onUser: () => void;
  onCheckin: () => void;
  onLeaderboard: () => void;
  onTitles: () => void;
  onMyTitles: () => void;
  onTitlePress: () => void;
  onInvite: () => void;
  onCollections: () => void;
  onIdentity: () => void;
  onMyTopics: () => void;
  onMyReplies: () => void;
  onInbox: () => void;
  onSaved: () => void;
  onMessages: () => void;
  onSignOut: () => void;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
};

const GLYPH_TONE = {
  gold: { dark: { bg: '#3D2A12', fg: '#F5A623' }, light: { bg: '#FFF4E0', fg: '#C47B12' } },
  blue: { dark: { bg: '#1F3348', fg: '#6FA8FF' }, light: { bg: '#E8F1FF', fg: '#2F6FE4' } },
  green: { dark: { bg: '#1E3A32', fg: '#34D399' }, light: { bg: '#E8F7F0', fg: '#178F45' } },
  pink: { dark: { bg: '#3A2436', fg: '#F472B6' }, light: { bg: '#FDE8F3', fg: '#DB2777' } },
  purple: { dark: { bg: '#2A2F48', fg: '#A78BFA' }, light: { bg: '#EEE8FF', fg: '#7C3AED' } },
  rose: { dark: { bg: '#3A2430', fg: '#FB7185' }, light: { bg: '#FFE8EE', fg: '#E1251B' } },
  orange: { dark: { bg: '#3A2414', fg: '#FB923C' }, light: { bg: '#FFF0E6', fg: '#EA580C' } },
  gray: { dark: { bg: '#243044', fg: '#94A3B8' }, light: { bg: '#EEF1F4', fg: '#5E6672' } },
} as const;

type GlyphTone = keyof typeof GLYPH_TONE;

function Glyph({ name, tone }: { name: IonName; tone: GlyphTone }) {
  const { bg, fg } = GLYPH_TONE[tone][C.scheme === 'light' ? 'light' : 'dark'];
  return (
    <View style={[styles.glyph, { backgroundColor: bg }]}>
      <Ionicons name={name} size={20} color={fg} />
    </View>
  );
}

function Stat({
  value,
  label,
  onPress,
}: {
  value: string | number;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

function Card({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{title}</Text>
        {extra}
      </View>
      {children}
    </View>
  );
}

function MineBody(props: MineActions) {
  const { me, loggedIn, checkedIn, unread, refreshing, onRefresh } = props;
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? (
        <RefreshControl
          refreshing={Boolean(refreshing)}
          onRefresh={() => { void onRefresh(); }}
          tintColor="#E1251B"
          colors={['#E1251B']}
        />
      ) : undefined}
    >
      <ImageBackground source={HERO_BG} resizeMode="cover" style={styles.hero} imageStyle={styles.heroImage}>
        <View style={styles.heroTop}>
          <View style={styles.identity}>
            <Pressable onPress={loggedIn ? props.onUser : props.onLogin} hitSlop={6}>
              {/* 头像复用共用组件：站内默认头像是 SVG，组件内部已经处理；登录后带在线圆点 */}
              <View style={styles.avatarRing}>
                <UserAvatar
                  name={me.name}
                  url={me.avatarUrl}
                  accent={loggedIn ? me.accent : '#2B2B2B'}
                  size={60}
                  radius={30}
                  online={loggedIn}
                  dotRing="rgba(255,255,255,0.9)"
                />
              </View>
            </Pressable>
            <View style={styles.identityText}>
              <Pressable onPress={loggedIn ? props.onUser : props.onLogin} style={styles.nameRow} hitSlop={6}>
                <Text numberOfLines={1} style={styles.name}>{me.name}</Text>
                {loggedIn ? <Ionicons name="chevron-forward" size={16} color="#666" /> : null}
              </Pressable>
              {loggedIn ? (
                <View style={styles.badgeRow}>
                  <TitleBadges title={me.title} groupLabel={me.groupLabel} size="sm" onPress={props.onTitlePress} />
                  <Pressable onPress={props.onUser} hitSlop={6}>
                    <Text style={styles.uid}>UID {me.uid}</Text>
                  </Pressable>
                </View>
              ) : (
                <Text style={styles.guestHint}>登录后同步主题、收藏和积分</Text>
              )}
            </View>
          </View>
          {loggedIn ? (
            <Pressable onPress={props.onSettings} hitSlop={10} style={styles.settingsBtn}>
              <Ionicons name="settings-outline" size={20} color="#1A1A1A" />
            </Pressable>
          ) : (
            <Pressable onPress={props.onLogin} style={styles.loginChip}>
              <Text style={styles.loginChipText}>登录</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.stats}>
          <Stat value={me.points} label="积分" onPress={props.onLeaderboard} />
          <Stat value={me.topicCount} label="主题" onPress={props.onMyTopics} />
          <Stat value={me.replyCount} label="回帖" onPress={props.onMyReplies} />
          <Stat value={unread} label="未读" onPress={props.onMessages} />
        </View>
        <LinearGradient colors={[C.fade, C.canvas]} style={styles.heroFade} pointerEvents="none" />
      </ImageBackground>

      <View style={styles.sheet}>
        <Card
          title="我的帖务"
          extra={(
            <Pressable onPress={props.onMyTopics} style={styles.more}>
              <Text style={styles.moreText}>全部主题</Text>
              <Ionicons name="chevron-forward" size={12} color={C.dim} />
            </Pressable>
          )}
        >
          <Grid columnNum={5} border={false}>
            <GridItem
              icon={<Glyph name="calendar" tone="gold" />}
              text={checkedIn ? '已签到' : '待签到'}
              onPress={props.onCheckin}
            />
            <GridItem icon={<Glyph name="document-text" tone="blue" />} text="我的主题" onPress={props.onMyTopics} />
            <GridItem icon={<Glyph name="chatbubbles" tone="green" />} text="我的回帖" onPress={props.onMyReplies} />
            <GridItem icon={<Glyph name="bookmark" tone="pink" />} text="我的收藏" onPress={props.onSaved} />
            <GridItem icon={<Glyph name="mail" tone="purple" />} text="我的私信" onPress={props.onInbox} />
          </Grid>
        </Card>

        <Card title="积分资产">
          <Grid columnNum={4} border={false}>
            <GridItem
              icon={<Text style={styles.assetNum}>{me.points}</Text>}
              text="我的积分"
              onPress={props.onLeaderboard}
            />
            <GridItem icon={<Glyph name="ribbon" tone="gold" />} text="我的称号" onPress={props.onMyTitles} />
            <GridItem icon={<Glyph name="albums" tone="blue" />} text="淘帖专辑" onPress={props.onCollections} />
            <GridItem icon={<Glyph name="ticket" tone="rose" />} text="邀请中心" onPress={props.onInvite} />
          </Grid>
        </Card>

        <Card title="工具与服务">
          <Grid columnNum={4} border={false}>
            <GridItem icon={<Glyph name="trophy" tone="gold" />} text="用户榜单" onPress={props.onLeaderboard} />
            <GridItem icon={<Glyph name="person-add" tone="blue" />} text="邀请中心" onPress={props.onInvite} />
            <GridItem icon={<Glyph name="rocket" tone="orange" />} text="称号中心" onPress={props.onTitles} />
            <GridItem icon={<Glyph name="folder-open" tone="green" />} text="淘帖中心" onPress={props.onCollections} />
            <GridItem icon={<Glyph name="shield-checkmark" tone="purple" />} text="认证中心" onPress={props.onIdentity} />
            <GridItem
              icon={(
                <View>
                  <Glyph name="notifications" tone="rose" />
                  {unread > 0 ? <View style={styles.unreadDot} /> : null}
                </View>
              )}
              text="我的通知"
              onPress={props.onMessages}
            />
            <GridItem icon={<Glyph name="person" tone="gray" />} text="个人主页" onPress={loggedIn ? props.onUser : props.onLogin} />
            <GridItem icon={<Glyph name="settings" tone="gray" />} text="设置" onPress={props.onSettings} />
          </Grid>
        </Card>

        <View style={styles.card}>
          <Cell title="个人设置" isLink center onClick={props.onSettings} />
          {loggedIn ? (
            <Cell title="退出登录" isLink center onClick={props.onSignOut} />
          ) : (
            <Cell title="登录账号" isLink center onClick={props.onLogin} />
          )}
        </View>
        <Text style={styles.version}>LINUX SB · v0.1.0</Text>
      </View>
    </ScrollView>
  );
}

export function MineScreen(props: MineActions) {
  return (
    <ConfigProvider theme={nutThemeFor(C.scheme)}>
      <MineBody {...props} />
    </ConfigProvider>
  );
}

function createMineStyles(C: Palette) {
  return StyleSheet.create({
  page: { flex: 1, backgroundColor: C.canvas },
  content: { paddingBottom: 28 },
  hero: { overflow: 'hidden', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 44 },
  heroImage: { resizeMode: 'cover' },
  heroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 40 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  avatarRing: { width: 64, height: 64, borderRadius: 32, padding: 2, backgroundColor: 'rgba(255,255,255,0.9)' },
  avatarFill: { flex: 1, borderRadius: 30, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: 60, height: 60, borderRadius: 30 },
  avatarLetter: { color: '#fff', fontSize: 22, fontWeight: '800' },
  identityText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { color: '#1A1A1A', fontSize: 20, fontWeight: '800', flexShrink: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  uid: { color: '#666666', fontSize: 11 },
  guestHint: { color: '#555555', fontSize: 12, marginTop: 6 },
  settingsBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center' },
  loginChip: { height: 32, paddingHorizontal: 16, borderRadius: 16, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  loginChipText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  stats: { flexDirection: 'row', marginTop: 22 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: '#1A1A1A', fontSize: 20, fontWeight: '800' },
  statLabel: { color: '#666666', fontSize: 11, marginTop: 4 },
  sheet: { marginTop: -28, paddingHorizontal: 12, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 12, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreText: { color: C.dim, fontSize: 12 },
  glyph: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  assetNum: { color: C.text, fontSize: 20, fontWeight: '800', lineHeight: 40, minWidth: 40, textAlign: 'center' },
  unreadDot: { position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 4, backgroundColor: C.red, borderWidth: 2, borderColor: C.card },
  version: { color: C.dim, textAlign: 'center', fontSize: 11, marginTop: 8, marginBottom: 12 },
  });
}

let styles = createMineStyles(C);
registerStyleSync(() => {
  styles = createMineStyles(C);
});
