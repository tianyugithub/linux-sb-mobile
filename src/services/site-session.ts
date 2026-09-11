import type { SessionDto, UserDto } from '../types/api';
import { keepAuthCookie } from './session-keep';

export type UpstreamSession = {
  cookies: string;
  user: UserDto;
  refreshToken: string;
};

export type SiteSessionSnapshot = {
  sessions: Record<string, UpstreamSession>;
  refresh: Record<string, string>;
};

const byAccess = new Map<string, UpstreamSession>();
const byRefresh = new Map<string, string>();

let persistHook: ((snapshot: SiteSessionSnapshot) => void) | null = null;

function snapshot(): SiteSessionSnapshot {
  const sessions: Record<string, UpstreamSession> = {};
  for (const [token, record] of byAccess) sessions[token] = record;
  const refresh: Record<string, string> = {};
  for (const [token, access] of byRefresh) refresh[token] = access;
  return { sessions, refresh };
}

function persist() {
  persistHook?.(snapshot());
}

export function setSiteSessionPersist(hook: ((snapshot: SiteSessionSnapshot) => void) | null) {
  persistHook = hook;
}

export function getSiteSessionSnapshot(): SiteSessionSnapshot {
  return snapshot();
}

export function restoreSiteSession(data: SiteSessionSnapshot | null | undefined) {
  byAccess.clear();
  byRefresh.clear();
  Object.entries(data?.sessions ?? {}).forEach(([token, record]) => {
    if (record?.refreshToken && record.user) byAccess.set(token, record);
  });
  Object.entries(data?.refresh ?? {}).forEach(([refreshToken, accessToken]) => {
    if (byAccess.has(accessToken)) byRefresh.set(refreshToken, accessToken);
  });
}

function tokenPart(): string {
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
}

export function createUpstreamSession(cookies: string, user: UserDto): SessionDto {
  const token = `lsb.${tokenPart()}`;
  const refreshToken = `lsr.${tokenPart()}`;
  const record: UpstreamSession = { cookies, user, refreshToken };
  byAccess.set(token, record);
  byRefresh.set(refreshToken, token);
  persist();
  return { token, refreshToken, user };
}

export function cookiesForToken(token: string | null): string | null {
  if (!token) return null;
  return byAccess.get(token)?.cookies ?? null;
}

export function sessionForToken(token: string | null): UpstreamSession | null {
  if (!token) return null;
  return byAccess.get(token) ?? null;
}

export function rotateUpstreamSession(refreshToken: string): SessionDto | null {
  const oldToken = byRefresh.get(refreshToken);
  if (!oldToken) return null;
  const old = byAccess.get(oldToken);
  if (!old) return null;
  byAccess.delete(oldToken);
  byRefresh.delete(refreshToken);
  return createUpstreamSession(old.cookies, old.user);
}

export function destroyUpstreamSession(token: string | null): void {
  if (!token) return;
  const record = byAccess.get(token);
  byAccess.delete(token);
  if (record) byRefresh.delete(record.refreshToken);
  persist();
}

export function updateUpstreamUser(token: string, user: UserDto): void {
  const record = byAccess.get(token);
  if (record) {
    record.user = user;
    persist();
  }
}

export function updateUpstreamCookies(token: string, cookies: string): void {
  const record = byAccess.get(token);
  if (record) {
    // 游客页 / CDN 的 Set-Cookie 经常不含 bbs_auth，不能让内存 jar 先变成游客。
    record.cookies = keepAuthCookie(cookies, record.cookies);
    persist();
  }
}
