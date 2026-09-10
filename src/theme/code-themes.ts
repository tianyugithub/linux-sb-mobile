import { Platform } from 'react-native';
import type { ColorScheme } from './palette';

export type CodeThemeId =
  | 'auto'
  | 'one-dark'
  | 'github'
  | 'dracula'
  | 'nord'
  | 'monokai'
  | 'tokyo'
  | 'solarized'
  | 'quiet'
  | 'paper'
  | 'dawn';
export type CodeFontId = 'system' | 'jetbrains' | 'plex' | 'fira';
export type CodeSizeId = 'small' | 'standard' | 'large';
export type CodeThemeGroup = 'auto' | 'light' | 'classic';

export type CodeTokenKind =
  | 'text'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'key'
  | 'fn'
  | 'operator'
  | 'punct'
  | 'type'
  | 'bool'
  | 'tag'
  | 'attr'
  | 'builtin';

export type CodeTheme = {
  id: Exclude<CodeThemeId, 'auto'>;
  bg: string;
  header: string;
  border: string;
  gutter: string;
  gutterText: string;
  headerText: string;
  headerMuted: string;
  copy: string;
  accent: string;
  inlineBg: string;
  colors: Record<CodeTokenKind, string>;
};

export const CODE_THEME_META: { id: CodeThemeId; label: string; hint: string; group: CodeThemeGroup }[] = [
  { id: 'auto', label: '跟随外观', hint: '浅色 GitHub · 深色 One Dark', group: 'auto' },
  { id: 'quiet', label: 'Quiet Light', hint: '米纸底，长时间看 JSON', group: 'light' },
  { id: 'paper', label: '烧饼纸', hint: '暖白纸感，字段更清楚', group: 'light' },
  { id: 'dawn', label: '晨雾', hint: '浅紫灰，接近 Tokyo Day', group: 'light' },
  { id: 'one-dark', label: 'One Dark', hint: '浅色 One Light · 深色 One Dark', group: 'classic' },
  { id: 'github', label: 'GitHub', hint: '随浅色 / 深色切换', group: 'classic' },
  { id: 'dracula', label: 'Dracula', hint: '浅色紫雾 · 深色高对比', group: 'classic' },
  { id: 'nord', label: 'Nord', hint: '浅色雪原 · 深色极光', group: 'classic' },
  { id: 'monokai', label: 'Monokai', hint: '浅色奶油 · 深色经典', group: 'classic' },
  { id: 'tokyo', label: 'Tokyo Night', hint: '浅色晨蓝 · 深色夜紫', group: 'classic' },
  { id: 'solarized', label: 'Solarized', hint: '浅色象牙 · 深色海绿', group: 'classic' },
];

export const CODE_FONT_META: { id: CodeFontId; label: string; hint: string }[] = [
  { id: 'system', label: '系统等宽', hint: Platform.OS === 'ios' ? 'Menlo' : '设备默认' },
  { id: 'jetbrains', label: 'JetBrains', hint: 'IDE 风格' },
  { id: 'plex', label: 'IBM Plex', hint: '偏工程阅读' },
  { id: 'fira', label: 'Fira Code', hint: '连字等宽' },
];

export const CODE_SIZE_META: { id: CodeSizeId; label: string; fontSize: number; lineHeight: number }[] = [
  { id: 'small', label: '小', fontSize: 11, lineHeight: 17 },
  { id: 'standard', label: '标准', fontSize: 12.5, lineHeight: 19 },
  { id: 'large', label: '大', fontSize: 14.5, lineHeight: 22 },
];

export const CODE_THEME_LABEL: Record<CodeThemeId, string> = Object.fromEntries(
  CODE_THEME_META.map((item) => [item.id, item.label]),
) as Record<CodeThemeId, string>;

export const CODE_FONT_LABEL: Record<CodeFontId, string> = Object.fromEntries(
  CODE_FONT_META.map((item) => [item.id, item.label]),
) as Record<CodeFontId, string>;

export const CODE_SIZE_LABEL: Record<CodeSizeId, string> = Object.fromEntries(
  CODE_SIZE_META.map((item) => [item.id, item.label]),
) as Record<CodeSizeId, string>;

