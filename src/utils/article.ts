import { decodeEntities } from './entities';
import { redactSecrets } from './redact';

export type InlineSpan =
  | { type: 'text'; text: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'mention'; href: string; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'strike'; text: string }
  | { type: 'secret'; mask: string };

export type TableAlign = 'left' | 'center' | 'right';
export type TextAlign = 'left' | 'center' | 'right';

export type ArticleBlock =
  | { type: 'p'; spans: InlineSpan[]; align?: TextAlign }
  | { type: 'h'; level: number; spans: InlineSpan[]; align?: TextAlign }
  | { type: 'list'; ordered: boolean; items: InlineSpan[][]; align?: TextAlign }
  | { type: 'quote'; spans: InlineSpan[]; align?: TextAlign }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'image'; src: string; caption?: string; align?: TextAlign }
  | { type: 'table'; headers: InlineSpan[][]; rows: InlineSpan[][][]; aligns: TableAlign[] }
  | { type: 'video'; provider: VideoProvider; embed: string; url: string }
  | { type: 'spacer' }
  | { type: 'hr' }
  /**
   * 官网「回复可见」区块（编辑器 `[回复可见]…[/回复可见]`）。
   * 锁定态由服务端渲染，解锁后才有 inner blocks。
   */
  | {
    type: 'reply_visible';
    locked: boolean;
    label: string;
    notice: string;
    blocks: ArticleBlock[];
  };

/** 官网插入语法（plugins.js `insertReplyVisible`）。 */
export const REPLY_VISIBLE_OPEN = '[回复可见]';
export const REPLY_VISIBLE_CLOSE = '[/回复可见]';
/** 解锁后区块标题（`.nb-editor-reply-visible-label`）。 */
export const REPLY_VISIBLE_LABEL = '回复可见内容';
/** 锁定态标题 / 说明（`.nb-editor-reply-visible-notice`）。 */
export const REPLY_VISIBLE_LOCKED_TITLE = '回复后可见';
export const REPLY_VISIBLE_LOCKED_HINT = '回复本主题后即可查看这部分内容。';

/** 与官方 nb_editor 一致的三种视频来源。 */
export type VideoProvider = 'youtube' | 'bilibili' | 'douyin';

export const VIDEO_LABEL: Record<VideoProvider, string> = {
  youtube: 'YouTube视频',
  bilibili: '哔哩哔哩视频',
  douyin: '抖音视频',
};

function videoProviderOf(text: string): VideoProvider | null {
  if (/youtube|youtu\.be/i.test(text)) return 'youtube';
  if (/bilibili|b23\.tv/i.test(text)) return 'bilibili';
  if (/douyin/i.test(text)) return 'douyin';
  return null;
}

/** 官方编辑器插入的 markdown 链接标题 → 平台 */
function providerFromLabel(label: string): VideoProvider | null {
  const text = label.trim();
  if (text === VIDEO_LABEL.youtube) return 'youtube';
  if (text === VIDEO_LABEL.bilibili) return 'bilibili';
  if (text === VIDEO_LABEL.douyin) return 'douyin';
  return null;
}

/** 播放地址（iframe src）→ 可分享的规范地址 */
export function videoWatchUrl(provider: VideoProvider, embed: string): string {
  let parsed: URL;
  try {
    parsed = new URL(embed, 'https://linux.sb');
  } catch {
    return embed;
  }
  if (provider === 'youtube') {
    const id = parsed.pathname.match(/\/embed\/([0-9A-Za-z_-]{6,})/)?.[1] || parsed.searchParams.get('v') || '';
    return id ? `https://www.youtube.com/watch?v=${id}` : embed;
  }
  if (provider === 'bilibili') {
    const bvid = parsed.searchParams.get('bvid') || parsed.pathname.match(/video\/(BV[0-9A-Za-z]+)/)?.[1];
    if (bvid) return `https://www.bilibili.com/video/${bvid}`;
    const aid = parsed.searchParams.get('aid');
    return aid ? `https://www.bilibili.com/video/av${aid}` : embed;
  }
  const vid = parsed.searchParams.get('vid')
    || parsed.searchParams.get('video_id')
    || parsed.pathname.match(/video\/(\d{15,22})/)?.[1];
  return vid ? `https://www.douyin.com/video/${vid}` : embed;
}

