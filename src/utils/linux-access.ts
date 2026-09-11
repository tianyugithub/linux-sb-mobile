/**
 * 国内访问 linux.sb 的三套通道：
 *   - mirror（默认，设置里叫「镜像」）：请求改写到 https://lsb.miapi.cc ，
 *     美国机再反代到官网。TLS SNI 是镜像域名，国内才能过。
 *   - doh：直连 linux.sb，DNS 只问 stellafortuna query-dns；握手会拆 TLS 记录。
 *   - direct：直连 linux.sb，DNS 走 1.1.1.1 / 8.8.8.8，并探测 Cloudflare Anycast；
 *     握手同样拆 TLS 记录。系统到 Android 17 时还会尝试 ECH。
 *
 * 分享、跳转识别仍用官方域名。
 */

export const LINUX_ORIGIN = 'https://linux.sb';
export const LINUX_MIRROR_ORIGIN = 'https://lsb.miapi.cc';
export const LINUX_CAP_ORIGIN = 'https://cap.linux.sb';
export const LINUX_CAP_MIRROR_ORIGIN = 'https://cap-lsb.miapi.cc';
export const LINUX_MIRROR_HOST = 'lsb.miapi.cc';
export const LINUX_CAP_MIRROR_HOST = 'cap-lsb.miapi.cc';
export const LINUX_CAP_PREFIX = '/__cap__';
/** 镜像反代所在的美国机；App 把 lsb.miapi.cc 钉到这里。 */
export const LINUX_MIRROR_PIN_HOST = '154.12.50.175';
/** DoH 通道：国内能问到的 stellafortuna query-dns。 */
export const LINUX_DOH_QUERY = 'https://stellafortuna.ddd.oaifree.com/query-dns';

export type AccessChannel = 'mirror' | 'doh' | 'direct';

export const ACCESS_CHANNELS: AccessChannel[] = ['mirror', 'doh', 'direct'];

export const ACCESS_CHANNEL_LABEL: Record<AccessChannel, string> = {
  mirror: '镜像',
  doh: 'DoH',
  direct: '直连',
};

let channel: AccessChannel = 'mirror';

export function normalizeAccessChannel(next: string | null | undefined): AccessChannel {
  return next === 'direct' || next === 'doh' ? next : 'mirror';
}

export function configureAccessChannel(next: AccessChannel) {
  channel = normalizeAccessChannel(next);
}

export function getAccessChannel(): AccessChannel {
  return channel;
}

export function liveBase(next: AccessChannel = channel): string {
  return next === 'mirror' ? LINUX_MIRROR_ORIGIN : LINUX_ORIGIN;
}

export function liveCapBase(next: AccessChannel = channel): string {
  return next === 'mirror' ? LINUX_CAP_MIRROR_ORIGIN : LINUX_CAP_ORIGIN;
}

export function liveUrl(path: string, next: AccessChannel = channel): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${liveBase(next)}${suffix}`;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isOfficialLinuxHost(host: string): boolean {
  const h = host.replace(/^www\./i, '').toLowerCase();
  return h === 'linux.sb' || h.endsWith('.linux.sb');
}

export function isMirrorHost(host: string): boolean {
  const h = host.replace(/^www\./i, '').toLowerCase();
  return h === LINUX_MIRROR_HOST || h === LINUX_CAP_MIRROR_HOST;
}

export function isLinuxSiteHost(host: string): boolean {
  return isOfficialLinuxHost(host) || isMirrorHost(host);
}

export function isLinuxSiteUrl(url: string): boolean {
  try {
    return isLinuxSiteHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isLiveOrigin(origin: string): boolean {
  return origin === LINUX_ORIGIN
    || origin === LINUX_MIRROR_ORIGIN
    || origin === LINUX_CAP_ORIGIN
    || origin === LINUX_CAP_MIRROR_ORIGIN;
}

function stripCapPrefix(pathname: string): string {
  if (pathname === LINUX_CAP_PREFIX) return '/';
  if (pathname.startsWith(`${LINUX_CAP_PREFIX}/`)) return pathname.slice(LINUX_CAP_PREFIX.length) || '/';
  return pathname;
}

function parseHttpUrl(url: string): URL | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function officialLinuxUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) return url.trim();
  const host = parsed.hostname.toLowerCase();
  if (host === LINUX_CAP_MIRROR_HOST) {
    parsed.hostname = 'cap.linux.sb';
    return parsed.toString();
  }
  if (host !== LINUX_MIRROR_HOST) return parsed.toString();
  const path = parsed.pathname;
  if (path === LINUX_CAP_PREFIX || path.startsWith(`${LINUX_CAP_PREFIX}/`)) {
    parsed.hostname = 'cap.linux.sb';
    parsed.pathname = stripCapPrefix(path);
    return parsed.toString();
  }
  parsed.hostname = 'linux.sb';
  return parsed.toString();
}

export function mirrorLinuxUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) return url.trim();
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  if (host === 'cap.linux.sb' || host === LINUX_CAP_MIRROR_HOST) {
    parsed.hostname = LINUX_CAP_MIRROR_HOST;
    return parsed.toString();
  }
  if (host === 'linux.sb' || host === LINUX_MIRROR_HOST) {
    if (path === LINUX_CAP_PREFIX || path.startsWith(`${LINUX_CAP_PREFIX}/`)) {
      parsed.hostname = LINUX_CAP_MIRROR_HOST;
      parsed.pathname = stripCapPrefix(path);
      return parsed.toString();
    }
    parsed.hostname = LINUX_MIRROR_HOST;
    return parsed.toString();
  }
  return parsed.toString();
}

/** 镜像通道改到 lsb.miapi.cc；DoH / 直连保持官网，并把旧镜像折回官网。 */
export function rewriteLinuxUrl(url: string, next: AccessChannel = channel): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) return url.trim();
  if (!isLinuxSiteHost(parsed.hostname)) return parsed.toString();
  return next === 'mirror' ? mirrorLinuxUrl(parsed.toString()) : officialLinuxUrl(parsed.toString());
}

/** 按当前通道改写站内地址；GitHub / 外链原样返回。 */
export function viaAccess(url: string, next: AccessChannel = channel): string {
  return rewriteLinuxUrl(url, next);
}

/**
 * WebView 导航落到另一条通道的站内域名时，改到当前通道。已经对上或外链时返回 null。
 */
export function adoptAccessUrl(url: string, next: AccessChannel = channel): string | null {
  const parsed = parseHttpUrl(url);
  if (!parsed || !isLinuxSiteHost(parsed.hostname)) return null;
  const rewritten = rewriteLinuxUrl(parsed.toString(), next);
  return rewritten === parsed.toString() ? null : rewritten;
}
