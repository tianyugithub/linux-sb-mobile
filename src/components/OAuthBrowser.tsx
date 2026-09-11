import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { LINUX_ORIGIN } from '../services/live';
import { C, registerStyleSync, type Palette } from '../theme/palette';
import { adoptAccessUrl, viaAccess } from '../utils/linux-access';
import { hasLinuxSessionCookie, readLinuxCookies, writeLinuxCookies } from '../utils/site-cookies';

const CHROME_UA = Platform.select({
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1',
  default: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.146 Mobile Safari/537.36',
});

const INSPECT = `
(function () {
  try {
    var host = String(location.hostname || '').toLowerCase();
    if (!/(^|\\.)linux\\.sb$/i.test(host) && host !== 'lsb.miapi.cc') return true;
    var guest = !!document.querySelector('.nav-mine-guest');
    var errNode = document.querySelector('.form-error-panel p');
    var err = errNode ? String(errNode.textContent || '').trim() : '';
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'lsb',
      href: location.href,
      path: location.pathname,
      search: location.search || '',
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
  search?: string;
  cookie?: string;
  guest?: boolean;
  error?: string;
};

function oauthStartUrl(provider: 'github' | 'google') {
  return viaAccess(`${LINUX_ORIGIN}/oauth_login?provider=${provider}`);
}

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
  const uriRef = useRef(oauthStartUrl(provider));
  const [uri, setUri] = useState(uriRef.current);
  const [cookieHeader, setCookieHeader] = useState('');
  const [jarReady, setJarReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = provider === 'google' ? 'Google 登录' : 'GitHub 登录';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cookies = await readLinuxCookies();
      if (cookies) await writeLinuxCookies(cookies);
      if (cancelled) return;
      setCookieHeader(cookies);
      setJarReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bounce = (url: string) => {
    const next = adoptAccessUrl(url);
    if (!next || next === uriRef.current) return false;
    uriRef.current = next;
    setUri(next);
    return true;
  };

  const finish = async (documentCookie = '') => {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setError('');
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const cookies = await readLinuxCookies(documentCookie);
      if (!hasLinuxSessionCookie(cookies)) throw new Error('授权已打开，但还没有登录状态，请再试一次');
      await writeLinuxCookies(cookies);
      await onSuccess(cookies);
    } catch (err) {
      finishing.current = false;
      setBusy(false);
      setError(err instanceof Error ? err.message : '授权登录失败');
    }
  };

  const maybeFinishFromJar = () => {
    if (finishing.current) return;
    void readLinuxCookies().then((cookies) => {
      if (hasLinuxSessionCookie(cookies)) void finish(cookies);
    });
  };

  const handleNav = (nav: WebViewNavigation) => {
    if (!nav.url) return;
    if (bounce(nav.url)) {
      viewRef.current?.stopLoading();
      return;
    }
    try {
      const next = new URL(nav.url);
      const path = next.pathname.replace(/\/+$/, '') || '/';
      const waiting = path === '/oauth_login' && !next.searchParams.get('code');
      if (waiting || path === '/login' || path === '/register') return;
      viewRef.current?.injectJavaScript(INSPECT);
      if (next.searchParams.get('code') || path === '/') maybeFinishFromJar();
    } catch {
      /* ignore */
    }
  };

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as PagePing;
      if (data.type !== 'lsb') return;
      const path = (data.path || '').replace(/\/+$/, '') || '/';
      const params = new URLSearchParams((data.search || '').replace(/^\?/, ''));
      if (data.error && (path === '/login' || path === '/oauth_login')) {
        setError(data.error);
        return;
      }
      if (data.guest) {
        if (params.get('code')) maybeFinishFromJar();
        return;
      }
      if (path === '/login' || path === '/register') return;
      if (path === '/oauth_login' && !params.get('code')) return;
      void finish(data.cookie);
    } catch {
      /* ignore */
    }
  };

  const start = useMemo(() => uri, [uri]);

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
          {jarReady ? (
          <WebView
            ref={viewRef}
            source={{
              uri: start,
              headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
            }}
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
            onShouldStartLoadWithRequest={(req) => !bounce(req.url || '')}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => {
              setLoading(false);
              viewRef.current?.injectJavaScript(INSPECT);
            }}
            onError={(event) => {
              const failing = event.nativeEvent.url || uriRef.current;
              if (bounce(failing)) return;
              setError('无法打开授权页，请稍后重试');
            }}
            onHttpError={(event) => {
              const failing = event.nativeEvent.url || '';
              if (bounce(failing)) return;
            }}
            onNavigationStateChange={handleNav}
            onMessage={onMessage}
          />
          ) : null}
          {(loading || busy || !jarReady) ? (
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
