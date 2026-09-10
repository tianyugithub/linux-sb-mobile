import {
  TITLE_DEFS,
  TITLE_RARITY_RANK,
  catalogTitleIn,
  isRoleTitle,
  parseAllCatalogTitles,
  parseDrawnTitleNames,
  sortTitlesByRarityDesc,
  stripGachaNews,
  titleRarityOf,
  type TitleRarity,
} from '../data/title-catalog';
import type {
  TitleDto,
  TitleForgeMaterialDto,
  TitleForgePageDto,
  TitleListingDto,
  TitleMarketMineDto,
  TitleMarketOrderDto,
  TitleMarketPageDto,
  TitleNewsDto,
  TitlePoolDto,
  TitleRecipeDto,
  TitleRecyclePageDto,
  TitleSellOptionDto,
} from '../types/api';
import { decodeEntities } from '../utils/entities';

function decode(text: string): string {
  return decodeEntities(text).replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function parsePointsAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const text = decode(String(raw)).replace(/,/g, '').replace(/\s/g, '').trim();
  const wan = text.match(/^([+-]?[\d.]+)万/);
  if (wan) {
    const n = Number(wan[1]) * 10000;
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  const n = Number(text.replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function parseAccountPoints(html: string, fallback = 0): number {
  const rank = html.match(/class="user-rank"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
  if (rank && /积分/.test(rank)) {
    return parsePointsAmount(rank.match(/积分\s*([\d,万.]+)/)?.[1]);
  }
  const labeled = html.match(/积分：\s*<strong>([^<]+)<\/strong>/)?.[1]
    ?? html.match(/我的积分\s*([\d,万.]+)/)?.[1]
    ?? html.match(/积分余额[^\d]*([\d,万.]+)/)?.[1];
  if (labeled) return parsePointsAmount(labeled);
  return fallback;
}

function rarityFrom(block: string, name = ''): TitleRarity {
  const raw = (block.match(/gacha-title-(ur|ssr|sr|n|r)\b/i)?.[1]
    || block.match(/gacha-result-(ur|ssr|sr|n|r)\b/i)?.[1]
    || block.match(/gacha-pull-10-(ur|ssr|sr|n|r)\b/i)?.[1]
    || block.match(/gacha-pool-rarity-(ur|ssr|sr|n|r)\b/i)?.[1]
    || '').toUpperCase();
  if (raw === 'UR' || raw === 'SSR' || raw === 'SR' || raw === 'R' || raw === 'N') return raw;
  return titleRarityOf(name);
}

function emptyTitle(name: string, rarity?: TitleRarity): TitleDto {
  const tier = rarity ?? titleRarityOf(name);
  return {
    id: '',
    name,
    rarity: tier,
    owned: false,
    equipped: false,
    desc: `${tier} 称号`,
    copies: 0,
    usable: 0,
    obtainedAt: '',
  };
}

export function parseGachaNews(html: string): TitleNewsDto[] {
  const track = html.match(/gacha-good-news-track">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/)?.[1] ?? '';
  const items: TitleNewsDto[] = [];
  const seen = new Set<string>();
  for (const hit of track.matchAll(/<b>([^<]+)<\/b>\s*抽到了\s*<em>([\s\S]*?)<\/em>/g)) {
    const user = decode(hit[1]).trim();
    const name = catalogTitleIn(decode(hit[2]));
    if (!user || !name) continue;
    const key = `${user}\0${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ user, name });
  }
  return items;
}

export function parseTitlePool(html: string): TitlePoolDto[] {
  const rows = [...html.matchAll(/gacha-pool-rarity-label">([^<]+)<\/div>\s*<div class="gacha-pool-rarity-count">([^<]+)<\/div>\s*<div class="gacha-pool-rarity-rate">([^<]+)/g)];
  return sortTitlesByRarityDesc(rows.map((row) => ({
    rarity: (['N', 'R', 'SR', 'SSR', 'UR'].includes(row[1].toUpperCase()) ? row[1].toUpperCase() : 'N') as TitleRarity,
    count: Number(String(row[2]).match(/\d+/)?.[0] ?? 0),
    rate: decode(row[3]).trim(),
  })));
}

export function parseCatalogTitles(html: string): TitleDto[] {
  const items: TitleDto[] = [];
  const seen = new Set<string>();
  const grid = html.match(/gacha-all-titles[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0] ?? html;
  for (const hit of grid.matchAll(/gacha-title-badge gacha-title-([a-z]+)[\s\S]{0,400}?gacha-title-name">([^<]+)/gi)) {
    const name = decode(hit[2]).trim();
    if (!name || seen.has(name) || isRoleTitle(name)) continue;
    seen.add(name);
    items.push(emptyTitle(name, rarityFrom(hit[0], name)));
  }
  TITLE_DEFS.forEach((item) => {
    if (!seen.has(item.name)) items.push(emptyTitle(item.name, item.rarity));
  });
  return sortTitlesByRarityDesc(items);
}

export function parseOwnedTitles(html: string): TitleDto[] {
  const items: TitleDto[] = [];
  const chunks = html.split(/class="gacha-profile-item/).slice(1);
  chunks.forEach((chunk) => {
    const name = catalogTitleIn(chunk.match(/gacha-title-name">([^<]+)/)?.[1] ?? '');
    if (!name) return;
    const gift = chunk.match(/gachaGiftModalOpen\((\{[\s\S]*?\})\)/);
    let id = chunk.match(/name="title_id"\s+value="(\d+)"/)?.[1] ?? '';
    if (!id && gift?.[1]) {
      try {
        const data = JSON.parse(decode(gift[1].replace(/&quot;/g, '"'))) as { id?: number };
        id = data.id ? String(data.id) : '';
      } catch {
        id = gift[1].match(/"id"\s*:\s*(\d+)/)?.[1] ?? '';
      }
    }
    const copies = Number(chunk.match(/[×x]\s*(\d+)/i)?.[1] ?? 1);
    items.push({
      id,
      name,
      rarity: rarityFrom(chunk, name),
      owned: true,
      equipped: /is-equipped|gacha-unequip-btn|已佩戴/.test(chunk),
      desc: decode(chunk.match(/gacha-profile-desc">([^<]+)/)?.[1] ?? `${titleRarityOf(name)} 称号`).trim(),
      copies: copies || 1,
      usable: copies || 1,
      obtainedAt: decode(chunk.match(/(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\s*获得/)?.[1] ?? '').trim(),
    });
  });
  return sortTitlesByRarityDesc(items);
}

type DrawCard = { name: string; fresh: boolean; count: number };

function drawResultScope(html: string): string {
  const start = html.search(/class="[^"]*(?:gacha-result-card|gacha-pull-10-grid|gacha-pull-100-grid|gacha-pull-10-item|gacha-pull-100-item)[^"]*"|class="gacha-result"/i);
  if (start < 0) return '';
  const rest = html.slice(start);
  const end = rest.search(/class="(?:gacha-result-actions|gacha-actions|gacha-pool-section|gacha-all-titles|gacha-internal-nav)[^"]*"/i);
  return rest.slice(0, end > 0 ? end : Math.min(rest.length, 80_000));
}

function splitDrawItems(html: string): string[] {
  const re = /<(div|article|li)[^>]*class="[^"]*(?:gacha-result-card|gacha-pull-10-item|gacha-pull-100-item)[^"]*"[^>]*>/gi;
  const starts: number[] = [];
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(html))) starts.push(hit.index);
  if (!starts.length) return html.trim() ? [html] : [];
  return starts.map((at, index) => html.slice(at, starts[index + 1] ?? at + 1800));
}

function quantityIn(block: string): number {
  const raw = block.match(/gacha-(?:result|pull-10|pull-100)-quantity"[^>]*>\s*[×x*]?\s*(\d+)/i)?.[1]
    ?? block.match(/[×x]\s*(\d+)/i)?.[1]
    ?? '1';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 1;
}

function cardsFromDrawHtml(html: string): DrawCard[] {
  const scope = drawResultScope(html);
  if (!scope) return [];
  const cards: DrawCard[] = [];
  const blocks = splitDrawItems(scope).filter((block) => /gacha-(?:result-card|pull-10-item|pull-100-item)/.test(block));
  for (const block of (blocks.length ? blocks : [scope])) {
    const name = catalogTitleIn(
      block.match(/gacha-(?:result|pull-10|pull-100)-name">([^<]+)/)?.[1]
        ?? block.match(/gacha-title-name">([^<]+)/)?.[1]
        ?? (blocks.length ? block : ''),
    );
    if (!name) continue;
    cards.push({
      name,
      fresh: /gacha-result-new|gacha-pull-10-new|gacha-pull-100-new|>\s*NEW\s*</i.test(block),
      count: quantityIn(block),
    });
  }
  if (cards.length) return cards;
  const names = [
    ...scope.matchAll(/gacha-(?:result|pull-10|pull-100)-name">([^<]+)/g),
    ...scope.matchAll(/gacha-title-name">([^<]+)/g),
  ].map((row) => catalogTitleIn(row[1])).filter(Boolean);
  return names.map((name) => ({ name, fresh: /gacha-(?:result|pull-10|pull-100)-new|>\s*NEW\s*</i.test(scope), count: 1 }));
}

function cardsFromDrawJson(json: Record<string, unknown> | null): DrawCard[] {
  if (!json) return [];
  const buckets: unknown[] = [];
  const push = (value: unknown) => {
    if (Array.isArray(value)) buckets.push(...value);
    else if (value && typeof value === 'object') {
      const rec = value as Record<string, unknown>;
      for (const key of ['items', 'titles', 'results', 'list', 'cards', 'data', 'records']) {
        if (rec[key] != null) push(rec[key]);
      }
    }
  };
  push(json);
  const cards: DrawCard[] = [];
  for (const item of buckets) {
    if (typeof item === 'string') {
      const name = catalogTitleIn(item) || parseAllCatalogTitles(item)[0] || '';
      if (name) cards.push({ name, fresh: /NEW|新/.test(item), count: 1 });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const raw = [rec.name, rec.title, rec.title_name, rec.label, rec.n].find((value) => typeof value === 'string') as string | undefined;
    const name = raw ? catalogTitleIn(raw) : '';
    if (!name) continue;
    const count = Number(rec.quantity ?? rec.count ?? rec.num ?? rec.qty ?? 1);
    cards.push({
      name,
      fresh: Boolean(rec.fresh || rec.is_new || rec.new),
      count: Number.isFinite(count) && count > 0 ? Math.min(count, 100) : 1,
    });
  }
  return cards;
}

export function parseDrawResult(
  html: string,
  flash: string,
  count: number,
  json?: Record<string, unknown> | null,
): { names: string[]; fresh: boolean[]; counts: number[] } {
  const body = stripGachaNews(html);
  let cards = cardsFromDrawHtml(body);
  if (!cards.length) cards = cardsFromDrawJson(json ?? null);
  if (!cards.length) {
    const extra = [
      flash,
      typeof json?.message === 'string' ? json.message : '',
      typeof json?.msg === 'string' ? json.msg : '',
    ].filter(Boolean).join('\n');
    if (extra.trim()) {
      const names = parseAllCatalogTitles(extra);
      const list = names.length ? names : parseDrawnTitleNames(extra);
      const fresh = /NEW|新获得|新称号/.test(extra);
      cards = list.map((name) => ({ name, fresh, count: 1 }));
    }
  }
  if (!cards.length) {
    parseDrawnTitleNames(body).forEach((name) => cards.push({ name, fresh: false, count: 1 }));
  }
  const limited = count === 1 ? cards.slice(0, 1) : cards;
  return {
    names: limited.map((item) => item.name),
    fresh: limited.map((item) => item.fresh),
    counts: limited.map((item) => item.count),
  };
}

export function parseForgePage(html: string): TitleForgePageDto {
  const recipes = [...html.matchAll(/data-gacha-forge-button="([^"]+)"[^>]*data-gacha-forge-cost="(\d+)"[^>]*data-gacha-forge-source="([^"]+)"[^>]*data-gacha-forge-target="([^"]+)"/g)]
    .map((row) => ({
      source: row[3].toUpperCase() as TitleRarity,
      target: row[4].toUpperCase() as TitleRarity,
      cost: Number(row[2] || 0),
      rarityKey: row[1],
    }));
  const materials: TitleForgeMaterialDto[] = [];
  for (const hit of html.matchAll(/<article class="gacha-operation-card">([\s\S]*?)<\/article>/g)) {
    const block = hit[1];
    const name = catalogTitleIn(block.match(/gacha-title-name">([^<]+)/)?.[1] ?? '');
    if (!name) continue;
    const id = block.match(/name="material_title_ids\[\]"[^>]*value="(\d+)"/)?.[1]
      || block.match(/value="(\d+)"[^>]*name="material_title_ids\[\]"/)?.[1]
      || '';
    const owned = Number(block.match(/拥有\s*(\d+)\s*个/)?.[1] ?? 0);
    const usable = Number(block.match(/data-gacha-forge-quantity="(\d+)"/)?.[1] ?? block.match(/可熔炼\s*(\d+)\s*个/)?.[1] ?? owned);
    const rarityKey = block.match(/data-gacha-forge-rarity="([^"]+)"/)?.[1] ?? '';
    materials.push({
      id,
      name,
      rarity: rarityFrom(block, name),
      desc: decode(block.match(/<p>([^<]+)<\/p>/)?.[1] ?? '').trim(),
      copies: owned || usable,
      usable,
      rarityKey,
    });
  }
  return { recipes, materials: sortTitlesByRarityDesc(materials) };
}

export function parseForgeGains(text: string): { names: string[]; counts: number[] } {
  const names: string[] = [];
  const counts: number[] = [];
  const hay = decode(String(text || '').replace(/<[^>]+>/g, ' '));
  const focus = hay.match(/熔炼获得[\s\S]{0,1200}/)?.[0] || hay;
  const listed = focus.split(/[：:]/).slice(1).join('：') || focus;
  for (const part of listed.split(/[、，,]/)) {
    const hit = part.match(/^\s*(.+?)\s*[x×X＊*]\s*(\d+)\s*[。.]?\s*$/);
    if (!hit) continue;
    const name = catalogTitleIn(hit[1]);
    if (!name) continue;
    names.push(name);
    counts.push(Math.max(1, Number(hit[2]) || 1));
  }
  if (!names.length) {
    parseAllCatalogTitles(listed).forEach((name) => {
      names.push(name);
      counts.push(1);
    });
  }
  return { names, counts };
}

export function parseRecyclePage(html: string): TitleRecyclePageDto {
  const price = Number(html.match(/data-gacha-recycle-price="(\d+)"/)?.[1] ?? html.match(/今日回收价：(\d+)/)?.[1] ?? 200);
  const items: TitleForgeMaterialDto[] = [];
  for (const hit of html.matchAll(/<article class="gacha-operation-card">([\s\S]*?)<\/article>/g)) {
    const block = hit[1];
    const name = catalogTitleIn(block.match(/gacha-title-name">([^<]+)/)?.[1] ?? '');
    if (!name) continue;
    const id = block.match(/name="recycle_title_ids\[\]"[^>]*value="(\d+)"/)?.[1]
      || block.match(/value="(\d+)"[^>]*name="recycle_title_ids\[\]"/)?.[1]
      || '';
    const owned = Number(block.match(/拥有\s*(\d+)\s*个/)?.[1] ?? 0);
    const usable = Number(block.match(/data-gacha-recycle-quantity="(\d+)"/)?.[1] ?? block.match(/可回收\s*(\d+)\s*个/)?.[1] ?? owned);
    items.push({
      id,
      name,
      rarity: rarityFrom(block, name),
      desc: decode(block.match(/<p>([^<]+)<\/p>/)?.[1] ?? '').trim(),
      copies: owned || usable,
      usable,
      rarityKey: 'ssr',
    });
  }
  return { price, items: sortTitlesByRarityDesc(items) };
}

export function parseRecipes(html: string): TitleRecipeDto[] {
  const recipes: TitleRecipeDto[] = [];
  for (const hit of html.matchAll(/<article class="gacha-recipe-card">([\s\S]*?)<\/article>/g)) {
    const block = hit[1];
    const target = catalogTitleIn(block.match(/gacha-title-name">([^<]+)/)?.[1] ?? '');
    const subtitle = decode(block.match(/gacha-recipe-target[\s\S]*?<strong>([^<]+)/)?.[1] ?? '').trim();
    const id = block.match(/name="recipe_id"\s+value="(\d+)"/)?.[1] ?? '';
    const ready = !/\sdisabled/.test(block.match(/<button[\s\S]*?>/)?.[0] ?? 'disabled');
    const materials = [...block.matchAll(/<(span)[^>]*class="(is-ready|is-missing)"[^>]*>([^<]+)<\/span>/g)].map((row) => {
      const label = decode(row[3]).trim();
      const qty = label.match(/^(.*)\s+(\d+)\/(\d+)$/);
      const name = catalogTitleIn(qty?.[1] ?? label);
      return {
        name,
        have: Number(qty?.[2] ?? 0),
        need: Number(qty?.[3] ?? 1),
        ready: row[2] === 'is-ready',
      };
    });
    materials.sort((a, b) => {
      const rarityDiff = (TITLE_RARITY_RANK[titleRarityOf(b.name)] ?? 0) - (TITLE_RARITY_RANK[titleRarityOf(a.name)] ?? 0);
      if (rarityDiff) return rarityDiff;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    recipes.push({
      id,
      name: target,
      subtitle,
      rarity: rarityFrom(block, target),
      ready,
      materials,
    });
  }
  return sortTitlesByRarityDesc(recipes);
}

export function parseMarketListings(html: string): TitleMarketPageDto {
  const items: TitleListingDto[] = [];
  for (const hit of html.matchAll(/<article class="gacha-market-card">([\s\S]*?)<\/article>/g)) {
    const block = hit[1];
    const name = catalogTitleIn(block.match(/gacha-title-name">([^<]+)/)?.[1] ?? '');
    if (!name) continue;
    const listingId = block.match(/name="listing_id"\s+value="(\d+)"/)?.[1] ?? '';
    const stock = Number(block.match(/剩余 <strong>(\d+)/)?.[1] ?? 0);
    const max = Number(
      block.match(/name="quantity"[^>]*\bmax="(\d+)"/)?.[1]
      ?? block.match(/\bmax="(\d+)"[^>]*name="quantity"/)?.[1]
      ?? stock
      ?? 1,
    );
    items.push({
      id: listingId,
      name,
      rarity: rarityFrom(block, name),
      price: parsePointsAmount(block.match(/data-gacha-market-price="([^"]+)"/)?.[1])
        || parsePointsAmount(block.match(/单价\s*<strong>([^<]+)/)?.[1]),
      stock: stock || max,
      remain: decode(block.match(/剩余时间 <strong>([^<]+)/)?.[1] ?? '').trim(),
      max: max || stock || 1,
    });
  }
  const total = Number(html.match(/共\s*(\d+)\s*条/)?.[1] ?? items.length);
  const pages = [...html.matchAll(/href="\/gacha_market\?[^"]*p=(\d+)/g)].map((row) => Number(row[1]));
  return { items, total, nextCursor: null, maxPage: pages.length ? Math.max(...pages) : 1 };
}

function marketNextCursor(html: string, current: number): string | null {
  const pages = [...html.matchAll(/(?:[?&]|amp;)p=(\d+)/g)].map((row) => Number(row[1]));
  const next = pages.find((page) => page === current + 1);
  return next ? String(next) : null;
}

export function parseMarketPage(html: string, page = 1): TitleMarketPageDto {
  const parsed = parseMarketListings(html);
  const nextCursor = marketNextCursor(html, page);
  return {
    ...parsed,
    nextCursor,
    maxPage: Math.max(page, parsed.maxPage ?? 1, nextCursor ? Number(nextCursor) : page),
  };
}

export function parseMarketMine(html: string): TitleMarketMineDto {
  const sellable: TitleSellOptionDto[] = [];
  const select = html.match(/<select name="title_id"[\s\S]*?<\/select>/)?.[0] ?? '';
  for (const hit of select.matchAll(/<option value="(\d+)"([^>]*)>([\s\S]*?)<\/option>/g)) {
    const attrs = hit[2];
    const name = catalogTitleIn(attrs.match(/data-title="([^"]+)"/)?.[1] ?? hit[3]);
    if (!name) continue;
    sellable.push({
      id: hit[1],
      name,
      rarity: (attrs.match(/data-rarity="([^"]+)"/)?.[1]?.toUpperCase() as TitleRarity) || titleRarityOf(name),
      usable: Number(hit[3].match(/可出售\s*(\d+)/)?.[1] ?? 1),
      priceLimit: parsePointsAmount(attrs.match(/data-price-limit="([^"]+)"/)?.[1]),
    });
  }
  const listings: TitleListingDto[] = [];
  html.split(/class="gacha-market-row"/).slice(1).forEach((block) => {
    const name = catalogTitleIn(block.match(/gacha-title-name">([^<]+)/)?.[1] ?? '');
    if (!name) return;
    const soldHit = block.match(/已售\s*(\d+)\s*\/\s*(\d+)/);
    listings.push({
      id: block.match(/#(\d+)/)?.[1] || block.match(/name="listing_id"\s+value="(\d+)"/)?.[1] || '',
      name,
      rarity: rarityFrom(block, name),
      price: parsePointsAmount(block.match(/data-gacha-market-price="([^"]+)"/)?.[1])
        || parsePointsAmount(block.match(/单价\s*<strong>([^<]+)/)?.[1])
        || parsePointsAmount(block.match(/单价\s*([\d,万.]+)/)?.[1]),
      stock: Number(soldHit?.[2] ?? 0),
      sold: Number(soldHit?.[1] ?? 0),
      remain: decode(block.match(/<small>([^<]*#\d+[^<]*)<\/small>/)?.[1] ?? '').trim(),
      status: decode(block.match(/<strong[^>]*>([^<]+)<\/strong>/)?.[1] ?? '').trim(),
      cancelPath: block.match(/action="(\/gacha_market_[a-z_]+)"/)?.[1] ?? '',
      max: 1,
    });
  });
  return { sellable: sortTitlesByRarityDesc(sellable), listings };
}

export function parseMarketOrders(html: string): TitleMarketOrderDto[] {
  const items: TitleMarketOrderDto[] = [];
  html.split(/class="gacha-market-row"/).slice(1).forEach((block) => {
    const name = catalogTitleIn(block.match(/gacha-title-name">([^<]+)/)?.[1] ?? '');
    if (!name) return;
    items.push({
      id: block.match(/订单\s*#(\d+)/)?.[1] ?? '',
      name,
      rarity: rarityFrom(block, name),
      quantity: parsePointsAmount(block.match(/(?:买入|卖出|售出)\s*([\d,]+)/)?.[1]) || 1,
      price: parsePointsAmount(block.match(/单价\s*<strong>([^<]+)/)?.[1])
        || parsePointsAmount(block.match(/单价\s*([\d,万.]+)/)?.[1]),
      amount: (() => {
        const raw = block.match(/([+-][\d,万.]+)\s*积分/)?.[1] ?? '0';
        const sign = raw.trim().startsWith('-') ? -1 : 1;
        return sign * parsePointsAmount(raw.replace(/^[+-]/, ''));
      })(),
      side: /卖出|售出/.test(block) && !/买入/.test(block) ? 'sell' : 'buy',
      at: decode(block.match(/#\d+\s*·\s*([^<]+)/)?.[1] ?? '').trim(),
    });
  });
  return items;
}

export function mergeTitleCatalog(catalog: TitleDto[], owned: TitleDto[], equippedName: string): TitleDto[] {
  const byName = new Map<string, TitleDto>();
  catalog.forEach((item) => byName.set(item.name, { ...item }));
  TITLE_DEFS.forEach((item) => {
    if (!byName.has(item.name)) byName.set(item.name, emptyTitle(item.name, item.rarity));
  });
  owned.forEach((item) => {
    const current = byName.get(item.name) ?? emptyTitle(item.name, item.rarity);
    byName.set(item.name, {
      ...current,
      ...item,
      owned: true,
      equipped: item.equipped || item.name === equippedName,
      desc: item.desc || current.desc,
    });
  });
  const merged = [...byName.values()];
  if (equippedName) merged.forEach((item) => {
    item.equipped = item.name === equippedName;
  });
  return sortTitlesByRarityDesc(merged);
}