const ONE_DARK: CodeTheme = {
  id: 'one-dark',
  bg: '#282C34',
  header: '#21252B',
  border: '#181A1F',
  gutter: '#21252B',
  gutterText: '#4B5263',
  headerText: '#ABB2BF',
  headerMuted: '#5C6370',
  copy: '#61AFEF',
  accent: '#61AFEF',
  inlineBg: '#2C313C',
  colors: {
    text: '#ABB2BF',
    comment: '#5C6370',
    string: '#98C379',
    number: '#D19A66',
    keyword: '#C678DD',
    key: '#E06C75',
    fn: '#61AFEF',
    operator: '#56B6C2',
    punct: '#ABB2BF',
    type: '#E5C07B',
    bool: '#D19A66',
    tag: '#E06C75',
    attr: '#D19A66',
    builtin: '#56B6C2',
  },
};

const ONE_LIGHT: CodeTheme = {
  id: 'one-dark',
  bg: '#FAFAFA',
  header: '#F0F0F0',
  border: '#E2E4E8',
  gutter: '#FAFAFA',
  gutterText: '#9D9D9F',
  headerText: '#383A42',
  headerMuted: '#A0A1A7',
  copy: '#4078F2',
  accent: '#4078F2',
  inlineBg: '#F0F0F0',
  colors: {
    text: '#383A42',
    comment: '#A0A1A7',
    string: '#50A14F',
    number: '#986801',
    keyword: '#A626A4',
    key: '#E45649',
    fn: '#4078F2',
    operator: '#0184BC',
    punct: '#383A42',
    type: '#C18401',
    bool: '#986801',
    tag: '#E45649',
    attr: '#986801',
    builtin: '#0184BC',
  },
};

const GITHUB_DARK: CodeTheme = {
  id: 'github',
  bg: '#0D1117',
  header: '#161B22',
  border: '#30363D',
  gutter: '#0D1117',
  gutterText: '#484F58',
  headerText: '#E6EDF3',
  headerMuted: '#7D8590',
  copy: '#58A6FF',
  accent: '#3FB950',
  inlineBg: '#161B22',
  colors: {
    text: '#E6EDF3',
    comment: '#8B949E',
    string: '#A5D6FF',
    number: '#79C0FF',
    keyword: '#FF7B72',
    key: '#7EE787',
    fn: '#D2A8FF',
    operator: '#FF7B72',
    punct: '#C9D1D9',
    type: '#FFA657',
    bool: '#79C0FF',
    tag: '#7EE787',
    attr: '#79C0FF',
    builtin: '#79C0FF',
  },
};

const GITHUB_LIGHT: CodeTheme = {
  id: 'github',
  bg: '#F6F8FA',
  header: '#FFFFFF',
  border: '#D0D7DE',
  gutter: '#F6F8FA',
  gutterText: '#8C959F',
  headerText: '#1F2328',
  headerMuted: '#656D76',
  copy: '#0969DA',
  accent: '#1A7F37',
  inlineBg: '#EEF2F6',
  colors: {
    text: '#1F2328',
    comment: '#656D76',
    string: '#0A3069',
    number: '#0550AE',
    keyword: '#CF222E',
    key: '#116329',
    fn: '#8250DF',
    operator: '#CF222E',
    punct: '#1F2328',
    type: '#953800',
    bool: '#0550AE',
    tag: '#116329',
    attr: '#0550AE',
    builtin: '#0550AE',
  },
};

const DRACULA: CodeTheme = {
  id: 'dracula',
  bg: '#282A36',
  header: '#21222C',
  border: '#191A21',
  gutter: '#21222C',
  gutterText: '#6272A4',
  headerText: '#F8F8F2',
  headerMuted: '#6272A4',
  copy: '#8BE9FD',
  accent: '#BD93F9',
  inlineBg: '#343746',
  colors: {
    text: '#F8F8F2',
    comment: '#6272A4',
    string: '#F1FA8C',
    number: '#BD93F9',
    keyword: '#FF79C6',
    key: '#8BE9FD',
    fn: '#50FA7B',
    operator: '#FF79C6',
    punct: '#F8F8F2',
    type: '#8BE9FD',
    bool: '#BD93F9',
    tag: '#FF79C6',
    attr: '#50FA7B',
    builtin: '#8BE9FD',
  },
};

