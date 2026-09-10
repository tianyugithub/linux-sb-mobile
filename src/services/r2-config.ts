import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'lsb.r2.config';
const TARGET_KEY = 'lsb.image.uploadTarget';

export type ImageUploadTarget = 'official' | 'r2';
const PROBE_OBJECT = 'lsb-app-probe.txt';
const JURISDICTIONS = ['default', 'eu', 'us', 'fedramp'] as const;

export type R2Jurisdiction = (typeof JURISDICTIONS)[number];

export type R2Config = {
  accountId: string;
  token: string;
  bucket: string;
  publicHost: string;
  jurisdiction?: R2Jurisdiction;
};

export const EMPTY_R2_CONFIG: R2Config = {
  accountId: '',
  token: '',
  bucket: '',
  publicHost: '',
};

const OFFICIAL_UPLOAD_ROLES = new Set(['创作者', '社区主理人', '建设者', '站长']);

/**
 * 官网上传能力：优先用「页面里到底有没有附件上传入口」这个实测结果
 * （官网给新用户组开权限时组名表就会过期），组名表只作兜底。
 */
let officialUploadProbe: boolean | null = null;

export function rememberOfficialUploadCapability(canUpload: boolean) {
  officialUploadProbe = canUpload;
}

/** 切账号时清掉探测结果，避免把上一个账号的权限带到新账号。 */
export function resetOfficialUploadCapability() {
  officialUploadProbe = null;
}

export function hasOfficialImageUpload(me?: { group?: string | null; groupLabel?: string | null } | null): boolean {
  if (officialUploadProbe !== null) return officialUploadProbe;
  const labels = [me?.group, me?.groupLabel].map((item) => String(item || '').trim()).filter(Boolean);
  return labels.some((label) => OFFICIAL_UPLOAD_ROLES.has(label));
}

export function normalizeR2Host(raw: string): string {
  return raw.trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/^\/+/, '');
}

function isJurisdiction(value: string): value is R2Jurisdiction {
  return (JURISDICTIONS as readonly string[]).includes(value);
}

export function sanitizeR2Config(input: Partial<R2Config> | null | undefined): R2Config {
  const jurisdiction = String(input?.jurisdiction || '').trim();
  return {
    accountId: String(input?.accountId ?? '').trim(),
    token: String(input?.token ?? '').trim(),
    bucket: sanitizeBucketName(String(input?.bucket ?? '')),
    publicHost: normalizeR2Host(String(input?.publicHost ?? '')),
    ...(isJurisdiction(jurisdiction) && jurisdiction !== 'default' ? { jurisdiction } : {}),
  };
}

export function isR2Ready(config: R2Config): boolean {
  const next = sanitizeR2Config(config);
  return Boolean(next.accountId && next.token && next.bucket && next.publicHost);
}

export function resolveImageUploadTarget(opts: {
  official: boolean;
  r2: boolean;
  saved?: ImageUploadTarget | null;
}): ImageUploadTarget | null {
  if (opts.official && opts.r2) return opts.saved === 'r2' ? 'r2' : 'official';
  if (opts.official) return 'official';
  if (opts.r2) return 'r2';
  return null;
}

