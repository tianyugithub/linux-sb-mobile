import { LINUX_ORIGIN } from '../services/live';
import { decodeEntities } from './entities';

export function resolveAppHref(href: string): string | null {
  const trimmed = decodeEntities(href.trim());
  if (!trimmed || /^javascript:/i.test(trimmed)) return null;
  if (/^(mailto|tel):/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `${LINUX_ORIGIN}${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

/**
 * 官网把站外链接写成 `/jump?to=<url>&sig=…`。HTML 属性里是 `&amp;sig=`，
 * 原样打开会变成 `amp;sig` 参数，官方回 400「跳转地址无效」。
 * App 里直接打开 `to` 指向的地址，跳过中间页。
 */
export function unwrapLinuxJump(url: string): string {
  let current = url;
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = new URL(current);
      if (!isLinuxUrl(current)) return current;
      const path = next.pathname.replace(/\/+$/, '') || '/';
      if (path !== '/jump') return current;
      const to = String(next.searchParams.get('to') ?? '').trim();
      if (!/^https?:\/\//i.test(to)) return current;
      current = to;
    } catch {
      return current;
    }
  }
  return current;
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function isLinuxUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    return host === 'linux.sb' || host.endsWith('.linux.sb');
  } catch {
    return false;
  }
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

export function linuxPath(url: string): string {
  try {
    const next = new URL(url);
    return `${next.pathname}${next.search}`;
  } catch {
    return url;
  }
}

export type AppHrefAction =
  | { type: 'ignore' }
  | { type: 'topic'; id: string; replyId?: string; floor?: string }
  | { type: 'user'; id: string }
  | { type: 'login' }
  | { type: 'register' }
  | { type: 'home'; sort: string }
  | { type: 'wallet' }
  | { type: 'browser'; url: string };

function linuxHomeSort(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/topic_essence_review_list') return '申精';
  return null;
}

export function classifyAppHref(href: string): AppHrefAction {
  const resolved = resolveAppHref(href);
  if (!resolved) return { type: 'ignore' };
  const abs = unwrapLinuxJump(resolved);
  try {
    const next = new URL(abs);
    if (isLinuxUrl(abs)) {
      const topicHit = next.pathname.match(/^\/topic\/(\d+)/);
      if (topicHit) {
        const replyId = next.searchParams.get('replyid')?.trim() || '';
        const floor = next.searchParams.get('floor')?.trim() || '';
        return {
          type: 'topic',
          id: topicHit[1],
          replyId: /^\d+$/.test(replyId) ? replyId : undefined,
          floor: /^\d+$/.test(floor) ? floor : undefined,
        };
      }
      const userHit = next.pathname.match(/^\/user\/(\d+)/);
      if (userHit) return { type: 'user', id: userHit[1] };
      if (next.pathname === '/login' || next.pathname.replace(/\/+$/, '') === '/login') return { type: 'login' };
      if (next.pathname === '/register' || next.pathname.replace(/\/+$/, '') === '/register') return { type: 'register' };
      const homeSort = linuxHomeSort(next.pathname);
      if (homeSort) return { type: 'home', sort: homeSort };
      const path = next.pathname.replace(/\/+$/, '') || '/';
      if (path === '/community_wallet') return { type: 'wallet' };
    }
  } catch {
    /* mailto / tel / opaque */
  }
  return { type: 'browser', url: abs };
}
