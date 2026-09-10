import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { LINUX_ORIGIN } from '../services/live';
import { readLinuxCookies } from '../utils/site-cookies';
import { C, registerStyleSync, type Palette } from '../theme/palette';

const CHROME_UA = Platform.select({
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1',
  default: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.146 Mobile Safari/537.36',
});

const INSPECT = `
(function () {
  try {
    if (!/(^|\\.)linux\\.sb$/i.test(location.hostname)) return true;
    var guest = !!document.querySelector('.nav-mine-guest');
    var errNode = document.querySelector('.form-error-panel p');
    var err = errNode ? String(errNode.textContent || '').trim() : '';
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'lsb',
      href: location.href,
      path: location.pathname,
      cookie: document.cookie || '',
      guest: guest,
      error: err
    }));
  } catch (e) {}
  true;
})();
`;

type PagePing = {
  type?: string;
  href?: string;
  path?: string;
  cookie?: string;
  guest?: boolean;
  error?: string;
};

export function OAuthBrowser({
  provider,
  onClose,
  onSuccess,
}: {
  provider: 'github' | 'google';
  onClose: () => void;
  onSuccess: (cookies: string) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const viewRef = useRef<WebView>(null);
  const finishing = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startUrl = useMemo(() => `${LINUX_ORIGIN}/oauth_login?provider=${provider}`, [provider]);
  const title = provider === 'google' ? 'Google 登录' : 'GitHub 登录';

  const finish = async (documentCookie = '') => {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setError('');
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const cookies = await readLinuxCookies(documentCookie);
      if (!cookies) throw new Error('无法读取登录状态，请重试');
      await onSuccess(cookies);
    } catch (err) {
      finishing.current = false;
      setBusy(false);
      setError(err instanceof Error ? err.message : '授权登录失败');
    }
  };

  const handleNav = (nav: WebViewNavigation) => {
    if (!nav.url) return;
    try {
      const next = new URL(nav.url);
      if (!/(^|\.)linux\.sb$/i.test(next.hostname)) return;
      if (next.pathname === '/oauth_login' || next.pathname === '/login' || next.pathname === '/register') return;
      viewRef.current?.injectJavaScript(INSPECT);
    } catch {
      /* ignore */
    }
  };

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as PagePing;
      if (data.type !== 'lsb') return;
      if (data.error && (data.path === '/login' || data.path === '/oauth_login')) {
        setError(data.error);
        return;
      }
      if (data.guest) return;
      if (!data.path || data.path === '/oauth_login' || data.path === '/login' || data.path === '/register') return;
      void finish(data.cookie);
    } catch {
      /* ignore */
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={8} style={styles.headerBtn} accessibilityLabel="关闭">
            <Ionicons name="close" size={22} color={C.text} />
          </Pressable>
          <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerBtn} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.webWrap}>
          <WebView
            ref={viewRef}
            source={{ uri: startUrl }}
            userAgent={CHROME_UA}
            style={styles.web}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            originWhitelist={['*']}
            mixedContentMode="always"
            startInLoadingState
            injectedJavaScript={INSPECT}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => {
              setLoading(false);
              viewRef.current?.injectJavaScript(INSPECT);
            }}
            onNavigationStateChange={handleNav}
            onMessage={onMessage}
          />
          {(loading || busy) ? (
            <View style={styles.overlay} pointerEvents="none">
              <ActivityIndicator color="#fff" />
              <Text style={styles.overlayText}>{busy ? '正在完成登录…' : '加载中…'}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function createOAuthStyles(C: Palette) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: C.canvas },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  error: { color: C.redBright, fontSize: 12, paddingHorizontal: 16, paddingVertical: 8 },
  webWrap: { flex: 1, backgroundColor: C.surface },
  web: { flex: 1, backgroundColor: C.surface },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(14,17,23,0.55)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  overlayText: { color: C.muted, fontSize: 12 },
  });
}

let styles = createOAuthStyles(C);
registerStyleSync(() => {
  styles = createOAuthStyles(C);
});
