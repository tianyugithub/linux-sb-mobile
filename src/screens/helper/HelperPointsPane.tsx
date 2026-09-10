import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { styles } from '../../theme/app-styles';
import { useNav } from '../../navigation/nav';
import { AccountCard, FilterChips, OutlineButton } from '../../components/account/AccountUi';
import { StatusBlock } from '../../components/ui';
import { useLedger, ledgerRowsForRange } from '../../hooks/useHelperData';
import {
  analyzeLedger,
  fmtDayTime,
  formatDelta,
  LEDGER_RANGES,
  type LedgerRange,
  type LedgerRow,
} from '../../plugins/helper/points';
import { snapshotAgeText } from '../../plugins/helper/store';
import { HelperBars, HelperCards, HelperList, HelperSection } from './HelperScreen';

/** 最近 7 天（含今天）的每日收入/支出柱状图。 */
function HelperDailyChart({ rows }: { rows: LedgerRow[] }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const end = start + 24 * 3600 * 1000;
    let income = 0;
    let expense = 0;
    rows.forEach((row) => {
      const t = new Date(row.time).getTime();
      if (Number.isNaN(t) || t < start || t >= end) return;
      if (row.delta >= 0) income += row.delta;
      else expense += Math.abs(row.delta);
    });
    return { label: `${date.getMonth() + 1}/${date.getDate()}`, income, expense, net: income - expense };
  });
  const max = days.reduce((acc, day) => Math.max(acc, day.income, day.expense), 0) || 1;
  return (
    <AccountCard>
      <View style={styles.helperRow}>
        <Text style={styles.helperRowTitle}>近七天收支</Text>
        <View style={styles.helperActions}>
          <View style={styles.helperLegend}><View style={styles.helperLegendIn} /><Text style={styles.helperRowHint}>收入</Text></View>
          <View style={styles.helperLegend}><View style={styles.helperLegendOut} /><Text style={styles.helperRowHint}>支出</Text></View>
        </View>
      </View>
      <View style={styles.helperChartRow}>
        {days.map((day) => (
          <View key={day.label} style={styles.helperChartCol}>
            <View style={styles.helperChartBars}>
              <View style={[styles.helperChartBarIn, { height: Math.max(2, Math.round((day.income / max) * 72)) }]} />
              <View style={[styles.helperChartBarOut, { height: Math.max(2, Math.round((day.expense / max) * 72)) }]} />
            </View>
            <Text style={styles.helperChartValue}>{day.net >= 0 ? `+${day.net}` : day.net}</Text>
            <Text style={styles.helperChartLabel}>{day.label}</Text>
          </View>
        ))}
      </View>
    </AccountCard>
  );
}

