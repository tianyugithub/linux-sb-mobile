/**
 * GitHub 在国内常被 DNS 污染或直连拦截。
 * 更新检查 / 下载安装包：先走国内可访问的镜像，再试原地址（Android 上原地址走 DoH）。
 */

const GITHUB_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
  'release-assets.githubusercontent.com',
]);

/** 前缀镜像：把完整 https://github.com/… 接到后面。gh-proxy 对 API / APK / raw 都通。 */
const PREFIX_PROXIES = [
  'https://gh-proxy.com/',
  'https://ghfast.top/',
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isGithubUrl(url: string): boolean {
  return GITHUB_HOSTS.has(hostnameOf(url));
}

function jsdelivrFromRaw(parsed: URL): string | null {
  if (parsed.hostname.replace(/^www\./i, '') !== 'raw.githubusercontent.com') return null;
  const parts = parsed.pathname.replace(/^\//, '').split('/');
  if (parts.length < 4) return null;
  const [owner, repo, ref, ...rest] = parts;
  if (!owner || !repo || !ref || rest.length === 0) return null;
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${rest.join('/')}`;
}

/** 同一个 GitHub 地址的镜像 + 直连。国内镜像放前面，避免先卡在被墙的原站。 */
export function githubAccessUrls(url: string): string[] {
  const src = url.trim();
  if (!src) return [];
  if (!isGithubUrl(src)) return [src];
  const out: string[] = [];
  const push = (next: string) => {
    const value = next.trim();
    if (value && !out.includes(value)) out.push(value);
  };
  for (const prefix of PREFIX_PROXIES) push(`${prefix}${src}`);
  try {
    const parsed = new URL(src);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'raw.githubusercontent.com') {
      const jsdelivr = jsdelivrFromRaw(parsed);
      if (jsdelivr) push(jsdelivr);
    }
  } catch {
    /* ignore */
  }
  push(src);
  return out;
}

/** 内置浏览器已用 DoH 代理，仓库页直接开 github.com（走香港节点）。 */
export function githubBrowseUrl(url: string): string {
  return url.trim();
}

export async function fetchGithub(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 8_000, ...rest } = init;
  let lastError: Error | null = null;
  for (const next of githubAccessUrls(url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(next, { ...rest, signal: controller.signal });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('GitHub 无法访问');
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('GitHub 无法访问');
}
