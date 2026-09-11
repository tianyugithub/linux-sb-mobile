import { C } from '../theme/palette';
import { KERNEL_JS } from './kernel.generated';

/**
 * 所见即所得视图的内联 HTML 壳。
 *
 * 结构：CSS 变量（主题令牌） + #doc 挂载点 + __LSB_BOOT__ 初始载荷 + 内联内核。
 * 与 src/components/CaptchaWidget.tsx 同一套路：不联网、不依赖 CDN。
 * 样式值镜像 src/theme/app-styles.ts 的 article* 与 src/components/Article.tsx 的结构。
 */

export type EditorTokens = Record<string, string>;

export function editorTokens(): EditorTokens {
  return {
    canvas: C.canvas,
    surface: C.surface,
    surfaceSoft: C.surfaceSoft,
    line: C.line,
    text: C.text,
    muted: C.muted,
    dim: C.dim,
    blue: C.blue,
    codeBg: C.codeBg,
    codeText: C.codeText,
    inlineCode: C.inlineCode,
    comment: C.comment,
    red: C.redBright,
  };
}

function css(tokens: EditorTokens, compact: boolean, placeholder: string): string {
  const vars = Object.entries(tokens).map(([key, value]) => `--${key}:${value};`).join('');
  const base = compact
    ? { size: '13px', line: '24px', p: '8px', headTop: '10px', headBottom: '6px', listGap: '4px', listBottom: '8px' }
    : { size: '15px', line: '28px', p: '14px', headTop: '18px', headBottom: '8px', listGap: '6px', listBottom: '14px' };
  return `
:root{${vars}--ph:${JSON.stringify(placeholder)};}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body{margin:0;padding:0;background:transparent;}
body{
  color:var(--text);
  font-size:${base.size};
  line-height:${base.line};
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",Roboto,sans-serif;
  -webkit-text-size-adjust:100%;
  -webkit-font-smoothing:antialiased;
  word-break:break-word;
  overflow-wrap:anywhere;
}
#doc{position:relative;padding:2px 1px 4px;}
.lsb-doc{outline:none;}
.lsb-doc:focus,.ProseMirror-focused{outline:none;}
.ProseMirror{outline:none;caret-color:var(--blue);}
.ProseMirror > *:last-child{margin-bottom:0;}
.ProseMirror p{margin:0 0 ${base.p};}
.ProseMirror h1,.ProseMirror h2,.ProseMirror h3{font-weight:800;margin:${base.headTop} 0 ${base.headBottom};}
.ProseMirror h1{font-size:24px;line-height:32px;}
.ProseMirror h2{font-size:20px;line-height:27px;}
.ProseMirror h3{font-size:17px;line-height:23px;}
.ProseMirror h1:first-child,.ProseMirror h2:first-child,.ProseMirror h3:first-child{margin-top:0;}
.ProseMirror blockquote{
  margin:6px 0 10px;padding-left:10px;
  border-left:3px solid var(--line);
  color:var(--muted);font-size:14px;line-height:22px;font-style:italic;
}
.ProseMirror ul,.ProseMirror ol{margin:0 0 ${base.listBottom};padding-left:22px;}
.ProseMirror li{margin-bottom:${base.listGap};}
.ProseMirror li:last-child{margin-bottom:0;}
.ProseMirror li > p{margin:0;}
.ProseMirror a{color:var(--blue);text-decoration:underline;}
.ProseMirror strong{font-weight:800;}
.ProseMirror em{font-style:italic;}
.ProseMirror s,.ProseMirror del{text-decoration:line-through;color:var(--muted);}
.ProseMirror code{
  font-family:Menlo,Consolas,"Roboto Mono",monospace;
  font-size:13px;color:var(--inlineCode);
  background:rgba(127,127,127,.14);padding:1px 4px;border-radius:4px;
}
.ProseMirror pre.lsb-code{
  margin:10px 0 12px;padding:12px;border-radius:8px;
  background:var(--codeBg);overflow-x:auto;white-space:pre;
}
.ProseMirror pre.lsb-code code{
  display:block;background:none;padding:0;
  color:var(--codeText);font-size:13px;line-height:20px;white-space:pre;
}
.ProseMirror .lsb-figure{margin:8px 0;}
.ProseMirror .lsb-figure img{display:block;max-width:100%;height:auto;border-radius:8px;background:var(--surface);}
.ProseMirror .lsb-figure figcaption{color:var(--muted);font-size:12px;line-height:17px;margin-top:5px;}
.ProseMirror .lsb-figure.align-center{margin-left:auto;margin-right:auto;width:86%;}
.ProseMirror .lsb-figure.align-right{margin-left:auto;width:86%;}
.ProseMirror table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0;table-layout:fixed;}
.ProseMirror th,.ProseMirror td{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left;}
.ProseMirror th{font-weight:800;background:var(--surfaceSoft);}
.ProseMirror hr{border:0;border-top:1px solid var(--line);margin:10px 0;}
.ProseMirror .nb-editor-reply-visible{
  margin:14px 0;padding:12px 14px;
  border:1px solid var(--line);border-radius:10px;background:var(--canvas);
}
.ProseMirror .nb-editor-reply-visible-label{
  margin:0 0 9px;color:var(--muted);font-size:12px;font-weight:600;
}
.ProseMirror .nb-editor-reply-visible-body{margin:0;padding:0;}
.ProseMirror .nb-editor-reply-visible-body > :last-child{margin-bottom:0;}
.ProseMirror .selectedCell:after{content:"";position:absolute;inset:0;background:rgba(127,127,127,.18);pointer-events:none;}
.ProseMirror{padding-right:26px;}
.lsb-handles{position:absolute;top:0;left:0;right:0;pointer-events:none;}
.lsb-handle{
  position:absolute;right:0;width:22px;height:22px;padding:0;
  display:flex;align-items:center;justify-content:center;
  border-radius:6px;border:1px solid var(--line);
  background:var(--surface);color:var(--muted);
  font-size:13px;line-height:1;font-weight:700;
  pointer-events:auto;
  touch-action:none;
}
.lsb-handle-dragging{background:var(--surfaceSoft);color:var(--text);}
.lsb-dragging{opacity:.38;}
.lsb-drop{
  position:absolute;left:0;right:26px;height:2px;border-radius:2px;
  background:var(--blue);display:none;pointer-events:none;z-index:4;
}
.lsb-handle:active{background:var(--surfaceSoft);color:var(--text);}
.lsb-add{display:flex;align-items:center;justify-content:center;margin:12px 0 2px;}
.lsb-add-btn{
  width:30px;height:30px;padding:0;border-radius:8px;
  border:1px dashed var(--line);background:transparent;
  color:var(--muted);font-size:15px;line-height:1;
}
.lsb-add-btn:active{border-style:solid;background:var(--surfaceSoft);color:var(--text);}
.ProseMirror .lsb-placeholder::before{
  content:var(--ph);
  color:var(--dim);
  pointer-events:none;
  float:left;
  height:0;
}
`;
}

export function editorPage({
  html,
  tokens,
  editable = true,
  compact = false,
  placeholder = '',
}: {
  html: string;
  tokens: EditorTokens;
  editable?: boolean;
  compact?: boolean;
  placeholder?: string;
}): string {
  const boot = JSON.stringify({ tokens, html, editable, placeholder });
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${css(tokens, compact, placeholder)}</style>
</head>
<body>
<div id="doc"></div>
<script>window.__LSB_BOOT__=${boot};</script>
<script>${KERNEL_JS}</script>
</body>
</html>`;
}
