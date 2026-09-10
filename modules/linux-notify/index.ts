import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type LinuxNotifyNative = {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  syncSession(cookie: string, unread: number, baselined: boolean): void;
  start(): boolean;
  stop(): boolean;
  isIgnoringBattery(): boolean;
  requestBattery(): boolean;
};

const Native = requireOptionalNativeModule<LinuxNotifyNative>('LinuxNotify');

export function setNotifyGuardEnabled(enabled: boolean) {
  if (Platform.OS !== 'android') return;
  Native?.setEnabled(enabled);
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
