import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  TITLE_RARITY_THEME,
  catalogTitleIn,
  isRoleTitle,
  roleTitleTheme,
  titleDef,
  titleHasShine,
  titleRarityOf,
  type TitleRarity,
} from '../data/title-catalog';
import { titleArt } from '../data/title-art';
import { RARITY_UI } from '../theme/account';
import { TitleShine } from './TitleShine';

type Size = 'sm' | 'md' | 'lg';

const SIZE = {
  sm: { icon: 12, pad: 2, gap: 3, radius: 6, font: 10, height: 18, tag: 12, tagFont: 7 },
  md: { icon: 14, pad: 3, gap: 4, radius: 7, font: 11, height: 22, tag: 14, tagFont: 8 },
  lg: { icon: 22, pad: 5, gap: 6, radius: 10, font: 13, height: 32, tag: 16, tagFont: 9 },
};

function displayTitle(name?: string | null): string {
  const raw = (name ?? '').trim();
  if (!raw || raw === '未登录' || raw === '饼友') return '';
  return titleDef(raw)?.name || catalogTitleIn(raw) || raw;
}

export function TitleBadge({
  name,
  rarity,
  serial,
  size = 'sm',
  showName = true,
  showRarity = true,
  showSerial = false,
  compact = false,
}: {
  name?: string | null;
  rarity?: TitleRarity;
  serial?: string | null;
  size?: Size;
  showName?: boolean;
  showRarity?: boolean;
  showSerial?: boolean;
  compact?: boolean;
  wide?: boolean;
}) {
  const title = displayTitle(name);
  if (!title) return null;
  const role = isRoleTitle(title);
  const box = SIZE[size];
  if (role) {
    const theme = roleTitleTheme(title);
    return (
      <View
        style={[
          styles.badge,
          compact ? styles.badgeCompact : styles.badgeShrink,
          compact && styles.badgeRoleCompact,
          {
            minHeight: box.height,
            paddingHorizontal: box.pad + (compact ? 4 : 5),
            paddingVertical: box.pad,
            borderRadius: box.radius,
            gap: box.gap,
            backgroundColor: theme.fill,
            borderColor: theme.border,
          },
        ]}
      >
        {(title === '创作者' || title === '建设者' || title === '伪装者') ? (
          <Image source={titleArt(title)} style={{ width: Math.max(14, box.icon), height: Math.max(14, box.icon) }} />
        ) : null}
        {showName ? (
          <Text numberOfLines={1} style={[styles.name, { color: theme.color, fontSize: box.font }]}>{title}</Text>
        ) : null}
        {titleHasShine(title) ? <TitleShine gold={title === '建设者'} /> : null}
      </View>
    );
  }
  const tier = rarity ?? titleRarityOf(title);
  const theme = TITLE_RARITY_THEME[tier];
  const ui = RARITY_UI[tier];
  const number = (serial ?? '').trim();
  const serialText = showSerial && tier === 'UR' && /^\d+$/.test(number) ? number.padStart(3, '0') : '';
  return (
    <View
      style={[
        styles.badge,
        compact ? styles.badgeCompact : styles.badgeShrink,
        {
          minHeight: box.height,
          paddingHorizontal: box.pad + (compact ? 3 : 4),
          paddingVertical: box.pad,
          borderRadius: box.radius,
          gap: box.gap,
          backgroundColor: ui.fill,
          borderColor: theme.border,
        },
      ]}
    >
      <Image source={titleArt(title)} style={{ width: box.icon, height: box.icon }} />
      {showName ? (
        <Text numberOfLines={1} style={[styles.name, { color: theme.color, fontSize: box.font }]}>{title}</Text>
      ) : null}
      {serialText ? (
        <View style={[styles.serialBox, { height: box.tag, minWidth: box.tag + 8, borderRadius: 4 }]}>
          <Text style={[styles.serialText, { fontSize: box.tagFont }]}>{serialText}</Text>
        </View>
      ) : null}
      {showRarity ? (
        <View style={[styles.tag, { height: box.tag, minWidth: box.tag + 8, borderRadius: box.tag / 2, backgroundColor: ui.tag }]}>
          <Text style={[styles.tagText, { fontSize: box.tagFont }]}>{tier}</Text>
        </View>
      ) : null}
      {titleHasShine(title, tier) ? <TitleShine gold /> : null}
    </View>
  );
}

export function TitleBadges({
  title,
  groupLabel,
  serial,
  size = 'sm',
  showSerial = false,
  nowrap = false,
  compact = false,
  onPress,
}: {
  title?: string | null;
  groupLabel?: string | null;
  serial?: string | null;
  size?: Size;
  showSerial?: boolean;
  nowrap?: boolean;
  compact?: boolean;
  onPress?: () => void;
}) {
  const gacha = displayTitle(title);
  const gachaName = gacha && !isRoleTitle(gacha) ? gacha : '';
  const roleFromTitle = gacha && isRoleTitle(gacha) ? gacha : '';
  const roleFromGroup = isRoleTitle(groupLabel) ? String(groupLabel).trim() : '';
  const roleName = roleFromGroup || roleFromTitle;
  const items: { name: string; serial?: string; showSerial: boolean }[] = [];
  if (compact) {
    if (roleName) items.push({ name: roleName, showSerial: false });
    if (gachaName && gachaName !== roleName) items.push({ name: gachaName, serial: serial ?? undefined, showSerial });
  } else {
    if (gachaName) items.push({ name: gachaName, serial: serial ?? undefined, showSerial });
    if (roleName && roleName !== gachaName) items.push({ name: roleName, showSerial: false });
  }
  if (!items.length) return null;
  const nodes = items.map((item) => {
    const badge = (
      <TitleBadge
        name={item.name}
        serial={item.serial}
        size={size}
        showSerial={item.showSerial}
        compact={compact}
      />
    );
    if (onPress && !isRoleTitle(item.name)) {
      return (
        <Pressable key={item.name} onPress={onPress} hitSlop={6} style={compact ? styles.badgeHitFixed : undefined}>
          {badge}
        </Pressable>
      );
    }
    return <View key={item.name} style={compact ? styles.badgeHitFixed : undefined}>{badge}</View>;
  });
  return (
    <View style={[styles.badges, (nowrap || compact) && styles.badgesNowrap, compact && styles.badgesCompact]}>
      {nodes}
    </View>
  );
}

export function TitleMark({ name, size = 28, rarity }: { name?: string | null; size?: number; rarity?: TitleRarity }) {
  const title = displayTitle(name);
  if (title === '创作者' || title === '建设者' || title === '伪装者') {
    return <Image source={titleArt(title)} style={{ width: size, height: size }} />;
  }
  if (!title || isRoleTitle(title)) return null;
  const tier = rarity ?? titleRarityOf(title);
  const theme = TITLE_RARITY_THEME[tier];
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size * 0.28, borderColor: theme.border, backgroundColor: 'transparent' }]}>
      <Image source={titleArt(title)} style={{ width: size - 4, height: size - 4 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  badgeShrink: { flexShrink: 1, maxWidth: '100%' },
  badgeCompact: { flexShrink: 0 },
  badgeRoleCompact: { flexShrink: 0 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  badgesNowrap: { flexWrap: 'nowrap' },
  badgesCompact: { flexShrink: 0, gap: 4 },
  badgeHitFixed: { flexShrink: 0 },
  name: { fontWeight: '800' },
  serialBox: { paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFE9A3' },
  serialText: { color: '#1F1400', fontWeight: '900', letterSpacing: 0.3 },
  tag: { paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  tagText: { color: '#fff', fontWeight: '800' },
  mark: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1 },
});
