import type { IonName } from '../../data';
import type {
  CaptchaChallengeDto,
  CollectionDto,
  CommentDto,
  DailyHotTopicDto,
  DirectConversationDto,
  DirectMessageDto,
  DirectThreadDto,
  ForumDto,
  IdentityDto,
  InviteGuestDto,
  InvitePageDto,
  NotificationDto,
  NotificationKind,
  PointsDto,
  ProfileDto,
  RankDto,
  SearchHitDto,
  SearchResultDto,
  TopicDto,
  TopicPermissions,
  TopicTag,
  UserDto,
  UserGroup,
  BarrageItemDto,
  DonateInfoDto,
  EssenceVoteDto,
  ReportFormDto,
  TopicLotteryDto,
  TopicVirtualCardDto,
  TopicCollectionPickDto,
  TopicEditorDto,
  TopicComposeInput,
  TopicLotteryComposeDto,
  TopicLotteryPrizeInputDto,
  FeedSort,
  LedgerRowDto,
  TopicFilterDto,
  TopicSpecialType,
  TopicVirtualCardComposeDto,
  TopicRedPacketComposeDto,
  TopicRedPacketDto,
} from '../types/api';
import { decodeBase64Json } from '../utils/base64';
import { decodeEntities, firstGlyph } from '../utils/entities';
import { parseRelativeToIso, requestId } from '../utils/time';
import { TITLE_DEFS, catalogTitleIn, isRoleTitle, sortTitlesByRarityDesc, titleDef } from '../data/title-catalog';
import { FEED_TAB_BY_SLUG } from '../data/feed-nav';
import { topicStampDef, topicStampKind } from '../data/topic-stamp';
import { TOPIC_STAMP_CSS_PATH, ensureStampTones } from './topic-stamp-tones';
import {
  mergeTitleCatalog,
  parseCatalogTitles,
  parseDrawResult,
  parseForgeGains,
  parseForgePage,
  parseGachaNews,
  parseMarketMine,
  parseMarketOrders,
  parseMarketPage,
  parseOwnedTitles,
  parseAccountPoints,
  parsePointsAmount,
  parseRecipes,
  parseRecyclePage,
  parseTitlePool,
} from './gacha-parse';
import { redactSecrets } from '../utils/redact';
import { MockApiError, type MockRequest, type MockResponse } from './mock';
import { cookiesForToken, sessionForToken, updateUpstreamCookies, updateUpstreamUser } from './site-session';
import { sessionAcceptsCookies } from './session';
import { isNativeApp, siteCredentials } from '../utils/runtime';
import { syncNotifySession } from 'linux-notify';
import { ESSENCE_REASON_MAX, ESSENCE_REASON_MIN } from '../data/essence';
import { hasOfficialImageUpload, isR2Ready, loadR2Config, rememberOfficialUploadCapability, uploadToR2 } from './r2-config';
import { LINUX_ORIGIN, isLiveOrigin, liveBase, viaAccess } from '../utils/linux-access';
import { hasLinuxSessionCookie, writeLinuxCookies } from '../utils/site-cookies';

export { LINUX_ORIGIN };

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const CACHE_MS = 25_000;
const AUTH_CACHE_MS = 20_000;
const FORUM_GROUP: Record<string, string> = {
  社区公告: '官方',
  社区治理: '官方',
  大禹治水: '官方',
  错误地方: '交流',
  技术交流: '交流',
  求助问答: '交流',
  深度思考: '交流',
  资源分享: '发现',
  福利放送: '发现',
  我要推广: '发现',
};
const FORUM_ICON: Record<string, IonName> = {
  社区公告: 'megaphone-outline',
  社区治理: 'scale-outline',
  大禹治水: 'water-outline',
  错误地方: 'alert-circle-outline',
  技术交流: 'code-slash-outline',
  求助问答: 'help-circle-outline',
  深度思考: 'bulb-outline',
  资源分享: 'folder-open-outline',
  福利放送: 'gift-outline',
  我要推广: 'megaphone-outline',
};
const FORUM_DESC: Record<string, string> = {
  社区公告: '站务通知、规则变更与创作者认证',
  社区治理: '规则讨论、站务共建与不当内容反馈',
  大禹治水: '水帖专区，首页不再展示',
  错误地方: '吐槽、站务反馈与不适合其他版块的讨论',
  技术交流: '开发、运维、网络、硬件与工具经验',
  求助问答: '把现象、环境和报错贴清楚，更容易得到有效回复',
  深度思考: '长文、观点与认真讨论，不适合灌水',
  资源分享: '开源项目、教程、书单与可复用资料',
  福利放送: '抽奖、发卡、公益额度与限时羊毛',
  我要推广: '产品、服务与中转相关的推广',
};
const PALETTE = ['#F05D43', '#6FA8FF', '#A78BFA', '#31B96A', '#F5A623', '#EC5477', '#81B51A', '#7C8CF8', '#F7D48A', '#3D8BFF'];

const htmlCache = new Map<string, { at: number; html: string }>();
const inflightHtml = new Map<string, Promise<string>>();
let forumCache: ForumDto[] | null = null;
let forumInflight: Promise<ForumDto[]> | null = null;
let forumEnriching: Promise<void> | null = null;
let forumEnriched = false;
let forumCacheTimer: ReturnType<typeof setTimeout> | null = null;
const forumListeners = new Set<(items: ForumDto[]) => void>();
let currentToken: string | null = null;
let lastOnlineUserIds = new Set<string>();

function rememberOnlineUserIds(html: string): Set<string> {
  const hit = html.match(/data-online-users-ids="([^"]*)"/i)
    ?? html.match(/data-online-users-ids='([^']*)'/i);
  if (!hit) return lastOnlineUserIds;
  lastOnlineUserIds = new Set(
    hit[1].split(/[,\s]+/).map((id) => id.trim()).filter((id) => /^\d+$/.test(id)),
  );
  return lastOnlineUserIds;
}

function userIsOnline(userId: string, onlineIds: Set<string>): boolean {
  const id = String(userId || '').trim();
  return /^\d+$/.test(id) && onlineIds.has(id);
}

export function bustLiveCache() {
  htmlCache.clear();
  inflightHtml.clear();
}

export function absUrl(src: string): string {
  if (!src) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('http://') || src.startsWith('https://')) return src;
  if (src.startsWith('/')) return `${LINUX_ORIGIN}${src}`;
  return `${LINUX_ORIGIN}/${src}`;
}

function decode(text: string): string {
  return decodeEntities(text);
}

