#!/usr/bin/env node
/**
 * react-native-webview 的 WebViewClient 默认不拦截子资源，这里补两个接管点：
 *
 *   1. sb.linux.mobile.WebViewH3  —— 站内页面与子资源走 HTTP/3（QUIC）。
 *      国内对 linux.sb 的封锁在 TCP 的 SNI 上，WebView 自己只会走 TCP（还可能回落系统 DNS），
 *      所以拦截下来由 App 的 H3 层取回，再交回给 WebView 渲染。
 *   2. sb.linux.mobile.GithubAssets —— 国内打开 GitHub 时 CSS/JS 在 github.githubassets.com。
 *
 * npm 重装会覆盖 node_modules，所以每次 install 都要再补一次。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(
  root,
  'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java',
);

const marker = 'sb.linux.mobile.WebViewH3';
const hook = `
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        try {
            Class<?> klass = Class.forName("sb.linux.mobile.WebViewH3");
            Object result = klass.getMethod("intercept", WebResourceRequest.class).invoke(null, request);
            if (result instanceof WebResourceResponse) {
                return (WebResourceResponse) result;
            }
        } catch (Throwable ignored) {
        }
        try {
            Class<?> klass = Class.forName("sb.linux.mobile.GithubAssets");
            Object result = klass.getMethod("intercept", WebResourceRequest.class).invoke(null, request);
            if (result instanceof WebResourceResponse) {
                return (WebResourceResponse) result;
            }
        } catch (Throwable ignored) {
        }
        return super.shouldInterceptRequest(view, request);
    }
`;

let src;
try {
  src = readFileSync(file, 'utf8');
} catch {
  process.exit(0);
}
if (src.includes(marker)) process.exit(0);

// 已经注入过「只接 GithubAssets」的旧版本：整段换成新版（H3 优先）
const legacy = /    @Override\n    public WebResourceResponse shouldInterceptRequest\(WebView view, WebResourceRequest request\) \{[\s\S]*?\n    \}\n/;
if (legacy.test(src)) {
  writeFileSync(file, src.replace(legacy, hook.trimStart()));
  console.log('patch-rn-webview: 已把资源拦截升级为 HTTP/3 + GitHub 双接管');
  process.exit(0);
}

const replaced = src.replace(
  /public void setProgressChangedFilter\(RNCWebView\.ProgressChangedFilter filter\) \{\s*progressChangedFilter = filter;\s*\}\s*\}\s*$/,
  `public void setProgressChangedFilter(RNCWebView.ProgressChangedFilter filter) {
        progressChangedFilter = filter;
    }
${hook}
}
`,
);
if (replaced === src) {
  console.warn('patch-rn-webview: 未找到插入点，跳过');
  process.exit(0);
}
writeFileSync(file, replaced);
console.log('patch-rn-webview: 已接入 HTTP/3 与 GitHub 静态资源拦截');
