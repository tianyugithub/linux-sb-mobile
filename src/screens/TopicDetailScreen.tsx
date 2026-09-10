import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Topic } from '../../data';
import type {
  BarrageItemDto,
  CommentDto,
  DonateInfoDto,
  EssenceVoteDto,
  TopicCollectionPickDto,
  TopicLotteryDto,
  TopicVirtualCardDto,
} from '../types/api';
import { api, mapTopic, mapUser } from '../services/api';
import { pickPostImages, uploadPostImageFile } from '../services/post-image';
import { ApiError, mediaUrl } from '../services/client';
import { firstGlyph } from '../utils/entities';
import { scaleTextStyle } from '../services/prefs';
import { useAppActive } from '../hooks/useAppActive';
import { useAsync } from '../hooks/useAsync';
import { useKeyboardLift } from '../hooks/useKeyboardLift';
import { usePrefs } from '../hooks/usePrefs';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { openAppHref, useAndroidBack, useAppInsets, useNav } from '../navigation/nav';
import { ArticleBody, openImageGallery } from '../components/Article';
import { ContentSkeleton } from '../components/ContentSkeleton';
import { ImageGallery } from '../components/ImageGallery';
import { TitleBadges } from '../components/TitleBadge';
import { TopicGone, topicErrorKind } from '../components/TopicGone';
import { ESSENCE_REASON_MAX } from '../data/essence';
import { cacheGet, cacheSet } from '../services/query-cache';
import { useNbEditor } from '../components/NbEditor';
import { CaptchaWidget } from '../components/CaptchaWidget';
import {
  ActionSheet,
  CompactTag,
  ConfirmDialog,
  EditNoteLine,
  Icon,
  IconButton,
  PrimaryButton,
  ScreenHeader,
  SvgAvatar,
  StatusBlock,
  UserAvatar,
  commentOwnedBy,
  commentPreview,
  pickUserId,
  stampLabel,
  stampTone,
  topicTagList,
  type DialogState,
  type SheetItem,
} from '../components/ui';
import { collectArticleImages, uniqueImages } from '../utils/article';
import { classifyAppHref } from '../utils/links';
import { copyText, shareText } from '../utils/share';
import { formatRelative } from '../utils/time';
import { markTopicSeen } from '../utils/topic-seen';

export const TOPIC_SHARE = (id: string) => `https://linux.sb/topic/${id}`;

function shortAgo(iso: string) {
  return formatRelative(iso).replace(/前$/, '');
}

