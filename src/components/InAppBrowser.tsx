import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { cookiesForToken } from '../services/site-session';
import { getAccessToken } from '../services/session';
import { writeLinuxCookies } from '../utils/site-cookies';
import { classifyAppHref, hostLabel, isHttpUrl } from '../utils/links';
import { C, registerStyleSync, type Palette } from '../theme/palette';

const CHROME_UA = Platform.select({
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1',
  default: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.146 Mobile Safari/537.36',
});

function isPayAppUrl(url: string): boolean {
  return /^(alipays?|alipay|weixin|weixinulapi|weixinminiprogram|upwrp):/i.test(url);
}

function isWebUrl(url: string): boolean {
  return /^(https?|about|data):/i.test(url);
}

export function InAppBrowser({
  url,
  title,
  onClose,
  onToast,
  onAppHref,
}: {
  url: string;
  title?: string;
  onClose: () => void;
  onToast: (message: string) => void;
  onAppHref?: (href: string) => void;
}) {
  const viewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [cookieHeader, setCookieHeader] = useState('');
  const [currentUrl, setCurrentUrl] = useState(url);
  const [pageTitle, setPageTitle] = useState(title || hostLabel(url));
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(isHttpUrl(url));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const http = isHttpUrl(url);
  const headerTitle = useMemo(() => title || pageTitle || hostLabel(currentUrl || url), [title, pageTitle, currentUrl, url]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const header = cookiesForToken(getAccessToken()) ?? '';
      try {
        if (header) await writeLinuxCookies(header);
      } catch {
        /* WebView can still load as guest */
      }
      if (!cancelled) {
        setCookieHeader(header);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goBack = () => {
    if (confirmOpen) {
      setConfirmOpen(false);
      return;
    }
    if (canGoBack) {
      viewRef.current?.goBack();
      return;
    }
    onClose();
  };

  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const openExternal = async () => {
    setConfirmOpen(false);
    const target = currentUrl || url;
    try {
      await Linking.openURL(target);
    } catch {
      onToast('无法打开系统浏览器');
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={8} style={styles.headerBtn} accessibilityLabel="返回">
          <Ionicons name="chevron-back" size={22} color={C.muted} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>{headerTitle}</Text>
        <Pressable onPress={() => setConfirmOpen(true)} hitSlop={8} style={styles.externalBtn} accessibilityLabel="外部打开">
          <Ionicons name="open-outline" size={16} color={C.blue} />
          <Text style={styles.externalText}>外部打开</Text>
        </Pressable>
      </View>
      {http ? (
        <View style={styles.webWrap}>
          {ready ? (
            <WebView
              ref={viewRef}
              source={{
                uri: url,
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
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onShouldStartLoadWithRequest={(req) => {
                const next = req.url || '';
                if (next && /^https?:/i.test(next) && onAppHref) {
                  const action = classifyAppHref(next);
                  if (action.type !== 'browser' && action.type !== 'ignore') {
                    onAppHref(next);
                    return false;
                  }
                }
                if (!next || isWebUrl(next)) return true;
                if (isPayAppUrl(next)) {
                  void Linking.openURL(next).catch(() => onToast('无法打开支付应用'));
                  return false;
                }
                setCurrentUrl(next);
                setConfirmOpen(true);
                return false;
              }}
              onNavigationStateChange={(navState: WebViewNavigation) => {
                setCanGoBack(navState.canGoBack);
                if (navState.url) setCurrentUrl(navState.url);
                if (navState.title) setPageTitle(navState.title);
              }}
              onOpenWindow={(event) => {
                const next = event.nativeEvent.targetUrl;
                if (next) viewRef.current?.injectJavaScript(`location.href = ${JSON.stringify(next)}; true;`);
              }}
            />
          ) : (
            <View style={styles.boot}>
              <ActivityIndicator size="small" color="#fff" />
            </View>
          )}
          {loading ? (
            <View style={styles.loadingBar} pointerEvents="none">
              <ActivityIndicator size="small" color="#fff" />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>该链接需要使用系统应用打开</Text>
          <Text style={styles.fallbackUrl}>{url}</Text>
        </View>
      )}
      {confirmOpen ? (
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Pressable style={styles.modalBackdrop} onPress={() => setConfirmOpen(false)} />
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>使用系统浏览器打开</Text>
            <Text style={styles.dialogText}>{`即将离开应用，使用系统浏览器打开：\n\n${currentUrl || url}\n\n请确认来源可信，不要泄露账号、密码或验证码。`}</Text>
            <View style={styles.dialogActions}>
              <Pressable onPress={() => setConfirmOpen(false)} style={styles.ghostBtn}>
                <Text style={styles.ghostBtnText}>取消</Text>
              </Pressable>
              <Pressable onPress={() => void openExternal()} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>打开</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function createBrowserStyles(C: Palette) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: C.canvas },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: C.line, gap: 4 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, minWidth: 0, color: C.text, fontSize: 14, fontWeight: '700' },
  externalBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: 8, borderRadius: 8 },
  externalText: { color: C.blue, fontSize: 12, fontWeight: '700' },
  webWrap: { flex: 1, backgroundColor: C.surface },
  web: { flex: 1, backgroundColor: C.surface },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingBar: { position: 'absolute', top: 10, right: 12 },
  fallback: { flex: 1, padding: 24, gap: 10, justifyContent: 'center' },
  fallbackText: { color: C.muted, fontSize: 14 },
  fallbackUrl: { color: C.dim, fontSize: 12, lineHeight: 18 },
  modalRoot: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', zIndex: 20 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  dialogCard: { marginHorizontal: 28, borderRadius: 12, backgroundColor: C.surfaceRaised, padding: 18, gap: 10 },
  dialogTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  dialogText: { color: C.muted, fontSize: 13, lineHeight: 20 },
  dialogActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  ghostBtn: { flex: 1, height: 40, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { color: C.text, fontSize: 14, fontWeight: '700' },
  primaryBtn: { flex: 1, height: 40, borderRadius: 8, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  });
}

let styles = createBrowserStyles(C);
registerStyleSync(() => {
  styles = createBrowserStyles(C);
});