function stripTags(html: string): string {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function letter(name: string): string {
  return firstGlyph(name);
}

function accentFor(seed: string, hint?: string): string {
  if (hint && /^#/.test(hint)) return hint;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash + seed.charCodeAt(i) * (i + 1)) % PALETTE.length;
  return PALETTE[hash];
}

function mapGroup(label: string): UserGroup {
  if (label === '社区主理人' || label === '建设者' || label === '站长') return '社区主理人';
  if (label === '创作者') return '创作者';
  if (label === '访客') return '访客';
  return '饼友';
}

function parseGachaTitle(source: string): { name: string; serial: string } {
  const raw = first(source, /gacha-title-name">([^<]+)/) || '';
  const name = titleDef(raw)?.name || catalogTitleIn(raw) || raw.trim();
  if (!name || isRoleTitle(name)) return { name: '', serial: '' };
  const serialRaw = (first(source, /gacha-title-serial">([^<]+)/)
    || first(source, /gacha-title-rarity">([^<]+)/)
    || '').trim();
  return { name, serial: /^\d+$/.test(serialRaw) ? serialRaw : '' };
}

function gachaTitleLabel(source: string): string {
  return parseGachaTitle(source).name;
}

function isTitleAsset(src: string): boolean {
  return /gacha-title|title-badge|\/titles?\//i.test(src);
}

function avatarSrcFrom(block: string): string | null {
  const labeled = block.match(/class="[^"]*(?:post-avatar|avatar-img|user-avatar)[^"]*"[\s\S]{0,800}?src="([^"]+)"/i)
    || block.match(/src="([^"]+)"[^>]*class="[^"]*(?:post-avatar|avatar-img|user-avatar)[^"]*"/i);
  if (labeled?.[1] && !isTitleAsset(labeled[1])) return labeled[1];
  for (const hit of block.matchAll(/src="([^"]+)"/gi)) {
    const src = hit[1];
    if (!src || isTitleAsset(src) || /data:image\/svg/i.test(src)) continue;
    return src;
  }
  return null;
}

function wrapCommentHtml(html: string): string {
  if (/<li\b[^>]*class="[^"]*post-item/i.test(html)) return `<ul>${html}</ul>`;
  return `<ul><li class="post-item post-reply">${html}</li></ul>`;
}

function commentHtmlFrom(json: Record<string, unknown> | null): string {
  if (!json) return '';
  for (const key of ['html', 'post_html', 'reply_html', 'content']) {
    const value = json[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function liveCookie(): string | null {
  return cookiesForToken(currentToken);
}

function liveSessionUser() {
  return sessionForToken(currentToken)?.user;
}

function ok(data: unknown, status = 200): MockResponse {
  return { status, data };
}

function match(path: string, pattern: RegExp): string[] | null {
  const matched = path.match(pattern);
  return matched ? matched.slice(1) : null;
}

export function isLoginWall(html: string): boolean {
  return /<title>登录/.test(html) && !html.includes('class="post-list"');
}

export function parseCurrentUserId(html: string): string | null {
  const mine = html.match(/class="nav-mine(?![^"]*guest)[^"]*"[^>]*href="\/user\/(\d+)/)
    || html.match(/href="\/user\/(\d+)"[^>]*class="[^"]*nav-mine(?![^"]*guest)/);
  if (mine?.[1]) return mine[1];
  const menu = html.match(/我的菜单[\s\S]{0,1200}?href="\/user\/(\d+)/);
  if (menu?.[1]) return menu[1];
  if (/nav-mine-guest/.test(html) || (/href="\/login"/.test(html) && /href="\/register"/.test(html))) return null;
  return null;
}

function parseExposedSetCookies(raw: string): string[] {
  const text = raw.trim();
  if (text.startsWith('[')) {
    try {
      const list = JSON.parse(text) as unknown;
      if (Array.isArray(list)) return list.map((item) => String(item)).filter(Boolean);
    } catch {
      /* 不是 JSON 就按老格式拆 */
    }
  }
  return text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function setCookiesOf(response: Response): string[] {
  const exposed = response.headers.get('x-lsb-set-cookie');
  if (exposed) {
    const listed = parseExposedSetCookies(exposed);
    if (listed.length) return listed;
  }
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    const listed = headers.getSetCookie();
    if (listed?.length) return listed;
  }
  const collected: string[] = [];
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie' && value) collected.push(value);
  });
  if (collected.length) return collected;
  const single = headers.get('set-cookie');
  if (!single) return [];
  return single.split(/,(?=\s*[\w-]+=)/).map((item) => item.trim()).filter(Boolean);
}

function applySetCookie(existing: string, setCookies: string[]): string {
  const map = new Map<string, string>();
  for (const part of existing.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  for (const line of setCookies) {
    const pair = line.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    const expired = /max-age=0/i.test(line) || /expires=thu, 01 jan 1970/i.test(line);
    if (!value || expired) {
      map.delete(name);
      continue;
    }
    map.set(name, value);
  }
  return [...map.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function rememberCookies(next: string) {
  if (!sessionAcceptsCookies()) return;
  if (currentToken && next) updateUpstreamCookies(currentToken, next);
  if (!next) return;
  // 退出后内存会话已拆掉，但飞着的请求还会带回 bbs_auth。
  if (hasLinuxSessionCookie(next) && !sessionForToken(currentToken)) return;
  syncNotifySession(next);
  void writeLinuxCookies(next);
}

function csrfFrom(html: string): string {
  const token = html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1]
    || html.match(/name="_csrf"[^>]*value="([^"]+)"/)?.[1];
  if (!token) throw new MockApiError(502, 'UPSTREAM', '无法读取安全校验，请刷新后重试');
  return token;
}

function requireCookie(): string {
  const cookie = liveCookie();
  if (cookie) return cookie;
  if (currentToken && isNativeApp()) return '';
  throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
}

function currentUserId(): string | null {
  return sessionForToken(currentToken)?.user.id ?? null;
}

function flashMessage(html: string): string {
  const raw = html.match(/__pageFlash\s*=\s*"((?:\\.|[^"\\])*)"/)?.[1]
    ?? html.match(/id="toast"[^>]*>([^<]+)/)?.[1]
    ?? '';
  return decode(raw.replace(/\\"/g, '"'));
}

function isMissingTopicPage(html: string): boolean {
  if (/class="post-content-title"/.test(html) || /id="post-\d+"/.test(html)) return false;
  if (/form-error-panel/i.test(html) && /<h2>\s*404\s*<\/h2>/i.test(html)) return true;
  if (/你访问的帖子可能已经删除|主题不存在|帖子不存在|页面不存在/.test(html)) return true;
  return /<title>\s*404\b/i.test(html);
}

function missingTopicMessage(html: string): string {
  const fromPanel = html.match(/form-error-panel[\s\S]*?<p>([^<]+)<\/p>/i)?.[1]?.trim();
  return decode(fromPanel || '') || '帖子不存在或已删除';
}

function requireTopicPage(html: string) {
  if (isLoginWall(html) && !/id="post-/.test(html) && !/post-content-title/.test(html)) {
    throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后查看该主题');
  }
  if (isMissingTopicPage(html)) {
    throw new MockApiError(404, 'NOT_FOUND', missingTopicMessage(html));
  }
}

export function parseFormErrorMessage(html: string, cookies = '', url = ''): string | null {
  const fromPage = html.match(/form-error-panel[\s\S]*?<p>([^<]+)<\/p>/i)?.[1]?.trim();
  if (fromPage) return fromPage;
  const fromCookie = decodeFormError(cookies);
  if (fromCookie) return fromCookie;
  if (/form_error/i.test(url) || /<title>操作失败/.test(html)) {
    return flashMessage(html) || '操作失败，请重试';
  }
  return null;
}

function formError(html: string, fallback: string): string {
  return parseFormErrorMessage(html, liveCookie() ?? '')
    || flashMessage(html)
    || first(html, /class="[^"]*(?:error|alert|flash)[^"]*"[^>]*>([\s\S]*?)<\//)
    || fallback;
}

function decodeFormError(cookies: string): string | null {
  const match = cookies.match(/(?:^|; )__form_error=([^;]+)/);
  if (!match) return null;
  try {
    const raw = decodeURIComponent(match[1]);
    const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    const parsed = decodeBase64Json<{ message?: string }>(padded);
    return parsed?.message?.trim() || null;
  } catch {
    return null;
  }
}

function decodeFlashCookie(cookies: string): string | null {
  const match = cookies.match(/(?:^|; )__flash=([^;]*)/);
  if (!match) return null;
  let raw = match[1].trim();
  if (!raw || raw === 'deleted') return null;
  try {
    raw = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    raw = decode(raw);
  }
  raw = raw.replace(/^"+|"+$/g, '').trim();
  if (!raw) return null;
  try {
    const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    const parsed = decodeBase64Json<{ message?: string }>(padded);
    if (parsed?.message?.trim()) return parsed.message.trim();
  } catch {
    // plain flash text
  }
  return raw;
}

type LinuxResult = {
  status: number;
  url: string;
  html: string;
  cookies: string;
  json: Record<string, unknown> | null;
  flash?: string;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function describeUpstreamError(error: unknown): MockApiError {
  if (error instanceof MockApiError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new MockApiError(504, 'UPSTREAM', '连接超时，请检查网络后重试');
  }
  const raw = error instanceof Error ? error.message : '';
  if (!raw || /network request failed|failed to fetch|load failed|err_connection|econnreset|ssl|timed out|timeout/i.test(raw)) {
    return new MockApiError(502, 'UPSTREAM', '暂时连不上官网，请再试一次');
  }
  return new MockApiError(502, 'UPSTREAM', raw);
}

function isRetryableUpstream(error: unknown): boolean {
  if (error instanceof MockApiError) return error.status === 502 || error.status === 504;
  return true;
}

async function linuxRequest(path: string, init?: {
  method?: string;
  body?: URLSearchParams | FormData;
  headers?: Record<string, string>;
  cookie?: string | null;
  accept?: string;
  timeoutMs?: number;
}): Promise<LinuxResult> {
  let last: unknown;
  const tries = init?.method && init.method !== 'GET' && init.method !== 'HEAD' ? 1 : 2;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 15_000);
    try {
      return await linuxRequestOnce(path, init, controller);
    } catch (error) {
      last = error;
      if (!isRetryableUpstream(error) && !(error instanceof Error && error.name === 'AbortError')) {
        throw describeUpstreamError(error);
      }
      if (attempt < tries - 1) await sleep(350 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw describeUpstreamError(last);
}

async function linuxRequestOnce(
  path: string,
  init: {
    method?: string;
    body?: URLSearchParams | FormData;
    headers?: Record<string, string>;
    cookie?: string | null;
    accept?: string;
    timeoutMs?: number;
  } | undefined,
  controller: AbortController,
): Promise<LinuxResult> {
  let cookie = init?.cookie !== undefined ? init.cookie : liveCookie();
  const baseHeaders: Record<string, string> = {
    Accept: init?.accept ?? 'text/html,application/xhtml+xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'User-Agent': BROWSER_UA,
    Referer: LINUX_ORIGIN + '/',
    Origin: LINUX_ORIGIN,
    ...init?.headers,
  };
  let method = init?.method ?? 'GET';
  let body = init?.body;
  let url = `${liveBase()}${path.startsWith('/') ? path : `/${path}`}`;
  let flash = '';
  let response: Response | null = null;
  let html = '';
  let resultHtml = '';
  let json: Record<string, unknown> | null = null;
  for (let hop = 0; hop < 8; hop += 1) {
    const headers: Record<string, string> = { ...baseHeaders };
    if (cookie) headers.Cookie = cookie;
    const sendBody = method !== 'GET' && method !== 'HEAD' ? body : undefined;
    const payload = sendBody instanceof URLSearchParams ? sendBody.toString() : sendBody;
    if (sendBody instanceof URLSearchParams) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    else delete headers['Content-Type'];
    const credentials = siteCredentials();
    try {
      response = await fetch(url, {
        method,
        headers,
        body: payload,
        redirect: 'manual',
        credentials,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      response = await fetch(url, {
        method,
        headers,
        body: payload,
        redirect: 'follow',
        credentials,
        signal: controller.signal,
      });
    }
    const setCookies = setCookiesOf(response);
    const incoming = setCookies.join('; ');
    const hopFlash = decodeFlashCookie(incoming);
    if (hopFlash) flash = hopFlash;
    cookie = applySetCookie(cookie ?? '', setCookies);
    if (cookie) rememberCookies(cookie);
    const loc = response.headers.get('location');
    const raw = await response.text();
    html = raw;
    if (/gacha-result-card|gacha-result-name|gacha-pull-10-item|gacha-pull-10-name|gacha-pull-100-item|gacha-pull-100-name|gacha-pull-10-grid|gacha-pull-100-grid/.test(raw)) {
      resultHtml = raw;
    }
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('json') || /^\s*[{\[]/.test(raw)) {
      try {
        json = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        /* keep previous json */
      }
    }
    if (response.status >= 300 && response.status < 400 && loc) {
      const next = new URL(loc, url);
      if (!isLiveOrigin(next.origin) && !/\.linux\.sb$/i.test(next.hostname)) break;
      url = viaAccess(next.toString());
      if (response.status === 303 || (method !== 'GET' && method !== 'HEAD' && (response.status === 301 || response.status === 302))) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    break;
  }
  if (!response) throw new MockApiError(502, 'UPSTREAM', '暂时连不上官网，请再试一次');
  return { status: response.status, url: response.url || url, html: resultHtml || html, cookies: cookie ?? '', json, flash };
}

function htmlCacheKey(url: string, cookie: string | null): string {
  const token = currentToken ?? (cookie ? 'session' : 'anon');
  return `${token}:${url}`;
}

function bustHtml(match: RegExp) {
  for (const key of [...htmlCache.keys()]) {
    if (match.test(key)) htmlCache.delete(key);
  }
}

function bustGachaCache() {
  bustAccountCache();
}

export function bustAccountCache() {
  bustHtml(/\/user\/|\/daily_checkin|\/gacha|\/identity_center|\/invite_center|\/notification|\/community_wallet/);
  bustUnreadCount();
}

function rememberUserPoints(balance: number) {
  if (!currentToken || !Number.isFinite(balance) || balance < 0) return;
  const session = sessionForToken(currentToken);
  if (session) updateUpstreamUser(currentToken, { ...session.user, points: balance });
}

function bustTopicCache(topicId: string) {
  const needles = [`/topic/${topicId}`, `/donate?topic_id=${topicId}`];
  for (const key of [...htmlCache.keys()]) {
    if (needles.some((needle) => key.includes(needle))) htmlCache.delete(key);
  }
}

/** 取官网同源静态资源（例如样式表），共用 cookie 与超时。 */
export async function linuxAsset(path: string): Promise<string> {
  const result = await linuxRequest(path, { accept: 'text/css,text/plain,*/*;q=0.8' });
  if (result.status >= 400) {
    throw new MockApiError(result.status || 502, 'UPSTREAM', `资源读取失败（${result.status}）`);
  }
  return result.html;
}

export async function fetchHtml(path: string, cookieOverride?: string | null, opts?: { fresh?: boolean }): Promise<string> {
  const cookie = cookieOverride !== undefined ? cookieOverride : liveCookie();
  const url = `${liveBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const key = htmlCacheKey(url, cookie);
  if (opts?.fresh) {
    htmlCache.delete(key);
    inflightHtml.delete(key);
  } else {
    const ttl = cookie ? AUTH_CACHE_MS : CACHE_MS;
    const cached = htmlCache.get(key);
    if (cached && Date.now() - cached.at < ttl) return cached.html;
    const pending = inflightHtml.get(key);
    if (pending) return pending;
  }
  const work = (async () => {
    const result = await linuxRequest(path, { cookie });
    if (result.status >= 500) {
      throw new MockApiError(result.status, 'UPSTREAM', `linux.sb 返回 ${result.status}`);
    }
    rememberOnlineUserIds(result.html);
    if (result.status !== 404) {
      htmlCache.set(key, { at: Date.now(), html: result.html });
    }
    return result.html;
  })().finally(() => inflightHtml.delete(key));
  inflightHtml.set(key, work);
  return work;
}

function formBody(fields: Record<string, string | number | string[]>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => body.append(key, String(item)));
    else body.append(key, String(value));
  }
  return body;
}

function asFormData(fields: Record<string, string | number | string[]>): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => body.append(key, String(item)));
    else body.append(key, String(value));
  }
  return body;
}

async function postForm(path: string, fields: Record<string, string | number | string[]>, xhr = true): Promise<LinuxResult> {
  requireCookie();
  const headers: Record<string, string> = {};
  if (xhr) {
    headers['X-Requested-With'] = 'XMLHttpRequest';
    headers.Accept = 'application/json, text/html;q=0.9';
  }
  return linuxRequest(path, {
    method: 'POST',
    body: formBody(fields),
    headers,
  });
}

async function postAjaxForm(
  path: string,
  fields: Record<string, string | number | string[]>,
  referer?: string,
): Promise<LinuxResult> {
  requireCookie();
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/html;q=0.9',
  };
  if (referer) {
    headers.Referer = referer.startsWith('http') ? referer : `${LINUX_ORIGIN}${referer.startsWith('/') ? referer : `/${referer}`}`;
  }
  return linuxRequest(path, {
    method: 'POST',
    body: asFormData(fields),
    headers,
  });
}

function postedMessage(posted: LinuxResult): string {
  if (posted.json) {
    const message = posted.json.message ?? posted.json.error ?? posted.json.msg;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return flashMessage(posted.html) || decodeFormError(posted.cookies) || posted.flash || decodeFlashCookie(posted.cookies) || '';
}

function assertGachaOk(posted: LinuxResult, fallback = '操作失败') {
  const message = postedMessage(posted);
  if (posted.json && posted.json.ok === false) {
    throw new MockApiError(400, 'UPSTREAM', message || fallback);
  }
  if (posted.status >= 400 || (message && /不足|失败|不能|无法|限制|错误|未拥有|材料不足|不够/.test(message) && !/抽到|获得|成功|完成/.test(message))) {
    throw new MockApiError(posted.status >= 400 ? posted.status : 400, 'UPSTREAM', message || fallback);
  }
  return message;
}

function nextPage(html: string, current: number): string | null {
  const re = /(?:[?&]|amp;)p=(\d+)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(html))) {
    if (Number(hit[1]) === current + 1) return String(current + 1);
  }
  return null;
}

function lastTopicPage(html: string, topicId?: string): number {
  let max = 1;
  const take = (source: string, re: RegExp) => {
    let hit: RegExpExecArray | null;
    const copy = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    while ((hit = copy.exec(source))) {
      const n = Number(hit[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  };
  if (topicId) take(html, new RegExp(`/topic/${topicId}(?:\\?|&amp;|&)p=(\\d+)`));
  const pages = html.match(/class="[^"]*topic-pages[^"]*"[\s\S]{0,1200}/);
  if (pages) take(pages[0], /(?:[?&]|amp;)p=(\d+)/);
  const pag = html.match(/class="[^"]*pagination[^"]*"[\s\S]{0,2000}/);
  if (pag) take(pag[0], /(?:[?&]|amp;)p=(\d+)/);
  const unreadHref = html.match(/unread-topic-notice[^>]*href="([^"]+)"/)
    || html.match(/href="([^"]+)"[^>]*unread-topic-notice/);
  if (unreadHref) {
    const p = unreadHref[1].match(/(?:[?&]|amp;)p=(\d+)/);
    if (p) max = Math.max(max, Number(p[1]) || 1);
  }
  return max;
}

function currentTopicPage(html: string): number {
  const pag = html.match(/class="[^"]*pagination[^"]*"[\s\S]{0,2500}/)?.[0]
    || html.match(/class="[^"]*topic-pages[^"]*"[\s\S]{0,1200}/)?.[0]
    || '';
  const active = pag.match(/<li[^>]*class="[^"]*\bactive\b[^"]*"[\s\S]*?(?:[?&]|amp;)p=(\d+)/i)
    || pag.match(/<li[^>]*class="[^"]*\bactive\b[^"]*"[\s\S]*?<a[^>]*>\s*(\d+)/i);
  const n = Number(active?.[1]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseTopicHref(href: string): { topicId: string; replyId?: string } | null {
  const decoded = href.replace(/&amp;/g, '&');
  const topicId = decoded.match(/\/topic\/(\d+)/)?.[1];
  if (!topicId) return null;
  const replyId = decoded.match(/[?&]replyid=(\d+)/i)?.[1];
  return { topicId, replyId };
}

function attr(block: string, name: string): string | null {
  const matchAttr = block.match(new RegExp(`${name}="([^"]+)"`));
  return matchAttr ? decode(matchAttr[1]) : null;
}

function first(block: string, re: RegExp): string | null {
  const hit = block.match(re);
  return hit ? decode(hit[1].replace(/<[^>]+>/g, '').trim()) : null;
}

function unixToIso(raw: string | null, fallbackLabel?: string | null): string {
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return new Date(n < 1e12 ? n * 1000 : n).toISOString();
    if (!fallbackLabel && /[^\d.]/.test(raw)) fallbackLabel = raw;
  }
  if (fallbackLabel) return parseRelativeToIso(fallbackLabel);
  return new Date().toISOString();
}

function postTimeIso(block: string): string {
  const unix = block.match(/class="post-time"[^>]*data-performance-time="(\d+)"/)?.[1]
    || block.match(/<span[^>]*class="[^"]*post-time[^"]*"[^>]*data-performance-time="(\d+)"/)?.[1]
    || null;
  const label = first(block, /class="post-time"[^>]*>([\s\S]*?)<\/span>/);
  return unixToIso(unix, label);
}

/**
 * 官方 topic_stamp 插件在标题后面挂的印章：
 *   <span class="topic-stamp-badge topic-stamp-recommend" title="推荐">荐</span>
 * 任意种类都解析（官网新加印章也能显示）：文字用页面给的字，其次 title，最后已知表的兜底字；
 * 颜色见 data/topic-stamp.ts 与 services/topic-stamp-tones.ts（未知种类去官方 CSS 学）。
 */
function stampTags(block: string): TopicTag[] {
  const tags: TopicTag[] = [];
  const re = /<span([^>]*class="[^"]*topic-stamp-badge[^"]*"[^>]*)>/gi;
  let hit = re.exec(block);
  while (hit) {
    const kind = topicStampKind(hit[1].match(/class="([^"]*)"/i)?.[1] ?? '');
    if (kind) {
      const title = decodeEntities(hit[1].match(/title="([^"]*)"/i)?.[1] ?? '').trim();
      const def = topicStampDef(kind);
      const text = stripTags(block.slice(hit.index + hit[0].length).match(/^([^<]*)/)?.[1] ?? '').trim();
      const label = text || title || def?.label || '';
      if (label) {
        tags.push({ type: def?.type ?? 'stamp', label, kind, title: title || def?.title });
      }
    }
    hit = re.exec(block);
  }
  return tags;
}

function tagsFromBlock(block: string): TopicTag[] {
  const tags: TopicTag[] = [];
  if (/topic-badge[^"]*pinned|topic-pinned|\btopic-badge pinned\b/.test(block)) {
    tags.push({ type: 'pinned', label: '置顶' });
  }
  const essence = block.match(/<span[^>]*class="[^"]*topic-badge[^"]*topic-essence-review-progress[^"]*"[^>]*>([^<]*)/i)
    || block.match(/<span[^>]*class="[^"]*topic-essence-review-progress[^"]*topic-badge[^"]*"[^>]*>([^<]*)/i);
  if (essence) {
    tags.push({ type: 'apply_featured', label: stripTags(essence[1]).trim() || '申精' });
  }
  const lottery = block.match(/community-lottery-title-status[^>]*>([^<]+)/);
  if (lottery) tags.push({ type: 'lottery', label: stripTags(lottery[1]).trim() || '抽奖中' });
  const featured = block.match(/topic-management-featured-badge[^>]*>([^<]*)/);
  if (featured || /topic-management-featured-badge/.test(block)) {
    tags.push({ type: 'featured', label: stripTags(featured?.[1] || '精华').trim() || '精华' });
  }
  stampTags(block).forEach((tag) => {
    if (!tags.some((item) => item.type === tag.type)) tags.push(tag);
  });
  const card = block.match(/virtual-card-title-status[^>]*>([^<]+)/);
  if (card) tags.push({ type: 'card', label: stripTags(card[1]).trim() || '发卡中' });
  // 红包帖：标题旁的 `<span class="red-packet-title-status">红包帖</span>`
  const redPacket = block.match(/red-packet-title-status[^>]*>([^<]+)/);
  if (redPacket) tags.push({ type: 'red_packet', label: stripTags(redPacket[1]).trim() || '红包帖' });
  return tags;
}

function parseUnreadJump(block: string): { hasUnread: boolean; unreadPage?: number; unreadFloor?: string } {
  const noticeHref = (block.match(/<a[^>]*class="[^"]*unread-topic-notice[^"]*"[^>]*href="([^"]+)"/i)
    || block.match(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*unread-topic-notice/i))?.[1];
  const hasUnread = Boolean(noticeHref) || /unread-topic-notice/.test(block);
  const href = (noticeHref || '').replace(/&amp;/g, '&');
  if (!hasUnread || !href) return { hasUnread };
  const page = Number(href.match(/[?&]p=(\d+)/)?.[1] || 0);
  const floor = href.match(/[?&]floor=(\d+)/)?.[1];
  return {
    hasUnread,
    unreadPage: page > 0 ? page : undefined,
    unreadFloor: floor || undefined,
  };
}

function parseLastReplier(block: string): { name?: string; id?: string } {
  const meta = block.match(/<div class="post-meta">([\s\S]*?)<\/div>/)?.[1];
  if (!meta) return {};
  const afterReplies = meta.match(/<\/svg>(\d+)<\/span>([\s\S]*)$/);
  if (!afterReplies) return {};
  const hit = afterReplies[2].match(
    /<span(?![^>]*data-performance-time)[^>]*>(?:<svg[\s\S]*?<\/svg>)\s*(?:<a href="\/user\/(\d+)">)?([^<]+)/i,
  );
  if (!hit) return {};
  const name = decode(hit[2].replace(/<[^>]+>/g, '').trim());
  if (!name) return {};
  return { name, id: hit[1] };
}

/**
 * 帖子列表屏蔽设置：官方插件把配置挂在首页「设置帖子列表屏蔽」按钮的 data-* 上
 * （常用关键词、可屏蔽版块、默认屏蔽版块、settings 接口、csrf），这里照同样方式读。
 * 未登录时页面没有这个按钮，返回 null（官方也是 userId < 1 直接不启用）。
 */
function parseTopicFilterContext(html: string): TopicFilterDto['context'] | null {
  const tag = html.match(/<button[^>]*data-home-keyword-filter-open[^>]*>/i)?.[0];
  if (!tag) return null;
  const attr = (name: string) => {
    const hit = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
    return hit ? decodeEntities(hit[1]).trim() : '';
  };
  const json = <T>(raw: string, fallback: T): T => {
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw) as T;
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  };
  const presets = json<unknown>(attr('data-home-keyword-filter-presets'), []);
  const policy = json<Record<string, unknown>>(attr('data-home-keyword-filter-forum-policy'), {});
  const forums = (Array.isArray(policy.forums) ? policy.forums : [])
    .map((forum) => {
      const row = forum as { id?: unknown; name?: unknown; default?: unknown };
      return {
        id: String(Number.parseInt(String(row?.id), 10) || 0),
        name: String(row?.name ?? ''),
        default: Boolean(row?.default),
      };
    })
    .filter((forum) => Number(forum.id) > 0 && forum.name !== '');
  const allowed = new Set(forums.map((forum) => forum.id));
  const defaults = (Array.isArray(policy.defaultForumIds) ? policy.defaultForumIds : [])
    .map((id) => String(Number.parseInt(String(id), 10) || 0))
    .filter((id) => allowed.has(id));
  forums.forEach((forum) => {
    if (forum.default && !defaults.includes(forum.id)) defaults.push(forum.id);
  });
  const userId = attr('data-home-keyword-filter-user-id');
  const settingsUrl = attr('data-home-keyword-filter-settings-url');
  if (!userId || userId === '0' || !settingsUrl) return null;
  return {
    userId,
    settingsUrl,
    csrf: attr('data-home-keyword-filter-csrf'),
    presets: (Array.isArray(presets) ? presets : [])
      .map((word) => String(word ?? '').trim())
      .filter(Boolean)
      .slice(0, 20),
    forums,
    defaultForumIds: defaults,
    forumEnabled: Boolean(policy.enabled),
    forumWarning: String(policy.warning ?? ''),
  };
}

/** 最近一次列表页里读到的屏蔽设置上下文。 */
let topicFilterContext: TopicFilterDto['context'] | null = null;

function rememberTopicFilterContext(html: string) {
  const parsed = parseTopicFilterContext(html);
  if (parsed) topicFilterContext = parsed;
}

function parseTopicItems(html: string): TopicDto[] {
  const onlineIds = rememberOnlineUserIds(html);
  const blocks = extractPostItems(html).filter((block) => {
    const cls = block.match(/<li\b[^>]*class="([^"]*)"/i)?.[1] ?? '';
    if (/\bpost-entry\b/.test(cls) || /topic-collections-collection-row/.test(cls)) return false;
    return /class="[^"]*post-title/.test(block) && /href="\/topic\/\d+/.test(block);
  });
  const items: TopicDto[] = [];
  blocks.forEach((block) => {
    const topicHref = block.match(/href="\/topic\/(\d+)(?:\?[^"]*)?"/);
    const title = decode(first(block, /class="post-title"[^>]*>([\s\S]*?)<\/a>/) || '');
    if (!topicHref || !title) return;
    const replyExcerpt = redactSecrets(stripTags(
      first(block, /class="profile-reply-excerpt"[^>]*>([\s\S]*?)<\/div>/) || '',
    ).trim());
    const authorHref = block.match(/href="\/user\/(\d+)"/);
    const authorUid = first(block, /user-uid-badge"[^>]*>UID\s*(\d+)/) || first(block, /UID\s*(\d+)/);
    const authorName = decode(
      first(block, /aria-label="查看\s+([^"]+?)\s+的个人主页"/)
      || first(block, /<a href="\/user\/\d+">(?:<svg[\s\S]*?<\/svg>)?([^<]+)<\/a>/)
      || '饼友',
    );
    const forumHref = block.match(/href="\/forum\/(\d+)"/);
    const forumName = decode(first(block, /href="\/forum\/\d+">([^<]+)</) || '');
    const avatarSrc = attr(block, 'src');
    const timeLabel = first(block, /data-performance-time="[^"]*">([^<]+)/);
    const timeUnix = attr(block, 'data-performance-time');
    const replyMatch = block.match(/class="post-meta"[\s\S]*?<\/svg>(\d+)<\/span>/);
    const lastReplier = parseLastReplier(block);
    const tags = tagsFromBlock(block);
    const lastPage = lastTopicPage(block, topicHref[1]);
    const jump = parseUnreadJump(block);
    items.push({
      id: topicHref[1],
      title,
      body: replyExcerpt,
      forumId: forumHref?.[1] ?? '',
      forumName,
      authorId: authorHref?.[1] ?? authorUid ?? authorName,
      authorName,
      avatar: avatarSrc ? absUrl(avatarSrc) : letter(authorName),
      accent: accentFor(authorName),
      createdAt: unixToIso(timeUnix, timeLabel),
      replyCount: replyMatch ? Number(replyMatch[1]) : 0,
      viewCount: 0,
      likeCount: 0,
      favoriteCount: 0,
      liked: false,
      favorited: false,
      tags,
      lastPage: lastPage > 1 ? lastPage : undefined,
      hasUnread: jump.hasUnread || undefined,
      unreadPage: jump.unreadPage,
      unreadFloor: jump.unreadFloor,
      lastReplier: lastReplier.name,
      lastReplierId: lastReplier.id,
      online: userIsOnline(authorHref?.[1] ?? authorUid ?? '', onlineIds),
    });
  });
  return items;
}

function rewriteHtml(html: string): string {
  return html
    .replace(/(src|href)="(\/[^"]+)"/g, (_, key, path) => `${key}="${LINUX_ORIGIN}${path}"`)
    .replace(/(src|href)="(\/\/[^"]+)"/g, (_, key, path) => `${key}="https:${path}"`);
}

function innerByClass(html: string, className: string): string {
  const start = html.search(new RegExp(`<div[^>]*class="[^"]*${className}[^"]*"[^>]*>`));
  if (start < 0) return '';
  const from = html.indexOf('>', start) + 1;
  let depth = 1;
  let i = from;
  while (i < html.length && depth > 0) {
    const open = html.indexOf('<div', i);
    const close = html.indexOf('</div>', i);
    if (close < 0) break;
    if (open >= 0 && open < close) {
      depth += 1;
      i = open + 4;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(from, close);
      i = close + 6;
    }
  }
  return html.slice(from);
}

function isRealTag(html: string, at: number, tag: string): boolean {
  const ch = html[at + 1 + tag.length];
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '>' || ch === '/';
}

function extractBalanced(html: string, start: number, tag: string): { end: number; html: string } {
  const gt = html.indexOf('>', start);
  if (gt < 0) return { end: html.length, html: html.slice(start) };
  let depth = 1;
  let i = gt + 1;
  const openNeedle = `<${tag}`;
  const closeNeedle = `</${tag}>`;
  while (i < html.length && depth > 0) {
    const close = html.indexOf(closeNeedle, i);
    if (close < 0) return { end: html.length, html: html.slice(start) };
    let open = html.indexOf(openNeedle, i);
    while (open >= 0 && open < close && !isRealTag(html, open, tag)) {
      open = html.indexOf(openNeedle, open + 1);
    }
    if (open >= 0 && open < close && isRealTag(html, open, tag)) {
      depth += 1;
      i = open + openNeedle.length;
      continue;
    }
    depth -= 1;
    i = close + closeNeedle.length;
    if (depth === 0) return { end: i, html: html.slice(start, i) };
  }
  return { end: html.length, html: html.slice(start) };
}

function collectBlocks(html: string, pattern: RegExp, tag = 'li'): string[] {
  const items: string[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let i = 0;
  while (i < html.length) {
    re.lastIndex = i;
    const hit = re.exec(html);
    if (!hit) break;
    const extracted = extractBalanced(html, hit.index, tag);
    items.push(extracted.html);
    i = Math.max(extracted.end, hit.index + 1);
  }
  return items;
}

/**
 * 兜底提取：官网把行容器类名换掉时，用内层锚点（`class="post-title"`）回溯到最近的块容器。
 * 主路径命中时不会走到这里，所以正常情况下零开销。
 */
function extractPostItemsByTitle(html: string): string[] {
  const items: string[] = [];
  const re = /class="[^"]*post-title\b/gi;
  let i = 0;
  while (i < html.length) {
    re.lastIndex = i;
    const hit = re.exec(html);
    if (!hit) break;
    let start = -1;
    let tag = 'li';
    (['li', 'article', 'div'] as const).forEach((name) => {
      const at = html.lastIndexOf(`<${name}`, hit.index);
      if (at > start) {
        start = at;
        tag = name;
      }
    });
    if (start < 0) {
      i = hit.index + hit[0].length;
      continue;
    }
    const extracted = extractBalanced(html, start, tag);
    // 只有当块真的包住了这个标题、且是帖子里那种行（带主题链接）才算一条
    if (extracted.end > hit.index && /href="\/topic\/\d+/.test(extracted.html) && !items.includes(extracted.html)) {
      items.push(extracted.html);
    }
    i = Math.max(extracted.end, hit.index + hit[0].length);
  }
  return items;
}

/**
 * 列表行提取。主路径是官网的 `class="post-item"`；
 * 万一官网改了外层类名，退一步按 `post-title` 锚点再找一遍，
 * 这样七个列表（首页/版块/用户/收藏/足迹/淘帖/通知）不会一起静默变空。
 */
function extractPostItems(html: string): string[] {
  const primary = collectBlocks(html, /<li\b[^>]*class="[^"]*post-item[^"]*"/gi);
  if (primary.length) return primary;
  return extractPostItemsByTitle(html);
}

/** 官网「确实没有内容」时的标记（空态文案/空态容器）。 */
const EMPTY_LIST_MARKER = /class="[^"]*empty-state[^"]*"|meilisearch-search-empty|暂无[^<]{0,12}</;

/**
 * 空结果哨兵：页面里明明有列表容器、也没有空态标记，却一条都没解析出来，
 * 说明官网结构变了。以前这种情况会静默返回空列表（用户以为「就是没有」），
 * 现在直接报错，让问题暴露出来：宁可报错也别静默丢。
 */
function ensureParsed<T>(html: string, items: T[], what: string, listMarker: RegExp): T[] {
  if (items.length || EMPTY_LIST_MARKER.test(html) || !listMarker.test(html)) return items;
  throw new MockApiError(502, 'UPSTREAM', `${what}解析失败：linux.sb 的页面结构可能已变化，请稍后再试或更新 App`);
}

function extractClassBlock(html: string, className: string): string {
  const re = new RegExp(`<(div|section)[^>]*class="[^"]*${className}[^"]*"`, 'i');
  const hit = re.exec(html);
  if (!hit) return '';
  return extractBalanced(html, hit.index, hit[1].toLowerCase()).html;
}

function parseTopicLottery(html: string): TopicLotteryDto | null {
  const block = extractClassBlock(html, 'community-lottery-card');
  const titleStatus = first(html, /community-lottery-title-status[^>]*>([^<]+)/);
  if (!block && !titleStatus) return null;
  const drawn = /is-drawn/.test(block) || /已开奖|已经完成/.test(block || titleStatus || '');
  const prizes = [...(block || '').matchAll(/<li>\s*<strong>([^<]+)<\/strong>\s*<span>([^<]*)<\/span>/g)].map((row) => ({
    name: decode(row[1]).trim(),
    desc: decode(row[2]).trim(),
  }));
  const winnersBlock = block?.match(/community-lottery-winners[\s\S]*$/ )?.[0] ?? '';
  const winners = [...winnersBlock.matchAll(/<a[^>]*href="\/user\/(\d+)"[^>]*>([\s\S]*?)<\/a>\s*<span>([^<]*)<\/span>/g)].map((row) => ({
    userId: row[1],
    name: stripTags(row[2]).trim(),
    prize: decode(row[3]).trim(),
  }));
  return {
    title: first(block, /<header>[\s\S]*?<b>([^<]+)/) || '抽奖帖',
    subtitle: first(block, /<header>[\s\S]*?<span>([^<]+)/) || (drawn ? '本次抽奖已经完成' : '回帖即可参与'),
    status: first(block, /community-lottery-status-pill[^>]*>([^<]+)/) || titleStatus || (drawn ? '已开奖' : '抽奖中'),
    drawn,
    participants: Number(block?.match(/(\d+)\s*人参与/)?.[1] ?? 0),
    condition: first(block, /community-lottery-condition[^>]*>([\s\S]*?)<\/div>/) || '',
    result: first(block, /community-lottery-result[^>]*>([\s\S]*?)<\/div>/) || '',
    prizes,
    winners,
  };
}

function formAttr(tag: string, name: string): string {
  return decode(tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? '');
}

function jsonRejected(json: Record<string, unknown> | null): boolean {
  if (!json || !('ok' in json)) return false;
  return json.ok === false || json.ok === 0 || json.ok === '0';
}

function publicCardMessage(message: string, codes: string[]): string {
  const text = message.trim();
  if (!text) return '兑换成功';
  if (codes.some((code) => code && text.includes(code))) return '兑换成功，卡密已显示在卡片中';
  if (/(卡密|兑换码|密钥)/.test(text) && /[A-Za-z0-9+/=_-]{12,}/.test(text)) return '兑换成功，卡密已显示在卡片中';
  return text;
}

function parseHtmlForm(html: string): { action: string; fields: Record<string, string>; submit: string; disabled: boolean; maxQuantity: number; hasQuantity: boolean } | null {
  const hit = html.match(/<form\b([^>]*)>([\s\S]*?)<\/form>/i);
  if (!hit) return null;
  const actionRaw = formAttr(hit[1], 'action') || '/virtual_card_buy';
  let action = actionRaw.trim() || '/virtual_card_buy';
  if (action.startsWith('http://') || action.startsWith('https://')) {
    try {
      action = new URL(action).pathname || '/virtual_card_buy';
    } catch {
      action = '/virtual_card_buy';
    }
  }
  if (!action.startsWith('/')) action = `/${action}`;
  const fields: Record<string, string> = {};
  let maxQuantity = 0;
  let hasQuantity = false;
  for (const row of hit[2].matchAll(/<input\b([^>]*)>/gi)) {
    const tag = row[1];
    const name = formAttr(tag, 'name');
    if (!name) continue;
    const type = (formAttr(tag, 'type') || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image') continue;
    if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(tag)) continue;
    fields[name] = formAttr(tag, 'value');
    if (/^(quantity|qty|num|count)$/i.test(name)) {
      hasQuantity = true;
      maxQuantity = Number(formAttr(tag, 'max') || 0);
    }
  }
  for (const row of hit[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = formAttr(row[1], 'name');
    if (!name) continue;
    const selected = row[2].match(/<option\b([^>]*)\bselected\b[^>]*>/i)?.[1]
      || row[2].match(/<option\b([^>]*)>/i)?.[1]
      || '';
    fields[name] = formAttr(selected, 'value');
    if (/^(quantity|qty|num|count)$/i.test(name)) hasQuantity = true;
  }
  const buttonTag = hit[2].match(/<button\b([^>]*)>/i)?.[1] || '';
  const buttonName = formAttr(buttonTag, 'name');
  if (buttonName) fields[buttonName] = formAttr(buttonTag, 'value');
  const submit = stripTags(first(hit[2], /<button\b[^>]*>([\s\S]*?)<\/button>/) || '').trim() || '兑换';
  const disabled = /<button\b[^>]*\bdisabled\b/i.test(hit[2]);
  return { action, fields, submit, disabled, maxQuantity, hasQuantity };
}

/**
 * 红包帖（官网 red_packet 插件）的主题页卡片。真实结构：
 *
 *   <section class="red-packet-card is-open">
 *     <header><div><strong>积分红包</strong><span>进行中</span></div><b>剩余红包 63 份</b></header>
 *     <div class="red-packet-card-grid">
 *       <div><span>红包类型</span><strong>固定金额红包</strong><small>每份 1 积分</small></div>
 *       …
 *     </div>
 *     <p>领取规则：随机获得；每人仅有一次随机获得机会。…</p>
 *   </section>
 *
 * 领取方式是「回帖」，回帖框里还挂着
 *   <span hidden data-red-packet-live data-red-packet-status-url="/red_packet_status?topic_id=21348">
 * 发完回复官网就拿这个地址换回新的 panel_html。表格里的文字（含剩余份数、回帖字数要求）
 * 一律以页面为准，不写死 —— 官网改文案时卡片不会失真。
 */
export function parseTopicRedPacket(html: string): TopicRedPacketDto | null {
  const block = extractClassBlock(html, 'red-packet-card');
  const titleStatus = first(html, /red-packet-title-status[^>]*>([^<]+)/);
  if (!block && !titleStatus) return null;
  const header = block.match(/<header[^>]*>([\s\S]*?)<\/header>/i)?.[1] ?? '';
  const grid = block.match(/red-packet-card-grid[^>]*>([\s\S]*?)<p[\s>]/i)?.[1] ?? '';
  const cells = [...grid.matchAll(/<div>\s*<span>([\s\S]*?)<\/span>\s*<strong>([\s\S]*?)<\/strong>\s*<small>([\s\S]*?)<\/small>\s*<\/div>/g)]
    .map((row) => ({
      label: decode(stripTags(row[1])).trim(),
      value: decode(stripTags(row[2])).trim(),
      note: decode(stripTags(row[3])).trim(),
    }))
    .filter((cell) => cell.label || cell.value);
  const state: TopicRedPacketDto['state'] = /is-exhausted/.test(block)
    ? 'exhausted'
    : /is-cancelled/.test(block)
      ? 'cancelled'
      : 'open';
  return {
    title: decode(stripTags(first(header, /<strong>([\s\S]*?)<\/strong>/) || '')).trim() || titleStatus || '红包帖',
    status: decode(stripTags(first(header, /<span>([\s\S]*?)<\/span>/) || '')).trim()
      || (state === 'exhausted' ? '已领完' : state === 'cancelled' ? '已取消' : '进行中'),
    remaining: decode(stripTags(first(header, /<b>([\s\S]*?)<\/b>/) || '')).trim(),
    state,
    cells,
    rule: decode(stripTags(first(block, /<p[^>]*>([\s\S]*?)<\/p>/) || '')).trim(),
    statusUrl: decode(
      html.match(/data-red-packet-status-url="([^"]+)"/)?.[1]
      || block.match(/data-red-packet-status-url="([^"]+)"/)?.[1]
      || '',
    ).trim(),
  };
}

/**
 * 回帖后刷新红包卡片：官网 `/red_packet_status` 回 `{ok, panel_html}`，
 * panel_html 就是新的 `.red-packet-card`。只认卡片本身，取不到就返回 null（前台保留旧卡片）。
 */
export function parseRedPacketPanel(html: string): TopicRedPacketDto | null {
  if (!/<section[^>]*class="[^"]*red-packet-card/.test(html)) return null;
  return parseTopicRedPacket(html);
}

function parseTopicVirtualCard(html: string): TopicVirtualCardDto | null {
  const block = extractClassBlock(html, 'virtual-card-box') || extractClassBlock(html, 'virtual-card-card');
  const titleStatus = first(html, /virtual-card-title-status[^>]*>([^<]+)/);
  if (!block && !titleStatus) return null;
  const foot = [...(block || '').matchAll(/virtual-card-foot[^>]*>\s*<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>/g)][0];
  const codes = [...(block || '').matchAll(/virtual-card-copy[^>]*data-card="([^"]+)"/g)].map((row) => decode(row[1]).trim()).filter(Boolean);
  const form = parseHtmlForm(block || '');
  const status = titleStatus || first(block, /virtual-card-status[^>]*>([^<]+)/) || '发卡中';
  const stockLabel = first(block, /virtual-card-status[^>]*>([^<]+)/) || '';
  const stockCount = Number(stockLabel.match(/(\d+)/)?.[1] ?? NaN);
  const limitLabel = foot ? decode(foot[2]).trim() : '';
  const limitCount = Number(limitLabel.match(/(\d+)/)?.[1] ?? NaN);
  const ended = /发卡结束|已售罄|finished|status-finished/.test(`${status} ${stockLabel} ${block || ''}`);
  const pending = Boolean(first(block, /virtual-card-pending-notice[^>]*>([\s\S]*?)<\/p>/));
  const caps = [form?.maxQuantity, stockCount, limitCount].filter((n) => Number.isFinite(n) && (n as number) > 0) as number[];
  const maxQuantity = form?.hasQuantity
    ? Math.max(1, caps.length ? Math.min(20, ...caps) : 1)
    : 1;
  const canBuy = Boolean(form) && !form?.disabled && !ended && !pending && !(Number.isFinite(stockCount) && stockCount <= 0);
  const notice = (first(block, /virtual-card-pending-notice[^>]*>([\s\S]*?)<\/p>/) || '').trim()
    || (ended ? '发卡已结束' : '')
    || (!form && liveCookie() ? '当前无法兑换，可能已售罄、已达限购或待审核。' : '')
    || (form?.disabled ? '当前无法兑换' : '');
  return {
    kicker: first(block, /virtual-card-kicker[^>]*>([^<]+)/) || '积分兑换',
    name: first(block, /virtual-card-head[\s\S]*?<strong>([^<]+)/) || '发卡',
    status,
    stock: stockLabel,
    price: Number(first(block, /virtual-card-price[\s\S]*?<strong>([^<]+)/) || 0),
    priceUnit: first(block, /virtual-card-price[\s\S]*?<span>([^<]+)/) || '积分 / 张',
    tip: first(block, /virtual-card-tip[^>]*>([\s\S]*?)<\/p>/) || (liveCookie() ? '' : '登录后可使用积分兑换。'),
    sold: foot ? decode(foot[1]).trim() : '',
    limit: limitLabel,
    codes,
    canBuy,
    buyLabel: form?.submit || '兑换',
    maxQuantity,
    notice,
  };
}

async function submitVirtualCardBuy(topicId: string, quantity: number) {
  requireCookie();
  const page = await fetchHtml(`/topic/${encodeURIComponent(topicId)}`, undefined, { fresh: true });
  if (isLoginWall(page) && !/post-content-title/.test(page)) {
    throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
  }
  const block = extractClassBlock(page, 'virtual-card-box') || extractClassBlock(page, 'virtual-card-card');
  const form = parseHtmlForm(block || '');
  const card = parseTopicVirtualCard(page);
  if (!form || !card?.canBuy) {
    throw new MockApiError(400, 'UPSTREAM', card?.notice || '当前无法兑换');
  }
  const qty = Math.max(1, Math.min(card.maxQuantity || 1, Math.trunc(Number(quantity) || 1)));
  const fields = { ...form.fields };
  if (!fields._csrf) fields._csrf = csrfFrom(page);
  if (!fields.topic_id) fields.topic_id = topicId;
  if (!fields.request_key) {
    const requestKey = page.match(/name=["']request_key["'][^>]*value=["']([^"']+)["']/)?.[1]
      || page.match(/value=["']([^"']+)["'][^>]*name=["']request_key["']/)?.[1];
    if (requestKey) fields.request_key = requestKey;
  }
  const qtyKey = Object.keys(fields).find((key) => /^(quantity|qty|num|count)$/i.test(key));
  if (qtyKey) fields[qtyKey] = String(qty);
  const posted = await postForm(form.action || '/virtual_card_buy', fields);
  const message = postedMessage(posted)
    || first(posted.html, /form-error-panel[\s\S]*?<p>([\s\S]*?)<\/p>/)
    || '';
  if (jsonRejected(posted.json)) {
    const fail = String(posted.json?.message || message || '兑换失败');
    throw new MockApiError(/登录/.test(fail) ? 401 : 400, 'UPSTREAM', fail);
  }
  if (message && /请求方式错误|请先登录|积分不足|已过期|失败|不能|无法|限购|售罄|不够/.test(message) && !/成功|完成|已兑换/.test(message)) {
    throw new MockApiError(/登录/.test(message) ? 401 : 400, 'UPSTREAM', message);
  }
  bustTopicCache(topicId);
  bustAccountCache();
  const html = await fetchHtml(`/topic/${encodeURIComponent(topicId)}`, undefined, { fresh: true });
  const next = parseTopicVirtualCard(html);
  return {
    ok: true,
    message: publicCardMessage(message, next?.codes ?? []),
    card: next,
  };
}

function userIdFromAuthorLink(block: string): string {
  return block.match(/<a\b[^>]*class="[^"]*post-author[^"]*"[^>]*href="\/user\/(\d+)"/i)?.[1]
    || block.match(/<a\b[^>]*href="\/user\/(\d+)"[^>]*class="[^"]*post-author/i)?.[1]
    || block.match(/aria-label="查看[^"]*个人主页"[^>]*href="\/user\/(\d+)"/)?.[1]
    || block.match(/href="\/user\/(\d+)"[^>]*aria-label="查看[^"]*个人主页"/)?.[1]
    || '';
}

/**
 * 官网上传权限的实测：官网在主题页/发帖页给有权限的账号渲染附件上传入口
 * （`.attachment-uploader` / `data-upload-url="/attachment_upload"`）。
 * 组名表会随官网开权限而过期，所以以页面为准。
 */
function rememberUploadPermissionFrom(html: string) {
  if (/attachment-uploader|data-upload-url="\/attachment_upload"|name="attachment"/.test(html)) {
    rememberOfficialUploadCapability(true);
    return;
  }
  if (/没有上传权限|无上传权限|上传权限不足|申请创作者/.test(html) && /topic_edit|reply_edit|attachment/.test(html)) {
    rememberOfficialUploadCapability(false);
  }
}

function parseTopicForum(html: string): { forumId: string; forumName: string } {
  // 主题页顶部导航第一个版块永远是「错误地方」，不能拿整页第一个 /forum/ 链接。
  const crumb = html.match(/<div class="breadcrumb">[\s\S]*?href="\/forum\/(\d+)"[^>]*>([^<]*)<\/a>/i);
  if (crumb?.[1] && crumb[2].trim()) {
    return { forumId: crumb[1], forumName: decode(crumb[2]) };
  }
  const jsonLd = html.match(/"@type"\s*:\s*"ListItem"[^}]*"position"\s*:\s*2[^}]*"name"\s*:\s*"([^"]+)"[^}]*"item"\s*:\s*"https?:\/\/[^"]*\/forum\/(\d+)/);
  if (jsonLd?.[1]?.trim() && jsonLd[2]) {
    return { forumId: jsonLd[2], forumName: decode(jsonLd[1]) };
  }
  for (const hit of html.matchAll(/<a\b([^>]*)href="\/forum\/(\d+)"([^>]*)>([^<]*)<\/a>/gi)) {
    const attrs = `${hit[1]} ${hit[3]}`;
    const name = decode(hit[4]).trim();
    if (!name) continue;
    if (/\bforum-link\b|\bforum-more-link\b/.test(attrs)) continue;
    return { forumId: hit[2], forumName: name };
  }
  return { forumId: '', forumName: '' };
}

function parseTopicDetail(html: string, id: string): TopicDto {
  rememberUploadPermissionFrom(html);
  const onlineIds = rememberOnlineUserIds(html);
  const posts = extractPostItems(html);
  const op = posts.find((block) => block.includes(`id="post-${id}"`)) ?? posts[0] ?? html;
  const title = decode(
    first(html, /class="post-content-title"[^>]*>[\s\S]*?href="\/topic\/\d+"[^>]*>([\s\S]*?)<\/a>/)
    || first(html, /<title>([^<]+)/)?.split(' - ')[0]
    || '主题',
  );
  const authorName = decode(
    first(op, /class="post-author"[^>]*>([\s\S]*?)<\/a>/)
    || first(op, /aria-label="查看\s+([^"]+?)\s+的个人主页"/)
    || first(html, /aria-label="查看\s+([^"]+?)\s+的个人主页"/)
    || '饼友',
  );
  const authorUid = first(op, /user-uid-badge"[^>]*>UID\s*(\d+)/) || first(html, /user-uid-badge"[^>]*>UID\s*(\d+)/);
  const authorId = userIdFromAuthorLink(op) || userIdFromAuthorLink(html) || authorUid || authorName;
  const { forumId, forumName } = parseTopicForum(html);
  const avatarSrc = avatarSrcFrom(op)
    || html.match(/class="post-avatar"[\s\S]*?src="([^"]+)"/)?.[1];
  const equipped = parseGachaTitle(op);
  const authorTitle = equipped.name;
  const authorTitleSerial = equipped.serial;
  const authorGroup = first(op, /user-uid-badge-group-name">([^<]+)/) || '';
  const stats = [...html.matchAll(/class="post-content-stats"[\s\S]*?<\/svg>(\d+)<\/span>[\s\S]*?<\/svg>(\d+)<\/span>/g)][0];
  const like = html.match(/donate-topic-reaction-count[^>]*>(\d+)/)
    || html.match(/data-donate-topic-like-count[^>]*>(\d+)/)
    || html.match(/共\s*(\d+)\s*人点赞/);
  const timeUnix = op.match(/class="post-time"[^>]*data-performance-time="(\d+)"/)?.[1]
    || op.match(/data-performance-time="(\d+)"/)?.[1]
    || html.match(/data-performance-time="(\d+)"/)?.[1]
    || null;
  const timeLabel = first(op, /class="post-time"[^>]*>([\s\S]*?)<\/span>/);
  const bodyHtml = innerByClass(op, 'nb-editor-post-content')
    || innerByClass(op, 'post-readability-content')
    || innerByClass(html, 'nb-editor-post-content');
  const extra = innerByClass(op, 'topic-attachments');
  const liked = /class="[^"]*\bdonate-topic-reaction-action\b[^"]*\bactive\b/.test(html)
    || /donate-topic-reaction-action[^>]*data-liked="1"/.test(html)
    || /aria-label="已点赞/.test(html)
    || /title="已点赞/.test(html);
  const favorited = /topic-favorites-action[\s\S]{0,500}取消收藏/.test(html)
    || /fav-btn[^>]*class="[^"]*\bactive\b/.test(html)
    || /class="[^"]*\bfav-btn\b[^"]*\bactive\b/.test(html);
  const favoriteCount = Number(html.match(/收藏[^<]{0,12}(\d+)/)?.[1] ?? 0);
  const tags = tagsFromBlock(html);
  const lastPage = lastTopicPage(html, id);
  const editNote = parseEditNote(op) || parseEditNote(html);
  return {
    id,
    title,
    body: redactSecrets(rewriteHtml(`${bodyHtml}${extra ? `\n${extra}` : ''}`)),
    forumId,
    forumName,
    authorId,
    authorName,
    authorTitle,
    authorTitleSerial,
    authorGroup,
    avatar: avatarSrc ? absUrl(avatarSrc) : letter(authorName),
    accent: accentFor(authorName),
    createdAt: unixToIso(timeUnix, timeLabel ? stripTags(timeLabel) : null),
    replyCount: stats ? Number(stats[2]) : 0,
    viewCount: stats ? Number(stats[1]) : 0,
    likeCount: like ? Number(like[1]) : 0,
    favoriteCount,
    liked,
    favorited,
    tags,
    lastPage: lastPage > 1 ? lastPage : undefined,
    online: userIsOnline(authorId, onlineIds),
    editedBy: editNote?.editorName,
    editedById: editNote?.editorId,
    editedAt: editNote?.editedAt,
  };
}

function parseBarrage(html: string): BarrageItemDto[] {
  const rows = html.match(/<div class="donate-barrage-item[\s\S]*?<\/div>/g) ?? [];
  return rows.slice(0, 40).map((row) => {
    const user = decode(first(row, /donate-barrage-user"[^>]*>([^<]+)/) || '饼友');
    const text = decode(first(row, /donate-barrage-action[^"]*"[^>]*>([^<]+)/) || '点了个赞');
    const amountRaw = row.match(/<b>(\d+)<\/b>/)?.[1];
    const avatarSrc = row.match(/src="([^"]+)"/)?.[1];
    return {
      user,
      text,
      amount: amountRaw ? Number(amountRaw) : null,
      avatar: avatarSrc ? absUrl(avatarSrc) : undefined,
    };
  });
}

async function fetchBarrage(topicId: string): Promise<BarrageItemDto[]> {
  try {
    const feed = await linuxRequest(`/donate_feed?topic_id=${encodeURIComponent(topicId)}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      accept: 'application/json',
    });
    const html = typeof feed.json?.area_html === 'string' ? feed.json.area_html : feed.html;
    return parseBarrage(html);
  } catch {
    return [];
  }
}

/**
 * 官方的人机验证（Cap）配置。
 *
 * 页面里长这样（游客登录页、抽奖帖的回帖框）：
 *   <div class="cap-verification-widget" data-cap-verification
 *        data-cap-widget-script="https://cap.linux.sb/assets/widget.js"
 *        data-cap-wasm-url="https://cap.linux.sb/assets/cap_wasm_bg.wasm">
 *     <cap-widget required data-cap-api-endpoint="https://cap.linux.sb/60c41af707/"
 *                 data-cap-hidden-field-name="cap_token"></cap-widget>
 *   </div>
 *
 * 我们要的是三样东西：组件脚本、wasm、接口端点；提交时把 `cap_token` 一起发回去。
 * 没有这块就返回 null —— 说明这一页不需要人机验证。
 */
export function parseCapConfig(html: string): CaptchaChallengeDto | null {
  if (!/data-cap-verification|cap-verification-widget|cap-widget/.test(html)) return null;
  const endpoint = html.match(/data-cap-api-endpoint="([^"]+)"/)?.[1]
    || html.match(/cap\.linux\.sb\/([a-f0-9]+)\//i)?.[0]
    || '';
  const widgetScript = html.match(/data-cap-widget-script="([^"]+)"/)?.[1] || '';
  const wasmUrl = html.match(/data-cap-wasm-url="([^"]+)"/)?.[1] || '';
  const absEndpoint = endpoint.startsWith('http')
    ? endpoint
    : endpoint
      ? `https://${endpoint.replace(/^\/+/, '')}`
      : '';
  if (!absEndpoint && !widgetScript) return null;
  return {
    endpoint: absEndpoint.endsWith('/') || !absEndpoint ? absEndpoint : `${absEndpoint}/`,
    widgetScript: widgetScript || 'https://cap.linux.sb/assets/widget.js',
    wasmUrl: wasmUrl || 'https://cap.linux.sb/assets/cap_wasm_bg.wasm',
  };
}

/** 这一页的回帖框是否挂了人机验证（抽奖帖默认开）。 */
export function pageNeedsReplyCaptcha(html: string): boolean {
  return /cap-verification-widget|data-cap-verification/.test(html);
}

/**
 * 官方拒绝重复竞猜时的文案。
 *
 * 实测响应（POST `/topic_essence_review_vote`，XHR/JSON）：
 *   理由太短 → {"ok":0,"message":"竞猜理由至少需要 5 个字"}
 *   已经投过 → {"ok":0,"message":"你已经参与过竞猜，请勿重复竞猜"}
 * 页面本身**不体现**投没投过（投过之后面板和没投过时结构一模一样），
 * 所以这条文案是前台唯一能识别的「已投」信号。
 */
export function isAlreadyVotedMessage(message: string): boolean {
  return /已经(?:参与|竞猜)过|重复竞猜/.test(message);
}

/**
 * 在提交竞猜后返回的页面里，找出「刚发布的那条评议回帖」。
 *
 * 官方把竞猜理由作为一条评议回帖发布（表单里写着「提交后会作为一条评议回帖发布」），
 * 但返回的页面里并没有 id 给我们，所以按「我发的 + 正文包含这段理由」来认。
 * 认不出来就返回 null，前台退回「重新拉列表」，不会瞎跳。
 */
export function findPostedReviewComment(html: string, topicId: string, reason: string): CommentDto | null {
  const want = reason.replace(/\s+/g, '').slice(0, 16);
  if (!want) return null;
  const mine = currentUserId();
  const rows = parseComments(html, topicId).filter((item) => !mine || item.authorId === mine);
  const hasReason = (item: CommentDto) => item.body.replace(/\s+/g, '').includes(want);
  // ① 我发的、正文含这段理由的（最准）
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (hasReason(rows[index])) return rows[index];
  }
  // ② 理由被上游改写（换行/转义）时的兜底：官方给评议回帖打的标签就说明是它
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].essenceLabel) return rows[index];
  }
  return null;
}

export function parseEssenceVote(html: string): EssenceVoteDto | null {
  const panel = html.match(/<section class="topic-essence-review-panel[\s\S]*?<\/section>/)?.[0];
  if (!panel) return null;
  const statusAttr = attr(panel, 'data-status') || '';
  const featured = statusAttr === 'featured' || /\bis-featured\b/.test(panel);
  const voting = statusAttr === 'voting' || /\bis-voting\b/.test(panel);
  const labeled = panel.match(/精华申请进度\s*(-?\d+)\s*\/\s*(\d+)/)
    || panel.match(/<strong>(-?\d+)\s*\/\s*(\d+)<\/strong>/);
  let max = 7;
  let value = 0;
  if (labeled) {
    value = Number(labeled[1]);
    max = Number(labeled[2]);
  } else {
    const progress = panel.match(/<progress[^>]*max="(\d+)"[^>]*value="(\d+)"/)
      || panel.match(/<progress[^>]*value="(\d+)"[^>]*max="(\d+)"/);
    if (progress) {
      if (progress[0].includes('max="') && progress[0].indexOf('max="') < progress[0].indexOf('value="')) {
        max = Number(progress[1]);
        value = Number(progress[2]);
      } else if (progress[0].includes('value="') && progress[0].indexOf('value="') < progress[0].indexOf('max="')) {
        value = Number(progress[1]);
        max = Number(progress[2]);
      }
    }
  }
  const support = panel.match(/支持\s*(\d+)\s*票（(\d+)\s*点）/)
    || panel.match(/竞猜会加精\s*(\d+)\s*人（(\d+)\s*点）/);
  const oppose = panel.match(/反对\s*(\d+)\s*票（(\d+)\s*点）/)
    || panel.match(/竞猜不会加精\s*(\d+)\s*人（(\d+)\s*点）/);
  const hasForm = /topic-essence-review-vote-form/.test(panel);
  const radiosLocked = /name="vote"[^>]*(?:disabled|readonly)/.test(panel);
  const canVote = hasForm && /提交\s*(?:<[^>]+>\s*)?(?:投票|竞猜)/.test(panel) && !radiosLocked;
  const actionNote = first(panel, /topic-essence-review-actions[\s\S]*?<p class="topic-essence-review-note"[^>]*>([\s\S]*?)<\/p>/)
    || first(panel, /topic-essence-review-actions[\s\S]*?topic-essence-review-note"[^>]*>([\s\S]*?)<\/p>/)
    || '';
  const reached = max > 0 && value >= max && !featured;
  const statusKey: EssenceVoteDto['statusKey'] = featured
    ? 'featured'
    : reached
      ? 'review'
      : voting
        ? 'voting'
        : 'ended';
  const status = featured
    ? '加精成功'
    : statusKey === 'review'
      ? '审批中'
      : (first(panel, /topic-essence-review-status[^>]*>([^<]+)/) || (voting ? '竞猜中' : '已结束'));
  const plain = stripTags(panel);
  let choice: EssenceVoteDto['choice'] = null;
  if (!canVote) {
    if (/你已(?:支持|预测会加精|竞猜会加精)|已预测会加精/.test(plain)) choice = 'support';
    else if (/你已(?:反对|预测不会加精|竞猜不会加精)|已预测不会加精/.test(plain)) choice = 'oppose';
    else if (radiosLocked) {
      const checked = panel.match(/name="vote"[^>]*value="(support|oppose)"[^>]*(?:checked|selected)|value="(support|oppose)"[^>]*(?:checked|selected)/);
      const picked = checked?.[1] || checked?.[2];
      if (picked === 'support' || picked === 'oppose') choice = picked;
    }
  }
  return {
    status,
    statusKey,
    progress: value,
    max,
    supportVotes: support ? Number(support[1]) : 0,
    supportPoints: support ? Number(support[2]) : 0,
    opposeVotes: oppose ? Number(oppose[1]) : 0,
    opposePoints: oppose ? Number(oppose[2]) : 0,
    deadline: (first(panel, /(?:投票截止|竞猜截止)\s*([^<]+)/) || '').trim(),
    endedAt: (first(panel, /结束于\s*([^<]+)/) || '').trim(),
    pool: Number(panel.match(/奖池共\s*(\d+)/)?.[1] ?? 0),
    poolGift: Number(panel.match(/系统赠送\s*(\d+)/)?.[1] ?? 0),
    poolAuthor: Number(panel.match(/作者追加\s*(\d+)/)?.[1] ?? 0),
    poolPaid: Number(panel.match(/已发放\s*(\d+)/)?.[1] ?? 0),
    poolPending: Number(panel.match(/待结算\s*(\d+)/)?.[1] ?? 0),
    poolResult: first(panel, /topic-essence-review-pool-result[\s\S]*?<p>([\s\S]*?)<\/p>/) || '',
    payouts: [...panel.matchAll(/<li>\s*<span>([^<]+)<\/span>\s*<strong>(\d+)\s*分<\/strong>/g)].map((row) => ({
      name: decode(row[1]),
      points: Number(row[2]),
    })),
    success: first(panel, /topic-essence-review-success"[^>]*>([\s\S]*?)<\/p>/) || '',
    weight: Number(panel.match(/本票计\s*(\d+)\s*点/)?.[1] ?? 1),
    note: first(panel, /topic-essence-review-progress-note"[^>]*>([\s\S]*?)<\/p>/)
      || '进度 = 会加精点数 − 不会加精点数；达到 7 点后停止竞猜，进入审批，不会自动加精。',
    restriction: canVote ? '' : stripTags(actionNote),
    canVote,
    choice,
    // 页面上会回显我提交过的理由（官方把它作为一条评议回帖发布）
    myReason: (first(panel, /topic-essence-review-reason"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/) || '').trim()
      || (plain.match(/我的(?:竞猜)?理由[：:]\s*([^\n]{1,300})/)?.[1] ?? '').trim(),
  };
}

const REPORT_REASONS: ReportFormDto['reasons'] = [
  { id: 'advertising', label: '广告推广或引流' },
  { id: 'abuse', label: '辱骂、人身攻击或骚扰' },
  { id: 'illegal', label: '违法违规或危险内容' },
  { id: 'adult', label: '色情、低俗或令人不适' },
  { id: 'misinformation', label: '谣言、虚假或误导信息' },
  { id: 'privacy', label: '泄露隐私或个人信息' },
  { id: 'spam', label: '垃圾内容、刷屏或重复发布' },
  { id: 'copyright', label: '侵权、抄袭或冒用身份' },
  { id: 'other', label: '其他问题' },
];

function parseReportForm(html: string, targetType: 'reply' | 'topic', targetId: string): ReportFormDto {
  const title = (first(html, /<h2[^>]*>([\s\S]*?)<\/h2>/) || (targetType === 'reply' ? '举报回帖' : '举报主题')).trim();
  if (!/name="reason_type"/.test(html)) {
    return {
      title,
      targetType,
      targetId,
      targetUser: (first(html, /被举报用户：\s*([^<]+)/) || '').trim(),
      topicTitle: (first(html, /所属主题：\s*([^<]+)/) || '').trim(),
      deposit: 0,
      warning: '',
      detailsHint: '',
      reasons: [],
      closed: true,
      message: flashMessage(html) || formError(html, '无法打开举报页，可能不能举报自己的内容'),
    };
  }
  const reasons = [...html.matchAll(/name="reason_type"\s+value="([^"]+)"[\s\S]*?<span>([^<]+)<\/span>/g)]
    .map((row) => ({ id: row[1], label: decode(row[2].trim()) }));
  return {
    title,
    targetType,
    targetId: html.match(/name="target_id"\s+value="([^"]+)"/)?.[1] || targetId,
    targetUser: (first(html, /被举报用户：\s*([^<]+)/) || '').trim(),
    topicTitle: (first(html, /所属主题：\s*([^<]+)/) || '').trim(),
    deposit: Number(html.match(/举报押金\s*(\d+)\s*积分/)?.[1] ?? 500),
    warning: first(html, /content-report-warning"[^>]*>([\s\S]*?)<\/p>/)
      || '举报押金 500 积分，举报成立原额退回，不成立则不予退回。请根据实际情况选择原因并提供必要说明。重复提交相同举报不会加快处理；经核实属于恶意举报的，可能影响后续举报权限。',
    detailsHint: first(html, /补充说明[\s\S]*?<small>([\s\S]*?)<\/small>/)
      || '选择“其他问题”时至少填写5个字符；其他类型建议说明具体违规位置和情况，以便准确核查。',
    reasons: reasons.length ? reasons : REPORT_REASONS,
  };
}

function parseDonateInfo(html: string): DonateInfoDto {
  const stats = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const rewardPeople = Number(stats.match(/已打赏\s*(\d+)\s*人次/)?.[1] ?? 0);
  const likeCount = Number(stats.match(/已点赞\s*(\d+)\s*次/)?.[1] ?? 0);
  const totalPoints = Number(stats.match(/共\s*(\d+)\s*积分/)?.[1] ?? 0);
  const balance = Number(stats.match(/我的积分\s*(\d+)/)?.[1] ?? 0);
  const presets = [...html.matchAll(/data-amount="(\d+)"/g)].map((row) => Number(row[1]));
  return {
    blocked: false,
    title: '点赞打赏',
    rewardPeople,
    likeCount,
    totalPoints,
    balance,
    presets: presets.length ? [...new Set(presets)] : [6, 10, 33, 66, 88],
  };
}

function donateModalParts(json: Record<string, unknown> | null): { title: string; html: string } {
  const modal = json && typeof json.modal === 'object' && json.modal
    ? json.modal as Record<string, unknown>
    : null;
  return {
    title: typeof modal?.title === 'string' ? modal.title : '',
    html: typeof modal?.html === 'string' ? modal.html : '',
  };
}

function parseBlockedDonate(html: string, heading: string): DonateInfoDto {
  const warning = (first(html, /donate-blocked-warning"[^>]*>([\s\S]*?)<\/p>/) || '').trim()
    || '请勿水帖，被删后三天无法打赏！';
  const rawMessage = html.match(/<p(?![^>]*donate-blocked-warning)[^>]*>([\s\S]*?)<\/p>/)?.[1] || '';
  const message = stripTags(rawMessage).replace(/\s+/g, ' ').trim();
  const reply = message.match(/回帖\s*(\d+)\s*条\s*（当前\s*(\d+)）/);
  const title = heading || first(html, /<strong[^>]*>([\s\S]*?)<\/strong>/) || '暂不能打赏';
  return {
    blocked: true,
    title,
    message: message || title,
    warning,
    replyNeed: reply ? Number(reply[1]) : undefined,
    replyHave: reply ? Number(reply[2]) : undefined,
    rewardPeople: 0,
    likeCount: 0,
    totalPoints: 0,
    balance: 0,
    presets: [6, 10, 33, 66, 88],
  };
}

function parseDonatePayload(result: LinuxResult): DonateInfoDto {
  const modal = donateModalParts(result.json);
  const html = modal.html || result.html;
  if (!modal.html) {
    throw new MockApiError(502, 'UPSTREAM', '无法读取打赏状态，请稍后重试');
  }
  if (/donate-blocked-dialog/.test(html) || /暂不能打赏/.test(modal.title) || /暂不能打赏/.test(html)) {
    return parseBlockedDonate(html, modal.title);
  }
  return {
    ...parseDonateInfo(html),
    blocked: false,
    title: modal.title || '点赞打赏',
  };
}

async function fetchDonateModal(topicId: string): Promise<LinuxResult> {
  requireCookie();
  const result = await linuxRequest(`/donate?topic_id=${encodeURIComponent(topicId)}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    accept: 'application/json, text/html;q=0.9',
  });
  if (result.status >= 500) {
    throw new MockApiError(result.status, 'UPSTREAM', `linux.sb 返回 ${result.status}`);
  }
  const redirect = typeof result.json?.redirect === 'string' ? result.json.redirect : '';
  if (redirect || result.status === 401 || isLoginWall(result.html)) {
    throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
  }
  if (result.json && !result.json.ok) {
    throw new MockApiError(400, 'UPSTREAM', String(result.json.message || '加载打赏失败'));
  }
  return result;
}

async function loadDonateInfo(topicId: string): Promise<DonateInfoDto> {
  return parseDonatePayload(await fetchDonateModal(topicId));
}

async function submitDonate(topicId: string, amount: string) {
  requireCookie();
  const donate = await fetchDonateModal(topicId);
  const info = parseDonatePayload(donate);
  if (info.blocked) {
    throw new MockApiError(403, 'DONATE_BLOCKED', info.message || info.title || '暂不能打赏');
  }
  const html = donateModalParts(donate.json).html;
  const requestKey = html.match(/name="request_key"\s+value="([^"]+)"/)?.[1] ?? '';
  if (!requestKey) {
    throw new MockApiError(502, 'UPSTREAM', '无法读取打赏校验，请稍后重试');
  }
  const posted = await postForm('/donate', {
    _csrf: csrfFrom(html),
    topic_id: topicId,
    request_key: requestKey,
    amount,
  });
  if (posted.json && !posted.json.ok) {
    throw new MockApiError(400, 'UPSTREAM', String(posted.json.message || (amount ? '打赏失败' : '点赞失败')));
  }
  bustTopicCache(topicId);
  const rewarded = Number(amount) || 0;
  const likeCount = posted.json && posted.json.like_count !== undefined
    ? Number(posted.json.like_count)
    : info.likeCount + 1;
  const barrage = typeof posted.json?.area_html === 'string'
    ? parseBarrage(String(posted.json.area_html))
    : [];
  const balance = Math.max(0, info.balance - rewarded);
  rememberUserPoints(balance);
  return {
    liked: true,
    likeCount,
    rewarded,
    balance,
    barrage,
    message: typeof posted.json?.message === 'string' ? posted.json.message : '',
  };
}

async function submitCommentReaction(topicId: string, replyId: string, points: number) {
  requireCookie();
  const page = await fetchHtml(`/topic/${encodeURIComponent(topicId)}`);
  const posted = await postForm('/donate_reply_reaction', {
    _csrf: csrfFrom(page),
    donate_reaction_reply_id: replyId,
    donate_reaction_points: String(Math.max(0, Number(points) || 0)),
  });
  if (!posted.json || posted.json.ok === false) {
    throw new MockApiError(400, 'UPSTREAM', String(posted.json?.message || posted.flash || '操作失败'));
  }
  bustTopicCache(topicId);
  return {
    liked: Boolean(posted.json.liked),
    coined: Boolean(posted.json.coined),
    likeCount: Number(posted.json.count ?? 0) || 0,
    message: typeof posted.json.message === 'string' ? posted.json.message : '',
  };
}

function topicPermissions(html: string): TopicPermissions {
  const loggedIn = Boolean(liveCookie()) && !commentsHidden(html);
  const ops = html.match(/class="post-ops"[^>]*data-slot="topic\.actions"[\s\S]{0,5000}?<\/div>/)?.[0]
    ?? html.match(/class="post-ops"[\s\S]{0,4000}?<\/div>/)?.[0]
    ?? '';
  return {
    canEdit: /href="\/topic_edit\?/.test(html) || /href="\/topic_edit\/\d+"/.test(html) || /icon-edit|aria-label="编辑"/.test(ops),
    canDelete: /href="\/topic_delete|action="\/topic_delete"|删除主帖|aria-label="删除"/.test(ops)
      || /icon-delete|sb-limit-edit-time-delete/.test(ops),
    canComment: loggedIn && /ajax-reply-form/.test(html),
    canLike: loggedIn && /\/donate\?topic_id=/.test(html),
    canFavorite: loggedIn && /action="\/topic_favorite"/.test(html),
    canReward: loggedIn && /\/donate\?topic_id=/.test(html),
  };
}

function commentsHidden(html: string): boolean {
  return /data-replies-login-visible="1"/.test(html) || /class="replies-login-visible"/.test(html);
}

function parseEditNote(html: string): { editorName: string; editorId: string; editedAt: string } | null {
  const inner = html.match(/<div\b[^>]*class="[^"]*sb-limit-edit-time-note[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
    || html.match(/最后由[\s\S]{0,240}?编辑于\s*[^<]+/)?.[0];
  if (!inner) return null;
  const editorId = inner.match(/href="\/user\/(\d+)"/)?.[1] || '';
  const editorName = stripTags(inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/)?.[1] || inner.match(/最后由\s+([^\s<]+)\s+编辑于/)?.[1] || '').trim();
  const editedAt = stripTags(inner.match(/编辑于\s*([^<\n]+)/)?.[1] || '').trim();
  if (!editorName && !editedAt) return null;
  return { editorName, editorId, editedAt };
}

function formatCstEditAt(now = Date.now()): string {
  const cst = new Date(now + 8 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${cst.getUTCFullYear()}-${pad(cst.getUTCMonth() + 1)}-${pad(cst.getUTCDate())} ${pad(cst.getUTCHours())}:${pad(cst.getUTCMinutes())}`;
}

export function parseComments(html: string, topicId: string): CommentDto[] {
  const onlineIds = rememberOnlineUserIds(html);
  const blocks = extractPostItems(html);
  const parsed: CommentDto[] = [];
  blocks.forEach((block, index) => {
    const editHrefId = block.match(/href="\/reply_edit\/(\d+)/i)?.[1]
      || block.match(/href="\/reply_edit\?[^"]*\bid=(\d+)/i)?.[1];
    const id = editHrefId
      || block.match(/id="post-(\d+)"/)?.[1]
      || block.match(/data-content-id="(\d+)"/)?.[1]
      || `${topicId}-c${index}`;
    if (id === topicId) return;
    const authorHrefId = userIdFromAuthorLink(block) || block.match(/href="\/user\/(\d+)"/)?.[1] || '';
    const authorName = first(block, /aria-label="查看\s+([^"]+?)\s+的个人主页"/)
      || first(block, /class="post-author"[^>]*>([\s\S]*?)<\/a>/)
      || '饼友';
    const commentUid = first(block, /user-uid-badge"[^>]*>UID\s*(\d+)/) || authorHrefId;
    const avatarSrc = avatarSrcFrom(block);
    const bodyHtml = innerByClass(block, 'nb-editor-post-content')
      || innerByClass(block, 'post-readability-content');
    const floor = attr(block, 'data-floor');
    const parentFloor = attr(block, 'data-quote-threads-parent-floor');
    const reactionBtn = block.match(/<button\b[^>]*data-donate-reaction[^>]*>/i)?.[0]
      || block.match(/<button\b[^>]*class="[^"]*donate-reaction-action[^"]*"[^>]*>/i)?.[0]
      || '';
    const likeCount = Number(
      block.match(/class="donate-reaction-count"[^>]*>(\d+)/)?.[1]
      ?? block.match(/donate-reaction-count[^>]*>(\d+)/)?.[1]
      ?? 0,
    );
    const mentionAnchor = bodyHtml.match(/<a\b[^>]*class="[^"]*post-mention[^"]*"[^>]*>[\s\S]*?<\/a>/i)?.[0] ?? '';
    const mention = (mentionAnchor ? stripTags(mentionAnchor) : stripTags(bodyHtml)).match(/^@[^\s#]+ #\d+/)?.[0] ?? null;
    const body = redactSecrets(rewriteHtml(bodyHtml));
    const equipped = parseGachaTitle(block);
    const editNote = parseEditNote(block);
    /**
     * 竞猜理由是以「评议回帖」发布的，官方给它打了个标签：
     *   <span class="topic-essence-review-reply-label is-oppose">精华竞猜 · 预测不会加精</span>
     */
    const essenceLabel = decode(
      first(block, /topic-essence-review-reply-label[^>]*>([\s\S]*?)<\/span>/) || '',
    ).trim();
    /**
     * 红包帖里领到红包的那层楼，官方在楼层信息里挂了个奖励标记：
     *   <span class="red-packet-reply-reward" aria-label="红包奖励 +1 积分，财源滚滚！">
     *     …<span class="red-packet-reply-points">+1</span>
     *     <span class="red-packet-reply-tooltip" role="tooltip">红包奖励 +1 积分，财源滚滚！</span>
     *   </span>
     * 金额取 points 里的数字，说明取 tooltip（拿不到就退回 aria-label）。
     */
    const rewardPoints = Number(
      block.match(/red-packet-reply-points[^>]*>\s*\+?\s*(\d+)/)?.[1] ?? 0,
    );
    const rewardTip = decode(first(block, /red-packet-reply-tooltip[^>]*>([\s\S]*?)<\/span>/) || '').trim()
      || decode(block.match(/red-packet-reply-reward[^>]*aria-label="([^"]*)"/)?.[1] ?? '').trim();
    const redPacket = rewardPoints > 0 || rewardTip ? { points: rewardPoints, tip: rewardTip } : null;
    const deleteTag = block.match(/<[^>]*data-sb-limit-edit-time-reply-delete[^>]*>/i)?.[0] || '';
    const deleteFormTag = block.match(/<form\b[^>]*(?:sb-limit-edit-time-delete|action="\/sb_limit_edit_time_delete"|action="\/delete")[^>]*>/i)?.[0] || '';
    const deleteConfirm = decode(
      deleteTag.match(/data-confirm="([^"]*)"/i)?.[1]
      || deleteFormTag.match(/data-confirm="([^"]*)"/i)?.[1]
      || '',
    ).trim();
    const deleteRulesRaw = decode(
      deleteTag.match(/data-rules-url="([^"]*)"/i)?.[1]
      || deleteFormTag.match(/data-sb-limit-edit-time-rules-url="([^"]*)"/i)?.[1]
      || deleteFormTag.match(/data-rules-url="([^"]*)"/i)?.[1]
      || '',
    ).trim();
    const likeTiers = (reactionBtn.match(/data-tiers="([^"]+)"/)?.[1] || '1,5,10,50')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => value > 0);
    parsed.push({
      id,
      topicId,
      parentId: parentFloor,
      parentFloor,
      essenceLabel,
      redPacket,
      authorId: authorHrefId || commentUid || authorName,
      authorName,
      authorTitle: equipped.name,
      authorTitleSerial: equipped.serial,
      authorGroup: first(block, /user-uid-badge-group-name">([^<]+)/) || '',
      uid: commentUid || authorHrefId,
      avatar: avatarSrc ? absUrl(avatarSrc) : letter(authorName),
      accent: accentFor(authorName),
      body,
      mention,
      createdAt: postTimeIso(block),
      likeCount: Number(likeCount) || 0,
      liked: /data-liked="1"/.test(reactionBtn) || /class="[^"]*\bactive\b/.test(reactionBtn),
      coined: /data-coined="1"/.test(reactionBtn),
      likeTiers: likeTiers.length ? likeTiers : [1, 5, 10, 50],
      floor,
      canEdit: /icon-edit|href="\/reply_edit(?:\/|\?)|aria-label="编辑/.test(block),
      canDelete: /icon-delete|sb-limit-edit-time-delete|reply-delete-link/.test(block),
      online: userIsOnline(authorHrefId || commentUid, onlineIds),
      editedBy: editNote?.editorName,
      editedById: editNote?.editorId,
      editedAt: editNote?.editedAt,
      deleteConfirm: deleteConfirm || undefined,
      deleteRulesUrl: deleteRulesRaw ? absUrl(deleteRulesRaw) : undefined,
    });
  });
  const byFloor = new Map(parsed.map((item) => [item.floor, item.id]));
  return parsed.map((item) => ({
    ...item,
    parentId: item.parentId && byFloor.get(item.parentId) ? byFloor.get(item.parentId)! : null,
  }));
}

function cstDayKey(iso: string): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  return new Date(time + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function todayCstKey(now = Date.now()): string {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function topicPinned(topic: TopicDto): boolean {
  return topic.tags.some((tag) => tag.type === 'pinned');
}

function matchForum(items: ForumDto[], topic: TopicDto): ForumDto | undefined {
  return items.find((item) => item.id && item.id === topic.forumId)
    || items.find((item) => item.name && item.name === topic.forumName);
}

function applyForumLatest(forum: ForumDto, topic: TopicDto) {
  if (forum.latest) return;
  forum.latest = topic.title;
  forum.latestAt = topic.createdAt;
}

function parseForumList(html: string): ForumDto[] {
  const items: ForumDto[] = [];
  const re = /<a class="forum-enhancements-link"[^>]*style="--forum-enhancements-color:([^"]+)"[^>]*href="\/forum\/(\d+)"[\s\S]*?forum-enhancements-name">([^<]+)<\/span>[\s\S]*?forum-enhancements-count">([^<]+)<\/span>/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(html))) {
    const [, color, id, name, count] = hit;
    items.push({
      id,
      name,
      group: FORUM_GROUP[name] ?? '交流',
      desc: FORUM_DESC[name] ?? '',
      topics: Number(count.replace(/[^\d]/g, '')) || 0,
      posts: 0,
      today: 0,
      accent: color.trim(),
      icon: FORUM_ICON[name] ?? 'grid-outline',
      latest: '',
      latestAt: '',
    });
  }
  return items;
}

function keepForumCache(items: ForumDto[]) {
  forumCache = items;
  if (forumCacheTimer) clearTimeout(forumCacheTimer);
  forumCacheTimer = setTimeout(() => {
    if (forumCache === items) {
      forumCache = null;
      forumEnriched = false;
    }
  }, 60_000);
}

export function subscribeForums(listener: (items: ForumDto[]) => void) {
  forumListeners.add(listener);
  if (forumEnriched && forumCache) listener(forumCache);
  return () => {
    forumListeners.delete(listener);
  };
}

async function enrichForums(items: ForumDto[]) {
  if (!items.length) return;
  const [commentHtml, postHtml] = await Promise.all([
    fetchHtml('/index.php?sort=comment'),
    fetchHtml('/index.php?sort=post'),
  ]);
  for (const topic of parseTopicItems(commentHtml)) {
    if (topicPinned(topic)) continue;
    const forum = matchForum(items, topic);
    if (forum) applyForumLatest(forum, topic);
  }
  const today = todayCstKey();
  let pageHtml = postHtml;
  for (let page = 1; page <= 6; page += 1) {
    const topics = parseTopicItems(pageHtml);
    let sawToday = false;
    let reachedYesterday = false;
    for (const topic of topics) {
      if (topicPinned(topic)) continue;
      const isToday = cstDayKey(topic.createdAt) === today;
      if (isToday) {
        sawToday = true;
        const forum = matchForum(items, topic);
        if (forum) {
          forum.today += 1;
          applyForumLatest(forum, topic);
        }
      } else if (sawToday || page > 1) {
        reachedYesterday = true;
        break;
      }
    }
    if (reachedYesterday) break;
    const nxt = nextPage(pageHtml, page);
    if (!nxt) break;
    pageHtml = await fetchHtml(`/index.php?sort=post&p=${nxt}`);
  }
}

function enrichForumsInBackground(items: ForumDto[]) {
  if (forumEnriching) return forumEnriching;
  forumEnriching = (async () => {
    try {
      await enrichForums(items);
      const snapshot = items.map((item) => ({ ...item }));
      forumEnriched = true;
      keepForumCache(snapshot);
      for (const listener of forumListeners) listener(snapshot);
    } catch {
      keepForumCache(items);
    } finally {
      forumEnriching = null;
    }
  })();
  return forumEnriching;
}

async function getForums(): Promise<ForumDto[]> {
  if (forumCache) return forumCache;
  if (forumInflight) return forumInflight;
  forumInflight = (async () => {
    const html = await fetchHtml('/forum_list');
    const items = parseForumList(html);
    forumEnriched = false;
    forumCache = items;
    void enrichForumsInBackground(items);
    return items;
  })().finally(() => {
    forumInflight = null;
  });
  return forumInflight;
}

async function resolveForumId(forum?: string): Promise<string | null> {
  if (!forum || forum === 'all' || forum === '全部') return null;
  if (/^\d+$/.test(forum)) return forum;
  const forums = await getForums();
  return forums.find((item) => item.name === forum || item.id === forum)?.id ?? null;
}

function feedPath(sort: string, forumId: string | null, page: number): string {
  const p = page > 1 ? page : 1;
  const qs = (base: string) => (p > 1 ? `${base}${base.includes('?') ? '&' : '?'}p=${p}` : base);
  const tab = FEED_TAB_BY_SLUG.get(sort as FeedSort);
  // 足迹 / 申精：官方都是全局列表，与版块筛选无关。
  if (tab?.global) return qs(tab.path);
  if (forumId) {
    // 版块页的排序参数与首页一致（comment/post/lucky/card）；精华在版块里就是版块页本身
    const param = tab?.path.match(/[?&]sort=(\w+)/)?.[1];
    if (param) return qs(`/forum/${forumId}?sort=${param}`);
    if (tab?.slug === 'featured') return qs(`/forum/${forumId}`);
    return qs(`/forum/${forumId}?sort=comment`);
  }
  return qs(tab?.path ?? '/index.php?sort=comment');
}

export function parseUser(html: string, id: string): UserDto {
  const name = decode(
    first(html, /class="user-name"[^>]*>([\s\S]*?)<\/a>/)
    || first(html, /<title>([^<]+)/)?.split(' - ')[0]
    || id,
  );
  const title = gachaTitleLabel(html) || '饼友';
  const groupLabel = decode(first(html, /class="user-uid-badge-group-name">([^<]+)/) || '饼友');
  // 在线状态来自页面上的在线用户 id 列表（没有该列表时沿用最近一次见到的）
  const onlineIds = rememberOnlineUserIds(html);
  const points = parseAccountPoints(html);
  const uid = html.match(/UID\s*(\d+)/)?.[1] ?? id;
  const bio = first(html, /class="sidebar-bio">([\s\S]*?)<\/div>/) || '';
  const avatarSrc = html.match(/class="user-avatar-big"[\s\S]*?src="([^"]+)"/)?.[1]
    || html.match(/class="user-header-info"[\s\S]*?src="([^"]+)"/)?.[1];
  const pageItems = (html.match(/<li class="post-item(?![^"]*post-entry)/g) ?? []).length;
  const lastPage = [...html.matchAll(/tab=topics(?:&|&amp;)p=(\d+)/g)]
    .map((row) => Number(row[1]))
    .reduce((max, n) => (n > max ? n : max), 1);
  const topicCount = lastPage > 1 ? Math.max(pageItems, (lastPage - 1) * Math.max(pageItems, 1)) : pageItems;
  return {
    id,
    name,
    title,
    group: mapGroup(groupLabel),
    groupLabel,
    points,
    uid,
    avatar: avatarSrc ? absUrl(avatarSrc) : letter(name),
    accent: accentFor(name),
    bio: stripTags(bio),
    topicCount,
    replyCount: 0,
    joinedAt: '',
    online: userIsOnline(uid || id, onlineIds),
  };
}

function postItemCount(html: string): number {
  return (html.match(/<li class="post-item(?![^"]*post-entry)(?![^"]*points-rewards)/g) ?? []).length;
}

function lastPageOf(html: string, tab: string): number {
  const re = new RegExp(`tab=${tab}(?:&|&amp;)p=(\\d+)`, 'g');
  return [...html.matchAll(re)].map((row) => Number(row[1])).reduce((max, n) => (n > max ? n : max), 1);
}

async function countUserTab(
  id: string,
  tab: 'topics' | 'replies',
  firstHtml: string,
  cookie?: string | null,
  fresh = false,
): Promise<number> {
  const perPage = postItemCount(firstHtml);
  const last = lastPageOf(firstHtml, tab);
  if (last <= 1) return perPage;
  try {
    const lastHtml = await fetchHtml(
      `/user/${encodeURIComponent(id)}?tab=${tab}&p=${last}`,
      cookie,
      fresh ? { fresh: true } : undefined,
    );
    return (last - 1) * Math.max(perPage, 1) + postItemCount(lastHtml);
  } catch {
    return (last - 1) * Math.max(perPage, 1);
  }
}

export async function hydrateUser(id: string, cookie?: string | null, fresh = false): Promise<UserDto> {
  const opts = fresh ? { fresh: true } : undefined;
  const [topicsHtml, repliesHtml] = await Promise.all([
    fetchHtml(`/user/${encodeURIComponent(id)}?tab=topics`, cookie, opts),
    fetchHtml(`/user/${encodeURIComponent(id)}?tab=replies`, cookie, opts),
  ]);
  if (isLoginWall(topicsHtml) && !/class="user-name"/.test(topicsHtml)) {
    throw new MockApiError(404, 'NOT_FOUND', '用户不存在或需要登录');
  }
  if (/用户不存在|找不到该用户|User not found/i.test(topicsHtml) && !/class="user-name"/.test(topicsHtml)) {
    throw new MockApiError(404, 'NOT_FOUND', '用户不存在');
  }
  const base = parseUser(topicsHtml, id);
  const [topicCount, replyCount] = await Promise.all([
    countUserTab(id, 'topics', topicsHtml, cookie, fresh),
    countUserTab(id, 'replies', repliesHtml, cookie, fresh),
  ]);
  return { ...base, topicCount, replyCount };
}

function parseRankBlock(block: string, fallback: Partial<RankDto> = {}): RankDto | null {
  const userId = block.match(/href="\/user\/(\d+)/)?.[1] ?? fallback.userId ?? '';
  const rank = Number(block.match(/leaderboard-(?:rank-badge|podium-step)[^>]*>[\s\S]*?<span>(\d+)<\/span>/)?.[1]
    ?? block.match(/leaderboard-rank-badge[^"]*">(\d+)</)?.[1]
    ?? fallback.rank
    ?? 0);
  const name = decode(
    first(block, /leaderboard-(?:podium-name|name)">([^<]+)/)
    || fallback.name
    || '',
  );
  const group = decode(first(block, /leaderboard-(?:podium-group|group)">([^<]+)/) || fallback.group || '');
  const value = decode(first(block, /leaderboard-(?:podium-count|count)">([^<]+)/) || fallback.value || '').trim();
  const src = block.match(/src="([^"]+)"/)?.[1] ?? fallback.avatar ?? '';
  if (!userId && !name) return null;
  return {
    rank,
    userId,
    name,
    group,
    value,
    avatar: src ? absUrl(src) : letter(name || userId),
    accent: accentFor(name || userId),
    self: fallback.self,
  };
}

function parseLeaderboard(html: string): RankDto[] {
  const items: RankDto[] = [];
  const podiumRe = /href="\/user\/(\d+)"[\s\S]*?src="([^"]+)"[\s\S]*?leaderboard-podium-name">([^<]+)[\s\S]*?leaderboard-podium-group">([^<]+)[\s\S]*?leaderboard-podium-count">([^<]+)[\s\S]*?leaderboard-podium-step"><span>(\d+)<\/span>/g;
  let podium: RegExpExecArray | null;
  while ((podium = podiumRe.exec(html))) {
    const [, userId, src, name, group, value, rankText] = podium;
    items.push({
      rank: Number(rankText),
      userId,
      name: decode(name),
      group: decode(group),
      value: decode(value).trim(),
      avatar: absUrl(src),
      accent: accentFor(decode(name)),
    });
  }
  const re = /<a class="leaderboard-item" href="\/user\/(\d+)"[\s\S]*?leaderboard-rank-badge[^"]*">(\d+)<\/span>[\s\S]*?src="([^"]+)"[\s\S]*?leaderboard-name">([^<]+)[\s\S]*?leaderboard-group">([^<]+)[\s\S]*?leaderboard-count">([^<]+)/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(html))) {
    const [, userId, rankText, src, name, group, value] = hit;
    if (items.some((item) => item.userId === userId)) continue;
    items.push({
      rank: Number(rankText),
      userId,
      name: decode(name),
      group: decode(group),
      value: decode(value).trim(),
      avatar: absUrl(src),
      accent: accentFor(name),
    });
  }
  items.sort((a, b) => a.rank - b.rank);
  return items;
}

function parseLeaderboardSelf(html: string): RankDto | null {
  const block = html.match(/<a class="leaderboard-item leaderboard-self-item"[\s\S]*?<\/a>/)?.[0];
  if (!block) return null;
  return parseRankBlock(block, { self: true });
}

function parseLeaderboardPage(html: string, type: string) {
  return {
    type,
    subtitle: stripTags(first(html, /leaderboard-subtitle">([^<]+)/) || ''),
    items: parseLeaderboard(html),
    self: parseLeaderboardSelf(html),
  };
}

function parseFormFields(form: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const inputRe = /<input\b[^>]*>/gi;
  let hit: RegExpExecArray | null;
  while ((hit = inputRe.exec(form))) {
    const tag = hit[0];
    if (/\bdisabled\b/i.test(tag)) continue;
    const type = (tag.match(/\btype="([^"]*)"/i)?.[1] || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image' || type === 'file') continue;
    if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/i.test(tag)) continue;
    const name = tag.match(/\bname="([^"]+)"/i)?.[1];
    if (!name) continue;
    fields[name] = decode(tag.match(/\bvalue="([^"]*)"/i)?.[1] ?? '');
  }
  const areaRe = /<textarea\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/gi;
  while ((hit = areaRe.exec(form))) {
    fields[hit[1]] = decode(hit[2]);
  }
  const selectRe = /<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi;
  while ((hit = selectRe.exec(form))) {
    const selected = hit[2].match(/<option\b[^>]*\bselected\b[^>]*value="([^"]*)"/i)
      || hit[2].match(/<option\b[^>]*value="([^"]*)"[^>]*\bselected\b/i)
      || hit[2].match(/<option\b[^>]*value="([^"]*)"/i);
    if (selected) fields[hit[1]] = decode(selected[1]);
  }
  return fields;
}

function liveActionPath(raw: string, fallback: string): string {
  const path = (raw || '').replace(/&amp;/g, '&').replace(/^https?:\/\/(?:www\.)?linux\.sb/i, '');
  if (!path) return fallback;
  return path.startsWith('/') ? path : `/${path}`;
}

function formActionPath(form: string, fallback: string): string {
  const open = form.match(/<form\b[^>]*>/i)?.[0] ?? '';
  const hit = open.match(/\baction=(?:"([^"]*)"|'([^']*)')/i);
  const raw = (hit?.[1] ?? hit?.[2] ?? '').trim();
  if (/^(bold|italic|strike|code|quote|link|image|preview|emoji)/i.test(raw)) return fallback;
  return liveActionPath(raw, fallback);
}

function stripLimitEditTimeComment(body: string): string {
  return body.replace(/\s*<!--sb_limit_edit_time:[1-9][0-9]{9,10}(?::[1-9][0-9]{0,18})?-->\s*$/g, '').trimEnd();
}

/**
 * 取页面里所有 `<form>` 的完整片段。
 * 不能用 `/<form[\s\S]*?<\/form>/`：表单里若嵌套了别的 `</form>`（附件上传器、弹窗表单）
 * 就会在第一个闭合标签处截断，字段全部丢失 —— 表现为「路径推导对了、隐藏域却没了」。
 */
function formBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /<form\b[^>]*>/gi;
  let hit = re.exec(html);
  while (hit) {
    blocks.push(extractBalanced(html, hit.index, 'form').html);
    hit = re.exec(html);
  }
  return blocks;
}

/**
 * 新建回复的表单：官方主题页里的 `.ajax-reply-form`（`action="/reply_edit"` + `topic_id` + `body`）。
 * 与主题侧一致，字段全部从页面读，官方改字段名/加隐藏域都能跟上。
 */
function extractReplyCreateForm(html: string): string | undefined {
  const candidates = formBlocks(html).filter((item) => {
    const open = item.match(/<form\b[^>]*>/i)?.[0] ?? '';
    if (/\bpost-action-form\b/.test(open) || /delete|report/i.test(open)) return false;
    return /<textarea\b[^>]*name="body"/i.test(item) || /name="topic_id"/i.test(item);
  });
  if (!candidates.length) return undefined;
  return candidates.find((item) => /class="[^"]*ajax-reply-form/.test(item))
    ?? candidates.find((item) => !/edit/i.test(item))
    ?? candidates[0];
}

function extractReplyEditForm(html: string): string | undefined {
  const isEditForm = (item: string) => {
    const open = item.match(/<form\b[^>]*>/i)?.[0] ?? '';
    const actionHit = open.match(/\baction=(?:"([^"]*)"|'([^']*)')/i);
    const action = (actionHit?.[1] ?? actionHit?.[2] ?? '').trim();
    if (/\bpost-action-form\b/.test(open) || /delete/i.test(action)) return false;
    return /<textarea\b[^>]*name="body"/i.test(item);
  };
  const panelIdx = html.search(/<(?:div|form|section)\b[^>]*class="[^"]*reply-edit-panel[^"]*"/i);
  if (panelIdx >= 0) {
    const slice = html.slice(panelIdx, panelIdx + 80000);
    const hit = formBlocks(slice).find(isEditForm);
    if (hit) return hit;
  }
  return formBlocks(html).find(isEditForm);
}

function parseNamedSaveSubmit(form: string): Record<string, string> {
  const extra: Record<string, string> = {};
  const buttonRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let hit: RegExpExecArray | null;
  while ((hit = buttonRe.exec(form))) {
    const attrs = hit[1];
    const type = (attrs.match(/\btype="([^"]*)"/i)?.[1] || 'submit').toLowerCase();
    if (type !== 'submit') continue;
    if (/reply-delete-link|icon-delete|删除回帖/.test(`${attrs}${hit[2]}`)) continue;
    const name = attrs.match(/\bname="([^"]+)"/i)?.[1];
    if (!name) continue;
    extra[name] = decode(attrs.match(/\bvalue="([^"]*)"/i)?.[1] ?? '') || stripTags(hit[2]) || '保存';
  }
  const inputRe = /<input\b[^>]*>/gi;
  while ((hit = inputRe.exec(form))) {
    const tag = hit[0];
    const type = (tag.match(/\btype="([^"]*)"/i)?.[1] || '').toLowerCase();
    if (type !== 'submit') continue;
    if (/删除回帖/.test(tag)) continue;
    const name = tag.match(/\bname="([^"]+)"/i)?.[1];
    if (!name) continue;
    extra[name] = decode(tag.match(/\bvalue="([^"]*)"/i)?.[1] ?? '') || '保存';
  }
  return extra;
}

