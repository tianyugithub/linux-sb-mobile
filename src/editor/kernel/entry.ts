import { mount } from './index';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void };
    __LSB_BOOT__?: {
      tokens?: Record<string, string>;
      html?: string;
      editable?: boolean;
      placeholder?: string;
    };
  }
}

function post(message: unknown) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
}

function boot() {
  const config = window.__LSB_BOOT__;
  if (!config) {
    post({ type: 'error', message: 'NO_BOOT' });
    return;
  }
  try {
    mount({
      tokens: config.tokens || {},
      html: config.html || '',
      editable: config.editable !== false,
      placeholder: config.placeholder || '',
    });
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
