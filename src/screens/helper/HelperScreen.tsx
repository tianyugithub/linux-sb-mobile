import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { IonName } from '../../../data';
import { C, GRADIENTS } from '../../theme/palette';
import { styles } from '../../theme/app-styles';
import { useNav } from '../../navigation/nav';
import { usePrefs } from '../../hooks/usePrefs';
import { AccountCard, OutlineButton, RARITY_UI, SectionHead, StatStrip, TitleChip } from '../../components/account/AccountUi';
import { HubHero, Icon, PrimaryButton, ScreenHeader, StatusBlock } from '../../components/ui';
import type { TitleRarity } from '../../data/title-catalog';
import { isPluginEnabled, pluginById, type PluginModuleDef } from '../../plugins/registry';
import { HelperPointsPane } from './HelperPointsPane';
import { HelperSynthPane } from './HelperSynthPane';
import { HelperMarketPane } from './HelperMarketPane';
import { HelperLuckyPane } from './HelperLuckyPane';

const MODULE_LABELS = ['积分账本', '称号合成', '称号监控', '幸运打赏'] as const;
type HelperTab = (typeof MODULE_LABELS)[number];

/**
 * 饼友助手（第三方插件）。
 *
 * 结构：渐变 hero（四个模块的即时数字）+ 2×2 模块砖 → 选中模块的详情。
 * 用到的件全部来自 App 既有 UI：HubHero / StatStrip / TitleChip / RARITY_UI / AccountCard。
 */
export function HelperScreen() {
  const nav = useNav();
  const prefs = usePrefs();
  const plugin = pluginById('helper');
  const enabled = isPluginEnabled(prefs.plugins, 'helper');
  const [tab, setTab] = useState<HelperTab>('积分账本');
  const [busy, setBusy] = useState(false);
  /** hero 里的四个数字由各面板回填，首屏不必把两套数据都抓一遍。 */
  const [digest, setDigest] = useState<Record<string, string>>({});
  const modules = useMemo(() => plugin?.modules ?? [], [plugin]);
  const activeModule = modules.find((item) => item.name === tab) ?? modules[0];
  const setDigestValue = (id: string) => (value: string) => setDigest((prev) => (prev[id] === value ? prev : { ...prev, [id]: value }));

  if (!plugin) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="插件" />
        <StatusBlock empty emptyTitle="插件不存在" />
      </View>
    );
  }

  const hero = (
    <HubHero
      kicker="PLUGIN · 第三方"
      title={plugin.name}
      lead="积分账本 · 称号合成 · 称号监控 · 幸运打赏，全部在本机计算"
      icon={plugin.icon as IonName}
      colors={GRADIENTS.brand}
      awards={modules.map((module) => ({ label: module.name, value: digest[module.id] ?? '—' }))}
    />
  );

  if (!enabled) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title={plugin.name} />
        <ScrollView contentContainerStyle={styles.helperPage}>
          {hero}
          <View style={styles.hubCard}>
            <Text style={styles.hubCardTitle}>还没有启用</Text>
            <Text style={styles.hubCardLead}>
              插件默认关闭。开启后才会读取积分流水、称号合成通知与市场挂牌，
              全部在这台手机上解析与统计，不会上传到任何服务器。
            </Text>
          </View>
          <PrimaryButton
            label="启用饼友助手"
            block
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              await prefs.setPluginEnabled(plugin.id, true);
              setBusy(false);
              nav.toast('饼友助手已启用');
            }}
          />
          <OutlineButton compact label="查看插件出处" onPress={() => nav.openWeb(plugin.origin.forkUrl, `${plugin.name} 出处`)} />
        </ScrollView>
      </View>
    );
  }

  if (!nav.loggedIn) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title={plugin.name} />
        <ScrollView contentContainerStyle={styles.helperPage}>
          {hero}
          <StatusBlock empty emptyTitle="登录后可用" emptyCopy="积分流水、通知、称号市场都要用你自己的登录态读取。" />
          <PrimaryButton label="去登录" block onPress={() => nav.open({ name: 'login' })} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title={plugin.name}
        right={(
          <Pressable
            onPress={() => nav.openWeb(plugin.origin.forkUrl, `${plugin.name} 出处`)}
            hitSlop={8}
            accessibilityLabel="查看插件出处"
          >
            <Icon name="information-circle-outline" size={20} color={C.muted} />
          </Pressable>
        )}
      />
      <ScrollView contentContainerStyle={styles.helperPage} keyboardShouldPersistTaps="handled">
        {hero}

        <View style={styles.helperTileGrid}>
          {modules.map((module) => (
            <HelperTile
              key={module.id}
              module={module}
              active={module.id === activeModule?.id}
              value={digest[module.id]}
              onPress={() => setTab(module.name as HelperTab)}
            />
          ))}
        </View>

        {tab === '积分账本' ? <HelperPointsPane onDigest={setDigestValue('points')} /> : null}
        {tab === '称号合成' ? <HelperSynthPane onDigest={setDigestValue('synth')} /> : null}
        {tab === '称号监控' ? <HelperMarketPane onDigest={setDigestValue('market')} /> : null}
        {tab === '幸运打赏' ? <HelperLuckyPane onDigest={setDigestValue('lucky')} /> : null}

        <Text style={styles.pluginCredit}>
          {plugin.name} 为第三方插件（非官网功能）· 原版 {plugin.origin.author}，二开 {plugin.origin.fork} · {plugin.origin.license}
        </Text>
      </ScrollView>
    </View>
  );
}

