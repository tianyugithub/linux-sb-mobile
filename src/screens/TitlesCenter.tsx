import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ConfigProvider } from '@nutui/nutui-react-native';
import {
  AccountCard,
  AccountInput,
  FilterChips,
  GradientButton,
  OutlineButton,
  PillTabs,
  PoolCard,
  SectionHead,
  StatStrip,
  TitleChip,
  A,
  RARITY_UI,
} from '../components/account/AccountUi';
import { ContentSkeleton } from '../components/ContentSkeleton';
import { ConfirmDialog, type DialogState } from '../components/ui';
import { TitleBadge } from '../components/TitleBadge';
import { titleArt } from '../data/title-art';
import { titleRarityOf, type TitleRarity } from '../data/title-catalog';
import { useAppActive } from '../hooks/useAppActive';
import { useAsync } from '../hooks/useAsync';
import { parseForgeGains } from '../services/gacha-parse';
import { api } from '../services/api';
import { ApiError } from '../services/client';
import { nutThemeFor } from '../theme/nut-mine';
import { C, registerStyleSync } from '../theme/palette';
import type {
  TitleDto,
  TitleDrawDto,
  TitleForgeMaterialDto,
  TitleListingDto,
  TitleNewsDto,
} from '../types/api';

export const TITLE_TABS = ['我的称号', '称号抽取', '称号熔炼', '称号回收', 'UR合成', '称号交易'] as const;
export type TitleTab = (typeof TITLE_TABS)[number];
const MARKET_TABS = ['在售交易', '发布交易', '成交记录'] as const;
type MarketTab = (typeof MARKET_TABS)[number];
const SORTS = [
  { id: 'latest', label: '最新发布' },
  { id: 'price_asc', label: '价格从低到高' },
  { id: 'price_desc', label: '价格从高到低' },
] as const;
const DURATIONS = [
  { hours: 1, label: '1 小时' },
  { hours: 6, label: '6 小时' },
  { hours: 12, label: '12 小时' },
  { hours: 24, label: '1 天' },
  { hours: 72, label: '3 天' },
  { hours: 168, label: '7 天' },
] as const;

type AskConfirm = (dialog: DialogState) => void;

export function TitlesCenter({
  loggedIn,
  points,
  toast,
  refreshMe,
  openLogin,
  tab,
  onTab,
}: {
  loggedIn: boolean;
  points: number;
  toast: (message: string) => void;
  refreshMe: (balance?: number) => Promise<void>;
  openLogin: () => void;
  tab?: TitleTab;
  onTab?: (tab: TitleTab) => void;
}) {
  const [inner, setInner] = useState<TitleTab>(tab ?? '称号抽取');
  const current = tab ?? inner;
  const setTab = (next: TitleTab) => {
    setInner(next);
    onTab?.(next);
  };
  const needLogin = () => {
    if (loggedIn) return false;
    openLogin();
    return true;
  };
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [forgeResult, setForgeResult] = useState<TitleDrawDto | null>(null);
  const ask = (next: DialogState) => setDialog(next);
  return (
    <ConfigProvider theme={nutThemeFor(C.scheme)}>
      <View style={styles.flex}>
        <PillTabs items={TITLE_TABS} value={current} onChange={setTab} />
        {current === '我的称号' ? <ProfilePane loggedIn={loggedIn} points={points} toast={toast} refreshMe={refreshMe} needLogin={needLogin} ask={ask} onGoDraw={() => setTab('称号抽取')} /> : null}
        {current === '称号抽取' ? <DrawPane loggedIn={loggedIn} points={points} toast={toast} refreshMe={refreshMe} needLogin={needLogin} /> : null}
        {current === '称号熔炼' ? <ForgePane toast={toast} refreshMe={refreshMe} needLogin={needLogin} ask={ask} onShowResult={setForgeResult} /> : null}
        {current === '称号回收' ? <RecyclePane toast={toast} refreshMe={refreshMe} needLogin={needLogin} ask={ask} /> : null}
        {current === 'UR合成' ? <RecipePane toast={toast} refreshMe={refreshMe} needLogin={needLogin} ask={ask} /> : null}
        {current === '称号交易' ? <MarketPane points={points} toast={toast} refreshMe={refreshMe} needLogin={needLogin} ask={ask} /> : null}
        {!dialog ? (
          <DrawResultModal result={forgeResult} heading="熔炼结果" onClose={() => setForgeResult(null)} />
        ) : null}
        <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
      </View>
    </ConfigProvider>
  );
}

function errMsg(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

function PaneScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      style={styles.pane}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      contentInsetAdjustmentBehavior="never"
      contentInset={{ top: 0, left: 0, bottom: 0, right: 0 }}
      overScrollMode="never"
    >
      <View style={styles.pageStack}>{children}</View>
    </ScrollView>
  );
}

