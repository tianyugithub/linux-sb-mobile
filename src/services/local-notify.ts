import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * 插件用的本地通知（不经过服务器）。
 *
 * 与 services/push 的区别：push 负责官网未读/私信的轮询提醒，
 * 这里只服务插件（例如称号监控命中阈值），发的是纯本地通知。
 */
/** 申请本地通知权限（在用户开启监控时就问，别等到第一次命中才弹系统弹窗）。 */
export async function ensureLocalNotifyPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted ? current : await Notifications.requestPermissionsAsync();
    return Boolean(granted.granted);
  } catch {
    return false;
  }
}

export async function notifyLocal(title: string, body: string): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  try {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!granted.granted) return;
    await Notifications.scheduleNotificationAsync({
      identifier: `lsb-plugin-${Date.now()}`,
      content: { title, body, sound: true },
      trigger: null,
    });
  } catch {
    /* 通知不可用不影响插件功能，页面里还有行内高亮与提示 */
  }
}
