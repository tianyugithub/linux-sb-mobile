import React, { useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { IonName } from '../../data';
import { api } from '../services/api';
import { ApiError } from '../services/client';
import { useAsync } from '../hooks/useAsync';
import { useKeyboardLift } from '../hooks/useKeyboardLift';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { HubHero, Icon, PrimaryButton, ScreenHeader, StatusBlock } from '../components/ui';
import { titleArt } from '../data/title-art';
import type { IdentityCriterionDto } from '../types/api';

function benefitIcon(title: string): IonName {
  if (/图片|附件|上传/.test(title)) return 'image-outline';
  if (/举报/.test(title)) return 'flag-outline';
  if (/抽奖|公益/.test(title)) return 'gift-outline';
  if (/随机|概率|爆率/.test(title)) return 'sparkles-outline';
  return 'ribbon-outline';
}

function CriteriaList({ items }: { items: IdentityCriterionDto[] }) {
  return (
    <>
      {items.map((item, index) => (
        <View key={item.title} style={[styles.idRow, index === items.length - 1 && styles.idRowLast]}>
          <View style={[
            styles.idMarkDot,
            item.pass ? styles.idMarkPass : item.soft ? styles.idMarkSoft : styles.idMarkFail,
          ]}>
            <Icon
              name={item.pass ? 'checkmark' : item.soft ? 'remove' : 'close'}
              size={13}
              color={item.pass ? '#fff' : item.soft ? C.orange : '#fff'}
            />
          </View>
          <View style={styles.idRowCopy}>
            <Text style={styles.idRowTitle}>{item.title}</Text>
            {item.detail ? <Text style={styles.idRowDetail}>{item.detail}</Text> : null}
          </View>
        </View>
      ))}
    </>
  );
}

export function IdentityScreen() {
  const nav = useNav();
  const kb = useKeyboardLift();
  const query = useAsync(() => api.identity(), [nav.loggedIn], `identity:${nav.loggedIn ? '1' : '0'}`);
  const data = query.data;
  const [agreed, setAgreed] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const hard = [...(data?.creator ?? []), ...(data?.account ?? [])].filter((item) => !item.soft);
  const passed = hard.filter((item) => item.pass).length;
  const canApply = Boolean(data?.ready && agreed && !busy);
  const apply = async () => {
    if (!nav.loggedIn) {
      nav.open({ name: 'login' });
      return;
    }
    if (!data?.ready || !agreed || busy) return;
    setBusy(true);
    try {
      const result = await api.applyIdentity();
      query.reload();
      await nav.refreshMe();
      nav.toast(result.message || '已提交申请');
    } catch (error) {
      nav.toast(error instanceof ApiError ? error.message : '申请失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.flex}>
      <ScreenHeader title="认证中心" />
      <ScrollView
        contentContainerStyle={[styles.hubPage, { paddingBottom: 40 + kb.lift }]}
        refreshControl={<RefreshControl refreshing={Boolean(query.fetching && data)} onRefresh={query.reload} tintColor={C.muted} />}
      >
        {query.loading && !data ? <StatusBlock loading error={query.error} onRetry={query.reload} /> : null}
        {query.error && !data ? <StatusBlock error={query.error} onRetry={query.reload} /> : null}
        {data ? (
          <>
            <HubHero
              kicker="CREATOR"
              title={data.heroTitle}
              lead={data.heroLead}
              icon="shield-checkmark-outline"
              mark={<Image source={titleArt('创作者')} style={{ width: 44, height: 44 }} />}
              colors={['#3A1412', '#8B1E18', '#E1251B']}
              awards={hard.length ? [
                { label: '硬性条件', value: `${passed}/${hard.length}` },
                { label: '状态', value: data.ready ? '可申请' : '未达标' },
              ] : undefined}
            />

            <View style={styles.hubCard}>
              <Text style={styles.hubCardTitle}>{data.benefitsTitle}</Text>
              <Text style={styles.hubCardLead}>{data.benefitsLead}</Text>
              <View style={styles.idBenefitGrid}>
                {data.benefits.map((item) => (
                  <View key={item.title} style={styles.idBenefit}>
                    <View style={styles.idBenefitIcon}>
                      <Icon name={benefitIcon(item.title)} size={18} color={C.redBright} />
                    </View>
                    <Text style={styles.idBenefitTitle}>{item.title}</Text>
                    <Text style={styles.idBenefitDesc}>{item.desc}</Text>
                  </View>
                ))}
              </View>
              {data.benefitsNote ? <Text style={styles.idNote}>{data.benefitsNote}</Text> : null}
            </View>

            <View style={styles.hubCard}>
              <Text style={styles.hubCardTitle}>{data.creatorTitle}</Text>
              <CriteriaList items={data.creator} />
            </View>

            <View style={styles.hubCard}>
              <Text style={styles.hubCardTitle}>{data.accountTitle}</Text>
              <CriteriaList items={data.account} />
              {data.emailSummary ? <Text selectable style={styles.idEmail}>{data.emailSummary}</Text> : null}
              {data.emailHelp ? <Text style={styles.idHelp}>{data.emailHelp}</Text> : null}
              {data.githubHelp ? <Text style={styles.idHelp}>{data.githubHelp}</Text> : null}
            </View>

            {data.failNote ? (
              <View style={styles.idFail}><Text style={styles.idFailText}>{data.failNote}</Text></View>
            ) : null}

            <View style={styles.hubCard}>
              <Pressable onPress={() => setRulesOpen((open) => !open)} style={styles.idRuleToggle}>
                <Text style={styles.hubCardTitle}>申请说明</Text>
                <Icon name={rulesOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.dim} />
              </Pressable>
              {rulesOpen ? data.rules.map((item) => <Text key={item} style={styles.idRuleItem}>{item}</Text>) : null}
              <Pressable onPress={() => setAgreed((value) => !value)} style={styles.idAgree}>
                <View style={[styles.idCheck, agreed && styles.idCheckOn]}>
                  {agreed ? <Icon name="checkmark" size={13} color="#fff" /> : null}
                </View>
                <Text style={styles.idAgreeText}>{data.agreeLabel}</Text>
              </Pressable>
              {!nav.loggedIn ? (
                <PrimaryButton block label="登录后申请" onPress={() => nav.open({ name: 'login' })} />
              ) : (
                <PrimaryButton
                  block
                  disabled={!canApply}
                  label={busy ? '提交中' : (data.ready ? data.applyLabel : '条件未满足')}
                  onPress={() => { void apply(); }}
                />
              )}
            </View>

            <View style={styles.hubCard}>
              <Text style={styles.hubCardTitle}>{data.applicationsTitle}</Text>
              {data.applications.length ? data.applications.map((item) => (
                <Text key={item} style={styles.idAppItem}>{item}</Text>
              )) : (
                <Text style={styles.hubEmptyHint}>暂无申请记录</Text>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