function NewsTicker({ items }: { items: TitleNewsDto[] }) {
  const translate = useRef(new Animated.Value(0)).current;
  const [copyWidth, setCopyWidth] = useState(0);
  const appActive = useAppActive();
  const loop = items.length ? [...items, ...items] : [];
  useEffect(() => {
    if (!appActive || copyWidth <= 0 || !items.length) return;
    translate.setValue(0);
    const anim = Animated.loop(
      Animated.timing(translate, {
        toValue: -copyWidth,
        duration: Math.max(24000, items.length * 3500),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [appActive, copyWidth, items, translate]);
  if (!items.length) return null;
  return (
    <View style={styles.news}>
      <Ionicons name="volume-high" size={16} color={A.muted} />
      <Text style={styles.newsLabel}>喜报</Text>
      <View style={styles.newsViewport}>
        <Animated.View style={[styles.newsTrack, { transform: [{ translateX: translate }] }]}>
          <View style={styles.newsCopy} onLayout={(event) => setCopyWidth(event.nativeEvent.layout.width)}>
            {items.map((item, index) => (
              <NewsChip key={`a-${item.user}-${item.name}-${index}`} item={item} />
            ))}
          </View>
          <View style={styles.newsCopy}>
            {loop.slice(items.length).map((item, index) => (
              <NewsChip key={`b-${item.user}-${item.name}-${index}`} item={item} />
            ))}
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

function NewsChip({ item }: { item: TitleNewsDto }) {
  return (
    <View style={styles.newsItem}>
      <Text style={styles.newsUser}>{item.user}</Text>
      <Text style={styles.newsText}>抽到了</Text>
      <TitleBadge name={item.name} size="sm" />
    </View>
  );
}

function rarityOf(name: string): TitleRarity {
  return titleRarityOf(name);
}

function DrawResultModal({
  result,
  onClose,
  heading,
}: {
  result: TitleDrawDto | null;
  onClose: () => void;
  heading?: string;
}) {
  const scale = useRef(new Animated.Value(0.82)).current;
  useEffect(() => {
    if (!result) return;
    scale.setValue(0.82);
    Animated.spring(scale, { toValue: 1, friction: 7, useNativeDriver: true }).start();
  }, [result, scale]);
  if (!result) return null;
  const names = result.names.length ? result.names : result.name ? [result.name] : [];
  const fresh = result.fresh ?? [];
  const rows = names.map((name, index) => ({
    name,
    fresh: Boolean(fresh[index]),
    count: Math.max(1, result.counts?.[index] ?? 1),
  }));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const single = rows.length === 1 && rows[0].count === 1;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.resultMask}>
        <Animated.View style={[styles.resultBox, { transform: [{ scale }] }]}>
          <Text style={styles.resultTitle}>{total > 1 ? `${heading || '抽取结果'} · ${total} 个` : (heading || '抽取结果')}</Text>
          {!rows.length ? <Text style={styles.lead}>{result.flash || (heading ? '熔炼完成' : '抽取完成')}</Text> : null}
          {single ? (
            <View style={[styles.resultCard, { borderColor: RARITY_UI[rarityOf(rows[0].name)].border, backgroundColor: RARITY_UI[rarityOf(rows[0].name)].fill }]}>
              <Image source={titleArt(rows[0].name)} style={styles.resultArt} />
              {rows[0].fresh ? <Text style={styles.resultNew}>NEW</Text> : null}
              <Text style={[styles.resultRarity, { color: RARITY_UI[rarityOf(rows[0].name)].color }]}>{rarityOf(rows[0].name)}</Text>
              <TitleChip name={rows[0].name} rarity={rarityOf(rows[0].name)} />
            </View>
          ) : rows.length ? (
            <ScrollView
              contentContainerStyle={styles.resultGrid}
              style={styles.resultScroll}
              nestedScrollEnabled
              automaticallyAdjustContentInsets={false}
              contentInsetAdjustmentBehavior="never"
            >
              {rows.map((row, index) => (
                <View key={`${row.name}-${index}`} style={[styles.resultMini, { borderColor: RARITY_UI[rarityOf(row.name)].border, backgroundColor: RARITY_UI[rarityOf(row.name)].fill }]}>
                  {row.fresh ? <Text style={styles.resultNewMini}>NEW</Text> : null}
                  <Image source={titleArt(row.name)} style={styles.resultMiniArt} />
                  <Text style={[styles.resultMiniRarity, { color: RARITY_UI[rarityOf(row.name)].color }]}>{rarityOf(row.name)}</Text>
                  <Text numberOfLines={1} style={styles.resultMiniName}>{row.name}</Text>
                  {row.count > 1 ? <Text style={styles.resultMiniCount}>×{row.count}</Text> : null}
                </View>
              ))}
            </ScrollView>
          ) : null}
          <GradientButton block label="知道了" onPress={onClose} />
        </Animated.View>
      </View>
    </Modal>
  );
}

function DrawPane({
  loggedIn,
  points,
  toast,
  refreshMe,
  needLogin,
}: {
  loggedIn: boolean;
  points: number;
  toast: (message: string) => void;
  refreshMe: (balance?: number) => Promise<void>;
  needLogin: () => boolean;
}) {
  const query = useAsync(() => api.titles(), [loggedIn], 'titles:center');
  const [busy, setBusy] = useState<1 | 10 | 100 | null>(null);
  const [result, setResult] = useState<TitleDrawDto | null>(null);
  const items = query.data?.items ?? [];
  const draw = async (count: 1 | 10 | 100) => {
    if (needLogin()) return;
    setBusy(count);
    try {
      const drawn = await api.drawTitle(count);
      setResult(drawn);
      query.reload();
      await refreshMe(drawn.balance);
      const total = (drawn.counts?.length ? drawn.counts : drawn.names.map(() => 1)).reduce((sum, n) => sum + n, 0);
      toast(total > 1 ? `抽到 ${total} 个称号` : drawn.names[0] ? `抽到 ${drawn.names[0]}` : (drawn.flash || '抽取完成'));
    } catch (err) {
      toast(errMsg(err, '抽取失败'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={styles.flex}>
      <PaneScroll>
      <NewsTicker items={query.data?.news ?? []} />
      <AccountCard>
        <StatStrip items={[
          { label: '我的积分', value: points.toLocaleString('zh-CN') },
          { label: '已拥有', value: query.data?.ownedCount ?? 0 },
          { label: '图鉴', value: query.data?.total ?? items.length },
        ]} />
        <View style={styles.pulls}>
          <GradientButton flex tone="blue" label="抽 1 次" sub={busy === 1 ? '抽取中' : `${query.data?.drawCost ?? 10} 积分`} disabled={busy !== null} onPress={() => draw(1)} />
          <GradientButton flex tone="primary" label="抽 10 次" sub={busy === 10 ? '抽取中' : `${query.data?.drawTenCost ?? 90} 积分`} disabled={busy !== null} onPress={() => draw(10)} />
          <GradientButton flex tone="muted" label="抽 100 次" sub={busy === 100 ? '抽取中' : `${query.data?.drawHundredCost ?? 800} 积分`} disabled={busy !== null} onPress={() => draw(100)} />
        </View>
      </AccountCard>
      {query.data?.pool?.length ? (
        <AccountCard>
          <SectionHead title="概率一览" />
          <View style={styles.poolRow}>
            {query.data.pool.map((row) => (
              <PoolCard key={row.rarity} rarity={row.rarity} count={row.count} rate={row.rate} />
            ))}
          </View>
        </AccountCard>
      ) : null}
      <AccountCard>
        <SectionHead title="全部称号" extra={<Text style={styles.moreText}>{items.length} 个</Text>} />
        <View style={styles.catalog}>
          {items.map((item) => (
            <View key={item.name} style={styles.tileHit}>
              <TitleChip tile name={item.name} rarity={item.rarity} owned={item.owned} copies={item.owned ? item.copies : undefined} />
            </View>
          ))}
        </View>
      </AccountCard>
      {query.loading && !query.data ? <ContentSkeleton variant="lines" /> : null}
      {query.error ? <Text style={styles.error}>{query.error}</Text> : null}
      </PaneScroll>
      <DrawResultModal result={result} onClose={() => setResult(null)} />
    </View>
  );
}

function ProfilePane({
  loggedIn,
  points,
  toast,
  refreshMe,
  needLogin,
  ask,
  onGoDraw,
}: {
  loggedIn: boolean;
  points: number;
  toast: (message: string) => void;
  refreshMe: (balance?: number) => Promise<void>;
  needLogin: () => boolean;
  ask: AskConfirm;
  onGoDraw: () => void;
}) {
  const query = useAsync(() => api.titles(), [loggedIn], 'titles:center');
  const [gift, setGift] = useState<TitleDto | null>(null);
  const [username, setUsername] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const items = (query.data?.items ?? []).filter((item) => item.owned);
  const equipped = query.data?.equipped;
  const equippedItem = items.find((item) => item.equipped || item.name === equipped);
  const selected = items.find((item) => item.name === picked) ?? equippedItem ?? items[0] ?? null;
  const wearing = Boolean(selected && equippedItem && selected.name === equippedItem.name);
  const ownedByRarity = (['UR', 'SSR', 'SR', 'R', 'N'] as TitleRarity[]).map((rarity) => {
    const group = items.filter((item) => item.rarity === rarity);
    return {
      rarity,
      count: group.length,
      copies: group.reduce((sum, item) => sum + (item.copies || 1), 0),
    };
  });
  const act = async (run: () => Promise<void>, fallback: string) => {
    if (needLogin()) return;
    try {
      await run();
      query.reload();
      await refreshMe();
    } catch (err) {
      toast(errMsg(err, fallback));
    }
  };
  const openGift = (item: TitleDto) => {
    if (needLogin()) return;
    setUsername('');
    setGift(item);
  };
  const theme = selected ? RARITY_UI[selected.rarity] : null;
  return (
    <PaneScroll>
      {selected && theme ? (
        <AccountCard>
          <View style={styles.goods}>
            <Image source={titleArt(selected.name)} style={styles.goodsArt} />
            <View style={styles.goodsBody}>
              <View style={styles.goodsNameRow}>
                <Text style={styles.goodsName}>{selected.name}</Text>
                {wearing ? <Text style={styles.wearTag}>佩戴中</Text> : <Text style={styles.previewTag}>预览</Text>}
              </View>
              <View style={styles.goodsTags}>
                <View style={[styles.rarityTag, { backgroundColor: theme.tag }]}>
                  <Text style={styles.rarityTagText}>{selected.rarity}</Text>
                </View>
                {selected.copies > 1 ? <Text style={styles.meta}>持有 ×{selected.copies}</Text> : null}
              </View>
              {selected.desc ? <Text numberOfLines={2} style={styles.goodsDesc}>{selected.desc}</Text> : null}
            </View>
          </View>
          <View style={styles.showcaseBtns}>
            {wearing ? (
              <GradientButton flex compact tone="muted" label="卸下" onPress={() => act(() => api.unequipTitle().then(() => { toast('已卸下'); }), '卸下失败')} />
            ) : (
              <GradientButton flex compact label="佩戴" onPress={() => act(() => api.equipTitle(selected.name).then(() => { toast(`已佩戴 ${selected.name}`); }), '佩戴失败')} />
            )}
            <OutlineButton flex compact label="赠送" onPress={() => openGift(selected)} />
          </View>
        </AccountCard>
      ) : (
        <AccountCard>
          <View style={styles.showcaseEmpty}>
            <Ionicons name="ribbon-outline" size={36} color={A.dim} />
            <Text style={styles.goodsName}>{loggedIn ? '还没有称号' : '登录后查看称号'}</Text>
            <Text style={styles.meta}>{loggedIn ? '抽取后可在这里佩戴、赠送。' : '登录 linux.sb 账号后同步称号。'}</Text>
            <GradientButton label={loggedIn ? '去抽取' : '去登录'} onPress={loggedIn ? onGoDraw : () => { needLogin(); }} />
          </View>
        </AccountCard>
      )}
      <AccountCard>
        <StatStrip items={[
          { label: '我的积分', value: points.toLocaleString('zh-CN') },
          { label: '已拥有', value: query.data?.ownedCount ?? items.length },
          { label: '图鉴', value: query.data?.total ?? 0 },
        ]} />
      </AccountCard>
      {items.length ? (
        <AccountCard>
          <SectionHead title="持有分布" />
          <View style={styles.poolRow}>
            {ownedByRarity.map((row) => (
              <PoolCard key={row.rarity} rarity={row.rarity} count={row.count} rate={row.copies ? `×${row.copies}` : '—'} />
            ))}
          </View>
        </AccountCard>
      ) : null}
      {items.length ? (
        <AccountCard>
          <SectionHead title="我的称号" extra={<Text style={styles.moreText}>{items.length} 个</Text>} />
          <View style={styles.catalog}>
            {items.map((item) => (
              <Pressable key={item.name} onPress={() => setPicked(item.name)} style={styles.tileHit}>
                <TitleChip
                  tile
                  name={item.name}
                  rarity={item.rarity}
                  copies={item.copies}
                  active={selected?.name === item.name}
                />
              </Pressable>
            ))}
          </View>
        </AccountCard>
      ) : null}
      {query.loading && !items.length ? <ContentSkeleton variant="lines" /> : null}
      {query.error ? <Text style={styles.error}>{query.error}</Text> : null}
      <Modal visible={!!gift} transparent animationType="fade" onRequestClose={() => setGift(null)}>
        <View style={styles.resultMask}>
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>赠送称号</Text>
            {gift ? <TitleChip name={gift.name} rarity={gift.rarity} /> : null}
            <Text style={styles.lead}>填写接收用户名。已佩戴称号会保留 1 个。</Text>
            <AccountInput value={username} onChangeText={setUsername} placeholder="用户名" autoCapitalize="none" />
            <View style={styles.rowBtns}>
              <OutlineButton compact label="取消" onPress={() => setGift(null)} />
              <GradientButton
                compact
                label="确认赠送"
                onPress={() => {
                  if (!gift) return;
                  ask({
                    title: '确认赠送',
                    text: `将「${gift.name}」赠送给 ${username}？`,
                    confirmLabel: '确认赠送',
                    onConfirm: async () => {
                      try {
                        const res = await api.giftTitle({ name: gift.name, username });
                        setGift(null);
                        query.reload();
                        await refreshMe();
                        toast(res.flash || '赠送成功');
                      } catch (err) {
                        toast(errMsg(err, '赠送失败'));
                      }
                    },
                  });
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </PaneScroll>
  );
}

function clampQty(raw: string, max: number) {
  const n = parseInt(raw.replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(max, Math.max(1, n));
}

function QtyStepper({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (qty: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);
  const commit = (raw: string) => {
    const next = clampQty(raw, max);
    onChange(next);
    setDraft(String(next));
  };
  return (
    <View style={styles.qtyRow}>
      <Pressable onPress={() => onChange(Math.max(1, value - 1))} style={styles.qtyBtn}>
        <Text style={styles.qtyBtnText}>-</Text>
      </Pressable>
      <TextInput
        value={draft}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '');
          setDraft(digits);
          if (digits) onChange(clampQty(digits, max));
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit(draft);
        }}
        keyboardType="number-pad"
        selectTextOnFocus
        underlineColorAndroid="transparent"
        maxLength={String(Math.max(max, 1)).length}
        style={styles.qtyInput}
        accessibilityLabel="数量"
      />
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} style={styles.qtyBtn}>
        <Text style={styles.qtyBtnText}>+</Text>
      </Pressable>
      <Pressable onPress={() => onChange(max)} hitSlop={6} style={styles.qtyMaxBtn}>
        <Text style={styles.qtyMaxText}>最大</Text>
      </Pressable>
    </View>
  );
}

function MaterialPicker({
  items,
  selected,
  onToggle,
  onQty,
}: {
  items: TitleForgeMaterialDto[];
  selected: Record<string, number>;
  onToggle: (id: string, usable: number) => void;
  onQty: (id: string, qty: number, usable: number) => void;
}) {
  const chosen = items.filter((item) => selected[item.id] != null);
  return (
    <View style={styles.gap}>
      <View style={styles.catalog}>
        {items.map((item) => (
          <Pressable key={item.id} onPress={() => onToggle(item.id, item.usable)} style={styles.tileHit}>
            <TitleChip
              tile
              name={item.name}
              rarity={item.rarity}
              copies={item.copies}
              active={selected[item.id] != null}
            />
          </Pressable>
        ))}
      </View>
      {chosen.map((item) => (
        <View key={`qty-${item.id}`} style={styles.qtyCard}>
          <TitleChip compact name={item.name} rarity={item.rarity} copies={selected[item.id]} active />
          <View style={styles.qtyCardActions}>
            <Text style={styles.meta}>可用 {item.usable}</Text>
            <QtyStepper
              value={selected[item.id] || 1}
              max={item.usable}
              onChange={(qty) => onQty(item.id, qty, item.usable)}
            />
          </View>
        </View>
      ))}
      {!items.length ? <Text style={styles.meta}>暂无可操作的称号。</Text> : null}
    </View>
  );
}

function ForgePane({
  toast,
  refreshMe,
  needLogin,
  ask,
  onShowResult,
}: {
  toast: (message: string) => void;
  refreshMe: () => Promise<void>;
  needLogin: () => boolean;
  ask: AskConfirm;
  onShowResult: (result: TitleDrawDto) => void;
}) {
  const query = useAsync(() => api.titleForge(), [], 'titles:forge');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const recipes = query.data?.recipes ?? [];
  const materials = query.data?.materials ?? [];
  const toggle = (id: string, usable: number) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id] != null) delete next[id];
      else next[id] = usable;
      return next;
    });
  };
  const onQty = (id: string, qty: number, usable: number) => {
    setSelected((prev) => ({ ...prev, [id]: Math.min(usable, Math.max(1, qty)) }));
  };
  const picked = materials.filter((item) => selected[item.id] != null);
  const pickedCount = picked.reduce((sum, item) => sum + (selected[item.id] || 0), 0);
  const forgeTimes = recipes.reduce((sum, recipe) => {
    const count = picked.filter((item) => item.rarity === recipe.source).reduce((n, item) => n + (selected[item.id] || 0), 0);
    return sum + Math.floor(count / recipe.cost);
  }, 0);
  return (
    <PaneScroll>
      <AccountCard>
        <SectionHead title="熔炼方案" extra={<Text style={styles.moreText}>已选 {pickedCount} · 可出 {forgeTimes}</Text>} />
        <View style={styles.pullsWrap}>
        {recipes.map((recipe) => {
          const pool = picked.filter((item) => item.rarity === recipe.source);
          const count = pool.reduce((sum, item) => sum + (selected[item.id] || 0), 0);
          const times = Math.floor(count / recipe.cost);
          return (
            <View key={recipe.source} style={styles.pullItem}>
              <GradientButton
                block
                tone={times >= 1 ? 'primary' : 'muted'}
                disabled={times < 1}
                label={`${recipe.source} 换 ${recipe.target}`}
                sub={times < 1 ? `${recipe.cost} 个 ${recipe.source}` : `可熔炼 ${times} 次`}
                onPress={() => {
                  if (needLogin()) return;
                  ask({
                    title: '确认熔炼',
                    text: `消耗 ${times * recipe.cost} 个 ${recipe.source}，得到 ${times} 个 ${recipe.target}。`,
                    confirmLabel: '确认熔炼',
                    onConfirm: async () => {
                      try {
                        const res = await api.forgeTitles(recipe.rarityKey || recipe.source.toLowerCase(), pool.map((item) => ({ id: item.id, quantity: selected[item.id] })));
                        setSelected({});
                        query.reload();
                        await refreshMe();
                        const flash = res.flash || `熔炼完成 ×${res.times}`;
                        const parsed = res.names?.length ? null : parseForgeGains(flash);
                        const names = res.names?.length ? res.names : parsed?.names ?? [];
                        const counts = res.counts?.length ? res.counts : parsed?.counts ?? names.map(() => 1);
                        onShowResult({
                          name: names[0] || '',
                          names,
                          fresh: names.map(() => false),
                          counts,
                          balance: 0,
                          flash,
                        });
                        toast(flash);
                      } catch (err) {
                        toast(errMsg(err, '熔炼失败'));
                      }
                    },
                  });
                }}
              />
            </View>
          );
        })}
        </View>
      </AccountCard>
      <AccountCard>
      <SectionHead title="选择材料" />
      <MaterialPicker items={materials} selected={selected} onToggle={toggle} onQty={onQty} />
      </AccountCard>
      {query.loading && !query.data ? <ContentSkeleton variant="lines" /> : null}
      {query.error ? <Text style={styles.error}>{query.error}</Text> : null}
    </PaneScroll>
  );
}

function RecyclePane({ toast, refreshMe, needLogin, ask }: { toast: (message: string) => void; refreshMe: () => Promise<void>; needLogin: () => boolean; ask: AskConfirm }) {
  const query = useAsync(() => api.titleRecycle(), [], 'titles:recycle');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const items = query.data?.items ?? [];
  const price = query.data?.price ?? 200;
  const picked = items.filter((item) => selected[item.id] != null);
  const count = picked.reduce((sum, item) => sum + (selected[item.id] || 0), 0);
  const clear = () => setSelected({});
  return (
    <PaneScroll>
      <AccountCard>
        <View style={styles.settle}>
          <View>
            <Text style={styles.priceNow}>{price.toLocaleString('zh-CN')}</Text>
            <Text style={styles.meta}>今日回收价 / 个</Text>
          </View>
          <View style={styles.settleRight}>
            <Text style={styles.meta}>已选 {count} · 预计 {count * price} 积分</Text>
            <View style={styles.settleBtns}>
              <OutlineButton compact label="清空" onPress={clear} />
              <GradientButton
                compact
                tone={count < 1 ? 'muted' : 'primary'}
                disabled={count < 1}
                label="回收"
                onPress={() => {
                  if (needLogin()) return;
                  ask({
                    title: '确认回收',
                    text: `回收 ${count} 个 SSR，到账 ${count * price} 积分。`,
                    confirmLabel: '确认回收',
                    onConfirm: async () => {
                      try {
                        const res = await api.recycleTitles(picked.map((item) => ({ id: item.id, quantity: selected[item.id] })));
                        setSelected({});
                        query.reload();
                        await refreshMe();
                        toast(res.flash || '回收成功');
                      } catch (err) {
                        toast(errMsg(err, '回收失败'));
                      }
                    },
                  });
                }}
              />
            </View>
          </View>
        </View>
      </AccountCard>
      <AccountCard>
      <SectionHead title="选择 SSR" extra={<Text style={styles.moreText}>{items.length} 个可回收</Text>} />
      <MaterialPicker
        items={items}
        selected={selected}
        onToggle={(id, usable) => setSelected((prev) => {
          const next = { ...prev };
          if (next[id] != null) delete next[id];
          else next[id] = usable;
          return next;
        })}
        onQty={(id, qty, usable) => setSelected((prev) => ({ ...prev, [id]: Math.min(usable, Math.max(1, qty)) }))}
      />
      </AccountCard>
      {query.loading && !query.data ? <ContentSkeleton variant="lines" /> : null}
      {query.error ? <Text style={styles.error}>{query.error}</Text> : null}
    </PaneScroll>
  );
}

function RecipePane({ toast, refreshMe, needLogin, ask }: { toast: (message: string) => void; refreshMe: () => Promise<void>; needLogin: () => boolean; ask: AskConfirm }) {
  const query = useAsync(() => api.titleRecipes(), [], 'titles:recipes');
  const items = query.data?.items ?? [];
  const readyCount = items.filter((item) => item.ready).length;
  return (
    <PaneScroll>
      <AccountCard>
        <StatStrip items={[
          { label: '配方', value: items.length },
          { label: '可合成', value: readyCount },
        ]} />
      </AccountCard>
      {items.map((item) => {
        const theme = RARITY_UI[item.rarity];
        return (
          <AccountCard key={item.id || item.name}>
            <View style={styles.goods}>
              <Image source={titleArt(item.name)} style={styles.goodsArt} />
              <View style={styles.goodsBody}>
                <Text style={styles.goodsName}>{item.name}</Text>
                <View style={styles.goodsTags}>
                  <View style={[styles.rarityTag, { backgroundColor: theme.tag }]}>
                    <Text style={styles.rarityTagText}>{item.rarity}</Text>
                  </View>
                  {item.subtitle ? <Text numberOfLines={1} style={styles.meta}>{item.subtitle}</Text> : null}
                </View>
              </View>
            </View>
            <View style={styles.matRow}>
              {item.materials.map((mat) => (
                <View key={mat.name} style={styles.matItem}>
                  <TitleChip name={mat.name} rarity={rarityOf(mat.name)} owned={mat.ready} compact />
                  <Text style={mat.ready ? styles.matOk : styles.meta}>{mat.have}/{mat.need}</Text>
                </View>
              ))}
            </View>
            <GradientButton
              block
              tone={item.ready ? 'primary' : 'muted'}
              disabled={!item.ready}
              label={item.ready ? '立即合成' : '材料不足'}
              onPress={() => {
                if (needLogin()) return;
                ask({
                  title: '确认合成',
                  text: `消耗配方材料，获得 UR「${item.name}」。`,
                  confirmLabel: '确认合成',
                  onConfirm: async () => {
                    try {
                      const res = await api.craftTitle(item.id);
                      query.reload();
                      await refreshMe();
                      toast(res.flash || '合成成功');
                    } catch (err) {
                      toast(errMsg(err, '合成失败'));
                    }
                  },
                });
              }}
            />
          </AccountCard>
        );
      })}
      {!query.loading && !items.length ? <Text style={styles.meta}>暂无 UR 配方。</Text> : null}
      {query.loading && !query.data ? <ContentSkeleton variant="lines" /> : null}
      {query.error ? <Text style={styles.error}>{query.error}</Text> : null}
    </PaneScroll>
  );
}

function MarketPane({ points, toast, refreshMe, needLogin, ask }: { points: number; toast: (message: string) => void; refreshMe: () => Promise<void>; needLogin: () => boolean; ask: AskConfirm }) {
  const [sub, setSub] = useState<MarketTab>('在售交易');
  return (
    <View style={styles.flex}>
      <View style={styles.subNav}>
        <FilterChips items={MARKET_TABS} value={sub} onChange={setSub} />
      </View>
      {sub === '在售交易' ? <MarketBrowse points={points} toast={toast} refreshMe={refreshMe} needLogin={needLogin} ask={ask} /> : null}
      {sub === '发布交易' ? <MarketMine toast={toast} refreshMe={refreshMe} needLogin={needLogin} ask={ask} /> : null}
      {sub === '成交记录' ? <MarketOrders /> : null}
    </View>
  );
}

function MarketBrowse({ points, toast, refreshMe, needLogin, ask }: { points: number; toast: (message: string) => void; refreshMe: () => Promise<void>; needLogin: () => boolean; ask: AskConfirm }) {
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [rarity, setRarity] = useState('');
  const [sort, setSort] = useState('latest');
  const [cursor, setCursor] = useState<string | null>(null);
  const query = useAsync(() => api.titleMarket({ q: appliedQ, rarity, sort, cursor }), [appliedQ, rarity, sort, cursor], `titles:market:${appliedQ}:${rarity}:${sort}:${cursor ?? '1'}`);
  const items = query.data?.items ?? [];
  const page = Math.max(1, Number(cursor || '1') || 1);
  const maxPage = Math.max(page, query.data?.maxPage ?? 1);
  const hasPrev = page > 1;
  const hasNext = Boolean(query.data?.nextCursor) || page < maxPage;
  const buy = (item: TitleListingDto, quantity: number) => {
    if (needLogin()) return;
    const cost = quantity * item.price;
    if (points < cost) {
      toast(`积分不足，需要 ${cost.toLocaleString('zh-CN')} 积分`);
      return;
    }
    ask({
      title: '确认购买',
      text: `称号：${item.name}\n数量：${quantity} 个\n单价：${item.price.toLocaleString('zh-CN')} 积分\n总金额：${cost.toLocaleString('zh-CN')} 积分`,
      confirmLabel: '确认',
      onConfirm: async () => {
        try {
          const res = await api.buyTitleListing(item.id, quantity);
          query.reload();
          await refreshMe();
          toast(res.flash || '购买成功');
        } catch (err) {
          toast(errMsg(err, '购买失败'));
        }
      },
    });
  };
  const rarityItems = ['全部等级', 'UR', 'SSR', 'SR', 'R', 'N'] as const;
  return (
    <View style={styles.pane}>
      <View style={styles.marketHead}>
        <AccountCard>
          <View style={styles.searchRow}>
            <View style={styles.grow}>
              <AccountInput
                value={q}
                onChangeText={setQ}
                onSubmitEditing={() => { setCursor(null); setAppliedQ(q.trim()); }}
                placeholder="搜索称号名称"
                returnKeyType="search"
              />
            </View>
            <GradientButton compact label="搜索" onPress={() => { setCursor(null); setAppliedQ(q.trim()); }} />
          </View>
          <FilterChips
            items={rarityItems}
            value={(rarity ? rarity.toUpperCase() : '全部等级') as typeof rarityItems[number]}
            onChange={(item) => { setCursor(null); setRarity(item === '全部等级' ? '' : item.toLowerCase()); }}
          />
          <FilterChips
            items={SORTS.map((item) => item.label)}
            value={SORTS.find((item) => item.id === sort)?.label ?? '最新发布'}
            onChange={(label) => {
              setCursor(null);
              setSort(SORTS.find((item) => item.label === label)?.id ?? 'latest');
            }}
          />
        </AccountCard>
        <AccountCard>
          <StatStrip items={[
            { label: '我的积分', value: points.toLocaleString('zh-CN') },
            { label: '在售', value: query.data?.total ?? items.length },
          ]} />
        </AccountCard>
      </View>
      <PaneScroll>
      {items.map((item) => {
        const canBuy = points >= item.price;
        return (
          <AccountCard key={item.id}>
            <View style={styles.deal}>
              <Image source={titleArt(item.name)} style={styles.dealArt} />
              <View style={styles.dealBody}>
                <TitleChip name={item.name} rarity={item.rarity} compact />
                <Text style={styles.meta}>剩余 {item.stock} · {item.remain || '—'}</Text>
              </View>
              <View style={styles.dealBuy}>
                <Text style={styles.priceNow}>{item.price.toLocaleString('zh-CN')}</Text>
                <GradientButton compact tone={canBuy ? 'primary' : 'muted'} label={canBuy ? '购买' : '积分不足'} onPress={() => buy(item, 1)} />
              </View>
            </View>
          </AccountCard>
        );
      })}
      {items.length || page > 1 || hasNext ? (
        <View style={styles.pager}>
          <Pressable disabled={!hasPrev || query.fetching} onPress={() => setCursor(page <= 2 ? null : String(page - 1))} style={[styles.pagerBtn, !hasPrev && styles.pagerBtnOff]}>
            <Text style={styles.pagerText}>上一页</Text>
          </Pressable>
          <Text style={styles.pagerNow}>{maxPage > 1 ? `第 ${page} / ${maxPage} 页` : `第 ${page} 页`}</Text>
          <Pressable disabled={!hasNext || query.fetching} onPress={() => setCursor(query.data?.nextCursor ?? String(page + 1))} style={[styles.pagerBtn, !hasNext && styles.pagerBtnOff]}>
            <Text style={styles.pagerText}>下一页</Text>
          </Pressable>
        </View>
      ) : null}
      {query.loading && !items.length ? <ContentSkeleton variant="lines" /> : null}
      {query.error ? <Text style={styles.error}>{query.error}</Text> : null}
      </PaneScroll>
    </View>
  );
}

function MarketMine({ toast, refreshMe, needLogin, ask }: { toast: (message: string) => void; refreshMe: () => Promise<void>; needLogin: () => boolean; ask: AskConfirm }) {
  const query = useAsync(() => api.titleMarketMine(), [], 'titles:market-mine');
  const sellable = query.data?.sellable ?? [];
  const listings = query.data?.listings ?? [];
  const [titleId, setTitleId] = useState(sellable[0]?.id ?? '');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [hours, setHours] = useState(24);
  const option = sellable.find((item) => item.id === titleId) ?? sellable[0];
  useEffect(() => {
    if (!titleId && sellable[0]?.id) setTitleId(sellable[0].id);
  }, [sellable, titleId]);
  return (
    <PaneScroll>
      <AccountCard>
        <SectionHead title="选择上架称号" />
        <View style={styles.catalog}>
          {sellable.map((item) => (
            <Pressable key={item.id} onPress={() => setTitleId(item.id)} style={styles.tileHit}>
              <TitleChip tile name={item.name} rarity={item.rarity} copies={item.usable} active={option?.id === item.id} />
            </Pressable>
          ))}
        </View>
        <Text style={styles.meta}>{option ? `${option.rarity} · 单价上限 ${option.priceLimit} 积分` : '请选择要上架的称号'}</Text>
        <AccountInput value={quantity} onChangeText={setQuantity} keyboardType="number-pad" placeholder="数量" />
        <AccountInput value={price} onChangeText={setPrice} keyboardType="number-pad" placeholder="单价（积分）" />
        <FilterChips
          items={DURATIONS.map((item) => item.label)}
          value={DURATIONS.find((item) => item.hours === hours)?.label ?? '1 天'}
          onChange={(label) => setHours(DURATIONS.find((item) => item.label === label)?.hours ?? 24)}
        />
        <GradientButton
          block
          tone="primary"
          label="发布交易"
          sub="发布后立即托管"
          onPress={() => {
            if (needLogin()) return;
            if (!option) return;
            const qty = Math.max(1, Number(quantity) || 1);
            const unit = Math.max(1, Number(price) || 0);
            ask({
              title: '确认发布',
              text: `称号：${option.name}\n数量：${qty} 个\n单价：${unit} 积分\n总金额：${qty * unit} 积分\n\n发布后称号将立即托管。`,
              confirmLabel: '确认发布',
              onConfirm: async () => {
                try {
                  const res = await api.publishTitleListing({ titleId: option.id, quantity: qty, unitPrice: unit, durationHours: hours });
                  query.reload();
                  await refreshMe();
                  toast(res.flash || '已发布');
                } catch (err) {
                  toast(errMsg(err, '发布失败'));
                }
              },
            });
          }}
        />
      </AccountCard>
      <AccountCard>
        <SectionHead title="我的在售" extra={<Text style={styles.moreText}>{listings.length} 笔</Text>} />
        {listings.map((item) => {
          const canCancel = Boolean(item.cancelPath || (item.status && !/撤回|售罄|过期|完成/.test(item.status)));
          return (
            <View key={`${item.id}-${item.status}`} style={styles.deal}>
              <Image source={titleArt(item.name)} style={styles.dealArt} />
              <View style={styles.dealBody}>
                <TitleChip name={item.name} rarity={item.rarity} compact />
                <Text style={styles.meta}>{item.remain} · 已售 {item.sold ?? 0}/{item.stock || 0} · {item.status || '进行中'}</Text>
              </View>
              <View style={styles.dealBuy}>
                <Text style={styles.priceNow}>{item.price.toLocaleString('zh-CN')}</Text>
                {canCancel ? (
                  <OutlineButton
                    compact
                    label="撤回"
                    onPress={() => {
                      ask({
                        title: '撤回交易',
                        text: `撤回「${item.name}」的在售交易？剩余称号会退回。`,
                        confirmLabel: '撤回',
                        onConfirm: async () => {
                          try {
                            const res = await api.cancelTitleListing(item.id);
                            query.reload();
                            await refreshMe();
                            toast(res.flash || '已撤回');
                          } catch (err) {
                            toast(errMsg(err, '撤回失败'));
                          }
                        },
                      });
                    }}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
        {!query.loading && !listings.length ? <Text style={styles.meta}>还没有发布过交易。</Text> : null}
      </AccountCard>
      {query.loading && !query.data ? <ContentSkeleton variant="lines" /> : null}
      {query.error ? <Text style={styles.error}>{query.error}</Text> : null}
    </PaneScroll>
  );
}

function MarketOrders() {
  const query = useAsync(() => api.titleMarketOrders(), [], 'titles:market-orders');
  const items = query.data?.items ?? [];
  return (
    <PaneScroll>
      <AccountCard>
        <StatStrip items={[{ label: '成交', value: items.length }]} />
      </AccountCard>
      {items.map((item) => (
        <AccountCard key={item.id || `${item.name}-${item.at}`}>
          <View style={styles.deal}>
            <Image source={titleArt(item.name)} style={styles.dealArt} />
            <View style={styles.dealBody}>
              <TitleChip name={item.name} rarity={item.rarity} compact />
              <Text style={styles.meta}>{item.side === 'sell' ? '卖出' : '买入'} {item.quantity} 个 · {item.at}</Text>
            </View>
            <Text style={[styles.amount, item.amount >= 0 ? styles.amountIn : styles.amountOut]}>{item.amount >= 0 ? '+' : ''}{item.amount}</Text>
          </View>
        </AccountCard>
      ))}
      {!query.loading && !items.length ? <Text style={styles.meta}>暂无成交记录。</Text> : null}
      {query.loading && !query.data ? <ContentSkeleton variant="lines" /> : null}
      {query.error ? <Text style={styles.error}>{query.error}</Text> : null}
    </PaneScroll>
  );
}

function createTitleStyles() {
  return StyleSheet.create({
  flex: { flex: 1, backgroundColor: A.canvas },
  pane: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  gap: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  page: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 36 },
  pageStack: { gap: 12 },
  subNav: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: A.canvas,
    zIndex: 2,
  },
  marketHead: { paddingHorizontal: 12, paddingTop: 12, gap: 12, backgroundColor: A.canvas, flexGrow: 0, flexShrink: 0 },
  lead: { color: A.muted, fontSize: 12, lineHeight: 18 },
  meta: { color: A.muted, fontSize: 11 },
  moreText: { color: A.dim, fontSize: 12 },
  error: { color: A.red, fontSize: 13 },
  news: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: A.card,
    overflow: 'hidden',
  },
  newsLabel: { color: '#fff', backgroundColor: A.red, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, fontSize: 10, fontWeight: '800', overflow: 'hidden' },
  newsViewport: { flex: 1, overflow: 'hidden', height: 24, justifyContent: 'center' },
  newsTrack: { flexDirection: 'row', alignItems: 'center' },
  newsCopy: { flexDirection: 'row', alignItems: 'center', gap: 24, paddingRight: 24 },
  newsItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  newsUser: { color: A.text, fontSize: 12, fontWeight: '700' },
  newsText: { color: A.muted, fontSize: 12 },
  pulls: { flexDirection: 'row', gap: 8 },
  pullsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pullItem: { flexGrow: 1, flexBasis: '30%', minWidth: 96 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deal: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dealArt: { width: 48, height: 48 },
  dealBody: { flex: 1, minWidth: 0, gap: 4 },
  dealBuy: { alignItems: 'flex-end', justifyContent: 'center', gap: 6 },
  priceNow: { color: A.red, fontSize: 18, fontWeight: '800' },
  settle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  settleRight: { flex: 1, alignItems: 'flex-end', gap: 8 },
  settleBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goods: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  goodsArt: { width: 72, height: 72 },
  goodsBody: { flex: 1, minWidth: 0, gap: 6 },
  goodsNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goodsName: { color: A.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  goodsTags: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  goodsDesc: { color: A.muted, fontSize: 12, lineHeight: 18 },
  wearTag: { color: '#fff', backgroundColor: A.red, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, fontSize: 10, fontWeight: '800' },
  previewTag: { color: A.dim, fontSize: 11, fontWeight: '700' },
  rarityTag: { minHeight: 16, paddingHorizontal: 6, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  rarityTagText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  matRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  matItem: { alignItems: 'flex-start', gap: 4 },
  matOk: { color: A.green, fontSize: 11, fontWeight: '700' },
  tileHit: { width: '31%', minWidth: 96, flexGrow: 1, maxWidth: '32%' },
  qtyCard: {
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: A.line,
    backgroundColor: A.cardHi,
  },
  qtyCardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  poolRow: { flexDirection: 'row', gap: 6 },
  catalog: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  showcaseEmpty: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  showcaseBtns: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  rowBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  qtyBtn: { width: 36, height: 40, borderRadius: 6, borderWidth: 1, borderColor: A.line, alignItems: 'center', justifyContent: 'center', backgroundColor: A.cardHi },
  qtyBtnText: { color: A.text, fontSize: 16, fontWeight: '800' },
  qtyInput: {
    minWidth: 64,
    height: 40,
    paddingHorizontal: 8,
    paddingTop: 0,
    paddingBottom: 0,
    borderRadius: 6,
    backgroundColor: A.canvas,
    borderWidth: 1,
    borderColor: A.line,
    color: A.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  qtyMaxBtn: { height: 40, paddingHorizontal: 8, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  qtyMaxText: { color: A.red, fontSize: 12, fontWeight: '800' },
  resultMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  resultBox: { width: '100%', maxHeight: '86%', borderRadius: 12, backgroundColor: A.card, padding: 16, gap: 12 },
  resultTitle: { color: A.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  resultCard: { alignItems: 'center', gap: 8, padding: 16, borderRadius: 8, borderWidth: 1 },
  resultArt: { width: 96, height: 96 },
  resultRarity: { fontSize: 15, fontWeight: '800' },
  resultNew: { color: '#fff', backgroundColor: A.red, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 3, overflow: 'hidden', fontSize: 11, fontWeight: '800' },
  resultNewMini: { position: 'absolute', top: -6, right: -6, color: '#fff', backgroundColor: A.red, paddingHorizontal: 5, fontSize: 9, fontWeight: '800', borderRadius: 3, overflow: 'hidden', zIndex: 1 },
  resultScroll: { maxHeight: 420, flexGrow: 0 },
  resultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  resultMini: { width: '30%', borderRadius: 8, borderWidth: 1, padding: 8, alignItems: 'center', gap: 4 },
  resultMiniArt: { width: 44, height: 44 },
  resultMiniRarity: { fontSize: 10, fontWeight: '800' },
  resultMiniName: { color: A.text, fontSize: 11, fontWeight: '700' },
  resultMiniCount: { color: A.muted, fontSize: 10, fontWeight: '800' },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  pagerBtn: { height: 32, minWidth: 72, paddingHorizontal: 12, borderRadius: 6, backgroundColor: A.cardHi, alignItems: 'center', justifyContent: 'center' },
  pagerBtnOff: { opacity: 0.4 },
  pagerText: { color: A.text, fontSize: 12, fontWeight: '700' },
  pagerNow: { color: A.muted, fontSize: 12, fontWeight: '700' },
  amount: { fontSize: 16, fontWeight: '800' },
  amountIn: { color: A.green },
  amountOut: { color: A.red },
  });
}

let styles = createTitleStyles();
registerStyleSync(() => {
  styles = createTitleStyles();
});
