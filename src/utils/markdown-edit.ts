export type Caret = { start: number; end: number };

function clampCaret(value: string, caret: Caret): Caret {
  const start = Math.max(0, Math.min(caret.start, value.length));
  const end = Math.max(start, Math.min(caret.end, value.length));
  return { start, end };
}

function replaceRange(value: string, from: number, to: number, insert: string, selectFrom: number, selectTo: number) {
  const next = value.slice(0, from) + insert + value.slice(to);
  return {
    value: next,
    caret: { start: from + selectFrom, end: from + selectTo },
  };
}

export function wrapInline(value: string, caret: Caret, before: string, after: string, placeholder: string) {
  const { start, end } = clampCaret(value, caret);
  const inner = value.slice(start, end) || placeholder;
  return replaceRange(value, start, end, `${before}${inner}${after}`, before.length, before.length + inner.length);
}

export function prefixLines(value: string, caret: Caret, prefix: string, placeholder: string, numbered = false) {
  const { start, end } = clampCaret(value, caret);
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const nl = value.indexOf('\n', end);
  const lineEnd = nl < 0 ? value.length : nl;
  let content = value.slice(lineStart, lineEnd);
  if (!content.trim()) content = placeholder;
  const lines = content.split('\n').map((line, index) => (numbered ? `${index + 1}. ${line}` : `${prefix}${line}`));
  const insert = lines.join('\n');
  const head = numbered ? 3 : prefix.length;
  return replaceRange(value, lineStart, lineEnd, insert, head, insert.length);
}

export function insertBlock(value: string, caret: Caret, block: string, selectStart: number, selectEnd: number) {
  const { start, end } = clampCaret(value, caret);
  const head = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const insert = `${head}${block}`;
  return replaceRange(value, start, end, insert, head.length + selectStart, head.length + selectEnd);
}

/** 官网 plugins.js `insertReplyVisible`：选中文字作内容，插完后选中块内正文。 */
export function insertReplyVisible(value: string, caret: Caret, content: string) {
  const body = content.trim();
  if (!body) return { value, caret: clampCaret(value, caret) };
  const prefix = '[回复可见]\n';
  const block = `${prefix}${body}\n[/回复可见]\n`;
  return insertBlock(value, caret, block, prefix.length, prefix.length + body.length);
}

export function insertAtCaret(value: string, caret: Caret, snippet: string) {
  const { start, end } = clampCaret(value, caret);
  return replaceRange(value, start, end, snippet, snippet.length, snippet.length);
}

export function insertLink(value: string, caret: Caret) {
  return applyMarkdownToolbar(value, caret, 'link', 'https://');
}

export type MarkdownToolbarAction = 'bold' | 'italic' | 'heading' | 'quote' | 'list' | 'code' | 'link' | 'image';

/** Matches caicaicai/wp-markdown-editor handleToolbarAction wrapping and caret. */
export function applyMarkdownToolbar(
  value: string,
  caret: Caret,
  action: MarkdownToolbarAction,
  extra = '',
) {
  const { start, end } = clampCaret(value, caret);
  const selected = value.slice(start, end);
  let replacement = '';
  let cursor = start;
  switch (action) {
    case 'bold':
      replacement = `**${selected || '粗体文本'}**`;
      cursor = selected ? end + 4 : start + 2;
      break;
    case 'italic':
      replacement = `*${selected || '斜体文本'}*`;
      cursor = selected ? end + 2 : start + 1;
      break;
    case 'heading':
      replacement = `## ${selected || '标题'}`;
      cursor = selected ? end + 3 : start + 3;
      break;
    case 'quote':
      replacement = `> ${selected || '引用文本'}`;
      cursor = selected ? end + 2 : start + 2;
      break;
    case 'list':
      replacement = `- ${selected || '列表项'}`;
      cursor = selected ? end + 2 : start + 2;
      break;
    case 'code':
      if (selected.includes('\n')) {
        replacement = `\`\`\`\n${selected || '代码'}\n\`\`\``;
        cursor = selected ? end + 8 : start + 4;
      } else {
        replacement = `\`${selected || '代码'}\``;
        cursor = selected ? end + 2 : start + 1;
      }
      break;
    case 'link': {
      const url = extra.trim() || 'https://';
      replacement = `[${selected || '链接文本'}](${url})`;
      cursor = selected ? end + url.length + 4 : start + 1;
      break;
    }
    case 'image': {
      const url = extra.trim() || 'https://';
      replacement = `![${selected || '图片描述'}](${url})`;
      cursor = selected ? end + url.length + 5 : start + 2;
      break;
    }
  }
  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    caret: { start: cursor, end: cursor },
  };
}

function markdownImageAlt(alt: string) {
  return alt.replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function insertImageMarkdown(value: string, caret: Caret, url: string, alt = '图片', preferAlt = false) {
  return insertImageMarkdowns(value, caret, [{ url, alt }], preferAlt);
}

export function insertImageMarkdowns(
  value: string,
  caret: Caret,
  images: Array<{ url: string; alt?: string }>,
  preferAlt = false,
) {
  if (!images.length) return { value, caret: clampCaret(value, caret) };
  const { start, end } = clampCaret(value, caret);
  const selected = preferAlt ? '' : value.slice(start, end);
  const lines = images.map((image, index) => {
    const label = markdownImageAlt(preferAlt ? (image.alt || '') : (index === 0 && selected ? selected : (image.alt || '')));
    return `![${label}](${image.url})`;
  });
  const lead = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const insert = `${lead}${lines.join('\n')}\n`;
  return replaceRange(value, start, end, insert, insert.length, insert.length);
}

export function insertTableMarkdown(value: string, caret: Caret) {
  return insertBlock(value, caret, '| 项目 | 内容 |\n| --- | --- |\n| 示例 | 文本 |\n', 2, 4);
}

export function insertHorizontalRule(value: string, caret: Caret) {
  return insertBlock(value, caret, '---\n', 0, 3);
}