/** 规范地址 → 播放地址（官方编辑器只存规范地址，播放地址由站点生成） */
export function videoEmbedUrl(provider: VideoProvider, watch: string): string {
  let parsed: URL;
  try {
    parsed = new URL(watch, 'https://linux.sb');
  } catch {
    return '';
  }
  if (provider === 'youtube') {
    const id = parsed.searchParams.get('v') || parsed.pathname.replace(/^\//, '');
    return /^[0-9A-Za-z_-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}?autoplay=0&playsinline=1&rel=0` : '';
  }
  if (provider === 'bilibili') {
    const bvid = parsed.pathname.match(/video\/(BV[0-9A-Za-z]+)/)?.[1];
    if (bvid) return `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=0`;
    const aid = parsed.pathname.match(/video\/av(\d+)/)?.[1];
    return aid ? `https://player.bilibili.com/player.html?aid=${aid}&autoplay=0` : '';
  }
  return '';
}

/** 从官方渲染出的 iframe 里取出视频块 */
function parseVideoEmbed(inner: string, tag: string): ArticleBlock | null {
  const frame = inner.match(/<iframe\b[^>]*>/i)?.[0] || tag;
  const embed = decodeEntities(attrOf(frame, 'src') || attrOf(frame, 'data-src'));
  if (!embed) return null;
  const provider = videoProviderOf(`${tag} ${embed}`);
  if (!provider) return null;
  return { type: 'video', provider, embed, url: videoWatchUrl(provider, embed) };
}

/** 只有「[YouTube视频](url)」这种整段单链接才算视频（与官方编辑器一致） */
function promoteVideoLinks(blocks: ArticleBlock[]): ArticleBlock[] {
  return blocks.map((block) => {
    if (block.type === 'reply_visible') {
      return { ...block, blocks: promoteVideoLinks(block.blocks) };
    }
    if (block.type !== 'p' || block.spans.length !== 1) return block;
    const span = block.spans[0];
    if (span.type !== 'link') return block;
    const provider = providerFromLabel(span.text) || videoProviderOf(span.href);
    if (!provider) return block;
    /**
     * 拿不到可播放的嵌入地址就保持原样（仍然是那个 markdown 链接）。
     * 抖音的 iframe 由官网服务端生成，App 算不出来；以前这里会写出 src="" 的
     * <iframe>，内核要求 src 非空会直接丢掉整个节点 → 富文本里视频消失、保存即丢失。
     */
    const embed = videoEmbedUrl(provider, span.href);
    if (!embed) return block;
    return { type: 'video', provider, embed, url: span.href };
  });
}

const SECRET_RE = /(•{4,}|\*{3}@\*{3}|\*{11,})/g;
const MD_INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~]+~~|!\[[^\]]*]\(https?:\/\/[^)\s]+\)|\[[^\]]+]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>"'）】》、，。；！？]+)/g;
const MENTION_LABEL_RE = /^@[^\s#]+ #\d+$/;
const PLAIN_MENTION_RE = /@[^\s#]+ #\d+/g;

export function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

function trimUrl(raw: string): string {
  return raw.replace(/[.,;:!?，。；！？]+$/g, '');
}

function attrOf(tag: string, name: string): string {
  const raw = tag.match(new RegExp(`${name}=["']([^"']+)["']`))?.[1] ?? '';
  return decodeEntities(raw);
}

function textAlignOf(tag: string): TextAlign | undefined {
  const hit = tag.match(/text-align\s*:\s*(left|center|right)/i)?.[1]
    || tag.match(/\balign=["'](left|center|right)["']/i)?.[1]
    || tag.match(/has-text-align-(left|center|right)/i)?.[1]
    || tag.match(/\balign(center|right|left)\b/i)?.[1];
  const value = (hit || '').toLowerCase();
  if (value === 'center' || value === 'right' || value === 'left') return value;
  return undefined;
}

function applyTextAlign(blocks: ArticleBlock[], start: number, align?: TextAlign) {
  if (!align || align === 'left') return;
  for (let i = start; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.type === 'p' || block.type === 'h' || block.type === 'quote' || block.type === 'list' || block.type === 'image') {
      blocks[i] = { ...block, align };
    }
  }
}

export function collectImageRun(blocks: ArticleBlock[], index: number): Extract<ArticleBlock, { type: 'image' }>[] | null {
  const block = blocks[index];
  if (!block || block.type !== 'image') return null;
  const packable = (item: ArticleBlock): item is Extract<ArticleBlock, { type: 'image' }> => (
    item.type === 'image' && (!item.align || item.align === 'left')
  );
  if (index > 0 && packable(blocks[index - 1]) && packable(block)) return null;
  if (!packable(block)) return [block];
  const group: Extract<ArticleBlock, { type: 'image' }>[] = [];
  for (let cursor = index; cursor < blocks.length; cursor += 1) {
    const item = blocks[cursor];
    if (!packable(item)) break;
    group.push(item);
  }
  return group;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function spansToHtml(spans: InlineSpan[]): string {
  return spans.map((span) => {
    if (span.type === 'text') return escapeHtml(span.text).replace(/\n/g, '<br>');
    if (span.type === 'strong') return `<strong>${escapeHtml(span.text)}</strong>`;
    if (span.type === 'em') return `<em>${escapeHtml(span.text)}</em>`;
    if (span.type === 'strike') return `<s>${escapeHtml(span.text)}</s>`;
    if (span.type === 'code') return `<code>${escapeHtml(span.text)}</code>`;
    if (span.type === 'link') return `<a href="${escapeHtml(span.href)}">${escapeHtml(span.text)}</a>`;
    if (span.type === 'mention') return escapeHtml(span.text);
    return escapeHtml(span.mask);
  }).join('');
}

function isMentionChrome(tag: string, href: string, label: string): boolean {
  if (/class="[^"]*post-(?:floor-)?mention/i.test(tag)) return true;
  if (/class="[^"]*post-floor\b/i.test(tag) && /[?&]floor=/i.test(href)) return true;
  return MENTION_LABEL_RE.test(label) && /[?&](?:replyid|floor)=/i.test(href);
}

function splitPlainMentions(text: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  PLAIN_MENTION_RE.lastIndex = 0;
  let last = 0;
  let hit: RegExpExecArray | null;
  while ((hit = PLAIN_MENTION_RE.exec(text))) {
    if (hit.index > last) out.push(...splitSecrets(text.slice(last, hit.index)));
    const floor = hit[0].match(/#(\d+)\s*$/)?.[1] || '';
    out.push({ type: 'mention', href: floor ? `?floor=${floor}` : '', text: hit[0] });
    last = hit.index + hit[0].length;
  }
  if (last < text.length) out.push(...splitSecrets(text.slice(last)));
  return out.length ? out : splitSecrets(text);
}

export function stripPostMentions(html: string): string {
  if (!html) return '';
  return html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (tag) => {
    const href = attrOf(tag, 'href');
    const label = decodeEntities(tag.replace(/<[^>]+>/g, '')).trim();
    return isMentionChrome(tag, href, label) ? '' : tag;
  });
}

function hasVisibleSpan(spans: InlineSpan[]): boolean {
  return spans.some((span) => span.type !== 'text' || span.text.trim());
}

function splitSecrets(text: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  text.split(SECRET_RE).forEach((part) => {
    if (!part) return;
    if (/^(•{4,}|\*{3}@\*{3}|\*{11,})$/.test(part)) {
      out.push({ type: 'secret', mask: part });
      return;
    }
    out.push({ type: 'text', text: part });
  });
  return out;
}

function stripKeepText(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, '').replace(/<[^>]+>/g, '');
}

function parseInlines(html: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const re = /<(a|strong|b|em|i|code|s|del|strike)(\s[^>]*)?>([\s\S]*?)<\/\1>|<br\s*\/?>/gi;
  let last = 0;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(html))) {
    if (hit.index > last) spans.push(...parseMdInlines(stripKeepText(html.slice(last, hit.index))));
    const tag = hit[1]?.toLowerCase();
    if (!tag) {
      spans.push({ type: 'text', text: '\n' });
    } else if (tag === 'a') {
      const href = attrOf(hit[0], 'href');
      const label = decodeEntities(String(hit[3] ?? '').replace(/<[^>]+>/g, '')).trim();
      if (isMentionChrome(hit[0], href, label) && label) {
        spans.push({ type: 'mention', href, text: label });
      } else if (!label) {
        /* empty leftover <a href> — never dump the URL */
      } else if (href) {
        spans.push({ type: 'link', href, text: label });
      } else {
        spans.push(...parseMdInlines(label));
      }
    } else if (tag === 'code') {
      spans.push({ type: 'code', text: decodeEntities(hit[3] ?? '') });
    } else if (tag === 'strong' || tag === 'b') {
      spans.push({ type: 'strong', text: decodeEntities(String(hit[3] ?? '').replace(/<[^>]+>/g, '')) });
    } else if (tag === 's' || tag === 'del' || tag === 'strike') {
      spans.push({ type: 'strike', text: decodeEntities(String(hit[3] ?? '').replace(/<[^>]+>/g, '')) });
    } else {
      spans.push({ type: 'em', text: decodeEntities(String(hit[3] ?? '').replace(/<[^>]+>/g, '')) });
    }
    last = hit.index + hit[0].length;
  }
  if (last < html.length) spans.push(...parseMdInlines(stripKeepText(html.slice(last))));
  return spans.filter((span) => span.type !== 'text' || span.text.length > 0);
}

