import type { Caret } from './markdown-edit';
import {
  blocksToMarkdown,
  parseArticle,
  plainToSpans,
  spansToPlain,
  type ArticleBlock,
  type InlineSpan,
  type TextAlign,
} from './article';

export type VisualFormat =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inline-code'
  | 'heading'
  | 'quote'
  | 'ul'
  | 'ol'
  | 'codeblock'
  | 'link'
  | 'video'
  | 'table'
  | 'hr'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'move-up'
  | 'move-down'
  | 'duplicate'
  | 'delete'
  | 'insert-before'
  | 'insert-after';

export type InsertKind = 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'ul' | 'ol' | 'code' | 'hr' | 'table' | 'video' | 'image';
export type InsertMode = 'before' | 'after' | 'replace';

export const INSERT_ITEMS: Array<{ kind: InsertKind; label: string; hint: string; keys: string[] }> = [
  { kind: 'p', label: '段落', hint: '正文', keys: ['p', 'paragraph', '段落'] },
  { kind: 'h2', label: '标题', hint: '章节标题', keys: ['h', 'h2', 'heading', '标题'] },
  { kind: 'h1', label: '标题 1', hint: '大标题', keys: ['h1'] },
  { kind: 'h3', label: '标题 3', hint: '小标题', keys: ['h3'] },
  { kind: 'quote', label: '引用', hint: '引用文字', keys: ['quote', '引用'] },
  { kind: 'ul', label: '列表', hint: '项目符号', keys: ['list', 'ul', '列表'] },
  { kind: 'ol', label: '有序列表', hint: '编号', keys: ['ol', 'ordered', '有序'] },
  { kind: 'code', label: '代码', hint: '代码块', keys: ['code', '代码'] },
  { kind: 'image', label: '图片', hint: '插入图片', keys: ['image', 'img', '图片'] },
  { kind: 'video', label: '视频', hint: '视频链接', keys: ['video', '视频'] },
  { kind: 'table', label: '表格', hint: '行列', keys: ['table', '表格'] },
  { kind: 'hr', label: '分隔线', hint: '水平线', keys: ['hr', '分隔'] },
];

export const TRANSFORM_ITEMS = INSERT_ITEMS.filter((item) => (
  item.kind === 'p' || item.kind === 'h1' || item.kind === 'h2' || item.kind === 'h3'
  || item.kind === 'quote' || item.kind === 'ul' || item.kind === 'ol' || item.kind === 'code'
));

function emptyParagraph(): ArticleBlock {
  return { type: 'p', spans: [] };
}

export function editorBlocks(source: string): ArticleBlock[] {
  const blocks = parseArticle(source ?? '');
  if (!blocks.length) return [emptyParagraph()];
  const last = blocks[blocks.length - 1];
  if (last.type !== 'p' || spansToPlain(last.spans).length > 0) return [...blocks, emptyParagraph()];
  return blocks;
}

export function serializeBlocks(blocks: ArticleBlock[]): string {
  const copy = [...blocks];
  while (copy.length) {
    const last = copy[copy.length - 1];
    if (last.type === 'p' && !spansToPlain(last.spans).trim()) copy.pop();
    else break;
  }
  return blocksToMarkdown(copy);
}

export function lastEditableIndex(source: string): number {
  const blocks = editorBlocks(source);
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block.type === 'p' || block.type === 'h' || block.type === 'quote' || block.type === 'list' || block.type === 'code' || block.type === 'table') return i;
  }
  return Math.max(0, blocks.length - 1);
}

export function clampEditableIndex(source: string, index: number): number {
  const blocks = editorBlocks(source);
  const block = blocks[index];
  if (block && block.type !== 'spacer') {
    return index;
  }
  return lastEditableIndex(source);
}

export type EditorFocus = {
  value: string;
  focusIndex: number;
  itemIndex: number;
  caret: Caret;
};

export function blockPlainAt(source: string, index: number, itemIndex = 0): string {
  const blocks = editorBlocks(source);
  const block = blocks[Math.max(0, Math.min(index, Math.max(0, blocks.length - 1)))];
  if (!block) return '';
  if (block.type === 'p' || block.type === 'h' || block.type === 'quote') return spansToPlain(block.spans);
  if (block.type === 'code') return block.text;
  if (block.type === 'list') {
    const item = block.items[Math.max(0, Math.min(itemIndex, block.items.length - 1))];
    return item ? spansToPlain(item) : '';
  }
  return '';
}

