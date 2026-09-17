/**
 * 官网 Cloudflare 盾：检测到挑战页后，用系统 WebView 跑官方 JS，
 * 拿到 `cf_clearance` 再重发请求。不解析挑战脚本，也不走第三方打码。
 */
import { Platform } from 'react-native';
import { cloudflareCookies, passCloudflareChallenge } from 'linux-notify';
import { isChallengeHtml, pickCloudflareCookies } from './session-keep';
import { mergeCookieHeaders } from '../utils/site-cookies';

let jar = '';
let inflight: Promise<string> | null = null;
let seeded = false;

export function cloudflareCookieHeader(): string {
  seedFromNative();
  return jar;
}

export function rememberCloudflareCookies(header: string) {
  const picked = pickCloudflareCookies(header);
  if (!picked) return;
  jar = mergeCookieHeaders(jar, picked);
}

function seedFromNative() {
  if (seeded || Platform.OS !== 'android') return;
  seeded = true;
  rememberCloudflareCookies(cloudflareCookies());
}

export async function passCloudflareIfNeeded(html: string, url: string): Promise<string> {
  seedFromNative();
  if (!isChallengeHtml(html)) return jar;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const header = await passCloudflareChallenge(url || 'https://linux.sb/');
      rememberCloudflareCookies(header);
      return jar;
    } catch {
      return jar;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
