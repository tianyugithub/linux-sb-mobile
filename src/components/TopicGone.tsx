import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
import { getPalette, registerStyleSync, type Palette } from '../theme/palette';
import { useAppActive } from '../hooks/useAppActive';

export function topicErrorKind(message?: string | null): 'gone' | 'net' {
  const text = message || '';
  if (/超时|网络|连接|无法连接|linux\.sb 返回 5/.test(text)) return 'net';
  if (/删除|不存在|404|找不到/.test(text)) return 'gone';
  return 'net';
}

const COPY = {
  gone: { title: '烧饼被叼走了', hint: '这篇帖子可能已经删除', retry: '再找找看' },
  net: { title: '烧饼还在路上', hint: '网络不太稳，过一会儿再试试', retry: '重试' },
};

const BODY = 'M 100 52 A 72 72 0 1 1 99.9 52 Z M 162 78 A 34 34 0 1 1 161.9 78 Z';

function CartoonShaobing({ blink, waiting }: { blink: boolean; waiting: boolean }) {
  const eyeRy = blink ? 1.8 : 11;
  return (
    <Svg width={220} height={220} viewBox="0 0 220 220">
      <Defs>
        <ClipPath id="shaobingBody">
          <Path fillRule="evenodd" d={BODY} />
        </ClipPath>
        <ClipPath id="shaobingDisk">
          <Circle cx="100" cy="124" r="72" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#shaobingDisk)">
        <Circle cx="162" cy="78" r="34" fill="#FFE7B0" />
        <Circle cx="162" cy="78" r="24" fill="#F5C56B" />
        <Circle cx="162" cy="78" r="13" fill="#FFEFD0" />
      </G>
      <Path
        d={BODY}
        fill="#F3A53C"
        fillRule="evenodd"
        stroke="#6B3210"
        strokeWidth={6}
        strokeLinejoin="round"
      />
      <G clipPath="url(#shaobingBody)">
        <Ellipse cx="78" cy="92" rx="38" ry="18" fill="#FFC56A" opacity={0.55} />
        {[
          [64, 86], [88, 78], [72, 108], [52, 118], [84, 128],
          [58, 146], [90, 150], [112, 138], [46, 96], [118, 108],
          [70, 164], [98, 96],
        ].map(([x, y], i) => (
          <Ellipse
            key={i}
            cx={x}
            cy={y}
            rx={i % 3 === 0 ? 5.2 : 4.2}
            ry={i % 2 === 0 ? 3.2 : 2.6}
            fill="#FFF6E4"
            stroke="#C47A28"
            strokeWidth={1.2}
            transform={`rotate(${i * 28} ${x} ${y})`}
          />
        ))}
        <Ellipse cx="76" cy="132" rx="11" ry="7" fill="#FF8B78" opacity={0.45} />
        <Ellipse cx="114" cy="130" rx="11" ry="7" fill="#FF8B78" opacity={0.45} />
        <Ellipse cx="80" cy="118" rx="10" ry={eyeRy} fill="#2A160C" />
        <Ellipse cx="112" cy="116" rx="10" ry={eyeRy} fill="#2A160C" />
        {blink ? null : (
          <>
            <Circle cx="84" cy="114" r="3.2" fill="#FFF" />
            <Circle cx="116" cy="112" r="3.2" fill="#FFF" />
          </>
        )}
        {waiting ? (
          <Path
            d="M92 148 Q100 142 108 148"
            stroke="#2A160C"
            strokeWidth={3.4}
            strokeLinecap="round"
            fill="none"
          />
        ) : (
          <Path
            d="M90 150 Q100 160 112 148"
            stroke="#2A160C"
            strokeWidth={3.4}
            strokeLinecap="round"
            fill="none"
          />
        )}
      </G>
      <Path
        d="M136 62 A34 34 0 0 1 184 92"
        stroke="#6B3210"
        strokeWidth={6}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

function CartoonPaper() {
  return (
    <Svg width={86} height={102} viewBox="0 0 86 102">
      <Path
        d="M10 8 H68 Q78 8 78 18 V88 Q78 96 70 96 H16 Q8 96 8 88 V16 Q8 8 10 8 Z"
        fill="#FFF8EA"
        stroke="#C48A3A"
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <Path d="M58 8 L78 28 H66 Q58 28 58 20 Z" fill="#F3D9A4" stroke="#C48A3A" strokeWidth={3} />
      {[34, 50, 66, 82].map((y) => (
        <Path key={y} d={`M20 ${y} H64`} stroke="#E5CFA8" strokeWidth={3} strokeLinecap="round" />
      ))}
    </Svg>
  );
}

function CartoonCrumb({
  delay,
  start,
  active,
}: {
  delay: number;
  start: { x: number; y: number };
  active: boolean;
}) {
  const fly = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      fly.stopAnimation();
      fly.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(fly, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(fly, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
        Animated.delay(1400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, delay, fly]);
  const x = fly.interpolate({ inputRange: [0, 1], outputRange: [0, 22] });
  const y = fly.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, -28, 18] });
  const rot = fly.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '80deg'] });
  const op = fly.interpolate({ inputRange: [0, 0.12, 0.75, 1], outputRange: [0, 1, 1, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        gone.crumbWrap,
        {
          left: start.x,
          top: start.y,
          opacity: op,
          transform: [{ translateX: x }, { translateY: y }, { rotate: rot }],
        },
      ]}
    >
      <View style={gone.crumb} />
    </Animated.View>
  );
}

