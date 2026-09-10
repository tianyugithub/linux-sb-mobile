import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import {
  canInstallPackages,
  installApk,
  openInstallPermission,
} from 'linux-notify';
import type { UpdateResult } from './app-update';

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
      : await SecureStore.getItemAsync(SKIP_KEY);
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
    await SecureStore.setItemAsync(SKIP_KEY, tag);
  } catch {
    /* ignore */
  }
}

function apkFileName(version: string): string {
  const tag = normalizeUpdateTag(version) || 'latest';
  return `linux-sb-${tag.replace(/[^\w.-]/g, '_')}.apk`;
}

export async function downloadAndInstallUpdate(
  next: Extract<UpdateResult, { status: 'available' }>,
  onToast: (message: string) => void,
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
  onToast('正在下载安装包…');
  const dest = new File(Paths.cache, apkFileName(next.latest));
  const file = await File.downloadFileAsync(next.apkUrl, dest, { idempotent: true });
  const path = file?.uri || dest.uri;
  if (!path) throw new Error('安装包下载失败');
  await installApk(path);
}

export const NEED_PERMISSION = 'NEED_PERMISSION';
