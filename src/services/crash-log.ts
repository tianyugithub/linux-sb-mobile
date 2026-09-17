import { Platform } from 'react-native';
import { markCrashLogAlive, recordJsCrash } from 'linux-notify';

type ErrorUtilsLike = {
  getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
};

/**
 * JS 侧崩溃接到同一份本机文件。原生闪退由 CrashLog.kt 在下次启动
 * （WebView 之前）写进系统「下载 / LINUX-SB-崩溃日志.txt」。
 * 不在启动时弹窗；要看记录去「关于项目」。
 */
export function installCrashLog() {
  if (Platform.OS !== 'android') return;
  markCrashLogAlive();
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!utils?.setGlobalHandler) return;
  const previous = utils.getGlobalHandler?.();
  utils.setGlobalHandler((error, isFatal) => {
    const stack = error?.stack || `${error?.name || 'Error'}: ${error?.message || error}`;
    recordJsCrash(`${isFatal ? 'fatal' : 'error'}\n${stack}`);
    previous?.(error, isFatal);
  });
}