async function readStore(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return webStore()?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeStore(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore()?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function loadImageUploadTarget(): Promise<ImageUploadTarget | null> {
  const raw = (await readStore(TARGET_KEY) || '').trim();
  return raw === 'official' || raw === 'r2' ? raw : null;
}

export async function saveImageUploadTarget(target: ImageUploadTarget): Promise<void> {
  try {
    await writeStore(TARGET_KEY, target);
  } catch {
    /* ignore */
  }
}

export function r2PublicUrl(config: R2Config, objectKey: string): string {
  const host = normalizeR2Host(config.publicHost);
  const key = objectKey.replace(/^\/+/, '');
  return `https://${host}/${key}`;
}

function webStore(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export async function loadR2Config(): Promise<R2Config> {
  try {
    const raw = await readStore(KEY);
    if (!raw) return { ...EMPTY_R2_CONFIG };
    return sanitizeR2Config(JSON.parse(raw) as Partial<R2Config>);
  } catch {
    return { ...EMPTY_R2_CONFIG };
  }
}

export async function saveR2Config(input: Partial<R2Config>): Promise<R2Config> {
  const next = sanitizeR2Config(input);
  await writeStore(KEY, JSON.stringify(next));
  return next;
}

export async function clearR2Config(): Promise<void> {
  if (Platform.OS === 'web') {
    webStore()?.removeItem(KEY);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* ignore */
  }
}

function sanitizeBucketName(raw: string): string {
  return raw.trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .split('/')[0]
    .trim();
}

function looksLikeHost(value: string): boolean {
  const text = sanitizeBucketName(value).toLowerCase();
  if (!text) return false;
  if (text.endsWith('.r2.dev') || text.endsWith('.cloudflarestorage.com')) return true;
  return text.includes('.') && /[a-z]/.test(text);
}

function looksLikeAccessKey(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value.trim());
}

function cloudflareMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const errors = (payload as { errors?: { message?: string; code?: number }[] }).errors;
  const hit = errors?.find((item) => item?.message);
  const message = hit?.message
    || (payload as { error?: string }).error
    || (payload as { message?: string }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

function cloudflareCode(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const code = (payload as { errors?: { code?: number }[] }).errors?.find((item) => item?.code)?.code;
  return typeof code === 'number' ? code : null;
}

function explainR2Error(payload: unknown, fallback: string, extra?: string): string {
  const code = cloudflareCode(payload);
  const raw = cloudflareMessage(payload, fallback);
  if (code === 10006 || /specified bucket does not exist/i.test(raw)) {
    return extra || '找不到这个桶。桶名要填 R2 控制台里的名字，不要填域名或 pub-xxx.r2.dev';
  }
  if (code === 10005 || /bucket name is not valid/i.test(raw)) {
    return '桶名不合法。只能用小写字母、数字和连字符，不要填网址';
  }
  if (code === 10000 || code === 9106 || /authentication/i.test(raw)) {
    return '认证失败。账户 ID 请填 Overview 那串 32 位，令牌请填 User API Token（cfut_ 开头），不要填 S3 Access Key';
  }
  if (code === 10026 || /permission|forbidden|not authorized/i.test(raw)) {
    return '令牌没有这个桶的对象写入权限，请在 API Tokens 里勾选 Workers R2 Storage 编辑';
  }
  if (/specified bucket does not exist/i.test(raw)) {
    return extra || '找不到这个桶。请核对 R2 控制台里的桶名';
  }
  return /[A-Za-z]/.test(raw) && !/[\u4e00-\u9fff]/.test(raw) ? `${raw}${extra ? `。${extra}` : ''}` : raw;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message))) {
      throw new Error('连接 Cloudflare 超时，请检查网络后重试');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.trim().slice(0, 180) };
  }
}

function r2Headers(token: string, jurisdiction?: R2Jurisdiction, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...extra,
  };
  if (jurisdiction && jurisdiction !== 'default') headers['cf-r2-jurisdiction'] = jurisdiction;
  return headers;
}