export function blockAlignAt(source: string, index: number): TextAlign {
  const blocks = editorBlocks(source);
  const block = blocks[Math.max(0, Math.min(index, Math.max(0, blocks.length - 1)))];
  if (block && 'align' in block && (block.align === 'center' || block.align === 'right')) return block.align;
  return 'left';
}

function focused(blocks: ArticleBlock[], focusIndex: number, itemIndex: number, caret: Caret): EditorFocus {
  return { value: serializeBlocks(blocks), focusIndex, itemIndex, caret };
}

function lastItemIndex(block: ArticleBlock): number {
  return block.type === 'list' ? Math.max(0, block.items.length - 1) : 0;
}

function blockEndLen(block: ArticleBlock): number {
  if (block.type === 'p' || block.type === 'h' || block.type === 'quote') return spansToPlain(block.spans).length;
  if (block.type === 'code') return block.text.length;
  if (block.type === 'list') return spansToPlain(block.items[block.items.length - 1] || []).length;
  return 0;
}

function spanLen(span: InlineSpan): number {
  return span.type === 'secret' ? span.mask.length : span.text.length;
}

function insertIntoSpans(spans: InlineSpan[], index: number, text: string): InlineSpan[] {
  if (!spans.length) return plainToSpans(text);
  let offset = 0;
  const next = spans.map((span) => ({ ...span }));
  for (let i = 0; i < next.length; i += 1) {
    const len = spanLen(next[i]);
    if (index <= offset + len) {
      const local = Math.max(0, index - offset);
      const span = next[i];
      if (span.type === 'secret') {
        next.splice(i + 1, 0, { type: 'text', text });
        return next;
      }
      const value = span.text;
      const written = value.slice(0, local) + text + value.slice(local);
      next[i] = span.type === 'link' || span.type === 'mention'
        ? { ...span, text: written }
        : { ...span, text: written };
      return next;
    }
    offset += len;
  }
  return [...next, { type: 'text', text }];
}

function deleteFromSpans(spans: InlineSpan[], index: number): InlineSpan[] {
  let offset = 0;
  const next = spans.map((span) => ({ ...span }));
  for (let i = 0; i < next.length; i += 1) {
    const len = spanLen(next[i]);
    if (index < offset + len) {
      const local = index - offset;
      const span = next[i];
      if (span.type === 'secret') {
        next.splice(i, 1);
        return next.filter((item) => item.type === 'secret' || item.text.length);
      }
      const written = span.text.slice(0, local) + span.text.slice(local + 1);
      if (!written) {
        next.splice(i, 1);
        return next.length ? next : [];
      }
      next[i] = span.type === 'link' || span.type === 'mention'
        ? { ...span, text: written }
        : { ...span, text: written };
      return next;
    }
    offset += len;
  }
  return next;
}

export function applyPlainEdit(spans: InlineSpan[], prev: string, next: string, caret: Caret): InlineSpan[] {
  if (next === prev) return spans;
  if (next.length === prev.length + 1) {
    const at = caret.start;
    const ch = next[at - 1];
    if (ch !== undefined && next.slice(0, at - 1) + next.slice(at) === prev) {
      return insertIntoSpans(spans, at - 1, ch);
    }
  }
  if (next.length === prev.length - 1 && prev.slice(0, caret.start) + prev.slice(caret.start + 1) === next) {
    return deleteFromSpans(spans, caret.start);
  }
  return plainToSpans(next);
}

function wrapSelection(spans: InlineSpan[], caret: Caret, kind: 'strong' | 'em' | 'code' | 'link', placeholder: string): InlineSpan[] {
  const plain = spansToPlain(spans);
  const start = Math.max(0, Math.min(caret.start, plain.length));
  const end = Math.max(start, Math.min(caret.end, plain.length));
  const inner = plain.slice(start, end) || placeholder;
  const before = plain.slice(0, start);
  const after = plain.slice(end);
  const middle: InlineSpan = kind === 'link'
    ? { type: 'link', href: 'https://', text: inner }
    : { type: kind, text: inner };
  return [
    ...(before ? [{ type: 'text' as const, text: before }] : []),
    middle,
    ...(after ? [{ type: 'text' as const, text: after }] : []),
  ];
}

function setBlockSpans(block: ArticleBlock, spans: InlineSpan[]): ArticleBlock {
  if (block.type === 'p' || block.type === 'h' || block.type === 'quote') return { ...block, spans };
  return block;
}

