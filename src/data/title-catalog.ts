import { C, getScheme, registerStyleSync, type ColorScheme } from '../theme/palette';

export type TitleRarity = 'N' | 'R' | 'SR' | 'SSR' | 'UR';

export type TitleDef = {
  name: string;
  rarity: TitleRarity;
  slug: string;
};

type TitleRarityLook = { color: string; bg: string; border: string; track: string };
type RoleTitleLook = { color: string; border: string; fill: string };

const TITLE_RARITY_THEME_BY_SCHEME: Record<ColorScheme, Record<TitleRarity, TitleRarityLook>> = {
  dark: {
    N: { color: '#D5DCE6', bg: '#1B212B', border: '#4B5565', track: '#8B95A6' },
    R: { color: '#4ADE80', bg: '#13261C', border: '#2F6B45', track: '#22C55E' },
    SR: { color: '#7EB6FF', bg: '#152033', border: '#3D6AA8', track: '#6FA8FF' },
    SSR: { color: '#F5C15A', bg: '#2A2114', border: '#B8892E', track: '#E7C15A' },
    UR: { color: '#E9D5FF', bg: '#241833', border: '#A855F7', track: '#C084FC' },
  },
  light: {
    N: { color: '#3F4A5A', bg: '#EEF1F4', border: '#C5CCD6', track: '#6B7280' },
    R: { color: '#15803D', bg: '#E7F6EC', border: '#86D4A5', track: '#16A34A' },
    SR: { color: '#1D4ED8', bg: '#E8F1FF', border: '#93C5FD', track: '#2563EB' },
    SSR: { color: '#B45309', bg: '#FFF6E8', border: '#E8B84A', track: '#D97706' },
    UR: { color: '#6D28D9', bg: '#F3E8FF', border: '#C4B5FD', track: '#7C3AED' },
  },
};

export let TITLE_RARITY_THEME = TITLE_RARITY_THEME_BY_SCHEME.dark;

const ROLE_TITLE_THEME_BY_SCHEME: Record<ColorScheme, Record<string, RoleTitleLook>> = {
  dark: {
    建设者: { color: '#F5C15A', border: '#B8892E', fill: 'rgba(184, 137, 46, 0.16)' },
    创作者: { color: '#FFB020', border: '#C56A12', fill: 'rgba(255, 130, 0, 0.16)' },
    伪装者: { color: '#94A3B8', border: '#4B5565', fill: 'rgba(75, 85, 101, 0.2)' },
    AI机器人: { color: '#94A3B8', border: '#4B5565', fill: 'rgba(75, 85, 101, 0.2)' },
    社区主理人: { color: '#F5C15A', border: '#B8892E', fill: 'rgba(184, 137, 46, 0.16)' },
    站长: { color: '#E9D5FF', border: '#A855F7', fill: 'rgba(168, 85, 247, 0.16)' },
  },
  light: {
    建设者: { color: '#8B5E10', border: '#D4A017', fill: '#FFF6E0' },
    创作者: { color: '#C0560C', border: '#E8942A', fill: '#FFF3E4' },
    伪装者: { color: '#4B5565', border: '#C5CCD6', fill: '#EEF1F4' },
    AI机器人: { color: '#4B5565', border: '#C5CCD6', fill: '#EEF1F4' },
    社区主理人: { color: '#8B5E10', border: '#D4A017', fill: '#FFF6E0' },
    站长: { color: '#6D28D9', border: '#C4B5FD', fill: '#F3E8FF' },
  },
};

export let ROLE_TITLE_THEME = ROLE_TITLE_THEME_BY_SCHEME.dark;

function syncTitleThemes() {
  const scheme = getScheme();
  TITLE_RARITY_THEME = TITLE_RARITY_THEME_BY_SCHEME[scheme];
  ROLE_TITLE_THEME = ROLE_TITLE_THEME_BY_SCHEME[scheme];
}

registerStyleSync(syncTitleThemes);
if (C.scheme === 'light') syncTitleThemes();

export const TITLE_DEFS: TitleDef[] = [
  { name: '萌新', rarity: 'N', slug: 'mengxin' },
  { name: '潜水员', rarity: 'N', slug: 'qianshuiyuan' },
  { name: '吃瓜群众', rarity: 'N', slug: 'chigua' },
  { name: '路人甲', rarity: 'N', slug: 'lurenjia' },
  { name: '打酱油的', rarity: 'N', slug: 'dajiangyou' },
  { name: '常客', rarity: 'R', slug: 'changke' },
  { name: '话题王', rarity: 'R', slug: 'huatiwang' },
  { name: '回复达人', rarity: 'R', slug: 'huifudaren' },
  { name: '夜猫子', rarity: 'R', slug: 'yemaozi' },
  { name: '表情包大户', rarity: 'R', slug: 'biaoqingbao' },
  { name: '反贼', rarity: 'R', slug: 'fanzei' },
  { name: '论坛之星', rarity: 'SR', slug: 'luntanzhixing' },
  { name: '万人迷', rarity: 'SR', slug: 'wanrenmi' },
  { name: '键盘侠', rarity: 'SR', slug: 'jianpanxia' },
  { name: '精华收割机', rarity: 'SR', slug: 'jinghuashouge' },
  { name: '社交达人', rarity: 'SR', slug: 'shejiaodaren' },
  { name: '欧皇', rarity: 'SSR', slug: 'ouhuang' },
  { name: '氪金大佬', rarity: 'SSR', slug: 'kejin' },
  { name: '传说之龙', rarity: 'SSR', slug: 'chuanqizhilong' },
  { name: '全站偶像', rarity: 'SSR', slug: 'quanzhanouxiang' },
  { name: '管理员之友', rarity: 'SSR', slug: 'guanliyuan' },
  { name: '隐藏大佬', rarity: 'SSR', slug: 'yincangdalao' },
  { name: '富可敌国', rarity: 'SSR', slug: 'fukediguo' },
  { name: '非必要不抽奖', rarity: 'UR', slug: 'feibiyabouchoujiang' },
  { name: '秩序破坏神', rarity: 'UR', slug: 'zhixupohuaishen' },
];

