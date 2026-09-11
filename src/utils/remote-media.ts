import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { isLinuxSiteHost, viaAccess } from './linux-access';

/**
 * 帖子/头像图是 RN 的 <Image>，走 Fresco。
 * 拉 HTML 的 OkHttp 已经接了 DoH，但 Fresco 可能另开一条连接、甚至仍走系统 DNS。
 * 国内把 linux.sb 污染成假 IP 时：正文能看、图一直转圈。
 * 站内图改走 fetch（同一套 OkHttp + DoH）落到缓存，再给 Image 读本地文件。
 */

const inflight = new Map<string, Promise<string>>();

export function needsDohMedia(url?: string | null): boolean {
  if (!url || Platform.OS === 'web') return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return isLinuxSiteHost(host);
  } catch {
    return false;
  }
}

function cacheFile(url: string): File | null {
  if (Platform.OS === 'web') return null;
  const ext = url.match(/\.(png|jpe?g|gif|webp|bmp)(\?|$)/i)?.[1]?.toLowerCase() || 'img';
  let hash = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const name = `m-${(hash >>> 0).toString(16)}-${url.length}.${ext === 'jpeg' ? 'jpg' : ext}`;
  return new File(Paths.cache, 'lsb-media', name);
}

function ensureCacheDir() {
  const dir = new Directory(Paths.cache, 'lsb-media');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
}

export function peekCachedMedia(url: string): string | undefined {
  try {
    const file = cacheFile(url);
    if (!file?.exists) return undefined;
    const size = file.info().size ?? 0;
    return size > 0 ? file.uri : undefined;
  } catch {
    return undefined;
  }
}

export function cacheRemoteMedia(url: string): Promise<string> {
  const hit = peekCachedMedia(url);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(url);
  if (pending) return pending;
  const task = downloadWithRetry(url).finally(() => inflight.delete(url));
  inflight.set(url, task);
  return task;
}

async function downloadWithRetry(url: string): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await download(url);
    } catch (error) {
      last = error;
      if (attempt < 2) {
        await new Promise<void>((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }
  throw last instanceof Error ? last : new Error('image fetch failed');
}

async function download(url: string): Promise<string> {
  const file = cacheFile(url);
  if (!file) return url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(viaAccess(url), {
      headers: { Accept: 'image/*,*/*;q=0.8' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`image ${res.status}`);
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html') || type.includes('application/json')) {
      throw new Error('image was not an image');
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.byteLength) throw new Error('empty image');
    ensureCacheDir();
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return file.uri;
  } finally {
    clearTimeout(timer);
  }
}