export function applyBlockText(
  source: string,
  index: number,
  itemIndex: number,
  text: string,
  caret: Caret,
): EditorFocus {
  const blocks = editorBlocks(source);
  const i = Math.max(0, Math.min(index, blocks.length - 1));
  const block = blocks[i];
  if (!block) return { value: source, focusIndex: i, itemIndex, caret };

  if (block.type === 'code') {
    blocks[i] = { ...block, text };
    return focused(blocks, i, 0, caret);
  }

  if (block.type === 'list') {
    const items = [...block.items];
    const at = Math.max(0, Math.min(itemIndex, Math.max(0, items.length - 1)));
    if (!items.length) items.push([]);
    if (text.includes('\n')) {
      const lines = text.split('\n');
      if (lines.every((line) => !line.trim()) && !spansToPlain(items[at] || []).trim()) {
        return exitListItem(blocks, i, at);
      }
      items[at] = applyPlainEdit(items[at] || [], spansToPlain(items[at] || []), lines[0], caret);
      lines.slice(1).forEach((line, offset) => items.splice(at + 1 + offset, 0, plainToSpans(line)));
      blocks[i] = { ...block, items };
      return focused(blocks, i, at + lines.length - 1, { start: 0, end: 0 });
    }
    items[at] = applyPlainEdit(items[at] || [], spansToPlain(items[at] || []), text, caret);
    blocks[i] = { ...block, items };
    return focused(blocks, i, at, caret);
  }

  if (block.type === 'quote') {
    const prev = spansToPlain(block.spans);
    if (/\n\n$/.test(text) || (text.endsWith('\n') && prev.endsWith('\n'))) {
      const body = text.replace(/\n+$/, '');
      blocks[i] = { type: 'quote', spans: body ? plainToSpans(body) : [], align: block.align };
      blocks.splice(i + 1, 0, emptyParagraph());
      return focused(blocks, i + 1, 0, { start: 0, end: 0 });
    }
    blocks[i] = setBlockSpans(block, applyPlainEdit(block.spans, prev, text, caret));
    return focused(blocks, i, 0, caret);
  }

  if (block.type === 'h') {
    const prev = spansToPlain(block.spans);
    if (text.includes('\n')) {
      const [head, ...rest] = text.split('\n');
      blocks[i] = { type: 'h', level: block.level, spans: plainToSpans(head), align: block.align };
      blocks.splice(i + 1, 0, { type: 'p', spans: plainToSpans(rest.join('\n')) });
      return focused(blocks, i + 1, 0, { start: 0, end: 0 });
    }
    blocks[i] = setBlockSpans(block, applyPlainEdit(block.spans, prev, text, caret));
    return focused(blocks, i, 0, caret);
  }

  if (block.type === 'p') {
    const prev = spansToPlain(block.spans);
    if (text.includes('\n')) {
      const parts = text.split('\n');
      const nextBlocks: ArticleBlock[] = [
        ...blocks.slice(0, i),
        ...parts.map((line, idx) => ({
          type: 'p' as const,
          spans: plainToSpans(line),
          ...(idx === 0 || line.length ? (block.align ? { align: block.align } : {}) : {}),
        })),
        ...blocks.slice(i + 1),
      ];
      return focused(nextBlocks, i + 1, 0, { start: 0, end: 0 });
    }
    blocks[i] = setBlockSpans(block, applyPlainEdit(block.spans, prev, text, caret));
    return focused(blocks, i, 0, caret);
  }

  return { value: source, focusIndex: i, itemIndex, caret };
}

function exitListItem(blocks: ArticleBlock[], index: number, itemIndex: number): EditorFocus {
  const block = blocks[index];
  if (block.type !== 'list') return focused(blocks, index, itemIndex, { start: 0, end: 0 });
  const before = block.items.slice(0, itemIndex);
  const after = block.items.slice(itemIndex + 1);
  const out: ArticleBlock[] = [...blocks.slice(0, index)];
  if (before.length) out.push({ ...block, items: before });
  out.push(emptyParagraph());
  const pIndex = out.length - 1;
  if (after.length) out.push({ ...block, items: after });
  out.push(...blocks.slice(index + 1));
  return focused(out, pIndex, 0, { start: 0, end: 0 });
}

