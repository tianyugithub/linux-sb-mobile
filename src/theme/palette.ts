import { Appearance } from 'react-native';
import { readBootScheme, writeBootScheme } from '../services/scheme-boot';

export type ColorScheme = 'light' | 'dark';

export type Palette = {
  scheme: ColorScheme;
  canvas: string;
  surface: string;
  surfaceRaised: string;
  surfaceSoft: string;
  line: string;
  text: string;
  muted: string;
  dim: string;
  red: string;
  redBright: string;
  orange: string;
  green: string;
  blue: string;
  tabbar: string;
  comment: string;
  noticeBg: string;
  codeBg: string;
  videoBg: string;
  codeText: string;
  unreadBg: string;
  successSoft: string;
  rulesBg: string;
  webStage: string;
  inlineCode: string;
  warmFill: string;
  dangerFill: string;
  filterActive: string;
  fade: string;
  toastBg: string;
  toastFg: string;
  rail: string;
  card: string;
  searchPill: string;
  skeleton: string;
  skeletonSoft: string;
  kindReplyBg: string;
  kindReplyFg: string;
  kindMentionBg: string;
  kindMentionFg: string;
  kindRewardBg: string;
  kindRewardFg: string;
  kindSystemBg: string;
  kindSystemFg: string;
  commentHighlightBg: string;
  commentHighlightBar: string;
  commentPostedBg: string;
  tagDefaultBg: string;
  tagDefaultFg: string;
  tagDefaultBorder: string;
  tagDangerBg: string;
  tagDangerFg: string;
  tagDangerBorder: string;
  tagWarningBg: string;
  tagWarningFg: string;
  tagWarningBorder: string;
  tagSuccessBg: string;
  tagSuccessFg: string;
  tagSuccessBorder: string;
  tagEssenceBg: string;
  tagEssenceFg: string;
  tagEssenceBorder: string;
  tagEssenceNegBg: string;
  tagEssenceNegFg: string;
  tagEssenceNegBorder: string;
  tagInfoBg: string;
  tagInfoFg: string;
  tagInfoBorder: string;
};

