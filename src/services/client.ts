import { Platform } from 'react-native';
import type { ApiErrorBody } from '../types/api';
import { requestId } from '../utils/time';
import { viaAccess } from '../utils/linux-access';
import { getAccessToken, getRefreshToken, setSession, clearSession, shouldWipeOnRefreshFailure } from './session';
import { handleAuthRequest } from './upstream-auth';
import { handleLiveRequest } from './live';
import type { MockRequest, MockResponse } from './mock';

export class ApiError extends Error {
  code: string;
  requestId: string;
  status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.requestId = body.requestId;
  }
}

function remoteApiBase(): string | null {
  if (Platform.OS !== 'web') return null;
  const raw = (process.env.EXPO_PUBLIC_API_URL || '').trim();
  if (raw === 'same-origin') return '';
  if (raw) return raw.replace(/\/$/, '');
  return 'http://127.0.0.1:8788';
}

export function apiBase(): string {
  return remoteApiBase() ?? '';
}

export function mediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const abs = url.startsWith('//') ? `https:${url}` : url;
  const resolved = /^https?:\/\//i.test(abs)
    ? abs
    : abs.startsWith('/')
      ? `https://linux.sb${abs}`
      : undefined;
  if (!resolved) return undefined;
  const base = remoteApiBase();
  if (base === null) return viaAccess(resolved);
  return `${base}/media?u=${encodeURIComponent(resolved)}`;
}

function toQuery(query?: Record<string, string | number | undefined | null>): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  if (!query) return params;
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params[key] = String(value);
  });
  return params;
}

function isAuthPath(path: string): boolean {
  return path.startsWith('/auth/') || path === '/users/me';
}

async function dispatchLocal(req: MockRequest): Promise<MockResponse> {
  return isAuthPath(req.path) ? handleAuthRequest(req) : handleLiveRequest(req);
}

async function dispatchRemote(
  method: string,
  path: string,
  options?: {
    query?: Record<string, string | number | undefined | null>;
    body?: unknown;
    auth?: boolean;
  },
): Promise<MockResponse> {
  const base = remoteApiBase() ?? '';
  const query = toQuery(options?.query);
  const search = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const qs = search.toString();
  const url = `${base}${path}${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': requestId(),
  };
  const token = options?.auth === false ? null : getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options?.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let payload: { data?: unknown; error?: ApiErrorBody } = {};
  try {
    payload = (await response.json()) as { data?: unknown; error?: ApiErrorBody };
  } catch {
    payload = {};
  }
  if (payload.error || response.status >= 400) {
    return {
      status: response.status,
      error: payload.error ?? {
        code: 'HTTP_ERROR',
        message: '请求失败',
        requestId: headers['X-Request-Id'],
      },
    };
  }
  return { status: response.status, data: payload.data };
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    const req: MockRequest = {
      method: 'POST',
      path: '/auth/refresh',
      query: {},
      body: { refreshToken },
      token: null,
    };
    const result = remoteApiBase() === null
      ? await handleAuthRequest(req)
      : await dispatchRemote('POST', '/auth/refresh', { body: { refreshToken }, auth: false });
    const data = result.data as { token?: string; refreshToken?: string } | undefined;
    if (result.error || !data?.token || !data.refreshToken) {
      if (shouldWipeOnRefreshFailure()) void clearSession();
      else console.warn('[session] refresh 失败，但本地还留着 bbs_auth，不清盘');
      return false;
    }
    setSession(data.token, data.refreshToken);
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function apiRequest<T>(
  method: string,
  path: string,
  options?: {
    query?: Record<string, string | number | undefined | null>;
    body?: unknown;
    auth?: boolean;
    retry?: boolean;
  },
): Promise<T> {
  const token = options?.auth === false ? null : getAccessToken();
  const result = remoteApiBase() === null
    ? await dispatchLocal({
      method,
      path,
      query: toQuery(options?.query),
      body: options?.body,
      token,
    })
    : await dispatchRemote(method, path, options);
  if (result.status === 401 && options?.auth !== false && options?.retry !== false && path !== '/auth/refresh') {
    if (await tryRefresh()) {
      return apiRequest<T>(method, path, { ...options, retry: false });
    }
  }
  if (result.error || result.status >= 400 || result.data === undefined) {
    throw new ApiError(result.status, result.error ?? {
      code: 'HTTP_ERROR',
      message: '请求失败',
      requestId: requestId(),
    });
  }
  return result.data as T;
}
