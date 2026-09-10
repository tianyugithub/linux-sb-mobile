import { Platform, Share } from 'react-native';

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

export async function copyText(text: string): Promise<void> {
  if (Platform.OS === 'web') {
    await navigator.clipboard.writeText(text);
    return;
  }
  await Share.share({ message: text });
}