export const palettes: Record<ColorScheme, Palette> = {
  dark: {
    scheme: 'dark',
    canvas: '#0E1117',
    surface: '#151A23',
    surfaceRaised: '#1C2330',
    surfaceSoft: '#222A38',
    line: '#2A3342',
    text: '#F3F5F7',
    muted: '#8792A6',
    dim: '#5D687B',
    red: '#E1251B',
    redBright: '#FF4D45',
    orange: '#F5A623',
    green: '#22C55E',
    blue: '#6FA8FF',
    tabbar: '#121720',
    comment: '#D5DAE2',
    noticeBg: '#201C19',
    codeBg: '#0A0D13',
    videoBg: '#000000',
    codeText: '#D5DAE2',
    unreadBg: '#222A38',
    successSoft: '#13261C',
    rulesBg: '#201C19',
    webStage: '#07090C',
    inlineCode: '#E7C07B',
    warmFill: '#2A2114',
    dangerFill: '#2A1514',
    filterActive: '#5B6B7D',
    fade: 'rgba(14,17,23,0)',
    toastBg: 'rgba(36,43,56,0.96)',
    toastFg: '#F3F5F7',
    rail: '#12171F',
    card: '#171D27',
    searchPill: '#141A22',
    skeleton: '#1C2330',
    skeletonSoft: '#171D27',
    kindReplyBg: '#1A2F48',
    kindReplyFg: '#6FA8FF',
    kindMentionBg: '#2A1F48',
    kindMentionFg: '#A78BFA',
    kindRewardBg: '#3A2A14',
    kindRewardFg: '#F5A623',
    kindSystemBg: '#3A1A18',
    kindSystemFg: '#FF6B63',
    commentHighlightBg: '#173028',
    commentHighlightBar: '#2ECC71',
    commentPostedBg: '#12171F',
    tagDefaultBg: '#222A38',
    tagDefaultFg: '#FFFFFF',
    tagDefaultBorder: 'transparent',
    tagDangerBg: '#7F241F',
    tagDangerFg: '#FFFFFF',
    tagDangerBorder: 'transparent',
    tagWarningBg: '#5A3B18',
    tagWarningFg: '#FFFFFF',
    tagWarningBorder: 'transparent',
    tagSuccessBg: '#185C3A',
    tagSuccessFg: '#FFFFFF',
    tagSuccessBorder: 'transparent',
    tagEssenceBg: '#1C2330',
    tagEssenceFg: '#8792A6',
    tagEssenceBorder: 'transparent',
    tagEssenceNegBg: '#2A1514',
    tagEssenceNegFg: '#FF4D45',
    tagEssenceNegBorder: 'transparent',
    tagInfoBg: '#1B3350',
    tagInfoFg: '#FFFFFF',
    tagInfoBorder: 'transparent',
  },
  light: {
    scheme: 'light',
    canvas: '#F5F6F8',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceSoft: '#EEF1F4',
    line: '#E6E8EC',
    text: '#1B1F26',
    muted: '#5E6672',
    dim: '#8A919C',
    red: '#E1251B',
    redBright: '#E1251B',
    orange: '#C47B12',
    green: '#178F45',
    blue: '#2F6FE4',
    tabbar: '#FFFFFF',
    comment: '#3C4350',
    noticeBg: '#FFF6E8',
    codeBg: '#F4F6F8',
    videoBg: '#000000',
    codeText: '#2C3340',
    unreadBg: '#FFF8F6',
    successSoft: '#E9F7EF',
    rulesBg: '#FFF6E8',
    webStage: '#E8EAED',
    inlineCode: '#A16207',
    warmFill: '#FFF6E8',
    dangerFill: '#FFF1F0',
    filterActive: '#E1251B',
    fade: 'rgba(245,246,248,0)',
    toastBg: '#FFFFFF',
    toastFg: '#1B1F26',
    rail: '#FFFFFF',
    card: '#FFFFFF',
    searchPill: '#ECEEF1',
    skeleton: '#E8EAED',
    skeletonSoft: '#F0F2F5',
    kindReplyBg: '#E8F1FF',
    kindReplyFg: '#2F6FE4',
    kindMentionBg: '#F3E8FF',
    kindMentionFg: '#7C3AED',
    kindRewardBg: '#FFF4E0',
    kindRewardFg: '#C47B12',
    kindSystemBg: '#FFE8E6',
    kindSystemFg: '#E1251B',
    commentHighlightBg: '#EEFAF3',
    commentHighlightBar: 'transparent',
    commentPostedBg: '#F4F4F4',
    tagDefaultBg: '#EEF1F4',
    tagDefaultFg: '#3C4350',
    tagDefaultBorder: '#D5DAE0',
    tagDangerBg: '#FFE8E6',
    tagDangerFg: '#C01A12',
    tagDangerBorder: '#F5C4C0',
    tagWarningBg: '#FFF4E0',
    tagWarningFg: '#9A6B12',
    tagWarningBorder: '#F0D4A0',
    tagSuccessBg: '#E9F7EF',
    tagSuccessFg: '#15803D',
    tagSuccessBorder: '#B7E4C7',
    tagEssenceBg: '#EEF1F4',
    tagEssenceFg: '#5E6672',
    tagEssenceBorder: '#D5DAE0',
    tagEssenceNegBg: '#FFF1F0',
    tagEssenceNegFg: '#C01A12',
    tagEssenceNegBorder: '#F5C4C0',
    tagInfoBg: '#E8F1FF',
    tagInfoFg: '#2F6FE4',
    tagInfoBorder: '#C3D8F8',
  },
};

export const SCHEME_LABEL: Record<ColorScheme, string> = {
  dark: '深色',
  light: '浅色',
};

let scheme: ColorScheme = readBootScheme();
export let C: Palette = palettes[scheme];
Appearance.setColorScheme(scheme);

const listeners = new Set<() => void>();
const styleSyncers = new Set<() => void>();

/**
 * 渐变断点。
 *
 * 渐变（hero / 顶栏）不随深浅色切换，官方主色固定，所以这里单独放一处，
 * 避免在业务页面里散落 `#xxxxxx`。
 */
export const GRADIENTS = {
  /** 品牌红：签到未完成、插件首页等主色 hero。 */
  brand: ['#2A1210', '#7F1D18', '#E1251B'],
  /** 已完成态的绿。 */
  done: ['#10261A', '#14532D', '#16A34A'],
} as const satisfies Record<string, readonly [string, string, ...string[]]>;

export function getPalette() {
  return C;
}

export function getScheme() {
  return scheme;
}

export function subscribeTheme(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function registerStyleSync(fn: () => void) {
  styleSyncers.add(fn);
  return () => {
    styleSyncers.delete(fn);
  };
}

export function applyScheme(next: ColorScheme) {
  Appearance.setColorScheme(next);
  if (scheme === next && C.scheme === next) return;
  scheme = next;
  C = palettes[next];
  writeBootScheme(next);
  styleSyncers.forEach((fn) => fn());
  listeners.forEach((fn) => fn());
}
