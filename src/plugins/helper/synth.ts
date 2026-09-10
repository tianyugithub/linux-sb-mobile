import type { NotificationDto } from '../../types/api';
import type { TitleRarity } from '../../data/title-catalog';

/**
 * 称号合成统计：只认「批量熔炼」与「配方合成」两类通知。
 *
 * 官方通知文案（脚本作者按真实文案整理）：
 *   批量熔炼消耗了 96 个 R 称号，批量熔炼获得 32 个 SR：万人迷 ×7、论坛之星 ×13 …
 *   合成了 UR 称号「非必要不抽奖」／获得了「万人迷」称号
 * 回收 / 售出 / 打赏 / 提及 / 抽奖 / 赠送 / 点赞 / 兑换一律不计，但要显示被过滤了多少条。
 */

export const RARITY_ORDER: TitleRarity[] = ['UR', 'SSR', 'SR', 'R', 'N'];

const CONSUME_PAIR_RE = /([\d,]+)\s*个\s*([A-Za-z]+)\s*(?:级)?\s*称号/g;
const GAIN_TOTAL_RE = /([\d,]+)\s*个\s*([A-Za-z]+)/;
const GAIN_ITEM_RE = /([^\s、，,。：:；;×xX*「」“”"]+)\s*[×xX*]\s*([\d,]+)/g;
const GAIN_QUOTED_AFTER_TITLE_RE = /称号\s*[「“"]([^」”"]+)[」”"]/;
const GAIN_QUOTED_RE = /[「“"]([^」”"]+)[」”"]/;
const GAIN_TITLE_RARITY_RE = /([A-Za-z]+)\s*称号\s*[「“"]/;

export type SynthGain = { name: string; rarity: TitleRarity | ''; count: number };
export type SynthEntry = {
  id: string;
  time: string;
  text: string;
  /** 消耗：稀有度 → 个数。 */
  consumed: { rarity: string; count: number }[];
  consumedTotal: number;
  /** 获得：称号名 + 级别 + 个数。 */
  gains: SynthGain[];
  gainTotal: number;
};

export type SynthSummary = {
  entries: SynthEntry[];
  count: number;
  consumedTotal: number;
  gainTotal: number;
  consumedByRarity: { rarity: string; count: number }[];
  gainsByName: SynthGain[];
  gainsByRarity: { rarity: string; count: number }[];
  filtered: number;
  range: string;
};

const SYNTH_RE = /熔炼|配方合成|合成/;

export function isSynthNotification(text: string): boolean {
  return SYNTH_RE.test(text) && /称号/.test(text);
}

function toInt(raw: string | undefined): number {
  return Number(String(raw ?? '').replace(/[,\s]/g, '')) || 0;
}

function normalizeRarity(raw: string): TitleRarity | '' {
  const value = String(raw || '').toUpperCase();
  return (RARITY_ORDER as string[]).includes(value) ? (value as TitleRarity) : '';
}

/** 一条通知 → 结构化合成记录；不是合成通知返回 null。 */
export function parseSynthNotification(
  text: string,
  id: string,
  time: string,
  rarityOf?: (name: string) => TitleRarity | '',
): SynthEntry | null {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  if (!isSynthNotification(body)) return null;

  // 消耗段：通知里可能在「消耗了 … 个 X 称号」之前还有别的内容，直接全量扫数量对
  const consumed: { rarity: string; count: number }[] = [];
  CONSUME_PAIR_RE.lastIndex = 0;
  let hit = CONSUME_PAIR_RE.exec(body);
  while (hit) {
    const rarity = hit[2].toUpperCase();
    if (RARITY_ORDER.includes(rarity as TitleRarity)) {
      const count = toInt(hit[1]);
      const exist = consumed.find((item) => item.rarity === rarity);
      if (exist) exist.count += count;
      else consumed.push({ rarity, count });
    }
    hit = CONSUME_PAIR_RE.exec(body);
  }

  // 获得段：优先「称号「xxx」」这种明确写法，其次「xxx ×N」列表
  const gains: SynthGain[] = [];
  const quoted = body.match(GAIN_QUOTED_AFTER_TITLE_RE)?.[1] ?? '';
  const quotedAny = quoted || body.match(GAIN_QUOTED_RE)?.[1] || '';
  const quotedRarity = normalizeRarity(body.match(GAIN_TITLE_RARITY_RE)?.[1] ?? '');
  if (quotedAny) {
    // 引号写法的个数只能紧跟引号取（「xxx」×3）；否则整段里第一个「N 个 X」其实是**消耗**段
    const quotedCount = toInt(body.match(/[「“"][^」”"]+[」”"]\s*[×xX*]\s*([\d,]+)/)?.[1]) || 1;
    gains.push({
      name: quotedAny,
      rarity: quotedRarity || rarityOf?.(quotedAny) || '',
      count: quotedCount,
    });
  }
  GAIN_ITEM_RE.lastIndex = 0;
  let item = GAIN_ITEM_RE.exec(body);
  while (item) {
    const name = item[1].trim();
    if (name && !gains.some((gain) => gain.name === name)) {
      gains.push({ name, rarity: rarityOf?.(name) || '', count: toInt(item[2]) });
    }
    item = GAIN_ITEM_RE.exec(body);
  }

  const gainTotalFromText = gains.reduce((sum, gain) => sum + gain.count, 0);
  const consumedTotal = consumed.reduce((sum, item) => sum + item.count, 0);
  if (!gains.length && !consumed.length) return null;
  return {
    id,
    time,
    text: body,
    consumed,
    consumedTotal,
    gains,
    gainTotal: gainTotalFromText,
  };
}

/** 把通知列表聚合成合成统计（含被过滤条数）。 */
export function summarizeSynth(
  items: NotificationDto[],
  rangeLabel: string,
  rarityOf?: (name: string) => TitleRarity | '',
): SynthSummary {
  const entries: SynthEntry[] = [];
  let filtered = 0;
  items.forEach((item) => {
    const entry = parseSynthNotification(item.text, item.id, item.createdAt, rarityOf);
    if (entry) entries.push(entry);
    else filtered += 1;
  });

  const consumedMap = new Map<string, number>();
  const gainNameMap = new Map<string, SynthGain>();
  entries.forEach((entry) => {
    entry.consumed.forEach((item) => consumedMap.set(item.rarity, (consumedMap.get(item.rarity) ?? 0) + item.count));
    entry.gains.forEach((gain) => {
      const key = gain.name;
      const exist = gainNameMap.get(key);
      if (exist) exist.count += gain.count;
      else gainNameMap.set(key, { ...gain });
    });
  });

  const rarityRank = (rarity: string) => {
    const index = RARITY_ORDER.indexOf(rarity as TitleRarity);
    return index === -1 ? 99 : index;
  };

  const consumedByRarity = [...consumedMap.entries()]
    .map(([rarity, count]) => ({ rarity, count }))
    .sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));

  const gainsByName = [...gainNameMap.values()]
    .sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || b.count - a.count)
    .slice(0, 30);

  const gainRarityMap = new Map<string, number>();
  [...gainNameMap.values()].forEach((gain) => {
    const key = gain.rarity || '未知';
    gainRarityMap.set(key, (gainRarityMap.get(key) ?? 0) + gain.count);
  });
  const gainsByRarity = [...gainRarityMap.entries()]
    .map(([rarity, count]) => ({ rarity, count }))
    .sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));

  return {
    entries: entries.slice().sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
    count: entries.length,
    consumedTotal: entries.reduce((sum, entry) => sum + entry.consumedTotal, 0),
    gainTotal: entries.reduce((sum, entry) => sum + entry.gainTotal, 0),
    consumedByRarity,
    gainsByName,
    gainsByRarity,
    filtered,
    range: rangeLabel,
  };
}
