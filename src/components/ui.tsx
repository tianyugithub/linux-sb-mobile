import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type PanResponderGestureState,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { LinearGradient } from 'expo-linear-gradient';
import { SvgAst, fetchText, parse } from 'react-native-svg';
import type { IonName, Topic } from '../../data';
import type { CommentDto } from '../types/api';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { sanitizeSvgAst, sanitizeSvgXml, svgXmlToWebPage } from '../utils/svg-sanitize';
import { mediaUrl } from '../services/client';
import { useRemoteMedia } from '../hooks/useRemoteMedia';
import { decodeEntities, firstGlyph } from '../utils/entities';
import { stampToneForKind, topicStampByType } from '../data/topic-stamp';
import { chromePad, useAndroidBack, useAppInsets, useNav } from '../navigation/nav';
import { ContentSkeleton } from './ContentSkeleton';

export function commentPreview(body: string) {
  const text = decodeEntities(
    body
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

export function commentOwnedBy(item: CommentDto, me?: { id?: string; uid?: string } | null) {
  if (!me) return false;
  const mine = [me.id, me.uid].filter(Boolean);
  return mine.some((id) => id === item.authorId || id === item.uid);
}

export function EditNoteLine({
  editorName,
  editorId,
  editedAt,
  compact,
  onUser,
}: {
  editorName?: string;
  editorId?: string;
  editedAt?: string;
  compact?: boolean;
  onUser?: (id: string) => void;
}) {
  if (!editedAt && !editorName) return null;
  const who = editorName || '饼友';
  return (
    <Text style={[styles.editNote, compact && styles.editNoteCompact]}>
      最后由{' '}
      {editorId && onUser ? (
        <Text style={styles.editNoteName} onPress={() => onUser(editorId)}>{who}</Text>
      ) : (
        <Text style={styles.editNoteName}>{who}</Text>
      )}
      {' '}编辑于 {editedAt}
    </Text>
  );
}

export type DialogState = {
  title: string;
  text: string;
  confirmLabel?: string;
  /** 异步确认进行中时按钮/正文展示的进度，例如「正在下载 12%」。 */
  busyLabel?: string;
  danger?: boolean;
  rulesUrl?: string;
  onConfirm: () => void | Promise<void>;
};

export type SheetItem = { label: string; danger?: boolean; onPress: () => void };

export function Icon({ name, size = 18, color = C.muted }: { name: IonName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function webImg(
  src: string,
  style: Record<string, string | number | undefined>,
  onError?: () => void,
) {
  return React.createElement('img', {
    src,
    alt: '',
    onError,
    style: { display: 'block', objectFit: 'cover', ...style },
  });
}

export function pickUserId(...values: Array<string | number | null | undefined>): string {
  const keys = values.map((value) => String(value ?? '').trim()).filter((value) => value && value !== '0');
  return keys.find((value) => /^\d+$/.test(value)) || keys[0] || '';
}

/** 正文图 / 头像共用的 SVG 判定：RN 的 Image 解码不了 SVG，后缀与 data URI 都算。 */
export function isSvgUri(src?: string | null): boolean {
  if (!src) return false;
  const text = String(src).trim();
  if (!text) return false;
  if (/^data:image\/svg/i.test(text)) return true;
  return /\.svg(\?|#|$)/i.test(text);
}

// 站内默认头像是 SVG，RN 的 Image 解码不了。react-native-svg 的 SvgUri 每次挂载都会
// 重新 fetch + 在 JS 线程解析 XML，列表滚动和弹幕重挂载时代价很大（实测 JS 线程占
// 滚动 CPU 的 ~58%）。这里把解析结果 AST 按 URL 缓存在模块级，命中后同步渲染、零解析。
const SVG_AST_CACHE_MAX = 400;
type SvgNode = ReturnType<typeof parse>;
type SvgAstProp = Parameters<typeof SvgAst>[0]['ast'];
const svgAstCache = new Map<string, SvgNode>();
const svgAstInflight = new Map<string, Promise<SvgNode>>();

function rememberAst(uri: string, ast: SvgNode) {
  svgAstCache.set(uri, ast);
  if (svgAstCache.size > SVG_AST_CACHE_MAX) {
    const oldest = svgAstCache.keys().next().value;
    if (oldest !== undefined) svgAstCache.delete(oldest);
  }
}

const svgHtmlCache = new Map<string, string>();
const svgHtmlInflight = new Map<string, Promise<string>>();

function svgBaseUrl(uri: string): string {
  try {
    if (/^https?:\/\//i.test(uri)) return new URL(uri).origin + '/';
  } catch {
    /* ignore */
  }
  return 'https://linux.sb/';
}

function xmlFromSvgUri(uri: string): Promise<string> {
  const data = uri.match(/^data:image\/svg\+xml([^,]*),(.*)$/i);
  if (data) {
    try {
      const xml = /;base64/i.test(data[1])
        ? globalThis.atob(data[2])
        : decodeURIComponent(data[2]);
      return Promise.resolve(xml);
    } catch {
      return Promise.reject(new Error('bad data svg'));
    }
  }
  return fetchText(uri).then((xml) => {
    if (!xml) throw new Error('empty svg');
    return xml;
  });
}

function loadSvgPage(uri: string): Promise<string> {
  const cached = svgHtmlCache.get(uri);
  if (cached) return Promise.resolve(cached);
  const pending = svgHtmlInflight.get(uri);
  if (pending) return pending;
  const task = xmlFromSvgUri(uri)
    .then((xml) => {
      if (!xml) throw new Error('empty svg');
      const page = svgXmlToWebPage(xml);
      svgHtmlCache.set(uri, page);
      if (svgHtmlCache.size > SVG_AST_CACHE_MAX) {
        const oldest = svgHtmlCache.keys().next().value;
        if (oldest !== undefined) svgHtmlCache.delete(oldest);
      }
      return page;
    })
    .finally(() => {
      svgHtmlInflight.delete(uri);
    });
  svgHtmlInflight.set(uri, task);
  return task;
}

function loadSvgAst(uri: string): Promise<SvgNode> {
  const cached = svgAstCache.get(uri);
  if (cached) return Promise.resolve(cached);
  const pending = svgAstInflight.get(uri);
  if (pending) return pending;
  const task = fetchText(uri)
    .then((xml) => {
      if (!xml) throw new Error('empty svg');
      // parse() 会立刻把子节点收成 React 元素；嵌套 <g><path d="…NaN"> 必须在
      // 进 parse 之前洗 XML 属性，并用 middleware 在 XmlAST 上再洗一遍。
      const ast = parse(sanitizeSvgXml(xml), (root) => sanitizeSvgAst(root));
      if (!ast) throw new Error('empty svg ast');
      rememberAst(uri, ast);
      return ast;
    })
    .finally(() => {
      svgAstInflight.delete(uri);
    });
  svgAstInflight.set(uri, task);
  return task;
}

export function RowSeparator() {
  return <View style={styles.separator} />;
}

export function SvgAvatar({ uri, size, onError }: { uri: string; size: number; onError?: () => void }) {
  const [ast, setAst] = useState<SvgNode | null>(() => svgAstCache.get(uri) ?? null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    const cached = svgAstCache.get(uri);
    if (cached) {
      setAst(cached);
      return;
    }
    setAst(null);
    let alive = true;
    loadSvgAst(uri)
      .then((next) => {
        if (alive) setAst(next);
      })
      .catch(() => {
        if (alive) onErrorRef.current?.();
      });
    return () => {
      alive = false;
    };
  }, [uri]);
  if (!ast) return null;
  return <SvgAst ast={ast as unknown as SvgAstProp} override={{ width: size, height: size }} />;
}

/**
 * 正文 / 大图用 WebView 内联 SVG：浏览器会播 SMIL / CSS 动画，也不会走
 * react-native-svg 的原生 Path（动画 SVG 在 setD 里会闪退，播不了动画）。
 * 头像仍用 SvgAst（静态小图，列表里不能每个都挂 WebView）。
 */
export function SvgBlockImage({
  uri,
  style,
  onError,
  onLoad,
}: {
  uri: string;
  style?: object;
  onError?: () => void;
  onLoad?: () => void;
}) {
  const [page, setPage] = useState<string | null>(() => svgHtmlCache.get(uri) ?? null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  useEffect(() => {
    const cached = svgHtmlCache.get(uri);
    if (cached) {
      setPage(cached);
      onLoadRef.current?.();
      return;
    }
    setPage(null);
    let alive = true;
    loadSvgPage(uri)
      .then((next) => {
        if (!alive) return;
        setPage(next);
        onLoadRef.current?.();
      })
      .catch(() => {
        if (alive) onErrorRef.current?.();
      });
    return () => {
      alive = false;
    };
  }, [uri]);
  if (!page) return <View style={style} />;
  return (
    <View style={style} pointerEvents="none">
      <WebView
        source={{ html: page, baseUrl: svgBaseUrl(uri) }}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        originWhitelist={['*']}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        scrollEnabled={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        setBuiltInZoomControls={false}
        androidLayerType="hardware"
        onHttpError={() => onErrorRef.current?.()}
        onError={() => onErrorRef.current?.()}
      />
    </View>
  );
}

export function UserAvatar({
  name,
  url,
  accent,
  size = 34,
  radius,
  online,
  dotRing,
}: {
  name: string;
  url?: string;
  accent: string;
  size?: number;
  radius?: number;
  online?: boolean;
  /** 在线圆点的描边色：默认页面底色；头像坐在卡片/浅色底上时传所在背景色，圆点才不会像贴了白边。 */
  dotRing?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = mediaUrl(url);
  // 站内默认头像是 SVG，RN 的 Image 解码不了，必须用 react-native-svg 渲染。
  const isSvg = isSvgUri(src);
  const resolved = useRemoteMedia(isSvg ? undefined : src);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  const r = radius ?? 7;
  const letter = firstGlyph(name, '?');
  const showImage = Boolean(isSvg ? src : resolved) && !failed;
  const dot = size >= 40 ? 12 : 10;
  /**
   * 在线圆点的位置。
   *
   * 圆形头像（radius = size/2）不能按方框右下角摆：方框的角在圆外，尺寸一大圆点就看着
   * 浮在头像外面、压着描边（「我的」和用户中心都是 60/64px 的圆，就是这个毛病）。
   * 圆形时把圆心放在圆周 45° 处（0.146·size ≈ 半径 − 半径/√2），圆角方形仍贴方角。
   */
  const circular = r >= size / 2 - 0.5;
  const dotInset = circular ? Math.round(size * 0.146 - dot / 2) : -1;
  return (
    <View style={[styles.avatarWrap, { width: size, height: size }]}>
      <View style={[styles.avatar, { width: size, height: size, borderRadius: r, backgroundColor: accent }]}>
        {showImage ? (
          isSvg ? (
            <SvgAvatar uri={src as string} size={size} onError={() => setFailed(true)} />
          ) : Platform.OS === 'web' ? (
            webImg(src!, { width: size, height: size, borderRadius: r }, () => setFailed(true))
          ) : (
            <Image source={{ uri: resolved ?? src }} style={{ width: size, height: size, borderRadius: r }} onError={() => setFailed(true)} />
          )
        ) : (
          <Text style={[styles.avatarText, size >= 50 && styles.profileAvatarText]}>{letter}</Text>
        )}
      </View>
      {online ? (
        <View
          style={[
            styles.online,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              bottom: dotInset,
              right: dotInset,
              borderColor: dotRing ?? C.canvas,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  compact,
  block,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  compact?: boolean;
  block?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.primaryBtn, compact && styles.primaryBtnCompact, block && styles.primaryBtnBlock, disabled && styles.primaryBtnDisabled]}>
      <Text style={[styles.primaryBtnText, compact && styles.primaryBtnTextCompact]}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({ label, onPress, icon, flex }: { label: string; onPress?: () => void; icon?: IonName; flex?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.ghostBtn, flex && styles.ghostBtnFlex]}>
      {icon ? <Icon name={icon} size={16} color={C.text} /> : null}
      <Text style={styles.ghostBtnText}>{label}</Text>
    </Pressable>
  );
}

export function Logo() {
  return (
    <View style={styles.logoRow}>
      <View style={styles.logoMarkWrap}>
        <Image source={require('../../assets/icon.png')} style={styles.logoMark} resizeMode="contain" />
      </View>
      <Text style={styles.logoText}>LINUX SB</Text>
    </View>
  );
}

export function IconButton({ name, onPress, badge }: { name: IonName; onPress?: () => void; badge?: number }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      pressRetentionOffset={12}
      android_ripple={{ color: C.line, borderless: true, radius: 20 }}
      style={styles.iconButton}
      accessibilityRole="button"
    >
      <Icon name={name} size={22} color={C.muted} />
      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
    </Pressable>
  );
}

export function CompactTag({
  children,
  tone = 'default',
  accessibilityLabel,
}: {
  children: React.ReactNode;
  tone?: 'default' | 'danger' | 'warning' | 'success' | 'info' | 'essence' | 'essenceNeg';
  accessibilityLabel?: string;
}) {
  const toneStyle = tone === 'danger' ? styles.compactTagDanger
    : tone === 'warning' ? styles.compactTagWarning
      : tone === 'success' ? styles.compactTagSuccess
        : tone === 'info' ? styles.compactTagInfo
          : tone === 'essenceNeg' ? styles.compactTagEssenceNeg
            : tone === 'essence' ? styles.compactTagEssence
              : styles.compactTagDefault;
  const pill = tone === 'essence' || tone === 'essenceNeg';
  const textStyle = tone === 'essenceNeg' ? styles.compactTagTextEssenceNeg
    : tone === 'essence' ? styles.compactTagTextEssence
      : tone === 'danger' ? styles.compactTagTextDanger
        : tone === 'warning' ? styles.compactTagTextWarning
          : tone === 'success' ? styles.compactTagTextSuccess
            : tone === 'info' ? styles.compactTagTextInfo
              : styles.compactTagText;
  return (
    <View style={[styles.compactTag, pill && styles.compactTagPill, toneStyle]} accessibilityLabel={accessibilityLabel}>
      <Text style={textStyle}>{children}</Text>
    </View>
  );
}

export function topicTagList(topic: Topic): { type: string; label: string; kind?: string; title?: string }[] {
  if (topic.tags?.length) return topic.tags;
  const tags: { type: string; label: string; kind?: string; title?: string }[] = [];
  if (topic.status === '置顶') tags.push({ type: 'pinned', label: '置顶' });
  else if (topic.status && /抽奖/.test(topic.status)) tags.push({ type: 'lottery', label: topic.status });
  else if (topic.status && /发卡/.test(topic.status)) tags.push({ type: 'card', label: topic.status });
  else if (topic.status) tags.push({ type: 'pinned', label: topic.status });
  if (topic.featured) tags.push({ type: 'featured', label: '精华' });
  if (topic.heat) tags.push({ type: 'hot', label: '热' });
  return tags;
}

// 官方 topic_stamp 的配色：荐=success、精=danger、热=warning、新=info（见 data/topic-stamp.ts），
// 其余沿用标签自身语义（精华/抽奖/置顶=warning，发卡=success）。
export function stampTone(type: string, label?: string, kind?: string): 'default' | 'danger' | 'warning' | 'success' | 'info' | 'essence' | 'essenceNeg' {
  if (type === 'apply_featured') return /申精\s*-|\s-\d+\s*\//.test(label || '') ? 'essenceNeg' : 'essence';
  // 印章：已知种类按官方 CSS，未知种类用从官方样式表学到的色调（还没学到就是灰）
  const stampKind = kind ?? (type === 'stamp' || topicStampByType(type) ? type : '');
  if (stampKind) return stampToneForKind(stampKind);
  if (type === 'card') return 'success';
  // 红包帖：官网标题旁的「红包帖」是红底（--danger-soft / --danger）
  if (type === 'red_packet') return 'danger';
  if (type === 'lottery' && label && /已开奖|结束/.test(label)) return 'success';
  if (type === 'featured' || type === 'lottery' || type === 'pinned') return 'warning';
  return 'default';
}

export function stampLabel(tag: { type: string; label: string }) {
  return tag.type === 'featured' ? '精' : tag.label;
}

export function FilterBar<T extends string>({ items, value, onChange, right }: { items: readonly T[]; value: T; onChange: (value: T) => void; right?: React.ReactNode }) {
  return (
    <View style={styles.filterBar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterContent}>
        {items.map((item) => (
          <Pressable key={item} onPress={() => onChange(item)} style={[styles.sortTab, value === item && styles.sortTabActive]}>
            <Text numberOfLines={1} style={[styles.sortText, value === item && styles.sortTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {right}
    </View>
  );
}

export function StatusBlock({ loading, error, onRetry, empty, emptyTitle, emptyCopy }: { loading?: boolean; error?: string | null; onRetry?: () => void; empty?: boolean; emptyTitle?: string; emptyCopy?: string; skeleton?: boolean }) {
  if (loading) {
    return <ContentSkeleton />;
  }
  if (error) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{error}</Text>
        {onRetry ? <PrimaryButton label="重试" onPress={onRetry} /> : null}
      </View>
    );
  }
  if (empty) {
    return <View style={styles.empty}><Icon name="file-tray-outline" size={34} color={C.dim} /><Text style={styles.emptyTitle}>{emptyTitle ?? '暂时没有内容'}</Text>{emptyCopy ? <Text style={styles.emptyCopy}>{emptyCopy}</Text> : null}</View>;
  }
  return null;
}

export function ConfirmDialog({ dialog, onClose }: { dialog: DialogState | null; onClose: () => void }) {
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  useAndroidBack(Boolean(dialog) && !busy, onClose);
  useEffect(() => {
    if (!dialog) setBusy(false);
  }, [dialog]);
  if (!dialog) return null;
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <View style={styles.confirmModalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={busy ? undefined : onClose} />
        <View style={[styles.confirmPanel, { backgroundColor: C.surface, borderColor: C.line }]}>
          <View style={styles.confirmHead}>
            <Text style={[styles.confirmTitle, { color: C.text }]}>{dialog.title}</Text>
            <Pressable disabled={busy} onPress={onClose} hitSlop={8} accessibilityLabel="关闭">
              <Text style={styles.confirmClose}>×</Text>
            </Pressable>
          </View>
          <View style={styles.confirmBody}>
            <Text style={[styles.confirmMessage, { color: C.text }]}>{dialog.text}</Text>
            {busy && dialog.busyLabel ? (
              <Text style={[styles.confirmMessage, { color: C.muted }]}>{dialog.busyLabel}</Text>
            ) : null}
            {dialog.rulesUrl ? (
              <Pressable onPress={() => nav.openWeb(dialog.rulesUrl!, '积分规则')} hitSlop={6}>
                <Text style={styles.confirmRules}>查看详细积分规则 →</Text>
              </Pressable>
            ) : null}
            <View style={styles.confirmActions}>
              <GhostButton label="取消" onPress={busy ? undefined : onClose} />
              <PrimaryButton
                label={busy ? (dialog.busyLabel || '下载中') : (dialog.confirmLabel ?? '确定')}
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await dialog.onConfirm();
                    onClose();
                  } catch {
                    setBusy(false);
                  }
                }}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ActionSheet({ items, onClose, title }: { items: SheetItem[] | null; onClose: () => void; title?: string }) {
  const insets = useAppInsets();
  const [rows, setRows] = useState<SheetItem[]>([]);
  const [open, setOpen] = useState(false);
  const [screenHeight] = useState(() => Dimensions.get('window').height);
  // 内容是否放得下：放得下时关掉列表滚动，避免原生 ScrollView 抢走下拉手势
  const [listHeight, setListHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const fits = listHeight > 0 && contentHeight <= listHeight + 1;

  const translateY = useRef(new Animated.Value(0)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const scrollY = useRef(0);

  const requested = Boolean(items?.length);
  const openRef = useRef(false);
  openRef.current = open;
  const requestedRef = useRef(requested);
  requestedRef.current = requested;

  useEffect(() => {
    if (items?.length) setRows(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // 依赖布尔值而不是 items 数组：父组件每次渲染都会生成新数组，
  // 依赖数组会导致开合动画被反复重放。
  useEffect(() => {
    if (requested) {
      translateY.stopAnimation();
      backdrop.stopAnimation();
      scrollY.current = 0;
      translateY.setValue(screenHeight);
      backdrop.setValue(0);
      setOpen(true);
      Animated.parallel([
        Animated.timing(backdrop, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.spring(translateY, { toValue: 0, damping: 24, stiffness: 240, mass: 0.9, useNativeDriver: false }),
      ]).start();
      return;
    }
    if (!openRef.current) return;
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 0, duration: 160, useNativeDriver: false }),
      Animated.timing(translateY, { toValue: screenHeight, duration: 190, useNativeDriver: false }),
    ]).start(() => {
      // 关闭动画期间用户又打开了，就不要把面板关掉
      if (!requestedRef.current) setOpen(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  const close = () => closeRef.current();

  const drag = {
    onPanResponderMove: (_event: unknown, gesture: PanResponderGestureState) => {
      if (gesture.dy > 0) translateY.setValue(gesture.dy);
    },
    onPanResponderRelease: (_event: unknown, gesture: PanResponderGestureState) => {
      if (gesture.dy > 90 || gesture.vy > 0.7) {
        close();
        return;
      }
      Animated.spring(translateY, { toValue: 0, damping: 24, stiffness: 240, useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateY, { toValue: 0, damping: 24, stiffness: 240, useNativeDriver: false }).start();
    },
  };

  // 顶部抓手：触摸一开始就接管，和列表滚动没有任何竞争，100% 可拖
  const headerPan = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!headerPan.current) {
    headerPan.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      ...drag,
    });
  }
  // 列表区域：仅在内容放不下时让列表自己滚；放得下时整块面板都能拖
  const panelPan = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!panelPan.current) {
    panelPan.current = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) => (
        !fits
          ? false
          : gesture.dy > 3 && Math.abs(gesture.dy) > Math.abs(gesture.dx) && scrollY.current <= 0.5
      ),
      ...drag,
    });
  }

  useAndroidBack(open, close);
  if (!open) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={close}
    >
      <View style={styles.sheetRoot} pointerEvents="box-none">
        <Animated.View style={[styles.modalBackdrop, { opacity: backdrop }]}>
          <Pressable style={styles.sheetBackdropHit} onPress={close} accessibilityLabel="关闭" />
        </Animated.View>
        <Animated.View
          {...panelPan.current.panHandlers}
          style={[
            styles.sheetPanel,
            { paddingBottom: Math.max(insets.bottom, 8), transform: [{ translateY }] },
          ]}
        >
          <View style={styles.sheetGrabberWrap} {...headerPan.current.panHandlers}>
            <View style={styles.sheetGrabber} />
            {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
          </View>
          <ScrollView
            bounces={false}
            scrollEnabled={!fits}
            onScroll={(event) => { scrollY.current = event.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
            onLayout={(event) => setListHeight(event.nativeEvent.layout.height)}
            onContentSizeChange={(_width, height) => setContentHeight(height)}
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
          >
            {rows.map((item) => (
              <Pressable
                key={item.label}
                onPress={() => { close(); item.onPress(); }}
                style={styles.sheetRow}
              >
                <Text style={[styles.sheetRowText, item.danger && styles.sheetRowDanger]}>{item.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={close} style={styles.sheetCancel}>
            <Text style={styles.sheetCancelText}>取消</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function ToastHost({ message, offset }: { message: string | null; offset: number }) {
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.toastWrap, { bottom: offset }]}>
      <View style={[styles.toast, { backgroundColor: C.toastBg, borderColor: C.line }]}>
        <Text style={[styles.toastText, { color: C.toastFg }]}>{message}</Text>
      </View>
    </View>
  );
}

export function ListFooter({ loadingMore, hasMore, count }: { loadingMore?: boolean; hasMore?: boolean; count: number }) {
  if (!count) return null;
  if (loadingMore) return <ContentSkeleton variant="footer" />;
  if (!hasMore) return <Text style={styles.listFooter}>没有更多了</Text>;
  return null;
}

/** hero 里的一格数字。 */
export type HubAward = { label: string; value: string | number };

/**
 * 把 awards 切成每行 `perRow` 格。
 *
 * 为什么要切：4 格挤一行时每格只剩 ~50pt，「+1355」会折成两行（真踩过）。
 * 超过 3 格就改 2×2，数字有地方站。
 */
function chunkAwards(awards: readonly HubAward[], perRow: number): HubAward[][] {
  const rows: HubAward[][] = [];
  for (let index = 0; index < awards.length; index += perRow) {
    rows.push(awards.slice(index, index + perRow));
  }
  return rows;
}

export function HubHero({
  kicker,
  title,
  lead,
  icon,
  mark,
  colors,
  awards,
  children,
}: {
  kicker: string;
  title: string;
  lead?: string;
  icon?: IonName;
  mark?: React.ReactNode;
  colors: readonly [string, string, ...string[]];
  /** 底部数字格；3 格以内一行，4 格以上自动 2×2。 */
  awards?: readonly HubAward[];
  children?: React.ReactNode;
}) {
  return (
    <LinearGradient colors={[...colors]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hubHero}>
      <View style={styles.hubHeroTop}>
        <View style={styles.hubHeroCopy}>
          <Text style={styles.hubKicker}>{kicker}</Text>
          <Text style={styles.hubHeroTitle}>{title}</Text>
        </View>
        <View style={[styles.hubHeroIcon, mark ? { backgroundColor: 'transparent' } : null]}>
          {mark ?? (icon ? <Icon name={icon} size={26} color="#fff" /> : null)}
        </View>
      </View>
      {lead ? <Text style={styles.hubHeroLead}>{lead}</Text> : null}
      {awards?.length ? (
        <View style={styles.hubAwardRows}>
          {chunkAwards(awards, awards.length > 3 ? 2 : awards.length).map((row, index) => (
            <View key={index} style={styles.hubAwardRow}>
              {row.map((award) => (
                <View key={award.label} style={styles.hubAward}>
                  <Text style={styles.hubAwardLabel} numberOfLines={1}>{award.label}</Text>
                  <Text
                    style={styles.hubAwardValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                  >
                    {award.value}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {children}
    </LinearGradient>
  );
}

export function HubChips<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.hubChipRow}>
      {items.map((item) => {
        const on = item === value;
        return (
          <Pressable key={item} onPress={() => onChange(item)} style={[styles.hubChip, on && styles.hubChipOn]}>
            <Text style={[styles.hubChipText, on && styles.hubChipTextOn]}>{item}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsRow({
  icon,
  title,
  subtitle,
  value,
  chevron,
  danger,
  onPress,
  disabled,
}: {
  icon: IonName;
  title: string;
  subtitle?: string;
  value?: string;
  chevron?: boolean;
  danger?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.settingsRow, !subtitle && styles.settingsRowMid]}
    >
      <View style={[styles.settingsIcon, !subtitle && styles.settingsIconMid]}>
        <Icon name={icon} size={16} color={danger ? C.redBright : C.text} />
      </View>
      <View style={styles.settingsMain}>
        <View style={styles.settingsTop}>
          <Text numberOfLines={1} style={[styles.settingsTitle, danger && { color: C.redBright }]}>{title}</Text>
          {value ? <Text numberOfLines={1} style={styles.settingsValue}>{value}</Text> : null}
          {chevron ? <Icon name="chevron-forward" size={16} color={C.dim} /> : null}
        </View>
        {subtitle ? <Text style={styles.settingsSub}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

export function ScreenHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  const nav = useNav();
  const insets = useAppInsets();
  return (
    <View style={[styles.detailHeader, chromePad(insets.top)]} collapsable={false}>
      <View style={styles.headerSide} collapsable={false} pointerEvents="auto">
        <IconButton name="chevron-back" onPress={onBack ?? nav.close} />
      </View>
      <View style={styles.detailHeaderTitleWrap} pointerEvents="none">
        <Text numberOfLines={1} style={styles.detailHeaderTitle}>{title}</Text>
      </View>
      <View style={styles.headerSideRight} collapsable={false} pointerEvents="auto">
        {right ?? <View style={styles.headerSpacer} />}
      </View>
    </View>
  );
}