export function handleBlockBackspace(
  source: string,
  index: number,
  itemIndex: number,
  caret: Caret,
): EditorFocus | null {
  if (caret.start > 0 || caret.end > 0) return null;
  const blocks = editorBlocks(source);
  const block = blocks[index];
  if (!block) return null;

  if (block.type === 'list') {
    const items = [...block.items];
    const at = Math.max(0, Math.min(itemIndex, Math.max(0, items.length - 1)));
    const current = spansToPlain(items[at] || []);
    if (at > 0) {
      const prev = spansToPlain(items[at - 1]);
      items[at - 1] = plainToSpans(prev + current);
      items.splice(at, 1);
      blocks[index] = { ...block, items };
      return focused(blocks, index, at - 1, { start: prev.length, end: prev.length });
    }
    const rest = items.slice(1);
    const out: ArticleBlock[] = [...blocks.slice(0, index), { type: 'p', spans: items[0] || [] }];
    if (rest.length) out.push({ ...block, items: rest });
    out.push(...blocks.slice(index + 1));
    return focused(out, index, 0, { start: 0, end: 0 });
  }

  if (block.type === 'p') {
    const plain = spansToPlain(block.spans);
    if (index === 0) return null;
    if (!plain) {
      if (index >= blocks.length - 1) return null;
      const out = [...blocks.slice(0, index), ...blocks.slice(index + 1)];
      const prev = out[index - 1];
      const prevLen = blockEndLen(prev);
      return focused(out, index - 1, lastItemIndex(prev), { start: prevLen, end: prevLen });
    }
    return mergeIntoPrevious(blocks, index, plain);
  }

  return null;
}

function mergeIntoPrevious(blocks: ArticleBlock[], index: number, plain: string): EditorFocus | null {
  const prev = blocks[index - 1];
  if (!prev) return null;
  if (prev.type === 'p' || prev.type === 'h' || prev.type === 'quote') {
    const prevPlain = spansToPlain(prev.spans);
    blocks[index - 1] = setBlockSpans(prev, plainToSpans(prevPlain + plain));
    blocks.splice(index, 1);
    return focused(blocks, index - 1, 0, { start: prevPlain.length, end: prevPlain.length });
  }
  if (prev.type === 'code') {
    const prevText = prev.text;
    blocks[index - 1] = { ...prev, text: prevText + plain };
    blocks.splice(index, 1);
    return focused(blocks, index - 1, 0, { start: prevText.length, end: prevText.length });
  }
  if (prev.type === 'list') {
    const last = prev.items.length - 1;
    const prevPlain = spansToPlain(prev.items[last] || []);
    const items = [...prev.items];
    items[last] = plainToSpans(prevPlain + plain);
    blocks[index - 1] = { ...prev, items };
    blocks.splice(index, 1);
    return focused(blocks, index - 1, last, { start: prevPlain.length, end: prevPlain.length });
  }
  return null;
}

export function patchBlockPlain(source: string, index: number, text: string, caret: Caret): string {
  return applyBlockText(source, index, 0, text, caret).value;
}

export function patchListItem(source: string, index: number, itemIndex: number, text: string, caret: Caret): string {
  return applyBlockText(source, index, itemIndex, text, caret).value;
}

export function patchImageCaption(source: string, index: number, caption: string): string {
  const blocks = editorBlocks(source);
  const block = blocks[index];
  if (block?.type !== 'image') return source;
  blocks[index] = { ...block, caption };
  return serializeBlocks(blocks);
}

export function removeImageBlock(source: string, index: number): string {
  const blocks = editorBlocks(source);
  if (blocks[index]?.type !== 'image') return source;
  blocks.splice(index, 1);
  return serializeBlocks(blocks);
}

export function insertImagesAtBlock(
  source: string,
  index: number,
  caret: Caret,
  images: Array<{ url: string; caption?: string }>,
): { value: string; focusIndex: number } {
  const files = images.filter((item) => item.url);
  if (!files.length) return { value: source, focusIndex: index };
  const imageBlocks: ArticleBlock[] = files.map((item) => ({
    type: 'image',
    src: item.url,
    caption: (item.caption || '').replace(/[\[\]\r\n]/g, ' ').trim() || undefined,
  }));
  const blocks = editorBlocks(source);
  const block = blocks[Math.max(0, Math.min(index, blocks.length - 1))];
  let next: ArticleBlock[];
  let focusIndex: number;
  if (block && (block.type === 'p' || block.type === 'h' || block.type === 'quote')) {
    const plain = spansToPlain(block.spans);
    const start = Math.max(0, Math.min(caret.start, plain.length));
    const end = Math.max(start, Math.min(caret.end, plain.length));
    const before = plain.slice(0, start);
    const after = plain.slice(end);
    const head = before ? [setBlockSpans(block, plainToSpans(before))] : [];
    const tail: ArticleBlock[] = after ? [{ type: 'p', spans: plainToSpans(after) }] : [emptyParagraph()];
    next = [
      ...blocks.slice(0, index),
      ...head,
      ...imageBlocks,
      ...tail,
      ...blocks.slice(index + 1),
    ];
    focusIndex = index + head.length + imageBlocks.length;
  } else {
    next = [...blocks.slice(0, index + 1), ...imageBlocks, emptyParagraph(), ...blocks.slice(index + 1)];
    focusIndex = index + 1 + imageBlocks.length;
  }
  return { value: serializeBlocks(next), focusIndex };
}

