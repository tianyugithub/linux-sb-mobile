import { Platform } from 'react-native';
import { hasNewCrashReport, markCrashLogAlive, readCrashLog, recordJsCrash } from 'linux-notify';

type ErrorUtilsLike = {
  getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
};

/**
 * JS 侧崩溃接到同一份本机文件。原生闪退由 CrashLog.kt 在下次启动
 * （WebView 之前）写进系统「下载 / LINUX-SB-崩溃日志.txt」。
 * 能打开时首页弹复制，不依赖「关于项目」。
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

/** 这次启动刚补到的崩溃记录。没有就不弹。 */
export function takeCrashPrompt(): string {
  if (Platform.OS !== 'android') return '';
  if (!hasNewCrashReport()) return '';
  return readCrashLog().trim();
}
