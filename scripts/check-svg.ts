/**
 * SVG 坏坐标清洗的离线回归。
 *
 * 样本取自 2026-09-17 真机崩溃日志（LINUX-SB-崩溃日志.txt）：
 *   java.lang.IllegalArgumentException: Invalid number formating character 'N'
 *     (i=14, s=M777.9,279.1 LNaN,285.84 L777.9,NaN L776.15,285.84 Z …)
 *     at com.horcrux.svg.RenderableViewManager$PathViewManager.setD
 * 外面来的 SVG 里 NaN/Infinity 坏坐标会让安卓原生 Path 解析器直接抛异常闪退，
 * 且抛在 Fabric 建 View 的 setter 里、Error Boundary 拦不住。parse() 会把子节点
 * 收成 React 元素，只洗根 AST 扫不到 <g> 里的 path，必须先洗 XML 属性。
 *
 *   npm run check:svg
 */
import { sanitizeSvgAst, sanitizeSvgAttrText, sanitizeSvgXml, svgXmlToWebPage, stripUnsafeSvg } from '../src/utils/svg-sanitize';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

/** 崩溃日志里的原样 d 串（发帖工具把 NaN 直接序列化进了路径）。 */
const CRASH_D =
  'M777.9,279.1 LNaN,285.84 L777.9,NaN L776.15,285.84 Z ' +
  'M771.16,285.84 L777.9,284.09 LNaN,285.84 L777.9,NaN Z';

/** 还残留坏 token 当且仅当再洗一次会变（幂等即干净）。 */
const hasBad = (s: string) => sanitizeSvgAttrText(s) !== s;

/* ── 1. 崩溃原串：洗完一个坏 token 都不剩 ─────────────────────────── */
{
  const cleaned = sanitizeSvgAttrText(CRASH_D);
  check('crash-d-no-bad-token', !hasBad(cleaned), cleaned.slice(0, 64));
  check(
    'crash-d-exact',
    cleaned ===
      'M777.9,279.1 L0,285.84 L777.9,0 L776.15,285.84 Z ' +
        'M771.16,285.84 L777.9,284.09 L0,285.84 L777.9,0 Z',
    cleaned,
  );
}

/* ── 2. Infinity 变体 ─────────────────────────────────────────────── */
{
  const cleaned = sanitizeSvgAttrText('MInfinity,5 L10,-Infinity Lnan,inf Z');
  check('infinity-cleaned', !hasBad(cleaned), cleaned);
}

/* ── 3. 正常路径一字不动（避免清洗误伤好图） ─────────────────────── */
{
  const good = 'M10.5,20 L30,40.25 C50,60 70,80 90,100 Z';
  check('good-path-untouched', sanitizeSvgAttrText(good) === good);
  check('normal-words-untouched', sanitizeSvgAttrText('info finance define') === 'info finance define');
}

/* ── 4. 整棵 AST：属性洗、文本留、引用两端一致 ───────────────────── */
{
  const ast = {
    tag: 'svg',
    props: { width: '100', fill: 'url(#NaN)' },
    children: [
      { tag: 'path', props: { d: CRASH_D, id: 'NaN' }, children: [] },
      { tag: 'text', props: { x: 'NaN' }, children: ['NaN'] },
    ],
  };
  const back = sanitizeSvgAst(ast);
  check('ast-same-ref', back === ast);
  const path = ast.children[0] as unknown as { props: Record<string, string> };
  check('ast-path-d-clean', !hasBad(path.props.d), path.props.d.slice(0, 48));
  // id 与 url(#id) 两端一起换，引用不断
  const svgProps = ast.props as Record<string, string>;
  check('ast-ref-consistent', path.props.id === '0' && svgProps.fill === 'url(#0)', svgProps.fill);
  // 数字属性与文本节点：属性洗、文本留（<text>NaN</text> 是正常内容）
  const text = ast.children[1] as unknown as { props: Record<string, string>; children: string[] };
  check('ast-text-attr-clean', text.props.x === '0');
  check('ast-text-node-kept', text.children[0] === 'NaN');
}

/* ── 5. 空输入回透 ────────────────────────────────────────────────── */
{
  check('null-passthrough', sanitizeSvgAst(null) === null && sanitizeSvgAst(undefined) === undefined);
}

/* ── 6. 套在 <g> 里的崩溃原串：旧逻辑扫不到，必须洗 XML 属性 ─────── */
{
  const xml =
    `<svg xmlns="http://www.w3.org/2000/svg"><g><path d="${CRASH_D}"/></g>` +
    `<text x="NaN">NaN</text></svg>`;
  const cleaned = sanitizeSvgXml(xml);
  check('xml-nested-path-clean', !cleaned.includes('LNaN') && !cleaned.includes(',NaN'), cleaned.slice(80, 160));
  check('xml-nested-path-has-zero', cleaned.includes('L0,285.84') && cleaned.includes('L777.9,0'));
  check('xml-text-node-kept', /<text x="0">NaN<\/text>/.test(cleaned), cleaned.match(/<text[^>]*>[^<]*<\/text>/)?.[0]);
}

/* ── 7. React 元素树（parse 之后那种）：props.children 数组也要洗 ── */
{
  const path = { tag: 'path', props: { d: CRASH_D }, children: [] };
  const tree = {
    tag: 'svg',
    props: {},
    children: [
      { tag: 'g', props: { children: [path] }, children: undefined },
    ],
  };
  sanitizeSvgAst(tree);
  check('react-like-nested-d', !hasBad(path.props.d), path.props.d.slice(0, 48));
}

/* ── 8. 正文走 WebView：保住 SMIL，摘掉 script，仍洗嵌套 NaN ───── */
{
  const xml = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <script>alert(1)</script>
  <g><path d="${CRASH_D}">
    <animate attributeName="opacity" values="0;1" dur="1s" repeatCount="indefinite"/>
  </path></g>
</svg>`;
  const page = svgXmlToWebPage(xml);
  check('web-keeps-animate', page.includes('<animate ') && page.includes('repeatCount="indefinite"'));
  check('web-strips-script', !page.toLowerCase().includes('<script'));
  check('web-nested-nan-gone', !page.includes('LNaN') && page.includes('L0,285.84'));
  check('web-strips-handler', !stripUnsafeSvg('<svg onclick="x()"></svg>').includes('onclick'));
}

if (fails > 0) {
  console.error(`check-svg: ${fails} 项失败`);
  process.exit(1);
}
console.log('check-svg: 全绿');
