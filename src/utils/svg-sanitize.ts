/**
 * SVG AST 属性清洗（纯函数，零依赖，可离线回归）。
 *
 * 背景（2026-09-17 真机崩溃日志，LINUX-SB-崩溃日志.txt）：
 *   java.lang.IllegalArgumentException: Invalid number formating character 'N'
 *     (i=14, s=M777.9,279.1 LNaN,285.84 L777.9,NaN …)
 *     at com.horcrux.svg.RenderableViewManager$PathViewManager.setD
 * 外面来的 SVG 里 `<path d="…NaN…">` 这类坏坐标（JS/Python 把 NaN/Infinity 直接
 * 序列化进路径），浏览器会按规范容错跳过，react-native-svg 的安卓原生解析器却
 * 直接抛异常；抛的时机在 Fabric 建原生 View 的 setter 里（UI 线程），React 的
 * Error Boundary 拦不住，整个 App 闪退。
 *
 * 修法：
 * 1. 先洗 XML 里的属性值（`<g><path d>` 套多深都洗得到）；
 * 2. 再在 parse 的 middleware 里洗 XmlAST（此时 children 还是树，不是 React 元素）。
 * 注意只动属性不动文本节点（`<text>NaN</text>` 是正常内容）。
 * id/href 等全部一起换，保证 url(#xxx) 引用两端一致。
 *
 * 曾经只在 parse() 之后洗 AST：react-native-svg 的 parse 会立刻 `astToReact`，
 * 嵌套节点的 `d` 落到 React 元素的 `props.children` 数组里，旧清洗扫不到，
 * 原生 setD 仍然吃到 NaN → 闪退。
 */

/**
 * 命中 JS/Python 序列化出来的坏数字：NaN/nan、Infinity/-Infinity/inf（大小写不敏感）。
 *
 * 注意匹配的是"数字位上的独立 token"，不是单词子串：
 * - 前面是串头 / 分隔符（空白 , ; ( + # : /）/ 符号 - . / 路径命令字母，
 *   所以 "M…LNaN,285" 里的 NaN 能命中（前面是命令字母 L）；
 * - 后面是串尾 / 分隔符 / 下一个数字的起头（符号 . 命令字母），
 *   所以 "finance"/"info"/"define" 不会被误伤（后面跟的是普通字母）。
 * 不用 lookbehind（Hermes 不支持），前导分隔符用捕获组吃进来再放回去（$1）。
 */
const BAD_NUMBER_RE =
  /(^|[\s,;(+#:/\-.eMLCQSTVAHZmlcqstvahz])(-?inf(?:inity)?|nan)(?=$|[\s,;)+#:/\-.eMLCQSTVAHZmlcqstvahz])/gi;

/** 单个属性字符串的清洗；不含坏数字时 replace 直接原样返回。 */
export function sanitizeSvgAttrText(value: string): string {
  BAD_NUMBER_RE.lastIndex = 0;
  return value.replace(BAD_NUMBER_RE, '$10');
}

type SvgAstLike = {
  props?: Record<string, unknown> | null;
  children?: unknown[] | null;
  style?: Record<string, unknown> | null;
  styles?: string | null;
};

function sanitizeProps(props: Record<string, unknown>): void {
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (typeof value === 'string') {
      const next = sanitizeSvgAttrText(value);
      if (next !== value) props[key] = next;
    } else if (Array.isArray(value)) {
      for (const child of value) sanitizeNode(child);
    } else if (value !== null && typeof value === 'object') {
      sanitizeProps(value as Record<string, unknown>);
    }
  }
}

/** 只洗标签属性，不动文本节点 / CDATA（`<text>NaN</text>` 保持原样）。 */
export function sanitizeSvgXml(xml: string): string {
  return xml.replace(/(\s[\w:.-]+\s*=\s*)("[^"]*"|'[^']*')/g, (_full, prefix: string, quoted: string) => {
    const mark = quoted[0];
    const inner = quoted.slice(1, -1);
    return `${prefix}${mark}${sanitizeSvgAttrText(inner)}${mark}`;
  });
}

/** 抽出真正的 <svg>…</svg>，丢掉 XML 声明 / 前面的 BOM。 */
export function extractSvgMarkup(xml: string): string {
  const start = xml.search(/<svg\b/i);
  if (start < 0) return xml.trim();
  const close = xml.toLowerCase().lastIndexOf('</svg>');
  if (close < start) return xml.slice(start).trim();
  return xml.slice(start, close + 6).trim();
}

/**
 * WebView 里播 SMIL / CSS 动画之前先摘掉会执行代码的部分。
 * 保留 <animate> / <animateTransform> / <style>，否则帖子里的动图会停住。
 */
export function stripUnsafeSvg(xml: string): string {
  return xml
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, '');
}

/** 给正文 WebView 用的完整 HTML：内联 SVG，浏览器播动画，不走原生 Path。 */
export function svgXmlToWebPage(xml: string): string {
  const markup = stripUnsafeSvg(sanitizeSvgXml(extractSvgMarkup(xml)));
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">'
    + '<style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}'
    + 'svg{width:100%;height:100%;display:block}</style></head><body>'
    + markup
    + '</body></html>'
  );
}

function sanitizeNode(node: unknown): void {
  if (node === null || typeof node !== 'object') return; // 文本节点：不动
  if (Array.isArray(node)) {
    for (const child of node) sanitizeNode(child);
    return;
  }
  const ast = node as SvgAstLike;
  if (ast.props && typeof ast.props === 'object') sanitizeProps(ast.props);
  if (ast.style && typeof ast.style === 'object') sanitizeProps(ast.style);
  if (typeof ast.styles === 'string') {
    const next = sanitizeSvgAttrText(ast.styles);
    if (next !== ast.styles) ast.styles = next;
  }
  if (Array.isArray(ast.children)) {
    for (const child of ast.children) sanitizeNode(child);
  }
}

/**
 * 原地清洗 parse 出来的 AST（parse 产物是新对象，进缓存前改是安全的），返回同一引用。
 * 传 null/undefined 直接回透，调用方不用判空。
 */
export function sanitizeSvgAst<T>(root: T): T {
  if (root === null || root === undefined) return root;
  sanitizeNode(root);
  return root;
}