export function applyVisualFormat(
  source: string,
  index: number,
  caret: Caret,
  format: VisualFormat,
  itemIndex = 0,
): EditorFocus {
  const blocks = editorBlocks(source);
  const i = Math.max(0, Math.min(index, blocks.length - 1));
  const block = blocks[i];
  const keep = { focusIndex: i, itemIndex, caret };

  const wrapFocused = (kind: 'strong' | 'em' | 'code' | 'link', placeholder: string): EditorFocus => {
    if (block.type === 'p' || block.type === 'h' || block.type === 'quote') {
      blocks[i] = setBlockSpans(block, wrapSelection(block.spans, caret, kind, placeholder));
      return { value: serializeBlocks(blocks), ...keep };
    }
    if (block.type === 'list') {
      const at = Math.max(0, Math.min(itemIndex, block.items.length - 1));
      const items = [...block.items];
      items[at] = wrapSelection(items[at] || [], caret, kind, placeholder);
      blocks[i] = { ...block, items };
      return { value: serializeBlocks(blocks), focusIndex: i, itemIndex: at, caret };
    }
    return { value: source, ...keep };
  };

  if (format === 'bold') return wrapFocused('strong', '粗体文字');
  if (format === 'italic' || format === 'strike') return wrapFocused('em', format === 'strike' ? '删除线文字' : '斜体文字');
  if (format === 'inline-code') return wrapFocused('code', '代码');
  if (format === 'link') return wrapFocused('link', '链接文字');

  if (format === 'align-left' || format === 'align-center' || format === 'align-right') {
    const picked = format.replace('align-', '') as TextAlign;
    const align = picked === 'left' ? undefined : picked;
    if (block.type === 'p' || block.type === 'h' || block.type === 'quote' || block.type === 'list' || block.type === 'image') {
      blocks[i] = { ...block, align };
      return { value: serializeBlocks(blocks), ...keep };
    }
    return { value: source, ...keep };
  }

  if (format === 'heading') {
    if (block.type === 'h') blocks[i] = { type: 'p', spans: block.spans, align: block.align };
    else if (block.type === 'p' || block.type === 'quote') blocks[i] = { type: 'h', level: 2, spans: block.spans, align: block.align };
    else {
      blocks.splice(i + 1, 0, { type: 'h', level: 2, spans: [] });
      return { value: serializeBlocks(blocks), focusIndex: i + 1, itemIndex: 0, caret: { start: 0, end: 0 } };
    }
    return { value: serializeBlocks(blocks), ...keep };
  }

  if (format === 'quote') {
    if (block.type === 'quote') blocks[i] = { type: 'p', spans: block.spans, align: block.align };
    else if (block.type === 'p' || block.type === 'h') blocks[i] = { type: 'quote', spans: block.spans, align: block.align };
    else {
      blocks.splice(i + 1, 0, { type: 'quote', spans: [] });
      return { value: serializeBlocks(blocks), focusIndex: i + 1, itemIndex: 0, caret: { start: 0, end: 0 } };
    }
    return { value: serializeBlocks(blocks), ...keep };
  }

  if (format === 'ul' || format === 'ol') {
    const ordered = format === 'ol';
    if (block.type === 'list' && block.ordered === ordered) {
      const paras: ArticleBlock[] = block.items.map((spans) => ({ type: 'p' as const, spans, align: block.align }));
      blocks.splice(i, 1, ...(paras.length ? paras : [emptyParagraph()]));
      return { value: serializeBlocks(blocks), focusIndex: i, itemIndex: 0, caret };
    }
    if (block.type === 'p' || block.type === 'h' || block.type === 'quote') {
      blocks[i] = { type: 'list', ordered, items: [block.spans], align: block.align };
    } else if (block.type === 'list') {
      blocks[i] = { ...block, ordered };
    } else {
      blocks.splice(i + 1, 0, { type: 'list', ordered, items: [[]] });
      return { value: serializeBlocks(blocks), focusIndex: i + 1, itemIndex: 0, caret: { start: 0, end: 0 } };
    }
    return { value: serializeBlocks(blocks), focusIndex: i, itemIndex: 0, caret };
  }

  if (format === 'codeblock') {
    if (block.type === 'code') blocks[i] = { type: 'p', spans: plainToSpans(block.text) };
    else if (block.type === 'p' || block.type === 'h' || block.type === 'quote') {
      blocks[i] = { type: 'code', text: spansToPlain(block.spans) };
    } else {
      blocks.splice(i + 1, 0, { type: 'code', text: '' });
      return { value: serializeBlocks(blocks), focusIndex: i + 1, itemIndex: 0, caret: { start: 0, end: 0 } };
    }
    return { value: serializeBlocks(blocks), ...keep };
  }

  if (format === 'video') {
    blocks.splice(i + 1, 0, { type: 'p', spans: [{ type: 'link', href: 'https://', text: '视频' }] });
    return { value: serializeBlocks(blocks), focusIndex: i + 1, itemIndex: 0, caret: { start: 0, end: 2 } };
  }

  if (format === 'table') {
    const cell = (text: string): InlineSpan[] => [{ type: 'text', text }];
    blocks.splice(i + 1, 0, {
      type: 'table',
      headers: [cell('项目'), cell('内容')],
      rows: [[cell('示例'), cell('文本')]],
      aligns: ['left', 'left'],
    });
    return { value: serializeBlocks(blocks), focusIndex: i + 1, itemIndex: 0, caret };
  }

  if (format === 'hr') {
    blocks.splice(i + 1, 0, { type: 'hr' }, emptyParagraph());
    return { value: serializeBlocks(blocks), focusIndex: i + 2, itemIndex: 0, caret: { start: 0, end: 0 } };
  }

  if (format === 'paragraph' || format === 'heading-1' || format === 'heading-2' || format === 'heading-3') {
    const next = transformTo(block, format);
    if (!next) return { value: source, ...keep };
    blocks[i] = next;
    return { value: serializeBlocks(blocks), focusIndex: i, itemIndex: 0, caret: { start: 0, end: 0 } };
  }

  if (format === 'move-up' || format === 'move-down') {
    return moveBlockTo(source, i, i + (format === 'move-up' ? -1 : 1), itemIndex, caret);
  }

  if (format === 'duplicate') {
    const copy = cloneBlock(block);
    blocks.splice(i + 1, 0, copy);
    return { value: serializeBlocks(blocks), focusIndex: i + 1, itemIndex: 0, caret: { start: 0, end: 0 } };
  }

  if (format === 'delete') {
    if (blocks.length <= 1) {
      blocks[0] = emptyParagraph();
      return { value: serializeBlocks(blocks), focusIndex: 0, itemIndex: 0, caret: { start: 0, end: 0 } };
    }
    blocks.splice(i, 1);
    const next = Math.min(i, blocks.length - 1);
    return { value: serializeBlocks(blocks), focusIndex: next, itemIndex: 0, caret: { start: 0, end: 0 } };
  }

  if (format === 'insert-before' || format === 'insert-after') {
    return insertBlockKind(source, i, 'p', format === 'insert-before' ? 'before' : 'after');
  }

  return { value: source, ...keep };
}

