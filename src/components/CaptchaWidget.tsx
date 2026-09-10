import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from '../services/api';
import { ApiError } from '../services/client';
import { captchaWidgetPage } from '../services/upstream-auth';
import { C } from '../theme/palette';
import type { CaptchaChallengeDto } from '../types/api';

function loadCapScript(src: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.reject(new Error('NO_DOM'));
  if (customElements.get('cap-widget')) return Promise.resolve();
  const existing = document.querySelector('script[data-lsb-cap="1"]') as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('CAP_SCRIPT')), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.lsbCap = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('CAP_SCRIPT'));
    document.head.appendChild(script);
  });
}

/**
 * 人机验证组件（官方用的是 Cap：cap.linux.sb）。
 *
 * 三处会用到：登录页、注册（App 里跳官网）、以及**抽奖帖的回帖框**
 * （官方在回帖编辑器上方挂 `cap-verification-widget`，提交必须带 `cap_token`）。
 * 传了 `config` 就用页面里那份 `data-cap-*`，否则回退去登录页读一次。
 */
function NativeCaptcha({ onToken, config }: { onToken: (value: string | null) => void; config?: CaptchaChallengeDto | null }) {
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'solved' | 'error'>('loading');
  const [message, setMessage] = useState('正在加载人机验证…');
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;
    onTokenRef.current(null);
    setStatus('loading');
    setMessage('正在加载人机验证…');
    const ready = config
      ? Promise.resolve(config)
      : api.captcha();
    ready
      .then((cfg) => {
        if (cancelled) return;
        setHtml(captchaWidgetPage(cfg, C));
        setStatus('ready');
        setMessage('点击完成人机验证');
      })
      .catch((err) => {
        if (cancelled) return;
        onTokenRef.current(null);
        setStatus('error');
        setMessage(err instanceof ApiError ? err.message : '人机验证加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  return (
    <View style={{ marginBottom: 12, minHeight: 88 }}>
      {html ? (
        <WebView
          originWhitelist={['*']}
          source={{ html, baseUrl: 'https://linux.sb/' }}
          style={{ height: 88, backgroundColor: C.surface, borderRadius: 8 }}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data) as { type?: string; token?: string };
              if (data.type === 'solve' && data.token) {
                onTokenRef.current(data.token);
                setStatus('solved');
                setMessage('验证通过');
              } else if (data.type === 'error' || data.type === 'reset') {
                onTokenRef.current(null);
                setStatus(data.type === 'error' ? 'error' : 'ready');
                setMessage(data.type === 'error' ? '人机验证失败，请重试' : '点击完成人机验证');
              }
            } catch {
              /* ignore */
            }
          }}
          onError={() => {
            onTokenRef.current(null);
            setStatus('error');
            setMessage('无法加载人机验证');
          }}
          onHttpError={() => {
            onTokenRef.current(null);
            setStatus('error');
            setMessage('无法加载人机验证');
          }}
        />
      ) : (
        <Text style={{ color: C.dim, fontSize: 12 }}>{message}</Text>
      )}
      {status === 'error' ? <Text style={{ color: C.dim, fontSize: 12, marginTop: 6 }}>{message}</Text> : null}
    </View>
  );
}

export function CaptchaWidget({ onToken, config }: { token?: string | null; onToken: (value: string | null) => void; config?: CaptchaChallengeDto | null }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'solved' | 'error'>('loading');
  const [message, setMessage] = useState('正在加载人机验证…');
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !host) return;
    let cancelled = false;
    onTokenRef.current(null);
    setStatus('loading');
    setMessage('正在加载人机验证…');
    (config ? Promise.resolve(config) : api.captcha())
      .then((cfg) => {
        if (cancelled) return;
        const endpoint = cfg.endpoint.startsWith('http') ? cfg.endpoint : `https://cap.linux.sb/${cfg.endpoint.replace(/^\/+/, '')}`;
        const wasm = cfg.wasmUrl || 'https://cap.linux.sb/assets/cap_wasm_bg.wasm';
        (window as Window & { CAP_CUSTOM_WASM_URL?: string; CAP_LANG?: string }).CAP_CUSTOM_WASM_URL = wasm;
        (window as Window & { CAP_LANG?: string }).CAP_LANG = 'zh-cn';
        return loadCapScript(cfg.widgetScript).then(() => endpoint);
      })
      .then((endpoint) => {
        if (!endpoint || cancelled || !host) return;
        host.innerHTML = '';
        const widget = document.createElement('cap-widget');
        widget.setAttribute('data-cap-api-endpoint', endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
        widget.setAttribute('data-cap-hidden-field-name', 'cap_token');
        widget.addEventListener('solve', (event) => {
          const detail = (event as CustomEvent<{ token?: string }>).detail;
          const token = detail?.token || (event as { token?: string }).token || (widget as { token?: string }).token;
          onTokenRef.current(token ?? null);
          setStatus('solved');
          setMessage('验证通过');
        });
        widget.addEventListener('error', () => {
          onTokenRef.current(null);
          setStatus('error');
          setMessage('人机验证失败，请刷新后重试');
        });
        widget.addEventListener('reset', () => {
          onTokenRef.current(null);
          setStatus('ready');
          setMessage('点击完成人机验证');
        });
        host.appendChild(widget);
        setStatus('ready');
        setMessage('点击完成人机验证');
      })
      .catch((err) => {
        if (cancelled) return;
        onTokenRef.current(null);
        setStatus('error');
        setMessage(err instanceof ApiError ? err.message : '人机验证加载失败');
      });
    return () => {
      cancelled = true;
      host.innerHTML = '';
    };
  }, [host, config]);

  if (Platform.OS !== 'web') {
    return <NativeCaptcha onToken={onToken} config={config} />;
  }

  return (
    <View style={{ marginBottom: 12 }}>
      {React.createElement('div', {
        ref: (node: HTMLDivElement | null) => {
          if (node !== host) setHost(node);
        },
        style: {
          marginBottom: 8,
          ['--cap-background']: C.surface,
          ['--cap-border-color']: C.line,
          ['--cap-color']: C.text,
          ['--cap-checkbox-background']: C.surfaceRaised,
          ['--cap-spinner-color']: C.red,
          ['--cap-spinner-background-color']: C.surfaceSoft,
        },
      })}
      {status !== 'solved' ? <Text style={{ color: C.dim, fontSize: 12, marginTop: 6 }}>{message}</Text> : null}
    </View>
  );
}
