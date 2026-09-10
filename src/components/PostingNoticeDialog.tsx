import React from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import {
  POSTING_NOTICE_SKIP_HINT,
  POSTING_NOTICE_SKIP_TITLE,
  type PostingNoticeRule,
} from '../data/posting-notice';
import { useAppInsets } from '../navigation/nav';
import { styles } from '../theme/app-styles';
import { C } from '../theme/palette';

export type PostingNoticeContent = {
  title: string;
  intro: string;
  hint: string;
  confirm: string;
  consequenceLabel: string;
  consequence: string;
  rules: PostingNoticeRule[];
};

export function PostingNoticeDialog({
  visible,
  content,
  skip,
  onToggleSkip,
  onConfirm,
  onLeave,
}: {
  visible: boolean;
  /** 文案来自官网 plugins.js（读不到时是内置副本），见 useOfficialAssets。 */
  content: PostingNoticeContent;
  /** 「不再提示」开关（勾选状态由调用方持有，确认时才落盘）。 */
  skip: boolean;
  onToggleSkip: (value: boolean) => void;
  onConfirm: () => void;
  onLeave: () => void;
}) {
  const insets = useAppInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onLeave}
    >
      <View style={styles.postingNoticeRoot}>
        <View style={[styles.postingNoticeHeader, { paddingTop: 16 + insets.top }]}>
          <View style={styles.postingNoticeTitleRow}>
            <View style={styles.postingNoticeIcon} accessibilityElementsHidden>
              <Text style={styles.postingNoticeIconText}>!</Text>
            </View>
            <Text style={styles.postingNoticeTitle}>{content.title}</Text>
          </View>
          <Text style={styles.postingNoticeIntro}>{content.intro}</Text>
        </View>
        <ScrollView
          style={styles.postingNoticeBody}
          contentContainerStyle={styles.postingNoticeBodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {content.rules.map((rule, index) => (
            <View key={rule.title} style={styles.postingNoticeRule}>
              <View style={styles.postingNoticeIndex}>
                <Text style={styles.postingNoticeIndexText}>{index + 1}</Text>
              </View>
              <View style={styles.postingNoticeRuleCopy}>
                <Text style={styles.postingNoticeRuleTitle}>{rule.title}</Text>
                <Text style={styles.postingNoticeRuleText}>{rule.text}</Text>
              </View>
            </View>
          ))}
          <View style={styles.postingNoticeConsequence}>
            <Text style={styles.postingNoticeConsequenceText}>
              <Text style={styles.postingNoticeConsequenceLabel}>{content.consequenceLabel}</Text>
              {content.consequence}
            </Text>
          </View>
        </ScrollView>
        <View style={[styles.postingNoticeFooter, { paddingBottom: 10 + insets.bottom }]}>
          <View style={styles.postingNoticeSkipRow}>
            <View style={styles.postingNoticeSkipCopy}>
              <Text style={styles.postingNoticeSkipTitle}>{POSTING_NOTICE_SKIP_TITLE}</Text>
              <Text style={styles.postingNoticeSkipHint}>{POSTING_NOTICE_SKIP_HINT}</Text>
            </View>
            <Switch
              value={skip}
              onValueChange={onToggleSkip}
              trackColor={{ false: C.line, true: C.red }}
              thumbColor="#fff"
            />
          </View>
          <Text style={styles.postingNoticeHint}>{content.hint}</Text>
          <Pressable onPress={onConfirm} style={styles.postingNoticeConfirm}>
            <Text style={styles.postingNoticeConfirmText}>{content.confirm}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