function cloneBlock(block: ArticleBlock): ArticleBlock {
  return JSON.parse(JSON.stringify(block)) as ArticleBlock;
}

function alignOf(block: ArticleBlock): TextAlign | undefined {
  return 'align' in block ? block.align : undefined;
}

function textSpansOf(block: ArticleBlock): InlineSpan[] {
  if (block.type === 'p' || block.type === 'h' || block.type === 'quote') return block.spans;
  if (block.type === 'code') return plainToSpans(block.text);
  if (block.type === 'list') return block.items[0] || [];
  if (block.type === 'image') return plainToSpans(block.caption || '');
  return [];
}

function transformTo(block: ArticleBlock, format: 'paragraph' | 'heading-1' | 'heading-2' | 'heading-3'): ArticleBlock | null {
  if (block.type === 'hr' || block.type === 'table' || block.type === 'spacer') return null;
  const align = alignOf(block);
  if (block.type === 'list' && format === 'paragraph') {
    return { type: 'p', spans: block.items.flatMap((item, index) => (
      index === 0 ? item : [{ type: 'text' as const, text: '\n' }, ...item]
    )), align };
  }
  const spans = textSpansOf(block);
  if (format === 'paragraph') return { type: 'p', spans, align };
  return { type: 'h', level: Number(format.slice(-1)), spans, align };
}

export function isEmptyTextBlock(block?: ArticleBlock): boolean {
  if (!block) return true;
  if (block.type === 'p' || block.type === 'h' || block.type === 'quote') return !spansToPlain(block.spans).trim();
  if (block.type === 'code') return !block.text.trim();
  if (block.type === 'list') return block.items.every((item) => !spansToPlain(item).trim());
  return false;
}

