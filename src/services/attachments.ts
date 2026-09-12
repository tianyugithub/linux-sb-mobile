import * as DocumentPicker from 'expo-document-picker';
import type { TopicAttachmentUploaderDto } from '../types/api';
import { api } from './api';
import { ApiError } from './client';

/**
 * 官网的附件上传（`.attachment-uploader` → `POST /attachment_upload`）。
 *
 * 页面上只给了扩展名列表（`.zip,.jpg,…`，官网自己还把 jpeg 写成 `.jepg`）和 `data-upload-max-mb`，
 * 所以选文件时把扩展名翻成 mime，大小也按页面的上限先拦一次（服务端还有一道）。
 * 上传回来的 `markdown` 就是官网「批量插入」写进正文的原文，直接插进编辑器。
 */

export type PickedAttachment = {
  uri: string;
  name: string;
  type: string;
  size: number;
};

const MIME_BY_EXT: Record<string, string> = {
  zip: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  // 官网 accept 里把 jpeg 写成了 .jepg，照收，不然那张单子上的文件选不了
  jepg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** 把官网的 `accept` 扩展名列表翻成 DocumentPicker 认的 mime 列表。 */
export function acceptMimes(accept: string): string[] {
  const mimes = accept
    .split(',')
    .map((item) => item.trim().replace(/^\./, '').toLowerCase())
    .map((ext) => MIME_BY_EXT[ext])
    .filter(Boolean);
  return mimes.length ? [...new Set(mimes)] : ['*/*'];
}

function mimeForName(name: string, fallback: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] || fallback;
}

/** 选附件（类型/多选/大小上限都按页面给的配置来）。 */
export async function pickAttachments(
  uploader: TopicAttachmentUploaderDto,
  onError: (message: string) => void,
): Promise<PickedAttachment[] | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: acceptMimes(uploader.accept),
    multiple: uploader.multiple,
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return null;
  const maxBytes = uploader.maxMb > 0 ? uploader.maxMb * 1024 * 1024 : 0;
  const files: PickedAttachment[] = [];
  for (const asset of picked.assets) {
    const size = asset.size ?? 0;
    if (maxBytes && size > maxBytes) {
      onError(`${asset.name} 超过 ${uploader.maxMb}MB`);
      continue;
    }
    files.push({
      uri: asset.uri,
      name: asset.name || 'file',
      type: asset.mimeType || mimeForName(asset.name || '', 'application/octet-stream'),
      size,
    });
  }
  return files.length ? files : null;
}

/**
 * 选完即传，返回可直接插进正文的 markdown。
 * 单个文件失败只提示、不打断其余文件（官网也是一条一条传）。
 */
export async function pickAndUploadAttachments(
  uploader: TopicAttachmentUploaderDto,
  opts: { onError: (message: string) => void; onProgress?: (done: number, total: number) => void },
): Promise<{ name: string; markdown: string }[]> {
  const files = await pickAttachments(uploader, opts.onError);
  if (!files) return [];
  const uploaded: { name: string; markdown: string }[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    opts.onProgress?.(index, files.length);
    try {
      const result = await api.uploadAttachment({ uri: file.uri, name: file.name, type: file.type });
      uploaded.push({ name: result.name || file.name, markdown: result.markdown });
    } catch (err) {
      opts.onError(err instanceof ApiError ? err.message : `${file.name} 上传失败`);
    }
  }
  opts.onProgress?.(files.length, files.length);
  return uploaded;
}
