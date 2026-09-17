import { Platform } from 'react-native';
import { secureDelete, secureGet, secureSet } from './secure-value';
import { File, Paths } from 'expo-file-system';
import {
  canInstallPackages,
  downloadApk,
  installApk,
  openInstallPermission,
} from 'linux-notify';
import type { UpdateResult } from './app-update';
import { githubAccessUrls } from '../utils/github-access';

const SKIP_KEY = 'lsb.update.skip';

export function normalizeUpdateTag(version: string): string {
  return String(version ?? '').trim().replace(/^[vV]/, '');
}

export async function wasUpdateSkipped(version: string): Promise<boolean> {
  const tag = normalizeUpdateTag(version);
  if (!tag) return false;
  try {
    const stored = Platform.OS === 'web'
      ? (typeof localStorage === 'undefined' ? null : localStorage.getItem(SKIP_KEY))
      : await secureGet(SKIP_KEY);
    return normalizeUpdateTag(stored || '') === tag;
  } catch {
    return false;
  }
}

export async function rememberSkippedUpdate(version: string): Promise<void> {
  const tag = normalizeUpdateTag(version);
  if (!tag) return;
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem(SKIP_KEY, tag);
      return;
    }
    await secureSet(SKIP_KEY, tag);
  } catch {
    /* ignore */
  }
}

function apkFileName(version: string): string {
  const tag = normalizeUpdateTag(version) || 'latest';
  return `linux-sb-${tag.replace(/[^\w.-]/g, '_')}.apk`;
}

export function formatDownloadHint(received: number, total: number): string {
  const mb = (n: number) => Math.max(0, n) / (1024 * 1024);
  if (total > 0) {
    const pct = Math.max(0, Math.min(99, Math.floor((received / total) * 100)));
    return `正在下载 ${pct}%（${mb(received).toFixed(1)} / ${mb(total).toFixed(1)} MB）`;
  }
  return `正在下载 ${mb(received).toFixed(1)} MB…`;
}

export async function downloadAndInstallUpdate(
  next: Extract<UpdateResult, { status: 'available' }>,
  onToast: (message: string) => void,
  options?: {
    onProgress?: (hint: string) => void;
    onBeforeInstall?: () => void;
  },
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('仅安卓可直接安装更新');
  }
  if (!next.apkUrl) {
    throw new Error('这个版本没有安装包');
  }
  if (!canInstallPackages()) {
    onToast('请允许安装未知应用，然后回来再点下载安装');
    openInstallPermission();
    throw new Error('NEED_PERMISSION');
  }
  const report = (hint: string) => {
    options?.onProgress?.(hint);
    onToast(hint);
  };
  report('正在连接下载源…');
  const dest = new File(Paths.cache, apkFileName(next.latest));
  const urls = githubAccessUrls(next.apkUrl);
  let lastError = '安装包下载失败';
  let path = '';
  for (let i = 0; i < urls.length; i += 1) {
    try {
      if (i > 0) report(`这个源没下完，换第 ${i + 1} 个…`);
      path = await downloadApk(urls[i], dest.uri, (received, total) => {
        options?.onProgress?.(formatDownloadHint(received, total));
      });
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
      path = '';
    }
  }
  if (!path) throw new Error(lastError);
  report('正在打开系统安装界面…');
  options?.onBeforeInstall?.();
  await new Promise((resolve) => setTimeout(resolve, 80));
  await installApk(path);
  onToast('已打开安装界面，按系统提示完成安装');
}

export const NEED_PERMISSION = 'NEED_PERMISSION';
