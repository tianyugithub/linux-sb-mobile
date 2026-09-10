import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mediaUrl } from '../services/client';
import { imageKey } from '../utils/article';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.4;

function displayUri(src: string) {
  return mediaUrl(src) ?? src;
}

function touchDistance(event: GestureResponderEvent) {
  const touches = event.nativeEvent.touches;
  if (touches.length < 2) return 0;
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}

function GalleryImage({
  src,
  width,
  height,
  active,
  onZoomChange,
  onDismiss,
  onTap,
}: {
  src: string;
  width: number;
  height: number;
  active: boolean;
  onZoomChange: (zoomed: boolean) => void;
  onDismiss: () => void;
  onTap: () => void;
}) {
  const proxied = displayUri(src);
  const [uri, setUri] = useState(proxied);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const scaleNum = useRef(1);
  const txNum = useRef(0);
  const tyNum = useRef(0);
  const pinchStart = useRef({ dist: 0, scale: 1 });
  const panStart = useRef({ x: 0, y: 0 });
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomedRef = useRef(false);
  const activeRef = useRef(active);
  const dismissRef = useRef(onDismiss);
  const tapRef = useRef(onTap);
  const zoomRef = useRef(onZoomChange);
  activeRef.current = active;
  dismissRef.current = onDismiss;
  tapRef.current = onTap;
  zoomRef.current = onZoomChange;

  const clampPan = useCallback((nextX: number, nextY: number, nextScale: number) => {
    const maxX = Math.max(0, ((nextScale - 1) * width) / 2);
    const maxY = Math.max(0, ((nextScale - 1) * height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, nextX)),
      y: Math.min(maxY, Math.max(-maxY, nextY)),
    };
  }, [width, height]);

  const applyScale = useCallback((next: number, zoomed?: boolean) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    scaleNum.current = clamped;
    scale.setValue(clamped);
    const isZoomed = clamped > 1.02;
    zoomedRef.current = isZoomed;
    if (activeRef.current) zoomRef.current(zoomed ?? isZoomed);
    if (!isZoomed) {
      txNum.current = 0;
      tyNum.current = 0;
      tx.setValue(0);
      ty.setValue(0);
    }
  }, [scale, tx, ty]);

  const reset = useCallback(() => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
    lastTap.current = 0;
    applyScale(1, false);
  }, [applyScale]);

  useEffect(() => {
    setUri(proxied);
    setFailed(false);
    setLoaded(false);
  }, [proxied, src]);

  useEffect(() => {
    if (!active) reset();
  }, [active, reset]);

  const animateTo = useCallback((nextScale: number, nextX = 0, nextY = 0) => {
    const pan = clampPan(nextX, nextY, nextScale);
    scaleNum.current = nextScale;
    txNum.current = pan.x;
    tyNum.current = pan.y;
    zoomedRef.current = nextScale > 1.02;
    if (activeRef.current) zoomRef.current(nextScale > 1.02);
    Animated.parallel([
      Animated.spring(scale, { toValue: nextScale, useNativeDriver: true, friction: 7, tension: 80 }),
      Animated.spring(tx, { toValue: pan.x, useNativeDriver: true, friction: 7, tension: 80 }),
      Animated.spring(ty, { toValue: pan.y, useNativeDriver: true, friction: 7, tension: 80 }),
    ]).start();
  }, [clampPan, scale, tx, ty]);

  const toggleZoom = useCallback(() => {
    if (scaleNum.current > 1.15) animateTo(1);
    else animateTo(DOUBLE_TAP_SCALE);
  }, [animateTo]);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = 0;
      toggleZoom();
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      tapRef.current();
    }, 280);
  }, [toggleZoom]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponder: (event, gesture) => {
      if (event.nativeEvent.touches.length >= 2) return true;
      if (zoomedRef.current) return Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3;
      return gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.15;
    },
    onMoveShouldSetPanResponderCapture: (event, gesture) => {
      if (event.nativeEvent.touches.length >= 2) return true;
      if (zoomedRef.current && (Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3)) return true;
      return !zoomedRef.current && gesture.dy > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.15;
    },
    onPanResponderTerminationRequest: () => !zoomedRef.current,
    onPanResponderGrant: (event) => {
      pinchStart.current = { dist: touchDistance(event), scale: scaleNum.current };
      panStart.current = { x: txNum.current, y: tyNum.current };
    },
    onPanResponderMove: (event, gesture) => {
      const dist = touchDistance(event);
      if (event.nativeEvent.touches.length >= 2 && dist > 8) {
        if (pinchStart.current.dist < 8) {
          pinchStart.current = { dist, scale: scaleNum.current };
        }
        const next = pinchStart.current.scale * (dist / pinchStart.current.dist);
        applyScale(next);
        const pan = clampPan(txNum.current, tyNum.current, scaleNum.current);
        txNum.current = pan.x;
        tyNum.current = pan.y;
        tx.setValue(pan.x);
        ty.setValue(pan.y);
        return;
      }
      if (zoomedRef.current) {
        const pan = clampPan(panStart.current.x + gesture.dx, panStart.current.y + gesture.dy, scaleNum.current);
        txNum.current = pan.x;
        tyNum.current = pan.y;
        tx.setValue(pan.x);
        ty.setValue(pan.y);
        return;
      }
      ty.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      if (scaleNum.current < 1.08) {
        if (gesture.dy > 90 || gesture.vy > 1.1) {
          dismissRef.current();
          return;
        }
        animateTo(1);
        return;
      }
      const pan = clampPan(txNum.current, tyNum.current, scaleNum.current);
      animateTo(Math.min(MAX_SCALE, Math.max(1.08, scaleNum.current)), pan.x, pan.y);
    },
  }), [animateTo, applyScale, clampPan, tx, ty]);

  const opacity = ty.interpolate({
    inputRange: [0, 220],
    outputRange: [1, 0.35],
    extrapolate: 'clamp',
  });

  if (failed) {
    return (
      <Pressable onPress={onTap} style={[styles.page, { width, height }]}>
        <Text style={styles.failText}>图片加载失败</Text>
        <Pressable
          onPress={() => {
            setFailed(false);
            setLoaded(false);
            setUri(displayUri(src));
          }}
          style={styles.retryBtn}
        >
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </Pressable>
    );
  }

  return (
    <View style={{ width, height }} {...responder.panHandlers}>
      <Pressable onPress={handleTap} style={[styles.page, { width, height }]}>
        {!loaded ? <ActivityIndicator color="#fff" style={styles.spinner} /> : null}
        <Animated.View style={{ opacity, transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}>
          <Image
            source={{ uri }}
            style={{ width, height }}
            resizeMode="contain"
            onLoad={() => setLoaded(true)}
            onError={() => {
              if (uri !== src) {
                setUri(src);
                return;
              }
              setFailed(true);
            }}
          />
        </Animated.View>
      </Pressable>
    </View>
  );
}

