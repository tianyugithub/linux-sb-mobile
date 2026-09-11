import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { Topic } from '../../data';
import { api, mapTopic } from '../services/api';
import { pickPostImages, uploadPostImageFile } from '../services/post-image';
import { ApiError } from '../services/client';
import { useAsync } from '../hooks/useAsync';
import { useKeyboardLift } from '../hooks/useKeyboardLift';
import { usePrefs } from '../hooks/usePrefs';
import { useOfficialAssets } from '../hooks/useOfficialAssets';
import { postingNoticeContent } from '../services/official-assets';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { openAppHref, useNav } from '../navigation/nav';
import { ConfirmDialog, PrimaryButton, ScreenHeader, StatusBlock, type DialogState } from '../components/ui';
import { OutlineButton } from '../components/account/AccountUi';
import { NbEditorDock, useNbEditor } from '../components/NbEditor';
import { PostingNoticeDialog } from '../components/PostingNoticeDialog';
import {
  LotteryFields,
  RedPacketFields,
  TopicTypePicker,
  VirtualCardFields,
  WalletNoticeDialog,
} from '../components/ComposeSpecial';
import { POSTING_NOTICE_INLINE } from '../data/posting-notice';
import type {
  TopicLotteryComposeDto,
  TopicSpecialType,
  TopicVirtualCardComposeDto,
  TopicRedPacketComposeDto,
} from '../types/api';
import { clearDraft, preloadDraft, saveDraft } from '../utils/draft';

function cloneLottery(src: TopicLotteryComposeDto): TopicLotteryComposeDto {
  return {
    ...src,
    prizes: src.prizes.map((item) => ({ ...item })),
    prizeTypes: src.prizeTypes.map((item) => ({ ...item })),
  };
}

function cloneCard(src: TopicVirtualCardComposeDto): TopicVirtualCardComposeDto {
  return {
    ...src,
    currencies: src.currencies.map((item) => ({ ...item })),
  };
}

