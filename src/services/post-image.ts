import * as ImagePicker from 'expo-image-picker';
import type { Member } from '../../data';
import { api } from './api';
import { ApiError } from './client';
import { hasOfficialImageUpload, isR2Ready, loadR2Config, type ImageUploadTarget } from './r2-config';

const MAX_BYTES = 10 * 1024 * 1024;

export type PickedImage = {
  uri: string;
  /** 上传时用的文件名（服务端只需要一个合法名字，统一用 image.jpg） */
  name: string;
  type: string;
  /** 界面上展示的名字：优先相册里的原始文件名 */
  label?: string;
};

function fileFromAsset(asset: ImagePicker.ImagePickerAsset): PickedImage | { error: string } {
  if (asset.fileSize && asset.fileSize > MAX_BYTES) return { error: '图片不能超过 10MB' };
  const mime = asset.mimeType || 'image/jpeg';
  const named = asset.fileName || asset.uri;
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(mime) && !/\.(jpe?g|png|webp)$/i.test(named)) {
    return { error: '请选择 jpg / png / webp 图片' };
  }
  const type = /^image\/png$/i.test(mime)
    ? 'image/png'
    : /^image\/webp$/i.test(mime)
      ? 'image/webp'
      : 'image/jpeg';
  const name = type === 'image/png' ? 'image.png' : type === 'image/webp' ? 'image.webp' : 'image.jpg';
  return { uri: asset.uri, name, type, label: asset.fileName || '' };
}

export async function pickPostImages(opts: {
  me: Member;
  toast: (message: string) => void;
}): Promise<PickedImage[] | null> {
  if (!hasOfficialImageUpload(opts.me)) {
    const config = await loadR2Config();
    if (!isR2Ready(config)) {
      opts.toast('没有官网上传权限。请到设置填写 Cloudflare R2，或申请创作者身份');
      return null;
    }
  }
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    opts.toast('请允许访问相册');
    return null;
  }
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsMultipleSelection: true,
    selectionLimit: 20,
  });
  if (picked.canceled || !picked.assets.length) return null;
  const files: PickedImage[] = [];
  let skipped = 0;
  let skipReason = '';
  for (const asset of picked.assets) {
    const file = fileFromAsset(asset);
    if ('error' in file) {
      skipped += 1;
      skipReason = file.error;
      continue;
    }
    files.push(file);
  }
  if (!files.length) {
    opts.toast(skipReason || '没有可用的图片');
    return null;
  }
  if (skipped) opts.toast(`${skipped} 张图片已跳过：${skipReason}`);
  // 相册常常拿不到原始文件名，用序号兜底，避免队列里全叫 image.jpg
  files.forEach((file, index) => {
    if (!file.label) file.label = `图片 ${index + 1}`;
  });
  return files;
}

export async function uploadPostImageFile(
  file: PickedImage,
  opts: {
    toast: (message: string) => void;
    onProgress?: (percent: number) => void;
    silent?: boolean;
    target?: ImageUploadTarget | null;
  },
): Promise<string> {
  opts.onProgress?.(8);
  let percent = 8;
  const timer = setInterval(() => {
    percent = Math.min(90, percent + 6);
    opts.onProgress?.(percent);
  }, 240);
  try {
    const uploaded = await api.upload({
      uri: file.uri,
      name: file.name,
      type: file.type,
      ...(opts.target ? { target: opts.target } : {}),
    });
    opts.onProgress?.(100);
    if (!uploaded.url) throw new Error('上传成功但未返回图片地址');
    return uploaded.url;
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error instanceof Error ? error.message : '上传失败');
    if (!opts.silent) opts.toast(message);
    throw error;
  } finally {
    clearInterval(timer);
  }
}