function imageSrc(tag: string): string {
  return attrOf(tag, 'data-src') || attrOf(tag, 'src');
}

function imageCaption(tag: string): string | undefined {
  const caption = decodeEntities(attrOf(tag, 'alt')).trim();
  return caption || undefined;
}

function langFromTag(tag: string): string {
  return (
    tag.match(/\b(?:language|lang)-([a-zA-Z0-9_+-]+)/i)?.[1]
    || attrOf(tag, 'data-lang')
    || attrOf(tag, 'data-language')
    || ''
  );
}

function isRealTag(html: string, at: number, tag: string): boolean {
  const ch = html[at + 1 + tag.length];
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '>' || ch === '/';
}

function extractBalanced(html: string, start: number, tag: string): { end: number; inner: string } {
  const gt = html.indexOf('>', start);
  if (gt < 0) return { end: html.length, inner: html.slice(start) };
  let depth = 1;
  let i = gt + 1;
  const openNeedle = `<${tag}`;
  const closeNeedle = `</${tag}>`;
  while (i < html.length && depth > 0) {
    const close = html.indexOf(closeNeedle, i);
    if (close < 0) return { end: html.length, inner: html.slice(gt + 1) };
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
    if (depth === 0) return { end: i, inner: html.slice(gt + 1, close) };
  }
  return { end: html.length, inner: html.slice(gt + 1) };
}

function asMarkdownSource(inner: string): string {
  return decodeEntities(
    inner
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${decodeEntities(code)}\``)
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, text) => `**${decodeEntities(String(text).replace(/<[^>]+>/g, ''))}**`)
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, text) => `*${decodeEntities(String(text).replace(/<[^>]+>/g, ''))}*`)
      .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (tag) => {
        const href = attrOf(tag, 'href');
        const label = decodeEntities(tag.replace(/<[^>]+>/g, '')).trim();
        if (isMentionChrome(tag, href, label)) return label ? `${label} ` : '';
        return href && label !== href ? `[${label}](${href})` : label;
      })
      .replace(/<[^>]+>/g, ''),
  );
}