function bucketUrl(accountId: string, bucket: string, objectKey?: string): string {
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}`;
  if (!objectKey) return base;
  return `${base}/objects/${encodeURIComponent(objectKey)}`;
}

function orderJurisdictions(preferred?: R2Jurisdiction): R2Jurisdiction[] {
  if (!preferred) return [...JURISDICTIONS];
  return [preferred, ...JURISDICTIONS.filter((item) => item !== preferred)];
}

async function listBucketNames(config: R2Config): Promise<string[]> {
  try {
    const response = await fetchWithTimeout(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/r2/buckets`,
      { headers: r2Headers(config.token) },
      12_000,
    );
    const payload = await readPayload(response);
    const result = (payload as { result?: { buckets?: { name?: string }[] } } | null)?.result;
    return (result?.buckets ?? []).map((item) => String(item?.name || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function cfRequest(
  config: R2Config,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; payload: unknown; jurisdiction: R2Jurisdiction }> {
  let last: { response: Response; payload: unknown; jurisdiction: R2Jurisdiction } | null = null;
  for (const jurisdiction of orderJurisdictions(config.jurisdiction)) {
    const response = await fetchWithTimeout(
      url,
      { ...init, headers: { ...r2Headers(config.token, jurisdiction), ...(init.headers as Record<string, string> | undefined) } },
      timeoutMs,
    );
    const payload = await readPayload(response);
    const ok = response.ok && (payload as { success?: boolean } | null)?.success !== false;
    if (ok) return { response, payload, jurisdiction };
    last = { response, payload, jurisdiction };
    const code = cloudflareCode(payload);
    const raw = cloudflareMessage(payload, '');
    if (code !== 10006 && !/specified bucket does not exist/i.test(raw)) {
      return { response, payload, jurisdiction };
    }
  }
  return last as { response: Response; payload: unknown; jurisdiction: R2Jurisdiction };
}

export async function probeR2Config(input: Partial<R2Config>): Promise<{ ok: boolean; message: string; config?: R2Config }> {
  const config = sanitizeR2Config(input);
  if (!config.accountId || !config.token || !config.bucket || !config.publicHost) {
    return { ok: false, message: '请先填完账户 ID、API 令牌、桶名和公网域名' };
  }
  if (!/^[a-f0-9]{32}$/i.test(config.accountId)) {
    return { ok: false, message: '账户 ID 应是 Overview 里那串 32 位十六进制，不要填 Access Key' };
  }
  if (looksLikeAccessKey(config.token) && !config.token.startsWith('cfut_')) {
    return { ok: false, message: '令牌填的是 S3 Access Key。请到 API Tokens 创建 User Token（需要该桶对象写入），一般是 cfut_ 开头' };
  }
  if (looksLikeHost(config.bucket)) {
    return { ok: false, message: `「${config.bucket}」是域名，请填到公网域名。桶名是 R2 控制台里创建桶时的短名字` };
  }
  try {
    const got = await cfRequest(config, bucketUrl(config.accountId, config.bucket), { method: 'GET' }, 12_000);
    const gotOk = got.response.ok && (got.payload as { success?: boolean } | null)?.success !== false;
    if (!gotOk) {
      const names = (cloudflareCode(got.payload) === 10006 || /specified bucket does not exist/i.test(cloudflareMessage(got.payload, '')))
        ? await listBucketNames(config)
        : [];
      const extra = names.length
        ? `这个账户下现有的桶：${names.join('、')}。请填其中之一，不要填域名或 r2.dev`
        : '请打开 Cloudflare R2 核对桶名（区分大小写，和 linuxsb / liunxsb 这种漏字母也对不上）';
      return { ok: false, message: explainR2Error(got.payload, `Cloudflare 返回 ${got.response.status}`, extra) };
    }

    const uploaded = await cfRequest(
      { ...config, jurisdiction: got.jurisdiction },
      bucketUrl(config.accountId, config.bucket, PROBE_OBJECT),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'ok',
      },
      20_000,
    );
    const putOk = uploaded.response.ok && (uploaded.payload as { success?: boolean } | null)?.success !== false;
    if (!putOk) {
      return { ok: false, message: explainR2Error(uploaded.payload, `写入失败（${uploaded.response.status}）`) };
    }

    const next = sanitizeR2Config({ ...config, jurisdiction: uploaded.jurisdiction });
    const publicUrl = r2PublicUrl(next, PROBE_OBJECT);
    try {
      const published = await fetchWithTimeout(publicUrl, { method: 'GET' }, 10_000);
      if (!published.ok) {
        return {
          ok: false,
          message: `能写入桶，但打不开 ${publicUrl}（${published.status}）。请确认公网域名已绑到这个桶，自定义域名填 img.xxx 这种，不要带 https://`,
          config: next,
        };
      }
    } catch (error) {
      return {
        ok: false,
        message: `能写入桶，但公网域名访问失败：${error instanceof Error ? error.message : '未知错误'}。请核对已绑到这个桶的自定义域名或 r2.dev`,
        config: next,
      };
    }

    return { ok: true, message: '图床可用，已写入测试文件并能公网访问', config: next };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '无法连接 Cloudflare' };
  }
}

function objectExtension(name: string, type: string): string {
  const fromName = name.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (fromName === 'jpg' || fromName === 'jpeg' || fromName === 'png' || fromName === 'webp') return fromName === 'jpeg' ? 'jpg' : fromName;
  if (/png/i.test(type)) return 'png';
  if (/webp/i.test(type)) return 'webp';
  return 'jpg';
}

export function r2ObjectKey(name: string, type: string, uid?: string | null): string {
  const ext = objectExtension(name, type);
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const who = String(uid || 'u').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'u';
  return `lsb-${who}-${stamp}-${rand}.${ext}`;
}

export async function uploadToR2(
  file: { uri: string; name: string; type: string },
  config: R2Config,
  uid?: string | null,
): Promise<string> {
  const ready = sanitizeR2Config(config);
  if (!isR2Ready(ready)) throw new Error('请先在设置里填完 Cloudflare R2');
  if (looksLikeHost(ready.bucket)) {
    throw new Error('桶名填成了域名。请到设置改成 R2 控制台里的桶名');
  }
  const key = r2ObjectKey(file.name, file.type, uid);
  const source = await fetch(file.uri);
  if (!source.ok && source.status !== 0) throw new Error('无法读取所选图片');
  const body = await source.arrayBuffer();
  if (!body.byteLength) throw new Error('图片文件是空的');
  const uploaded = await cfRequest(
    ready,
    bucketUrl(ready.accountId, ready.bucket, key),
    {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body,
    },
    60_000,
  );
  const ok = uploaded.response.ok && (uploaded.payload as { success?: boolean } | null)?.success !== false;
  if (!ok) {
    const names = (cloudflareCode(uploaded.payload) === 10006 || /specified bucket does not exist/i.test(cloudflareMessage(uploaded.payload, '')))
      ? await listBucketNames(ready)
      : [];
    const extra = names.length ? `这个账户下现有的桶：${names.join('、')}` : undefined;
    throw new Error(explainR2Error(uploaded.payload, `R2 上传失败（${uploaded.response.status}）`, extra));
  }
  return r2PublicUrl(ready, key);
}
