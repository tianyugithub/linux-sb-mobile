import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { api } from '../services/api';
import { ApiError } from '../services/client';
import {
  ShopError,
  clearPendingOrder,
  extractRedeemCodes,
  loadPendingOrder,
  shopChannels,
  shopCreateOrder,
  shopGoodsList,
  shopOrderInfo,
  shopQueryPaid,
  type ShopGoods,
  type ShopPendingOrder,
} from '../services/catfk-shop';
import { useAsync } from '../hooks/useAsync';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { openAppHref, useNav } from '../navigation/nav';
import { ConfirmDialog, GhostButton, HubHero, Icon, PrimaryButton, ScreenHeader, StatusBlock, type DialogState } from '../components/ui';
import { copyText } from '../utils/share';
import { cacheDelete } from '../services/query-cache';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errText(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof ShopError || error instanceof Error) return error.message || fallback;
  return fallback;
}

export function WalletScreen() {
  const nav = useNav();
  const query = useAsync(async () => {
    if (!nav.loggedIn) return null;
    return api.wallet({ fresh: true });
  }, [nav.loggedIn, nav.me.id], `wallet:${nav.loggedIn ? nav.me.id : '0'}`);
  const data = query.data;
  const [goods, setGoods] = useState<ShopGoods[]>([]);
  const [goodsError, setGoodsError] = useState('');
  const [pending, setPending] = useState<ShopPendingOrder | null>(null);
  const [busy, setBusy] = useState('');
  const [code, setCode] = useState('');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [codesToCopy, setCodesToCopy] = useState<string[]>([]);
  const pendingRef = useRef<ShopPendingOrder | null>(null);
  const finishingRef = useRef(false);
  pendingRef.current = pending;

  const loadGoods = useCallback(async () => {
    try {
      const items = await shopGoodsList();
      setGoods(items);
      setGoodsError(items.length ? '' : '店面暂时没有可售兑换码');
    } catch (error) {
      setGoods([]);
      setGoodsError(errText(error, '无法读取充值档位'));
    }
  }, []);

  useEffect(() => {
    void loadGoods();
    void loadPendingOrder().then((order) => {
      if (order) setPending(order);
    });
  }, [loadGoods]);

  const finishPaid = useCallback(async (order: ShopPendingOrder) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setBusy('正在领取兑换码');
    try {
      let cards: string[] = [];
      let paid = false;
      for (let i = 0; i < 8; i += 1) {
        const info = await shopOrderInfo(order.tradeNo);
        cards = info.cards;
        paid = info.status === 1 || cards.length > 0;
        if (cards.length) break;
        if (info.status !== 1) break;
        await sleep(1500);
      }
      if (!paid) {
        nav.toast('还没有支付成功');
        return;
      }
      const redeemCodes = extractRedeemCodes(cards);
      if (!redeemCodes.length) {
        setCodesToCopy(cards);
        nav.toast('已付款，但还没拿到兑换码，请稍后下拉刷新或复制卡密');
        return;
      }
      const leftover: string[] = [];
      let lastBalance = data?.balance;
      for (const item of redeemCodes) {
        try {
          const result = await api.redeemWallet(item);
          lastBalance = result.balance;
        } catch {
          leftover.push(item);
        }
      }
      if (leftover.length) {
        setCodesToCopy(leftover);
        nav.toast(leftover.length === redeemCodes.length ? '兑换失败，兑换码已留下可复制' : '部分兑换码未成功，请手动兑换');
      } else {
        setCodesToCopy([]);
        nav.toast(lastBalance !== undefined ? `已到账，当前 ${lastBalance} 烧饼` : '兑换成功');
      }
      await clearPendingOrder();
      setPending(null);
      cacheDelete(`wallet:${nav.me.id}`);
      query.reload();
    } catch (error) {
      nav.toast(errText(error, '领取兑换码失败'));
    } finally {
      finishingRef.current = false;
      setBusy('');
    }
  }, [data?.balance, nav, query]);

  useEffect(() => {
    if (!pending) return;
    let stop = false;
    const tick = async () => {
      if (stop || finishingRef.current) return;
      try {
        const paid = await shopQueryPaid(pending.tradeNo);
        if (paid && !stop) await finishPaid(pending);
      } catch {
        /* 网络抖动时继续等 */
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 3000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void tick();
    });
    return () => {
      stop = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [pending, finishPaid]);

  const openPay = async (order: ShopPendingOrder) => {
    try {
      await Linking.openURL(order.payurl);
    } catch {
      nav.openWeb(order.payurl, '支付');
    }
  };

  const startBuy = async (item: ShopGoods) => {
    if (!nav.loggedIn) {
      nav.open({ name: 'login' });
      return;
    }
    if (pending) {
      nav.toast('还有一笔待支付订单，请先完成或放弃');
      return;
    }
    setBusy('正在下单');
    try {
      const channels = await shopChannels();
      const channel = channels[0];
      if (!channel) throw new ShopError('店面暂未开通支付通道');
      const contact = `linux.sb ${nav.me.name} ${nav.me.uid}`.trim();
      const order = await shopCreateOrder({ goods: item, channel, contact });
      setPending(order);
      setBusy('');
      nav.toast('订单已创建，请在支付宝里确认付款');
      await openPay(order);
    } catch (error) {
      setBusy('');
      nav.toast(errText(error, '下单失败'));
    }
  };

  const redeemManual = async () => {
    const next = code.trim();
    if (!next) {
      nav.toast('请输入兑换码');
      return;
    }
    setBusy('正在兑换');
    try {
      const result = await api.redeemWallet(next);
      setCode('');
      cacheDelete(`wallet:${nav.me.id}`);
      query.reload();
      nav.toast(result.message || `已到账，当前 ${result.balance} 烧饼`);
    } catch (error) {
      nav.toast(errText(error, '兑换失败'));
    } finally {
      setBusy('');
    }
  };

  if (!nav.loggedIn) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="我的烧饼" />
        <View style={styles.empty}>
          <Icon name="wallet-outline" size={36} color={C.dim} />
          <Text style={styles.emptyTitle}>登录后查看烧饼余额</Text>
          <PrimaryButton label="登录" onPress={() => nav.open({ name: 'login' })} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title="我的烧饼" />
      <ScrollView
        contentContainerStyle={styles.hubPage}
        keyboardShouldPersistTaps="handled"
        refreshControl={(
          <RefreshControl
            refreshing={Boolean(query.fetching && data)}
            onRefresh={() => {
              query.reload();
              void loadGoods();
              const order = pendingRef.current;
              if (order) void shopQueryPaid(order.tradeNo).then((paid) => { if (paid) void finishPaid(order); }).catch(() => undefined);
            }}
            tintColor={C.muted}
          />
        )}
      >
        {query.loading && !data ? <StatusBlock loading error={query.error} onRetry={query.reload} /> : null}
        {query.error && !data ? <StatusBlock error={query.error} onRetry={query.reload} /> : null}
        {data ? (
          <>
            <HubHero
              kicker="WALLET"
              title={data.title}
              lead={data.lead}
              icon="wallet-outline"
              colors={['#3A2410', '#B45309', '#F5A623']}
              awards={[
                { label: '可用余额', value: `${data.balance}` },
                { label: '单位', value: data.unit },
              ]}
            />

            {pending ? (
              <View style={styles.hubCard}>
                <Text style={styles.hubCardTitle}>待支付</Text>
                <Text style={styles.hubCardLead}>
                  {pending.goodsName} · ¥{pending.amount} · {pending.channelName}
                  {'\n'}订单号 {pending.tradeNo}
                  {'\n'}请在支付宝里确认付款，回来后会自动兑换到账。
                </Text>
                {busy ? <Text style={styles.hubEmptyHint}>{busy}</Text> : null}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <GhostButton flex label="重新打开支付" onPress={() => { void openPay(pending); }} />
                  <GhostButton flex label="放弃这笔" onPress={() => {
                    void clearPendingOrder();
                    setPending(null);
                  }} />
                </View>
                <PrimaryButton
                  block
                  label="我已支付"
                  disabled={Boolean(busy)}
                  onPress={() => { void finishPaid(pending); }}
                />
              </View>
            ) : (
              <View style={styles.hubCard}>
                <Text style={styles.hubCardTitle}>充值档位</Text>
                <Text style={styles.hubCardLead}>点档位会直接走官方店面下单，在支付宝里确认付款后自动兑换。</Text>
                {goodsError && !goods.length ? <Text style={styles.hubEmptyHint}>{goodsError}</Text> : null}
                <View style={styles.idBenefitGrid}>
                  {goods.map((item) => (
                    <Pressable
                      key={item.goodsKey}
                      disabled={Boolean(busy)}
                      onPress={() => setDialog({
                        title: '确认购买',
                        text: `将通过官方店面下单，支付 ¥${item.price} 购买「${item.name}」。钱只在支付宝里由你确认，App 不会替你付款。`,
                        confirmLabel: '去支付',
                        onConfirm: () => startBuy(item),
                      })}
                      style={styles.idBenefit}
                    >
                      <Text style={styles.idBenefitTitle}>{item.name}</Text>
                      <Text style={styles.idBenefitDesc}>¥{item.price}{item.stock ? ` · 库存 ${item.stock}` : ''}</Text>
                    </Pressable>
                  ))}
                </View>
                {busy ? <Text style={styles.hubEmptyHint}>{busy}</Text> : null}
              </View>
            )}

            <View style={styles.hubCard}>
              <Text style={styles.hubCardTitle}>兑换码充值</Text>
              <Text style={styles.hubCardLead}>{data.redeemHint}</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder={data.placeholder}
                placeholderTextColor={C.dim}
                autoCapitalize="characters"
                autoCorrect={false}
                style={[styles.composeInput, { marginTop: 12 }]}
              />
              <PrimaryButton block label={busy === '正在兑换' ? '兑换中…' : '立即兑换'} disabled={Boolean(busy)} onPress={() => { void redeemManual(); }} />
            </View>

            {codesToCopy.length ? (
              <View style={styles.hubCard}>
                <Text style={styles.hubCardTitle}>待兑换卡密</Text>
                <View style={styles.ivLinkBox}>
                  <Text selectable style={styles.ivLinkText}>{codesToCopy.join('\n')}</Text>
                </View>
                <PrimaryButton
                  block
                  label="复制卡密"
                  onPress={async () => {
                    await copyText(codesToCopy.join('\n'));
                    nav.toast('已复制');
                  }}
                />
              </View>
            ) : null}

            <View style={styles.hubCard}>
              <Text style={styles.hubCardTitle}>收支明细</Text>
              <Text style={styles.hubCardLead}>最近 30 条</Text>
              {data.ledger.length ? data.ledger.map((row, index) => (
                <View key={`${row.time}-${index}`} style={[styles.idRow, index === data.ledger.length - 1 && styles.idRowLast]}>
                  <View style={styles.idRowCopy}>
                    <Text style={styles.idRowTitle}>{row.amount || row.text}</Text>
                    <Text style={styles.idRowDetail}>{row.time ? `${row.time}  ${row.text}` : row.text}</Text>
                  </View>
                </View>
              )) : <Text style={styles.hubEmptyHint}>还没有收支记录。</Text>}
            </View>

            {data.helpUrl ? (
              <Pressable onPress={() => openAppHref(nav, data.helpUrl)} style={styles.ivRule}>
                <Text style={styles.ivRuleText}>点击查看烧饼说明 &gt;&gt;</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}
