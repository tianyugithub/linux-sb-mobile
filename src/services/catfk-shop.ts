import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/** linux.sb 烧饼兑换码店面（官网「购买兑换码」外链）。 */
export const CATFK_ORIGIN = 'https://catfk.com';
export const CATFK_SHOP_TOKEN = 'linuxsb';

const VISITOR_KEY = 'lsb.catfk.visitor';
const COOKIE_KEY = 'lsb.catfk.cookie';
const PENDING_KEY = 'lsb.catfk.pending';

export class ShopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShopError';
  }
}

export type ShopGoods = {
  goodsKey: string;
  name: string;
  price: number;
  stock: number;
  description: string;
  contactFormat: string;
};

export type ShopChannel = {
  id: number;
  name: string;
  showName: string;
  code: string;
};

export type ShopPendingOrder = {
  tradeNo: string;
  payurl: string;
  goodsKey: string;
  goodsName: string;
  amount: number;
  channelName: string;
  createdAt: number;
};

function webStore(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

async function readKey(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return webStore()?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeKey(key: string, value: string) {
  try {
    if (Platform.OS === 'web') {
      webStore()?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* ignore */
  }
}

async function deleteKey(key: string) {
  try {
    if (Platform.OS === 'web') {
      webStore()?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}

function newVisitorId() {
  return `lsb${Math.random().toString(36).slice(2, 11)}${Date.now().toString(36).slice(-4)}`;
}

let visitorId = '';
let cookieHeader = '';

export async function shopSessionReady() {
  if (!visitorId) visitorId = (await readKey(VISITOR_KEY)) || newVisitorId();
  await writeKey(VISITOR_KEY, visitorId);
  if (!cookieHeader) cookieHeader = (await readKey(COOKIE_KEY)) || '';
}

function rememberSetCookie(header: string | null) {
  if (!header) return;
  const parts = header.split(/,(?=\s*[\w-]+=)/);
  const kept: string[] = [];
  for (const part of parts) {
    const pair = part.split(';')[0]?.trim();
    if (!pair || !pair.includes('=')) continue;
    const name = pair.slice(0, pair.indexOf('=')).trim();
    if (/^(PHPSESSID|catfk)/i.test(name)) kept.push(pair);
  }
  if (!kept.length) return;
  cookieHeader = kept.join('; ');
  void writeKey(COOKIE_KEY, cookieHeader);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

async function shopPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  await shopSessionReady();
  const headers: Record<string, string> = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Visitorid: visitorId,
    Origin: CATFK_ORIGIN,
    Referer: `${CATFK_ORIGIN}/shop/${CATFK_SHOP_TOKEN}`,
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  let response: Response;
  try {
    response = await fetch(`${CATFK_ORIGIN}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ShopError(error instanceof Error ? error.message : '无法连接发卡店面');
  }
  rememberSetCookie(response.headers.get('set-cookie'));
  let json: Record<string, unknown> = {};
  try {
    json = asRecord(await response.json()) || {};
  } catch {
    json = {};
  }
  return json;
}

function shopOk(json: Record<string, unknown>, fallback: string): Record<string, unknown> {
  const code = Number(json.code);
  if (code === 1) return asRecord(json.data) ?? {};
  throw new ShopError(textOf(json.msg) || fallback);
}

export async function shopGoodsList(): Promise<ShopGoods[]> {
  const json = await shopPost('/shopApi/Shop/goodsList', {
    token: CATFK_SHOP_TOKEN,
    keywords: '',
    category_id: '',
    goods_type: 'card',
    current: 1,
    pageSize: 50,
  });
  const data = shopOk(json, '无法读取充值档位');
  const list = asList(data.list);
  const items = list.map((row) => {
    const item = asRecord(row) || {};
    const extend = asRecord(item.extend) || {};
    return {
      goodsKey: textOf(item.goods_key),
      name: textOf(item.name) || '烧饼兑换码',
      price: Number(item.price) || 0,
      stock: Number(extend.stock_count) || 0,
      description: textOf(item.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      contactFormat: textOf(item.contact_format) || 'any',
    };
  }).filter((item) => item.goodsKey);
  items.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, 'zh'));
  return items;
}

export async function shopChannels(): Promise<ShopChannel[]> {
  const json = await shopPost('/shopApi/Shop/getUserChannel', { token: CATFK_SHOP_TOKEN });
  if (Number(json.code) !== 1) throw new ShopError(textOf(json.msg) || '无法读取支付方式');
  const list = asList(json.data);
  return list.map((row) => {
    const item = asRecord(row) || {};
    return {
      id: Number(item.id) || 0,
      name: textOf(item.name),
      showName: textOf(item.show_name) || textOf(item.name) || '支付宝',
      code: textOf(item.code),
    };
  }).filter((item) => item.id > 0);
}

export async function shopCreateOrder(input: {
  goods: ShopGoods;
  channel: ShopChannel;
  contact: string;
}): Promise<ShopPendingOrder> {
  const json = await shopPost('/shopApi/Pay/order', {
    goods_key: input.goods.goodsKey,
    quantity: 1,
    coupon_code: '',
    channel_id: input.channel.id,
    contact: input.contact,
    query_password: '',
    select_cards_ids: [],
    extend: {},
  });
  if (Number(json.code) === 0) throw new ShopError(textOf(json.msg) || '下单失败');
  const data = asRecord(json.data);
  if (!data) throw new ShopError(textOf(json.msg) || '下单失败');
  const tradeNo = textOf(data.trade_no);
  const payurl = textOf(data.payurl);
  if (!tradeNo || !payurl) throw new ShopError('店面未返回支付链接');
  const amount = Number(data.total_amount ?? input.goods.price) || input.goods.price;
  const pending: ShopPendingOrder = {
    tradeNo,
    payurl: /^https?:\/\//i.test(payurl) ? payurl : `${CATFK_ORIGIN}${payurl.startsWith('/') ? payurl : `/${payurl}`}`,
    goodsKey: input.goods.goodsKey,
    goodsName: input.goods.name,
    amount,
    channelName: input.channel.showName,
    createdAt: Date.now(),
  };
  await savePendingOrder(pending);
  return pending;
}

/** 已支付返回 true；未支付返回 false。其它错误抛出。 */
export async function shopQueryPaid(tradeNo: string): Promise<boolean> {
  const json = await shopPost('/shopApi/Pay/query', { trade_no: tradeNo });
  if (Number(json.code) === 1) return true;
  const msg = textOf(json.msg);
  if (Number(json.code) === 0 && /not pay|未支付|未付款/i.test(msg || 'not pay')) return false;
  if (Number(json.code) === 0) return false;
  throw new ShopError(msg || '查询订单失败');
}

export type ShopOrderInfo = {
  status: number;
  cards: string[];
  goodsName: string;
};

function collectCardStrings(value: unknown, into: string[]) {
  if (!value) return;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim();
    if (text) into.push(text);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectCardStrings(item, into));
    return;
  }
  const row = asRecord(value);
  if (!row) return;
  for (const key of ['cards', 'card', 'content', 'secret', 'code', 'kami', 'card_no', 'card_secret']) {
    if (row[key] !== undefined) collectCardStrings(row[key], into);
  }
}

const CODE_RE = /\bSB-[A-Z0-9]{4}(?:-[A-Z0-9]{4})+\b/gi;

export function extractRedeemCodes(cards: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const take = (raw: string) => {
    const text = raw.replace(/\u00a0/g, ' ').trim();
    if (!text) return;
    const matches = text.match(CODE_RE);
    if (matches?.length) {
      matches.forEach((code) => {
        const next = code.toUpperCase();
        if (seen.has(next)) return;
        seen.add(next);
        found.push(next);
      });
      return;
    }
    const compact = text.replace(/\s+/g, '');
    if (compact.length < 4 || compact.length > 40) return;
    if (seen.has(compact)) return;
    seen.add(compact);
    found.push(compact);
  };
  cards.forEach(take);
  return found;
}

export async function shopOrderInfo(tradeNo: string): Promise<ShopOrderInfo> {
  const json = await shopPost('/shopApi/Order/info', { trade_no: tradeNo, dump: 1 });
  const data = shopOk(json, '无法读取订单');
  const response = asRecord(data.response) || {};
  const bag: string[] = [];
  collectCardStrings(response.cards ?? data.cards, bag);
  const goods = asRecord(data.goods) || {};
  return {
    status: Number(data.status) || 0,
    cards: bag,
    goodsName: textOf(data.goods_name) || textOf(goods.goods_name),
  };
}

export async function loadPendingOrder(): Promise<ShopPendingOrder | null> {
  const raw = await readKey(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ShopPendingOrder>;
    if (!parsed.tradeNo || !parsed.payurl) return null;
    return {
      tradeNo: String(parsed.tradeNo),
      payurl: String(parsed.payurl),
      goodsKey: String(parsed.goodsKey || ''),
      goodsName: String(parsed.goodsName || '烧饼兑换码'),
      amount: Number(parsed.amount) || 0,
      channelName: String(parsed.channelName || '支付宝'),
      createdAt: Number(parsed.createdAt) || 0,
    };
  } catch {
    return null;
  }
}

export async function savePendingOrder(order: ShopPendingOrder) {
  await writeKey(PENDING_KEY, JSON.stringify(order));
}

export async function clearPendingOrder() {
  await deleteKey(PENDING_KEY);
}
