import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '../services/api';
import { ApiError } from '../services/client';
import { styles } from '../theme/app-styles';
import { C, GRADIENTS } from '../theme/palette';
import { useNav } from '../navigation/nav';
import { checkinAgeText, useCheckin } from '../hooks/useCheckin';
import { AccountCard, OutlineButton, SectionHead } from '../components/account/AccountUi';
import { CompactTag, HubHero, Icon, PrimaryButton, ScreenHeader, StatusBlock } from '../components/ui';
import { checkinDayMap, checkinRecordMeta } from '../services/checkin-store';

/**
 * 签到中心：渐变 hero（连续/累计/今日）+ 近 14 天签到日历 + 记录列表。
 *
 * 记录列表是「边到边显示」的：首屏一个往返就能看到状态与最近记录，
 * 更早的历史在后台每批 3 页并发补齐，抓完落盘，下次进来秒开。
 */
export function CheckinScreen() {
  const nav = useNav();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const checkin = useCheckin(nav.me.id, nav.loggedIn);
  const checked = checkin.points?.checkedIn ?? nav.checkedIn;
  const records = checkin.records;
  const days = checkinDayMap(records, 14);
  /**
   * 数字优先用官网签到页的权威值（连续天数/累计签到）；
   * 还没回来时先用盘上快照数出来，这样冷启动也不会先闪一串 0。
   */
  const derivedStreak = (() => {
    let run = 0;
    for (let index = days.length - 1; index >= 0 && days[index].checked; index -= 1) run += 1;
    return run;
  })();
  const streak = checkin.points?.streak ?? derivedStreak;
  const total = checkin.points?.total ?? records.length;
  const rows = records.map((record) => ({ record, meta: checkinRecordMeta(record.date) }));

  const signIn = async () => {
    if (!nav.loggedIn) {
      nav.open({ name: 'login' });
      return;
    }
    setBusy(true);
    try {
      const n = await nav.checkIn();
      setError('');
      checkin.reload({ full: true });
      nav.toast(n ? `签到成功 +${n}` : '今天已签到');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '签到失败');
    } finally {
      setBusy(false);
    }
  };

  if (!nav.loggedIn) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="签到中心" />
        <ScrollView contentContainerStyle={styles.checkinPage}>
          <StatusBlock
            empty
            emptyTitle="登录后签到"
            emptyCopy="每天签到可以领积分，连续签到天数越多越划算。"
          />
          <PrimaryButton label="去登录" block onPress={() => nav.open({ name: 'login' })} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="签到中心"
        right={(
          <Pressable
            onPress={() => checkin.reload({ full: true })}
            hitSlop={8}
            accessibilityLabel="刷新签到数据"
          >
            <Icon name="refresh-outline" size={20} color={C.muted} />
          </Pressable>
        )}
      />
      <ScrollView contentContainerStyle={styles.checkinPage}>
        <HubHero
          kicker="DAILY CHECK IN"
          title={checked ? '今天已签到' : '今天还没签到'}
          lead={checked ? `已连续 ${streak} 天，累计 ${total} 次。明天记得继续。` : '点下面的按钮领取今天的积分。'}
          icon={checked ? 'checkmark-circle-outline' : 'alarm-outline'}
          colors={checked ? GRADIENTS.done : GRADIENTS.brand}
          awards={[
            { label: '连续天数', value: streak },
            { label: '累计签到', value: total },
            { label: '积分余额', value: checkin.points?.balance ?? nav.me.points ?? 0 },
          ]}
        />

        {error ? <Text style={styles.authError}>{error}</Text> : null}
        {!checked ? (
          <PrimaryButton label={busy ? '签到中…' : '签到领取积分'} block disabled={busy} onPress={() => void signIn()} />
        ) : null}

        <SectionHead title="近 14 天" extra={<Text style={styles.helperRowHint}>{streak ? `已连续 ${streak} 天` : '从今天开始'}</Text>} />
        <AccountCard>
          <View style={styles.checkinDayRow}>
            {days.map((day) => (
              <View key={day.date.toISOString()} style={styles.checkinDayCol}>
                <View style={[styles.checkinDayDot, day.checked && styles.checkinDayDotOn]}>
                  {day.checked ? <Icon name="checkmark" size={11} color="#fff" /> : null}
                </View>
                <Text style={[styles.checkinDayLabel, day.checked && styles.checkinDayLabelOn]}>
                  {day.date.getDate()}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.helperRowHint}>实心即当天已签到；数据来自积分明细里的「每日签到」记录。</Text>
        </AccountCard>

        <SectionHead
          title={`签到记录（${records.length}${checkin.complete ? '' : `/${total || '…'}`}）`}
          extra={checkin.filling ? <Text style={styles.helperRowHint}>后台补齐中…</Text> : null}
        />
        {checkin.loading && !records.length ? <StatusBlock loading /> : null}
        {!checkin.loading && records.length === 0 ? (
          <Text style={styles.helperEmpty}>还没有签到记录。今天签到后就会出现第一条。</Text>
        ) : null}
        {records.length ? (
          <View style={styles.checkinListBox}>
            <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
              <View style={styles.helperListInner}>
                {rows.map(({ record, meta }, index) => (
                  <View key={`${record.date}-${index}`}>
                    {index > 0 ? <View style={styles.helperRowSep} /> : null}
                    <View style={styles.helperRow}>
                      <View style={styles.checkinRecordIcon}>
                        <Icon name="calendar-outline" size={14} color={C.muted} />
                      </View>
                      <View style={styles.helperRowMain}>
                        <Text style={styles.helperRowTitle}>
                          {meta.day}
                          <Text style={styles.helperRowHint}>{meta.weekday ? ` ${meta.weekday}` : ''}</Text>
                        </Text>
                        <Text style={styles.helperRowHint}>{meta.time ? `${meta.time} 签到` : '每日签到'}</Text>
                      </View>
                      <CompactTag tone="success">{record.gain == null ? '已签到' : `+${record.gain}`}</CompactTag>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        <Text style={styles.hubCardLead}>
          {checkin.complete
            ? `已列全 ${records.length} 条签到记录（${checkinAgeText(checkin.at)}），本机只留最近一年。`
            : `先显示最近的记录，更早的历史正在后台补齐（已抓 ${checkin.pages} 页）…`}
        </Text>
        <OutlineButton
          compact
          label="查看完整积分明细"
          onPress={() => nav.openWeb(`https://linux.sb/user/${nav.me.id}?tab=points_rewards`, '积分明细')}
        />
      </ScrollView>
    </View>
  );
}
