import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { styles } from '../../theme/app-styles';
import { useNav } from '../../navigation/nav';
import { FilterChips, OutlineButton, SectionHead, TitleChip } from '../../components/account/AccountUi';
import { StatusBlock } from '../../components/ui';
import type { TitleRarity } from '../../data/title-catalog';
import { useSynth, useTitleRarityMap } from '../../hooks/useHelperData';
import { RANGE_CHIPS, type RangeLabel } from '../../plugins/helper/range';
import { snapshotAgeText } from '../../plugins/helper/store';
import { HelperBars, HelperCards, HelperList, HelperSection } from './HelperScreen';

/** 称号合成：只统计熔炼/配方合成通知，按称号级别汇总，并显示被过滤的条数。 */
export function HelperSynthPane({ onDigest }: { onDigest?: (value: string) => void }) {
  const nav = useNav();
  const rarityOf = useTitleRarityMap(true);
  const synth = useSynth(nav.me.id, true, rarityOf);
  const [rangeLabel, setRangeLabel] = useState<RangeLabel>(RANGE_CHIPS[0]);
  const summary = useMemo(
    () => synth.summary(rangeLabel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [synth.entries, rangeLabel, rarityOf],
  );

  // hooks 必须在早返回之前（见 HelperPointsPane 的说明：写在后面会因 hook 数量变化而崩）
  const digestRef = useRef(onDigest);
  digestRef.current = onDigest;
  useEffect(() => {
    digestRef.current?.(summary.count ? `${summary.count} 次` : '0 次');
  }, [summary.count]);

  if (!synth.entries.length && synth.loading) {
    return (
      <>
        <StatusBlock loading skeleton />
        <Text style={styles.hubCardLead}>首次抓取通知并解析合成记录…</Text>
      </>
    );
  }
  if (synth.error && !synth.entries.length) {
    return <StatusBlock error={synth.error} onRetry={() => synth.reload({ full: true })} />;
  }

  const consumption = summary.consumedByRarity;
  const production = summary.gainsByRarity;

  return (
    <>
      <HelperSection
        title="称号合成"
        hint={`${snapshotAgeText(synth.at)} · ${summary.count} 次合成 · 已缓存 ${synth.entries.length} 条记录`}
        onRefresh={() => synth.reload({ full: false })}
        busy={synth.loading}
      />

      <FilterChips items={RANGE_CHIPS} value={rangeLabel} onChange={setRangeLabel} />

      <HelperCards
        items={[
          { label: '合成次数', value: String(summary.count) },
          { label: '消耗称号', value: String(summary.consumedTotal) },
          { label: '获得称号', value: String(summary.gainTotal) },
        ]}
      />

      {consumption.length ? (
        <>
          <Text style={styles.profileSectionTitle}>消耗（按级别）</Text>
          <HelperBars
            items={consumption.map((item) => ({ label: `${item.rarity} 称号`, value: item.count, hint: `${item.count} 个`, rarity: item.rarity }))}
          />
        </>
      ) : null}

      {production.length ? (
        <>
          <Text style={styles.profileSectionTitle}>产出（按级别）</Text>
          <HelperBars
            items={production.map((item) => ({ label: `${item.rarity} 称号`, value: item.count, hint: `${item.count} 个`, rarity: item.rarity }))}
          />
        </>
      ) : null}

      <SectionHead
        title={`产出的称号（${summary.gainsByName.length}）`}
        extra={<OutlineButton compact label="抓取全部" onPress={() => synth.reload({ full: true })} />}
      />
      <Text style={styles.helperRowHint}>按称号池标注真实级别</Text>
      {summary.gainsByName.length ? (
        <View style={styles.helperTitleWrap}>
          {summary.gainsByName.map((gain) => (
            <TitleChip
              key={gain.name}
              name={gain.name}
              rarity={(gain.rarity || 'N') as TitleRarity}
              copies={gain.count}
              compact
            />
          ))}
        </View>
      ) : (
        <Text style={styles.helperEmpty}>{rangeLabel}没有识别到合成通知。</Text>
      )}

      <Text style={styles.hubCardLead}>
        {summary.filtered ? `已过滤 ${summary.filtered} 条非合成通知（回收 / 售出 / 打赏 / 提及 / 抽奖 / 赠送等不计入）。` : '本次通知里没有非合成项。'}
        只认「批量熔炼」和「配方合成」两类文案；通知里没有的合成不会被统计。
      </Text>
      {synth.at ? (
        <Text style={styles.pluginCredit}>
          缓存时间 {new Date(synth.at).toLocaleString()}{synth.complete ? '（已覆盖近七天）' : '（还在补齐）'}
        </Text>
      ) : null}
    </>
  );
}
