import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { C } from '../../theme/palette';
import { styles } from '../../theme/app-styles';
import { useNav } from '../../navigation/nav';
import { api } from '../../services/api';
import { AccountCard, OutlineButton } from '../../components/account/AccountUi';
import { CompactTag, Icon, PrimaryButton, StatusBlock } from '../../components/ui';
import { loadMarketStore, saveMarketStore, type MarketStore } from '../../hooks/useHelperData';
import { matchWatchList, normalizeKeyword, pickFreshHits, type MarketHit, type MarketWatch } from '../../plugins/helper/market';
import { ensureLocalNotifyPermission, notifyLocal } from '../../services/local-notify';
import { HelperList, HelperSection } from './HelperScreen';

const POLL_MS = 10_000;
const IDLE_POLL_MS = 30_000;

/** 称号监控：按称号名 + 期望价盯市场最新挂牌，命中就提醒（前台轮询，离开即停）。 */
export function HelperMarketPane({ onDigest }: { onDigest?: (value: string) => void }) {
  const nav = useNav();
  const uid = nav.me.id;
  const [store, setStore] = useState<MarketStore>({ watches: [], notified: {} });
  const [keyword, setKeyword] = useState('');
  const [price, setPrice] = useState('');
  const [running, setRunning] = useState(false);
  const [hits, setHits] = useState<MarketHit[]>([]);
  const [checkedAt, setCheckedAt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const storeRef = useRef(store);
  storeRef.current = store;
  const hitsRef = useRef('');

  useEffect(() => {
    let alive = true;
    void loadMarketStore(uid).then((next) => {
      if (alive) setStore(next);
    });
    return () => {
      alive = false;
    };
  }, [uid]);

  const persist = useCallback(async (next: MarketStore) => {
    setStore(next);
    await saveMarketStore(uid, next);
  }, [uid]);

  const tick = useCallback(async () => {
    const { watches, notified } = storeRef.current;
    if (!watches.length) return;
    setBusy(true);
    try {
      const page = await api.titleMarket({ cursor: '1', fresh: true });
      const live = new Set(page.items.map((item) => item.id));
      const matched = matchWatchList(watches, page.items);
      const { fresh, notified: nextNotified } = pickFreshHits(matched, notified, live);
      setHits(matched);
      setCheckedAt(Date.now());
      setError('');
      if (fresh.length) {
        const next = { watches, notified: nextNotified };
        setStore(next);
        void saveMarketStore(uid, next);
        // 同一个挂单只提醒一次；多条命中合成一条通知
        const text = fresh
          .map((hit) => `${hit.listing.name} ${hit.listing.rarity} ¥${hit.listing.price}`)
          .join(' · ');
        void notifyLocal('称号监控命中', text);
        nav.toast(`称号监控：${text}`);
      } else {
        setStore({ watches, notified: nextNotified });
      }
      hitsRef.current = matched.map((hit) => `${hit.watch.id}:${hit.listing.id}`).join(',');
    } catch (err) {
      setError(err instanceof Error ? err.message : '市场抓取失败');
    } finally {
      setBusy(false);
    }
  }, [nav, uid]);

  useEffect(() => {
    if (!running) return;
    void tick();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = () => {
      if (cancelled) return;
      const interval = hitsRef.current ? POLL_MS : IDLE_POLL_MS;
      timer = setTimeout(() => {
        void tick().finally(loop);
      }, interval);
    };
    loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, tick]);

  const add = async () => {
    const name = keyword.trim();
    const threshold = Number(price.trim());
    if (!name) {
      nav.toast('先填称号名（支持部分匹配）');
      return;
    }
    if (!Number.isFinite(threshold) || threshold <= 0) {
      nav.toast('先填期望价（整数积分）');
      return;
    }
    if (store.watches.some((item) => normalizeKeyword(item.keyword) === normalizeKeyword(name))) {
      nav.toast('这个称号已经在监控里了');
      return;
    }
    await persist({ ...store, watches: [...store.watches, { id: `w${Date.now().toString(36)}`, keyword: name, price: Math.round(threshold) }] });
    setKeyword('');
    setPrice('');
  };

  const digestRef = useRef(onDigest);
  digestRef.current = onDigest;
  useEffect(() => {
    digestRef.current?.(store.watches.length ? `${store.watches.length} 项` : '未设置');
  }, [store.watches.length]);

  const remove = async (id: string) => {
    await persist({ watches: store.watches.filter((item) => item.id !== id), notified: { ...store.notified, [id]: [] } });
    setHits((prev) => prev.filter((hit) => hit.watch.id !== id));
  };

  return (
    <>
      <HelperSection
        title="称号监控"
        hint={checkedAt ? `最近检查 ${new Date(checkedAt).toLocaleTimeString()}` : '按「称号名 + 期望价」盯最新挂牌'}
        onRefresh={() => void tick()}
        busy={busy}
      />

      <AccountCard>
        <View style={styles.helperRow}>
          <View style={styles.helperRowMain}>
            <Text style={styles.helperRowTitle}>{running ? '监控中' : '已暂停'}</Text>
            <Text style={styles.helperRowHint}>前台约 10 秒一轮，无变化自动放慢；离开页面即停</Text>
          </View>
          <Switch
            value={running}
            onValueChange={async (next) => {
              setRunning(next);
              if (next) {
                const granted = await ensureLocalNotifyPermission();
                nav.toast(granted ? '开始监控（前台 10 秒一轮）' : '已开始监控；未授予通知权限，只会在页面内提示');
                return;
              }
              nav.toast('已停止监控');
            }}
            trackColor={{ false: C.line, true: C.red }}
            thumbColor="#fff"
          />
        </View>
      </AccountCard>

      <Text style={styles.profileSectionTitle}>新增监控项</Text>
      <AccountCard>
        <View style={styles.helperActions}>
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder="称号名，支持部分匹配"
            placeholderTextColor={C.dim}
            style={[styles.composeInput, styles.flexGrow]}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="期望价"
            placeholderTextColor={C.dim}
            keyboardType="number-pad"
            style={[styles.composeInput, styles.helperPriceInput]}
          />
        </View>
        <PrimaryButton label="添加监控" block onPress={() => void add()} />
      </AccountCard>

      <HelperList
        title="监控项"
        count={store.watches.length}
        hint="命中阈值会弹系统通知，同一条挂单只提醒一次"
        maxHeight={300}
      >
        {store.watches.length ? store.watches.map((watch: MarketWatch) => {
          const hit = hits.find((item) => item.watch.id === watch.id);
          return (
            <View key={watch.id} style={styles.helperRow}>
              <View style={styles.helperRowMain}>
                <View style={styles.pluginTitleRow}>
                  <Text style={styles.helperRowTitle}>{watch.keyword}</Text>
                  {hit ? <CompactTag tone="success">达标</CompactTag> : null}
                </View>
                {hit ? (
                  <Pressable
                    onPress={() => nav.open({ name: 'titles', tab: '称号交易' })}
                    accessibilityLabel="去称号市场"
                  >
                    <Text style={styles.helperRowHint}>
                      {hit.listing.name} · {hit.listing.rarity} · 单价 {hit.listing.price} · 剩余 {hit.listing.stock}
                      {hit.listing.remain ? ` · ${hit.listing.remain}` : ''}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.helperRowHint}>单价 ≤ {watch.price} 积分 · 暂无达标挂牌</Text>
                )}
              </View>
              {hit ? <Icon name="chevron-forward" size={14} color={C.dim} /> : null}
              <OutlineButton compact label="删除" onPress={() => void remove(watch.id)} />
            </View>
          );
        }) : <Text style={styles.helperEmpty}>还没有监控项。上面填称号名与期望价即可添加。</Text>}
      </HelperList>

      {error ? (
        <StatusBlock error={error} onRetry={() => void tick()} />
      ) : (
        <Text style={styles.hubCardLead}>
          监控基于官网交易市场的公开挂牌（只看「最新发布」第一页），与 App 的称号中心是同一份数据；提醒仅在本机产生。
        </Text>
      )}
    </>
  );
}