export const TITLE_SPECIALS: TitleDef[] = [
  { name: '真的站长', rarity: 'UR', slug: 'zhendezhangzhang' },
];

/** Higher number = higher rarity. Title-center grids sort UR → N. */
export const TITLE_RARITY_RANK: Record<TitleRarity, number> = {
  UR: 5,
  SSR: 4,
  SR: 3,
  R: 2,
  N: 1,
};

const TITLE_NAME_ORDER = new Map([...TITLE_DEFS, ...TITLE_SPECIALS].map((item, index) => [item.name, index]));

export function sortTitlesByRarityDesc<T extends { rarity: TitleRarity; name?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rarityDiff = (TITLE_RARITY_RANK[b.rarity] ?? 0) - (TITLE_RARITY_RANK[a.rarity] ?? 0);
    if (rarityDiff) return rarityDiff;
    return (TITLE_NAME_ORDER.get(a.name ?? '') ?? 999) - (TITLE_NAME_ORDER.get(b.name ?? '') ?? 999);
  });
}

/** Unsold identity / user-group titles. No medal, no rarity, no serial. */
export const ROLE_TITLES = ['创作者', '建设者', '伪装者', 'AI机器人', '社区主理人', '站长'] as const;

export function isRoleTitle(name?: string | null): boolean {
  const key = (name ?? '').trim();
  return (ROLE_TITLES as readonly string[]).includes(key);
}

const SHINE_ROLES = new Set(['建设者', '创作者']);

/** Sweeping shine: UR gacha titles, plus 建设者 / 创作者 identity badges. */
export function titleHasShine(name?: string | null, rarity?: TitleRarity): boolean {
  const title = (name ?? '').trim();
  if (!title) return false;
  if (SHINE_ROLES.has(title)) return true;
  if (isRoleTitle(title)) return false;
  return (rarity ?? titleRarityOf(title)) === 'UR';
}

export function roleTitleTheme(name?: string | null) {
  const key = (name ?? '').trim();
  return ROLE_TITLE_THEME[key] ?? ROLE_TITLE_THEME.伪装者;
}

export const TITLE_NAMES = TITLE_DEFS.map((item) => item.name).sort((a, b) => b.length - a.length);

const BY_NAME = new Map([...TITLE_DEFS, ...TITLE_SPECIALS].map((item) => [item.name, item]));

export function titleDef(name?: string | null): TitleDef | null {
  if (!name) return null;
  const key = name.trim();
  const exact = BY_NAME.get(key);
  if (exact) return exact;
  return TITLE_SPECIALS.find((item) => key.startsWith(item.name)) ?? null;
}

export function titleRarityOf(name?: string | null, fallback: TitleRarity = 'N'): TitleRarity {
  return titleDef(name)?.rarity ?? fallback;
}

export function catalogTitleIn(source: string): string {
  const text = source.replace(/<[^>]+>/g, ' ');
  return TITLE_NAMES.find((name) => text.includes(name)) ?? '';
}

/** Walk left-to-right and collect every catalog title, keeping duplicates. */
export function parseAllCatalogTitles(source: string): string[] {
  const text = source.replace(/<[^>]+>/g, ' ');
  const found: string[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = TITLE_NAMES.find((name) => text.startsWith(name, i));
    if (hit) {
      found.push(hit);
      i += hit.length;
    } else {
      i += 1;
    }
  }
  return found;
}

export function stripGachaNews(source: string): string {
  return source.replace(/<div class="gacha-good-news"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, ' ');
}

/** Parse title names from a flash/result snippet. Never scan the 喜报 ticker. */
export function parseDrawnTitleNames(source: string): string[] {
  const stripped = stripGachaNews(source);
  const fromCards = [
    ...stripped.matchAll(/gacha-result-name">([^<]+)/g),
    ...stripped.matchAll(/gacha-pull-10-name">([^<]+)/g),
    ...stripped.matchAll(/gacha-pull-100-name">([^<]+)/g),
  ]
    .map((row) => catalogTitleIn(row[1]))
    .filter(Boolean);
  if (fromCards.length) return fromCards;

  const flash = stripped.match(/__pageFlash\s*=\s*"((?:\\.|[^"\\])*)"/)?.[1]
    ?? stripped.match(/id="toast"[^>]*>([^<]+)/)?.[1]
    ?? '';
  const haystack = flash
    ? flash.replace(/\\"/g, '"')
    : stripped.replace(/<[^>]+>/g, ' ');
  if (!/抽到|获得称号|抽取结果|十连|百连|抽一次/.test(haystack)) return [];
  if (haystack.length > 2500 && !flash) {
    const found: string[] = [];
    const windows = [...haystack.matchAll(/抽到了[\s\S]{0,80}/g)].map((row) => row[0]);
    windows.forEach((chunk) => {
      const name = catalogTitleIn(chunk);
      if (name) found.push(name);
    });
    return found;
  }
  return parseAllCatalogTitles(haystack);
}