function looksLikeMarkdownBlocks(text: string): boolean {
  return /^(#{1,3}\s+\S|[-*]\s+\S|\d+\.\s+\S|>\s+\S|```|\|.+\||!\[[^\]]*]\(https?:\/\/)/m.test(text.trim())
    || looksLikeMarkdownTable(text);
}

function splitPipeRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

function isSepCell(cell: string): boolean {
  return /^:?-{1,}:?$/.test(cell.replace(/\s/g, '')) && cell.includes('-');
}

function isSepRow(line: string): boolean {
  const cells = splitPipeRow(line);
  return cells.length >= 1 && cells.every(isSepCell);
}

function isPipeRow(line: string): boolean {
  const text = line.trim();
  if (!text.includes('|')) return false;
  if (isSepRow(text)) return false;
  return splitPipeRow(text).length >= 1;
}

function alignOf(cell: string): TableAlign {
  const text = cell.trim();
  const left = text.startsWith(':');
  const right = text.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

function looksLikeMarkdownTable(text: string): boolean {
  const lines = text.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length >= 2 && isPipeRow(lines[0]) && isSepRow(lines[1]);
}

function padRow<T>(row: T[], size: number, fill: () => T): T[] {
  if (row.length >= size) return row.slice(0, size);
  return [...row, ...Array.from({ length: size - row.length }, fill)];
}

function consumeMarkdownTable(lines: string[], start: number): { block: ArticleBlock; next: number } | null {
  let index = start;
  while (index < lines.length && !lines[index].trim()) index += 1;
  if (index + 1 >= lines.length) return null;
  if (!isPipeRow(lines[index]) || !isSepRow(lines[index + 1])) return null;
  const headers = splitPipeRow(lines[index]).map((cell) => parseMdInlines(cell));
  const aligns = splitPipeRow(lines[index + 1]).map(alignOf);
  const rows: InlineSpan[][][] = [];
  let cursor = index + 2;
  while (cursor < lines.length && isPipeRow(lines[cursor])) {
    rows.push(splitPipeRow(lines[cursor]).map((cell) => parseMdInlines(cell)));
    cursor += 1;
  }
  const width = Math.max(headers.length, aligns.length, ...rows.map((row) => row.length), 1);
  return {
    block: {
      type: 'table',
      headers: padRow(headers, width, () => []),
      rows: rows.map((row) => padRow(row, width, () => [])),
      aligns: padRow(aligns, width, () => 'left' as TableAlign),
    },
    next: cursor,
  };
}

function parseHtmlTable(html: string): ArticleBlock | null {
  const rows: InlineSpan[][][] = [];
  const aligns: TableAlign[] = [];
  const re = /<tr\b/gi;
  let index = 0;
  while (index < html.length) {
    re.lastIndex = index;
    const hit = re.exec(html);
    if (!hit) break;
    const extracted = extractBalanced(html, hit.index, 'tr');
    const cells: InlineSpan[][] = [];
    const cellRe = /<(th|td)\b[^>]*>/gi;
    let cursor = 0;
    while (cursor < extracted.inner.length) {
      cellRe.lastIndex = cursor;
      const cellHit = cellRe.exec(extracted.inner);
      if (!cellHit) break;
      const tag = cellHit[1].toLowerCase();
      const cell = extractBalanced(extracted.inner, cellHit.index, tag);
      const col = cells.length;
      const align = textAlignOf(cellHit[0]) || 'left';
      if (!aligns[col]) aligns[col] = align;
      cells.push(parseInlines(cell.inner));
      // colspan：占位补空格，否则这一行后面的列会整体左移、竖线对不齐
      const span = Math.min(12, Math.max(1, Number(attrOf(cellHit[0], 'colspan') || 1) || 1));
      for (let extra = 1; extra < span; extra += 1) {
        const at = cells.length;
        if (!aligns[at]) aligns[at] = align;
        cells.push([]);
      }
      cursor = Math.max(cell.end, cellHit.index + 1);
    }
    if (cells.length) rows.push(cells);
    index = Math.max(extracted.end, hit.index + 1);
  }
  if (!rows.length) return null;
  const width = Math.max(...rows.map((row) => row.length), 1);
  const headers = padRow(rows[0], width, () => []);
  const body = rows.slice(1).map((row) => padRow(row, width, () => []));
  return {
    type: 'table',
    headers,
    rows: body,
    aligns: Array.from({ length: width }, (_, col) => aligns[col] || 'left'),
  };
}

function isBlankHtml(inner: string): boolean {
  if (/<img\b/i.test(inner)) return false;
  const text = stripKeepText(inner).replace(/&nbsp;/gi, ' ').replace(/\u00a0/g, ' ').trim();
  return !text;
}

function pushParagraph(blocks: ArticleBlock[], inner: string) {
  const chunks = inner.split(/(<img\b[^>]*>)/gi);
  chunks.forEach((chunk) => {
    if (!chunk) return;
    if (/^<img\b/i.test(chunk)) {
      const src = imageSrc(chunk);
      if (src) blocks.push({ type: 'image', src, caption: imageCaption(chunk) });
      return;
    }
    const mdSource = asMarkdownSource(chunk);
    if (looksLikeMarkdownTable(mdSource) || looksLikeMarkdownBlocks(mdSource)) {
      parseMarkdownArticle(mdSource).forEach((block) => blocks.push(block));
      return;
    }
    const spans = parseInlines(chunk);
    if (hasVisibleSpan(spans)) blocks.push({ type: 'p', spans });
  });
}

function pushList(blocks: ArticleBlock[], inner: string, ordered: boolean) {
  const items: InlineSpan[][] = [];
  const images: Array<Extract<ArticleBlock, { type: 'image' }>> = [];
  const re = /<li\b/gi;
  let i = 0;
  while (i < inner.length) {
    re.lastIndex = i;
    const hit = re.exec(inner);
    if (!hit) break;
    const extracted = extractBalanced(inner, hit.index, 'li');
    [...extracted.inner.matchAll(/<img\b[^>]*>/gi)].forEach((row) => {
      const src = imageSrc(row[0]);
      if (src) images.push({ type: 'image', src, caption: imageCaption(row[0]) });
    });
    const spans = parseInlines(extracted.inner);
    if (hasVisibleSpan(spans)) items.push(spans);
    i = Math.max(extracted.end, hit.index + 1);
  }
  if (items.length) blocks.push({ type: 'list', ordered, items });
  images.forEach((image) => blocks.push(image));
}

function parseReplyVisibleHtml(openTag: string, inner: string): ArticleBlock {
  const locked = /nb-editor-reply-visible-locked/.test(openTag);
  if (locked) {
    const title = decodeEntities(stripKeepText(inner.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || '')).trim()
      || REPLY_VISIBLE_LOCKED_TITLE;
    const notice = decodeEntities(stripKeepText(
      inner.match(/<strong\b[^>]*>[\s\S]*?<\/strong>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '',
    )).trim() || REPLY_VISIBLE_LOCKED_HINT;
    return { type: 'reply_visible', locked: true, label: title, notice, blocks: [] };
  }
  const label = decodeEntities(stripKeepText(
    inner.match(/nb-editor-reply-visible-label[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '',
  )).trim() || REPLY_VISIBLE_LABEL;
  const body = inner
    .replace(/<div\b[^>]*class="[^"]*nb-editor-reply-visible-label[^"]*"[^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/<div\b[^>]*class="[^"]*nb-editor-reply-visible-notice[^"]*"[^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/<\/?div\b[^>]*class="[^"]*nb-editor-reply-visible-body[^"]*"[^>]*>/gi, '');
  return {
    type: 'reply_visible',
    locked: false,
    label,
    notice: '',
    blocks: parseHtmlArticle(body),
  };
}

function parseHtmlArticle(html: string): ArticleBlock[] {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const blocks: ArticleBlock[] = [];
  const re = /<(p|h[1-6]|ul|ol|blockquote|pre|table|hr|figure)\b[^>]*>|<img\b[^>]*>|<iframe\b[^>]*>|<section\b[^>]*class=["'][^"']*nb-editor-reply-visible[^"']*["'][^>]*>|<div\b[^>]*class=["'][^"']*(?:markdown-table-wrap|nb-editor-blank-spacer|nb-editor-youtube|nb-editor-bilibili|nb-editor-douyin)[^"']*["'][^>]*>/gi;
  let last = 0;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(cleaned))) {
    const between = cleaned.slice(last, hit.index).trim();
    if (between && /[^\s<>]/.test(stripKeepText(between))) {
      pushParagraph(blocks, between);
    }
    if (/^<img\b/i.test(hit[0])) {
      const src = imageSrc(hit[0]);
      if (src) blocks.push({ type: 'image', src, caption: imageCaption(hit[0]) });
      last = hit.index + hit[0].length;
      continue;
    }
    if (/^<hr\b/i.test(hit[0])) {
      blocks.push({ type: 'hr' });
      last = hit.index + hit[0].length;
      continue;
    }
    if (/^<section\b/i.test(hit[0])) {
      const extracted = extractBalanced(cleaned, hit.index, 'section');
      blocks.push(parseReplyVisibleHtml(hit[0], extracted.inner));
      last = extracted.end;
      re.lastIndex = last;
      continue;
    }
    const tag = (hit[1] || 'div').toLowerCase();
    const extracted = extractBalanced(cleaned, hit.index, tag);
    const inner = extracted.inner;
    if (/nb-editor-(youtube|bilibili|douyin)/.test(hit[0]) || /^<iframe\b/i.test(hit[0])) {
      const video = parseVideoEmbed(inner, hit[0]);
      if (video) blocks.push(video);
    } else if (/nb-editor-blank-spacer/.test(hit[0])) {
      blocks.push({ type: 'spacer' });
    } else if (tag === 'figure') {
      const img = inner.match(/<img\b[^>]*>/i)?.[0] || '';
      const src = img ? imageSrc(img) : '';
      if (src) {
        const captionTag = inner.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
        const caption = captionTag
          ? decodeEntities(stripKeepText(captionTag[1])).trim()
          : (imageCaption(img) || '');
        blocks.push({ type: 'image', src, caption: caption || undefined, align: textAlignOf(hit[0]) });
      } else {
        parseHtmlArticle(inner).forEach((block) => blocks.push(block));
      }
    } else if (tag === 'table' || /markdown-table-wrap/.test(hit[0])) {
      const table = parseHtmlTable(inner);
      if (table) blocks.push(table);
    } else if (tag === 'pre') {
      const codeOpen = inner.match(/<code\b[^>]*>/i)?.[0] || '';
      const lang = langFromTag(codeOpen) || langFromTag(hit[0]);
      const code = decodeEntities(inner.replace(/<\/?code[^>]*>/gi, '')).replace(/^\n/, '').replace(/\s+$/, '');
      blocks.push({ type: 'code', text: code, lang: lang || undefined });
    } else if (tag.startsWith('h')) {
      const heading: ArticleBlock = { type: 'h', level: Number(tag.slice(1)) || 2, spans: parseInlines(inner) };
      const start = blocks.length;
      blocks.push(heading);
      applyTextAlign(blocks, start, textAlignOf(hit[0]));
    } else if (tag === 'blockquote') {
      const start = blocks.length;
      blocks.push({ type: 'quote', spans: parseInlines(inner) });
      applyTextAlign(blocks, start, textAlignOf(hit[0]));
    } else if (tag === 'ul' || tag === 'ol') {
      const start = blocks.length;
      pushList(blocks, inner, tag === 'ol');
      applyTextAlign(blocks, start, textAlignOf(hit[0]));
    } else if (tag === 'p' && /<(table|div|ul|ol|pre|blockquote|h[1-6])\b/i.test(inner)) {
      parseHtmlArticle(inner).forEach((block) => blocks.push(block));
    } else if (tag === 'p' && isBlankHtml(inner)) {
      blocks.push({ type: 'p', spans: [] });
    } else {
      const start = blocks.length;
      pushParagraph(blocks, inner);
      applyTextAlign(blocks, start, textAlignOf(hit[0]));
    }
    last = extracted.end;
    re.lastIndex = last;
  }
  const rest = cleaned.slice(last).trim();
  if (rest && /[^\s<>]/.test(stripKeepText(rest))) pushParagraph(blocks, rest);
  return blocks;
}

function parseMdInlines(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  MD_INLINE_RE.lastIndex = 0;
  let last = 0;
  let hit: RegExpExecArray | null;
  while ((hit = MD_INLINE_RE.exec(text))) {
    if (hit.index > last) spans.push(...splitPlainMentions(text.slice(last, hit.index)));
    const token = hit[0];
    if (token.startsWith('`')) {
      spans.push({ type: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('**') || token.startsWith('__')) {
      spans.push({ type: 'strong', text: token.slice(2, -2) });
    } else if (token.startsWith('~~')) {
      spans.push({ type: 'strike', text: token.slice(2, -2) });
    } else if (token.startsWith('*') || token.startsWith('_')) {
      spans.push({ type: 'em', text: token.slice(1, -1) });
    } else if (token.startsWith('![')) {
      const md = token.match(/^!\[[^\]]*]\((https?:\/\/[^)\s]+)\)$/);
      if (md) spans.push({ type: 'link', href: md[1], text: md[1] });
    } else if (token.startsWith('[')) {
      const md = token.match(/^\[([^\]]+)]\((https?:\/\/[^)\s]+)\)$/);
      if (md) spans.push({ type: 'link', href: md[2], text: md[1] });
    } else if (token.startsWith('http')) {
      const href = trimUrl(token);
      spans.push({ type: 'link', href, text: href });
    }
    last = hit.index + token.length;
  }
  if (last < text.length) spans.push(...splitPlainMentions(text.slice(last)));
  return spans.filter((span) => span.type !== 'text' || span.text.length > 0);
}

const UL_LINE_RE = /^\s*[-*](?:\s+|$)/;
const OL_LINE_RE = /^\s*\d+\.(?:\s+|$)/;

function emitMarkdownParagraph(blocks: ArticleBlock[], paragraph: string) {
  const trimmed = paragraph.replace(/^\n+|\n+$/g, '');
  if (!trimmed.trim()) return;
  if (/^---+$/.test(trimmed.trim()) || /^\*\*\*+$/.test(trimmed.trim())) {
    blocks.push({ type: 'hr' });
    return;
  }
  const table = consumeMarkdownTable(trimmed.split('\n'), 0);
  if (table) {
    blocks.push(table.block);
    return;
  }
  const lines = trimmed.split('\n');
  if (lines.every((line) => UL_LINE_RE.test(line))) {
    blocks.push({
      type: 'list',
      ordered: false,
      items: lines.map((line) => parseMdInlines(line.replace(/^\s*[-*]\s*/, ''))),
    });
    return;
  }
  if (lines.every((line) => OL_LINE_RE.test(line))) {
    blocks.push({
      type: 'list',
      ordered: true,
      items: lines.map((line) => parseMdInlines(line.replace(/^\s*\d+\.\s*/, ''))),
    });
    return;
  }
  const headingLine = lines[0].match(/^(#{1,3})(?:\s+(.*))?$/);
  if (headingLine && lines.length > 1) {
    blocks.push({ type: 'h', level: headingLine[1].length, spans: parseMdInlines(headingLine[2] || '') });
    emitMarkdownParagraph(blocks, lines.slice(1).join('\n'));
    return;
  }
  const heading = trimmed.match(/^(#{1,3})(?:\s+(.*))?$/);
  if (heading) {
    blocks.push({ type: 'h', level: heading[1].length, spans: parseMdInlines(heading[2] || '') });
    return;
  }
  if (/^>\s?/.test(trimmed)) {
    blocks.push({ type: 'quote', spans: parseMdInlines(trimmed.replace(/^>\s?/gm, '')) });
    return;
  }
  const imageOnly = trimmed.match(/^!\[([^\]]*)]\((https?:\/\/[^\s)]+)\)$/);
  if (imageOnly) {
    blocks.push({ type: 'image', src: imageOnly[2], caption: imageOnly[1].trim() || undefined });
    return;
  }
  if (/!\[[^\]]*]\(https?:\/\/[^\s)]+\)/.test(trimmed)) {
    const imageRe = /!\[([^\]]*)]\((https?:\/\/[^\s)]+)\)/g;
    let cursor = 0;
    let imageHit: RegExpExecArray | null;
    while ((imageHit = imageRe.exec(trimmed))) {
      const before = trimmed.slice(cursor, imageHit.index).trim();
      if (before) {
        const spans = parseMdInlines(before);
        if (hasVisibleSpan(spans)) blocks.push({ type: 'p', spans });
      }
      blocks.push({ type: 'image', src: imageHit[2], caption: imageHit[1].trim() || undefined });
      cursor = imageHit.index + imageHit[0].length;
    }
    const after = trimmed.slice(cursor).trim();
    if (after) {
      const spans = parseMdInlines(after);
      if (hasVisibleSpan(spans)) blocks.push({ type: 'p', spans });
    }
    return;
  }
  const spans = parseMdInlines(trimmed);
  if (hasVisibleSpan(spans)) blocks.push({ type: 'p', spans });
}

function parseMarkdownArticle(source: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const re = /\[回复可见\][ \t]*\r?\n?([\s\S]*?)\[\/回复可见\]/g;
  let last = 0;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(source))) {
    const before = source.slice(last, hit.index);
    parseMarkdownFenced(before).forEach((block) => blocks.push(block));
    const inner = (hit[1] || '').replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    blocks.push({
      type: 'reply_visible',
      locked: false,
      label: REPLY_VISIBLE_LABEL,
      notice: '',
      blocks: inner.trim() ? parseMarkdownArticle(inner) : [],
    });
    last = hit.index + hit[0].length;
  }
  parseMarkdownFenced(source.slice(last)).forEach((block) => blocks.push(block));
  return blocks;
}

