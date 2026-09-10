import { LINUX_ORIGIN } from '../services/live';

export function resolveAppHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || /^javascript:/i.test(trimmed)) return null;
  if (/^(mailto|tel):/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `${LINUX_ORIGIN}${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
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
  | { type: 'browser'; url: string };

function linuxHomeSort(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/topic_essence_review_list') return '申精';
  return null;
}

export function classifyAppHref(href: string): AppHrefAction {
  const abs = resolveAppHref(href);
  if (!abs) return { type: 'ignore' };
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
    }
  } catch {
    /* mailto / tel / opaque */
  }
  return { type: 'browser', url: abs };
}
