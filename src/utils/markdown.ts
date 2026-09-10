export type MdSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
};

// 行内 Markdown：**粗体** / __粗体__ / *斜体* / _斜体_ / ~~删除线~~ / `代码` / [文字](链接) / 裸链接
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|`[^`\n]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s]+)/g;

export function parseInlineMarkdown(input: string): MdSpan[] {
  const spans: MdSpan[] = [];
  let last = 0;
  const push = (text: string, style: Partial<MdSpan> = {}) => {
    if (text) spans.push({ text, ...style });
  };
  for (const match of input.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index ?? 0;
    push(input.slice(last, at));
    last = at + token.length;
    if (token.startsWith('**') || token.startsWith('__')) {
      push(token.slice(2, -2), { bold: true });
    } else if (token.startsWith('~~')) {
      push(token.slice(2, -2), { strike: true });
    } else if (token.startsWith('`')) {
      push(token.slice(1, -1), { code: true });
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (link) push(link[1], { href: link[2] });
      else push(token);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      push(token.slice(1, -1), { italic: true });
    } else {
      push(token, { href: token });
    }
  }
  push(input.slice(last));
  return spans;
}

/** 把纯文本按 Markdown 引用块（> 行）拆成引用部分和正文。 */
export function splitQuoteLines(text: string): { quote?: string; body: string } {
  const quote: string[] = [];
  const body: string[] = [];
  text.split('\n').forEach((line) => {
    const hit = line.match(/^>\s?(.*)$/);
    if (hit) quote.push(hit[1]);
    else body.push(line);
  });
  return {
    quote: quote.length ? quote.join('\n') : undefined,
    body: body.join('\n').trim(),
  };
}

/** 官方私信的引用格式：把被引用的每一行加上 "> " 前缀，再拼上正文。 */
export function buildQuoteDraft(quote: string, body: string): string {
  const prefix = quote
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${prefix}\n${body}`.trim();
}
