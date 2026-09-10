/**
 * 与站点官方编辑器（nb_editor 插件）对齐的视频链接解析。
 *
 * 官方行为：把「抖音/哔哩哔哩/YouTube 链接或整段分享文案」提交给站点解析，
 * 成功后插入 `[抖音视频](url)` / `[哔哩哔哩视频](url)` / `[YouTube视频](url)`。
 * 官方校验规则见 plugins.js 的 insertVideo：
 *   douyin    https://www.douyin.com/video/\d{15,22}
 *   bilibili  https://www.bilibili.com/video/(BV[0-9A-Za-z]{10,20}|av\d{1,20})
 *   youtube   https://www.youtube.com/watch?v=[0-9A-Za-z_-]{11}
 */

export type VideoLink = {
  platform: 'douyin' | 'bilibili' | 'youtube';
  label: string;
  url: string;
};

const URL_RE = /https?:\/\/[^\s，。；、）】》"'<>]+/i;

function firstUrl(input: string): string {
  const hit = input.match(URL_RE)?.[0] || input.trim();
  return hit.replace(/[.,;:!?]+$/, '');
}

export function parseVideoShare(input: string): VideoLink | null {
  const raw = firstUrl(input);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const path = url.pathname.replace(/\/+$/, '');
  const search = url.searchParams;

  if (host === 'douyin.com' && /^\/video\/\d{15,22}$/.test(path)) {
    return { platform: 'douyin', label: '抖音视频', url: `https://www.douyin.com${path}` };
  }

  if (host === 'bilibili.com') {
    const hit = path.match(/^\/video\/(BV[0-9A-Za-z]{10,20}|av\d{1,20})$/);
    if (hit) return { platform: 'bilibili', label: '哔哩哔哩视频', url: `https://www.bilibili.com/video/${hit[1]}` };
  }

  if (host === 'youtube.com') {
    const id = search.get('v') || path.match(/^\/shorts\/([0-9A-Za-z_-]{11})$/)?.[1];
    if (id && /^[0-9A-Za-z_-]{11}$/.test(id)) {
      return { platform: 'youtube', label: 'YouTube视频', url: `https://www.youtube.com/watch?v=${id}` };
    }
  }
  if (host === 'youtu.be') {
    const id = path.replace(/^\//, '');
    if (/^[0-9A-Za-z_-]{11}$/.test(id)) {
      return { platform: 'youtube', label: 'YouTube视频', url: `https://www.youtube.com/watch?v=${id}` };
    }
  }

  return null;
}

const SHORT_LINKS: Array<{ host: RegExp; platform: 'douyin' | 'bilibili'; label: string }> = [
  { host: /(^|\.)v\.douyin\.com$/i, platform: 'douyin', label: '抖音视频' },
  { host: /(^|\.)b23\.tv$/i, platform: 'bilibili', label: '哔哩哔哩视频' },
];

/**
 * 官方是服务端跟随短链跳转后再校验；App 侧等价做法：直接请求并读 response.url。
 * 解析失败时退回原始短链（站点仍可能识别），不阻断用户。
 */
export async function resolveVideoShare(input: string): Promise<VideoLink | null> {
  const direct = parseVideoShare(input);
  if (direct) return direct;
  const raw = firstUrl(input);
  let host = '';
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  const short = SHORT_LINKS.find((item) => item.host.test(host));
  if (!short) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(raw, { redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    const finalUrl = response.url || raw;
    return parseVideoShare(finalUrl) || { platform: short.platform, label: short.label, url: finalUrl };
  } catch {
    return { platform: short.platform, label: short.label, url: raw };
  }
}