const DRACULA_LIGHT: CodeTheme = {
  id: 'dracula',
  bg: '#F7F3FF',
  header: '#EEE8F8',
  border: '#E0D6F0',
  gutter: '#F7F3FF',
  gutterText: '#9A8BB8',
  headerText: '#44475A',
  headerMuted: '#7B6FA0',
  copy: '#0F7A8A',
  accent: '#7C5CBF',
  inlineBg: '#EEE8F8',
  colors: {
    text: '#44475A',
    comment: '#7B6FA0',
    string: '#6E7200',
    number: '#6F4DB0',
    keyword: '#C43B8A',
    key: '#0F7A8A',
    fn: '#2A8A48',
    operator: '#C43B8A',
    punct: '#44475A',
    type: '#0F7A8A',
    bool: '#6F4DB0',
    tag: '#C43B8A',
    attr: '#2A8A48',
    builtin: '#0F7A8A',
  },
};

const NORD: CodeTheme = {
  id: 'nord',
  bg: '#2E3440',
  header: '#3B4252',
  border: '#3B4252',
  gutter: '#2E3440',
  gutterText: '#4C566A',
  headerText: '#E5E9F0',
  headerMuted: '#7B88A1',
  copy: '#88C0D0',
  accent: '#88C0D0',
  inlineBg: '#3B4252',
  colors: {
    text: '#D8DEE9',
    comment: '#616E88',
    string: '#A3BE8C',
    number: '#B48EAD',
    keyword: '#81A1C1',
    key: '#8FBCBB',
    fn: '#88C0D0',
    operator: '#81A1C1',
    punct: '#D8DEE9',
    type: '#8FBCBB',
    bool: '#B48EAD',
    tag: '#81A1C1',
    attr: '#8FBCBB',
    builtin: '#88C0D0',
  },
};

const NORD_LIGHT: CodeTheme = {
  id: 'nord',
  bg: '#ECEFF4',
  header: '#E5E9F0',
  border: '#D8DEE9',
  gutter: '#ECEFF4',
  gutterText: '#7B88A1',
  headerText: '#2E3440',
  headerMuted: '#4C566A',
  copy: '#5E81AC',
  accent: '#5E81AC',
  inlineBg: '#E5E9F0',
  colors: {
    text: '#2E3440',
    comment: '#4C566A',
    string: '#3F6B3A',
    number: '#8F5B84',
    keyword: '#3D5A80',
    key: '#2F6F6C',
    fn: '#3D5A80',
    operator: '#4C566A',
    punct: '#2E3440',
    type: '#2F6F6C',
    bool: '#B85C3A',
    tag: '#3D5A80',
    attr: '#2F6F6C',
    builtin: '#5E81AC',
  },
};

const MONOKAI: CodeTheme = {
  id: 'monokai',
  bg: '#272822',
  header: '#1E1F1C',
  border: '#1B1C18',
  gutter: '#1E1F1C',
  gutterText: '#5B5C54',
  headerText: '#F8F8F2',
  headerMuted: '#75715E',
  copy: '#A6E22E',
  accent: '#F92672',
  inlineBg: '#3E3D32',
  colors: {
    text: '#F8F8F2',
    comment: '#75715E',
    string: '#E6DB74',
    number: '#AE81FF',
    keyword: '#F92672',
    key: '#66D9EF',
    fn: '#A6E22E',
    operator: '#F92672',
    punct: '#F8F8F2',
    type: '#66D9EF',
    bool: '#AE81FF',
    tag: '#F92672',
    attr: '#A6E22E',
    builtin: '#66D9EF',
  },
};

const MONOKAI_LIGHT: CodeTheme = {
  id: 'monokai',
  bg: '#FAF8F2',
  header: '#F1EEE4',
  border: '#E4DFD0',
  gutter: '#FAF8F2',
  gutterText: '#A39B86',
  headerText: '#272822',
  headerMuted: '#6E6B5E',
  copy: '#0E8A9A',
  accent: '#D0185F',
  inlineBg: '#F1EEE4',
  colors: {
    text: '#272822',
    comment: '#6E6B5E',
    string: '#8A7A12',
    number: '#6C4BB6',
    keyword: '#D0185F',
    key: '#0E8A9A',
    fn: '#4E7C0E',
    operator: '#D0185F',
    punct: '#272822',
    type: '#0E8A9A',
    bool: '#6C4BB6',
    tag: '#D0185F',
    attr: '#4E7C0E',
    builtin: '#0E8A9A',
  },
};