export function blockTitle(block?: ArticleBlock): string {
  if (!block) return '段落';
  if (block.type === 'p') return '段落';
  if (block.type === 'h') return block.level <= 1 ? '标题 1' : `标题 ${block.level}`;
  if (block.type === 'quote') return '引用';
  if (block.type === 'list') return block.ordered ? '有序列表' : '列表';
  if (block.type === 'code') return '代码';
  if (block.type === 'image') return '图片';
  if (block.type === 'table') return '表格';
  if (block.type === 'hr') return '分隔线';
  return '块';
}

export function blockPreview(block?: ArticleBlock): string {
  if (!block) return '空';
  if (block.type === 'image') return block.caption || '图片';
  if (block.type === 'hr') return '——';
  if (block.type === 'table') return spansToPlain(block.headers[0] || []) || '表格';
  const text = blockPlainFrom(block).replace(/\s+/g, ' ').trim();
  return text ? (text.length > 28 ? `${text.slice(0, 28)}…` : text) : '空';
}

function blockPlainFrom(block: ArticleBlock): string {
  if (block.type === 'p' || block.type === 'h' || block.type === 'quote') return spansToPlain(block.spans);
  if (block.type === 'code') return block.text;
  if (block.type === 'list') return block.items.map((item) => spansToPlain(item)).join(' ');
  if (block.type === 'image') return block.caption || '';
  return '';
}

export function blockTitleAt(source: string, index: number): string {
  const blocks = editorBlocks(source);
  return blockTitle(blocks[Math.max(0, Math.min(index, Math.max(0, blocks.length - 1)))]);
}

export function listViewEntries(source: string): Array<{ index: number; title: string; preview: string }> {
  return editorBlocks(source).map((block, index) => ({
    index,
    title: blockTitle(block),
    preview: blockPreview(block),
  }));
}

export function markdownAtBlock(source: string, index: number): string {
  const blocks = editorBlocks(source);
  const block = blocks[Math.max(0, Math.min(index, Math.max(0, blocks.length - 1)))];
  return block ? blocksToMarkdown([block]) : '';
}

export function slashMatches(query: string): typeof INSERT_ITEMS {
  const needle = query.trim().toLowerCase().replace(/^\//, '');
  if (!needle) return INSERT_ITEMS;
  return INSERT_ITEMS.filter((item) => item.keys.some((key) => key.startsWith(needle) || item.label.includes(needle)));
}

function createInserted(kind: InsertKind): ArticleBlock {
  if (kind === 'h1' || kind === 'h2' || kind === 'h3') return { type: 'h', level: Number(kind.slice(1)), spans: [] };
  if (kind === 'quote') return { type: 'quote', spans: [] };
  if (kind === 'ul' || kind === 'ol') return { type: 'list', ordered: kind === 'ol', items: [[]] };
  if (kind === 'code') return { type: 'code', text: '' };
  if (kind === 'hr') return { type: 'hr' };
  if (kind === 'table') {
    const cell = (text: string): InlineSpan[] => [{ type: 'text', text }];
    return { type: 'table', headers: [cell('项目'), cell('内容')], rows: [[cell('示例'), cell('文本')]], aligns: ['left', 'left'] };
  }
  if (kind === 'video') return { type: 'p', spans: [{ type: 'link', href: 'https://', text: '视频' }] };
  return emptyParagraph();
}

export function moveBlockTo(
  source: string,
  from: number,
  to: number,
  itemIndex = 0,
  caret: Caret = { start: 0, end: 0 },
): EditorFocus {
  const blocks = editorBlocks(source);
  if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) {
    return { value: source, focusIndex: Math.max(0, from), itemIndex, caret };
  }
  const [item] = blocks.splice(from, 1);
  blocks.splice(to, 0, item);
  return focused(blocks, to, 0, { start: 0, end: 0 });
}

export function insertBlockKind(
  source: string,
  index: number,
  kind: InsertKind,
  mode: InsertMode,
): EditorFocus {
  if (kind === 'image') {
    return insertBlockKind(source, index, 'p', mode);
  }
  const blocks = editorBlocks(source);
  const i = Math.max(0, Math.min(index, Math.max(0, blocks.length - 1)));
  const created = createInserted(kind);
  const current = blocks[i];
  const replace = mode === 'replace';
  if (replace && current) {
    blocks[i] = created;
    if (kind === 'hr') {
      blocks.splice(i + 1, 0, emptyParagraph());
      return focused(blocks, i + 1, 0, { start: 0, end: 0 });
    }
    const caret = kind === 'video' ? { start: 0, end: 2 } : { start: 0, end: 0 };
    return focused(blocks, i, 0, caret);
  }
  const at = mode === 'before' ? i : i + 1;
  blocks.splice(at, 0, created);
  if (kind === 'hr') {
    blocks.splice(at + 1, 0, emptyParagraph());
    return focused(blocks, at + 1, 0, { start: 0, end: 0 });
  }
  const caret = kind === 'video' ? { start: 0, end: 2 } : { start: 0, end: 0 };
  return focused(blocks, at, 0, caret);
}