export function ComposeScreen({ onBack, edit, onSaved }: { onBack: () => void; edit?: Topic; onSaved?: (topic: Topic) => void }) {
  const nav = useNav();
  const kb = useKeyboardLift();
  const prefs = usePrefs();
  // 发帖须知文案以官网 plugins.js 为准（读不到用内置副本）
  useOfficialAssets();
  const noticeContent = postingNoticeContent();
  const composerQuery = useAsync(
    () => (nav.loggedIn ? api.topicComposer(edit?.id) : Promise.resolve(null)),
    [edit?.id, nav.loggedIn],
  );
  const [selectedForum, setSelectedForum] = useState(edit?.forum ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [specialType, setSpecialType] = useState<TopicSpecialType>('');
  const [redPacket, setRedPacket] = useState<TopicRedPacketComposeDto | null>(null);
  const [lottery, setLottery] = useState<TopicLotteryComposeDto | null>(null);
  const [card, setCard] = useState<TopicVirtualCardComposeDto | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [noticeConfirmed, setNoticeConfirmed] = useState(false);
  const [skipNotice, setSkipNotice] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const forums = composerQuery.data?.forums?.length
    ? composerQuery.data.forums.map((item) => item.name)
    : (selectedForum ? [selectedForum] : []);
  const editing = Boolean(edit);
  /**
   * 发帖须知是否已满足：确认过、或在设置/弹窗里选了「不再提示」。
   *
   * 「不再提示」必须和「已确认」等价 —— 它同时决定了弹窗显不显示。曾经只让弹窗看这个开关、
   * 却让发布按钮等 `noticeConfirmed`，于是勾过「不再提示」（设置里也能开）之后：弹窗永远不出现，
   * `noticeConfirmed` 永远没人置真，**发布按钮永久灰着而且没有任何入口能解开**。
   */
  const noticeSatisfied = editing || noticeConfirmed || prefs.postingNoticeSkip;

  // 草稿：进页面时预取（异步），只填用户还没动过的字段；之后每次改动自动保存。
  useEffect(() => {
    if (edit) return;
    let alive = true;
    void preloadDraft().then((saved) => {
      if (!alive || !saved) return;
      setSelectedForum((current) => current || saved.forum);
      setTitle((current) => current || saved.title);
      setBody((current) => current || saved.body);
    });
    return () => { alive = false; };
  }, [edit]);

  useEffect(() => {
    if (edit) return;
    if (!selectedForum && !title && !body) return;
    saveDraft({ forum: selectedForum, title, body });
  }, [edit, selectedForum, title, body]);

  useEffect(() => {
    const data = composerQuery.data;
    if (!data) return;
    if (edit) {
      setTitle(data.title);
      setBody(data.body);
      if (data.forum) setSelectedForum(data.forum);
      setSpecialType(data.specialType);
      setLottery(data.lottery ? cloneLottery(data.lottery) : null);
      setCard(data.virtualCard ? cloneCard(data.virtualCard) : null);
      setRedPacket(data.redPacket ? { ...data.redPacket } : null);
    } else {
      if (!selectedForum && data.forum) setSelectedForum(data.forum);
      const lotteryForm = data.lottery;
      const cardForm = data.virtualCard;
      const redForm = data.redPacket;
      if (lotteryForm) setLottery((current) => current ?? cloneLottery(lotteryForm));
      if (cardForm) setCard((current) => current ?? cloneCard(cardForm));
      if (redForm) setRedPacket((current) => current ?? { ...redForm });
    }
  }, [composerQuery.data, edit]);

  const selectType = (next: TopicSpecialType) => {
    if (next === specialType) return;
    if (next === 'lottery' && lottery && lottery.walletMin > 0 && lottery.walletBalance < lottery.walletMin) {
      setWalletOpen(true);
      return;
    }
    setSpecialType(next);
  };

  const composePayload = (bodyOverride?: string) => ({
    title: title.trim(),
    body: (bodyOverride ?? body).trim(),
    forum: selectedForum,
    specialType,
    lottery: specialType === 'lottery' && lottery ? {
      originalType: lottery.originalType,
      drawAt: lottery.drawAt,
      participantTarget: lottery.participantTarget,
      minReplyChars: lottery.minReplyChars,
      replyCaptcha: lottery.replyCaptcha,
      prizes: lottery.prizes,
    } : undefined,
    redPacket: specialType === 'red_packet' && redPacket ? {
      distribution: redPacket.distribution,
      claimRule: redPacket.claimRule,
      minReplyChars: redPacket.minReplyChars,
      count: redPacket.count,
      fixedAmount: redPacket.fixedAmount,
      totalAmount: redPacket.totalAmount,
    } : undefined,
    virtualCard: specialType === 'virtual_card' && card ? {
      originalType: card.originalType,
      name: card.name,
      currency: card.currency,
      price: card.price,
      purchaseLimit: card.purchaseLimit,
      autoReply: card.autoReply,
      autoReplyContent: card.autoReplyContent,
      values: card.values,
    } : undefined,
  });

  const editor = useNbEditor({
    value: body,
    onChange: setBody,
    placeholder: '分享你的想法、经验或资源…',
    onLink: (href) => openAppHref(nav, href),
    docked: true,
    onPickImageFile: () => pickPostImages({ me: nav.me, toast: nav.toast }),
    onUploadImageFile: (file, onProgress, target) => uploadPostImageFile(file, { toast: nav.toast, onProgress, silent: true, target }),
  });

  if (!nav.loggedIn) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title={editing ? '编辑主题' : '发布主题'} onBack={onBack} />
        <View style={styles.emptyPage}>
          <Text style={styles.emptyTitle}>登录后才能发帖</Text>
          <PrimaryButton label="去登录" onPress={() => nav.open({ name: 'login' })} />
        </View>
      </View>
    );
  }
  if (composerQuery.error && !composerQuery.data) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title={editing ? '编辑主题' : '发布主题'} onBack={onBack} />
        <StatusBlock error={composerQuery.error} onRetry={composerQuery.reload} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.flex, Platform.OS === 'android' ? { paddingBottom: kb.lift } : null]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader
        title={editing ? '编辑主题' : '发布主题'}
        onBack={onBack}
        right={<PrimaryButton compact disabled={busy || composerQuery.loading || !noticeSatisfied} label={busy ? (editing ? '保存中' : '发布中') : composerQuery.loading ? '加载中' : (editing ? '保存' : '发布')} onPress={async () => {
        if (!noticeSatisfied) return;
        setBusy(true);
        setError('');
        try {
          // 所见即所得模式下先把活文档拉平回 markdown，避免丢掉最后一次编辑。
          const bodyText = await editor.flush();
          if (edit) {
            const saved = await api.updateTopic(edit.id, composePayload(bodyText));
            onSaved?.(mapTopic(saved));
            nav.toast('主题已保存');
            return;
          }
          const created = await api.createTopic(composePayload(bodyText));
          clearDraft();
          onBack();
          nav.open({ name: 'topic', topic: mapTopic(created) });
          nav.toast('主题已发布');
          nav.patchMe({ topicCount: nav.me.topicCount + 1 });
          void nav.refreshMe();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : (editing ? '保存失败' : '发布失败，草稿已保留'));
        } finally {
          setBusy(false);
        }
      }} />}
      />
      <ScrollView contentContainerStyle={styles.composeContent} keyboardShouldPersistTaps="always">
        <Text style={[styles.composeSectionTitle, styles.composeLeadTitle]}>版块</Text>
        <View style={styles.composeChipWrap}>
          {forums.map((item) => (
            <Pressable key={item} onPress={() => setSelectedForum(item)} style={[styles.chip, selectedForum === item && styles.chipActive]}>
              <Text numberOfLines={1} style={[styles.chipText, selectedForum === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <TopicTypePicker
          specialType={specialType}
          hasLottery={Boolean(lottery)}
          hasCard={Boolean(card)}
          hasRedPacket={Boolean(redPacket)}
          onSelect={selectType}
        />
        {specialType === 'lottery' && lottery ? (
          <LotteryFields lottery={lottery} onChange={setLottery} onLink={(href) => openAppHref(nav, href, selectedForum || '综合')} />
        ) : null}
        {specialType === 'virtual_card' && card ? (
          <VirtualCardFields card={card} onChange={setCard} onLink={(href) => openAppHref(nav, href, selectedForum || '综合')} />
        ) : null}
        {specialType === 'red_packet' && redPacket ? (
          <RedPacketFields redPacket={redPacket} onChange={setRedPacket} onLink={(href) => openAppHref(nav, href, selectedForum || '综合')} />
        ) : null}
        <Text style={styles.composeSectionTitle}>标题</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="请输入主题标题" placeholderTextColor={C.dim} style={styles.composeTitleInput} />
        <View style={styles.composeLabelRow}>
          <Text style={styles.composeLabelTitle}>正文</Text>
          {body.trim() ? (
            <OutlineButton
              compact
              label="清空"
              onPress={() => setDialog({
                title: '清空正文',
                text: '正文内容将被清空，且无法恢复。确定要清空吗？',
                confirmLabel: '清空',
                danger: true,
                onConfirm: () => editor.clear(),
              })}
            />
          ) : null}
        </View>
        <View style={styles.nbField}>
          {editor.field}
          {editor.preview}
        </View>
        {error ? <Text style={styles.authError}>{error}</Text> : null}
        {editing ? (
          <View style={styles.rules}><Text style={styles.rulesTitle}>发帖前请确认</Text><Text style={styles.rulesText}>遵守社区规则，不发布违法违规内容；涉及密钥、账号、兑换码时请先脱敏。</Text></View>
        ) : (
          <View style={styles.postingNoticeInline}><Text style={styles.postingNoticeInlineText}>{POSTING_NOTICE_INLINE}</Text></View>
        )}
      </ScrollView>
      <NbEditorDock lifted={kb.lift >= 80}>
        {editor.emoji}
        {editor.toolbar}
      </NbEditorDock>
      {editor.uploadManager}
      <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
      {!editing ? (
        <PostingNoticeDialog
          visible={!noticeSatisfied}
          content={noticeContent}
          skip={skipNotice}
          onToggleSkip={setSkipNotice}
          onConfirm={() => {
            setNoticeConfirmed(true);
            // 「不再提示」只在确认后生效：只是勾了开关又返回的话，下次仍然弹出
            if (skipNotice) void prefs.setPostingNoticeSkip(true);
          }}
          onLeave={onBack}
        />
      ) : null}
      <WalletNoticeDialog
        visible={walletOpen && Boolean(lottery)}
        walletName={lottery?.walletName || '烧饼'}
        walletMin={lottery?.walletMin || 5}
        walletUrl={lottery?.walletUrl || '/community_wallet'}
        helpUrl={lottery?.walletHelpUrl || ''}
        onClose={() => setWalletOpen(false)}
        onRecharge={(url) => openAppHref(nav, url, selectedForum || '综合')}
        onHelp={(url) => openAppHref(nav, url, selectedForum || '综合')}
      />
    </KeyboardAvoidingView>
  );
}