const TOKYO: CodeTheme = {
  id: 'tokyo',
  bg: '#1A1B26',
  header: '#16161E',
  border: '#24283B',
  gutter: '#16161E',
  gutterText: '#3B4261',
  headerText: '#C0CAF5',
  headerMuted: '#565F89',
  copy: '#7AA2F7',
  accent: '#BB9AF7',
  inlineBg: '#24283B',
  colors: {
    text: '#C0CAF5',
    comment: '#565F89',
    string: '#9ECE6A',
    number: '#FF9E64',
    keyword: '#BB9AF7',
    key: '#73DACA',
    fn: '#7AA2F7',
    operator: '#89DDFF',
    punct: '#A9B1D6',
    type: '#2AC3DE',
    bool: '#FF9E64',
    tag: '#F7768E',
    attr: '#73DACA',
    builtin: '#7DCFFF',
  },
};

const TOKYO_DAY: CodeTheme = {
  id: 'tokyo',
  bg: '#E6E7ED',
  header: '#D8DAE3',
  border: '#C5C8D4',
  gutter: '#E6E7ED',
  gutterText: '#848CB5',
  headerText: '#3760BF',
  headerMuted: '#6172B0',
  copy: '#2E7DE9',
  accent: '#7847BD',
  inlineBg: '#D8DAE3',
  colors: {
    text: '#3760BF',
    comment: '#848CB5',
    string: '#485E30',
    number: '#B15C00',
    keyword: '#7847BD',
    key: '#007197',
    fn: '#2E7DE9',
    operator: '#006A83',
    punct: '#3760BF',
    type: '#007197',
    bool: '#B15C00',
    tag: '#C64343',
    attr: '#007197',
    builtin: '#2E7DE9',
  },
};

const SOLARIZED_DARK: CodeTheme = {
  id: 'solarized',
  bg: '#002B36',
  header: '#073642',
  border: '#073642',
  gutter: '#002B36',
  gutterText: '#586E75',
  headerText: '#93A1A1',
  headerMuted: '#657B83',
  copy: '#268BD2',
  accent: '#2AA198',
  inlineBg: '#073642',
  colors: {
    text: '#839496',
    comment: '#586E75',
    string: '#2AA198',
    number: '#D33682',
    keyword: '#859900',
    key: '#B58900',
    fn: '#268BD2',
    operator: '#859900',
    punct: '#839496',
    type: '#B58900',
    bool: '#CB4B16',
    tag: '#268BD2',
    attr: '#93A1A1',
    builtin: '#2AA198',
  },
};

const SOLARIZED_LIGHT: CodeTheme = {
  id: 'solarized',
  bg: '#FDF6E3',
  header: '#EEE8D5',
  border: '#E4DCC4',
  gutter: '#FDF6E3',
  gutterText: '#93A1A1',
  headerText: '#586E75',
  headerMuted: '#839496',
  copy: '#268BD2',
  accent: '#2AA198',
  inlineBg: '#EEE8D5',
  colors: {
    text: '#657B83',
    comment: '#93A1A1',
    string: '#2AA198',
    number: '#D33682',
    keyword: '#738A05',
    key: '#B58900',
    fn: '#268BD2',
    operator: '#738A05',
    punct: '#657B83',
    type: '#B58900',
    bool: '#CB4B16',
    tag: '#268BD2',
    attr: '#586E75',
    builtin: '#2AA198',
  },
};

const QUIET: CodeTheme = {
  id: 'quiet',
  bg: '#F5F2EB',
  header: '#EDE8DC',
  border: '#E0D9C8',
  gutter: '#F5F2EB',
  gutterText: '#A39B8A',
  headerText: '#5C5346',
  headerMuted: '#8A8170',
  copy: '#4B69C6',
  accent: '#C47B12',
  inlineBg: '#EDE8DC',
  colors: {
    text: '#333333',
    comment: '#7A7264',
    string: '#3E7A24',
    number: '#AB6526',
    keyword: '#3D56A8',
    key: '#6B338C',
    fn: '#AA3731',
    operator: '#5C5346',
    punct: '#5C5346',
    type: '#6B338C',
    bool: '#AB6526',
    tag: '#AA3731',
    attr: '#3D56A8',
    builtin: '#3D56A8',
  },
};