export function setBlockKind(source: string, index: number, kind: InsertKind): EditorFocus {
  if (kind === 'image' || kind === 'hr' || kind === 'table' || kind === 'video') {
    return insertBlockKind(source, index, kind, 'replace');
  }
  const blocks = editorBlocks(source);
  const i = Math.max(0, Math.min(index, Math.max(0, blocks.length - 1)));
  const block = blocks[i];
  if (!block) return { value: source, focusIndex: i, itemIndex: 0, caret: { start: 0, end: 0 } };
  if (kind === 'p' || kind === 'h1' || kind === 'h2' || kind === 'h3') {
    const next = transformTo(block, kind === 'p' ? 'paragraph' : (`heading-${kind.slice(1)}` as 'heading-1' | 'heading-2' | 'heading-3'));
    if (next) blocks[i] = next;
    return focused(blocks, i, 0, { start: 0, end: 0 });
  }
  const spans = textSpansOf(block);
  const align = alignOf(block);
  if (kind === 'quote') blocks[i] = { type: 'quote', spans, align };
  else if (kind === 'ul' || kind === 'ol') {
    const items = block.type === 'list' ? block.items : [spans.length ? spans : []];
    blocks[i] = { type: 'list', ordered: kind === 'ol', items, align };
  } else if (kind === 'code') {
    blocks[i] = { type: 'code', text: block.type === 'code' ? block.text : spansToPlain(spans) };
  }
  return focused(blocks, i, 0, { start: 0, end: 0 });
}

export function insertAtBlockCaret(
  source: string,
  index: number,
  caret: Caret,
  snippet: string,
  itemIndex = 0,
): EditorFocus {
  const blocks = editorBlocks(source);
  const block = blocks[index];
  if (block && (block.type === 'p' || block.type === 'h' || block.type === 'quote')) {
    const plain = spansToPlain(block.spans);
    const start = Math.max(0, Math.min(caret.start, plain.length));
    const end = Math.max(start, Math.min(caret.end, plain.length));
    const nextPlain = plain.slice(0, start) + snippet + plain.slice(end);
    const nextCaret = { start: start + snippet.length, end: start + snippet.length };
    blocks[index] = setBlockSpans(block, applyPlainEdit(block.spans, plain, nextPlain, nextCaret));
    return { value: serializeBlocks(blocks), focusIndex: index, itemIndex: 0, caret: nextCaret };
  }
  if (block?.type === 'code') {
    const start = Math.max(0, Math.min(caret.start, block.text.length));
    const end = Math.max(start, Math.min(caret.end, block.text.length));
    const text = block.text.slice(0, start) + snippet + block.text.slice(end);
    blocks[index] = { ...block, text };
    return {
      value: serializeBlocks(blocks),
      focusIndex: index,
      itemIndex: 0,
      caret: { start: start + snippet.length, end: start + snippet.length },
    };
  }
  if (block?.type === 'list') {
    const at = Math.max(0, Math.min(itemIndex, Math.max(0, block.items.length - 1)));
    const plain = spansToPlain(block.items[at] || []);
    const start = Math.max(0, Math.min(caret.start, plain.length));
    const end = Math.max(start, Math.min(caret.end, plain.length));
    const nextPlain = plain.slice(0, start) + snippet + plain.slice(end);
    const nextCaret = { start: start + snippet.length, end: start + snippet.length };
    return applyBlockText(source, index, at, nextPlain, nextCaret);
  }
  return { value: source, focusIndex: index, itemIndex, caret };
}

export function patchTableCell(
  source: string,
  index: number,
  row: number,
  col: number,
  text: string,
): string {
  const blocks = editorBlocks(source);
  const block = blocks[index];
  if (block?.type !== 'table') return source;
  if (row < 0) {
    const headers = [...block.headers];
    headers[col] = plainToSpans(text);
    blocks[index] = { ...block, headers };
  } else {
    const rows = block.rows.map((item) => item.map((cell) => [...cell]));
    if (!rows[row]) return source;
    rows[row][col] = plainToSpans(text);
    blocks[index] = { ...block, rows };
  }
  return serializeBlocks(blocks);
}
