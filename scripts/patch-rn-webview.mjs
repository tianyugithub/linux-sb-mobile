#!/usr/bin/env node
/**
 * react-native-webview 的 WebViewClient 默认不拦截子资源。
 * 国内打开 GitHub 时 CSS/JS 在 github.githubassets.com，需要 App 里 GithubAssets 接手。
 * npm 重装会覆盖 node_modules，所以每次 install 再补一次这段调用。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(
  root,
  'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java',
);

const marker = 'sb.linux.mobile.GithubAssets';
const hook = `
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
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
console.log('patch-rn-webview: 已接入 GitHub 静态资源拦截');