function CartoonPoof({ active }: { active: boolean }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      pop.stopAnimation();
      pop.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pop, {
          toValue: 1,
          duration: 620,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        }),
        Animated.timing(pop, {
          toValue: 0,
          duration: 280,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(2200),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pop]);
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const op = pop.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0, 1, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[gone.poof, { opacity: op, transform: [{ scale }] }]}
    >
      <View style={[gone.cloud, gone.cloudA]} />
      <View style={[gone.cloud, gone.cloudB]} />
      <View style={[gone.cloud, gone.cloudC]} />
    </Animated.View>
  );
}

export function TopicGone({
  message,
  onRetry,
}: {
  message?: string | null;
  onRetry?: () => void;
}) {
  const kind = topicErrorKind(message);
  const copy = COPY[kind];
  const hint = kind === 'gone' && message && /删除|不存在/.test(message) ? message : copy.hint;
  const appActive = useAppActive();
  const [blink, setBlink] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const squash = useRef(new Animated.Value(0)).current;
  const paper = useRef(new Animated.Value(0)).current;
  const mark = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(enter, { toValue: 1, friction: 6, tension: 72, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(420),
        Animated.spring(mark, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
      ]),
    ]).start();
  }, [enter, mark]);

  useEffect(() => {
    if (!appActive) {
      setBlink(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(() => {
        setBlink(true);
        timer = setTimeout(() => {
          setBlink(false);
          tick();
        }, 150);
      }, 2400);
    };
    tick();
    return () => clearTimeout(timer);
  }, [appActive]);

  useEffect(() => {
    if (!appActive) {
      hop.stopAnimation();
      squash.stopAnimation();
      paper.stopAnimation();
      return;
    }
    const hopLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(squash, { toValue: 1, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.parallel([
          Animated.timing(squash, { toValue: 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(hop, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
        Animated.delay(70),
        Animated.parallel([
          Animated.timing(hop, { toValue: 0, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
          Animated.timing(squash, { toValue: 1, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.timing(squash, { toValue: 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.delay(1100),
      ]),
    );
    const paperLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(paper, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(paper, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    hopLoop.start();
    paperLoop.start();
    return () => {
      hopLoop.stop();
      paperLoop.stop();
    };
  }, [appActive, hop, squash, paper]);

  const dropY = enter.interpolate({ inputRange: [0, 1], outputRange: [-64, 0] });
  const hopY = hop.interpolate({ inputRange: [0, 1], outputRange: [0, -22] });
  const scaleX = squash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const scaleY = squash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] });
  const shadowScale = hop.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] });
  const shadowOp = hop.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.12] });
  const paperTilt = paper.interpolate({ inputRange: [0, 1], outputRange: ['-14deg', '-6deg'] });
  const paperY = paper.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const textY = enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const markScale = mark.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });

  return (
    <View style={gone.page}>
      <Animated.View style={[gone.stage, { opacity: enter, transform: [{ translateY: dropY }] }]}>
        <Animated.View
          style={[
            gone.paper,
            { transform: [{ translateY: paperY }, { rotate: paperTilt }] },
          ]}
        >
          <CartoonPaper />
        </Animated.View>
        <Animated.View
          style={[
            gone.shadow,
            { opacity: shadowOp, transform: [{ scaleX: shadowScale }, { scaleY: shadowScale }] },
          ]}
        />
        <Animated.View
          style={{
            transform: [{ translateY: hopY }, { scaleX }, { scaleY }],
          }}
        >
          <CartoonShaobing blink={blink} waiting={kind === 'net'} />
        </Animated.View>
        <CartoonCrumb delay={80} start={{ x: 148, y: 58 }} active={appActive} />
        <CartoonCrumb delay={260} start={{ x: 168, y: 72 }} active={appActive} />
        <CartoonCrumb delay={480} start={{ x: 136, y: 44 }} active={appActive} />
        {kind === 'gone' ? <CartoonPoof active={appActive} /> : null}
        <Animated.View
          style={[
            gone.mark,
            { opacity: mark, transform: [{ scale: markScale }, { rotate: '12deg' }] },
          ]}
        >
          <Text style={gone.markText}>{kind === 'gone' ? '?' : '…'}</Text>
        </Animated.View>
      </Animated.View>
      <Animated.View style={[gone.copy, { opacity: enter, transform: [{ translateY: textY }] }]}>
        <Text style={gone.title}>{copy.title}</Text>
        <Text style={gone.hint}>{hint}</Text>
        {onRetry ? (
          <Pressable onPress={onRetry} style={({ pressed }) => [gone.retry, pressed && gone.retryPressed]}>
            <Text style={gone.retryText}>{copy.retry}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

function createGoneStyles(p: Palette) {
  return StyleSheet.create({
    page: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      paddingBottom: 48,
    },
    stage: {
      width: 260,
      height: 250,
      alignItems: 'center',
      justifyContent: 'center',
    },
    paper: {
      position: 'absolute',
      right: 18,
      top: 8,
    },
    shadow: {
      position: 'absolute',
      bottom: 28,
      width: 118,
      height: 22,
      borderRadius: 11,
      backgroundColor: p.scheme === 'light' ? 'rgba(90, 50, 16, 0.18)' : 'rgba(0, 0, 0, 0.35)',
    },
    crumbWrap: {
      position: 'absolute',
      width: 14,
      height: 14,
    },
    crumb: {
      width: 11,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#F0B24A',
      borderWidth: 2,
      borderColor: '#6B3210',
      transform: [{ rotate: '28deg' }],
    },
    poof: {
      position: 'absolute',
      right: 22,
      top: 28,
      width: 64,
      height: 44,
    },
    cloud: {
      position: 'absolute',
      backgroundColor: p.scheme === 'light' ? '#FFF' : '#F4F0E8',
      borderWidth: 3,
      borderColor: '#6B3210',
    },
    cloudA: { width: 28, height: 28, borderRadius: 14, left: 0, top: 10 },
    cloudB: { width: 36, height: 36, borderRadius: 18, left: 16, top: 0 },
    cloudC: { width: 22, height: 22, borderRadius: 11, left: 40, top: 14 },
    mark: {
      position: 'absolute',
      left: 28,
      top: 18,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: p.red,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: '#6B3210',
    },
    markText: {
      color: '#fff',
      fontSize: 20,
      fontWeight: '900',
      marginTop: -1,
    },
    copy: {
      alignItems: 'center',
      marginTop: 4,
      gap: 8,
    },
    title: {
      color: p.text,
      fontSize: 20,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    hint: {
      color: p.muted,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
      maxWidth: 280,
    },
    retry: {
      marginTop: 14,
      height: 42,
      paddingHorizontal: 28,
      borderRadius: 21,
      backgroundColor: p.red,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryPressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
    retryText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '800',
    },
  });
}

let gone = createGoneStyles(getPalette());
registerStyleSync(() => {
  gone = createGoneStyles(getPalette());
});
