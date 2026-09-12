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
import { pickAndUploadAttachments } from '../services/attachments';

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
  const [replyOrder, setReplyOrder] = useState('');
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachNames, setAttachNames] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [noticeConfirmed, setNoticeConfirmed] = useState(false);
  const [skipNotice, setSkipNotice] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const forums = composerQuery.data?.forums?.length
    ? composerQuery.data.forums.map((item) => item.name)
    : (selectedForum ? [selectedForum] : []);
  const editing = Boolean(edit);
  /**
   * 已发布的特殊帖（红包 / 抽奖 / 发卡）：官网编辑页把设置段改成只读，类型字段变成 hidden。
   * 此时类型不能改、设置字段一个都不提交，只把页面那两段原文（当前设置 + 官方说明）显示出来。
   */
  const specialLock = composerQuery.data?.specialLock ?? null;
  /** 编辑页的「回帖排序」：选项与当前值都取自页面（发帖页没有这一段）。 */
  const replyOrderField = composerQuery.data?.replyOrder ?? null;
  /** 「编辑主帖」计费说明 + 保存前确认原文（官网每次保存都弹）。 */
  const editCost = composerQuery.data?.editCost ?? null;
  /** 附件上传（发帖页、编辑页都有；页面上没有这一段说明没有上传权限）。 */
  const attachment = composerQuery.data?.attachment ?? null;
  /** 删除主帖的影响说明与官方确认原文。 */
  const deleteLock = composerQuery.data?.deleteLock ?? null;
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
      setReplyOrder(data.replyOrder?.value ?? '');
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
    // 回帖排序只在编辑页存在（页面给了才提交，缺省沿用官网默认）
    ...(editing && replyOrderField && replyOrder ? { replyOrder } : {}),
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
    replyVisible: true,
    onPickImageFile: () => pickPostImages({ me: nav.me, toast: nav.toast }),
    onUploadImageFile: (file, onProgress, target) => uploadPostImageFile(file, { toast: nav.toast, onProgress, silent: true, target }),
  });

  const save = async () => {
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
  };

  /**
   * 保存入口：编辑页官网每次保存前都弹一次计费确认（`data-sb-limit-edit-time-edit-confirm`
   * + 「是否确认保存？」），文案照抄，确认后才真的提交。
   */
  const requestSave = () => {
    if (!noticeSatisfied || busy) return;
    const confirmText = editing && editCost?.confirm ? `${editCost.confirm}是否确认保存？` : '';
    if (!confirmText) {
      void save();
      return;
    }
    setDialog({
      title: editCost?.title || '保存',
      text: confirmText,
      confirmLabel: '保存',
      onConfirm: () => {
        setDialog(null);
        void save();
      },
    });
  };

  /** 附件：选完即传，成功后把官网返回的 markdown 一次插进正文（对应官网的「批量插入」）。 */
  const addAttachments = async () => {
    if (!attachment) return;
    setAttachBusy(true);
    try {
      const uploaded = await pickAndUploadAttachments(attachment, { onError: (message) => nav.toast(message) });
      if (!uploaded.length) return;
      await editor.insert(uploaded.map((item) => item.markdown).join('\n'));
      setAttachNames((prev) => [...prev, ...uploaded.map((item) => item.name)]);
      nav.toast(`已插入 ${uploaded.length} 个附件`);
    } finally {
      setAttachBusy(false);
    }
  };

  const removeTopic = () => {
    if (!edit) return;
    setDialog({
      title: '删除主帖',
      text: `${deleteLock?.note ?? ''}${deleteLock?.confirm || '删除后无法恢复。'}`,
      confirmLabel: '删除',
      danger: true,
      onConfirm: async () => {
        setDialog(null);
        setDeleting(true);
        try {
          await api.deleteTopic(edit.id);
          nav.toast('主题已删除');
          // 编辑页是压在主题页上的：一起弹掉，免得退回一个已经不存在的主题
          onBack();
          nav.close();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : '删除失败');
        } finally {
          setDeleting(false);
        }
      },
    });
  };

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
        right={<PrimaryButton compact disabled={busy || composerQuery.loading || !noticeSatisfied} label={busy ? (editing ? '保存中' : '发布中') : composerQuery.loading ? '加载中' : (editing ? '保存' : '发布')} onPress={requestSave} />}
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
        {specialLock ? (
          <>
            <Text style={styles.composeSectionTitle}>{specialLock.title || '主题类型'}</Text>
            <View style={styles.composePanel}>
              <Text style={styles.composeFieldHint}>{specialLock.note}</Text>
            </View>
          </>
        ) : (
          <TopicTypePicker
            specialType={specialType}
            hasLottery={Boolean(lottery)}
            hasCard={Boolean(card)}
            hasRedPacket={Boolean(redPacket)}
            onSelect={selectType}
          />
        )}
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
        {attachment ? (
          <>
            <Text style={styles.composeSectionTitle}>附件</Text>
            <View style={styles.composePanel}>
              <Text style={styles.composeFieldHint}>
                {`可上传 ${attachment.accept}；单个不超过 ${attachment.maxMb}MB，上传后自动插入正文。`}
              </Text>
              <OutlineButton
                compact
                label={attachBusy ? '上传中' : (attachment.label || '上传附件')}
                onPress={() => {
                  if (attachBusy) return;
                  void addAttachments();
                }}
              />
              {attachNames.length ? (
                <Text style={styles.composeFieldHint}>{`已插入：${attachNames.join('、')}`}</Text>
              ) : null}
            </View>
          </>
        ) : null}
        {replyOrderField ? (
          <>
            <Text style={styles.composeSectionTitle}>{replyOrderField.label || '回帖排序'}</Text>
            <View style={styles.composeChipWrap}>
              {replyOrderField.options.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setReplyOrder(option.value)}
                  style={[styles.chip, replyOrder === option.value && styles.chipActive]}
                >
                  <Text numberOfLines={1} style={[styles.chipText, replyOrder === option.value && styles.chipTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        {editCost ? (
          <>
            <Text style={styles.composeSectionTitle}>{editCost.title || '编辑主帖'}</Text>
            <View style={styles.composePanel}>
              <Text style={styles.composeFieldHint}>{editCost.note}</Text>
              {editCost.rulesUrl ? (
                <OutlineButton
                  compact
                  label="查看详细积分规则"
                  onPress={() => openAppHref(nav, editCost.rulesUrl, selectedForum || '综合')}
                />
              ) : null}
            </View>
          </>
        ) : null}
        {editing && deleteLock ? (
          <>
            <Text style={styles.composeSectionTitle}>删除主帖</Text>
            <View style={styles.composePanel}>
              <Text style={styles.composeFieldHint}>{deleteLock.note || deleteLock.confirm}</Text>
              <OutlineButton
                compact
                label={deleting ? '删除中' : '删除主帖'}
                onPress={() => {
                  if (deleting) return;
                  removeTopic();
                }}
              />
            </View>
          </>
        ) : null}
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