function replyEditPostPath(action: string, replyId: string): string {
  const path = liveActionPath(action, `/reply_edit/${replyId}`);
  if (/\/reply_edit\/\d+/.test(path)) return path;
  if (/\/reply_edit/.test(path) && /[?&]id=/.test(path)) return path;
  return `/reply_edit/${encodeURIComponent(replyId)}`;
}

function dropReplyDeleteFields(fields: Record<string, string>) {
  delete fields.content_type;
  delete fields.content_id;
  delete fields.quoted_cost;
  delete fields.operation_key;
}

function parseReplyEditor(html: string, replyId: string, topicId: string): { action: string; fields: Record<string, string>; body: string } | null {
  const form = extractReplyEditForm(html);
  if (!form && !/<textarea\b[^>]*name="body"/i.test(html)) return null;
  const fields = parseFormFields(form || '');
  dropReplyDeleteFields(fields);
  Object.assign(fields, parseNamedSaveSubmit(form || ''));
  const area = (form || html).match(/<textarea\b[^>]*name="body"[^>]*>([\s\S]*?)<\/textarea>/i);
  const rawBody = fields.body || (area ? decode(area[1]) : '');
  const body = stripLimitEditTimeComment(rawBody);
  if (!fields.id) fields.id = replyId;
  if (!fields.topic_id) fields.topic_id = topicId;
  fields.body = body;
  return { action: formActionPath(form || '', `/reply_edit/${replyId}`), fields, body };
}

