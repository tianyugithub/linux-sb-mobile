import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api } from '../services/api';
import { ApiError } from '../services/client';
import { useAsync } from '../hooks/useAsync';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { PrimaryButton, ScreenHeader, StatusBlock } from '../components/ui';

export const REPORT_REASONS = [
  { id: 'advertising', label: '广告推广或引流' },
  { id: 'abuse', label: '辱骂、人身攻击或骚扰' },
  { id: 'illegal', label: '违法违规或危险内容' },
  { id: 'adult', label: '色情、低俗或令人不适' },
  { id: 'misinformation', label: '谣言、虚假或误导信息' },
  { id: 'privacy', label: '泄露隐私或个人信息' },
  { id: 'spam', label: '垃圾内容、刷屏或重复发布' },
  { id: 'copyright', label: '侵权、抄袭或冒用身份' },
  { id: 'other', label: '其他问题' },
] as const;

export function ReportScreen({
  targetType,
  targetId,
  targetUser,
  topicTitle,
}: {
  targetType: 'reply' | 'topic';
  targetId: string;
  targetUser?: string;
  topicTitle?: string;
}) {
  const nav = useNav();
  const query = useAsync(() => api.reportForm(targetType, targetId), [targetType, targetId], `report:${targetType}:${targetId}`);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const form = query.data;
  const closed = Boolean(form?.closed);
  const reasons = form?.reasons?.length ? form.reasons : REPORT_REASONS;
  const other = reason === 'other';
  const canSubmit = Boolean(reason) && (!other || details.trim().length >= 5) && !busy;
  const title = form?.title || (targetType === 'reply' ? '举报回帖' : '举报主题');
  return (
    <View style={styles.flex}>
      <ScreenHeader title={title} />
      <ScrollView contentContainerStyle={styles.reportContent}>
        {query.loading && !form ? <Text style={styles.quoteText}>正在打开举报页…</Text> : null}
        {query.error && !form ? <StatusBlock error={query.error} onRetry={query.reload} /> : null}
        {closed ? (
          <Text style={styles.reportClosed}>{form?.message || '该举报无法受理。'}</Text>
        ) : null}
        {form && !closed ? (
          <>
            <Text style={styles.reportMeta}>被举报用户：{form.targetUser || targetUser || '—'}</Text>
            <Text style={styles.reportMeta}>所属主题：{form.topicTitle || topicTitle || '—'}</Text>
            <View style={styles.reportWarning}>
              <Text style={styles.reportWarningText}>{form.warning || `举报押金 ${form.deposit || 500} 积分，举报成立原额退回，不成立则不予退回。请根据实际情况选择原因并提供必要说明。重复提交相同举报不会加快处理；经核实属于恶意举报的，可能影响后续举报权限。`}</Text>
            </View>
            <Text style={styles.fieldLabel}>快捷选择举报理由</Text>
            <View style={styles.reportReasons}>
              {reasons.map((item) => (
                <Pressable key={item.id} onPress={() => setReason(item.id)} style={[styles.reportChip, reason === item.id && styles.reportChipOn]}>
                  <Text style={[styles.reportChipText, reason === item.id && styles.reportChipTextOn]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>补充说明（选填）</Text>
            <Text style={styles.reportHint}>{form.detailsHint || '选择“其他问题”时至少填写5个字符；其他类型建议说明具体违规位置和情况，以便准确核查。'}</Text>
            <TextInput
              value={details}
              onChangeText={setDetails}
              placeholder="补充说明"
              placeholderTextColor={C.dim}
              style={styles.reportInput}
              multiline
              textAlignVertical="top"
            />
            <PrimaryButton
              block
              disabled={!canSubmit}
              label={busy ? '提交中…' : '提交举报'}
              onPress={async () => {
                if (!nav.loggedIn) {
                  nav.open({ name: 'login' });
                  return;
                }
                setBusy(true);
                try {
                  const result = await api.submitReport({
                    targetType,
                    targetId,
                    reasonType: reason,
                    details: details.trim(),
                  });
                  await nav.refreshMe();
                  nav.toast(result.message || '举报已提交');
                  nav.close();
                } catch (err) {
                  nav.toast(err instanceof ApiError ? err.message : '举报失败');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
