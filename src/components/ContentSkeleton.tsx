import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { C, registerStyleSync, type Palette } from '../theme/palette';
import { useAppActive } from '../hooks/useAppActive';

export type SkeletonVariant = 'list' | 'article' | 'comments' | 'footer' | 'lines';

function usePulse() {
  const opacity = useRef(new Animated.Value(0.42)).current;
  const appActive = useAppActive();
  useEffect(() => {
    if (!appActive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 780,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.42,
          duration: 780,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [appActive, opacity]);
  return opacity;
}

function Bone({ style }: { style?: object }) {
  return <View style={[styles.bone, style]} />;
}

export function ContentSkeleton({ variant = 'list' }: { variant?: SkeletonVariant }) {
  const opacity = usePulse();
  if (variant === 'footer') {
    return (
      <Animated.View style={[styles.footer, { opacity }]}>
        <Bone style={styles.footerBar} />
        <Bone style={styles.footerBarShort} />
      </Animated.View>
    );
  }
  if (variant === 'lines') {
    return (
      <Animated.View style={[styles.lines, { opacity }]}>
        <Bone style={styles.line} />
        <Bone style={styles.lineMid} />
        <Bone style={styles.lineShort} />
      </Animated.View>
    );
  }
  if (variant === 'article') {
    return (
      <Animated.View style={[styles.article, { opacity }]}>
        <Bone style={styles.articleLead} />
        <Bone style={styles.line} />
        <Bone style={styles.line} />
        <Bone style={styles.lineMid} />
        <Bone style={styles.articleGap} />
        <Bone style={styles.line} />
        <Bone style={styles.lineShort} />
      </Animated.View>
    );
  }
  const rows = variant === 'comments' ? 3 : 4;
  return (
    <Animated.View style={[styles.list, variant === 'comments' && styles.comments, { opacity }]}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={styles.row}>
          <Bone style={styles.avatar} />
          <View style={styles.body}>
            <Bone style={styles.line} />
            <Bone style={index % 2 ? styles.lineShort : styles.lineMid} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

function createSkeletonStyles(C: Palette) {
  return StyleSheet.create({
    bone: { backgroundColor: C.skeleton, borderRadius: 6 },
    list: { paddingHorizontal: 16, paddingTop: 10, gap: 16 },
    comments: { paddingHorizontal: 0, paddingTop: 12 },
    row: { flexDirection: 'row', gap: 10 },
    avatar: { width: 34, height: 34, borderRadius: 8, backgroundColor: C.skeletonSoft },
    body: { flex: 1, gap: 8, paddingTop: 4 },
    line: { height: 11, borderRadius: 5, backgroundColor: C.skeleton },
    lineMid: { width: '72%', height: 10, borderRadius: 5 },
    lineShort: { width: '44%', height: 10, borderRadius: 5 },
    article: { marginTop: 16, gap: 10 },
    articleLead: { width: '38%', height: 12, borderRadius: 5, marginBottom: 4 },
    articleGap: { height: 8, backgroundColor: 'transparent' },
    lines: { gap: 10, paddingVertical: 8 },
    footer: { alignItems: 'center', paddingVertical: 18, gap: 8 },
    footerBar: { width: 88, height: 8, borderRadius: 4 },
    footerBarShort: { width: 52, height: 6, borderRadius: 3, backgroundColor: C.skeletonSoft },
  });
}

let styles = createSkeletonStyles(C);
registerStyleSync(() => {
  styles = createSkeletonStyles(C);
});