const PAPER: CodeTheme = {
  id: 'paper',
  bg: '#FFFEFB',
  header: '#F6F2E8',
  border: '#E8E2D6',
  gutter: '#FFFEFB',
  gutterText: '#B0A898',
  headerText: '#3F3A32',
  headerMuted: '#8B8173',
  copy: '#2F6FE4',
  accent: '#E1251B',
  inlineBg: '#F7F4EC',
  colors: {
    text: '#2C2418',
    comment: '#8B8173',
    string: '#0B6E4F',
    number: '#9A3412',
    keyword: '#9F1239',
    key: '#1D4ED8',
    fn: '#6D28D9',
    operator: '#57534E',
    punct: '#57534E',
    type: '#B45309',
    bool: '#B45309',
    tag: '#9F1239',
    attr: '#1D4ED8',
    builtin: '#0B6E4F',
  },
};

const DAWN: CodeTheme = {
  id: 'dawn',
  bg: '#F3EEF7',
  header: '#EAE3F1',
  border: '#DDD4E8',
  gutter: '#F3EEF7',
  gutterText: '#A898B8',
  headerText: '#4A3F63',
  headerMuted: '#7D7194',
  copy: '#5B4FC9',
  accent: '#C45C7A',
  inlineBg: '#EAE3F1',
  colors: {
    text: '#3F3554',
    comment: '#8B7D9E',
    string: '#3F6B3A',
    number: '#C45C2A',
    keyword: '#7A3E9D',
    key: '#2A6F8F',
    fn: '#4B69C6',
    operator: '#7A3E9D',
    punct: '#5C5346',
    type: '#2A6F8F',
    bool: '#C45C2A',
    tag: '#C45C7A',
    attr: '#2A6F8F',
    builtin: '#4B69C6',
  },
};

const LIGHT_ONLY = new Set<CodeThemeId>(['quiet', 'paper', 'dawn']);

export function resolveCodeTheme(id: CodeThemeId, scheme: ColorScheme): CodeTheme {
  const light = scheme === 'light';
  if (id === 'auto') return light ? GITHUB_LIGHT : ONE_DARK;
  if (id === 'quiet') return QUIET;
  if (id === 'paper') return PAPER;
  if (id === 'dawn') return DAWN;
  if (id === 'one-dark') return light ? ONE_LIGHT : ONE_DARK;
  if (id === 'github') return light ? GITHUB_LIGHT : GITHUB_DARK;
  if (id === 'dracula') return light ? DRACULA_LIGHT : DRACULA;
  if (id === 'nord') return light ? NORD_LIGHT : NORD;
  if (id === 'monokai') return light ? MONOKAI_LIGHT : MONOKAI;
  if (id === 'tokyo') return light ? TOKYO_DAY : TOKYO;
  return light ? SOLARIZED_LIGHT : SOLARIZED_DARK;
}

export function codeThemeSwatch(id: CodeThemeId, scheme: ColorScheme): CodeTheme {
  if (LIGHT_ONLY.has(id)) return resolveCodeTheme(id, 'light');
  return resolveCodeTheme(id, scheme);
}

export const CODE_FONT_NATIVE: Record<CodeFontId, string> = {
  system: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  jetbrains: 'JetBrainsMono',
  plex: 'IBMPlexMono',
  fira: 'FiraCode',
};

export function codeFontFamily(id: CodeFontId, ready: boolean): string {
  if (id === 'system' || !ready) return CODE_FONT_NATIVE.system;
  return CODE_FONT_NATIVE[id];
}

export function codeSizeOf(id: CodeSizeId) {
  return CODE_SIZE_META.find((item) => item.id === id) ?? CODE_SIZE_META[1];
}

export const CODE_PREVIEW_SAMPLE = `{
  "ok": true,
  "forum": "linux.sb",
  "score": 42,
  "pinned": false,
  "tags": ["json"]
}`;