function parseReplyEditExtras(html: string): { confirm: string; quote: string; rulesUrl: string; deleteConfirm: string } {
  const editTag = html.match(/<[^>]*data-sb-limit-edit-time-edit-confirm[^>]*>/i)?.[0] || '';
  const prefix = decode(editTag.match(/data-sb-limit-edit-time-edit-confirm="([^"]*)"/i)?.[1] || '').trim();
  const confirm = prefix ? (/是否确认保存/.test(prefix) ? prefix : `${prefix}是否确认保存？`) : '';
  const rulesRaw = decode(editTag.match(/data-rules-url="([^"]*)"/i)?.[1] || '').trim();
  const rulesUrl = rulesRaw ? absUrl(rulesRaw) : '';
  const quoteHtml = extractClassBlock(html, 'sb-limit-edit-time-quote')
    || html.match(/class="[^"]*sb-limit-edit-time-quote[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section)>/i)?.[0]
    || '';
  const quote = stripTags(quoteHtml).replace(/\s+/g, ' ').trim();
  const deleteTag = html.match(/<[^>]*data-sb-limit-edit-time-reply-delete[^>]*>/i)?.[0] || '';
  const deleteConfirm = decode(deleteTag.match(/data-confirm="([^"]*)"/i)?.[1] || '').trim();
  return { confirm, quote, rulesUrl, deleteConfirm };
}

function parseReplyDelete(html: string, topicId: string, replyId: string): { path: string; fields: Record<string, string> } | null {
  const markers = html.match(/<[^>]*data-sb-limit-edit-time-reply-delete[^>]*>/gi) ?? [];
  const marker = markers.find((item) => (item.match(/data-content-id="([^"]+)"/i)?.[1] || '') === replyId)
    ?? (markers.length === 1 ? markers[0] : undefined);
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  let opsForm: string | undefined;
  for (const form of forms) {
    if (!/reply-delete-link|删除回帖|sb-limit-edit-time-delete|icon-delete/.test(form) || /删除主帖|删除主题/.test(form)) continue;
    const parsed = parseFormFields(form);
    const formId = parsed.id || parsed.reply_id || parsed.content_id;
    if (!formId || formId === replyId) {
      opsForm = form;
      break;
    }
  }
  if (!opsForm) {
    for (const form of forms) {
      if (!(/data-sb-limit-edit-time/.test(form) && /content_type/.test(form) && /reply/.test(form))) continue;
      const parsed = parseFormFields(form);
      const formId = parsed.content_id || parsed.id || parsed.reply_id;
      if (formId && formId !== replyId) continue;
      opsForm = form;
      break;
    }
  }
  const fields = opsForm ? { ...parseFormFields(opsForm) } : {};
  if (marker) {
    const url = (marker.match(/data-url="([^"]*)"/i)?.[1] || '').trim();
    fields.content_type = fields.content_type || 'reply';
    fields.content_id = marker.match(/data-content-id="([^"]+)"/i)?.[1] || fields.content_id || replyId;
    fields.topic_id = marker.match(/data-topic-id="([^"]+)"/i)?.[1] || fields.topic_id || topicId;
    const cost = marker.match(/data-cost="([^"]*)"/i)?.[1];
    const key = marker.match(/data-key="([^"]*)"/i)?.[1];
    if (cost !== undefined) fields.quoted_cost = cost;
    if (key !== undefined) fields.operation_key = key;
    if (url) {
      return { path: liveActionPath(url, opsForm ? formActionPath(opsForm, '/reply_edit') : '/reply_edit'), fields };
    }
  }
  if (opsForm) {
    if (!fields.topic_id) fields.topic_id = topicId;
    if (!fields.id && !fields.reply_id && !fields.content_id) fields.id = replyId;
    return { path: formActionPath(opsForm, '/reply_edit'), fields };
  }
  return null;
}

async function loadReplyEditPage(replyId: string): Promise<string> {
  const html = await fetchHtml(`/reply_edit/${encodeURIComponent(replyId)}`, undefined, { fresh: true });
  if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后编辑');
  if (/name="body"|reply-edit-panel/.test(html)) return html;
  const alt = await fetchHtml(`/reply_edit?id=${encodeURIComponent(replyId)}`, undefined, { fresh: true });
  if (isLoginWall(alt)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后编辑');
  return alt;
}

function commentBodyFallback(body: string): string {
  if (/<[a-z][\s\S]*>/i.test(body)) return rewriteHtml(body);
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${escaped.replace(/\n/g, '<br/>')}</p>`;
}

function findParsedComment(html: string, topicId: string, replyId: string): CommentDto | undefined {
  return parseComments(html, topicId).find((item) => item.id === replyId);
}

function parseTopicCollectionForm(html: string): {
  action: string;
  selectName: string;
  actionName: string;
  fields: Record<string, string>;
  items: TopicCollectionPickDto[];
  canCreate: boolean;
} | null {
  const form = html.match(/<form\b[^>]*(?:data-topic-collections-add-form|data-topic-collections-form)[^>]*>[\s\S]*?<\/form>/i)?.[0]
    ?? html.match(/<form\b[^>]*action="[^"]*topic_collection[^"]*"[^>]*>[\s\S]*?<\/form>/i)?.[0];
  const select = (form || html).match(/<select\b[^>]*data-topic-collections-select[\s\S]*?<\/select>/i)?.[0] || '';
  if (!form && !select) return null;
  const block = form || html.match(/data-topic-collections-form[\s\S]{0,12000}/)?.[0] || select;
  const actionInput = block.match(/<input\b[^>]*data-topic-collections-action[^>]*>/i)?.[0] || '';
  const items: TopicCollectionPickDto[] = [];
  const optionRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let hit: RegExpExecArray | null;
  while ((hit = optionRe.exec(select))) {
    const value = hit[1].match(/\bvalue="([^"]*)"/i)?.[1] ?? '';
    if (!value || value.startsWith('__topic_collections_')) continue;
    items.push({
      id: value,
      title: decode(hit[2]).trim() || '专辑',
      included: /data-included="1"/.test(hit[1]),
    });
  }
  return {
    action: formActionPath(form || '', '/topic_collections'),
    selectName: select.match(/\bname="([^"]+)"/i)?.[1] || 'collection_id',
    actionName: actionInput.match(/\bname="([^"]+)"/i)?.[1] || 'action',
    fields: form ? parseFormFields(form) : {},
    items,
    canCreate: /__topic_collections_create__/.test(select),
  };
}

function parseCollectionCreateForm(html: string): { action: string; fields: Record<string, string> } | null {
  const modal = html.match(/data-topic-collections-modal[\s\S]{0,10000}/)?.[0] || '';
  const form = modal.match(/<form\b[\s\S]*?<\/form>/i)?.[0];
  if (!form) return null;
  return { action: formActionPath(form, '/topic_collections'), fields: parseFormFields(form) };
}

function extractTopicEditForm(html: string): string {
  const marked = html.search(/<form\b[^>]*(?:data-slot="[^"]*topic\.form_extra[^"]*"|action="[^"]*topic_edit[^"]*")[^>]*>/i);
  if (marked >= 0) {
    const end = html.indexOf('</form>', marked);
    if (end > marked) return html.slice(marked, end + 7);
  }
  return html.match(/<form\b[^>]*method="post"[\s\S]*?name="title"[\s\S]*?<\/form>/i)?.[0] || html;
}

function parseSelectOptions(html: string, name: string): { value: string; label: string; selected: boolean }[] {
  const escaped = name.replace(/[[\]]/g, '\\$&');
  const select = html.match(new RegExp(`<select\\b[^>]*name="${escaped}"[^>]*>([\\s\\S]*?)</select>`, 'i'))?.[1];
  if (!select) return [];
  const items: { value: string; label: string; selected: boolean }[] = [];
  const optionRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  let hit: RegExpExecArray | null;
  while ((hit = optionRe.exec(select))) {
    items.push({
      value: decode(hit[1].match(/\bvalue="([^"]*)"/i)?.[1] ?? ''),
      label: stripTags(hit[2]),
      selected: /\bselected\b/i.test(hit[1]),
    });
  }
  return items;
}

function collectNamedValues(html: string, name: string): string[] {
  const escaped = name.replace(/[[\]]/g, '\\$&');
  const values: string[] = [];
  const inputRe = new RegExp(`<input\\b[^>]*name="${escaped}"[^>]*>`, 'gi');
  let hit: RegExpExecArray | null;
  while ((hit = inputRe.exec(html))) {
    if (/\bdisabled\b/i.test(hit[0])) continue;
    values.push(decode(hit[0].match(/\bvalue="([^"]*)"/i)?.[1] ?? ''));
  }
  const areaRe = new RegExp(`<textarea\\b[^>]*name="${escaped}"[^>]*>([\\s\\S]*?)</textarea>`, 'gi');
  while ((hit = areaRe.exec(html))) values.push(decode(hit[1]));
  const selectRe = new RegExp(`<select\\b[^>]*name="${escaped}"[^>]*>([\\s\\S]*?)</select>`, 'gi');
  while ((hit = selectRe.exec(html))) {
    const selected = hit[1].match(/<option\b[^>]*\bselected\b[^>]*value="([^"]*)"/i)
      || hit[1].match(/<option\b[^>]*value="([^"]*)"[^>]*\bselected\b/i)
      || hit[1].match(/<option\b[^>]*value="([^"]*)"/i);
    values.push(decode(selected?.[1] ?? ''));
  }
  return values;
}

function inputChecked(html: string, name: string): boolean {
  const escaped = name.replace(/[[\]]/g, '\\$&');
  const tag = html.match(new RegExp(`<input\\b[^>]*name="${escaped}"[^>]*>`, 'i'))?.[0];
  return Boolean(tag && /\bchecked\b/i.test(tag));
}

function parseCheckedRadio(html: string, name: string): string {
  const escaped = name.replace(/[[\]]/g, '\\$&');
  const re = new RegExp(`<input\\b[^>]*name="${escaped}"[^>]*>`, 'gi');
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(html))) {
    if (/\bchecked\b/i.test(hit[0])) return decode(hit[0].match(/\bvalue="([^"]*)"/i)?.[1] ?? '');
  }
  return '';
}

function emptyLotteryPrize(type = 'points'): TopicLotteryPrizeInputDto {
  return { name: '', type, quantity: '1', value: '' };
}

function parseLotteryCompose(form: string): TopicLotteryComposeDto | null {
  const editor = form.match(/<section\b[^>]*data-lottery-editor[^>]*>/i)?.[0];
  if (!editor && !/data-topic-type-option="lottery"/.test(form)) return null;
  const draw = form.match(/<input\b[^>]*name="lottery_draw_at"[^>]*>/i)?.[0] || '';
  const target = form.match(/<input\b[^>]*name="lottery_participant_target"[^>]*>/i)?.[0] || '';
  const minChars = form.match(/<input\b[^>]*name="lottery_min_reply_chars"[^>]*>/i)?.[0] || '';
  const names = collectNamedValues(form, 'lottery_prize_name[]');
  const types = collectNamedValues(form, 'lottery_prize_type[]');
  const quantities = collectNamedValues(form, 'lottery_prize_quantity[]');
  const prizeValues = collectNamedValues(form, 'lottery_prize_value[]');
  const count = Math.max(names.length, types.length, quantities.length, prizeValues.length, 1);
  const prizes: TopicLotteryPrizeInputDto[] = Array.from({ length: count }, (_, index) => ({
    name: names[index] ?? '',
    type: types[index] || 'points',
    quantity: quantities[index] || '1',
    value: prizeValues[index] ?? '',
  }));
  const prizeTypes = parseSelectOptions(form, 'lottery_prize_type[]').map((item) => ({ value: item.value, label: item.label }));
  const reviewHref = first(form, /community-lottery-publish-warning[\s\S]{0,400}?href="([^"]+)"/) || '';
  return {
    originalType: collectNamedValues(form, 'community_lottery_original_type')[0] || '',
    drawAt: decode(draw.match(/\bvalue="([^"]*)"/i)?.[1] ?? ''),
    drawMin: decode(draw.match(/\bmin="([^"]*)"/i)?.[1] ?? ''),
    drawMax: decode(draw.match(/\bmax="([^"]*)"/i)?.[1] ?? ''),
    participantTarget: decode(target.match(/\bvalue="([^"]*)"/i)?.[1] ?? '0') || '0',
    participantMax: Number(formAttr(target, 'data-lottery-target-limit') || target.match(/\bmax="([^"]*)"/i)?.[1] || 500) || 500,
    minReplyChars: decode(minChars.match(/\bvalue="([^"]*)"/i)?.[1] ?? '5') || '5',
    replyCaptcha: inputChecked(form, 'lottery_reply_captcha_required'),
    walletName: formAttr(editor || '', 'data-lottery-wallet-name') || '烧饼',
    walletUrl: formAttr(editor || '', 'data-lottery-wallet-url') || '/community_wallet',
    walletHelpUrl: formAttr(editor || '', 'data-lottery-wallet-help-url') || '/topic/15751',
    walletMin: Number(formAttr(editor || '', 'data-lottery-wallet-min') || 0) || 0,
    walletBalance: Number(formAttr(editor || '', 'data-lottery-wallet-balance') || 0) || 0,
    reviewUrl: decode(reviewHref),
    ruleNote: stripTags(first(form, /community-lottery-rule-note[^>]*>([\s\S]*?)<\/div>/) || ''),
    prizes: prizes.some((item) => item.name || item.value) ? prizes : [emptyLotteryPrize(prizeTypes[0]?.value || 'points')],
    prizeTypes: prizeTypes.length ? prizeTypes : [
      { value: 'points', label: '积分' },
      { value: 'wallet', label: '烧饼' },
      { value: 'code', label: '兑换码' },
      { value: 'manual', label: '手工发奖' },
    ],
  };
}

function parseVirtualCardCompose(form: string): TopicVirtualCardComposeDto | null {
  if (!/data-topic-type-option="virtual_card"/.test(form) && !/name="virtual_card_name"/.test(form)) return null;
  const currencyOptions = parseSelectOptions(form, 'virtual_card_currency');
  const currencies = currencyOptions.map((item) => ({ value: item.value, label: item.label }));
  const selectedCurrency = currencyOptions.find((item) => item.selected)?.value || 'points';
  const reviewHref = first(form, /virtual-card-publish-warning[\s\S]{0,400}?href="([^"]+)"/) || '';
  return {
    originalType: collectNamedValues(form, 'virtual_card_original_type')[0] || '',
    name: collectNamedValues(form, 'virtual_card_name')[0] || '',
    currency: selectedCurrency,
    currencies: currencies.length ? currencies : [
      { value: 'points', label: '积分' },
      { value: 'wallet', label: '烧饼' },
    ],
    price: collectNamedValues(form, 'virtual_card_price')[0] || '1',
    purchaseLimit: collectNamedValues(form, 'virtual_card_purchase_limit')[0] || '1',
    autoReply: inputChecked(form, 'virtual_card_auto_reply'),
    autoReplyContent: collectNamedValues(form, 'virtual_card_auto_reply_content')[0] || '已成功兑换虚拟卡「{card_name}」。',
    values: collectNamedValues(form, 'virtual_card_values')[0] || '',
    reviewUrl: decode(reviewHref),
  };
}

/**
 * 发帖页的红包表单（`.red-packet-compose` 里的 `[data-red-packet-fields]`）。
 * 限值取自 `data-red-packet-*`，默认值取自各输入框；官网改范围时跟得上。
 */
export function parseRedPacketCompose(form: string): TopicRedPacketComposeDto | null {
  const block = extractClassBlock(form, 'red-packet-compose');
  if (!block) return null;
  const fields = block.match(/data-red-packet-fields[^>]*>/)?.[0] ?? '';
  if (!fields) return null;
  const num = (tag: string, name: string) => Number(tag.match(new RegExp(`\\b${name}="(\\d+)"`))?.[1] ?? 0);
  const distribution = first(block, /<select[^>]*name="red_packet_distribution"[^>]*>[\s\S]*?<option[^>]*value="([^"]+)"/) || 'fixed';
  const claimRule = first(block, /<select[^>]*name="red_packet_claim_rule"[^>]*>[\s\S]*?<option[^>]*value="([^"]+)"/) || 'first_come';
  const balance = block.match(/data-red-packet-balance[^>]*>/)?.[0] ?? '';
  const value = (name: string) => first(block, new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`)) || '';
  return {
    distribution: distribution === 'random' ? 'random' : 'fixed',
    claimRule: claimRule === 'random_chance' ? 'random_chance' : 'first_come',
    minReplyChars: value('red_packet_min_reply_chars') || '5',
    count: value('red_packet_count') || '1',
    fixedAmount: value('red_packet_fixed_amount') || '1',
    totalAmount: value('red_packet_total_amount') || '1',
    maxUnit: num(fields, 'data-red-packet-max-unit') || 1000,
    minUnit: num(fields, 'data-red-packet-minimum-unit') || 1,
    minTotal: num(fields, 'data-red-packet-minimum-total') || 1,
    points: num(balance, 'data-points'),
    reviewUrl: first(block, /href="([^"]*topic\/13879[^"]*)"/) || '',
  };
}