function compactCount(n: number) {
  if (n <= 0) return '';
  if (n >= 10000) {
    const wan = n / 10000;
    return `${wan >= 10 ? wan.toFixed(0) : wan.toFixed(1).replace(/\.0$/, '')}万`;
  }
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

function BarrageAvatar({ src, name }: { src?: string; name: string }) {
  const uri = src ? mediaUrl(src) : undefined;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  // 站内默认头像是 SVG，RN 的 Image 解码不了，要用 react-native-svg 渲染。
  if (uri && !failed && /\.svg(\?|$)/i.test(uri)) {
    return (
      <View style={styles.barrageAvatarSvg}>
        <SvgAvatar uri={uri} size={24} onError={() => setFailed(true)} />
      </View>
    );
  }
  if (!uri || failed) {
    return (
      <View style={styles.barrageAvatarFallback}>
        <Text style={styles.barrageAvatarLetter}>{firstGlyph(name)}</Text>
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.barrageAvatar} onError={() => setFailed(true)} />;
}

type BarrageShot = {
  id: number;
  item: BarrageItemDto;
  top: number;
  x: Animated.Value;
  opacity: Animated.Value;
};

// 对齐官方：匀速 105px/s，2 条轨道（top 11 / 55，官方移动端行高），条目间距 74px，
// 从容器右缘外飞入，行程 = 容器宽 + 气泡宽 + 60，末尾 8% 淡出。
const BARRAGE_SPEED = 105;

export function FlyingBarrage({ items, enabled }: { items: BarrageItemDto[]; enabled: boolean }) {
  const [stageWidth, setStageWidth] = useState(() => Dimensions.get('window').width);
  const stageWidthRef = useRef(stageWidth);
  stageWidthRef.current = stageWidth;
  const seq = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [shots, setShots] = useState<BarrageShot[]>([]);
  const runningRef = useRef(new Set<Animated.CompositeAnimation>());
  const startedRef = useRef(new Set<number>());
  const appActive = useAppActive();

  const startShot = useCallback((shot: BarrageShot, bubbleWidth: number) => {
    if (startedRef.current.has(shot.id)) return;
    startedRef.current.add(shot.id);
    const width = stageWidthRef.current || Dimensions.get('window').width;
    const distance = width + Math.max(bubbleWidth, 80) + 60;
    const duration = Math.max(1200, Math.round((distance / BARRAGE_SPEED) * 1000));
    const fadeAt = Math.round(duration * 0.92);
    const animation = Animated.parallel([
      Animated.timing(shot.x, {
        toValue: -distance,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(shot.opacity, {
        toValue: 0,
        delay: fadeAt,
        duration: duration - fadeAt,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]);
    runningRef.current.add(animation);
    animation.start(({ finished }) => {
      runningRef.current.delete(animation);
      startedRef.current.delete(shot.id);
      if (finished) setShots((current) => current.filter((entry) => entry.id !== shot.id));
    });
  }, []);

  useEffect(() => {
    if (!enabled || !appActive || !itemsRef.current.length) {
      setShots([]);
      return;
    }
    const fallbacks = new Set<ReturnType<typeof setTimeout>>();
    const spawn = () => {
      const list = itemsRef.current;
      if (!list.length) return;
      const id = seq.current;
      seq.current += 1;
      const item = list[id % list.length];
      const width = stageWidthRef.current || Dimensions.get('window').width;
      const shot: BarrageShot = {
        id,
        item,
        top: 11 + (id % 2) * 44,
        x: new Animated.Value(width),
        opacity: new Animated.Value(1),
      };
      setShots((current) => [...current, shot]);
      // 正常情况 onLayout 会先给出行程；万一测量失败，用估算宽度兜底起跑。
      const fallback = setTimeout(() => {
        fallbacks.delete(fallback);
        startShot(shot, 150);
      }, 260);
      fallbacks.add(fallback);
    };
    spawn();
    const timer = setInterval(spawn, 1300);
    return () => {
      clearInterval(timer);
      fallbacks.forEach((handle) => clearTimeout(handle));
      fallbacks.clear();
      runningRef.current.forEach((animation) => animation.stop());
      runningRef.current.clear();
      startedRef.current.clear();
    };
  }, [enabled, appActive, items.length, startShot]);

  if (!enabled || !items.length) return null;
  return (
    <View
      pointerEvents="none"
      style={styles.barrageStage}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next > 0) setStageWidth(next);
      }}
    >
      {shots.map((shot) => (
        <Animated.View
          key={shot.id}
          style={[styles.barrageShot, { top: shot.top, opacity: shot.opacity, transform: [{ translateX: shot.x }] }]}
        >
          <LinearGradient
            colors={['#DF7A22', '#F09A36', '#FFF1DC']}
            locations={[0, 0.48, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.barrageBubble}
            onLayout={(event) => startShot(shot, event.nativeEvent.layout.width)}
          >
            <BarrageAvatar src={shot.item.avatar} name={shot.item.user} />
            <Text numberOfLines={1} style={styles.barrageUser}>{shot.item.user}</Text>
            <Text numberOfLines={1} style={styles.barrageAction}>{shot.item.amount != null ? '打赏' : shot.item.text.replace(/！$/, '')}</Text>
            {shot.item.amount != null ? (
              <Text style={styles.barrageAmount}>
                <Text style={styles.barrageAmountNum}>{shot.item.amount}</Text>
                积分！
              </Text>
            ) : null}
          </LinearGradient>
        </Animated.View>
      ))}
    </View>
  );
}

export function TopicShareModal({
  visible,
  title,
  forum,
  author,
  views,
  replies,
  url,
  onClose,
  onOpenWeb,
  onCopy,
  onShare,
  onReport,
}: {
  visible: boolean;
  title: string;
  forum: string;
  author: string;
  views: number;
  replies: number;
  url: string;
  onClose: () => void;
  onOpenWeb: () => void;
  onCopy: () => void;
  onShare: () => void;
  onReport: () => void;
}) {
  useAndroidBack(visible, onClose);
  if (!visible) return null;
  const hostPath = url.replace(/^https?:\/\//, '');
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.shareModalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.shareCard, { backgroundColor: C.surface, borderColor: C.line }]}>
          <View style={styles.shareBrand}>
            <View style={styles.shareBrandMark}>
              <Image source={require('../../assets/icon.png')} style={styles.shareBrandIcon} resizeMode="contain" />
            </View>
            <View style={styles.shareBrandCopy}>
              <Text style={styles.shareBrandName}>LINUX SB</Text>
              <Text style={styles.shareBrandTag}>烧饼社区 · 人人都有饼吃</Text>
            </View>
          </View>
          <Text style={styles.shareTopicTitle}>{title}</Text>
          <Text style={styles.shareTopicMeta}>{forum}  ·  {author}</Text>
          <View style={styles.shareStats}>
            <View style={styles.shareStat}>
              <Icon name="eye-outline" size={13} color={C.dim} />
              <Text style={styles.shareStatText}>{views} 浏览</Text>
            </View>
            <View style={styles.shareStat}>
              <Icon name="chatbubble-outline" size={13} color={C.dim} />
              <Text style={styles.shareStatText}>{replies} 回复</Text>
            </View>
          </View>
          <View style={styles.shareUrlBox}>
            <Text numberOfLines={1} style={styles.shareUrlText}>{hostPath}</Text>
          </View>
          <View style={styles.shareActions}>
            <Pressable onPress={onOpenWeb} style={styles.shareGhost}>
              <Icon name="desktop-outline" size={16} color={C.text} />
              <Text style={styles.shareGhostText}>网页访问</Text>
            </Pressable>
            <Pressable onPress={onCopy} style={styles.shareGhost}>
              <Icon name="copy-outline" size={16} color={C.text} />
              <Text style={styles.shareGhostText}>复制链接</Text>
            </Pressable>
          </View>
          <Pressable onPress={onShare} style={styles.sharePrimary}>
            <Icon name="share-social-outline" size={16} color="#fff" />
            <Text style={styles.sharePrimaryText}>分享到系统</Text>
          </Pressable>
          <Pressable onPress={onReport} hitSlop={8}>
            <Text style={styles.shareReport}>举报此主题</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function TopicAlbumSheet({
  visible,
  items,
  busy,
  name,
  onName,
  onClose,
  onPick,
  onCreate,
  onMine,
}: {
  visible: boolean;
  items: TopicCollectionPickDto[];
  busy: boolean;
  name: string;
  onName: (value: string) => void;
  onClose: () => void;
  onPick: (item: TopicCollectionPickDto) => void;
  onCreate: () => void;
  onMine: () => void;
}) {
  const insets = useAppInsets();
  useAndroidBack(visible, onClose);
  if (!visible) return null;
  return (
    <View style={styles.sheetRoot} pointerEvents="box-none">
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.sheetPanel, { maxHeight: '72%', paddingBottom: Math.max(insets.bottom, 8) }]}>
        <Text style={styles.albumSheetTitle}>收录到专辑</Text>
        <ScrollView style={styles.albumSheetList}>
          {items.length ? items.map((item) => (
            <Pressable key={item.id} disabled={busy} onPress={() => onPick(item)} style={styles.albumSheetRow}>
              <Text numberOfLines={1} style={styles.albumSheetName}>{item.title}</Text>
              <Text style={styles.albumSheetState}>{item.included ? '移出' : '收录'}</Text>
            </Pressable>
          )) : (
            <Text style={styles.albumSheetEmpty}>还没有专辑，先创建一个。</Text>
          )}
        </ScrollView>
        <View style={styles.albumSheetCreate}>
          <TextInput
            value={name}
            onChangeText={onName}
            placeholder="新专辑名称"
            placeholderTextColor={C.dim}
            style={styles.albumSheetInput}
          />
          <Pressable disabled={busy || !name.trim()} onPress={onCreate} style={styles.albumSheetCreateBtn}>
            <Text style={styles.albumSheetCreateText}>创建</Text>
          </Pressable>
        </View>
        <Pressable onPress={onMine} style={styles.sheetRow}>
          <Text style={styles.sheetRowText}>我的淘帖</Text>
        </Pressable>
        <Pressable onPress={onClose} style={styles.sheetCancel}><Text style={styles.sheetCancelText}>取消</Text></Pressable>
      </View>
    </View>
  );
}

export function DonateSheet({
  visible,
  title,
  info,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  info: DonateInfoDto | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (amount: string) => Promise<void>;
}) {
  const [custom, setCustom] = useState('');
  const presets = info?.presets?.length ? info.presets : [6, 10, 33, 66, 88];
  const amount = custom.trim();
  useEffect(() => {
    if (visible) setCustom('');
  }, [visible]);
  useAndroidBack(visible, onClose);
  if (!visible) return null;
  const blocked = Boolean(info?.blocked);
  const heading = blocked ? (info?.title || '暂不能打赏') : '点赞打赏';
  return (
    <View style={styles.modalRoot} pointerEvents="box-none">
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.donateCard}>
        <View style={styles.donateHead}>
          <Text style={styles.donateTitle}>{heading}</Text>
          <Pressable onPress={onClose} hitSlop={8}><Icon name="close" size={18} color={C.muted} /></Pressable>
        </View>
        {!info ? (
          <View style={styles.donateBlockedBody}>
            <ActivityIndicator color={C.muted} />
            <Text style={styles.donateBlockedMsg}>正在核对今日打赏条件…</Text>
          </View>
        ) : blocked ? (
          <View style={styles.donateBlockedBody}>
            <View style={styles.donateLockWrap}><Text style={styles.donateLock}>🔒</Text></View>
            <Text style={styles.donateBlockedTitle}>{info.title || '暂不能打赏'}</Text>
            <Text style={styles.donateBlockedMsg}>{info.message || '暂不能打赏'}</Text>
            {info.warning ? <Text style={styles.donateBlockedWarn}>{info.warning}</Text> : null}
            <Pressable onPress={onClose} style={styles.donateGotIt}>
              <Text style={styles.donateGotItText}>知道了</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.donateTopic}>点赞打赏《{title}》</Text>
            <Text style={styles.donateStats}>
              已打赏 {info.rewardPeople} 人次 · 已点赞 {info.likeCount} 次 · 共 {info.totalPoints} 积分 · 我的积分 {info.balance}
            </Text>
            <View style={styles.donatePresets}>
              {presets.map((value) => (
                <Pressable key={value} onPress={() => setCustom(String(value))} style={[styles.donatePreset, amount === String(value) && styles.donatePresetOn]}>
                  <Text style={[styles.donatePresetText, amount === String(value) && styles.donatePresetTextOn]}>{value}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.donateLabel}>自定义金额</Text>
            <TextInput
              value={custom}
              onChangeText={setCustom}
              keyboardType="number-pad"
              placeholder="不填写则只点赞"
              placeholderTextColor={C.dim}
              style={styles.donateInput}
            />
            <PrimaryButton
              block
              disabled={busy}
              label={busy ? '处理中…' : (amount ? `打赏 ${amount} 积分` : '直接点赞')}
              onPress={() => onSubmit(amount)}
            />
          </>
        )}
      </View>
    </View>
  );
}

export function ReplyReactSheet({
  visible,
  authorName,
  tiers,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  authorName: string;
  tiers: number[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (points: number) => Promise<void>;
}) {
  const [points, setPoints] = useState(0);
  useEffect(() => {
    if (visible) setPoints(0);
  }, [visible]);
  useAndroidBack(visible, onClose);
  if (!visible) return null;
  const amounts = tiers.length ? tiers : [1, 5, 10, 50];
  return (
    <View style={styles.modalRoot} pointerEvents="box-none">
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.donateCard}>
        <View style={styles.donateHead}>
          <Text style={styles.donateTitle}>点赞投币</Text>
          <Pressable onPress={onClose} hitSlop={8}><Icon name="close" size={18} color={C.muted} /></Pressable>
        </View>
        <Text style={styles.donateTopic}>
          {authorName ? `给用户 ${authorName} 点赞，可选择投币金额` : '点赞，可选择投币金额'}
        </Text>
        <View style={styles.donatePresets}>
          {amounts.map((value) => (
            <Pressable
              key={value}
              onPress={() => setPoints((prev) => (prev === value ? 0 : value))}
              style={[styles.donatePreset, points === value && styles.donatePresetOn]}
            >
              <Text style={[styles.donatePresetText, points === value && styles.donatePresetTextOn]}>{value} 积分</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.reactActions}>
          <Pressable onPress={onClose} style={styles.reactCancel}>
            <Text style={styles.reactCancelText}>取消</Text>
          </Pressable>
          <View style={styles.reactConfirmWrap}>
            <PrimaryButton
              block
              disabled={busy}
              label={busy ? '处理中…' : (points > 0 ? '确认投币' : '直接点赞')}
              onPress={() => onSubmit(points)}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

export function TopicLotteryCard({
  lottery,
  onUser,
}: {
  lottery: TopicLotteryDto;
  onUser: (id: string) => void;
}) {
  return (
    <View style={styles.widgetCard}>
      <View style={styles.widgetHead}>
        <View style={styles.widgetHeadText}>
          <Text style={styles.widgetKicker}>{lottery.title}</Text>
          <CompactTag tone={stampTone('lottery', lottery.status)}>{lottery.status}</CompactTag>
        </View>
        {lottery.participants > 0 ? <Text style={styles.widgetSide}>{lottery.participants} 人参与</Text> : null}
      </View>
      {lottery.subtitle ? <Text style={styles.widgetSub}>{lottery.subtitle}</Text> : null}
      {lottery.prizes.length ? (
        <View style={styles.widgetList}>
          {lottery.prizes.map((prize) => (
            <View key={`${prize.name}-${prize.desc}`} style={styles.widgetRow}>
              <Text style={styles.widgetRowName}>{prize.name}</Text>
              <Text style={styles.widgetRowDesc}>{prize.desc}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {lottery.condition ? <Text style={styles.widgetMeta}>{lottery.condition}</Text> : null}
      {lottery.result ? <Text style={styles.widgetResult}>{lottery.result}</Text> : null}
      {lottery.winners.length ? (
        <View style={styles.widgetList}>
          <Text style={styles.widgetSection}>中奖名单</Text>
          {lottery.winners.map((winner, index) => (
            <Pressable
              key={`${winner.userId}-${winner.prize}-${index}`}
              onPress={() => winner.userId && onUser(winner.userId)}
              style={styles.widgetRow}
            >
              <Text style={styles.widgetWinner}>{winner.name}</Text>
              <Text style={styles.widgetRowDesc}>{winner.prize}</Text>
            </Pressable>
          ))}
        </View>
      ) : lottery.drawn ? null : (
        <Text style={styles.widgetMeta}>回帖即可参与抽奖</Text>
      )}
    </View>
  );
}

export function TopicVirtualCard({
  card,
  loggedIn,
  busy,
  onLogin,
  onCopy,
  onBuy,
}: {
  card: TopicVirtualCardDto;
  loggedIn: boolean;
  busy?: boolean;
  onLogin: () => void;
  onCopy: (value: string) => void;
  onBuy: (quantity: number) => void;
}) {
  const [qty, setQty] = useState(1);
  const max = Math.max(1, card.maxQuantity || 1);
  useEffect(() => {
    setQty((value) => Math.min(max, Math.max(1, value)));
  }, [max]);
  return (
    <View style={styles.widgetCard}>
      <View style={styles.widgetHead}>
        <View style={styles.widgetHeadText}>
          <Text style={styles.widgetKicker}>{card.kicker}</Text>
          <CompactTag tone={stampTone('card', card.status)}>{card.status}</CompactTag>
        </View>
        {card.stock ? <Text style={styles.widgetSide}>{card.stock}</Text> : null}
      </View>
      <Text style={styles.widgetTitle}>{card.name}</Text>
      {card.price > 0 ? (
        <Text style={styles.widgetPrice}>
          {card.price}
          <Text style={styles.widgetPriceUnit}> {card.priceUnit}</Text>
        </Text>
      ) : null}
      {card.tip ? <Text style={styles.widgetMeta}>{card.tip}</Text> : null}
      {card.sold || card.limit ? (
        <Text style={styles.widgetMeta}>{[card.sold, card.limit].filter(Boolean).join(' · ')}</Text>
      ) : null}
      {card.notice ? <Text style={styles.widgetNotice}>{card.notice}</Text> : null}
      {card.codes.length ? (
        <View style={styles.widgetList}>
          {card.codes.map((code, index) => (
            <Pressable key={`${code}-${index}`} onPress={() => onCopy(code)} style={styles.widgetCode}>
              <Text style={styles.widgetCodeText}>{code}</Text>
              <Text style={styles.widgetCodeCopy}>复制</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!loggedIn ? (
        <Pressable onPress={onLogin} style={styles.widgetLogin}>
          <Text style={styles.widgetLoginText}>登录后兑换</Text>
        </Pressable>
      ) : card.canBuy ? (
        <>
          {max > 1 ? (
            <View style={styles.widgetQtyRow}>
              <Pressable onPress={() => setQty((value) => Math.max(1, value - 1))} style={styles.widgetQtyBtn}>
                <Text style={styles.widgetQtyBtnText}>-</Text>
              </Pressable>
              <Text style={styles.widgetQtyValue}>{qty}</Text>
              <Pressable onPress={() => setQty((value) => Math.min(max, value + 1))} style={styles.widgetQtyBtn}>
                <Text style={styles.widgetQtyBtnText}>+</Text>
              </Pressable>
              <Text style={styles.widgetMeta}>共 {card.price * qty} 积分</Text>
            </View>
          ) : null}
          <PrimaryButton
            block
            disabled={busy}
            label={busy ? '兑换中…' : `${card.buyLabel || '兑换'}${card.price ? ` · ${card.price * qty} 积分` : ''}`}
            onPress={() => onBuy(qty)}
          />
        </>
      ) : null}
    </View>
  );
}



/** 「刚发布」定位的有效时长（毫秒）：覆盖 settle 的 0～400ms 五次尝试，之后不再干扰用户滚动。 */
const LOCATE_WINDOW_MS = 800;

/**
 * 本地记住「我已经竞猜过」。
 *
 * 官方页面**不会**体现这件事（投过之后面板和没投过一样，只有服务端在提交时拒
 * `{"ok":0,"message":"你已经参与过竞猜，请勿重复竞猜"}`），所以只能：
 *   ① 提交成功时记下来；② 被 409 ALREADY_VOTED 拒时记下来；
 *   ③ 在已加载的评论里认出「我发的 + 带竞猜标签」的评议回帖（不额外发请求）。
 */
const VOTED_KEY = (topicId: string) => `essence:voted:${topicId}`;
type VotedRecord = { choice: 'support' | 'oppose' | null; reason: string };

export function EssenceVoteCard({
  topicId,
  vote,
  votedHint,
  onSubmit,
  formRef,
  onReasonFocus,
  onCardLayout,
}: {
  topicId: string;
  vote: EssenceVoteDto;
  /** 从已加载的评论里认出来的「我的评议回帖」（可选，认出即锁定）。 */
  votedHint?: VotedRecord | null;
  onSubmit: (input: { vote: 'support' | 'oppose'; reason: string }) => Promise<void>;
  formRef?: React.Ref<View>;
  onReasonFocus?: () => void;
  onCardLayout?: (size: { y: number; h: number }) => void;
}) {
  const nav = useNav();
  const [choice, setChoice] = useState<'support' | 'oppose'>(vote.choice ?? 'support');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  /** 提交失败时把服务端/路由返回的原话直接显示出来。 */
  const [error, setError] = useState('');
  const [mine, setMine] = useState<VotedRecord | null>(() => cacheGet<VotedRecord>(VOTED_KEY(topicId)) ?? null);
  const remember = useCallback((record: VotedRecord) => {
    cacheSet(VOTED_KEY(topicId), record);
    setMine(record);
  }, [topicId]);
  // 评论里认出来的那条如果本机还没记过，就补记一次（下次进来直接锁定）
  useEffect(() => {
    if (!votedHint || mine) return;
    remember(votedHint);
  }, [votedHint, mine, remember]);
  const reasonInputRef = useRef<TextInput>(null);
  const reasonFocusedRef = useRef(false);
  const text = reason.trim();
  const lock: VotedRecord | null = mine
    ?? votedHint
    ?? (vote.choice ? { choice: vote.choice, reason: vote.myReason || '' } : null);
  const lockedChoice = lock?.choice ?? null;
  const lockedReason = lock?.reason ?? '';
  const locked = Boolean(lock);
  const submitVote = async () => {
    if (busy || !text) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit({ vote: choice, reason: text });
      remember({ choice, reason: text });
      setReason('');
    } catch (err) {
      // 服务端拒了就把它的话显示出来（字数不够、已经投过、竞猜结束…都由服务端说了算）
      const message = err instanceof ApiError ? err.message : '竞猜失败';
      setError(message);
      nav.toast(message);
      if (err instanceof ApiError && err.code === 'ALREADY_VOTED') {
        remember({ choice: null, reason: '' });
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (vote.choice) setChoice(vote.choice);
  }, [vote.choice, vote.supportVotes, vote.opposeVotes, vote.progress]);
  useEffect(() => {
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      if (!reasonFocusedRef.current) return;
      reasonFocusedRef.current = false;
      reasonInputRef.current?.blur();
    });
    return () => hide.remove();
  }, []);
  const ratio = vote.max > 0 ? Math.min(1, Math.max(0, vote.progress) / vote.max) : 0;
  const tone = vote.statusKey === 'featured' ? 'success' : vote.statusKey === 'review' ? 'warning' : vote.statusKey === 'voting' ? 'warning' : 'default';
  const statusText = vote.statusKey === 'ended' && !vote.canVote
    ? (vote.restriction || '暂不可申请')
    : vote.status;
  return (
    <View
      ref={formRef}
      collapsable={false}
      style={styles.voteCard}
      onLayout={(event) => {
        const { y, height } = event.nativeEvent.layout;
        onCardLayout?.({ y, h: height });
      }}
    >
      <Pressable onPress={() => setOpen((value) => !value)} style={styles.voteHead}>
        <View style={styles.voteHeadStack}>
          <Text style={styles.voteTitle}>精华申请</Text>
          <View style={styles.voteHeadMeta}>
            {open ? <CompactTag tone={tone}>{vote.status}</CompactTag> : <Text style={styles.voteSub} numberOfLines={1}>{statusText}</Text>}
          </View>
        </View>
        <Text style={styles.voteDetailLink}>{open ? '收起' : '查看详情'}</Text>
      </Pressable>
      {open ? (
        <>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, vote.progress < 0 && { backgroundColor: C.redBright }, { width: `${Math.round(ratio * 100)}%` } as { width: `${number}%` }]} />
          </View>
          <Text style={styles.voteProgressNow}>{vote.progress} / {vote.max}</Text>
          <Text style={styles.voteNote}>{vote.note || '进度 = 会加精点数 − 不会加精点数；达到 7 点后停止竞猜，进入审批，不会自动加精。'}</Text>
          {vote.statusKey === 'review' ? (
            <Text style={styles.voteRestrict}>已满 {vote.max} 点，进入人工审批，竞猜不会立刻加精。</Text>
          ) : null}
          {vote.restriction ? <Text style={styles.voteRestrict}>{vote.restriction}</Text> : null}
          <Text style={styles.voteMeta}>竞猜会加精 {vote.supportVotes} 人（{vote.supportPoints} 点） · 竞猜不会加精 {vote.opposeVotes} 人（{vote.opposePoints} 点）</Text>
          {vote.deadline ? <Text style={styles.voteMeta}>竞猜截止 {vote.deadline}</Text> : null}
          {vote.endedAt ? <Text style={styles.voteMeta}>结束于 {vote.endedAt}</Text> : null}
          {vote.pool ? (
            <Text style={styles.voteMeta}>
              奖池共 {vote.pool} 分
              {vote.poolGift ? ` · 系统赠送 ${vote.poolGift} 分` : ''}
              {vote.poolAuthor ? ` · 作者追加 ${vote.poolAuthor} 分` : ''}
              {vote.poolPaid ? ` · 已发放 ${vote.poolPaid} 分` : ''}
              {vote.poolPending ? ` · 待结算 ${vote.poolPending} 分` : ''}
            </Text>
          ) : null}
          {vote.poolResult ? <Text style={styles.voteNote}>{vote.poolResult}</Text> : null}
          {vote.payouts.length ? (
            <View style={styles.votePayouts}>
              {vote.payouts.map((row) => (
                <View key={`${row.name}-${row.points}`} style={styles.votePayoutRow}>
                  <Text style={styles.voteMeta}>{row.name}</Text>
                  <Text style={styles.votePayoutPts}>{row.points} 分</Text>
                </View>
              ))}
            </View>
          ) : null}
          {vote.success ? <Text style={styles.voteSuccess}>{vote.success}</Text> : null}
          {lockedChoice ? (
            <Text style={styles.voteChoiceDone}>你已预测{lockedChoice === 'oppose' ? '不会' : '会'}加精</Text>
          ) : null}
          {locked ? (
            <>
              <Text style={styles.voteMeta}>你已经参与过竞猜，请勿重复竞猜。</Text>
              {lockedReason ? (
                <Text style={styles.voteMeta}>你的竞猜理由已作为评议回帖发布：{lockedReason}</Text>
              ) : null}
            </>
          ) : null}
          {vote.canVote && !locked ? (
            <>
              <View style={styles.voteChoices}>
                <Pressable onPress={() => setChoice('support')} style={[styles.voteChoice, choice === 'support' && styles.voteChoiceOn]}>
                  <Text style={[styles.voteChoiceText, choice === 'support' && styles.voteChoiceTextOn]}>预测会加精</Text>
                </Pressable>
                <Pressable onPress={() => setChoice('oppose')} style={[styles.voteChoice, choice === 'oppose' && styles.voteChoiceOn]}>
                  <Text style={[styles.voteChoiceText, choice === 'oppose' && styles.voteChoiceTextOn]}>预测不会加精</Text>
                </Pressable>
              </View>
              <Text style={styles.voteMeta}>本票计 {vote.weight} 点，与最终审核结果一致的用户均分奖池。达到 {vote.max} 点后进入审批，不会自动加精。</Text>
              <View collapsable={false}>
                <TextInput
                  ref={reasonInputRef}
                  value={reason}
                  onChangeText={setReason}
                  placeholder="请填写竞猜理由，提交后会作为一条评议回帖发布"
                  placeholderTextColor={C.dim}
                  style={styles.voteReason}
                  multiline
                  /* 官方 textarea 有 maxlength="300"，这里静默限长，不再在界面上写字数说明 */
                  maxLength={ESSENCE_REASON_MAX}
                  onTouchStart={() => onReasonFocus?.()}
                  onPressIn={() => onReasonFocus?.()}
                  onFocus={() => {
                    reasonFocusedRef.current = true;
                    onReasonFocus?.();
                  }}
                  onBlur={() => {
                    reasonFocusedRef.current = false;
                  }}
                />
                {error ? <Text style={styles.authError}>{error}</Text> : null}
                <PrimaryButton
                  block
                  disabled={busy || !text}
                  label={busy ? '提交中…' : '提交竞猜'}
                  onPress={() => { void submitVote(); }}
                />
              </View>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export function topicJumpPage(topic: Topic, latest?: boolean) {
  if (!latest) return 1;
  if (topic.unreadPage && topic.unreadPage > 0) return topic.unreadPage;
  if (topic.unreadFloor) return 1;
  return Math.max(1, topic.lastPage ?? 1);
}

export function TopicDetailScreen({ topic, onBack, latest, editedComment, replyId, floor }: { topic: Topic; onBack: () => void; latest?: boolean; editedComment?: CommentDto; replyId?: string; floor?: string }) {
  const nav = useNav();
  const { fontFactor } = usePrefs();
  const insets = useAppInsets();
  const detail = useAsync(
    () => api.topic(topic.id),
    [topic.id, nav.loggedIn, topic.title, topic.body],
    `topic:${topic.id}:${nav.loggedIn ? '1' : '0'}`,
  );
  const [seekReplyId, setSeekReplyId] = useState<string | undefined>(replyId);
  const [seekFloor, setSeekFloor] = useState<string | undefined>(floor);
  const [commentPage, setCommentPage] = useState(() => (replyId || floor ? 0 : topicJumpPage(topic, latest)));
  const commentsQuery = useAsync(
    () => (
      commentPage === 0 && seekReplyId
        ? api.comments(topic.id, null, seekReplyId)
        : commentPage === 0 && seekFloor
          ? api.comments(topic.id, null, undefined, seekFloor)
          : api.comments(topic.id, commentPage > 1 ? String(commentPage) : null)
    ),
    [topic.id, commentPage, nav.loggedIn, seekReplyId, seekFloor],
    `comments:${topic.id}:${commentPage === 0 && seekReplyId ? `r${seekReplyId}` : commentPage === 0 && seekFloor ? `f${seekFloor}` : commentPage}:${nav.loggedIn ? '1' : '0'}`,
  );
  const scrollRef = useRef<ScrollView>(null);
  const scrollBoxRef = useRef<View>(null);
  const scrollYRef = useRef(0);
  const voteFormRef = useRef<View>(null);
  const [commentsAnchor, setCommentsAnchor] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [albumBusy, setAlbumBusy] = useState(false);
  const [albumName, setAlbumName] = useState('');
  const [albumItems, setAlbumItems] = useState<TopicCollectionPickDto[]>([]);
  useEffect(() => {
    setCommentsAnchor(0);
    setEssenceEditing(false);
    setSeekReplyId(replyId);
    setSeekFloor(floor);
    setCommentPage(replyId || floor ? 0 : topicJumpPage(topic, latest));
  }, [topic.id, latest, replyId, floor, topic.unreadPage, topic.unreadFloor, topic.lastPage]);
  useEffect(() => {
    if (detail.error && !detail.data) return;
    const replies = detail.data?.topic.replyCount ?? topic.replies;
    markTopicSeen(topic.id, replies);
  }, [topic.id, detail.data?.topic.replyCount, topic.replies, detail.error, detail.data]);
  useEffect(() => {
    if (!latest || replyId || seekReplyId || floor || seekFloor) return;
    if (topic.unreadPage || topic.unreadFloor) return;
    const last = Math.max(
      commentsQuery.data?.lastPage ?? 1,
      detail.data?.topic.lastPage ?? 1,
      topic.lastPage ?? 1,
    );
    if (last > commentPage && commentPage > 0) setCommentPage(last);
  }, [latest, replyId, seekReplyId, floor, seekFloor, topic.unreadPage, topic.unreadFloor, commentsQuery.data?.lastPage, detail.data?.topic.lastPage, topic.lastPage, commentPage]);
  const [replyTo, setReplyTo] = useState<CommentDto | null>(null);
  const [comment, setComment] = useState('');
  /**
   * 底部回复框直接用与「编辑回帖」同一套编辑器（useNbEditor）：
   * 工具条、表情库、图片上传、所见即所得、全屏全部一致 —— 全屏后就是完整的回帖编辑器。
   */
  const commentEditor = useNbEditor({
    value: comment,
    onChange: setComment,
    placeholder: replyTo ? `回复 ${replyTo.authorName}` : '发布你的回复',
    minHeight: 36,
    docked: true,
    inputStyle: styles.commentEditorInput,
    // 极简（内联）状态保持纯 markdown，富文本只在全屏里给
    richText: 'fullscreen',
    onLink: (href) => openAppHref(nav, href),
    onPickImageFile: () => pickPostImages({ me: nav.me, toast: nav.toast }),
    onUploadImageFile: (file, onProgress, target) => uploadPostImageFile(file, { toast: nav.toast, onProgress, silent: true, target }),
    onFocus: () => {
      composerFocusedRef.current = true;
      commentEditor.setEmojiOpen(false);
    },
    onBlur: () => {
      if ((Keyboard.metrics()?.height ?? 0) < 80) composerFocusedRef.current = false;
    },
  });

  /**
   * 官方面板不体现「我投过」，但评议回帖里认得出来：作者是我 + 带 `精华竞猜` 标签。
   * 只用**已加载**的评论判断（不额外发请求）；本机也会在提交/被拒时记住。
   */
  const myReviewReply = useMemo<VotedRecord | null>(() => {
    const me = nav.me;
    const hit = (commentsQuery.data?.items ?? []).find((item) => item.essenceLabel
      && ((me.id && item.authorId === me.id) || (me.name && item.authorName === me.name)));
    if (!hit) return null;
    return {
      choice: /不会/.test(hit.essenceLabel ?? '') ? 'oppose' : 'support',
      reason: (hit.body ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/【精华申请｜[^】]*】/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }, [commentsQuery.data?.items, nav.me]);
  const [justPostedId, setJustPostedId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(replyId ?? null);
  useEffect(() => {
    setJustPostedId(null);
    setReplyTo(null);
    setComment('');
    setHighlightId(replyId ?? null);
  }, [topic.id, replyId]);
  const [reactTarget, setReactTarget] = useState<CommentDto | null>(null);
  const [reactBusy, setReactBusy] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [donateOpen, setDonateOpen] = useState(false);
  const [donateBusy, setDonateBusy] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [donateInfo, setDonateInfo] = useState<DonateInfoDto | null>(null);
  // 弹幕默认关闭：多个原生动画同时合成在这台机器上会持续吃掉 40%+ CPU
  // （实测与气泡内容无关，纯色方块也一样），因此改成用户手动开启的选项。
  const [danmakuOn, setDanmakuOn] = useState(true);
  const [gallery, setGallery] = useState<{ uris: string[]; index: number } | null>(null);
  const [composerTools, setComposerTools] = useState(false);
  /**
   * 抽奖帖的「回帖需要验证码」：官方在回帖框上方挂 Cap 组件，提交必须带 cap_token。
   * 解出来一次用完就作废（capNonce 让组件重新挂载拿新题）。
   */
  const [capToken, setCapToken] = useState<string | null>(null);
  const [capNonce, setCapNonce] = useState(0);
  const replyCaptcha = detail.data?.replyCaptcha === true;
  const [commentMenu, setCommentMenu] = useState<SheetItem[] | null>(null);
  const [essenceEditing, setEssenceEditing] = useState(false);
  const composerKb = useKeyboardLift();
  const kbLift = composerKb.lift >= 80 ? composerKb.lift : 0;
  const hideComposer = essenceEditing && kbLift > 0;
  const voteLayoutRef = useRef({ y: 0, h: 0 });
  const viewportHRef = useRef(0);
  const kbLiftRef = useRef(0);
  kbLiftRef.current = kbLift;
  const locatePostedRef = useRef<string | null>(null);
  /**
   * 「刚发布」的定位只在提交后的一小段窗口内生效。
   *
   * 回帖行上的 onLayout 会在**任何**重新布局时触发定位（点楼主的「收起全文」、展开盖楼、切页…），
   * 而 justPostedId 平时不会清空 —— 于是过了很久还会把人拽回那条回帖（用户反馈的就是这个）。
   * 这里给定位设一个窗口：足够覆盖 settle（0～400ms 试五次），之后不再干扰用户滚动。
   */
  const locateArmedUntilRef = useRef(0);
  const locatedJumpRef = useRef('');
  const composerFocusedRef = useRef(false);
  const commentNodeRefs = useRef(new Map<string, View>());
  const replyToRef = useRef<CommentDto | null>(null);
  replyToRef.current = replyTo;
  const essenceEditingRef = useRef(false);
  essenceEditingRef.current = essenceEditing;
  const pinVoteToKeyboard = useCallback(() => {
    if (!essenceEditingRef.current) return;
    const viewH = viewportHRef.current;
    const { y, h } = voteLayoutRef.current;
    if (viewH < 80 || h < 40) return;
    const target = Math.max(0, y + h - viewH);
    scrollRef.current?.scrollTo({ y: target, animated: false });
  }, []);
  const pinComposerContext = useCallback(() => {
    if (essenceEditingRef.current) return;
    const scroll = scrollRef.current;
    const box = scrollBoxRef.current;
    if (!scroll || !box) return;
    const replyId = replyToRef.current?.id;
    const nodes = commentNodeRefs.current;
    const row = (replyId ? nodes.get(replyId) : null) ?? (replyId ? null : [...nodes.values()].at(-1));
    if (!row) return;
    row.measureInWindow((_cx, cy, _cw, ch) => {
      box.measureInWindow((_sx, sy, _sw, sh) => {
        if (sh < 80) return;
        const viewBottom = sy + sh;
        if (!replyId) {
          const near = cy + ch > sy - 24 && cy < viewBottom + 520;
          if (!near) return;
        }
        const gap = 8;
        const delta = ch + gap * 2 >= sh
          ? cy - sy - gap
          : cy + ch + gap - viewBottom;
        if (Math.abs(delta) < 2) return;
        const y = Math.max(0, scrollYRef.current + delta);
        scrollYRef.current = y;
        scroll.scrollTo({ y, animated: false });
      });
    });
  }, []);
  const locateCommentInView = useCallback((id: string) => {
    if (!id) return;
    if (kbLiftRef.current >= 80) return;
    const scroll = scrollRef.current;
    const box = scrollBoxRef.current;
    const row = commentNodeRefs.current.get(id);
    if (!scroll || !box || !row) return;
    row.measureInWindow((_cx, cy, _cw, ch) => {
      if (ch < 8) return;
      box.measureInWindow((_sx, sy, _sw, sh) => {
        if (sh < 80) return;
        const delta = cy - sy - 12;
        if (Math.abs(delta) < 4) return;
        const y = Math.max(0, scrollYRef.current + delta);
        scrollYRef.current = y;
        scroll.scrollTo({ y, animated: true });
      });
    });
  }, []);
  const locateJustPosted = useCallback((id: string) => {
    if (!id || locatePostedRef.current !== id) return;
    // 窗口过了就不再拽：之后的任何重排（收起全文、展开盖楼…）都只是正常布局
    if (Date.now() > locateArmedUntilRef.current) return;
    locateCommentInView(id);
  }, [locateCommentInView]);
  useEffect(() => {
    if (kbLift < 80) return;
    const frame = requestAnimationFrame(() => {
      if (essenceEditingRef.current) pinVoteToKeyboard();
      else if (composerFocusedRef.current) pinComposerContext();
    });
    return () => cancelAnimationFrame(frame);
  }, [kbLift, pinVoteToKeyboard, pinComposerContext]);
  useEffect(() => {
    if (!essenceEditing) return;
    const hide = Keyboard.addListener('keyboardDidHide', () => setEssenceEditing(false));
    return () => hide.remove();
  }, [essenceEditing]);
  useEffect(() => {
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      composerFocusedRef.current = false;
    });
    return () => hide.remove();
  }, []);
  useEffect(() => {
    if (!replyTo || kbLift < 80 || essenceEditing) return;
    const frame = requestAnimationFrame(() => pinComposerContext());
    return () => cancelAnimationFrame(frame);
  }, [replyTo, kbLift, essenceEditing, pinComposerContext]);
  useEffect(() => {
    if (!justPostedId) {
      locatePostedRef.current = null;
      return;
    }
    locatePostedRef.current = justPostedId;
    locateArmedUntilRef.current = Date.now() + LOCATE_WINDOW_MS;
    if (kbLift >= 80) return;
    let cancelled = false;
    const timers = [0, 40, 120, 240, 400].map((ms) => setTimeout(() => {
      if (!cancelled) locateJustPosted(justPostedId);
    }, ms));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [justPostedId, kbLift, locateJustPosted]);
  useAndroidBack(commentEditor.emojiOpen || composerTools || Boolean(replyTo) || donateOpen || Boolean(reactTarget) || Boolean(commentMenu), () => {
    if (commentMenu) {
      setCommentMenu(null);
      return;
    }
    if (commentEditor.emojiOpen) commentEditor.setEmojiOpen(false);
    else if (composerTools) setComposerTools(false);
    else if (reactTarget) setReactTarget(null);
    else if (donateOpen) setDonateOpen(false);
    else setReplyTo(null);
  });
  const dto = detail.data?.topic && String(detail.data.topic.id) === String(topic.id) ? detail.data.topic : undefined;
  const topicReady = Boolean(dto);
  const topicFailed = Boolean(detail.error) && !dto;
  const current = dto
    ? mapTopic({
      ...dto,
      forumName: dto.forumName || topic.forum,
      forumId: dto.forumId || topic.forumId || '',
    })
    : topic;
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!dto) return;
    setLiked(dto.liked);
    setLikeCount(dto.likeCount);
    setSaved(dto.favorited);
  }, [dto?.id, dto?.liked, dto?.likeCount, dto?.favorited]);
  useEffect(() => {
    if (!dto) {
      setAlbumItems([]);
      return;
    }
    setAlbumItems(detail.data?.collections ?? []);
  }, [dto, detail.data?.collections]);
  const authorQuery = useAsync(async () => {
    if (!dto?.authorId) return null;
    return mapUser(await api.user(dto.authorId));
  }, [dto?.authorId]);
  const author = authorQuery.data;
  const requireLogin = () => {
    if (nav.loggedIn) return true;
    nav.open({ name: 'login' });
    return false;
  };
  const topicUrl = TOPIC_SHARE(current.id);
  const viewCount = dto?.viewCount ?? 0;
  const replyCount = dto?.replyCount ?? current.replies;
  const perms = detail.data?.permissions;
  // 必须强制走内置浏览器：/topic/<id> 会被识别成 App 内页面，否则点了像没反应
  const openTopicWeb = () => nav.openWeb(topicUrl, '网页访问');
  const focusComposer = (opts?: { comment?: CommentDto; toComments?: boolean }) => {
    if (!requireLogin()) return;
    composerFocusedRef.current = true;
    if (opts?.comment) {
      setJustPostedId(null);
      setReplyTo(opts.comment);
      replyToRef.current = opts.comment;
    }
    requestAnimationFrame(() => {
      if (opts?.toComments) {
        scrollRef.current?.scrollTo({ y: Math.max(0, commentsAnchor - 8), animated: true });
      }
      commentEditor.focus();
    });
  };
  const openTopicDonate = () => {
    if (!requireLogin()) return;
    setDonateInfo(null);
    setDonateOpen(true);
    api.donateInfo(topic.id).then(setDonateInfo).catch((err) => {
      setDonateOpen(false);
      nav.toast(err instanceof ApiError ? err.message : '无法检查打赏条件');
    });
  };
  const onFavoriteTopic = async () => {
    if (!requireLogin()) return;
    const next = !saved;
    setSaved(next);
    try {
      const result = await api.favoriteTopic(topic.id);
      setSaved(result.favorited);
      nav.toast(result.favorited ? '已收藏' : '已取消收藏');
    } catch (err) {
      setSaved(dto?.favorited ?? false);
      nav.toast(err instanceof ApiError ? err.message : '操作失败');
    }
  };
  const openAlbum = async () => {
    if (!requireLogin()) return;
    setAlbumOpen(true);
    if (albumItems.length) return;
    try {
      const mine = await api.collections('mine');
      setAlbumItems(mine.items.map((item) => ({ id: item.id, title: item.title, included: false })));
    } catch (err) {
      nav.toast(err instanceof ApiError ? err.message : '无法加载专辑');
    }
  };
  const submitAlbum = async (input: { collectionId?: string; name?: string; remove?: boolean }) => {
    setAlbumBusy(true);
    try {
      const result = await api.topicCollections(topic.id, input);
      setAlbumItems(result.items);
      detail.setData((prev) => prev ? { ...prev, collections: result.items } : prev);
      setAlbumName('');
      nav.toast(result.message || '已更新专辑');
    } catch (err) {
      nav.toast(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setAlbumBusy(false);
    }
  };
  const deleteTopic = () => {
    setDialog({
      title: '删除主题',
      text: '删除后无法恢复。',
      confirmLabel: '删除',
      danger: true,
      onConfirm: async () => {
        try {
          await api.deleteTopic(topic.id);
          nav.toast('主题已删除');
          nav.close();
        } catch (err) {
          nav.toast(err instanceof ApiError ? err.message : '删除失败');
        }
      },
    });
  };
  const startEditComment = (item: CommentDto) => {
    if (!requireLogin()) return;
    nav.open({ name: 'edit-comment', topic: current, comment: item });
  };
  const openCommentMenu = (item: CommentDto) => {
    const items: SheetItem[] = [];
    if (item.canEdit || (nav.loggedIn && commentOwnedBy(item, nav.me))) {
      items.push({ label: '编辑', onPress: () => startEditComment(item) });
    }
    if (item.canDelete || (nav.loggedIn && commentOwnedBy(item, nav.me))) {
      items.push({ label: '删除', danger: true, onPress: () => deleteComment(item) });
    }
    items.push({
      label: '举报',
      onPress: () => {
        if (!requireLogin()) return;
        nav.open({
          name: 'report',
          targetType: 'reply',
          targetId: item.id,
          targetUser: item.authorName,
          topicTitle: current.title,
        });
      },
    });
    setCommentMenu(items);
  };
  const deleteComment = (item: CommentDto) => {
    setDialog({
      title: '确认操作',
      text: item.deleteConfirm || '确定删除？',
      confirmLabel: '确定',
      danger: true,
      rulesUrl: item.deleteRulesUrl,
      onConfirm: async () => {
        try {
          await api.deleteComment(topic.id, item.id);
          commentsQuery.setData((prev) => prev
            ? { ...prev, items: prev.items.filter((row) => row.id !== item.id) }
            : prev);
          detail.setData((prev) => prev
            ? { ...prev, topic: { ...prev.topic, replyCount: Math.max(0, prev.topic.replyCount - 1) } }
            : prev);
          if (replyTo?.id === item.id) setReplyTo(null);
          nav.toast('回帖已删除');
          nav.patchMe({ replyCount: Math.max(0, nav.me.replyCount - 1) });
          void nav.refreshMe();
        } catch (err) {
          nav.toast(err instanceof ApiError ? err.message : '删除失败');
        }
      },
    });
  };
  const authorUid = author?.uid || dto?.authorId || current.authorId || '';
  const opIcon = C.muted;
  const comments = commentsQuery.data?.items ?? [];
  const hasNextComments = Boolean(commentsQuery.data?.nextCursor);
  const targetReplyId = seekReplyId || replyId;
  const shownPage = commentPage === 0 ? (commentsQuery.data?.page ?? 1) : commentPage;
  const pageImages = useMemo(() => uniqueImages([
    ...collectArticleImages(current.body ?? ''),
    ...comments.flatMap((item) => collectArticleImages(item.body)),
  ]), [current.body, comments]);
  const openPageImage = useCallback((src: string) => {
    openImageGallery(src, pageImages, setGallery);
  }, [pageImages]);
  const commentTree = useMemo(() => {
    const byId = new Map(comments.map((item) => [item.id, item]));
    const byFloor = new Map(comments.filter((item) => item.floor).map((item) => [String(item.floor), item]));
    const rootOf = (item: CommentDto) => {
      let current = item;
      const seen = new Set<string>();
      while (current.parentId || current.parentFloor) {
        if (seen.has(current.id)) break;
        seen.add(current.id);
        const parent = (current.parentId ? byId.get(current.parentId) : undefined)
          || (current.parentFloor ? byFloor.get(String(current.parentFloor)) : undefined);
        if (!parent || parent.id === current.id) break;
        current = parent;
      }
      return current;
    };
    const roots: CommentDto[] = [];
    const childrenOf = new Map<string, CommentDto[]>();
    comments.forEach((item) => {
      const root = rootOf(item);
      if (root.id === item.id) {
        roots.push(item);
        return;
      }
      const list = childrenOf.get(root.id) ?? [];
      list.push(item);
      childrenOf.set(root.id, list);
    });
    return { roots, childrenOf };
  }, [comments]);
  const latestComment = useMemo(() => {
    if (!comments.length) return null;
    return comments.reduce((best, item) => {
      const a = Number(best.floor) || 0;
      const b = Number(item.floor) || 0;
      if (b !== a) return b > a ? item : best;
      return item;
    });
  }, [comments]);
  const jumpComment = useMemo(() => {
    if (targetReplyId) return comments.find((item) => item.id === targetReplyId) ?? null;
    if (seekFloor) return comments.find((item) => String(item.floor) === String(seekFloor)) ?? null;
    if (!latest) return null;
    if (topic.unreadFloor) {
      const floor = String(topic.unreadFloor);
      return comments.find((item) => String(item.floor) === floor) ?? null;
    }
    return latestComment;
  }, [targetReplyId, seekFloor, latest, topic.unreadFloor, comments, latestComment]);
  useEffect(() => {
    const targetId = jumpComment?.id;
    if (!targetId) return;
    commentTree.roots.forEach((root) => {
      const kids = commentTree.childrenOf.get(root.id) ?? [];
      if (!kids.some((kid) => kid.id === targetId)) return;
      if (kids.length <= 4) return;
      const idx = kids.findIndex((kid) => kid.id === targetId);
      if (idx < 4) return;
      setExpandedThreads((prev) => (prev[root.id] ? prev : { ...prev, [root.id]: true }));
    });
  }, [jumpComment?.id, commentTree]);
  useEffect(() => {
    if (targetReplyId) {
      setHighlightId(targetReplyId);
      return;
    }
    if (jumpComment?.id) setHighlightId(jumpComment.id);
  }, [targetReplyId, jumpComment?.id]);
  useEffect(() => {
    locatedJumpRef.current = '';
  }, [topic.id, commentPage, latest, targetReplyId, seekFloor]);
  useEffect(() => {
    if (!latest && !targetReplyId && !seekFloor) return;
    if (commentsQuery.loading || commentsQuery.fetching) return;
    const targetId = targetReplyId || jumpComment?.id || null;
    if (!targetId) return;
    const key = `${topic.id}:${shownPage}:${targetId}`;
    if (locatedJumpRef.current === key) return;
    locatedJumpRef.current = key;
    let cancelled = false;
    const timers = [40, 120, 280, 480].map((ms) => setTimeout(() => {
      if (!cancelled) locateCommentInView(targetId);
    }, ms));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [latest, targetReplyId, seekFloor, jumpComment?.id, topic.id, commentsQuery.loading, commentsQuery.fetching, shownPage, locateCommentInView]);
  useEffect(() => {
    if (!latest || targetReplyId || jumpComment?.id || topic.unreadFloor) return;
    if (commentsQuery.loading || commentsQuery.fetching) return;
    if (!commentsAnchor) return;
    const key = `${topic.id}:${commentPage}:anchor`;
    if (locatedJumpRef.current === key) return;
    locatedJumpRef.current = key;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, commentsAnchor - 8), animated: true });
    });
  }, [latest, targetReplyId, jumpComment?.id, topic.unreadFloor, topic.id, commentsQuery.loading, commentsQuery.fetching, commentsAnchor, commentPage]);
  const patchComment = (id: string, next: Partial<CommentDto>) => {
    commentsQuery.setData((prev) => prev
      ? { ...prev, items: prev.items.map((item) => (item.id === id ? { ...item, ...next } : item)) }
      : prev);
  };
  useEffect(() => {
    if (!editedComment) return;
    patchComment(editedComment.id, editedComment);
  }, [editedComment?.id, editedComment?.body, editedComment?.editedAt]);
  const openCommentReact = (item: CommentDto) => {
    if (!requireLogin()) return;
    if (item.liked && item.coined) {
      setDialog({
        title: '已投币',
        text: '这条内容已经投币，点赞无法取消。',
        confirmLabel: '知道了',
        onConfirm: () => undefined,
      });
      return;
    }
    if (item.liked) {
      setDialog({
        title: '取消点赞',
        text: '确定取消点赞吗？',
        confirmLabel: '取消点赞',
        danger: true,
        onConfirm: async () => {
          try {
            const result = await api.reactComment(topic.id, item.id, 0);
            patchComment(item.id, { liked: result.liked, coined: result.coined, likeCount: result.likeCount });
            nav.toast(result.message || '已取消点赞');
          } catch (err) {
            nav.toast(err instanceof ApiError ? err.message : '操作失败');
          }
        },
      });
      return;
    }
    setReactTarget(item);
  };
  const jumpToComment = (target: { id?: string | null; floor?: string | null }) => {
    const id = String(target.id || '').trim();
    const floorNo = String(target.floor || '').trim();
    const found = comments.find((item) => (id && item.id === id) || (floorNo && String(item.floor) === floorNo)) ?? null;
    if (found) {
      commentTree.roots.forEach((root) => {
        const kids = commentTree.childrenOf.get(root.id) ?? [];
        if (!kids.some((kid) => kid.id === found.id)) return;
        setExpandedThreads((prev) => (prev[root.id] ? prev : { ...prev, [root.id]: true }));
      });
      setHighlightId(found.id);
      [16, 80, 200, 400].forEach((ms) => setTimeout(() => locateCommentInView(found.id), ms));
      return;
    }
    if (id) {
      setSeekFloor(undefined);
      setSeekReplyId(id);
      setCommentPage(0);
      setHighlightId(id);
      locatedJumpRef.current = '';
      return;
    }
    if (floorNo) {
      setSeekReplyId(undefined);
      setSeekFloor(floorNo);
      setCommentPage(0);
      locatedJumpRef.current = '';
      return;
    }
    nav.toast('找不到该楼层');
  };
  const openLink = (href: string) => {
    const action = classifyAppHref(href);
    const floorFromHref = (action.type === 'topic' ? action.floor : undefined)
      || href.match(/[?&]floor=(\d+)/i)?.[1]
      || href.match(/#(\d+)\s*$/)?.[1]
      || undefined;
    const replyFromHref = action.type === 'topic' ? action.replyId : undefined;
    const sameTopic = action.type === 'topic' && action.id === topic.id;
    if ((sameTopic && (replyFromHref || floorFromHref)) || (action.type === 'ignore' && floorFromHref)) {
      jumpToComment({ id: replyFromHref, floor: floorFromHref });
      return;
    }
    openAppHref(nav, href, current.forum);
  };
  const openCommentUser = (item: CommentDto) => {
    const id = pickUserId(item.authorId, item.uid);
    if (!id) {
      nav.toast('无法打开该用户');
      return;
    }
    nav.openUser(id);
  };
  const commentReplyHint = (kid: CommentDto, root: CommentDto) => {
    const parentFloor = kid.parentFloor ? String(kid.parentFloor) : '';
    if (!parentFloor && !kid.parentId) return null;
    if (kid.parentId === root.id) return null;
    if (parentFloor && String(root.floor ?? '') === parentFloor) return null;
    const raw = (kid.body ?? '').replace(/<[^>]+>/g, ' ').trim();
    if (/^@/.test(raw)) return null;
    return parentFloor ? `回复 #${parentFloor}` : null;
  };
  const renderComment = (item: CommentDto, nested = false, replyCount = 0, replyHint: string | null = null) => {
    const heartOn = Boolean(item.liked);
    const body = item.body;
    const isJustPosted = Boolean(justPostedId && justPostedId === item.id);
    const isHighlighted = Boolean(highlightId && highlightId === item.id && !isJustPosted);
    const isReplyTarget = Boolean(replyTo && replyTo.id === item.id);
    const actColor = isReplyTarget ? C.text : C.dim;
    const avatarSize = nested ? 28 : 36;
    return (
      <View
        key={item.id}
        collapsable={false}
        ref={(node) => {
          if (node) commentNodeRefs.current.set(item.id, node);
          else commentNodeRefs.current.delete(item.id);
        }}
        style={[
          styles.commentRow,
          nested && styles.commentNested,
          isHighlighted && styles.commentRowHighlight,
          isJustPosted && styles.commentRowPosted,
        ]}
        onLayout={() => {
          if (isJustPosted) locateJustPosted(item.id);
        }}
      >
        <View style={[styles.commentAvatarCol, nested && styles.commentAvatarColNested]}>
          <Pressable onPress={() => openCommentUser(item)} hitSlop={6}>
            <UserAvatar name={item.authorName} url={item.avatar.includes('/') ? item.avatar : undefined} accent={item.accent} size={avatarSize} radius={avatarSize / 2} online={Boolean(item.online)} />
          </Pressable>
        </View>
        <View style={styles.commentBody}>
          <View style={styles.commentHead}>
            <Pressable onPress={() => openCommentUser(item)} hitSlop={6} style={styles.commentNameHit}>
              <Text numberOfLines={1} style={styles.commentName}>{item.authorName}</Text>
            </Pressable>
            <TitleBadges
              compact
              title={item.authorTitle}
              groupLabel={item.authorGroup}
              serial={item.authorTitleSerial}
              size="sm"
              showSerial
              onPress={() => nav.open({ name: 'titles', tab: '称号抽取' })}
            />
            {item.uid ? <Text numberOfLines={1} style={styles.commentUid}>UID {item.uid}</Text> : null}
            <Pressable onPress={() => openCommentMenu(item)} hitSlop={8} style={styles.commentMore} accessibilityLabel="更多">
              <Icon name="ellipsis-horizontal" size={16} color={C.dim} />
            </Pressable>
          </View>
          {/* 竞猜理由是以「评议回帖」发布的，官方会打上「精华竞猜 · 预测会不会加精」标签 */}
          {item.essenceLabel ? (
            <View style={styles.commentEssenceTag}>
              <CompactTag tone={/不会/.test(item.essenceLabel) ? 'default' : 'warning'}>
                {item.essenceLabel}
              </CompactTag>
            </View>
          ) : null}
          {replyHint ? (
            <Pressable onPress={() => {
              const floorNo = replyHint.match(/#(\d+)/)?.[1];
              if (floorNo) jumpToComment({ floor: floorNo });
            }} hitSlop={6}>
              <Text style={styles.commentReplyTo}>{replyHint}</Text>
            </Pressable>
          ) : null}
          {body ? (
            <ArticleBody
              compact
              foldable
              foldHeight={420}
              text={body}
              onImage={openPageImage}
              gallerySrcs={pageImages}
              onCopy={async (value) => {
                await copyText(value);
                nav.toast('已复制');
              }}
              onLink={openLink}
              onSecret={() => nav.toast('内容已被服务端脱敏')}
            />
          ) : null}
          <EditNoteLine
            compact
            editorName={item.editedBy}
            editorId={item.editedById}
            editedAt={item.editedAt}
            onUser={(id) => nav.openUser(id)}
          />
          <View style={styles.commentActions}>
            <Pressable
              onPress={() => focusComposer({ comment: item })}
              hitSlop={8}
              style={styles.commentAct}
              accessibilityLabel="回复"
            >
              <Icon name="chatbubble-outline" size={15} color={actColor} />
              {replyCount > 0 ? <Text style={styles.commentActCount}>{compactCount(replyCount)}</Text> : null}
            </Pressable>
            <Pressable onPress={() => openCommentReact(item)} hitSlop={8} style={styles.commentAct} accessibilityLabel="点赞">
              <Icon name={heartOn ? 'heart' : 'heart-outline'} size={15} color={heartOn ? C.red : actColor} />
              {item.likeCount > 0 ? (
                <Text style={[styles.commentActCount, heartOn && styles.commentLikeCountOn]}>{compactCount(item.likeCount)}</Text>
              ) : null}
            </Pressable>
            <View style={styles.commentActionMeta}>
              {item.floor ? (
                <Pressable onPress={() => jumpToComment({ id: item.id, floor: item.floor })} hitSlop={8} accessibilityLabel={`定位到第 ${item.floor} 楼`}>
                  <Text style={styles.commentActionFloor}>#{item.floor}</Text>
                </Pressable>
              ) : null}
              <Text style={styles.commentActionMetaText}>
                {item.floor ? ' · ' : ''}
                {isJustPosted ? '刚刚' : shortAgo(item.createdAt)}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };
  return (
    <View style={styles.flex}>
      <ScreenHeader
        title={topicFailed ? (topicErrorKind(detail.error) === 'gone' ? '走丢了' : '主题') : (!topicReady && !topic.author) ? '主题' : current.forum}
        onBack={onBack}
        right={(
          <View style={styles.headerActions}>
            <IconButton name="desktop-outline" onPress={openTopicWeb} />
            {topicFailed ? null : <IconButton name="share-social-outline" onPress={() => setShareOpen(true)} />}
          </View>
        )}
      />
      {topicFailed ? (
        <TopicGone
          message={detail.error}
          onRetry={() => { detail.reload(); commentsQuery.reload(); }}
        />
      ) : (
      <View style={[styles.flex, kbLift ? { paddingBottom: kbLift } : null]}>
      <View ref={scrollBoxRef} collapsable={false} style={styles.flex}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEventThrottle={16}
        onLayout={(event) => {
          viewportHRef.current = event.nativeEvent.layout.height;
        }}
        onScroll={(event) => {
          scrollYRef.current = event.nativeEvent.contentOffset.y;
        }}
        contentContainerStyle={styles.detailContent}
      >
        {detail.error && dto ? <StatusBlock error={detail.error} onRetry={detail.reload} /> : null}
        {topicReady || topic.author ? (
        <>
        <View style={styles.detailTitleRow}>
          {topicTagList(current).filter((tag) => tag.type === 'pinned').map((tag) => (
            <CompactTag key={`${tag.type}-${tag.label}`} tone={stampTone(tag.type, tag.label)}>{stampLabel(tag)}</CompactTag>
          ))}
          <Text selectable style={scaleTextStyle(styles.detailTitle, fontFactor)}>{current.title}</Text>
          <View style={styles.detailViews}>
            <Icon name="eye-outline" size={14} color={C.dim} />
            <Text style={styles.detailViewsText}>{viewCount}</Text>
          </View>
          <View style={styles.detailViews}>
            <Icon name="chatbubble-outline" size={14} color={C.dim} />
            <Text style={styles.detailViewsText}>{replyCount}</Text>
          </View>
          {topicTagList(current).filter((tag) => tag.type !== 'pinned').map((tag) => (
            <CompactTag key={`${tag.type}-${tag.label}`} tone={stampTone(tag.type, tag.label)}>{stampLabel(tag)}</CompactTag>
          ))}
        </View>
        <View style={styles.authorLine}>
          <Pressable onPress={() => {
            const id = pickUserId(dto?.authorId, current.authorId, author?.id, author?.uid);
            if (!id) {
              nav.toast('无法打开该用户');
              return;
            }
            nav.openUser(id);
          }} hitSlop={6} style={styles.avatarHit}>
            <UserAvatar name={current.author} url={current.avatarUrl} accent={current.accent} size={38} online={Boolean(dto?.online ?? current.online)} />
          </Pressable>
          <View style={styles.authorCopy}>
            <View style={styles.authorNameRow}>
              <Pressable onPress={() => {
                const id = pickUserId(dto?.authorId, current.authorId, author?.id, author?.uid);
                if (!id) {
                  nav.toast('无法打开该用户');
                  return;
                }
                nav.openUser(id);
              }} hitSlop={6}>
                <Text style={styles.authorName}>{current.author}</Text>
              </Pressable>
              <TitleBadges
                title={current.authorTitle || author?.title}
                serial={current.authorTitleSerial}
                groupLabel={current.authorGroup || author?.groupLabel}
                size="sm"
                showSerial
                onPress={() => nav.open({ name: 'titles', tab: '称号抽取' })}
              />
              {authorUid ? <Text style={styles.authorUid}>UID {authorUid}</Text> : null}
            </View>
            <View style={styles.authorTimeRow}>
              <Text style={styles.authorMeta}>{current.time}</Text>
              {perms?.canDelete || perms?.canEdit ? (
                <View style={styles.authorOps}>
                  {perms?.canDelete || perms?.canEdit ? (
                    <Pressable
                      onPress={() => {
                        if (!requireLogin()) return;
                        deleteTopic();
                      }}
                      hitSlop={8}
                      accessibilityLabel="删除"
                    >
                      <Icon name="trash-outline" size={16} color={opIcon} />
                    </Pressable>
                  ) : null}
                  {perms?.canEdit ? (
                    <Pressable
                      onPress={() => {
                        if (!requireLogin()) return;
                        nav.open({ name: 'edit-topic', topic: current });
                      }}
                      hitSlop={8}
                      accessibilityLabel="编辑"
                    >
                      <Icon name="create-outline" size={16} color={opIcon} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        </View>
        </>
        ) : null}
        {detail.loading && !current.body ? (
          <ContentSkeleton variant="article" />
        ) : (
        <View style={styles.articleStage}>
          <ArticleBody
            foldable
            text={current.body ?? ''}
            onImage={openPageImage}
            gallerySrcs={pageImages}
            onCopy={async (value) => {
              await copyText(value);
              nav.toast('已复制');
            }}
            onLink={openLink}
            onSecret={() => setDialog({
              title: '敏感信息',
              text: '这可能是密钥、Cookie 或兑换码。原文已被脱敏，复制前请确认来源可信。',
              confirmLabel: '我知道了',
              onConfirm: () => nav.toast('内容已被服务端脱敏'),
            })}
          />
          <EditNoteLine
            editorName={dto?.editedBy || current.editedBy}
            editorId={dto?.editedById || current.editedById}
            editedAt={dto?.editedAt || current.editedAt}
            onUser={(id) => nav.openUser(id)}
          />
          <FlyingBarrage items={detail.data?.barrage ?? []} enabled={danmakuOn} />
        </View>
        )}
        {detail.data?.lottery ? (
          <TopicLotteryCard
            lottery={detail.data.lottery}
            onUser={(id) => nav.openUser(id)}
          />
        ) : null}
        {detail.data?.virtualCard ? (
          <TopicVirtualCard
            card={detail.data.virtualCard}
            loggedIn={nav.loggedIn}
            busy={cardBusy}
            onLogin={() => nav.open({ name: 'login' })}
            onCopy={async (value) => {
              await copyText(value);
              nav.toast('已复制');
            }}
            onBuy={(quantity) => {
              if (!requireLogin()) return;
              const card = detail.data?.virtualCard;
              if (!card) return;
              const cost = card.price * quantity;
              setDialog({
                title: '确认兑换',
                text: `将花费 ${cost} 积分兑换 ${quantity} 张「${card.name}」。`,
                confirmLabel: '确认兑换',
                onConfirm: async () => {
                  setCardBusy(true);
                  try {
                    const result = await api.buyVirtualCard(topic.id, quantity);
                    if (result.card) {
                      detail.setData((prev) => prev ? { ...prev, virtualCard: result.card } : prev);
                    } else {
                      detail.reload();
                    }
                    nav.toast(result.message || '兑换成功');
                    void nav.refreshMe();
                  } catch (err) {
                    nav.toast(err instanceof ApiError ? err.message : '兑换失败');
                  } finally {
                    setCardBusy(false);
                  }
                },
              });
            }}
          />
        ) : null}
        {topicReady ? (
        <>
        <View style={styles.xActionBar}>
          <Pressable onPress={() => focusComposer({ toComments: true })} style={styles.xActionItem} accessibilityLabel="回复">
            <Icon name="chatbubble-outline" size={18} color={C.dim} />
            <Text style={styles.xActionCount}>{compactCount(dto?.replyCount ?? current.replies) || '0'}</Text>
          </Pressable>
          <Pressable onPress={openTopicDonate} style={styles.xActionItem} accessibilityLabel={liked ? '已点赞，打开点赞打赏' : '点赞打赏'}>
            <Icon name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? C.red : C.dim} />
            <Text style={[styles.xActionCount, liked && styles.authorOpCountOn]}>{compactCount(likeCount) || '0'}</Text>
          </Pressable>
          <Pressable onPress={onFavoriteTopic} style={styles.xActionItem} accessibilityLabel="收藏">
            <Icon name={saved ? 'bookmark' : 'bookmark-outline'} size={18} color={saved ? C.orange : C.dim} />
          </Pressable>
          <Pressable onPress={() => setShareOpen(true)} style={styles.xActionItem} accessibilityLabel="分享">
            <Icon name="share-outline" size={18} color={C.dim} />
          </Pressable>
        </View>
        <View style={styles.topicCtaRow}>
          <Pressable
            onPress={openTopicDonate}
            style={styles.donateCta}
          >
            <Text style={styles.donateCtaText}>$ 点赞打赏</Text>
          </Pressable>
          <Pressable onPress={() => setDanmakuOn((value) => !value)} style={styles.danmakuCta}>
            <Text style={styles.danmakuCtaText}>{danmakuOn ? '关闭弹幕' : '打开弹幕'}</Text>
          </Pressable>
        </View>
        <View style={styles.topicAlbum}>
          <Text style={styles.topicAlbumTitle}>淘帖专辑</Text>
          <Text style={styles.topicAlbumCopy}>把好文章整理进公开或私密专辑，并与协作者共同维护。</Text>
          <View style={styles.topicAlbumActions}>
            <Pressable
              onPress={() => { void openAlbum(); }}
              style={styles.topicAlbumBtn}
            >
              <Text style={styles.topicAlbumBtnText}>收录到专辑</Text>
            </Pressable>
            <Pressable onPress={() => nav.open({ name: 'collections', tab: 'mine' })} hitSlop={6}>
              <Text style={styles.topicAlbumLink}>我的淘帖 →</Text>
            </Pressable>
          </View>
        </View>
        {detail.data?.vote ? (
          <EssenceVoteCard
            topicId={topic.id}
            vote={detail.data.vote}
            votedHint={myReviewReply}
            formRef={voteFormRef}
            onCardLayout={(size) => {
              const prevH = voteLayoutRef.current.h;
              voteLayoutRef.current = size;
              if (essenceEditingRef.current && kbLift >= 80 && Math.abs(size.h - prevH) > 12) {
                pinVoteToKeyboard();
              }
            }}
            onReasonFocus={() => {
              setEssenceEditing(true);
              commentEditor.setEmojiOpen(false);
            }}
            onSubmit={async (input) => {
              if (!requireLogin()) return;
              const next = await api.voteTopic(topic.id, input);
              Keyboard.dismiss();
              detail.setData((prev) => prev ? { ...prev, vote: next } : prev);
              /**
               * 官方把竞猜理由作为一条评议回帖发布 —— 直接把它并进列表并滚过去，
               * 用户能立刻看到自己写的那条理由（与发回帖后的定位同一套机制）。
               */
              const created = next.postedComment ?? null;
              if (created) {
                commentsQuery.setData((prev) => {
                  if (!prev || prev.items.some((item) => item.id === created.id)) return prev;
                  return { ...prev, items: [...prev.items, created] };
                });
                setHighlightId(created.id);
                setJustPostedId(created.id);
              } else {
                commentsQuery.reload();
              }
              nav.toast(
                next.statusKey === 'featured'
                  ? '已加精'
                  : next.statusKey === 'review'
                    ? '已进入审批，不会自动加精'
                    : next.choice === 'oppose'
                      ? `已预测不会加精 · ${next.progress} / ${next.max}`
                      : `已预测会加精 · ${next.progress} / ${next.max}`,
              );
            }}
          />
        ) : null}
        <View style={styles.quote}><Text style={styles.quoteLabel}>社区提示</Text><Text style={styles.quoteText}>请勿发布违法违规内容、明文 Token 或他人隐私信息。</Text></View>
        <View
          style={styles.commentsHead}
          onLayout={(event) => setCommentsAnchor(event.nativeEvent.layout.y)}
        >
          <View style={styles.commentsHeadLeft}>
            <Text style={styles.commentsHeadLabel}>评论</Text>
            <Text style={styles.commentsCount}>{dto?.replyCount ?? current.replies}</Text>
          </View>
        </View>
        {commentsQuery.error ? <StatusBlock error={commentsQuery.error} onRetry={commentsQuery.reload} /> : null}
        {commentsQuery.loading && !comments.length ? <ContentSkeleton variant="comments" /> : null}
        {!comments.length && !commentsQuery.loading && !commentsQuery.error ? (
          <Text style={styles.quoteText}>{nav.loggedIn ? '还没有回复。' : '评论登录后可见。'}</Text>
        ) : null}
        {commentTree.roots.map((item) => {
          const kids = commentTree.childrenOf.get(item.id) ?? [];
          const containsFocus = Boolean(
            (justPostedId && kids.some((kid) => kid.id === justPostedId))
            || (highlightId && kids.some((kid) => kid.id === highlightId))
          );
          const collapsed = kids.length > 4 && !expandedThreads[item.id] && !containsFocus;
          const shown = collapsed ? kids.slice(0, 4) : kids;
          return (
            <View key={item.id} style={styles.commentThread}>
              {renderComment(item, false, kids.length)}
              {shown.length ? (
                <View style={styles.commentKids}>
                  {shown.map((kid) => renderComment(kid, true, 0, commentReplyHint(kid, item)))}
                  {collapsed ? (
                    <Pressable onPress={() => setExpandedThreads((prev) => ({ ...prev, [item.id]: true }))} style={styles.threadMore}>
                      <Text style={styles.threadMoreText}>展开剩余 {kids.length - 4} 条回复</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
        {shownPage > 1 || hasNextComments ? (
          <View style={styles.pager}>
            <Pressable disabled={shownPage <= 1 || commentsQuery.fetching} onPress={() => setCommentPage(Math.max(1, shownPage - 1))} style={[styles.pagerBtn, shownPage <= 1 && styles.pagerBtnOff]}>
              <Text style={styles.pagerText}>上一页</Text>
            </Pressable>
            <Text style={styles.pagerNow}>第 {shownPage} 页</Text>
            <Pressable disabled={!hasNextComments || commentsQuery.fetching} onPress={() => setCommentPage(shownPage + 1)} style={[styles.pagerBtn, !hasNextComments && styles.pagerBtnOff]}>
              <Text style={styles.pagerText}>下一页</Text>
            </Pressable>
          </View>
        ) : null}
        </>
        ) : null}
      </ScrollView>
      </View>
      {hideComposer || !topicReady ? null : (
      <View
        style={[
          styles.commentBar,
          { paddingBottom: 8 + insets.bottom },
        ]}
      >
        {replyTo ? (
          <Pressable onPress={() => setReplyTo(null)} style={styles.replyChip}>
            <Text numberOfLines={1} style={styles.replyChipText}>
              回复 {replyTo.authorName}{replyTo.floor ? ` #${replyTo.floor}` : ''}
              {commentPreview(replyTo.body || '') ? `：${commentPreview(replyTo.body || '')}` : ''}
            </Text>
            <Icon name="close" size={12} color={C.muted} />
          </Pressable>
        ) : null}
        {/* 抽奖帖且作者保留「回帖需要验证码」时，官方会在回帖框上方挂 Cap 验证组件 */}
        {nav.loggedIn && replyCaptcha ? (
          <View style={styles.commentCaptcha}>
            <Text style={styles.commentCaptchaTitle}>
              {capToken ? '人机验证已通过' : '该帖开启了回帖人机验证'}
            </Text>
            <CaptchaWidget
              key={`${topic.id}-${capNonce}`}
              token={capToken}
              config={detail.data?.replyCaptchaConfig ?? null}
              onToken={setCapToken}
            />
          </View>
        ) : null}
        {/* 与官方一致：表情面板弹在工具条**上方**（官方 .nb-editor-panel 是 fixed 浮层，
            定位代码 `above = barRect.top - height - 6` 优先向上弹），工具条贴着输入框。 */}
        {nav.loggedIn && commentEditor.emojiOpen ? commentEditor.emoji : null}
        {nav.loggedIn && composerTools ? commentEditor.toolbar : null}
        <View style={styles.commentComposer}>
          <UserAvatar
            name={nav.loggedIn ? (nav.me.name || '我') : '我'}
            url={nav.loggedIn ? nav.me.avatarUrl : undefined}
            accent={nav.loggedIn ? nav.me.accent : C.dim}
            size={32}
            radius={16}
          />
          {nav.loggedIn ? commentEditor.field : (
            <Pressable
              onPress={() => requireLogin()}
              style={styles.commentLoginHit}
              accessibilityLabel="登录后评论"
            >
              <Text style={styles.commentInput}>登录后评论</Text>
            </Pressable>
          )}
          <View style={styles.commentComposerIcons}>
            {nav.loggedIn ? (
              <Pressable
                onPress={() => {
                  commentEditor.focus();
                  setComposerTools(true);
                  commentEditor.toggleEmoji();
                }}
                hitSlop={8}
                accessibilityLabel="表情"
              >
                <Icon name="happy-outline" size={20} color={commentEditor.emojiOpen ? C.text : C.dim} />
              </Pressable>
            ) : null}
            {nav.loggedIn ? (
              <Pressable
                onPress={() => {
                  commentEditor.focus();
                  setComposerTools((open) => !open);
                }}
                hitSlop={8}
                accessibilityLabel={composerTools ? '收起编辑工具' : '展开编辑工具（与编辑回帖一致，可全屏）'}
              >
                <Icon name={composerTools ? 'contract-outline' : 'expand-outline'} size={18} color={composerTools ? C.text : C.dim} />
              </Pressable>
            ) : null}
            <Pressable
              disabled={busy || !comment.trim()}
              onPress={async () => {
                if (!requireLogin()) return;
                if (replyCaptcha && !capToken) {
                  nav.toast('该帖开启了回帖人机验证，请先完成验证');
                  return;
                }
                setBusy(true);
                try {
                  // 所见即所得模式下先把活文档拉平回 markdown（与编辑回帖一致）
                  const bodyText = (await commentEditor.flush()).trim();
                  if (!bodyText) return;
                  const created = await api.createComment(topic.id, {
                    body: replyTo ? `@${replyTo.authorName}${replyTo.floor ? ` #${replyTo.floor}` : ''} ${bodyText}` : bodyText,
                    parentId: replyTo?.id,
                    parentFloor: replyTo?.floor ?? undefined,
                    capToken: capToken ?? undefined,
                  });
                  // 一次性凭证：发完就换一道新题
                  if (replyCaptcha) {
                    setCapToken(null);
                    setCapNonce((nonce) => nonce + 1);
                  }
                  const mineTitle = nav.me.title && nav.me.title !== '饼友' ? nav.me.title : '';
                  const filled = {
                    ...created,
                    authorName: created.authorName || nav.me.name,
                    authorTitle: created.authorTitle && created.authorTitle !== '饼友' ? created.authorTitle : mineTitle,
                    authorGroup: created.authorGroup || nav.me.groupLabel || '',
                    avatar: created.avatar.includes('/') ? created.avatar : (nav.me.avatarUrl || created.avatar),
                    authorId: created.authorId || nav.me.id,
                    uid: created.uid || nav.me.uid,
                    accent: created.accent || nav.me.accent,
                    parentId: created.parentId || replyTo?.id || null,
                    parentFloor: created.parentFloor || replyTo?.floor || null,
                  };
                  commentEditor.clear();
                  setReplyTo(null);
                  commentEditor.setEmojiOpen(false);
                  setComposerTools(false);
                  setJustPostedId(filled.id || null);
                  locatePostedRef.current = filled.id || null;
                  Keyboard.dismiss();
                  commentsQuery.setData((prev) => prev
                    ? { ...prev, items: [...prev.items, filled] }
                    : { items: [filled], nextCursor: null });
                  detail.setData((prev) => prev
                    ? { ...prev, topic: { ...prev.topic, replyCount: prev.topic.replyCount + 1 } }
                    : prev);
                  markTopicSeen(topic.id, (dto?.replyCount ?? current.replies) + 1);
                  nav.toast('评论已发布');
                  nav.patchMe({ replyCount: nav.me.replyCount + 1 });
                  void nav.refreshMe();
                } catch (err) {
                  nav.toast(err instanceof ApiError ? err.message : '评论失败');
                } finally {
                  setBusy(false);
                }
              }}
              style={[styles.commentSend, (busy || !comment.trim() || (replyCaptcha && !capToken)) && styles.commentSendOff]}
              accessibilityLabel="发布回复"
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="arrow-up" size={16} color="#fff" />
              )}
            </Pressable>
          </View>
        </View>
        {/* 上传面板是 Modal：放在编辑区之后，全屏时才不会被全屏 Modal 压住 */}
        {nav.loggedIn ? commentEditor.uploadManager : null}
      </View>
      )}
      </View>
      )}
      <DonateSheet
        visible={donateOpen}
        title={current.title}
        info={donateInfo}
        busy={donateBusy}
        onClose={() => setDonateOpen(false)}
        onSubmit={async (amount) => {
          setDonateBusy(true);
          try {
            const result = await api.donateTopic(topic.id, amount);
            setLiked(true);
            setLikeCount(result.likeCount);
            setDonateInfo((prev) => ({
              blocked: false,
              title: prev?.title || '点赞打赏',
              rewardPeople: (prev?.rewardPeople ?? 0) + (result.rewarded ? 1 : 0),
              likeCount: result.likeCount,
              totalPoints: (prev?.totalPoints ?? 0) + result.rewarded,
              balance: result.balance,
              presets: prev?.presets ?? [6, 10, 33, 66, 88],
            }));
            detail.setData((prev) => {
              if (!prev) return prev;
              const mine = {
                user: nav.me.name,
                text: result.rewarded ? `打赏 ${result.rewarded} 积分` : '点了个赞',
                amount: result.rewarded || null,
              };
              return {
                ...prev,
                barrage: result.barrage?.length ? result.barrage : [mine, ...prev.barrage],
                topic: { ...prev.topic, liked: true, likeCount: result.likeCount },
              };
            });
            if (result.rewarded) nav.patchMe({ points: result.balance });
            else if (result.balance) nav.patchMe({ points: result.balance });
            setDonateOpen(false);
            nav.toast(result.rewarded ? `打赏 ${result.rewarded} 积分` : (result.message || '点了个赞'));
          } catch (err) {
            nav.toast(err instanceof ApiError ? err.message : '操作失败');
            try {
              setDonateInfo(await api.donateInfo(topic.id));
            } catch {
              /* keep current sheet */
            }
          } finally {
            setDonateBusy(false);
          }
        }}
      />
      <ReplyReactSheet
        visible={Boolean(reactTarget)}
        authorName={reactTarget?.authorName || ''}
        tiers={reactTarget?.likeTiers?.length ? reactTarget.likeTiers : [1, 5, 10, 50]}
        busy={reactBusy}
        onClose={() => setReactTarget(null)}
        onSubmit={async (points) => {
          if (!reactTarget) return;
          setReactBusy(true);
          try {
            const result = await api.reactComment(topic.id, reactTarget.id, points);
            patchComment(reactTarget.id, { liked: result.liked, coined: result.coined, likeCount: result.likeCount });
            setReactTarget(null);
            nav.toast(result.message || (points > 0 ? `投币 ${points} 积分` : '点了个赞'));
            if (points > 0) void nav.refreshMe();
          } catch (err) {
            nav.toast(err instanceof ApiError ? err.message : '操作失败');
          } finally {
            setReactBusy(false);
          }
        }}
      />
      <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
      <ActionSheet items={commentMenu} onClose={() => setCommentMenu(null)} />
      <TopicAlbumSheet
        visible={albumOpen}
        items={albumItems}
        busy={albumBusy}
        name={albumName}
        onName={setAlbumName}
        onClose={() => setAlbumOpen(false)}
        onPick={(item) => { void submitAlbum({ collectionId: item.id, remove: item.included }); }}
        onCreate={() => { void submitAlbum({ name: albumName.trim() }); }}
        onMine={() => {
          setAlbumOpen(false);
          nav.open({ name: 'collections', tab: 'mine' });
        }}
      />
      <TopicShareModal
        visible={shareOpen}
        title={current.title}
        forum={current.forum}
        author={current.author}
        views={viewCount}
        replies={dto?.replyCount ?? current.replies}
        url={topicUrl}
        onClose={() => setShareOpen(false)}
        onOpenWeb={() => {
          setShareOpen(false);
          openTopicWeb();
        }}
        onCopy={async () => {
          await copyText(topicUrl);
          nav.toast('链接已复制');
        }}
        onShare={async () => {
          try {
            const result = await shareText(current.title, topicUrl);
            nav.toast(result === 'copied' ? '链接已复制' : '已分享');
          } catch {
            /* user cancelled share */
          }
        }}
        onReport={() => {
          setShareOpen(false);
          if (!requireLogin()) return;
          nav.open({
            name: 'report',
            targetType: 'topic',
            targetId: topic.id,
            targetUser: current.author,
            topicTitle: current.title,
          });
        }}
      />
      {gallery ? (
        <ImageGallery
          visible
          uris={gallery.uris}
          index={gallery.index}
          onClose={() => setGallery(null)}
        />
      ) : null}
    </View>
  );
}
