import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TITLE_SHINE_ENABLED } from '../theme/title-fx';
import { useAppActive } from '../hooks/useAppActive';

const CYCLE_MS = 4200;
const SWEEP_MS = 1100;

export function TitleShine({ gold = false, enabled = true }: { gold?: boolean; enabled?: boolean }) {
  if (!TITLE_SHINE_ENABLED || !enabled) return null;
  return <TitleShineAnim gold={gold} />;
}

function TitleShineAnim({ gold = false }: { gold?: boolean }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const sparkle = useRef(new Animated.Value(0)).current;
  const widthRef = useRef(72);
  const [width, setWidth] = useState(72);
  const appActive = useAppActive();

  useEffect(() => {
    if (!appActive) return;
    let stopped = false;
    // 一个周期里只动画约 1s：之前扫光 + 星光两条动画各自无限循环，
    // 详情页十几枚徽章会让 RenderThread 一直满负荷（实测 50%+ CPU）。
    const play = () => {
      if (stopped) return;
      sweep.setValue(0);
      sparkle.setValue(0);
      const rest = Math.max(0, CYCLE_MS - SWEEP_MS);
      const before = Math.round(rest * 0.5);
      const after = rest - before;
      Animated.parallel([
        Animated.sequence([
          Animated.delay(before),
          Animated.timing(sweep, {
            toValue: 1,
            duration: SWEEP_MS,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(after),
        ]),
        Animated.sequence([
          Animated.delay(before),
          Animated.timing(sparkle, {
            toValue: 1,
            duration: SWEEP_MS,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.delay(after),
        ]),
      ]).start(({ finished }) => {
        if (finished && !stopped) play();
      });
    };
    play();
    return () => {
      stopped = true;
      sweep.stopAnimation();
      sparkle.stopAnimation();
    };
  }, [appActive, sweep, sparkle]);

  const band = Math.max(28, Math.round(width * 0.38));
  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-band * 1.8, band * 5.2],
  });
  const mid = gold ? 'rgba(255, 236, 179, 0.78)' : 'rgba(255, 255, 255, 0.68)';
  const star = gold ? 'rgba(255, 236, 179, 0.95)' : 'rgba(255, 255, 255, 0.92)';

  return (
    <View
      pointerEvents="none"
      collapsable={false}
      style={styles.clip}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next > 0 && next !== widthRef.current) {
          widthRef.current = next;
          setWidth(next);
        }
      }}
    >
      <Animated.View
        style={[
          styles.band,
          {
            left: -width * 0.45,
            width: band,
            transform: [{ translateX }, { skewX: '-32deg' }],
          },
        ]}
      >
        <LinearGradient
          colors={['transparent', mid, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fill}
        />
      </Animated.View>
      <Star sparkle={sparkle} color={star} left="16%" top="18%" size={5} from={0.02} peak={0.1} to={0.2} />
      <Star sparkle={sparkle} color={star} left="62%" top="22%" size={4} from={0.28} peak={0.38} to={0.5} />
      <Star sparkle={sparkle} color={star} left="38%" top="58%" size={3.5} from={0.55} peak={0.66} to={0.78} />
    </View>
  );
}

function Star({
  sparkle,
  color,
  left,
  top,
  size,
  from,
  peak,
  to,
}: {
  sparkle: Animated.Value;
  color: string;
  left: `${number}%`;
  top: `${number}%`;
  size: number;
  from: number;
  peak: number;
  to: number;
}) {
  const opacity = sparkle.interpolate({
    inputRange: [0, from, peak, to, 1],
    outputRange: [0, 0, 1, 0, 0],
  });
  const scale = sparkle.interpolate({
    inputRange: [0, from, peak, to, 1],
    outputRange: [0.35, 0.35, 1, 0.35, 0.35],
  });
  const arm = Math.max(1.2, size * 0.22);
  return (
    <Animated.View
      style={[
        styles.star,
        { left, top, width: size, height: size, opacity, transform: [{ scale }] },
      ]}
    >
      <View style={{ position: 'absolute', left: (size - arm) / 2, top: 0, width: arm, height: size, backgroundColor: color, borderRadius: arm }} />
      <View style={{ position: 'absolute', left: 0, top: (size - arm) / 2, width: size, height: arm, backgroundColor: color, borderRadius: arm }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  band: { position: 'absolute', top: -18, bottom: -18 },
  fill: { flex: 1 },
  star: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