function parseTopicEditor(html: string): TopicEditorDto {
  rememberUploadPermissionFrom(html);
  const form = extractTopicEditForm(html);
  const fields = parseFormFields(form);
  const title = fields.title
    || first(form, /<input\b[^>]*name="title"[^>]*value="([^"]*)"/i)
    || '';
  const body = fields.body
    || first(form, /<textarea\b[^>]*name="body"[^>]*>([\s\S]*?)<\/textarea>/i)
    || '';
  const forumOptions = parseSelectOptions(form, 'forum_id');
  const forums = forumOptions.filter((item) => item.value).map((item) => ({ id: item.value, name: item.label }));
  const selectedForum = forumOptions.find((item) => item.selected);
  const forumId = fields.forum_id || selectedForum?.value || forums[0]?.id || '';
  const forumName = forums.find((item) => item.id === forumId)?.name || selectedForum?.label || '';
  const specialRaw = parseCheckedRadio(form, 'topic_special_type');
  const specialType: TopicSpecialType = specialRaw === 'lottery' || specialRaw === 'virtual_card' || specialRaw === 'red_packet'
    ? specialRaw
    : '';
  return {
    title: title.trim(),
    body,
    forum: forumName.trim(),
    forumId,
    forums,
    specialType,
    lottery: parseLotteryCompose(form),
    virtualCard: parseVirtualCardCompose(form),
    redPacket: parseRedPacketCompose(form),
  };
}

const TOPIC_SPECIAL_FIELD_KEYS = [
  'topic_special_type',
  'community_lottery_original_type',
  'virtual_card_original_type',
  'lottery_draw_at',
  'lottery_participant_target',
  'lottery_min_reply_chars',
  'lottery_reply_captcha_required',
  'lottery_prize_name[]',
  'lottery_prize_type[]',
  'lottery_prize_quantity[]',
  'lottery_prize_value[]',
  'virtual_card_name',
  'virtual_card_currency',
  'virtual_card_price',
  'virtual_card_purchase_limit',
  'virtual_card_auto_reply',
  'virtual_card_auto_reply_content',
  'virtual_card_values',
  'red_packet_distribution',
  'red_packet_claim_rule',
  'red_packet_min_reply_chars',
  'red_packet_count',
  'red_packet_fixed_amount',
  'red_packet_total_amount',
  'red_packet_confirm',
];

export function topicSpecialPostFields(input: TopicComposeInput): Record<string, string | string[]> {
  const special = input.specialType === 'lottery' || input.specialType === 'virtual_card' || input.specialType === 'red_packet'
    ? input.specialType
    : '';
  const fields: Record<string, string | string[]> = {
    topic_special_type: special,
    community_lottery_original_type: input.lottery?.originalType ?? '',
    virtual_card_original_type: input.virtualCard?.originalType ?? '',
  };
  if (special === 'lottery' && input.lottery) {
    const prizes = input.lottery.prizes.length ? input.lottery.prizes : [emptyLotteryPrize()];
    fields.lottery_draw_at = input.lottery.drawAt;
    fields.lottery_participant_target = input.lottery.participantTarget || '0';
    fields.lottery_min_reply_chars = input.lottery.minReplyChars || '5';
    if (input.lottery.replyCaptcha) fields.lottery_reply_captcha_required = '1';
    fields['lottery_prize_name[]'] = prizes.map((item) => item.name);
    fields['lottery_prize_type[]'] = prizes.map((item) => item.type || 'points');
    fields['lottery_prize_quantity[]'] = prizes.map((item) => item.quantity || '1');
    fields['lottery_prize_value[]'] = prizes.map((item) => item.value);
  }
  if (special === 'red_packet' && input.redPacket) {
    const red = input.redPacket;
    fields.red_packet_distribution = red.distribution === 'random' ? 'random' : 'fixed';
    fields.red_packet_claim_rule = red.claimRule === 'random_chance' ? 'random_chance' : 'first_come';
    fields.red_packet_min_reply_chars = red.minReplyChars || '5';
    fields.red_packet_count = red.count || '1';
    if (red.distribution === 'random') fields.red_packet_total_amount = red.totalAmount || '1';
    else fields.red_packet_fixed_amount = red.fixedAmount || '1';
    // 官网用这个 hidden 字段确认「确实要发红包」，缺了会被服务端拒
    fields.red_packet_confirm = '1';
  }
  if (special === 'virtual_card' && input.virtualCard) {
    fields.virtual_card_name = input.virtualCard.name;
    fields.virtual_card_currency = input.virtualCard.currency || 'points';
    fields.virtual_card_price = input.virtualCard.price || '1';
    fields.virtual_card_purchase_limit = input.virtualCard.purchaseLimit || '1';
    if (input.virtualCard.autoReply) fields.virtual_card_auto_reply = '1';
    fields.virtual_card_auto_reply_content = input.virtualCard.autoReplyContent;
    fields.virtual_card_values = input.virtualCard.values;
  }
  return fields;
}

function composeInputFrom(payload: Record<string, unknown>): TopicComposeInput {
  const lottery = payload.lottery && typeof payload.lottery === 'object' ? payload.lottery as Record<string, unknown> : null;
  const card = payload.virtualCard && typeof payload.virtualCard === 'object' ? payload.virtualCard as Record<string, unknown> : null;
  const red = payload.redPacket && typeof payload.redPacket === 'object' ? payload.redPacket as Record<string, unknown> : null;
  const prizes = lottery && Array.isArray(lottery.prizes) ? lottery.prizes.map((item) => {
    const prize = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      name: String(prize.name ?? ''),
      type: String(prize.type ?? 'points'),
      quantity: String(prize.quantity ?? '1'),
      value: String(prize.value ?? ''),
    };
  }) : [];
  return {
    title: String(payload.title ?? ''),
    body: String(payload.body ?? ''),
    forum: String(payload.forum ?? ''),
    specialType: payload.specialType === 'lottery' || payload.specialType === 'virtual_card' || payload.specialType === 'red_packet'
      ? payload.specialType
      : '',
    lottery: lottery ? {
      originalType: String(lottery.originalType ?? ''),
      drawAt: String(lottery.drawAt ?? ''),
      participantTarget: String(lottery.participantTarget ?? '0'),
      minReplyChars: String(lottery.minReplyChars ?? '5'),
      replyCaptcha: Boolean(lottery.replyCaptcha),
      prizes,
    } : undefined,
    redPacket: red ? {
      distribution: red.distribution === 'random' ? 'random' : 'fixed',
      claimRule: red.claimRule === 'random_chance' ? 'random_chance' : 'first_come',
      minReplyChars: String(red.minReplyChars ?? '5'),
      count: String(red.count ?? '1'),
      fixedAmount: String(red.fixedAmount ?? '1'),
      totalAmount: String(red.totalAmount ?? '1'),
    } : undefined,
    virtualCard: card ? {
      originalType: String(card.originalType ?? ''),
      name: String(card.name ?? ''),
      currency: String(card.currency ?? 'points'),
      price: String(card.price ?? '1'),
      purchaseLimit: String(card.purchaseLimit ?? '1'),
      autoReply: Boolean(card.autoReply),
      autoReplyContent: String(card.autoReplyContent ?? ''),
      values: String(card.values ?? ''),
    } : undefined,
  };
}

async function submitTopicEdit(editorHtml: string, input: TopicComposeInput, id: string): Promise<TopicDto> {
  if (isLoginWall(editorHtml)) throw new MockApiError(401, 'UNAUTHORIZED', id === '0' ? '请先登录后发帖' : '请先登录后编辑');
  const parsed = parseTopicEditor(editorHtml);
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new MockApiError(400, 'VALIDATION', '标题和内容不能为空');
  const fromComposer = parsed.forums.find((item) => item.name === input.forum || item.id === input.forum)?.id || '';
  const forumId = fromComposer || (input.forum && input.forum !== parsed.forum ? await resolveForumId(input.forum) : '') || parsed.forumId;
  if (!forumId) throw new MockApiError(400, 'VALIDATION', '请选择版块');
  const editorForm = extractTopicEditForm(editorHtml);
  const fields = editorForm ? parseFormFields(editorForm) : {};
  for (const key of TOPIC_SPECIAL_FIELD_KEYS) delete fields[key];
  const posted = await postForm(formActionPath(editorForm, '/topic_edit'), {
    ...fields,
    _csrf: fields._csrf || csrfFrom(editorHtml),
    id,
    forum_id: forumId,
    title,
    body,
    ...topicSpecialPostFields({
      ...input,
      lottery: input.lottery
        ? { ...input.lottery, originalType: input.lottery.originalType ?? parsed.lottery?.originalType ?? '' }
        : undefined,
      virtualCard: input.virtualCard
        ? { ...input.virtualCard, originalType: input.virtualCard.originalType ?? parsed.virtualCard?.originalType ?? '' }
        : undefined,
    }),
  }, false);
  if (isLoginWall(posted.html) || (posted.json && posted.json.ok === false)) {
    throw new MockApiError(400, 'UPSTREAM', formError(posted.html, String(posted.json?.message || (id === '0' ? '发帖失败' : '保存失败'))));
  }
  const savedId = posted.url.match(/\/topic\/(\d+)/)?.[1]
    || posted.html.match(/href="\/topic\/(\d+)"/)?.[1]
    || (id !== '0' ? id : '');
  if (!savedId) throw new MockApiError(400, 'UPSTREAM', formError(posted.html, id === '0' ? '发帖失败' : '保存失败'));
  if (id !== '0') bustTopicCache(id);
  bustAccountCache();
  const html = posted.url.includes('/topic/') && /post-content-title/.test(posted.html)
    ? posted.html
    : await fetchHtml(`/topic/${encodeURIComponent(savedId)}`, undefined, { fresh: true });
  return parseTopicDetail(html, savedId);
}

function parseTopicDelete(html: string, topicId: string): { path: string; fields: Record<string, string> } | null {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  for (const form of forms) {
    if (/reply_id|删除回帖|content_type"[^>]*value="reply"|value="reply"/.test(form) && !/删除主帖|删除主题/.test(form)) continue;
    const looksDelete = /删除主帖|删除主题|topic_delete|name="delete"|value="delete"|name="operation"[^>]*value="delete"/.test(form)
      || (/data-sb-limit-edit-time/.test(form) && /content_type/.test(form) && /topic/.test(form) && !/reply/.test(form));
    if (!looksDelete) continue;
    const fields = parseFormFields(form);
    if (!fields.topic_id) fields.topic_id = topicId;
    if (!fields.id) fields.id = topicId;
    return { path: formActionPath(form, '/topic_edit'), fields };
  }
  const href = html.match(/href="(\/topic_delete[^"]*)"/)?.[1];
  if (href) {
    return { path: href.replace(/&amp;/g, '&'), fields: { id: topicId, topic_id: topicId } };
  }
  const marker = html.match(/<[^>]*data-sb-limit-edit-time-[^>]*topic-delete[^>]*>/i)?.[0]
    || html.match(/<[^>]*data-sb-limit-edit-time[^>]*data-url="[^"]+"[^>]*>/i)?.[0];
  if (marker && !/reply/i.test(marker)) {
    const url = marker.match(/data-url="([^"]+)"/i)?.[1];
    if (url) {
      return {
        path: url.replace(/^https?:\/\/(?:www\.)?linux\.sb/i, ''),
        fields: {
          content_type: 'topic',
          content_id: marker.match(/data-content-id="([^"]+)"/i)?.[1] || topicId,
          topic_id: marker.match(/data-topic-id="([^"]+)"/i)?.[1] || topicId,
          quoted_cost: marker.match(/data-cost="([^"]+)"/i)?.[1] || '',
          operation_key: marker.match(/data-key="([^"]+)"/i)?.[1] || '',
        },
      };
    }
  }
  return null;
}

function parseCollections(html: string): CollectionDto[] {
  const blocks = html.match(/<li class="post-item topic-collections-collection-row"[\s\S]*?<\/li>/g) ?? [];
  return blocks.map((block, index) => {
    const id = block.match(/href="\/topic_collection\/(\d+)"/)?.[1] ?? String(index);
    const title = decode(first(block, /class="post-title"[^>]*>([\s\S]*?)<\/a>/) || '淘帖');
    const author = decode(first(block, /aria-label="查看\s+([^"]+?)\s+的个人主页"/) || '饼友');
    const count = Number(block.match(/(\d+)\s*篇文章/)?.[1] ?? 0);
    const updated = block.match(/更新于\s*([^<]+)/)?.[1]?.trim();
    const publicTag = /topic-collections-tag-public/.test(block);
    return {
      id,
      title,
      author,
      count,
      updatedAt: unixToIso(null, updated ?? null),
      desc: `${count} 篇文章`,
      accent: accentFor(author),
      public: publicTag,
    };
  });
}

function parseNotifyBadge(html: string): number {
  const aria = html.match(/aria-label="(\d+)\s*条未读通知"/)?.[1];
  if (aria) return Number(aria);
  const pill = html.match(/class="(?:notify-badge|mobile-nav-unread)"[^>]*>\s*(9\+|\d+)/)?.[1];
  if (pill === '9+') return 10;
  if (pill) return Number(pill);
  return 0;
}

function notificationKind(block: string, label: string): NotificationKind {
  if (label.includes('提及')) return 'mention';
  if (label.includes('打赏') || /打赏了你/.test(block)) return 'reward';
  if (label.includes('回复')) return 'reply';
  if (/打赏/.test(block)) return 'reward';
  if (/提及/.test(block)) return 'mention';
  if (/回复了你|回复了你的/.test(block)) return 'reply';
  return 'system';
}

function isPrivateMessageNotice(block: string): boolean {
  if (/notification-reply-action/.test(block) || />\s*回复TA\s*</.test(block)) return true;
  if (/href="\/notify\/\d+[^"]*(?:\?|&amp;|&)quote=/.test(block) && !/href="\/topic\//.test(block)) return true;
  return false;
}

