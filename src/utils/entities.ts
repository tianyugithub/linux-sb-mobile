// 站点上游同时存在两类实体：常规命名实体（&nbsp; &amp; …）和十进制/十六进制
// 数字实体（&#129313; / &#x1F921;）。旧实现用 String.fromCharCode 只能处理 BMP
// 内的码点，emoji（>0xFFFF）会被截断成乱码，且完全没处理 &#x…;，因此统一在这里
// 用 fromCodePoint 解码。
const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  bull: '•',
  times: '×',
  divide: '÷',
  plusmn: '±',
  minus: '−',
  deg: '°',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  dagger: '†',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup2: '²',
  sup3: '³',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
};

const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,31});/gi;

export function decodeEntities(text: string): string {
  if (!text || text.indexOf('&') === -1) return text;
  return text.replace(ENTITY_RE, (match, body: string) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      // 非法码点与孤立代理项保持原样，避免渲染成替换字符。
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    const named = NAMED[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

// 头像兜底字母：Array.from 按码点切分，避免把 emoji 的代理对切成半个字符。
export function firstGlyph(name: string | null | undefined, fallback = '?'): string {
  const cleaned = (name ?? '').replace(/^[【[(\s]+/, '');
  return Array.from(cleaned)[0] ?? fallback;
}