/** 积分账本：今日 / 昨日 / 近七天，收支卡片 + 7 日柱状图 + 分类占比 + 明细 + 时间线。 */
export function HelperPointsPane({ onDigest }: { onDigest?: (value: string) => void }) {
  const nav = useNav();
  const [range, setRange] = useState<LedgerRange>('today');
  const ledger = useLedger(nav.me.id, true);

  // 有缓存就先渲染（秒开），后台只补最新的一两页
  if (!ledger.rows.length && ledger.loading) {
    return (
      <>
        <StatusBlock loading skeleton />
        <Text style={styles.hubCardLead}>首次抓取积分流水（1 页/秒，最多 40 页，到七天前为止）… 第 {Math.max(1, ledger.page)} 页</Text>
      </>
    );
  }
  if (ledger.error && !ledger.rows.length) {
    return <StatusBlock error={ledger.error} onRetry={() => ledger.reload({ full: true })} />;
  }

  const rows = ledgerRowsForRange(ledger.rows, range);
  const analysis = analyzeLedger(rows);
  const rangeLabel = LEDGER_RANGES.find((item) => item.id === range)?.label ?? '今日';
  const expenseBuckets = analysis.buckets.filter((item) => item.amount < 0);
  const incomeBuckets = analysis.buckets.filter((item) => item.amount >= 0);
  const todayNet = analyzeLedger(ledgerRowsForRange(ledger.rows, 'today')).net;
  // hero 数字：用 effect 上报，渲染期间不 setState
  const digestRef = useRef(onDigest);
  digestRef.current = onDigest;
  useEffect(() => {
    digestRef.current?.(`${todayNet >= 0 ? '+' : ''}${todayNet}`);
  }, [todayNet]);

  return (
    <>
      <HelperSection
        title="积分账本"
        hint={`${snapshotAgeText(ledger.at)} · 共 ${ledger.rows.length} 条流水${ledger.complete ? '' : '（还在往下补）'}`}
        onRefresh={() => ledger.reload({ full: false })}
        busy={ledger.loading}
      />

      <FilterChips
        items={LEDGER_RANGES.map((item) => item.label)}
        value={rangeLabel}
        onChange={(label) => {
          const hit = LEDGER_RANGES.find((item) => item.label === label);
          if (hit) setRange(hit.id);
        }}
      />

      <HelperCards
        items={[
          { label: `${rangeLabel}收入`, value: `+${analysis.income}`, tone: 'up' },
          { label: `${rangeLabel}支出`, value: `−${analysis.expense}`, tone: 'down' },
          {
            label: '净变化',
            value: formatDelta(analysis.net),
            tone: analysis.net >= 0 ? 'up' : 'down',
            hint: `${analysis.count} 笔`,
          },
        ]}
      />

      <HelperDailyChart rows={ledger.rows} />

      {expenseBuckets.length ? (
        <>
          <Text style={styles.profileSectionTitle}>支出构成</Text>
          <HelperBars
            items={expenseBuckets.map((item) => ({ label: item.label, value: item.amount, hint: `−${Math.abs(item.amount)} · ${item.count} 笔`, income: false }))}
            positiveIsIncome={false}
          />
        </>
      ) : null}

      {incomeBuckets.length ? (
        <>
          <Text style={styles.profileSectionTitle}>收入构成</Text>
          <HelperBars
            items={incomeBuckets.map((item) => ({ label: item.label, value: item.amount, hint: `+${item.amount} · ${item.count} 笔`, income: true }))}
            positiveIsIncome
          />
        </>
      ) : null}

      <HelperList
        title="明细"
        count={analysis.count}
        hint={`只看 ${rangeLabel}，按金额排序`}
        action={<OutlineButton compact label="抓取全部" onPress={() => ledger.reload({ full: true })} />}
      >
        {analysis.topReasons.length ? analysis.topReasons.map((item) => (
          <View key={item.label} style={styles.helperRow}>
            <View style={styles.helperRowMain}>
              <Text style={styles.helperRowTitle}>{item.label}</Text>
              <Text style={styles.helperRowHint}>{item.count} 笔</Text>
            </View>
            <Text style={styles.helperRowValue}>{formatDelta(item.amount)}</Text>
          </View>
        )) : <Text style={styles.helperEmpty}>{rangeLabel}没有积分变动。</Text>}
      </HelperList>

      {analysis.timeline.length ? (
        <HelperList title="时间线" count={analysis.timeline.length} hint="连续同类变动合并成一段" maxHeight={260}>
          {analysis.timeline.map((item, index) => (
            <View key={`${item.key}-${item.start}-${index}`} style={styles.helperTlRow}>
              <View style={styles.helperTlRail}>
                <View style={[styles.helperTlDot, item.amount >= 0 ? styles.helperTlDotIn : styles.helperTlDotOut]} />
                {index < analysis.timeline.length - 1 ? <View style={styles.helperTlLine} /> : null}
              </View>
              <View style={styles.helperRowMain}>
                <Text style={styles.helperRowTitle}>{item.label}{item.count > 1 ? ` ×${item.count}` : ''}</Text>
                <Text style={styles.helperRowHint}>{fmtDayTime(item.start)}{item.count > 1 ? ` ~ ${fmtDayTime(item.end)}` : ''}</Text>
              </View>
              <Text style={styles.helperRowValue}>{formatDelta(item.amount)}</Text>
            </View>
          ))}
        </HelperList>
      ) : null}

      <Text style={styles.hubCardLead}>
        {ledger.complete ? '已覆盖近七天；更早的记录不会抓。' : '正在按页补齐七天内的记录（1 页/秒）。'}
        平时只抓最新几页并复用本地缓存，需要重新拉全量时点「抓取全部」。
      </Text>
    </>
  );
}