function parseMarkdownFenced(source: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const chunks = source.split(/```/);
  chunks.forEach((chunk, index) => {
    if (index % 2 === 1) {
      const langHit = chunk.match(/^([a-zA-Z0-9_+-]*)\r?\n/);
      const lang = langHit?.[1] || '';
      const content = (langHit ? chunk.slice(langHit[0].length) : chunk).replace(/^\n/, '').replace(/\n+$/, '');
      blocks.push({ type: 'code', text: content, lang: lang || undefined });
      return;
    }
    const lines = chunk.replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trim()) {
        i += 1;
        continue;
      }
      const table = consumeMarkdownTable(lines, i);
      if (table) {
        blocks.push(table.block);
        i = table.next;
        continue;
      }
      const start = i;
      i += 1;
      while (i < lines.length && lines[i].trim()) {
        if (i + 1 < lines.length && isPipeRow(lines[i]) && isSepRow(lines[i + 1])) break;
        i += 1;
      }
      emitMarkdownParagraph(blocks, lines.slice(start, i).join('\n'));
    }
  });
  return blocks;
}

function spansToMarkdown(spans: InlineSpan[], keepBreaks = false): string {
  const md = spans.map((span) => {
    if (span.type === 'text') return span.text;
    if (span.type === 'strong') return `**${span.text}**`;
    if (span.type === 'em') return `*${span.text}*`;
    if (span.type === 'strike') return `~~${span.text}~~`;
    if (span.type === 'code') return `\`${span.text}\``;
    if (span.type === 'link') return span.text === span.href ? span.href : `[${span.text}](${span.href})`;
    if (span.type === 'mention') return span.text;
    return span.mask;
  }).join('');
  return keepBreaks ? md : md.replace(/\n+/g, ' ').trim();
}