function notifyFingerprint(kind: string, topicId: string | null | undefined, content: string): string {
  const raw = `${kind}|${topicId || ''}|${String(content || '').replace(/\s+/g, ' ').trim()}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `n-${(hash >>> 0).toString(36)}`;
}

function parseNotifications(html: string): NotificationDto[] {
  /**
   * 通知行的判定放宽一点：主标记是 `notification-item`，官网若改了类名，
   * 还能靠通知链接（/notify/<id>）或通知内容类名认出来，
   * 免得出现「未读数有值、列表却永远 0 条」这种最难看的情况。
   */
  const blocks = extractPostItems(html).filter((block) => (
    /notification-item/.test(block)
    || /href="\/notify\/\d+/.test(block)
    || /notification-(?:kind|content|head)/.test(block)
  ) && !isPrivateMessageNotice(block));
  return blocks.map((block) => {
    const className = block.match(/<li\b[^>]*class="([^"]*)"/i)?.[1] ?? '';
    const unread = /\bunread\b/.test(className) || /notification-unread/.test(block);
    const kindLabel = decode(first(block, /notification-kind"[^>]*>([^<]+)/) || '通知');
    const kind = notificationKind(block, kindLabel);
    const actorName = stripTags(
      first(block, /aria-label="查看\s+([^"]+?)\s+的个人主页"/)
      || first(block, /class="post-title"[^>]*>([\s\S]*?)<\/(?:a|span)>/)
      || '饼友',
    ) || '饼友';
    const actorAvatar = block.match(/src="([^"]+)"/)?.[1];
    const hrefs = [...block.matchAll(/href="(\/topic\/[^"]+)"/g)].map((hit) => hit[1]);
    const parsedHrefs = hrefs.map(parseTopicHref).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const topicHref = parsedHrefs.find((item) => item.replyId) || parsedHrefs[0];
    const content = stripTags(
      innerByClass(block, 'nb-editor-post-content')
      || innerByClass(block, 'notification-content')
      || '',
    );
    const markedTitle = stripTags(first(block, /主题《<a[^>]*>([\s\S]*?)<\/a>》/) || '');
    const linkTitle = stripTags(first(block, /href="\/topic\/[^"]+"[^>]*>([\s\S]*?)<\/a>/) || '');
    const topicTitle = markedTitle
      || (linkTitle && linkTitle !== content ? linkTitle : '');
    const timeLabel = first(block, /class="post-meta"><span>([^<]+)/)
      || first(block, /class="post-time"[^>]*>([\s\S]*?)<\/span>/)
      || first(block, /<span>(\d+[分钟小时天]+前|昨天|刚刚|[\d-]+)<\/span>/);
    const notifyId = block.match(/\/notify\/(\d+)/)?.[1]
      || block.match(/data-(?:notification-)?id="(\d+)"/)?.[1];
    return {
      id: notifyId || notifyFingerprint(kind, topicHref?.topicId, content),
      kind,
      actorName,
      actorAvatar: actorAvatar ? absUrl(actorAvatar) : letter(actorName),
      accent: accentFor(actorName),
      text: redactSecrets(content),
      topicId: topicHref?.topicId ?? null,
      replyId: topicHref?.replyId ?? null,
      topicTitle,
      createdAt: unixToIso(null, timeLabel),
      unread,
    };
  });
}

/**
 * 未读数短缓存：启动时（refreshMe / pollAndNotify / 消息页）会同时问未读数，
 * 而 /notification_live_badge_status 绕过了 fetchHtml 的缓存与合并，
 * 之前一次冷启动要打三遍同一个接口。这里做 15s 记忆 + 并发合并。
 * 写操作（标记已读、账号缓存失效）必须 bustUnreadCount()。
 */
const UNREAD_TTL_MS = 15_000;
let unreadMemo: { at: number; value: number } | null = null;
let unreadInflight: Promise<number> | null = null;

export function bustUnreadCount() {
  unreadMemo = null;
}

async function fetchUnreadCount(): Promise<number> {
  if (!liveCookie() && !currentUserId()) return 0;
  if (unreadMemo && Date.now() - unreadMemo.at < UNREAD_TTL_MS) return unreadMemo.value;
  if (unreadInflight) return unreadInflight;
  unreadInflight = readUnreadCount().finally(() => {
    unreadInflight = null;
  });
  return unreadInflight;
}

function rememberUnreadCount(value: number): number {
  unreadMemo = { at: Date.now(), value };
  return value;
}

async function readUnreadCount(): Promise<number> {
  try {
    const badge = await linuxRequest('/notification_live_badge_status', {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
      accept: 'application/json',
    });
    const raw = badge.json?.unread ?? badge.json?.count ?? badge.json?.unread_count;
    const n = Number(raw);
    if (badge.json && Number.isFinite(n) && n >= 0) return rememberUnreadCount(Math.floor(n));
    // 会话失效时接口回 {"ok":1,"redirect":"/login"}：直接当 0，别再去抓 144KB 首页（原来这里白花一次往返）
    if (badge.json?.redirect) return rememberUnreadCount(0);
  } catch {
    /* homepage fallback */
  }
  try {
    const html = await fetchHtml('/', undefined, { fresh: true });
    return rememberUnreadCount(parseNotifyBadge(html));
  } catch {
    return unreadMemo?.value ?? 0;
  }
}

function parseDirectMessages(html: string): DirectThreadDto[] {
  // 首选官方类名；类名变了就退回「任何一个指向 /direct_messages/<uid> 的会话链接」。
  const named = html.match(/<a[^>]*class="[^"]*direct-messages-conversation[^"]*"[\s\S]*?<\/a>/g);
  const blocks = named?.length
    ? named
    : (html.match(/<a\b[^>]*href="\/direct_messages\/\d+[^"]*"[\s\S]*?<\/a>/g) ?? []);
  return blocks.map((block) => {
    const userId = block.match(/href="\/direct_messages\/(\d+)"/)?.[1]
      || attr(block, 'data-online-user-id')
      || '0';
    const name = decode(first(block, /<strong>([^<]+)<\/strong>/) || '饼友');
    const preview = first(block, /<small>([\s\S]*?)<\/small>/) || '';
    const timeLabel = first(block, /<time>([^<]+)<\/time>/);
    const avatarSrc = block.match(/src="([^"]+)"/)?.[1];
    return {
      id: userId,
      userId,
      name,
      preview: stripTags(preview),
      createdAt: unixToIso(null, timeLabel),
      avatar: avatarSrc ? absUrl(avatarSrc) : letter(name),
      accent: accentFor(name),
    };
  });
}

function dmText(html: string): string {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseDirectMessageBlocks(html: string): DirectMessageDto[] {
  const blocks = html.match(/<article class="direct-messages-message[^"]*"[\s\S]*?<\/article>/g) ?? [];
  const out: DirectMessageDto[] = [];
  blocks.forEach((block) => {
    const id = attr(block, 'data-message-id');
    if (!id) return;
    const cls = block.match(/<article[^>]*class="([^"]*)"/i)?.[1] ?? '';
    const mine = /\bis-mine\b/.test(cls);
    const contentHtml = block.match(/class="direct-messages-content"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    const quoteHtml = contentHtml.match(/<span class="direct-messages-quote"[^>]*>([\s\S]*?)<\/span>/i)?.[1];
    const bodyHtml = contentHtml.replace(/<span class="direct-messages-quote"[^>]*>[\s\S]*?<\/span>/i, '');
    const authorName = decode(first(block, /class="direct-messages-meta"[^>]*>\s*<strong>([^<]*)<\/strong>/) || (mine ? '我' : '对方'));
    const timeIso = block.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
    const timeLabel = first(block, /<time[^>]*>([^<]*)<\/time>/);
    const avatarSrc = block.match(/<img[^>]*src="([^"]+)"/)?.[1];
    out.push({
      id,
      mine,
      authorName,
      avatar: avatarSrc ? absUrl(avatarSrc) : letter(authorName),
      accent: accentFor(authorName),
      content: dmText(bodyHtml),
      quote: quoteHtml ? dmText(quoteHtml) || undefined : undefined,
      createdAt: timeIso || unixToIso(null, timeLabel),
    });
  });
  return out;
}

function parseDirectConversation(html: string, partnerId: string): DirectConversationDto {
  const head = html.match(/<div class="direct-messages-thread-head[\s\S]*?class="direct-messages-compose/)?.[0] ?? html;
  const name = decode(first(head, /class="direct-messages-thread-user"[\s\S]*?<strong>([^<]*)<\/strong>/) || '饼友');
  const avatarSrc = head.match(/class="direct-messages-thread-avatar"[\s\S]*?<img[^>]*src="([^"]+)"/)?.[1];
  return {
    partnerId,
    name,
    avatar: avatarSrc ? absUrl(avatarSrc) : letter(name),
    accent: accentFor(name),
    lastId: attr(html, 'data-last-id') || '0',
    messages: parseDirectMessageBlocks(html),
  };
}

function searchHitToTopic(hit: SearchHitDto): TopicDto {
  return {
    id: hit.id,
    title: hit.title,
    body: hit.snippet,
    forumId: '',
    forumName: hit.forumName,
    authorId: '',
    authorName: '',
    avatar: letter(hit.title),
    accent: accentFor(hit.title),
    createdAt: hit.createdAt,
    replyCount: hit.replyCount,
    viewCount: hit.viewCount,
    likeCount: 0,
    favoriteCount: 0,
    liked: false,
    favorited: false,
    tags: hit.hasImage ? [{ type: 'card', label: '包含图片' }] : [],
  };
}

function parseSearchHits(html: string): SearchHitDto[] {
  const blocks = html.match(/<li class="meilisearch-search-result"(?![^>]*user)[\s\S]*?<\/li>/g) ?? [];
  return blocks.map((block, index) => {
    const href = block.match(/href="\/topic\/(\d+)/);
    const title = stripTags(first(block, /meilisearch-search-result-title"[^>]*>([\s\S]*?)<\/a>/) || '主题');
    const meta = block.match(/meilisearch-search-result-meta"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    const spans = [...meta.matchAll(/<span>([^<]*)<\/span>/g)].map((hit) => decode(hit[1]).trim()).filter(Boolean);
    const match = spans.find((text) => /命中/.test(text)) || spans[0] || '';
    const timeLabel = spans.find((text) => /前|昨天|刚刚|\d{4}-/.test(text)) ?? '';
    const forumName = spans.find((text) => text !== match && text !== timeLabel && !/条回复|次浏览|包含图片/.test(text)) || '';
    return {
      id: href?.[1] ?? `s${index}`,
      title,
      snippet: stripTags(first(block, /meilisearch-search-result-snippet">([\s\S]*?)<\/div>/) || ''),
      forumName,
      createdAt: unixToIso(null, timeLabel),
      replyCount: Number(block.match(/(\d+)\s*条回复/)?.[1] ?? 0),
      viewCount: Number(block.match(/(\d+)\s*次浏览/)?.[1] ?? 0),
      match,
      hasImage: /包含图片/.test(block),
    };
  });
}

function parseSearchUsers(html: string): UserDto[] {
  const blocks = html.match(/<li class="meilisearch-search-user-result"[\s\S]*?<\/li>/g) ?? [];
  return blocks.map((block, index) => {
    const id = block.match(/href="\/user\/(\d+)/)?.[1] ?? `u${index}`;
    const name = stripTags(first(block, /<strong>([\s\S]*?)<\/strong>/) || '饼友');
    const meta = stripTags(first(block, /meilisearch-search-user-meta">([\s\S]*?)<\/span>/) || '');
    const groupLabel = decode(meta.split(/[·•]/)[0] || '饼友').trim();
    const joined = meta.match(/注册于\s*([^\s·•]+)/)?.[1] ?? '';
    const src = block.match(/src="([^"]+)"/)?.[1];
    return {
      id,
      name,
      title: groupLabel,
      group: mapGroup(groupLabel),
      groupLabel,
      points: 0,
      uid: id,
      avatar: src ? absUrl(src) : letter(name),
      accent: accentFor(name),
      bio: '',
      topicCount: 0,
      replyCount: 0,
      joinedAt: joined,
    };
  });
}

function emptySearchResult(partial: Partial<SearchResultDto> = {}): SearchResultDto {
  return {
    q: '',
    scope: 'all',
    sort: 'relevance',
    summary: '',
    cost: 1,
    balance: 0,
    costNote: '每次提交搜索扣除 1 积分。确认后才会执行搜索。',
    placeholder: '搜索标题、主题内容和回帖',
    emptyHint: '输入关键词，搜索社区中的主题和回帖。',
    total: 0,
    page: 1,
    nextPage: null,
    hits: [],
    topics: [],
    users: [],
    forums: [],
    ...partial,
  };
}

function parseSearchPage(html: string, q: string, scope: string, sort: string, page: number): SearchResultDto {
  const hits = parseSearchHits(html);
  const users = parseSearchUsers(html);
  const summary = stripTags(first(html, /meilisearch-search-summary">([\s\S]*?)<\/div>/) || '');
  const costNote = stripTags(first(html, /meilisearch-search-cost-note">([\s\S]*?)<\/p>/) || '');
  const emptyHint = stripTags(
    first(html, /meilisearch-search-empty[^>]*>([\s\S]*?)<\//)
    || (!q ? '输入关键词，搜索社区中的主题和回帖。' : ''),
  );
  const total = Number(summary.match(/(\d[\d,]*)\s*个(?:主题|用户)/)?.[1]?.replace(/,/g, '') ?? (hits.length || users.length));
  return emptySearchResult({
    q,
    scope: decode(html.match(/name="scope"[^>]*value="([^"]*)"/)?.[1] || scope),
    sort,
    summary,
    cost: Number(html.match(/data-search-cost="(\d+)"/)?.[1] ?? 1),
    balance: Number(html.match(/data-search-balance="(\d+)"/)?.[1] ?? parseAccountPoints(html, 0)),
    costNote: costNote || emptySearchResult().costNote,
    placeholder: decode(html.match(/name="q"[^>]*placeholder="([^"]*)"/)?.[1] ?? (scope === 'user' ? '搜索用户名' : '搜索标题、主题内容和回帖')),
    emptyHint: emptyHint || (scope === 'user' ? '输入用户名搜索' : '输入关键词，搜索社区中的主题和回帖。'),
    total,
    page,
    nextPage: nextPage(html, page),
    hits,
    topics: hits.map(searchHitToTopic),
    users,
  });
}

/**
 * 首页侧栏「每日热帖」。
 *
 * 官方把它放在首页/版块页的侧栏（`card sidebar-card quick-card daily-hot-topics-card`），
 * 内容是近 24 小时回复最多的 8 个主题。**这块就在我们已经抓下来的 HTML 里**
 * （`/index.php?sort=comment` 每页都带），所以放首页展示是零额外请求 —— 以前整块丢掉了。
 *
 * 「精华 / 足迹」这两个模板没有这块，此时返回 null（调用方保留上一次的结果，别让区块闪掉）。
 */
export function parseDailyHotTopics(html: string): DailyHotTopicDto[] | null {
  const list = html.match(/<ul[^>]*daily-hot-topics-list[\s\S]*?<\/ul>/);
  if (!list) return null;
  const window = decode(
    html.match(/daily-hot-topics-head[\s\S]{0,200}?<span[^>]*>([^<]+)<\/span>/)?.[1] || '',
  ).trim();
  const items: DailyHotTopicDto[] = [];
  (list[0].match(/<li[\s\S]*?<\/li>/g) ?? []).forEach((row) => {
    const id = row.match(/href="\/topic\/(\d+)/)?.[1];
    const title = decode(first(row, /daily-hot-topics-title"[^>]*>([\s\S]*?)<\/span>/) || '').trim();
    const countText = decode(first(row, /daily-hot-topics-count"[^>]*>([\s\S]*?)<\/span>/) || '').trim();
    if (!id || !title) return;
    items.push({
      id,
      title,
      replies: Number(countText.match(/(\d+)\s*回复/)?.[1] ?? 0),
      window: window || countText.replace(/\d+\s*回复/, '').trim(),
    });
  });
  return items;
}

/**
 * 解析一页「积分流水」里的签到记录，连同翻页需要的信号一起给出。
 *
 * 抽成纯函数（而不是写在路由里）是为了能离线回归，见 `npm run check:checkin`。
 *
 * `hasRows` 表示**这页上游到底有没有流水行**，和筛出来的签到条数是两回事：
 * 签到一天才 1 条，中间好几页一条签到都没有（实测第 2、4、6 页为 0 条），
 * 但后面还有更早的记录。翻页游标只看官方分页器，别用筛选结果当结束信号。
 */
export function parseCheckinPage(
  html: string,
  page: number,
): { items: PointsDto['history']; nextCursor: string | null; hasRows: boolean; lastPage: number } {
  const hasRows = /<li class="post-item points-rewards-detail/.test(html);
  return {
    items: parseCheckinRows(html),
    // 有流水但分页器没有「下一页」= 已经是最后一页
    nextCursor: hasRows ? nextPage(html, page) : null,
    hasRows,
    // 复用已有的 tab 分页器解析：只认 tab=points_rewards&p=N，不会误抓别的链接
    lastPage: lastPageOf(html, 'points_rewards'),
  };
}

function parseCheckinRows(html: string): PointsDto['history'] {
  const rows = html.match(/<li class="post-item points-rewards-detail[\s\S]*?<\/li>/g) ?? [];
  const history: PointsDto['history'] = [];
  rows.forEach((row) => {
    const reason = decode(first(row, /points-rewards-reason">([^<]+)/) || '');
    if (!reason.includes('每日签到')) return;
    const date = row.match(/datetime="([^"]+)"/)?.[1] || first(row, /points-rewards-time"[^>]*>([^<]+)/) || '';
    const gainRaw = row.match(/points-rewards-change-value[^>]*>\s*<b>([+-]?\d+)/)?.[1];
    history.push({
      date: date.replace('T', ' ').slice(0, 16),
      gain: gainRaw ? Number(gainRaw) : null,
    });
  });
  return history;
}

/**
 * 完整积分流水（插件「饼友助手 · 积分账本」用）。
 * 与 parseCheckinRows 的区别：不过滤 reason、保留正负变动与精确时间。
 * 行标记与官方页面一致：li.post-item.points-rewards-detail。
 */
export function parsePointsLedger(html: string): LedgerRowDto[] {
  const rows = html.match(/<li class="post-item points-rewards-detail[\s\S]*?<\/li>/g) ?? [];
  const out: LedgerRowDto[] = [];
  rows.forEach((row) => {
    const reason = decode(first(row, /points-rewards-reason">([^<]+)/) || '').trim();
    if (!reason) return;
    const time = row.match(/datetime="([^"]+)"/)?.[1]
      || first(row, /points-rewards-time"[^>]*>([^<]+)/)
      || '';
    const raw = row.match(/points-rewards-change-value[^>]*>\s*<b>([+-]?[\d,]+)/)?.[1]
      || row.match(/points-rewards-change-value[^>]*>([+-]?[\d,]+)/)?.[1]
      || '0';
    out.push({
      reason,
      time: time.replace(' ', 'T'),
      delta: Number(raw.replace(/[+,\s]/g, '')) || 0,
    });
  });
  return out;
}

function parsePoints(checkinHtml: string, historyHtml: string, balanceHint = 0): PointsDto {
  const checkedIn = /今天已签到|daily-checkin-done/.test(checkinHtml);
  const streak = Number(checkinHtml.match(/<strong>(\d+)<\/strong>\s*<span>连续天数/)?.[1] ?? 0);
  const total = Number(checkinHtml.match(/<strong>(\d+)<\/strong>\s*<span>累计签到/)?.[1] ?? 0);
  const balance = parseAccountPoints(checkinHtml, balanceHint);
  if (balance > 0) rememberUserPoints(balance);
  return {
    balance,
    checkedIn,
    streak,
    total,
    history: parseCheckinRows(historyHtml),
  };
}

function parseWalletList(html: string, className: string) {
  const ul = html.match(new RegExp(`class="${className}"[\\s\\S]*?</ul>`))?.[0] || '';
  return (ul.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? []).flatMap((item) => {
    if (/\bempty-state\b/.test(item)) return [];
    const text = stripTags(item);
    if (!text) return [];
    const amount = item.match(/([+-]\s*\d+(?:\.\d+)?)\s*烧饼/)?.[1]?.replace(/\s+/g, '')
      || text.match(/([+-]\d+(?:\.\d+)?)/)?.[1]
      || '';
    const time = item.match(/(\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/)?.[1]
      || item.match(/(\d{1,2}:\d{2})/)?.[1]
      || '';
    return [{ time, text, amount }];
  });
}

function parseWalletPage(html: string) {
  const hero = html.match(/class="community-wallet-hero"[\s\S]*?<\/section>/)?.[0] || '';
  const balanceBlock = html.match(/class="community-wallet-balance"[\s\S]*?<\/div>/)?.[0] || '';
  const strong = balanceBlock.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] || '';
  const balance = Number(stripTags(strong).replace(/[^\d.-]/g, '')) || 0;
  const unit = first(balanceBlock, /<span>([^<]+)/) || '烧饼';
  const lead = first(hero, /<p>([\s\S]*?)<\/p>/) || '烧饼仅用于社区功能消费，不支持提现、现金兑换或用户间转账。';
  const placeholder = html.match(/name="code"[^>]*placeholder="([^"]+)"/)?.[1]
    || html.match(/placeholder="([^"]+)"[^>]*name="code"/)?.[1]
    || 'SB-XXXX-XXXX-XXXX-XXXX';
  const redeemHint = html.match(/community_wallet_redeem[\s\S]*?<small>([\s\S]*?)<\/small>/)?.[1] || '';
  const shopUrl = html.match(/href="(https:\/\/catfk\.com\/shop\/[^"]+)"/)?.[1]
    || 'https://catfk.com/shop/linuxsb';
  return {
    title: first(hero, /<h1>([^<]+)/) || '我的烧饼',
    lead: stripTags(lead),
    balance,
    unit: stripTags(unit) || '烧饼',
    redeemHint: stripTags(redeemHint) || '连续输入错误会被临时限制，请勿向他人泄露兑换码。',
    placeholder: decode(placeholder),
    helpUrl: '/topic/15751',
    shopUrl,
    ledger: parseWalletList(html, 'community-wallet-transactions'),
    orders: parseWalletList(html, 'community-wallet-orders'),
  };
}

function parseIdentityCriteria(section: string) {
  const rows = section.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  return rows.flatMap((row) => {
    const td = row.match(/<td\b([^>]*)>([\s\S]*?)<\/td>/);
    if (!td) return [];
    const title = stripTags(td[2]);
    if (!title || title === '申请条件') return [];
    const detail = decode(td[1].match(/\btitle="([^"]*)"/)?.[1] ?? '');
    const pass = /identity-center-criteria-pass/.test(row);
    const soft = /加权|参考/.test(title) || /不是申请硬性|不影响进入下一步|仅作风险参考/.test(detail);
    return [{ title, detail, pass, soft }];
  });
}

function parseIdentity(html: string): IdentityDto {
  const loggedIn = !isLoginWall(html);
  const creatorCard = html.match(/<section class="identity-center-criteria-card"[\s\S]*?<\/section>/)?.[0] ?? '';
  const accountCard = html.match(/<section class="identity-center-account-card"[\s\S]*?<\/section>/)?.[0] ?? '';
  const benefitList = html.match(/<ul class="identity-center-benefits-list">[\s\S]*?<\/ul>/)?.[0] ?? '';
  const benefits = [...benefitList.matchAll(/<li>[\s\S]*?<\/li>/g)].map((hit) => ({
    title: stripTags(first(hit[0], /<strong>([\s\S]*?)<\/strong>/) || ''),
    desc: stripTags(first(hit[0], /<span>([\s\S]*?)<\/span>/) || ''),
  })).filter((item) => item.title);
  const rulesBlock = html.match(/<details class="identity-center-rules"[\s\S]*?<\/details>/)?.[0] ?? '';
  const rules = [...rulesBlock.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((hit) => stripTags(hit[1])).filter(Boolean);
  const applications = [...(html.match(/<ul class="identity-center-list">[\s\S]*?<\/ul>/)?.[0] ?? '')
    .matchAll(/<li>([\s\S]*?)<\/li>/g)]
    .map((hit) => stripTags(hit[1]))
    .filter(Boolean);
  return {
    ready: loggedIn && !/identity-center-next[^>]*\bdisabled\b/.test(html),
    loggedIn,
    failNote: stripTags(first(html, /identity-center-criteria-note-fail[^>]*>([\s\S]*?)<\/p>/) || ''),
    heroTitle: stripTags(first(html, /identity-center-hero[\s\S]*?<h2>([^<]+)/) || '申请条件'),
    heroLead: stripTags(first(html, /identity-center-hero[\s\S]*?<p>([^<]+)/) || '必须满足下列条件才能申请认证'),
    benefitsTitle: stripTags(first(html, /identity-center-benefits-head[\s\S]*?<h3>([^<]+)/) || '创作者福利'),
    benefitsLead: stripTags(first(html, /identity-center-benefits-head[\s\S]*?<p>([^<]+)/) || '通过创作者认证后，可享受以下专属权益：'),
    benefits,
    benefitsNote: stripTags(first(html, /identity-center-benefits-note">([\s\S]*?)<\/p>/) || ''),
    creatorTitle: stripTags(first(creatorCard, /<h3>([^<]+)/) || '创作者认证条件'),
    creator: parseIdentityCriteria(creatorCard),
    accountTitle: stripTags(first(accountCard, /<h3>([^<]+)/) || '账号核验条件'),
    account: parseIdentityCriteria(accountCard),
    emailSummary: parseIdentityEmailSummary(html),
    emailHelp: stripTags(first(html, /identity-center-ok">([\s\S]*?)<\/p>/) || ''),
    githubHelp: stripTags(first(html, /identity-center-account-help">([\s\S]*?)<\/p>/) || ''),
    rules,
    agreeLabel: stripTags(first(html, /identity-center-agree"[^>]*>([\s\S]*?)<\/label>/) || '我已阅读并同意上述申请说明及不退款说明'),
    applyLabel: stripTags(first(html, /identity-center-next[^>]*>([\s\S]*?)<\/button>/) || '下一步'),
    applicationsTitle: stripTags(first(html, /identity-center-history[\s\S]*?<h3>([^<]+)/) || '我的申请'),
    applications,
  };
}

function parseInviteGuests(listHtml: string): InviteGuestDto[] {
  return [...listHtml.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)].flatMap((hit) => {
    if (/\bempty-state\b/.test(hit[1]) || /\bempty-state\b/.test(hit[2])) return [];
    const block = hit[2];
    const text = stripTags(block);
    if (!text || /暂时还没有/.test(text)) return [];
    const userId = block.match(/\/user\/(\d+)/)?.[1] ?? '';
    const name = stripTags(
      first(block, /<strong>([\s\S]*?)<\/strong>/)
      || first(block, /href="\/user\/\d+"[^>]*>([\s\S]*?)<\/a>/)
      || '',
    );
    const src = block.match(/<img[^>]*src="([^"]+)"/)?.[1] ?? '';
    const note = stripTags(
      block
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/<strong>[\s\S]*?<\/strong>/i, '')
        .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ''),
    );
    const label = name || (userId ? `UID ${userId}` : text);
    return [{
      userId,
      name: label,
      avatar: src ? absUrl(src) : letter(label),
      accent: accentFor(label),
      note,
    }];
  });
}

function parseInvitePage(html: string): InvitePageDto {
  const link = decode(
    html.match(/value="(https:\/\/linux\.sb\/s\/[^"]+)"/)?.[1]
    || html.match(/data-invite-center-link[^>]*value="([^"]+)"/)?.[1]
    || '',
  );
  const lead = stripTags(first(html, /invite-center-link[\s\S]*?<p class="muted">([\s\S]*?)<\/p>/) || '');
  const statsBlock = html.match(/<section class="invite-center-stats">[\s\S]*?<\/section>/)?.[0] ?? '';
  const stats = [...statsBlock.matchAll(/<strong>([^<]*)<\/strong>\s*<span>([^<]*)<\/span>/g)];
  const peopleOf = (label: string) => Number(label.match(/（\s*(\d+)\s*人）/)?.[1] ?? 0);
  const firstLabel = stripTags(stats[1]?.[2] ?? '首奖积分');
  const secondLabel = stripTags(stats[2]?.[2] ?? '二奖积分');
  const list = html.match(/<section class="invite-center-list">[\s\S]*?<\/section>/)?.[0] ?? '';
  return {
    title: stripTags(first(html, /invite-center-page[\s\S]*?<h1>([^<]+)/) || '邀请中心'),
    linkTitle: stripTags(first(html, /invite-center-link[\s\S]*?<strong>([^<]+)/) || '我的分享链接'),
    link,
    code: link.replace(/^https?:\/\/linux\.sb\/s\//, ''),
    lead,
    rule: stripTags(first(html, /invite-center-rule">([\s\S]*?)<\/p>/) || ''),
    copyLabel: stripTags(first(html, /data-invite-center-copy[^>]*>([\s\S]*?)<\/button>/) || '复制链接'),
    firstAward: Number(lead.match(/首奖\s*\+(\d+)/)?.[1] ?? 33),
    secondAward: Number(lead.match(/二奖\s*\+(\d+)/)?.[1] ?? 233),
    invited: Number(String(stats[0]?.[1] ?? '').replace(/[^\d]/g, '') || 0),
    invitedLabel: stripTags(stats[0]?.[2] ?? '已邀请用户'),
    firstPoints: Number(String(stats[1]?.[1] ?? '').replace(/[^\d]/g, '') || 0),
    firstPeople: peopleOf(firstLabel),
    firstLabel,
    secondPoints: Number(String(stats[2]?.[1] ?? '').replace(/[^\d]/g, '') || 0),
    secondPeople: peopleOf(secondLabel),
    secondLabel,
    listTitle: stripTags(first(list, /<h2>([^<]+)/) || '我邀请到的用户'),
    empty: stripTags(first(list, /empty-state">([\s\S]*?)<\/li>/) || '暂时还没有用户通过你的分享链接注册。'),
    guests: parseInviteGuests(list),
  };
}

function revealProtectedEmails(html: string): string {
  return html
    .replace(/<(?:a|span)[^>]*data-cfemail="([0-9a-fA-F]+)"[^>]*>[\s\S]*?<\/(?:a|span)>/gi, (_all, hex: string) => decodeCfEmail(hex) || '')
    .replace(/data-cfemail="([0-9a-fA-F]+)"/gi, (_all, hex: string) => decodeCfEmail(hex) || '');
}

function parseIdentityEmailSummary(html: string): string {
  const block = html.match(/identity-center-account-summary">([\s\S]*?)<\/p>/)?.[1] ?? '';
  if (!block) return '';
  const cf = block.match(/data-cfemail="([0-9a-fA-F]+)"/)?.[1];
  const email = cf ? decodeCfEmail(cf) : '';
  const titled = decode(block.match(/\btitle="([^"]+@[^"]+)"/)?.[1] ?? '');
  const revealed = looksLikeEmail(email) ? email : (looksLikeEmail(titled) ? titled : '');
  const text = stripTags(revealProtectedEmails(block));
  if (revealed && !looksLikeEmail(text.replace(/^当前邮箱[:：]\s*/, ''))) {
    return /当前邮箱/.test(text) ? text.replace(/\[email\s+protected\]/i, revealed).replace(/当前邮箱[:：]\s*$/, `当前邮箱：${revealed}`) : `当前邮箱：${revealed}`;
  }
  return text;
}

function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  if (!Number.isFinite(key) || hex.length < 4) return '';
  let out = '';
  for (let i = 2; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (!Number.isFinite(code)) return '';
    out += String.fromCharCode(code ^ key);
  }
  return out;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function profileAccountBlock(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(
    `<div class="profile-account-card(?![^"]*logout)[^"]*"[^>]*>\\s*<span>\\s*${escaped}\\s*</span>([\\s\\S]*?)</div>`,
  ))?.[0] ?? '';
}

function profileAccountValue(html: string, label: string): string {
  const block = profileAccountBlock(html, label);
  if (!block) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return decode(html.match(new RegExp(`<span>\\s*${escaped}\\s*</span>\\s*<strong[^>]*>([^<]+)`) )?.[1] ?? '');
  }
  const cf = block.match(/data-cfemail="([0-9a-fA-F]+)"/)?.[1];
  if (cf) {
    const email = decodeCfEmail(cf);
    if (looksLikeEmail(email)) return email;
  }
  const titled = decode(block.match(/<strong[^>]*\btitle="([^"]+)"/)?.[1] ?? '');
  if (titled) return titled;
  return stripTags(block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/)?.[1] ?? '');
}

function parseProfileEmail(html: string): string {
  const fromCard = profileAccountValue(html, '邮箱');
  if (looksLikeEmail(fromCard)) return fromCard;
  const info = html.match(/<section class="profile-layout-order-info"[\s\S]*?<\/section>/)?.[0] ?? '';
  const infoTitle = decode(info.match(/title="([^"]+@[^"]+)"/)?.[1] ?? '');
  if (looksLikeEmail(infoTitle)) return infoTitle;
  const infoText = stripTags(info.match(/<strong[^>]*>([\s\S]*?)<\/strong>/)?.[1] ?? '');
  if (looksLikeEmail(infoText)) return infoText;
  const cf = html.match(/profile-(?:account-card|layout-order-info)[\s\S]{0,400}?data-cfemail="([0-9a-fA-F]+)"/)?.[1];
  if (cf) {
    const email = decodeCfEmail(cf);
    if (looksLikeEmail(email)) return email;
  }
  const titled = decode(html.match(/title="([^"]+@[^"]+\.[^"]+)"/)?.[1] ?? '');
  if (looksLikeEmail(titled)) return titled;
  return fromCard.includes('@') ? fromCard : (infoText || titled || fromCard);
}

function parseOauthCard(html: string, provider: string) {
  const block = html.match(new RegExp(`<section class="oauth-login-profile-card">[\\s\\S]*?${provider}[\\s\\S]*?<\\/section>`))?.[0] ?? '';
  const status = stripTags(first(block, /<small>([^<]+)/) || (block ? '未绑定' : '未绑定'));
  return { provider, bound: /已绑定/.test(status), status };
}

function parseProfile(html: string): ProfileDto {
  if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后查看个人资料');
  const seeds = [...html.matchAll(/data-avatar-preset-seed="(\d+)"/g)].map((hit) => hit[1]);
  const avatarNote = stripTags(first(html, /avatar-upload-panel[\s\S]*?<p>([\s\S]*?)<\/p>/) || '');
  const deleteNote = stripTags(first(html, /account-self-delete-entry[\s\S]*?<p>([\s\S]*?)<\/p>/) || '永久删除账号资料、发布内容和站内关联记录，此操作不可恢复。');
  return {
    username: profileAccountValue(html, '用户名') || decode(first(html, /username-change-inline[\s\S]*?<strong>([^<]+)/) || ''),
    uid: profileAccountValue(html, '用户 UID'),
    email: parseProfileEmail(html),
    joinedAt: profileAccountValue(html, '注册时间'),
    points: Number(profileAccountValue(html, '积分').replace(/[^\d]/g, '') || parseAccountPoints(html, 0)),
    avatar: absUrl(html.match(/avatar-upload-current[\s\S]*?src="([^"]+)"/)?.[1]
      || html.match(/profile-avatar-summary[\s\S]*?src="([^"]+)"/)?.[1]
      || ''),
    bio: decode(html.match(/<textarea[^>]*name="bio"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? ''),
    usernameHint: stripTags(first(html, /username-change-summary-meta[\s\S]*?<small>([\s\S]*?)<\/small>/) || ''),
    usernameCost: Number(html.match(/data-points-cost="(\d+)"/)?.[1] ?? html.match(/支付\s*(\d+)\s*积分修改/)?.[1] ?? 100),
    emailVerified: stripTags(first(html, /<strong>\s*邮箱验证记录\s*<\/strong>\s*<p>([\s\S]*?)<\/p>/) || ''),
    passwordHint: stripTags(first(html, />密码<\/span>[\s\S]*?<small>([^<]+)/) || '不修改密码'),
    avatarNote,
    avatarCost: Number(avatarNote.match(/消耗\s*(\d+)\s*积分/)?.[1] ?? 50),
    avatarSeeds: seeds.length ? seeds : Array.from({ length: 24 }, (_, index) => String(index + 1)),
    infiniteScroll: /sb-infinite-scroll-profile-card[\s\S]*?name="enabled"[^>]*\bchecked\b/.test(html)
      || /sb-infinite-scroll-profile-status">已开启/.test(html),
    infiniteTitle: stripTags(first(html, /sb-infinite-scroll-profile-copy[\s\S]*?<strong>([^<]+)/) || '首页无限滚动'),
    infiniteNote: stripTags(first(html, /sb-infinite-scroll-profile-copy[\s\S]*?<small>([^<]+)/) || '开启后首页隐藏分页并加载更多；关闭后恢复普通分页。'),
    github: parseOauthCard(html, 'GitHub'),
    google: parseOauthCard(html, 'Google'),
    deleteNote,
    deleteUrl: html.match(/account-self-delete-link"[^>]*href="([^"]+)"/)?.[1] || '/account_self_delete',
  };
}

function profileSaveFailed(posted: LinuxResult, fallback: string): never {
  throw new MockApiError(
    posted.status >= 400 ? posted.status : 400,
    'UPSTREAM',
    formError(posted.html, postedMessage(posted) || fallback),
  );
}

async function saveProfileForm(path: string, fields: Record<string, string>, fallback: string) {
  requireCookie();
  const page = await fetchHtml('/profile', undefined, { fresh: true });
  if (isLoginWall(page)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后操作');
  const posted = await postForm(path, { _csrf: csrfFrom(page), ...fields }, false);
  if (isLoginWall(posted.html) || jsonRejected(posted.json) || posted.status >= 400) {
    profileSaveFailed(posted, fallback);
  }
  const message = postedMessage(posted);
  if (message && /失败|不能|无法|错误|不足|限制|不正确|不匹配/.test(message) && !/成功|已保存|已修改|已更新/.test(message)) {
    throw new MockApiError(400, 'UPSTREAM', message);
  }
  bustHtml(/\/profile|\/user\/|\/identity_center/);
  return { ok: true, message: message || '已保存' };
}

function parseForumPageHeader(html: string) {
  const name = decode(
    first(html, /forum-enhancements-title-row[\s\S]*?<h1>([^<]+)/)
    || first(html, /<h1>([^<]+)<\/h1>/)
    || '',
  );
  const desc = decode(first(html, /class="forum-enhancements-description">([^<]+)/) || '');
  const countRaw = first(html, /class="forum-enhancements-topic-count">([^<]+)/) || '';
  const topics = Number(countRaw.replace(/[^\d]/g, '')) || 0;
  return { name, desc, topics };
}

async function liveFeed(sort: string, forum: string | undefined, cursor: string | undefined) {
  const page = cursor ? Number(cursor) || 1 : 1;
  const forumId = await resolveForumId(forum);
  const html = await fetchHtml(feedPath(sort || 'latest_comment', forumId, page));
  if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '该列表需要登录 linux.sb 后查看');
  rememberTopicFilterContext(html);
  // 出现没见过的印章时，去官方样式表学它的配色（正常情况这里直接返回，不发请求）
  await ensureStampTones(html, () => linuxAsset(TOPIC_STAMP_CSS_PATH));
  const payload: {
    items: TopicDto[];
    nextCursor: string | null;
    board?: { name: string; desc: string; topics: number };
    hotTopics?: DailyHotTopicDto[];
  } = {
    items: ensureParsed(html, parseTopicItems(html), '帖子列表', /class="[^"]*post-list/),
    // 足迹是单页列表，行内页码会被 nextPage 误判成翻页游标。
    nextCursor: sort === 'footprint' ? null : nextPage(html, page),
  };
  if (forumId && page <= 1) {
    const board = parseForumPageHeader(html);
    if (board.name || board.desc || board.topics) payload.board = board;
  }
  // 「每日热帖」就在同一份 HTML 里，顺手解析（卡片在、却一条都没解出来 = 官网改版了，交给哨兵报错）
  const hot = parseDailyHotTopics(html);
  if (hot) payload.hotTopics = ensureParsed(html, hot, '每日热帖', /daily-hot-topics-list/);
  return payload;
}

function urlFromUploadJson(json: Record<string, unknown> | null): string {
  if (!json) return '';
  const direct = [json.url, json.src, json.href].find((item) => typeof item === 'string' && String(item).trim());
  if (typeof direct === 'string' && direct.trim()) return absUrl(direct.trim());
  const markdown = String(json.markdown ?? '');
  const hit = markdown.match(/\((https?:\/\/[^)\s]+)\)/) || markdown.match(/\((\/[^)\s]+)\)/);
  return hit ? absUrl(hit[1]) : '';
}

async function uploadOfficialAttachment(file: { uri: string; name: string; type: string }): Promise<string> {
  const page = await fetchHtml('/topic_edit', undefined, { fresh: true });
  if (isLoginWall(page)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后上传');
  const body = new FormData();
  body.append('_csrf', csrfFrom(page));
  body.append('attachment', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  const posted = await linuxRequest('/attachment_upload', {
    method: 'POST',
    body,
    timeoutMs: 60_000,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/html;q=0.9',
      Referer: `${LINUX_ORIGIN}/topic_edit`,
    },
  });
  if (jsonRejected(posted.json) || posted.status >= 400) {
    throw new MockApiError(400, 'UPSTREAM', postedMessage(posted) || '上传失败');
  }
  const url = urlFromUploadJson(posted.json);
  if (!url) throw new MockApiError(400, 'UPSTREAM', '上传成功但未返回图片地址');
  return url;
}

async function uploadPostImage(file: {
  uri: string;
  name: string;
  type: string;
  target?: string;
}): Promise<{ id: string; url: string; expiresAt: string }> {
  requireCookie();
  const uri = String(file.uri || '').trim();
  const name = String(file.name || 'image.jpg').trim() || 'image.jpg';
  const type = String(file.type || 'image/jpeg').trim() || 'image/jpeg';
  if (!uri) throw new MockApiError(400, 'VALIDATION', '请选择图片文件');
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(type)) {
    throw new MockApiError(400, 'VALIDATION', '请选择 jpg / png / webp 图片');
  }
  const packed = { uri, name, type };
  const me = sessionForToken(currentToken)?.user;
  const want = file.target === 'r2' || file.target === 'official' ? file.target : null;

  const toOfficial = async () => {
    const url = await uploadOfficialAttachment(packed);
    return { id: url, url, expiresAt: '' };
  };
  const toR2 = async () => {
    const config = await loadR2Config();
    if (!isR2Ready(config)) {
      throw new MockApiError(400, 'VALIDATION', '请先在设置里填完 Cloudflare R2 图库');
    }
    try {
      const url = await uploadToR2(packed, config, me?.uid || me?.id);
      return { id: url, url, expiresAt: '' };
    } catch (error) {
      throw new MockApiError(400, 'UPSTREAM', error instanceof Error ? error.message : 'R2 上传失败');
    }
  };

  if (want === 'r2') return toR2();
  if (want === 'official') return toOfficial();

  if (hasOfficialImageUpload(me)) {
    try {
      return await toOfficial();
    } catch (error) {
      const fallback = await loadR2Config();
      if (!isR2Ready(fallback)) throw error;
      return toR2();
    }
  }
  const config = await loadR2Config();
  if (!isR2Ready(config)) {
    throw new MockApiError(400, 'VALIDATION', '当前账号没有官网上传权限。请到设置填写 Cloudflare R2 图库，或申请创作者身份。');
  }
  return toR2();
}

async function dispatch(req: MockRequest): Promise<unknown> {
  const { method, path, query } = req;
  const payload = (req.body ?? {}) as Record<string, unknown>;

  if (path === '/home/feed') {
    return liveFeed(String(query.sort ?? 'latest_comment'), query.forum, query.cursor);
  }

  if (path === '/forums') {
    return { items: await getForums() };
  }

  const forumTopics = match(path, /^\/forums\/([^/]+)\/topics$/);
  if (forumTopics) {
    return liveFeed(String(query.sort ?? 'latest_comment'), decodeURIComponent(forumTopics[0]), query.cursor);
  }

  const topicComments = match(path, /^\/topics\/([^/]+)\/comments$/);
  if (topicComments && method === 'GET') {
    const id = encodeURIComponent(topicComments[0]);
    const replyId = String(query.replyId || '').trim();
    const floor = String(query.floor || '').trim();
    const locateReply = /^\d+$/.test(replyId) && !query.cursor;
    const locateFloor = /^\d+$/.test(floor) && !locateReply && !query.cursor;
    const page = Math.max(1, Number(query.cursor) || 1);
    const html = await fetchHtml(
      locateReply
        ? `/topic/${id}?replyid=${encodeURIComponent(replyId)}`
        : locateFloor
          ? `/topic/${id}?floor=${encodeURIComponent(floor)}`
          : `/topic/${id}${page > 1 ? `?p=${page}` : ''}`,
    );
    requireTopicPage(html);
    if (isLoginWall(html) && !/post-entry/.test(html)) {
      return { items: [], nextCursor: null };
    }
    const items = parseComments(html, topicComments[0]);
    if (commentsHidden(html) && items.length === 0) {
      return { items: [], nextCursor: null };
    }
    const currentPage = locateReply || locateFloor ? currentTopicPage(html) : page;
    return {
      items,
      nextCursor: nextPage(html, currentPage),
      lastPage: lastTopicPage(html, topicComments[0]),
      page: currentPage,
    };
  }

  if (topicComments && method === 'POST') {
    requireCookie();
    const topicId = topicComments[0];
    const page = await fetchHtml(`/topic/${encodeURIComponent(topicId)}`);
    const body = String(payload.body ?? '').trim();
    if (!body) throw new MockApiError(400, 'VALIDATION', '请输入回复内容');
    /**
     * 与发主题一致：路径与隐藏字段从官网的回复表单推导，官方改字段名/加隐藏域都能跟上；
     * 只有 body / topic_id / _csrf 是我们要覆盖的。找不到表单时退回原来的字面量。
     */
    rememberUploadPermissionFrom(page);
    const replyForm = extractReplyCreateForm(page);
    const fields = replyForm ? parseFormFields(replyForm) : {};
    if (!fields._csrf) fields._csrf = csrfFrom(page);
    fields.topic_id = topicId;
    fields.body = body;
    /**
     * 官方的人机验证是「客户端解出来再塞进表单」的（hidden field 名固定 cap_token），
     * 服务端渲染的表单里没有这个字段 —— 所以我们自己带上，缺了就明确告诉前台要验证，
     * 别让官网用一句看不懂的报错把用户挡住。
     */
    if (pageNeedsReplyCaptcha(page)) {
      const capToken = String(payload.capToken ?? '').trim();
      if (!capToken) throw new MockApiError(400, 'CAPTCHA', '该帖开启了回帖人机验证，请先完成验证');
      fields.cap_token = capToken;
    } else if (payload.capToken) {
      fields.cap_token = String(payload.capToken);
    }
    const posted = await postForm(replyForm ? formActionPath(replyForm, '/reply_edit') : '/reply_edit', fields);
    bustTopicCache(topicId);
    bustAccountCache();
    if (posted.json && posted.json.ok === false) {
      throw new MockApiError(400, 'UPSTREAM', String(posted.json.message || '回复失败'));
    }
    const fragment = commentHtmlFrom(posted.json);
    const parsed = fragment ? parseComments(wrapCommentHtml(fragment), topicId)[0] : null;
    const me = liveSessionUser();
    const name = parsed?.authorName || me?.name || '我';
    const title = parsed?.authorTitle || (me?.title && me.title !== '饼友' ? me.title : '');
    const avatar = parsed?.avatar && parsed.avatar.includes('/') && !isTitleAsset(parsed.avatar)
      ? parsed.avatar
      : (me?.avatar && me.avatar.includes('/') ? me.avatar : letter(name));
    return {
      id: parsed?.id || `${topicId}-new-${Date.now()}`,
      topicId,
      parentId: parsed?.parentId ?? (payload.parentId ? String(payload.parentId) : null),
      parentFloor: parsed?.parentFloor ?? (payload.parentFloor ? String(payload.parentFloor) : null),
      authorId: parsed?.authorId || me?.id || currentUserId() || '',
      authorName: name,
      authorTitle: title,
      authorTitleSerial: parsed?.authorTitleSerial || '',
      authorGroup: parsed?.authorGroup || me?.groupLabel || '',
      uid: parsed?.uid || me?.uid || currentUserId() || '',
      avatar,
      accent: parsed?.accent || accentFor(name),
      body: parsed?.body || body,
      mention: parsed?.mention ?? null,
      createdAt: parsed?.createdAt || new Date().toISOString(),
      likeCount: parsed?.likeCount ?? 0,
      liked: parsed?.liked ?? false,
      coined: parsed?.coined ?? false,
      likeTiers: parsed?.likeTiers,
      redPacket: parsed?.redPacket ?? null,
      floor: parsed?.floor ?? null,
      canEdit: parsed?.canEdit ?? true,
      canDelete: parsed?.canDelete ?? true,
    };
  }

  /**
   * 回帖后刷新红包卡片：走官网回帖框里那个 `data-red-packet-status-url`
   * （`/red_packet_status?topic_id=<id>`，XHR 回 `{ok, panel_html}`）。
   */
  const topicRedPacket = match(path, /^\/topics\/([^/]+)\/red-packet$/);
  if (topicRedPacket && method === 'GET') {
    const topicId = topicRedPacket[0];
    const status = await linuxRequest(`/red_packet_status?topic_id=${encodeURIComponent(topicId)}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
      accept: 'application/json',
    });
    const panel = typeof status.json?.panel_html === 'string' ? status.json.panel_html : '';
    const card = panel ? parseRedPacketPanel(panel) : parseRedPacketPanel(status.html || '');
    return { ok: Boolean(card), card };
  }

  const topicCommentEdit = match(path, /^\/topics\/([^/]+)\/comments\/([^/]+)\/edit$/);
  if (topicCommentEdit && method === 'GET') {
    requireCookie();
    const [topicId, replyId] = topicCommentEdit;
    const html = await loadReplyEditPage(replyId);
    const editor = parseReplyEditor(html, replyId, topicId);
    if (!editor) throw new MockApiError(400, 'UPSTREAM', '当前回帖不能编辑');
    const extras = parseReplyEditExtras(html);
    return {
      body: editor.body,
      confirm: extras.confirm,
      quote: extras.quote,
      rulesUrl: extras.rulesUrl || undefined,
      deleteConfirm: extras.deleteConfirm || undefined,
    };
  }

  const topicCommentItem = match(path, /^\/topics\/([^/]+)\/comments\/([^/]+)$/);
  if (topicCommentItem && method === 'PATCH') {
    requireCookie();
    const [topicId, replyId] = topicCommentItem;
    const body = String(payload.body ?? '').trim();
    if (!body) throw new MockApiError(400, 'VALIDATION', '请输入回复内容');
    const editorHtml = await loadReplyEditPage(replyId);
    const editor = parseReplyEditor(editorHtml, replyId, topicId);
    if (!editor) throw new MockApiError(400, 'UPSTREAM', '当前回帖不能编辑');
    const fields = { ...editor.fields };
    dropReplyDeleteFields(fields);
    const savePath = replyEditPostPath(editor.action, replyId);
    const posted = await postAjaxForm(savePath, {
      ...fields,
      _csrf: fields._csrf || csrfFrom(editorHtml),
      id: fields.id || replyId,
      topic_id: fields.topic_id || topicId,
      body: stripLimitEditTimeComment(body),
    }, savePath);
    if (posted.status >= 400 || isLoginWall(posted.html) || !posted.json || jsonRejected(posted.json) || !posted.json.ok) {
      throw new MockApiError(
        posted.status >= 400 ? posted.status : 400,
        'UPSTREAM',
        String(posted.json?.message || formError(posted.html, posted.flash || '保存失败')),
      );
    }
    bustTopicCache(topicId);
    bustAccountCache();
    const fragment = commentHtmlFrom(posted.json);
    const fromFragment = fragment ? parseComments(wrapCommentHtml(fragment), topicId)[0] : null;
    const redirect = typeof posted.json?.redirect === 'string' ? posted.json.redirect : '';
    const resultPath = (redirect || posted.url).match(/\/topic\/\d+[^#]*/)?.[0] || `/topic/${encodeURIComponent(topicId)}`;
    const resultHtml = fromFragment
      ? ''
      : (posted.url.includes('/topic/') && /id="post-/.test(posted.html)
        ? posted.html
        : await fetchHtml(resultPath, undefined, { fresh: true }));
    const parsed = fromFragment || (resultHtml ? findParsedComment(resultHtml, topicId, replyId) : undefined);
    const me = liveSessionUser();
    const name = parsed?.authorName || me?.name || '我';
    return {
      id: parsed?.id || replyId,
      topicId,
      parentId: parsed?.parentId ?? null,
      parentFloor: parsed?.parentFloor ?? null,
      authorId: parsed?.authorId || me?.id || currentUserId() || '',
      authorName: name,
      authorTitle: parsed?.authorTitle || (me?.title && me.title !== '饼友' ? me.title : '') || '',
      authorTitleSerial: parsed?.authorTitleSerial || '',
      authorGroup: parsed?.authorGroup || me?.groupLabel || '',
      uid: parsed?.uid || me?.uid || currentUserId() || '',
      avatar: parsed?.avatar && parsed.avatar.includes('/') ? parsed.avatar : (me?.avatar && me.avatar.includes('/') ? me.avatar : letter(name)),
      accent: parsed?.accent || accentFor(name),
      body: parsed?.body || commentBodyFallback(body),
      mention: parsed?.mention ?? null,
      createdAt: parsed?.createdAt || new Date().toISOString(),
      likeCount: parsed?.likeCount ?? 0,
      liked: parsed?.liked ?? false,
      coined: parsed?.coined ?? false,
      likeTiers: parsed?.likeTiers,
      floor: parsed?.floor ?? null,
      canEdit: parsed?.canEdit ?? true,
      canDelete: parsed?.canDelete ?? true,
      editedBy: parsed?.editedBy || me?.name || '',
      editedById: parsed?.editedById || me?.id || currentUserId() || '',
      editedAt: parsed?.editedAt || formatCstEditAt(),
    };
  }

  if (topicCommentItem && method === 'DELETE') {
    requireCookie();
    const [topicId, replyId] = topicCommentItem;
    const editorHtml = await loadReplyEditPage(replyId);
    let found = parseReplyDelete(editorHtml, topicId, replyId);
    if (!found) {
      const page = await fetchHtml(`/topic/${encodeURIComponent(topicId)}`, undefined, { fresh: true });
      found = parseReplyDelete(page, topicId, replyId);
    }
    if (!found) throw new MockApiError(400, 'UPSTREAM', '当前回帖不能删除');
    const posted = await postAjaxForm(found.path, {
      ...found.fields,
      _csrf: found.fields._csrf || csrfFrom(editorHtml),
    }, `/reply_edit/${encodeURIComponent(replyId)}`);
    if (!posted.json || jsonRejected(posted.json) || !posted.json.ok || posted.status >= 400) {
      throw new MockApiError(
        posted.status >= 400 ? posted.status : 400,
        'UPSTREAM',
        String(posted.json?.message || posted.json?.tip || '删除失败'),
      );
    }
    const failed = formError(posted.html, '');
    if (failed && /失败|不能|无权|不足/.test(failed) && /delete|reply_edit|删除/.test(posted.html + posted.url + found.path)) {
      throw new MockApiError(400, 'UPSTREAM', failed);
    }
    if (isLoginWall(posted.html)) {
      throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后删除');
    }
    bustTopicCache(topicId);
    bustAccountCache();
    return { ok: true };
  }

  const topicItem = match(path, /^\/topics\/([^/]+)$/);
  if (method === 'GET' && path === '/topics/compose') {
    requireCookie();
    const html = await fetchHtml('/topic_edit', undefined, { fresh: true });
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后发帖');
    if (!/name="title"|name="body"/.test(html)) {
      throw new MockApiError(400, 'UPSTREAM', '当前无法发帖');
    }
    return parseTopicEditor(html);
  }

  if (topicItem && method === 'GET') {
    const id = topicItem[0];
    const [html, barrage] = await Promise.all([
      fetchHtml(`/topic/${encodeURIComponent(id)}`),
      fetchBarrage(id),
    ]);
    requireTopicPage(html);
    return {
      topic: parseTopicDetail(html, id),
      permissions: topicPermissions(html),
      // 抽奖帖若作者保留「回帖需要验证码」，回帖框上会挂 Cap 组件，提交必须带 cap_token
      replyCaptcha: pageNeedsReplyCaptcha(html),
      replyCaptchaConfig: parseCapConfig(html),
      vote: parseEssenceVote(html),
      barrage,
      lottery: parseTopicLottery(html),
      virtualCard: parseTopicVirtualCard(html),
      redPacket: parseTopicRedPacket(html),
      collections: parseTopicCollectionForm(html)?.items ?? [],
    };
  }

  const topicEdit = match(path, /^\/topics\/([^/]+)\/edit$/);
  if (topicEdit && method === 'GET') {
    requireCookie();
    const id = topicEdit[0];
    const html = await fetchHtml(`/topic_edit?id=${encodeURIComponent(id)}`, undefined, { fresh: true });
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后编辑');
    if (!/name="title"|name="body"/.test(html)) {
      throw new MockApiError(400, 'UPSTREAM', '当前主题不能编辑');
    }
    return parseTopicEditor(html);
  }

  if (topicItem && method === 'PATCH') {
    requireCookie();
    const id = topicItem[0];
    const editor = await fetchHtml(`/topic_edit?id=${encodeURIComponent(id)}`, undefined, { fresh: true });
    return submitTopicEdit(editor, composeInputFrom(payload), id);
  }

  if (topicItem && method === 'DELETE') {
    requireCookie();
    const id = topicItem[0];
    const page = await fetchHtml(`/topic/${encodeURIComponent(id)}`, undefined, { fresh: true });
    let found = parseTopicDelete(page, id);
    if (!found) {
      const editor = await fetchHtml(`/topic_edit?id=${encodeURIComponent(id)}`, undefined, { fresh: true });
      found = parseTopicDelete(editor, id);
    }
    if (!found) throw new MockApiError(400, 'UPSTREAM', '当前主题不能删除');
    const posted = await postForm(found.path, {
      ...found.fields,
      _csrf: found.fields._csrf || csrfFrom(page),
    }, false);
    if (posted.json && posted.json.ok === false) {
      throw new MockApiError(400, 'UPSTREAM', String(posted.json.message || '删除失败'));
    }
    const failed = formError(posted.html, '');
    if (failed && /失败|不能|无权|不足/.test(failed) && /topic_edit|删除/.test(posted.html + posted.url)) {
      throw new MockApiError(400, 'UPSTREAM', failed);
    }
    bustTopicCache(id);
    bustAccountCache();
    return { ok: true };
  }

  const topicCollections = match(path, /^\/topics\/([^/]+)\/collections$/);
  if (topicCollections && method === 'POST') {
    requireCookie();
    const topicId = topicCollections[0];
    const page = await fetchHtml(`/topic/${encodeURIComponent(topicId)}`, undefined, { fresh: true });
    if (isLoginWall(page)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后收录');
    const picker = parseTopicCollectionForm(page);
    const collectionId = String(payload.collectionId ?? '').trim();
    const name = String(payload.name ?? '').trim();
    const remove = Boolean(payload.remove);
    if (name) {
      const create = parseCollectionCreateForm(page);
      const posted = await postForm(create?.action || picker?.action || '/topic_collections', {
        ...(create?.fields ?? picker?.fields ?? {}),
        _csrf: (create?.fields._csrf || picker?.fields._csrf || csrfFrom(page)),
        topic_id: topicId,
        name,
        action: create?.fields.action || 'create',
      }, false);
      if (posted.json && posted.json.ok === false) {
        throw new MockApiError(400, 'UPSTREAM', String(posted.json.message || '创建专辑失败'));
      }
      const createdId = posted.url.match(/\/topic_collection\/(\d+)/)?.[1]
        || posted.html.match(/\/topic_collection\/(\d+)/)?.[1]
        || '';
      bustTopicCache(topicId);
      const nextPageHtml = await fetchHtml(`/topic/${encodeURIComponent(topicId)}`, undefined, { fresh: true });
      let items = parseTopicCollectionForm(nextPageHtml)?.items ?? [];
      if (createdId && !items.some((item) => item.id === createdId)) {
        const addPosted = await postForm(picker?.action || '/topic_collections', {
          ...(picker?.fields ?? {}),
          _csrf: picker?.fields._csrf || csrfFrom(nextPageHtml),
          topic_id: topicId,
          [picker?.selectName || 'collection_id']: createdId,
          [picker?.actionName || 'action']: 'item_add',
        }, false);
        if (addPosted.json && addPosted.json.ok === false) {
          throw new MockApiError(400, 'UPSTREAM', String(addPosted.json.message || '收录失败'));
        }
        const afterAdd = await fetchHtml(`/topic/${encodeURIComponent(topicId)}`, undefined, { fresh: true });
        items = parseTopicCollectionForm(afterAdd)?.items ?? items;
      }
      return { ok: true, message: flashMessage(posted.html) || '已创建并收录', items };
    }
    if (!picker) throw new MockApiError(400, 'UPSTREAM', '当前主题无法收录到专辑');
    if (!collectionId) throw new MockApiError(400, 'VALIDATION', '请选择专辑');
    const posted = await postForm(picker.action, {
      ...picker.fields,
      _csrf: picker.fields._csrf || csrfFrom(page),
      topic_id: picker.fields.topic_id || topicId,
      [picker.selectName]: collectionId,
      [picker.actionName]: remove ? 'item_remove' : 'item_add',
    }, false);
    if (posted.json && posted.json.ok === false) {
      throw new MockApiError(400, 'UPSTREAM', String(posted.json.message || (remove ? '移出失败' : '收录失败')));
    }
    bustTopicCache(topicId);
    const html = /data-topic-collections-select/.test(posted.html)
      ? posted.html
      : await fetchHtml(`/topic/${encodeURIComponent(topicId)}`, undefined, { fresh: true });
    return {
      ok: true,
      message: flashMessage(posted.html) || (remove ? '已移出专辑' : '已收录到专辑'),
      items: parseTopicCollectionForm(html)?.items ?? picker.items.map((item) => (
        item.id === collectionId ? { ...item, included: !remove } : item
      )),
    };
  }

  if (method === 'POST' && path === '/topics') {
    requireCookie();
    const editor = await fetchHtml('/topic_edit', undefined, { fresh: true });
    return submitTopicEdit(editor, composeInputFrom(payload), '0');
  }

  const topicCardBuy = match(path, /^\/topics\/([^/]+)\/virtual-card$/);
  if (topicCardBuy && method === 'POST') {
    return submitVirtualCardBuy(topicCardBuy[0], Number(payload.quantity) || 1);
  }

  const topicDonate = match(path, /^\/topics\/([^/]+)\/donate$/);
  if (topicDonate && method === 'GET') {
    return loadDonateInfo(topicDonate[0]);
  }

  if (topicDonate && method === 'POST') {
    return submitDonate(topicDonate[0], String(payload.amount ?? '').trim());
  }

  const commentReact = match(path, /^\/topics\/([^/]+)\/comments\/([^/]+)\/react$/);
  if (commentReact && method === 'POST') {
    return submitCommentReaction(commentReact[0], commentReact[1], Number(payload.points) || 0);
  }

  const topicLike = match(path, /^\/topics\/([^/]+)\/like$/);
  if (topicLike && method === 'POST') {
    return submitDonate(topicLike[0], '');
  }

  const topicFav = match(path, /^\/topics\/([^/]+)\/favorite$/);
  if (topicFav && method === 'POST') {
    requireCookie();
    const topicId = topicFav[0];
    const page = await fetchHtml(`/topic/${encodeURIComponent(topicId)}`);
    const posted = await postForm('/topic_favorite', {
      _csrf: csrfFrom(page),
      topic_id: topicId,
    }, false);
    bustTopicCache(topicId);
    const html = posted.url.includes('/topic/') ? posted.html : await fetchHtml(`/topic/${encodeURIComponent(topicId)}`);
    const topic = parseTopicDetail(html, topicId);
    const wasFav = /取消收藏/.test(page);
    return { favorited: topic.favorited || (!wasFav && /取消收藏/.test(html)), favoriteCount: topic.favoriteCount };
  }

  const topicReward = match(path, /^\/topics\/([^/]+)\/reward$/);
  if (topicReward && method === 'POST') {
    const result = await submitDonate(topicReward[0], String(payload.amount ?? 10));
    return { rewarded: result.rewarded, balance: result.balance };
  }

  const topicVote = match(path, /^\/topics\/([^/]+)\/vote$/);
  if (topicVote && method === 'POST') {
    requireCookie();
    const topicId = topicVote[0];
    const choice = String(payload.vote ?? '');
    const reason = String(payload.reason ?? '').trim();
    if (choice !== 'support' && choice !== 'oppose') {
      throw new MockApiError(400, 'VALIDATION', '请选择会加精或不会加精');
    }
    if (!reason) throw new MockApiError(400, 'VALIDATION', '请填写竞猜理由');
    /**
     * 理由下限是服务端规则（官方页面只有 required + maxlength="300"），本地先拦一道，
     * 别让用户白跑一次往返才看到报错。
     */
    if (reason.length < ESSENCE_REASON_MIN) {
      // 文案与官方 JSON 一致：{"ok":0,"message":"竞猜理由至少需要 5 个字"}
      throw new MockApiError(400, 'VALIDATION', `竞猜理由至少需要 ${ESSENCE_REASON_MIN} 个字`);
    }
    // 官方 textarea maxlength="300"：前台已限长，这里再兜一道，别让上游因为超长直接报错
    if (reason.length > ESSENCE_REASON_MAX) {
      throw new MockApiError(400, 'VALIDATION', `竞猜理由最多 ${ESSENCE_REASON_MAX} 字`);
    }
    const page = await fetchHtml(`/topic/${encodeURIComponent(topicId)}`);
    if (!/topic-essence-review-vote-form/.test(page)) {
      throw new MockApiError(400, 'UPSTREAM', '当前主题没有进行中的竞猜');
    }
    /**
     * 一个人只能竞猜一次（官方投过之后直接把表单收走，服务端也会拒）。
     * 提交前先看页面：已经有我的选择就别再发一遍 —— 否则就是重复发布评议回帖。
     */
    const before = parseEssenceVote(page);
    if (before?.choice) {
      throw new MockApiError(409, 'ALREADY_VOTED', '你已经参与过竞猜，请勿重复竞猜');
    }
    const posted = await postForm('/topic_essence_review_vote', {
      _csrf: csrfFrom(page),
      topic_id: topicId,
      vote: choice,
      reason,
    });
    if (posted.json && posted.json.ok === false) {
      const message = String(posted.json.message || posted.json.tip || flashMessage(posted.html) || '竞猜失败');
      /**
       * 官方页面**不会**显示「我投过」（面板和没投过时一模一样，只有服务端在提交时拒），
       * 所以「已经参与过竞猜」这条要单独给一个 code，前台据此把卡片锁上并记住。
       */
      const code = isAlreadyVotedMessage(message) ? 'ALREADY_VOTED' : 'UPSTREAM';
      throw new MockApiError(code === 'ALREADY_VOTED' ? 409 : 400, code, message);
    }
    const failed = flashMessage(posted.html);
    if (failed && /失败|不能|不足|限制|已投票|已竞猜|无权/.test(failed) && !/成功|已提交/.test(failed)) {
      throw new MockApiError(400, 'UPSTREAM', failed);
    }
    bustTopicCache(topicId);
    const html = /topic-essence-review-panel/.test(posted.html)
      ? posted.html
      : await fetchHtml(`/topic/${encodeURIComponent(topicId)}`);
    const vote = parseEssenceVote(html);
    if (!vote) throw new MockApiError(400, 'UPSTREAM', failed || '竞猜失败');
    /**
     * 官方把竞猜理由**作为一条评议回帖发布**，所以提交成功后要能定位到它：
     * 在返回页里找我刚发的、正文里含这段理由的回帖。
     */
    /**
     * 找刚发布的那条评议回帖：成功响应也是 JSON（没有回帖 HTML），而评议回帖是最新的一条，
     * 落在这个主题的**最后一页**，所以先看手上这页，再抓一次最后一页。
     */
    let postedComment = findPostedReviewComment(html, topicId, reason);
    if (!postedComment) {
      const last = lastTopicPage(html, topicId) || 1;
      if (last > 1) {
        const lastHtml = await fetchHtml(`/topic/${encodeURIComponent(topicId)}?p=${last}`, undefined, { fresh: true });
        postedComment = findPostedReviewComment(lastHtml, topicId, reason);
      }
    }
    return {
      ...vote,
      myReason: reason,
      postedCommentId: postedComment?.id ?? null,
      postedComment: postedComment ?? null,
    };
  }

  const reportItem = match(path, /^\/reports\/(reply|topic)\/([^/]+)$/);
  if (reportItem && method === 'GET') {
    requireCookie();
    const targetType = reportItem[0] as 'reply' | 'topic';
    const targetId = decodeURIComponent(reportItem[1]);
    const html = await fetchHtml(`/content_report/${encodeURIComponent(targetId)}?type=${encodeURIComponent(targetType)}`);
    return parseReportForm(html, targetType, targetId);
  }

  if (path === '/reports' && method === 'POST') {
    requireCookie();
    const targetType = String(payload.targetType ?? '') === 'topic' ? 'topic' : 'reply';
    const targetId = String(payload.targetId ?? '').trim();
    const reasonType = String(payload.reasonType ?? '').trim();
    const details = String(payload.details ?? '').trim();
    if (!targetId) throw new MockApiError(400, 'VALIDATION', '缺少举报对象');
    if (!reasonType) throw new MockApiError(400, 'VALIDATION', '请选择举报理由');
    if (reasonType === 'other' && details.length < 5) {
      throw new MockApiError(400, 'VALIDATION', '选择“其他问题”时至少填写5个字符');
    }
    const page = await fetchHtml(`/content_report/${encodeURIComponent(targetId)}?type=${encodeURIComponent(targetType)}`);
    const posted = await postForm(`/content_report/${encodeURIComponent(targetId)}?type=${encodeURIComponent(targetType)}`, {
      _csrf: csrfFrom(page),
      target_type: page.match(/name="target_type"\s+value="([^"]+)"/)?.[1] || targetType,
      target_id: page.match(/name="target_id"\s+value="([^"]+)"/)?.[1] || targetId,
      reason_type: reasonType,
      reason_details: details,
    }, false);
    const stillForm = /name="reason_type"/.test(posted.html) && /content_report/.test(posted.url);
    if (stillForm || (posted.json && posted.json.ok === false)) {
      throw new MockApiError(400, 'UPSTREAM', formError(posted.html, String(posted.json?.message || '举报失败')));
    }
    return { ok: true, message: flashMessage(posted.html) || '举报已提交' };
  }

  const userTopics = match(path, /^\/users\/([^/]+)\/topics$/);
  if (userTopics) {
    const id = decodeURIComponent(userTopics[0]);
    const page = query.cursor ? Number(query.cursor) || 1 : 1;
    const html = await fetchHtml(`/user/${encodeURIComponent(id)}?tab=topics${page > 1 ? `&p=${page}` : ''}`);
    return { items: ensureParsed(html, parseTopicItems(html), '用户主题列表', /class="[^"]*post-list/), nextCursor: nextPage(html, page) };
  }

  const userReplies = match(path, /^\/users\/([^/]+)\/replies$/);
  if (userReplies) {
    const id = decodeURIComponent(userReplies[0]);
    const page = query.cursor ? Number(query.cursor) || 1 : 1;
    const html = await fetchHtml(`/user/${encodeURIComponent(id)}?tab=replies${page > 1 ? `&p=${page}` : ''}`);
    return { items: ensureParsed(html, parseTopicItems(html), '用户回帖列表', /class="[^"]*post-list/), nextCursor: nextPage(html, page) };
  }

  const userFavorites = match(path, /^\/users\/([^/]+)\/favorites$/);
  if (userFavorites) {
    const id = decodeURIComponent(userFavorites[0]);
    const html = await fetchHtml(`/user/${encodeURIComponent(id)}?tab=favorites`);
    if (isLoginWall(html)) return { items: [], nextCursor: null };
    return { items: ensureParsed(html, parseTopicItems(html), '收藏列表', /class="[^"]*post-list/), nextCursor: nextPage(html, 1) };
  }

  const userItem = match(path, /^\/users\/([^/]+)$/);
  if (userItem) {
    const id = decodeURIComponent(userItem[0]);
    return hydrateUser(id, undefined, currentUserId() === id);
  }

  if (path === '/notifications/unread') {
    if (!currentUserId()) return { unread: 0 };
    return { unread: await fetchUnreadCount() };
  }

  if (path === '/notifications/read' && method === 'POST') {
    requireCookie();
    bustUnreadCount();
    return { ok: true, unread: await fetchUnreadCount() };
  }

  if (path === '/notifications') {
    const uid = currentUserId();
    if (!uid) return { items: [], nextCursor: null, unread: 0 };
    const page = Math.max(1, Number(query.cursor) || 1);
    // 未读数与通知页并行取：串行等于把首屏延迟翻倍（页面 ttfb ~0.7s，未读数又要一个往返）
    const unreadTask = page <= 1 ? fetchUnreadCount() : null;
    const html = await fetchHtml(
      `/user/${encodeURIComponent(uid)}?tab=notifications${page > 1 ? `&p=${page}` : ''}`,
      undefined,
      { fresh: page <= 1 },
    );
    const items = ensureParsed(html, parseNotifications(html), '通知列表', /class="[^"]*post-list/);
    const unread = unreadTask ? await unreadTask : 0;
    return { items, nextCursor: nextPage(html, page), unread };
  }

  if (path === '/direct-messages') {
    requireCookie();
    const html = await fetchHtml('/direct_messages');
    return { items: ensureParsed(html, parseDirectMessages(html), '私信列表', /direct-messages/) };
  }

  if (path === '/topic-filter') {
    requireCookie();
    const mapSettings = (raw: Record<string, unknown> | null | undefined): TopicFilterDto['settings'] => ({
      presets: Array.isArray(raw?.presets) ? raw.presets.map((item) => String(item)) : [],
      custom: Array.isArray(raw?.custom) ? raw.custom.map((item) => String(item)) : [],
      users: Array.isArray(raw?.users) ? raw.users.map((item) => String(item)) : [],
      forumExcludedIds: Array.isArray(raw?.forum_excluded_ids) ? raw.forum_excluded_ids.map((item) => String(item)) : [],
      forumExtraIds: Array.isArray(raw?.forum_extra_ids) ? raw.forum_extra_ids.map((item) => String(item)) : [],
    });
    const readContext = async () => {
      if (!topicFilterContext) {
        const html = await fetchHtml('/');
        rememberTopicFilterContext(html);
      }
      return topicFilterContext ?? {
        userId: currentUserId() ?? '',
        settingsUrl: '/home_keyword_filter_settings',
        csrf: '',
        presets: [],
        forums: [],
        defaultForumIds: [],
        forumEnabled: false,
        forumWarning: '',
      };
    };
    if (method === 'GET') {
      const result = await linuxRequest('/home_keyword_filter_settings', {
        headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
        accept: 'application/json',
      });
      if (result.json?.redirect) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录 linux.sb 后设置屏蔽');
      if (result.status >= 400 || !result.json) {
        throw new MockApiError(502, 'UPSTREAM', `屏蔽设置读取失败（${result.status}）`);
      }
      const context = await readContext();
      return {
        exists: result.json.exists === 1,
        settings: mapSettings(result.json.settings as Record<string, unknown> | null),
        context,
      };
    }
    if (method === 'POST') {
      const settings = (payload as { settings?: Record<string, unknown> } | null)?.settings ?? {};
      const page = await fetchHtml('/');
      rememberTopicFilterContext(page);
      const csrf = topicFilterContext?.csrf || csrfFrom(page);
      if (!csrf) throw new MockApiError(502, 'UPSTREAM', '缺少校验令牌，请重试');
      const posted = await postForm(topicFilterContext?.settingsUrl || '/home_keyword_filter_settings', {
        _csrf: csrf,
        settings: JSON.stringify({
          presets: settings.presets ?? [],
          custom: settings.custom ?? [],
          users: settings.users ?? [],
          forum_excluded_ids: settings.forumExcludedIds ?? [],
          forum_extra_ids: settings.forumExtraIds ?? [],
        }),
      });
      if (posted.json?.redirect) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录 linux.sb 后设置屏蔽');
      if (posted.json && posted.json.ok !== 1) {
        throw new MockApiError(502, 'UPSTREAM', String(posted.json.message ?? '屏蔽设置保存失败'));
      }
      bustAccountCache();
      return {
        exists: posted.json?.exists === 1,
        settings: mapSettings(posted.json?.settings as Record<string, unknown> | null),
        context: await readContext(),
      };
    }
  }

  const directConversation = match(path, /^\/direct-messages\/([^/]+)$/);
  if (directConversation) {
    requireCookie();
    const partnerId = directConversation[0];
    const threadPath = `/direct_messages/${encodeURIComponent(partnerId)}`;
    if (method === 'GET') {
      const html = await fetchHtml(threadPath, undefined, { fresh: query.fresh === '1' });
      if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录 linux.sb 后查看私信');
      return parseDirectConversation(html, partnerId);
    }
    if (method === 'POST') {
      const content = String(payload.content ?? '').trim();
      if (!content) throw new MockApiError(400, 'VALIDATION', '请输入私信内容');
      if (content.length > 500) throw new MockApiError(400, 'VALIDATION', '私信最多 500 字');
      const page = await fetchHtml(threadPath, undefined, { fresh: true });
      if (isLoginWall(page)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录 linux.sb 后发送私信');
      const posted = await postForm(threadPath, {
        _csrf: csrfFrom(page),
        partner_id: partnerId,
        content,
      });
      const json = posted.json as { ok?: boolean; message?: string; message_html?: string; last_id?: number } | null;
      if (json && json.ok === false) {
        throw new MockApiError(400, 'UPSTREAM', String(json.message || '私信发送失败'));
      }
      const message = json?.message_html ? parseDirectMessageBlocks(json.message_html)[0] ?? null : null;
      bustHtml(/\/direct_messages/);
      return { ok: true, message, lastId: json?.last_id ? String(json.last_id) : undefined };
    }
  }

  if (path === '/leaderboard') {
    // 类型直接就是官方 ?type=（见 src/data/feed-nav.ts），不需要再翻译一次
    const type = query.type ?? 'points';
    const html = await fetchHtml(`/leaderboard?type=${encodeURIComponent(type)}`);
    return parseLeaderboardPage(html, type);
  }

  if (path === '/points' && method === 'GET') {
    requireCookie();
    const uid = currentUserId();
    const me = sessionForToken(currentToken)?.user;
    const wantHistory = Boolean(uid) && query.history === '1';
    const historyUid = String(uid ?? '');
    /**
     * 签到页「新鲜」要拿，流水只取最近两页 —— 两件事**并行**发。
     *
     * 以前是：先串行等签到页，再为了凑满「累计签到」那个总数一页页往后翻
     * （每日签到散布在几百条流水里，实测 10 次签到要翻到第 8 页），一共 9 个串行请求 ≈ 6 秒，
     * 而列表本身只是「签到记录」这种锦上添花的内容。累计天数/累计签到数字本来就来自签到页，不受影响。
     */
    const [checkinHtml, historyHtml] = await Promise.all([
      fetchHtml('/daily_checkin', undefined, { fresh: true }),
      wantHistory
        ? fetchHtml(`/user/${encodeURIComponent(historyUid)}?tab=points_rewards`)
        : Promise.resolve(''),
    ]);
    const points = parsePoints(checkinHtml, historyHtml, me?.points ?? 0);
    const historyCursor = wantHistory ? nextPage(historyHtml, 1) : null;
    // 顺带把「流水一共几页」带出去：并发补齐历史时照它封顶，就不会白抓最后一页之后
    const historyLastPage = wantHistory ? lastPageOf(historyHtml, 'points_rewards') : 1;
    return { ...points, historyPartial: Boolean(historyCursor), historyCursor, historyLastPage };
  }

  /**
   * 只要签到记录的一页（供签到页在后台并发补齐历史用）。
   * 单独开一条路由是为了能并行多页、边到边显示，而不是把首屏卡在一条串行链上。
   */
  if (path === '/points/checkins' && method === 'GET') {
    requireCookie();
    const uid = currentUserId();
    if (!uid) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后查看签到记录');
    const page = Math.max(1, Number(query.cursor) || 1);
    const html = await fetchHtml(`/user/${encodeURIComponent(String(uid))}?tab=points_rewards&p=${page}`);
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后查看签到记录');
    const { items, nextCursor, hasRows, lastPage } = parseCheckinPage(html, page);
    return { items, nextCursor, page, hasRows, lastPage };
  }

  if (path === '/points/ledger' && method === 'GET') {
    requireCookie();
    const uid = currentUserId();
    if (!uid) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后查看积分流水');
    const page = Math.max(1, Number(query.cursor) || 1);
    const html = await fetchHtml(`/user/${encodeURIComponent(uid)}?tab=points_rewards${page > 1 ? `&p=${page}` : ''}`);
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后查看积分流水');
    const items = parsePointsLedger(html);
    // 空页（超范围）时不返回游标，前台据此停止翻页
    return { items, nextCursor: items.length ? nextPage(html, page) : null, page };
  }

  if (path === '/points/checkin' && method === 'POST') {
    requireCookie();
    const uid = currentUserId();
    const before = await fetchHtml('/daily_checkin', undefined, { fresh: true });
    const already = /今天已签到|daily-checkin-done/.test(before);
    if (!already) {
      const csrf = before.match(/name="_csrf"\s+value="([^"]+)"/)?.[1]
        || before.match(/name="_csrf"[^>]*value="([^"]+)"/)?.[1];
      if (csrf) {
        try {
          await postForm('/daily_checkin', { _csrf: csrf }, false);
        } catch {
          /* visiting the page may already auto-checkin */
        }
      }
      bustAccountCache();
    }
    const after = already ? before : await fetchHtml('/daily_checkin', undefined, { fresh: true });
    const flash = flashMessage(after) || flashMessage(before);
    const historyHtml = uid ? await fetchHtml(`/user/${encodeURIComponent(uid)}?tab=points_rewards`) : '';
    const points = parsePoints(after, historyHtml, sessionForToken(currentToken)?.user.points ?? 0);
    const fromFlash = Number(flash.match(/(\d+)\s*积分/)?.[1] ?? 0);
    const fromHistory = points.history[0]?.gain ?? 0;
    rememberUserPoints(points.balance);
    if (already && !flash.includes('自动签到')) {
      return { gain: fromHistory || 0, balance: points.balance, checkedIn: true };
    }
    return { gain: fromFlash || fromHistory || 0, balance: points.balance, checkedIn: /今天已签到|daily-checkin-done/.test(after) };
  }

  if (path === '/titles' && method === 'GET') {
    const [pool, profile] = await Promise.all([
      fetchHtml('/gacha'),
      liveCookie() ? fetchHtml('/gacha_profile').catch(() => '') : Promise.resolve(''),
    ]);
    const emptyItems = TITLE_DEFS.map((item) => ({
      id: '',
      name: item.name,
      rarity: item.rarity,
      owned: false,
      equipped: false,
      desc: `${item.rarity} 称号`,
      copies: 0,
      usable: 0,
      obtainedAt: '',
    }));
    if (isLoginWall(pool)) {
      return {
        equipped: '',
        drawCost: 10,
        drawTenCost: 90,
        drawHundredCost: 800,
        items: sortTitlesByRarityDesc(emptyItems),
        ownedCount: 0,
        total: TITLE_DEFS.length,
        pool: [],
        news: [],
      };
    }
    const owned = profile ? parseOwnedTitles(profile) : [];
    const equipped = owned.find((item) => item.equipped)?.name
      || first(profile, /gacha-title-name">([^<]+)[\s\S]{0,200}gacha-unequip-btn/)
      || first(pool, /当前佩戴[^<]{0,20}「([^」]+)」/)
      || '';
    const merged = mergeTitleCatalog(parseCatalogTitles(pool), owned, equipped);
    return {
      equipped,
      drawCost: Number(pool.match(/gacha-pull-1[^>]*data-cost="(\d+)"/)?.[1] ?? 10),
      drawTenCost: Number(pool.match(/gacha-pull-10[^>]*data-cost="(\d+)"/)?.[1] ?? 90),
      drawHundredCost: Number(pool.match(/gacha-pull-100[^>]*data-cost="(\d+)"/)?.[1] ?? 800),
      items: merged,
      ownedCount: merged.filter((item) => item.owned).length,
      total: merged.length,
      pool: parseTitlePool(pool),
      news: parseGachaNews(pool),
    };
  }

  if (path === '/titles/draw' && method === 'POST') {
    requireCookie();
    const count = Number(payload.count ?? 1) >= 100 ? 100 : Number(payload.count ?? 1) >= 10 ? 10 : 1;
    const endpoint = count === 100 ? '/gacha_pull_100' : count === 10 ? '/gacha_pull_10' : '/gacha_pull';
    const page = await fetchHtml('/gacha');
    const posted = await postForm(endpoint, { _csrf: csrfFrom(page) }, false);
    const flash = assertGachaOk(posted, '抽取失败');
    const drawn = parseDrawResult(posted.html, flash, count, posted.json);
    bustGachaCache();
    const me = sessionForToken(currentToken)?.user;
    const balance = parseAccountPoints(posted.html, parsePointsAmount(posted.html.match(/积分：\s*<strong>([^<]+)<\/strong>/)?.[1]) || me?.points || 0);
    rememberUserPoints(balance);
    return {
      name: drawn.names[0] || '',
      names: drawn.names,
      fresh: drawn.fresh,
      counts: drawn.counts,
      balance,
      flash,
    };
  }

  if (path === '/titles/equip' && method === 'POST') {
    requireCookie();
    const name = String(payload.name ?? '').trim();
    const profile = await fetchHtml('/gacha_profile');
    const titleId = parseOwnedTitles(profile).find((item) => item.name === name)?.id
      || profile.match(new RegExp(`[\\s\\S]{0,500}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,700}`))?.[0]?.match(/name="title_id"\s+value="(\d+)"/)?.[1];
    if (!titleId) throw new MockApiError(404, 'NOT_FOUND', '未拥有该称号');
    const posted = await postForm('/gacha_equip', { _csrf: csrfFrom(profile), title_id: titleId }, false);
    assertGachaOk(posted, '佩戴失败');
    bustGachaCache();
    return { equipped: name };
  }

  if (path === '/titles/unequip' && method === 'POST') {
    requireCookie();
    const profile = await fetchHtml('/gacha_profile');
    const posted = await postForm('/gacha_unequip', { _csrf: csrfFrom(profile) }, false);
    assertGachaOk(posted, '卸下失败');
    bustGachaCache();
    return { equipped: '' };
  }

  if (path === '/titles/gift' && method === 'POST') {
    requireCookie();
    const name = String(payload.name ?? '').trim();
    const username = String(payload.username ?? '').trim();
    if (!username) throw new MockApiError(400, 'BAD_REQUEST', '请填写接收用户名');
    const profile = await fetchHtml('/gacha_profile');
    const owned = parseOwnedTitles(profile).find((item) => item.name === name);
    const titleId = owned?.id || String(payload.titleId ?? '');
    if (!titleId) throw new MockApiError(404, 'NOT_FOUND', '未拥有该称号');
    const fields: Record<string, string> = { _csrf: csrfFrom(profile), title_id: titleId, username };
    if (payload.instanceId) fields.instance_id = String(payload.instanceId);
    const posted = await postForm('/gacha_gift', fields, false);
    const flash = assertGachaOk(posted, '赠送失败');
    bustGachaCache();
    return { ok: true, flash };
  }

  if (path === '/titles/forge' && method === 'GET') {
    requireCookie();
    const html = await fetchHtml('/gacha_forge_center');
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
    return parseForgePage(html);
  }

  if (path === '/titles/forge' && method === 'POST') {
    requireCookie();
    const html = await fetchHtml('/gacha_forge_center');
    const page = parseForgePage(html);
    const source = String(payload.source ?? 'n').toLowerCase();
    const recipe = page.recipes.find((item) => item.rarityKey === source || item.source.toLowerCase() === source);
    if (!recipe) throw new MockApiError(400, 'BAD_REQUEST', '没有该熔炼配方');
    const materials = Array.isArray(payload.materials) ? payload.materials as Array<{ id?: string; quantity?: number }> : [];
    const picked = materials.filter((item) => item.id && Number(item.quantity) > 0);
    if (!picked.length) throw new MockApiError(400, 'BAD_REQUEST', '请先选择熔炼材料');
    const total = picked.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const times = Math.min(1000, Math.floor(total / recipe.cost));
    if (times < 1) throw new MockApiError(400, 'BAD_REQUEST', `需要 ${recipe.cost} 个 ${recipe.source} 才能熔炼`);
    const fields: Record<string, string | string[]> = {
      _csrf: csrfFrom(html),
      source_rarity: recipe.rarityKey || source,
      forge_count: String(times),
      'material_title_ids[]': picked.map((item) => String(item.id)),
    };
    picked.forEach((item) => {
      fields[`material_quantities[${item.id}]`] = String(item.quantity);
    });
    const posted = await postForm('/gacha_forge', fields, false);
    const flash = assertGachaOk(posted, '熔炼失败');
    const gained = parseForgeGains(flash);
    const fromPage = gained.names.length ? gained : parseForgeGains(posted.html);
    bustGachaCache();
    return { ok: true, times, flash, names: fromPage.names, counts: fromPage.counts };
  }

  if (path === '/titles/recycle' && method === 'GET') {
    requireCookie();
    const html = await fetchHtml('/gacha_recycle_center');
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
    return parseRecyclePage(html);
  }

  if (path === '/titles/recycle' && method === 'POST') {
    requireCookie();
    const html = await fetchHtml('/gacha_recycle_center');
    const items = Array.isArray(payload.items) ? payload.items as Array<{ id?: string; quantity?: number }> : [];
    const picked = items.filter((item) => item.id && Number(item.quantity) > 0);
    if (!picked.length) throw new MockApiError(400, 'BAD_REQUEST', '请先选择要回收的 SSR');
    const fields: Record<string, string | string[]> = {
      _csrf: csrfFrom(html),
      'recycle_title_ids[]': picked.map((item) => String(item.id)),
    };
    picked.forEach((item) => {
      fields[`recycle_quantities[${item.id}]`] = String(item.quantity);
    });
    const posted = await postForm('/gacha_recycle', fields, false);
    const flash = assertGachaOk(posted, '回收失败');
    bustGachaCache();
    return { ok: true, flash, price: parseRecyclePage(html).price };
  }

  if (path === '/titles/recipes' && method === 'GET') {
    requireCookie();
    const html = await fetchHtml('/gacha_recipes');
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
    return { items: parseRecipes(html) };
  }

  if (path === '/titles/recipes/craft' && method === 'POST') {
    requireCookie();
    const html = await fetchHtml('/gacha_recipes');
    const recipeId = String(payload.recipeId ?? payload.id ?? '').trim();
    if (!recipeId) throw new MockApiError(400, 'BAD_REQUEST', '请选择配方');
    const posted = await postForm('/gacha_recipe_craft', { _csrf: csrfFrom(html), recipe_id: recipeId }, false);
    const flash = assertGachaOk(posted, '合成失败');
    bustGachaCache();
    return { ok: true, flash };
  }

  if (path === '/titles/market' && method === 'GET') {
    const page = query.cursor ? Number(query.cursor) || 1 : 1;
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.rarity) params.set('rarity', query.rarity);
    if (query.sort) params.set('sort', query.sort);
    if (page > 1) params.set('p', String(page));
    const html = await fetchHtml(
      `/gacha_market${params.toString() ? `?${params}` : ''}`,
      undefined,
      { fresh: query.fresh === '1' },
    );
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
    return parseMarketPage(html, page);
  }

  if (path === '/titles/market/buy' && method === 'POST') {
    requireCookie();
    const html = await fetchHtml('/gacha_market');
    const listingId = String(payload.listingId ?? payload.id ?? '').trim();
    if (!listingId) throw new MockApiError(400, 'BAD_REQUEST', '缺少交易编号');
    const listing = parseMarketPage(html, 1).items.find((item) => item.id === listingId);
    const cap = listing ? Math.max(1, listing.max || listing.stock || 1) : 0;
    const quantity = Math.max(1, Math.trunc(Number(payload.quantity ?? 1)) || 1);
    const qty = cap ? Math.min(cap, quantity) : quantity;
    const balance = parsePointsAmount(html.match(/积分\s*([^<\n]+)/)?.[1]) || liveSessionUser()?.points || 0;
    if (listing && balance < qty * listing.price) {
      const cost = qty * listing.price;
      throw new MockApiError(400, 'UPSTREAM', `购买失败：积分不足，需要 ${cost.toLocaleString('zh-CN')} 积分`);
    }
    const posted = await postForm('/gacha_market_buy', {
      _csrf: csrfFrom(html),
      listing_id: listingId,
      quantity: String(qty),
      return_q: String(payload.q ?? ''),
      return_rarity: String(payload.rarity ?? ''),
      return_sort: String(payload.sort ?? 'latest'),
      return_p: String(payload.page ?? '1'),
    }, false);
    const flash = assertGachaOk(posted, '购买失败');
    bustGachaCache();
    return { ok: true, flash };
  }

  if (path === '/titles/market/mine' && method === 'GET') {
    requireCookie();
    const html = await fetchHtml('/gacha_market_mine');
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
    return parseMarketMine(html);
  }

  if (path === '/titles/market/publish' && method === 'POST') {
    requireCookie();
    const html = await fetchHtml('/gacha_market_mine');
    const titleId = String(payload.titleId ?? '').trim();
    const quantity = Math.max(1, Number(payload.quantity ?? 1));
    const unitPrice = Math.max(1, Number(payload.unitPrice ?? payload.price ?? 0));
    const durationHours = String(payload.durationHours ?? 24);
    if (!titleId || unitPrice < 1) throw new MockApiError(400, 'BAD_REQUEST', '请选择称号并填写单价');
    const fields: Record<string, string> = {
      _csrf: csrfFrom(html),
      title_id: titleId,
      quantity: String(quantity),
      unit_price: String(unitPrice),
      duration_hours: durationHours,
    };
    if (payload.instanceId) fields.instance_id = String(payload.instanceId);
    const posted = await postForm('/gacha_market_publish', fields, false);
    const flash = assertGachaOk(posted, '发布失败');
    bustGachaCache();
    return { ok: true, flash };
  }

  if (path === '/titles/market/cancel' && method === 'POST') {
    requireCookie();
    const html = await fetchHtml('/gacha_market_mine');
    const listingId = String(payload.listingId ?? payload.id ?? '').trim();
    const mine = parseMarketMine(html);
    const row = mine.listings.find((item) => item.id === listingId);
    const action = row?.cancelPath || '/gacha_market_cancel';
    if (!listingId) throw new MockApiError(400, 'BAD_REQUEST', '缺少交易编号');
    const posted = await postForm(action, { _csrf: csrfFrom(html), listing_id: listingId }, false);
    const flash = assertGachaOk(posted, '撤回失败');
    bustGachaCache();
    return { ok: true, flash };
  }

  if (path === '/titles/market/orders' && method === 'GET') {
    requireCookie();
    const html = await fetchHtml('/gacha_market_orders');
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
    return { items: parseMarketOrders(html) };
  }

  if (path === '/wallet' && method === 'GET') {
    requireCookie();
    const html = await fetchHtml('/community_wallet', undefined, { fresh: query.fresh === '1' });
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后查看烧饼钱包');
    return parseWalletPage(html);
  }

  if (path === '/wallet/redeem' && method === 'POST') {
    requireCookie();
    const code = String(payload.code ?? '').trim();
    if (!code) throw new MockApiError(400, 'VALIDATION', '请输入兑换码');
    const page = await fetchHtml('/community_wallet', undefined, { fresh: true });
    if (isLoginWall(page)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后兑换');
    const posted = await postForm('/community_wallet_redeem', { _csrf: csrfFrom(page), code }, false);
    if (isLoginWall(posted.html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后兑换');
    const failed = parseFormErrorMessage(posted.html, posted.cookies, posted.url);
    const flash = postedMessage(posted);
    if (failed && /限制|错误|无效|失败|不正确|不存在|已使用|用过/.test(failed) && !/成功|到账/.test(failed)) {
      throw new MockApiError(400, 'UPSTREAM', failed);
    }
    if (flash && /限制|错误|无效|失败|不正确|不存在|已使用|用过/.test(flash) && !/成功|到账/.test(flash)) {
      throw new MockApiError(400, 'UPSTREAM', flash);
    }
    bustHtml(/\/community_wallet/);
    const nextHtml = /community-wallet-page/.test(posted.html)
      ? posted.html
      : await fetchHtml('/community_wallet', undefined, { fresh: true });
    const wallet = parseWalletPage(nextHtml);
    return {
      ok: true,
      message: flash || failed || '兑换成功',
      balance: wallet.balance,
    };
  }

  if (path === '/invites' && method === 'GET') {
    requireCookie();
    const html = await fetchHtml('/invite_center', undefined, { fresh: query.fresh === '1' });
    if (isLoginWall(html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后查看邀请中心');
    return parseInvitePage(html);
  }

  if (path === '/invites' && method === 'POST') {
    throw new MockApiError(400, 'NOT_SUPPORTED', '邀请请复制分享链接');
  }

  if (path === '/collections') {
    const tab = query.tab ?? 'everyone';
    const html = await fetchHtml(tab === 'mine' ? '/topic_collections' : '/topic_collections?tab=everyone');
    if (isLoginWall(html)) return { items: [] };
    return { items: parseCollections(html) };
  }

  const collectionTopics = match(path, /^\/collections\/([^/]+)\/topics$/);
  if (collectionTopics) {
    const page = query.cursor ? Number(query.cursor) || 1 : 1;
    const id = encodeURIComponent(decodeURIComponent(collectionTopics[0]));
    const html = await fetchHtml(`/topic_collection/${id}${page > 1 ? `?p=${page}` : ''}`);
    if (isLoginWall(html)) return { items: [], nextCursor: null };
    return { items: ensureParsed(html, parseTopicItems(html), '淘帖列表', /class="[^"]*post-list/), nextCursor: nextPage(html, page) };
  }

  if (path === '/identity' && method === 'GET') {
    const html = await fetchHtml('/identity_center');
    return parseIdentity(html);
  }

  if (path === '/identity/apply' && method === 'POST') {
    requireCookie();
    if (String(payload.rules_agreed ?? '') !== '1') {
      throw new MockApiError(400, 'VALIDATION', '请先阅读并同意申请说明');
    }
    const page = await fetchHtml('/identity_center', undefined, { fresh: true });
    if (isLoginWall(page)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后申请认证');
    const posted = await postForm('/identity_center', {
      _csrf: csrfFrom(page),
      identity_center_action: 'apply',
      requested_type: 'creator',
      rules_agreed: '1',
    }, false);
    if (isLoginWall(posted.html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后申请认证');
    if (/identity-center-next[^>]*\bdisabled\b/.test(posted.html) && /identity-center-criteria-note-fail/.test(posted.html)) {
      throw new MockApiError(400, 'UPSTREAM', formError(posted.html, '请先完成全部申请条件后再继续'));
    }
    bustHtml(/\/identity_center/);
    return { ok: true, message: postedMessage(posted) || '已提交申请' };
  }

  if (path === '/search') {
    const q = String(payload.q ?? query.q ?? '').trim();
    const scopeRaw = String(payload.scope ?? query.scope ?? 'all');
    const scope = scopeRaw === 'topics' ? 'all' : scopeRaw === 'users' ? 'user' : scopeRaw;
    const sort = String(payload.sort ?? query.sort ?? 'relevance');
    const page = Number(payload.page ?? query.page ?? 1) || 1;
    const charge = method === 'POST' || payload.charge === true || query.charge === '1';
    if (!q) {
      const html = await fetchHtml(scope && scope !== 'all' ? `/search?scope=${encodeURIComponent(scope)}` : '/search');
      return parseSearchPage(html, '', scope, sort, 1);
    }
    if (q.length < 2) throw new MockApiError(400, 'VALIDATION', '请输入至少 2 个字符');
    if (q.length > 120) throw new MockApiError(400, 'VALIDATION', '搜索词最多 120 个字符');
    if (charge) {
      requireCookie();
      const formPage = await fetchHtml('/search');
      if (isLoginWall(formPage)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后搜索');
      const posted = await postForm('/meilisearch_search', {
        _csrf: csrfFrom(formPage),
        q,
        scope,
        charge_confirmed: '1',
      }, false);
      if (isLoginWall(posted.html)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后搜索');
      if (jsonRejected(posted.json) || posted.status >= 400) {
        throw new MockApiError(400, 'UPSTREAM', formError(posted.html, postedMessage(posted) || '搜索失败'));
      }
      const message = postedMessage(posted);
      if (message && /不足|失败|不能|无法/.test(message) && !/个主题|个用户|搜索/.test(message)) {
        throw new MockApiError(400, 'UPSTREAM', message);
      }
      const result = parseSearchPage(posted.html, q, scope, sort, 1);
      if (result.balance > 0) rememberUserPoints(result.balance);
      return result;
    }
    const params = new URLSearchParams();
    params.set('q', q);
    if (scope && scope !== 'all') params.set('scope', scope);
    if (sort && sort !== 'relevance') params.set('sort', sort);
    if (page > 1) params.set('p', String(page));
    const html = await fetchHtml(`/search?${params.toString()}`);
    return parseSearchPage(html, q, scope, sort, page);
  }

  if (path === '/profile' && method === 'GET') {
    requireCookie();
    const html = await fetchHtml('/profile', undefined, { fresh: query.fresh === '1' });
    return parseProfile(html);
  }

  if (path === '/profile/bio' && method === 'POST') {
    return saveProfileForm('/profile_layout_order_bio_save', { bio: String(payload.bio ?? '') }, '保存简介失败');
  }

  if (path === '/profile/password' && method === 'POST') {
    return saveProfileForm('/profile_layout_order_password_save', {
      current_password: String(payload.current_password ?? ''),
      password: String(payload.password ?? ''),
      password2: String(payload.password2 ?? ''),
    }, '保存密码失败');
  }

  if (path === '/profile/username' && method === 'POST') {
    const saved = await saveProfileForm('/username_change', {
      new_username: String(payload.new_username ?? '').trim(),
      current_password: String(payload.current_password ?? ''),
    }, '修改用户名失败');
    try {
      const profile = parseProfile(await fetchHtml('/profile', undefined, { fresh: true }));
      const me = sessionForToken(currentToken)?.user;
      if (me && currentToken) {
        updateUpstreamUser(currentToken, { ...me, name: profile.username, points: profile.points });
      }
    } catch {
      /* keep previous session user */
    }
    return saved;
  }

  if (path === '/profile/email' && method === 'POST') {
    return saveProfileForm('/user_review_email_change', {
      current_password: String(payload.current_password ?? ''),
      email: String(payload.email ?? '').trim(),
      email_code: String(payload.email_code ?? '').trim(),
    }, '修改邮箱失败');
  }

  if (path === '/profile/email-code' && method === 'POST') {
    requireCookie();
    const page = await fetchHtml('/profile', undefined, { fresh: true });
    if (isLoginWall(page)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后操作');
    const posted = await postForm('/user_review_email_code', {
      _csrf: csrfFrom(page),
      email: String(payload.email ?? '').trim(),
      current_password: String(payload.current_password ?? ''),
    }, true);
    if (jsonRejected(posted.json) || posted.status >= 400) {
      throw new MockApiError(400, 'UPSTREAM', postedMessage(posted) || formError(posted.html, '验证码发送失败'));
    }
    return { ok: true, message: postedMessage(posted) || '验证码已发送' };
  }

  if (path === '/profile/infinite' && method === 'POST') {
    const enabled = payload.enabled === true || payload.enabled === 1 || payload.enabled === '1';
    return saveProfileForm('/sb_infinite_scroll_user_settings', enabled ? { enabled: '1' } : {}, '保存失败');
  }

  if (path === '/profile/avatar-preset' && method === 'POST') {
    requireCookie();
    const seed = String(payload.seed ?? '').trim();
    if (!seed) throw new MockApiError(400, 'VALIDATION', '请选择预置头像');
    const page = await fetchHtml('/profile', undefined, { fresh: true });
    if (isLoginWall(page)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后操作');
    const posted = await postAjaxForm('/avatar_upload', {
      _csrf: csrfFrom(page),
      avatar_upload_action: 'preset',
      avatar_seed: seed,
    }, '/profile');
    if (jsonRejected(posted.json) || posted.status >= 400) {
      throw new MockApiError(400, 'UPSTREAM', postedMessage(posted) || '更换头像失败');
    }
    bustHtml(/\/profile|\/user\//);
    try {
      const profile = parseProfile(await fetchHtml('/profile', undefined, { fresh: true }));
      const me = sessionForToken(currentToken)?.user;
      if (me && currentToken) {
        updateUpstreamUser(currentToken, { ...me, avatar: profile.avatar, points: profile.points });
      }
    } catch {
      /* keep previous session user */
    }
    return { ok: true, message: postedMessage(posted) || '头像已更新' };
  }

  if (path === '/profile/avatar-upload' && method === 'POST') {
    requireCookie();
    const uri = String(payload.uri ?? '').trim();
    const name = String(payload.name ?? 'avatar.jpg').trim() || 'avatar.jpg';
    const type = String(payload.type ?? 'image/jpeg').trim() || 'image/jpeg';
    if (!uri) throw new MockApiError(400, 'VALIDATION', '请选择图片文件');
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(type)) {
      throw new MockApiError(400, 'VALIDATION', '请选择图片文件');
    }
    const page = await fetchHtml('/profile', undefined, { fresh: true });
    if (isLoginWall(page)) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录后操作');
    const body = new FormData();
    body.append('_csrf', csrfFrom(page));
    body.append('avatar_upload_action', 'upload');
    body.append('avatar', { uri, name, type } as unknown as Blob);
    const posted = await linuxRequest('/avatar_upload', {
      method: 'POST',
      body,
      timeoutMs: 45_000,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/html;q=0.9',
        Referer: `${LINUX_ORIGIN}/profile`,
      },
    });
    if (jsonRejected(posted.json) || posted.status >= 400) {
      throw new MockApiError(400, 'UPSTREAM', postedMessage(posted) || '上传头像失败');
    }
    bustHtml(/\/profile|\/user\//);
    try {
      const profile = parseProfile(await fetchHtml('/profile', undefined, { fresh: true }));
      const me = sessionForToken(currentToken)?.user;
      if (me && currentToken) {
        updateUpstreamUser(currentToken, { ...me, avatar: profile.avatar, points: profile.points });
      }
    } catch {
      /* keep previous session user */
    }
    return { ok: true, message: postedMessage(posted) || '头像已更新' };
  }

  if (path === '/uploads' && method === 'POST') {
    return uploadPostImage({
      uri: String(payload.uri ?? ''),
      name: String(payload.name ?? 'image.jpg'),
      type: String(payload.type ?? 'image/jpeg'),
      target: String(payload.target ?? ''),
    });
  }

  throw new MockApiError(404, 'NOT_FOUND', '接口不存在');
}

export async function handleLiveRequest(req: MockRequest): Promise<MockResponse> {
  const prev = currentToken;
  currentToken = req.token;
  try {
    const data = await dispatch(req);
    return ok(data);
  } catch (error) {
    if (error instanceof MockApiError) {
      return {
        status: error.status,
        error: { code: error.code, message: error.message, requestId: error.requestId },
      };
    }
    return {
      status: 502,
      error: { code: 'UPSTREAM', message: describeUpstreamError(error).message, requestId: requestId() },
    };
  } finally {
    currentToken = prev;
  }
}