function HelperTile({
  module,
  active,
  value,
  onPress,
}: {
  module: PluginModuleDef;
  active: boolean;
  value?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.helperTile, active && styles.helperTileOn]} accessibilityLabel={module.name}>
      <View style={styles.helperTileTop}>
        <View style={[styles.helperTileIcon, active && styles.helperTileIconOn]}>
          <Icon name={module.icon} size={15} color={active ? '#fff' : C.muted} />
        </View>
        <Text numberOfLines={1} style={[styles.helperTileName, active && styles.helperTileNameOn]}>{module.name}</Text>
      </View>
      <Text style={styles.helperTileValue}>{value ?? '—'}</Text>
      <Text numberOfLines={1} style={styles.helperTileHint}>{module.blurb}</Text>
    </Pressable>
  );
}

/** 小标题 + 右侧操作（沿用 SectionHead 的排版）。 */
export function HelperSection({
  title,
  hint,
  onRefresh,
  busy,
}: {
  title: string;
  hint?: string;
  onRefresh?: () => void;
  busy?: boolean;
}) {
  return (
    <View style={styles.helperSectionWrap}>
      <SectionHead
        title={title}
        extra={onRefresh ? (
          busy ? <ActivityIndicator size="small" color={C.muted} /> : (
            <OutlineButton compact label="刷新" onPress={onRefresh} icon="refresh-outline" />
          )
        ) : undefined}
      />
      {hint ? <Text style={styles.helperRowHint}>{hint}</Text> : null}
    </View>
  );
}

/** 数字行：直接用账户模块的 StatStrip（收入绿 / 支出红）。 */
export function HelperCards({
  items,
}: {
  items: { label: string; value: string; hint?: string; tone?: 'up' | 'down' | 'muted' }[];
}) {
  return (
    <AccountCard>
      <StatStrip items={items} />
    </AccountCard>
  );
}

/** 一行一条的列表：整块一张卡，行间发丝线；可定高内滚。 */
export function HelperRows({
  children,
  maxHeight,
}: {
  children: React.ReactNode;
  maxHeight?: number;
}) {
  const rows = React.Children.toArray(children).filter(Boolean);
  const body = (
    <View style={styles.helperListInner}>
      {rows.map((row, index) => (
        <View key={index}>
          {index > 0 ? <View style={styles.helperRowSep} /> : null}
          {row}
        </View>
      ))}
    </View>
  );
  if (!maxHeight) return <View style={styles.helperListBox}>{body}</View>;
  return (
    <View style={[styles.helperListBox, { maxHeight }]}>
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
    </View>
  );
}

/** 定高区块：标题 + 卡片式列表（时间线 / 产出称号 / 监控项 / 玩家）。 */
export function HelperList({
  title,
  count,
  hint,
  maxHeight = 240,
  action,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  maxHeight?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const nodes = React.Children.toArray(children).filter(Boolean);
  return (
    <>
      <SectionHead title={count !== undefined ? `${title}（${count}）` : title} extra={action} />
      {hint ? <Text style={styles.helperRowHint}>{hint}</Text> : null}
      {nodes.length ? <HelperRows maxHeight={maxHeight}>{nodes}</HelperRows> : null}
    </>
  );
}

/**
 * 占比条。带 `rarity` 时用称号稀有度配色（取账户模块的 RARITY_UI，全 App 一致），
 * 否则按收入绿 / 支出红。
 */
export function HelperBars({
  items,
  positiveIsIncome,
}: {
  items: { label: string; value: number; hint?: string; income?: boolean; rarity?: string }[];
  positiveIsIncome?: boolean;
}) {
  const max = items.reduce((acc, item) => Math.max(acc, Math.abs(item.value)), 0) || 1;
  const total = items.reduce((acc, item) => acc + Math.abs(item.value), 0) || 1;
  return (
    <AccountCard>
      {items.map((item) => {
        const rarity = item.rarity && item.rarity in RARITY_UI ? (item.rarity as TitleRarity) : null;
        const ratio = Math.round((Math.abs(item.value) / total) * 100);
        return (
          <View key={item.label} style={styles.helperBarRow}>
            <View style={styles.helperBarHead}>
              <Text style={styles.helperRowTitle}>{item.label}</Text>
              <Text style={styles.helperRowValue}>{item.hint ?? String(item.value)}</Text>
            </View>
            <View style={styles.helperBarTrack}>
              {rarity ? (
                <View style={[styles.helperBarFill, { width: `${Math.max(3, ratio)}%`, backgroundColor: RARITY_UI[rarity].tag }]} />
              ) : (
                <View
                  style={[
                    styles.helperBarFill,
                    (positiveIsIncome ?? item.value >= 0) ? styles.helperBarFillIn : null,
                    { width: `${Math.max(3, Math.round((Math.abs(item.value) / max) * 100))}%` },
                  ]}
                />
              )}
            </View>
            {rarity ? <Text style={styles.helperRowHint}>{ratio}%</Text> : null}
          </View>
        );
      })}
    </AccountCard>
  );
}

export { TitleChip };