export function inlineToMarkdown(spans: InlineSpan[]): string {
  return spansToMarkdown(spans);
}

export function spansToPlain(spans: InlineSpan[]): string {
  return spans.map((span) => (span.type === 'secret' ? span.mask : span.text)).join('');
}

export function plainToSpans(text: string): InlineSpan[] {
  return text ? [{ type: 'text', text }] : [];
}

function tableBlockToMarkdown(block: Extract<ArticleBlock, { type: 'table' }>): string {
  const cellText = (spans: InlineSpan[]) => (spansToMarkdown(spans) || ' ').replace(/\|/g, '\\|');
  const fmt = (row: InlineSpan[][]) => `| ${row.map(cellText).join(' | ')} |`;
  const sep = `| ${block.aligns.map((align) => (align === 'center' ? ':---:' : align === 'right' ? '---:' : '---')).join(' | ')} |`;
  return [fmt(block.headers), sep, ...block.rows.map(fmt)].join('\n');
}

export function blocksToMarkdown(blocks: ArticleBlock[]): string {
  const chunks: string[] = [];
  let images: string[] = [];
  const flushImages = () => {
    if (!images.length) return;
    chunks.push(images.join('\n'));
    images = [];
  };
  const push = (md: string) => {
    flushImages();
    if (md.trim() || md === '') chunks.push(md);
  };
  for (const block of blocks) {
    if (block.type === 'image') {
      // 对齐不再写进正文：图片一律纯 markdown 图片语法。
      const caption = (block.caption || '').replace(/[\[\]\r\n]/g, ' ').trim();
      images.push(`![${caption}](${block.src})`);
      continue;
    }
    if (block.type === 'p') {
      const md = spansToMarkdown(block.spans);
      if (!md) {
        // 空段落用空行表示，绝不往正文里写 <p><br></p> 这类标签。
        push('');
        continue;
      }
      push(md);
      continue;
    }
    if (block.type === 'h') {
      const level = Math.min(3, Math.max(1, block.level));
      push(`${'#'.repeat(level)} ${spansToMarkdown(block.spans)}`);
      continue;
    }
    if (block.type === 'list') {
      push(block.items.map((item, index) => (
        block.ordered ? `${index + 1}. ${spansToMarkdown(item)}` : `- ${spansToMarkdown(item)}`
      )).join('\n'));
      continue;
    }
    if (block.type === 'quote') {
      const body = spansToMarkdown(block.spans, true);
      push((body.length ? body : ' ').split('\n').map((line) => `> ${line}`).join('\n'));
      continue;
    }
    if (block.type === 'code') {
      push(`\`\`\`${block.lang || ''}\n${block.text}\n\`\`\``);
      continue;
    }
    if (block.type === 'table') {
      push(tableBlockToMarkdown(block));
      continue;
    }
    if (block.type === 'video') {
      // 与官方编辑器一致：[YouTube视频](watch 地址)
      push(`[${VIDEO_LABEL[block.provider]}](${block.url})`);
      continue;
    }
    if (block.type === 'hr') {
      push('---');
      continue;
    }
    if (block.type === 'reply_visible') {
      if (block.locked) continue;
      const inner = blocksToMarkdown(block.blocks);
      push(`${REPLY_VISIBLE_OPEN}\n${inner}\n${REPLY_VISIBLE_CLOSE}`);
      continue;
    }
  }
  flushImages();
  return chunks.join('\n\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

function htmlTableToMarkdown(html: string): string {
  const table = parseHtmlTable(html);
  if (!table || table.type !== 'table') return '';
  const cellText = (spans: InlineSpan[]) => (spansToMarkdown(spans) || ' ').replace(/\|/g, '\\|');
  const fmt = (row: InlineSpan[][]) => `| ${row.map(cellText).join(' | ')} |`;
  const sep = `| ${table.aligns.map((align) => (align === 'center' ? ':---:' : align === 'right' ? '---:' : '---')).join(' | ')} |`;
  return [fmt(table.headers), sep, ...table.rows.map(fmt)].join('\n');
}

function coalesceMarkdownTables(blocks: ArticleBlock[]): ArticleBlock[] {
  const out: ArticleBlock[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === 'p') {
      const lines: string[] = [];
      let j = i;
      while (j < blocks.length) {
        const next = blocks[j];
        if (next.type === 'spacer' && lines.length) {
          j += 1;
          continue;
        }
        if (next.type !== 'p') break;
        lines.push(spansToMarkdown(next.spans));
        j += 1;
      }
      const table = consumeMarkdownTable(lines, 0);
      if (table) {
        out.push(table.block);
        let taken = 0;
        let k = i;
        while (k < blocks.length && taken < table.next) {
          if (blocks[k].type === 'p') taken += 1;
          k += 1;
        }
        i = k;
        continue;
      }
    }
    out.push(block);
    i += 1;
  }
  return out.map((block) => (
    block.type === 'reply_visible'
      ? { ...block, blocks: coalesceMarkdownTables(block.blocks) }
      : block
  ));
}

export function parseArticle(raw: string): ArticleBlock[] {
  return parseEditableArticle(redactSecrets(raw ?? ''));
}

/** 编辑/预览用：不脱敏，保证所见即所得显示的是真实内容。 */
export function parseEditableArticle(raw: string): ArticleBlock[] {
  const source = raw ?? '';
  const blocks = /<[a-z][\s\S]*>/i.test(source) ? parseHtmlArticle(source) : parseMarkdownArticle(source);
  return promoteVideoLinks(coalesceMarkdownTables(blocks));
}

export function imageKey(src: string): string {
  const raw = (src || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://linux.sb');
    return `${url.host}${url.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

export function uniqueImages(srcs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  srcs.forEach((src) => {
    if (!src) return;
    const key = imageKey(src);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(src);
  });
  return out;
}

export function articleImageSrcs(blocks: ArticleBlock[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.type === 'image') out.push(block.src);
    else if (block.type === 'reply_visible') out.push(...articleImageSrcs(block.blocks));
  }
  return out;
}

export function collectArticleImages(raw: string): string[] {
  return uniqueImages(articleImageSrcs(parseArticle(raw ?? '')));
}

/** 主题正文里还有未解锁的「回复可见」——回帖成功后要重拉主题页。 */
export function hasLockedReplyVisible(raw: string): boolean {
  return /nb-editor-reply-visible-locked/.test(raw ?? '');
}

function replyVisibleSectionToSource(tag: string): string {
  if (/nb-editor-reply-visible-locked/.test(tag)) return '';
  const inner = tag.replace(/^<section\b[^>]*>/i, '').replace(/<\/section>$/i, '');
  const body = inner
    .replace(/<div\b[^>]*class="[^"]*nb-editor-reply-visible-label[^"]*"[^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/<\/?div\b[^>]*class="[^"]*nb-editor-reply-visible-body[^"]*"[^>]*>/gi, '');
  const md = htmlToSource(body).trim();
  return md ? `\n${REPLY_VISIBLE_OPEN}\n${md}\n${REPLY_VISIBLE_CLOSE}\n` : '';
}

export function htmlToSource(raw: string): string {
  const source = stripPostMentions(raw ?? '');
  if (!/<[a-z][\s\S]*>/i.test(source)) return source;
  return decodeEntities(
    source
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<section\b[^>]*class="[^"]*nb-editor-reply-visible[^"]*"[^>]*>[\s\S]*?<\/section>/gi, replyVisibleSectionToSource)
      .replace(/<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, attrs, code) => {
        const lang = String(attrs).match(/\b(?:language|lang)-([a-zA-Z0-9_+-]+)/i)?.[1] || '';
        return `\n\`\`\`${lang}\n${decodeEntities(code)}\n\`\`\`\n`;
      })
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${decodeEntities(code)}\``)
      .replace(/<table\b[\s\S]*?<\/table>/gi, (tag) => {
        const markdown = htmlTableToMarkdown(tag);
        return markdown ? `\n\n${markdown}\n\n` : '';
      })
      .replace(/<img\b[^>]*>/gi, (tag) => {
        const src = imageSrc(tag);
        const caption = imageCaption(tag) || '';
        return src ? `\n![${caption}](${src})\n` : '';
      })
      .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
        const text = decodeEntities(String(label).replace(/<[^>]+>/g, '')).trim();
        const url = decodeEntities(String(href ?? '').trim());
        if (!text) return '';
        return text !== url ? `[${text}](${url})` : url;
      })
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}
