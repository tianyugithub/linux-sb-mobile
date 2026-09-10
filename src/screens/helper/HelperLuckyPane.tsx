import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { C } from '../../theme/palette';
import { styles } from '../../theme/app-styles';
import { useNav } from '../../navigation/nav';
import { api } from '../../services/api';
import { AccountCard, OutlineButton } from '../../components/account/AccountUi';
import { Icon, StatusBlock } from '../../components/ui';
import { useLedger, useLuckyStats } from '../../hooks/useHelperData';
import {
  estimateLucky,
  LUCKY_FALLBACK_RULES,
  LUCKY_RULE_TOPIC_ID,
  luckyRoi,
  parseLuckyRules,
  type LuckyRules,
} from '../../plugins/helper/lucky';
import { snapshotAgeText } from '../../plugins/helper/store';
import { HelperCards, HelperList, HelperSection } from './HelperScreen';

/** 幸运打赏：今日次数/收入/净投入 + 中奖率估算（规则优先从规则帖解析）+ 玩家列表。 */
export function HelperLuckyPane({ onDigest }: { onDigest?: (value: string) => void }) {
  const nav = useNav();
  const ledger = useLedger(nav.me.id, true);
  const { stats, repliesToday } = useLuckyStats(ledger.rows, nav.me.id, true);
  const [rules, setRules] = useState<LuckyRules>(LUCKY_FALLBACK_RULES);
  const [ruleSource, setRuleSource] = useState('内置兜底值');
  const [ruleOpen, setRuleOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const detail = await api.topic(LUCKY_RULE_TOPIC_ID);
        const parsed = parseLuckyRules(`${detail.topic.title} ${detail.topic.body ?? ''}`);
        if (!alive) return;
        setRules(parsed);
        setRuleSource('已按规则帖校准');
      } catch {
        /* 规则帖读不到就用兜底常量 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const estimate = estimateLucky(stats, repliesToday ?? 0, rules);
  const roi = luckyRoi(stats);
  const digestRef = useRef(onDigest);
  digestRef.current = onDigest;
  useEffect(() => {
    digestRef.current?.(stats.tips ? `${stats.tips} 次` : '0 次');
  }, [stats.tips]);
  const gauge = Math.max(0, Math.min(100, estimate.prob));

  if (!stats.tips && !stats.lucky && ledger.loading && !ledger.rows.length) {
    return (
      <>
        <StatusBlock loading skeleton />
        <Text style={styles.hubCardLead}>正在抓取今日积分流水…</Text>
      </>
    );
  }

  return (
    <>
      <HelperSection
        title="幸运打赏"
        hint={`统计今日 · ${ruleSource} · ${snapshotAgeText(ledger.at)}`}
        onRefresh={() => ledger.reload({ full: false })}
        busy={ledger.loading}
      />

      <AccountCard>
        <View style={styles.helperRow}>
          <View style={styles.helperRowMain}>
            <Text style={styles.helperRowTitle}>下次打赏中奖率</Text>
            <Text style={styles.helperRowHint}>{estimate.note}</Text>
          </View>
          <Text style={styles.helperBig}>{estimate.locked ? '—' : `${estimate.prob}%`}</Text>
        </View>
        <View style={styles.helperGauge}>
          <View
            style={[
              styles.helperGaugeFill,
              estimate.locked || estimate.prob === 0 ? styles.helperGaugeFillOff : null,
              { width: `${Math.max(4, gauge)}%` },
            ]}
          />
        </View>
        <View style={styles.helperActions}>
          <OutlineButton compact label="规则帖" onPress={() => nav.openWeb(`https://linux.sb/topic/${LUCKY_RULE_TOPIC_ID}`, '幸运打赏规则')} />
          <OutlineButton compact label="积分明细" onPress={() => nav.open({ name: 'checkin' })} />
          <OutlineButton compact label={ruleOpen ? '收起阈值' : '看阈值'} onPress={() => setRuleOpen((open) => !open)} />
        </View>
        {ruleOpen ? (
          <Text style={styles.helperRowHint}>
            每日上限 {rules.dailyCap} 次 · 累计奖励 ≥ {rules.highThreshold} 分后概率归 0 · 回帖门槛 {rules.replyCap} 次
            {repliesToday === null ? '' : `（今日已回帖 ${repliesToday}）`}
          </Text>
        ) : null}
      </AccountCard>

      <HelperCards
        items={[
          { label: '今日打赏', value: `${stats.tips} 次`, hint: `花费 ${stats.spent} 分` },
          { label: '幸运奖励', value: `${stats.luckyGained} 分`, tone: 'up', hint: `触发 ${stats.lucky} 次` },
          {
            label: '净投入',
            value: `${stats.spent - stats.luckyGained} 分`,
            tone: stats.spent - stats.luckyGained > 0 ? 'down' : 'up',
            hint: roi === null ? '还没有投入' : `回报率 ${roi}%`,
          },
        ]}
      />

      <HelperList
        title="今日打赏过的玩家"
        count={stats.distinctPlayers}
        hint={stats.tips ? `共 ${stats.tips} 次${stats.duplicateTips ? `，重复打赏 ${stats.duplicateTips} 次` : ''}` : undefined}
        maxHeight={200}
      >
        {stats.players.length ? [...new Set(stats.players)].map((player) => (
          <View key={player} style={styles.helperRow}>
            <View style={styles.helperRowMain}>
              <Text style={styles.helperRowTitle}>{player}</Text>
            </View>
            <Text style={styles.helperRowValue}>{stats.players.filter((item) => item === player).length} 次</Text>
          </View>
        )) : <Text style={styles.helperEmpty}>今天还没有打赏记录。打赏新玩家更容易触发幸运奖励。</Text>}
      </HelperList>

      <AccountCard>
        <View style={styles.helperRow}>
          <View style={styles.helperRowMain}>
            <Text style={styles.helperRowTitle}>今日收到打赏</Text>
            <Text style={styles.helperRowHint}>别人打赏你的主题</Text>
          </View>
          <Text style={styles.helperRowValue}>{stats.received} 次</Text>
        </View>
        <View style={styles.helperRowSep} />
        <View style={styles.helperRow}>
          <View style={styles.helperRowMain}>
            <Text style={styles.helperRowTitle}>今日回帖</Text>
            <Text style={styles.helperRowHint}>回帖达到门槛才解锁打赏概率</Text>
          </View>
          <Text style={styles.helperRowValue}>{repliesToday === null ? '—' : `${repliesToday} 次`}</Text>
        </View>
      </AccountCard>

      <Pressable
        onPress={() => nav.openWeb(`https://linux.sb/topic/${LUCKY_RULE_TOPIC_ID}`, '幸运打赏规则')}
        style={styles.helperRow}
        accessibilityLabel="在网页打开规则帖"
      >
        <Text style={styles.helperRowTitle}>在网页打开规则帖</Text>
        <Icon name="open-outline" size={16} color={C.muted} />
      </Pressable>
    </>
  );
}
