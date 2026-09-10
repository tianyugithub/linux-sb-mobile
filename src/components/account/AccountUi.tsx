import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { titleArt } from '../../data/title-art';
import type { TitleRarity } from '../../data/title-catalog';
import { A, RARITY_UI } from '../../theme/account';
import { registerStyleSync } from '../../theme/palette';

export { A, RARITY_UI };

export function PillTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.tabBar}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.tabScroll}
        contentContainerStyle={styles.tabs}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        contentInsetAdjustmentBehavior="never"
        overScrollMode="never"
      >
        {items.map((item) => {
          const on = item === value;
          return (
            <Pressable key={item} onPress={() => onChange(item)} style={[styles.tabItem, on && styles.tabItemOn]}>
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{item}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function FilterChips<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.filterWrap}>
      {items.map((item) => {
        const on = item === value;
        return (
          <Pressable key={item} onPress={() => onChange(item)} style={[styles.filter, on && styles.filterOn]}>
            <Text style={[styles.filterText, on && styles.filterTextOn]}>{item}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 多选版（官方「常用关键词」是一排可勾选的标签）。样式与 FilterChips 同一套。 */
export function ToggleChips<T extends string>({
  items,
  values,
  onToggle,
}: {
  items: readonly T[];
  values: readonly T[];
  onToggle: (value: T) => void;
}) {
  const active = new Set(values);
  return (
    <View style={styles.filterWrap}>
      {items.map((item) => {
        const on = active.has(item);
        return (
          <Pressable
            key={item}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => onToggle(item)}
            style={[styles.filter, on && styles.filterOn]}
          >
            <Text style={[styles.filterText, on && styles.filterTextOn]}>{item}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function GradientButton({
  label,
  sub,
  tone = 'primary',
  onPress,
  disabled,
  flex,
  block,
  compact,
}: {
  label: string;
  sub?: string;
  tone?: 'primary' | 'blue' | 'muted';
  onPress?: () => void;
  disabled?: boolean;
  flex?: boolean;
  block?: boolean;
  compact?: boolean;
}) {
  const primary = tone === 'primary';
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.btnRadius,
        compact ? styles.btnCompact : sub ? styles.btnTall : styles.btn,
        primary ? styles.btnPrimary : tone === 'blue' ? styles.btnGhost : styles.btnMuted,
        flex && styles.flex,
        block && styles.block,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.btnLabel, compact && styles.btnLabelSm, !primary && styles.btnLabelDark]}>{label}</Text>
      {sub ? <Text style={[styles.btnSub, primary ? styles.btnSubOn : styles.btnSubMuted]}>{sub}</Text> : null}
    </Pressable>
  );
}

export function OutlineButton({
  label,
  onPress,
  icon,
  flex,
  compact,
}: {
  label: string;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  flex?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.outline, compact && styles.outlineCompact, flex && styles.flex]}>
      {icon ? <Ionicons name={icon} size={16} color={A.text} /> : null}
      <Text style={styles.outlineText}>{label}</Text>
    </Pressable>
  );
}

export function SectionHead({ title, extra }: { title: string; extra?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{title}</Text>
      {extra}
    </View>
  );
}

export function AccountCard({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  return <View style={[styles.card, padded && styles.cardPad, style]}>{children}</View>;
}

export function StatStrip({
  items,
}: {
  /** tone 给数字上色（收入绿 / 支出红），hint 是数字下面的小字（可选）。 */
  items: { label: string; value: string | number; tone?: 'up' | 'down' | 'muted'; hint?: string }[];
}) {
  return (
    <View style={styles.stats}>
      {items.map((item) => (
        <View key={item.label} style={styles.stat}>
          <Text style={[
            styles.statValue,
            item.tone === 'up' ? styles.statValueUp : item.tone === 'down' ? styles.statValueDown : item.tone === 'muted' ? styles.statValueMuted : null,
          ]}>
            {item.value}
          </Text>
          <Text style={styles.statLabel}>{item.label}</Text>
          {item.hint ? <Text style={styles.statHint}>{item.hint}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function AccountInput(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={A.dim}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

export function TitleChip({
  name,
  rarity,
  owned = true,
  copies,
  active,
  compact,
  tile,
}: {
  name: string;
  rarity: TitleRarity;
  owned?: boolean;
  copies?: number;
  active?: boolean;
  compact?: boolean;
  tile?: boolean;
}) {
  const theme = RARITY_UI[rarity];
  if (tile) {
    return (
      <View style={[
        styles.tile,
        active && styles.tileOn,
        { opacity: owned ? 1 : 0.38 },
      ]}>
        <Image source={titleArt(name)} style={styles.tileArt} />
        <Text numberOfLines={1} style={styles.tileName}>{name}</Text>
        <View style={styles.tileMeta}>
          <View style={[styles.chipTag, styles.chipTagCompact, { backgroundColor: theme.tag }]}>
            <Text style={styles.chipTagText}>{rarity}</Text>
          </View>
          {copies && copies > 1 ? <Text style={styles.chipCopies}>×{copies}</Text> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={[
      styles.chip,
      compact && styles.chipCompact,
      { borderColor: active ? A.red : theme.border, backgroundColor: theme.fill, opacity: owned ? 1 : 0.42 },
      active && styles.chipOn,
    ]}>
      <Image source={titleArt(name)} style={[styles.chipArt, compact && styles.chipArtCompact]} />
      <Text numberOfLines={1} style={[styles.chipName, compact && styles.chipNameCompact]}>{name}</Text>
      <View style={[styles.chipTag, compact && styles.chipTagCompact, { backgroundColor: theme.tag }]}>
        <Text style={styles.chipTagText}>{rarity}</Text>
      </View>
      {copies && copies > 1 ? <Text style={styles.chipCopies}>×{copies}</Text> : null}
    </View>
  );
}

export function PoolCard({
  rarity,
  count,
  rate,
}: {
  rarity: TitleRarity;
  count: number;
  rate: string;
}) {
  const theme = RARITY_UI[rarity];
  return (
    <View style={styles.pool}>
      <Text style={[styles.poolRarity, { color: theme.color }]}>{rarity}</Text>
      <Text style={styles.poolCount}>{count} 种</Text>
      <Text style={[styles.poolRate, { color: theme.color }]}>{rate}</Text>
    </View>
  );
}

function createAccountStyles() {
  return StyleSheet.create({
  tabBar: { height: 44, flexGrow: 0, flexShrink: 0, backgroundColor: A.canvas, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: A.line },
  tabScroll: { flexGrow: 0, flexShrink: 0, height: 44 },
  tabs: { flexGrow: 1, flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 8, height: 44 },
  tabItem: { paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemOn: { borderBottomColor: A.red },
  tabText: { color: A.dim, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: A.red, fontWeight: '800' },
  filterWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  filter: { height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: A.cardHi, alignItems: 'center', justifyContent: 'center' },
  filterOn: { backgroundColor: 'rgba(225,37,27,0.16)' },
  filterText: { color: A.muted, fontSize: 12, fontWeight: '700' },
  filterTextOn: { color: A.red },
  flex: { flex: 1 },
  block: { alignSelf: 'stretch' },
  disabled: { opacity: 0.45 },
  btnRadius: { borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  btn: { minHeight: 40, paddingHorizontal: 16, paddingVertical: 10 },
  btnTall: { minHeight: 56, paddingHorizontal: 8, paddingVertical: 8, gap: 2 },
  btnCompact: { minHeight: 36, paddingHorizontal: 14, paddingVertical: 8 },
  btnPrimary: { backgroundColor: A.red },
  btnGhost: { backgroundColor: A.cardHi, borderWidth: 1, borderColor: A.line },
  btnMuted: { backgroundColor: A.card, borderWidth: 1, borderColor: A.line },
  btnLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
  btnLabelSm: { fontSize: 13, lineHeight: 18, color: '#FFFFFF' },
  btnLabelDark: { color: A.text },
  btnSub: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  btnSubOn: { color: 'rgba(255,255,255,0.86)' },
  btnSubMuted: { color: A.dim },
  outline: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: A.line,
    backgroundColor: A.cardHi,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  outlineText: { color: A.text, fontSize: 13, fontWeight: '700' },
  outlineCompact: { minHeight: 32, paddingHorizontal: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  section: { color: A.text, fontSize: 15, fontWeight: '800' },
  card: {
    borderRadius: 12,
    backgroundColor: A.card,
    overflow: 'hidden',
  },
  cardPad: { padding: 12, gap: 10 },
  stats: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  statValue: { color: A.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: A.dim, fontSize: 11, marginTop: 4 },
  statValueUp: { color: A.green },
  statValueDown: { color: A.red },
  statValueMuted: { color: A.dim },
  statHint: { color: A.dim, fontSize: 10, marginTop: 2 },
  input: {
    minHeight: 40,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: A.line,
    backgroundColor: A.cardHi,
    color: A.text,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 5,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    maxWidth: '100%',
    alignSelf: 'flex-start',
    overflow: 'hidden',
    position: 'relative',
  },
  chipOn: { borderWidth: 1.5, borderColor: A.red },
  chipCompact: { paddingLeft: 6, paddingRight: 3, paddingVertical: 3, borderRadius: 6, gap: 4 },
  chipArt: { width: 16, height: 16 },
  chipArtCompact: { width: 14, height: 14 },
  chipName: { color: A.text, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  chipNameCompact: { fontSize: 11 },
  chipTag: { minWidth: 28, height: 18, paddingHorizontal: 6, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  chipTagCompact: { minWidth: 24, height: 14, paddingHorizontal: 5, borderRadius: 2 },
  chipTagText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  chipCopies: { color: A.muted, fontSize: 10, fontWeight: '800', paddingRight: 2 },
  tile: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: A.cardHi,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tileOn: { borderColor: A.red },
  tileArt: { width: 44, height: 44 },
  tileName: { color: A.text, fontSize: 12, fontWeight: '700', textAlign: 'center', width: '100%' },
  tileMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pool: {
    flex: 1,
    minHeight: 64,
    borderRadius: 8,
    backgroundColor: A.cardHi,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  poolRarity: { fontSize: 14, fontWeight: '800' },
  poolCount: { color: A.muted, fontSize: 10, fontWeight: '700' },
  poolRate: { fontSize: 11, fontWeight: '800' },
  });
}

let styles = createAccountStyles();
registerStyleSync(() => {
  styles = createAccountStyles();
});
