import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type LinuxNotifyNative = {
  setEnabled(enabled: boolean): void;
  setAccessChannel?(channel: string): void;
  setH3Enabled?(enabled: boolean): void;
  h3Status?(): string;
  crashLog?(): string;
  clearCrashLog?(): void;
  markCrashLogAlive?(): void;
  recordJsCrash?(text: string): void;
  hasNewCrashReport?(): boolean;
  cloudflareCookies?(): string;
  passCloudflareChallenge?(url: string): Promise<string>;
  isEnabled(): boolean;
  syncSession(cookie: string, unread: number, baselined: boolean): void;
  start(): boolean;
  stop(): boolean;
  isIgnoringBattery(): boolean;
  requestBattery(): boolean;
  canInstallPackages(): boolean;
  openInstallPermission(): boolean;
  downloadApk(url: string, destPath: string): Promise<string>;
  installApk(path: string): Promise<boolean>;
};

const Native = requireOptionalNativeModule<LinuxNotifyNative>('LinuxNotify');

export function setNotifyGuardEnabled(enabled: boolean) {
  if (Platform.OS !== 'android') return;
  Native?.setEnabled(enabled);
}

export function setAccessChannel(channel: 'doh' | 'direct') {
  if (Platform.OS !== 'android') return;
  Native?.setAccessChannel?.(channel);
}

export function setH3Enabled(enabled: boolean) {
  if (Platform.OS !== 'android') return;
  Native?.setH3Enabled?.(enabled);
}

/** 上一次请求实际用的传输（HTTP/3 / 回落 TCP），给设置页显示。 */
export function h3Status(): string {
  if (Platform.OS !== 'android') return '';
  return Native?.h3Status?.() ?? '';
}

export function readCrashLog(): string {
  if (Platform.OS !== 'android') return '';
  return Native?.crashLog?.() ?? '';
}

export function clearCrashLog() {
  if (Platform.OS !== 'android') return;
  Native?.clearCrashLog?.();
}

export function markCrashLogAlive() {
  if (Platform.OS !== 'android') return;
  Native?.markCrashLogAlive?.();
}

export function recordJsCrash(text: string) {
  if (Platform.OS !== 'android') return;
  Native?.recordJsCrash?.(text);
}

export function hasNewCrashReport(): boolean {
  if (Platform.OS !== 'android') return false;
  return Native?.hasNewCrashReport?.() ?? false;
}

export function cloudflareCookies(): string {
  if (Platform.OS !== 'android') return '';
  return Native?.cloudflareCookies?.() ?? '';
}

export async function passCloudflareChallenge(url: string): Promise<string> {
  if (Platform.OS !== 'android') return '';
  if (!Native?.passCloudflareChallenge) return '';
  return Native.passCloudflareChallenge(url);
}

export function syncNotifySession(cookie: string, unread = -1, baselined = true) {
  if (Platform.OS !== 'android') return;
  Native?.syncSession(cookie ?? '', unread, baselined);
}

export function startNotifyGuard() {
  if (Platform.OS !== 'android') return false;
  return Native?.start() ?? false;
}

export function stopNotifyGuard() {
  if (Platform.OS !== 'android') return false;
  return Native?.stop() ?? false;
}

export function isIgnoringBattery(): boolean {
  if (Platform.OS !== 'android') return true;
  return Native?.isIgnoringBattery() ?? false;
}

export function requestBatteryExemption(): boolean {
  if (Platform.OS !== 'android') return true;
  return Native?.requestBattery() ?? false;
}

export function canInstallPackages(): boolean {
  if (Platform.OS !== 'android') return false;
  return Native?.canInstallPackages() ?? false;
}

export function openInstallPermission(): boolean {
  if (Platform.OS !== 'android') return false;
  return Native?.openInstallPermission() ?? false;
}

type ApkProgressEvent = { received?: number; total?: number };

function listenApkProgress(onProgress: (received: number, total: number) => void): () => void {
  const emitter = Native as unknown as {
    addListener?: (event: string, listener: (payload: ApkProgressEvent) => void) => { remove(): void };
  };
  const sub = emitter?.addListener?.('onApkDownloadProgress', (payload) => {
    onProgress(Number(payload?.received) || 0, Number(payload?.total) || 0);
  });
  return () => {
    try { sub?.remove(); } catch { /* ignore */ }
  };
}

export async function downloadApk(
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
): Promise<string> {
  if (Platform.OS !== 'android') throw new Error('仅安卓可直接安装更新');
  if (!Native?.downloadApk) throw new Error('当前安装包不支持应用内更新');
  const stop = onProgress ? listenApkProgress(onProgress) : () => {};
  try {
    return await Native.downloadApk(url, destPath);
  } finally {
    stop();
  }
}

export async function installApk(path: string): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('仅安卓可安装更新');
  if (!Native?.installApk) throw new Error('当前安装包不支持应用内更新');
  await Native.installApk(path);
}