export function ImageGallery({
  uris,
  index,
  visible,
  onClose,
}: {
  uris: string[];
  index: number;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const listRef = useRef<FlatList<string>>(null);
  const thumbRef = useRef<ScrollView>(null);
  const [current, setCurrent] = useState(index);
  const [zoomed, setZoomed] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [hint, setHint] = useState(true);
  const startIndex = Math.min(Math.max(0, index), Math.max(0, uris.length - 1));

  useEffect(() => {
    if (!visible) return;
    setCurrent(startIndex);
    setZoomed(false);
    setChrome(true);
    setHint(true);
    const hintTimer = setTimeout(() => setHint(false), 2400);
    const jump = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: startIndex, animated: false });
    });
    return () => {
      clearTimeout(hintTimer);
      cancelAnimationFrame(jump);
    };
  }, [visible, startIndex, uris.join('\n')]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  useEffect(() => {
    if (!visible || uris.length < 2) return;
    const x = Math.max(0, current * 56 - width / 2 + 28);
    thumbRef.current?.scrollTo({ x, animated: true });
  }, [current, visible, uris.length, width]);

  const onScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width));
    if (next >= 0 && next < uris.length) setCurrent(next);
    setZoomed(false);
  }, [uris.length, width]);

  const jumpTo = useCallback((next: number) => {
    setCurrent(next);
    setZoomed(false);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  }, []);

  const renderItem = useCallback<ListRenderItem<string>>(({ item, index: itemIndex }) => (
    <GalleryImage
      src={item}
      width={width}
      height={height}
      active={visible && itemIndex === current}
      onZoomChange={setZoomed}
      onDismiss={onClose}
      onTap={() => {
        setChrome((value) => !value);
        setHint(false);
      }}
    />
  ), [current, height, onClose, visible, width]);

  if (!visible || !uris.length) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <FlatList
          ref={listRef}
          data={uris}
          horizontal
          pagingEnabled
          bounces={false}
          overScrollMode="never"
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, itemIndex) => `${imageKey(item)}-${itemIndex}`}
          getItemLayout={(_, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })}
          initialScrollIndex={startIndex}
          initialNumToRender={3}
          windowSize={3}
          maxToRenderPerBatch={3}
          onMomentumScrollEnd={onScrollEnd}
          onScrollToIndexFailed={({ index: failedIndex }) => {
            setTimeout(() => listRef.current?.scrollToIndex({ index: failedIndex, animated: false }), 50);
          }}
          extraData={`${current}-${zoomed}-${width}-${height}`}
          renderItem={renderItem}
        />
        {chrome ? (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 12) + 4 }]}>
              <Text style={styles.counter}>{current + 1} / {uris.length}</Text>
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel="关闭">
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
            </View>
            {hint ? (
              <Text style={[styles.hint, { bottom: Math.max(insets.bottom, 12) + (uris.length > 1 ? 78 : 28) }]}>
                {uris.length > 1 ? '左右滑动切换 · 双指缩放 · 下滑关闭' : '双指缩放 · 双击放大 · 下滑关闭'}
              </Text>
            ) : null}
            {uris.length > 1 ? (
              <ScrollView
                ref={thumbRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={[styles.thumbs, { bottom: Math.max(insets.bottom, 10) }]}
                contentContainerStyle={styles.thumbsInner}
              >
                {uris.map((item, itemIndex) => (
                  <Pressable key={`${imageKey(item)}-thumb-${itemIndex}`} onPress={() => jumpTo(itemIndex)}>
                    <Image
                      source={{ uri: displayUri(item) }}
                      style={[styles.thumb, itemIndex === current && styles.thumbOn]}
                    />
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  page: { alignItems: 'center', justifyContent: 'center' },
  spinner: { position: 'absolute' },
  failText: { color: 'rgba(255,255,255,0.82)', fontSize: 15, fontWeight: '700' },
  retryBtn: { marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.14)' },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: { color: '#fff', fontSize: 15, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    position: 'absolute',
    left: 16,
    right: 16,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.86)',
    fontSize: 13,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  thumbs: { position: 'absolute', left: 0, right: 0, maxHeight: 64 },
  thumbsInner: { paddingHorizontal: 14, alignItems: 'center' },
  thumb: { width: 48, height: 48, borderRadius: 6, marginRight: 8, backgroundColor: '#1a1a1a', borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: '#fff' },
});
