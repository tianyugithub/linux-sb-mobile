import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export async function shareText(title: string, url: string): Promise<'shared' | 'copied'> {
  if (Platform.OS === 'web') {
    const web = globalThis.navigator as Navigator | undefined;
    if (web?.share) {
      await web.share({ title, url, text: title });
      return 'shared';
    }
    if (web?.clipboard?.writeText) {
      await web.clipboard.writeText(`${title}\n${url}`);
      return 'copied';
    }
  }
  await Share.share({ title, message: `${title}\n${url}` });
  return 'shared';
}

/**
 * 复制到系统剪贴板。
 *
 * 这里曾经调的是 `Share.share()` —— 弹的是系统**分享面板**，根本没写剪贴板，
 * 于是全 App 的「已复制」提示都是假的（用户报「不支持复制」）。分享要用分享面板，
 * 复制就用剪贴板，两件事别混。
 */
export async function copyText(text: string): Promise<void> {
  if (Platform.OS === 'web') {
    await navigator.clipboard.writeText(text);
    return;
  }
  await Clipboard.setStringAsync(text);
}
