import { Platform, StyleSheet, type TextStyle } from 'react-native';
import { setAccessChannel as setNativeAccessChannel, setH3Enabled as setNativeH3 } from 'linux-notify';
import { secureGet, secureSet } from './secure-value';
import type { ColorScheme } from '../theme/palette';
import type { CodeFontId, CodeSizeId, CodeThemeId } from '../theme/code-themes';
import { configureAccessChannel, normalizeAccessChannel, type AccessChannel } from '../utils/linux-access';
import { readBootScheme, writeBootScheme } from './scheme-boot';

export type FontSizePref = 'small' | 'standard' | 'large';
export type CodeThemePref = CodeThemeId;
export type CodeFontPref = CodeFontId;
export type CodeSizePref = CodeSizeId;
export type AccessChannelPref = AccessChannel;

export type AppPrefs = {
  fontSize: FontSizePref;
  /** 发帖须知（「我已阅读并确认」）不再每次弹出。 */
  postingNoticeSkip: boolean;
  /** 首页「每日热帖」区块是否展开（默认收起，别挤掉首屏的帖子列表）。 */
  hotTopicsOpen: boolean;
  /** 插件开关（默认关闭，见 src/plugins/registry.ts）。 */
  plugins: Record<string, boolean>;
  /** 官网访问通道：镜像（默认）/ DoH / 直连。 */
  accessChannel: AccessChannelPref;
  /** DoH / 直连通道下先试 HTTP/3（QUIC），失败自动回落 TLS 分片。 */
  h3First: boolean;
  scheme: ColorScheme;
  codeTheme: CodeThemePref;
  codeFont: CodeFontPref;
  codeSize: CodeSizePref;
  codeLineNumbers: boolean;
  codeWrap: boolean;
  codePrettyJson: boolean;
};

export const FONT_FACTOR: Record<FontSizePref, number> = {
  small: 0.9,
  standard: 1,
  large: 1.18,
};

export const FONT_LABEL: Record<FontSizePref, string> = {
  small: '小',
  standard: '标准',
  large: '大',
};

export const FONT_CYCLE: FontSizePref[] = ['small', 'standard', 'large'];

const CODE_THEMES: CodeThemePref[] = ['auto', 'one-dark', 'github', 'dracula', 'nord', 'monokai', 'tokyo', 'solarized', 'quiet', 'paper', 'dawn'];
const CODE_FONTS: CodeFontPref[] = ['system', 'jetbrains', 'plex', 'fira'];
const CODE_SIZES: CodeSizePref[] = ['small', 'standard', 'large'];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? value as T : fallback;
}

export const DEFAULT_PREFS: AppPrefs = {
  fontSize: 'standard',
  postingNoticeSkip: false,
  hotTopicsOpen: false,
  plugins: {},
  accessChannel: 'mirror',
  h3First: true,
  scheme: 'dark',
  codeTheme: 'auto',
  codeFont: 'jetbrains',
  codeSize: 'standard',
  codeLineNumbers: true,
  codeWrap: true,
  codePrettyJson: true,
};

const KEY = 'lsb.app.prefs';

let current: AppPrefs = { ...DEFAULT_PREFS, scheme: readBootScheme() };
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(KEY);
  return secureGet(KEY);
}

async function writeRaw(value: string) {
  if (Platform.OS === 'web') {
    localStorage.setItem(KEY, value);
    return;
  }
  // 偏好也会长大（插件开关、屏蔽规则…），同样走分片，别再撞 2KB 上限。
  await secureSet(KEY, value);
}

/** 插件开关：只接受布尔值，坏数据丢掉。 */
function parsePlugins(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, boolean> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (typeof item === 'boolean') out[key] = item;
  });
  return out;
}

function parse(raw: string | null): AppPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<AppPrefs>;
    const fontSize = parsed.fontSize === 'small' || parsed.fontSize === 'large' ? parsed.fontSize : 'standard';
    return {
      fontSize,
      postingNoticeSkip: parsed.postingNoticeSkip === true,
      hotTopicsOpen: parsed.hotTopicsOpen === true,
      plugins: parsePlugins(parsed.plugins),
      accessChannel: normalizeAccessChannel(parsed.accessChannel),
      h3First: parsed.h3First !== false,
      scheme: parsed.scheme === 'light' ? 'light' : 'dark',
      codeTheme: pick(parsed.codeTheme, CODE_THEMES, DEFAULT_PREFS.codeTheme),
      codeFont: pick(parsed.codeFont, CODE_FONTS, DEFAULT_PREFS.codeFont),
      codeSize: pick(parsed.codeSize, CODE_SIZES, DEFAULT_PREFS.codeSize),
      codeLineNumbers: parsed.codeLineNumbers !== false,
      codeWrap: parsed.codeWrap !== false,
      codePrettyJson: parsed.codePrettyJson !== false,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function applyAccessChannel(next: AccessChannelPref) {
  configureAccessChannel(next);
  setNativeAccessChannel(next);
}

/** 把 QUIC 开关同步给原生（H3 拦截器读的是这份）。 */
export function applyH3First(next: boolean) {
  setNativeH3(next);
}

export function getPrefs(): AppPrefs {
  return current;
}

export function subscribePrefs(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function hydratePrefs() {
  if (hydrated) return current;
  hydrated = true;
  current = parse(await readRaw());
  applyAccessChannel(current.accessChannel);
  applyH3First(current.h3First);
  writeBootScheme(current.scheme);
  notify();
  return current;
}

export async function patchPrefs(patch: Partial<AppPrefs>) {
  current = { ...current, ...patch };
  if (patch.accessChannel) applyAccessChannel(current.accessChannel);
  if (patch.h3First !== undefined) applyH3First(current.h3First);
  if (patch.scheme) writeBootScheme(current.scheme);
  notify();
  await writeRaw(JSON.stringify(current));
  return current;
}

export function nextFontSize(currentSize: FontSizePref): FontSizePref {
  const index = FONT_CYCLE.indexOf(currentSize);
  return FONT_CYCLE[(index + 1) % FONT_CYCLE.length];
}

export function scaleTextStyle(style: TextStyle | TextStyle[], factor: number): TextStyle {
  const flat = StyleSheet.flatten(style) as TextStyle;
  if (factor === 1) return flat;
  const next: TextStyle = { ...flat };
  if (typeof flat.fontSize === 'number') next.fontSize = Math.round(flat.fontSize * factor * 10) / 10;
  if (typeof flat.lineHeight === 'number') next.lineHeight = Math.round(flat.lineHeight * factor * 10) / 10;
  return next;
}
