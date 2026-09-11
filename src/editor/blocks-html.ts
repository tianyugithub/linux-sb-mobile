import { REPLY_VISIBLE_LABEL, VIDEO_LABEL, escapeHtml, spansToHtml, type ArticleBlock } from '../utils/article';

/**
 * ArticleBlock → HTML，供所见即所得视图（WebView）渲染。
 *
 * 只做「块模型 → 与 App 正文一致的结构」，不做任何解析：
 * markdown 永远是唯一真值，本函数是它的单向投影（见 docs/wysiwyg-design.md §3）。
 */

function absoluteSrc(src: string): string {
  const abs = src.startsWith('//') ? `https:${src}` : src;
  if (/^https?:\/\//i.test(abs)) return abs;
  if (abs.startsWith('/')) return `https://linux.sb${abs}`;
  return src;
}

function alignAttr(align?: string): string {
  return align && align !== 'left' ? ` style="text-align:${align}"` : '';
}

function alignClass(align?: string): string {
  return align && align !== 'left' ? ` align-${align}` : '';
}

function tableHtml(block: Extract<ArticleBlock, { type: 'table' }>): string {
  const cell = (spans: Parameters<typeof spansToHtml>[0], tag: 'th' | 'td', align: string) => (
    `<${tag}${align && align !== 'left' ? ` style="text-align:${align}"` : ''}>${spansToHtml(spans)}</${tag}>`
  );
  const head = `<thead><tr>${block.headers.map((item, col) => cell(item, 'th', block.aligns[col] || 'left')).join('')}</tr></thead>`;
  const body = block.rows.length
    ? `<tbody>${block.rows.map((row) => `<tr>${row.map((item, col) => cell(item, 'td', block.aligns[col] || 'left')).join('')}</tr>`).join('')}</tbody>`
    : '';
  return `<div class="lsb-table-wrap"><table>${head}${body}</table></div>`;
}

function blockHtml(block: ArticleBlock): string {
  if (block.type === 'p') {
    return `<p${alignAttr(block.align)}>${spansToHtml(block.spans)}</p>`;
  }
  if (block.type === 'h') {
    const level = Math.min(3, Math.max(1, block.level));
    return `<h${level}${alignAttr(block.align)}>${spansToHtml(block.spans)}</h${level}>`;
  }
  if (block.type === 'quote') {
    return `<blockquote${alignAttr(block.align)}>${spansToHtml(block.spans)}</blockquote>`;
  }
  if (block.type === 'list') {
    const tag = block.ordered ? 'ol' : 'ul';
    return `<${tag}${alignAttr(block.align)}>${block.items.map((item) => `<li>${spansToHtml(item)}</li>`).join('')}</${tag}>`;
  }
  if (block.type === 'code') {
    const lang = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : '';
    return `<pre class="lsb-code"><code${lang}>${escapeHtml(block.text)}</code></pre>`;
  }
  if (block.type === 'image') {
    const caption = (block.caption || '').trim();
    return `<figure class="lsb-figure${alignClass(block.align)}">`
      + `<img src="${escapeHtml(absoluteSrc(block.src))}" alt="${escapeHtml(caption)}" loading="lazy">`
      + `${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
  }
  if (block.type === 'video') {
    // 内核要求 iframe 的 src 非空，空 src 会被整块丢掉，所以这种情况干脆不产出节点。
    if (!block.embed) return '';
    // 与官方站点一致：<div class="nb-editor-youtube"><iframe …></div>
    return `<div class="nb-editor-${block.provider}"><iframe src="${escapeHtml(block.embed)}" `
      + `title="${escapeHtml(VIDEO_LABEL[block.provider])}" loading="lazy" allowfullscreen></iframe></div>`;
  }
  if (block.type === 'table') return tableHtml(block);
  if (block.type === 'hr') return '<hr>';
  if (block.type === 'spacer') return '<div class="lsb-spacer"></div>';
  if (block.type === 'reply_visible') {
    if (block.locked) {
      return `<section class="nb-editor-reply-visible nb-editor-reply-visible-locked">`
        + `<div class="nb-editor-reply-visible-notice"><span aria-hidden="true">🔒</span>`
        + `<div><strong>${escapeHtml(block.label)}</strong>`
        + `<span>${escapeHtml(block.notice)}</span></div></div></section>`;
    }
    const label = escapeHtml(block.label || REPLY_VISIBLE_LABEL);
    return `<section class="nb-editor-reply-visible nb-editor-reply-visible-open">`
      + `<div class="nb-editor-reply-visible-label">${label}</div>`
      + `${blocksToHtml(block.blocks)}</section>`;
  }
  return '';
}

export function blocksToHtml(blocks: ArticleBlock[]): string {
  return blocks.map(blockHtml).filter(Boolean).join('\n');
}
