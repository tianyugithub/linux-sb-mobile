/**
 * 内核无头验证：在 jsdom 里跑真实的 ProseMirror 内核，检查
 *   markdown → blocksToHtml → 内核 doc → DOMSerializer → HTML → markdown
 * 是否幂等，以及命令通道是否真的改了文档。
 *
 * 运行：npx tsx scripts/check-kernel.ts
 */
import { JSDOM } from 'jsdom';
import { blocksToMarkdown, parseEditableArticle } from '../src/utils/article';
import { blocksToHtml } from '../src/editor/blocks-html';

const dom = new JSDOM('<!doctype html><html><body><div id="doc"></div></body></html>', { pretendToBeVisual: true });
const win = dom.window as unknown as Record<string, unknown> & typeof globalThis;
const doc = dom.window.document;

const globals = globalThis as unknown as Record<string, unknown>;
globals.window = dom.window;
globals.document = doc;
Object.defineProperty(globals, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
globals.HTMLElement = dom.window.HTMLElement;
globals.Node = dom.window.Node;
globals.Range = dom.window.Range;
globals.getSelection = dom.window.getSelection.bind(dom.window);
globals.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globals.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
globals.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as NodeJS.Timeout);
globals.ResizeObserver = undefined;

// jsdom 不实现这些布局 API，ProseMirror 滚动选区时会用到。
const elementProto = dom.window.Element.prototype as unknown as Record<string, unknown>;
const nodeProto = dom.window.Node.prototype as unknown as Record<string, unknown>;
const rangeProto = dom.window.Range.prototype as unknown as Record<string, unknown>;
const documentProto = dom.window.Document.prototype as unknown as Record<string, unknown>;
elementProto.getClientRects = function getClientRects() {
  return { length: 0, item: () => null, [Symbol.iterator]: function* iterate() { /* 空 */ } };
};
elementProto.getBoundingClientRect = function getBoundingClientRect() {
  const top = Number((this as unknown as { __top?: number }).__top || 0);
  return { x: 0, y: top, top, left: 0, right: 0, bottom: top + 40, width: 0, height: 40 };
};
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetTop', {
  configurable: true,
  get(this: HTMLElement & { __top?: number }) { return this.__top || 0; },
});
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement & { __height?: number }) { return this.__height ?? 40; },
});
for (const proto of [nodeProto, elementProto, rangeProto, documentProto]) {
  proto.getClientRects = elementProto.getClientRects;
  proto.getBoundingClientRect = elementProto.getBoundingClientRect;
}

const messages: Array<Record<string, unknown>> = [];
(dom.window as unknown as Record<string, unknown>).ReactNativeWebView = {
  postMessage: (data: string) => messages.push(JSON.parse(data) as Record<string, unknown>),
};

const md = [
  '## 二级标题',
  '',
  '正文 **加粗** *斜体* ~~删除线~~ `行内代码` [链接](https://linux.sb/t/1)',
  '',
  '- 无序一',
  '- 无序二',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '> 引用一行',
  '',
  '```js',
  'const a = 1 < 2 && "x";',
  '```',
  '',
  '![图片说明](https://linux.sb/img/a.png)',
  '',
  '| 项目 | 内容 |',
  '| :---: | ---: |',
  '| 示例 | 文本 |',
  '',
  '---',
  '',
  '<p style="text-align:center">居中段落</p>',
  '',
  '<p></p>',
  '',
  '软换行第一行',
  '软换行第二行',
  '',
  '普通结尾段落',
].join('\n');

async function main() {
  const { mount } = await import('../src/editor/kernel/index');

  const start = Date.now();
  const view = mount({ tokens: { text: '#fff' }, html: blocksToHtml(parseEditableArticle(md)), editable: true, placeholder: '写点什么' });
  console.log(`内核挂载：${Date.now() - start}ms`);

  const ready = messages.find((item) => item.type === 'ready');
  console.log('ready 消息:', ready ? 'OK' : '缺失');
  const firstState = messages.find((item) => item.type === 'state');
  console.log('挂载即上报状态:', firstState ? `OK (block=${String(firstState.block)})` : '缺失');

  const request = (tag: string) => {
    messages.length = 0;
    (win.__lsbRequestHtml as (tag: string) => void)(tag);
    const hit = messages.find((item) => item.type === 'html');
    return String(hit?.html ?? '');
  };

  const html = request('flush');
  console.log('--- 内核序列化出的 HTML ---');
  console.log(html);

  const roundTrip = blocksToMarkdown(parseEditableArticle(html));
  const direct = blocksToMarkdown(parseEditableArticle(md));
  console.log('--- 往返幂等 ---');
  console.log(roundTrip === direct ? 'OK 完全一致' : 'DIFF');
  if (roundTrip !== direct) {
    console.log('--- direct ---\n' + direct);
    console.log('--- roundtrip ---\n' + roundTrip);
  }

  // 预设文字：清空文档后应出现占位装饰类（代码模式靠 placeholder 属性，富文本靠这个）。
  (win.__lsbSetContent as (html: string) => void)('');
  console.log('空文档占位装饰:', doc.querySelector('.lsb-placeholder') ? 'OK' : '缺失');
  (win.__lsbSetContent as (html: string) => void)(blocksToHtml(parseEditableArticle(md)));

  // 命令通道：每条命令在干净文档上单独验证。
  const setContent = (html: string) => (win.__lsbSetContent as (html: string) => void)(html);
  let skipped = 0;
  const runCommand = (name: string, payload?: unknown) => {
    try {
      return (win.__lsbCommand as (n: string, p?: unknown) => boolean)(name, payload);
    } catch (error) {
      skipped += 1;
      console.log(`SKIP ${name} — jsdom 缺少布局 API：${error instanceof Error ? error.message : error}`);
      return false;
    }
  };
  const expect = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
  };

  let failures = 0;
  const blocks: Array<[string, string]> = [
    ['h1', 'h1'], ['h2', 'h2'], ['quote', 'blockquote'], ['ul', 'ul'], ['ol', 'ol'],
    ['codeblock', 'pre'], ['table', '<table>'], ['hr', '<hr>'],
    ['image', '<img'],
  ];
  for (const [command, marker] of blocks) {
    setContent('<p>测试文本</p>');
    runCommand(command, command === 'image' ? { src: 'https://linux.sb/x.png', alt: '图' } : undefined);
    const html = request('cmd');
    expect(`命令 ${command}`, html.includes(marker), html.slice(0, 90));
  }

  for (const [command, marker] of [['bold', '<strong>'], ['italic', '<em>'], ['strike', '<s>'], ['inline-code', '<code>']] as Array<[string, string]>) {
    setContent('<p>测试文本</p>');
    runCommand(command);
    runCommand('text', { text: 'X' });
    const html = request('cmd');
    expect(`命令 ${command}`, html.includes(marker), html.slice(0, 90));
  }

  // 空文档点格式按钮：应插入与代码模式一致的占位文字
  const placeholders: Array<[string, string]> = [
    ['bold', '<strong>粗体文字</strong>'],
    ['italic', '<em>斜体文字</em>'],
    ['strike', '<s>删除线文字</s>'],
    ['inline-code', '<code>代码</code>'],
    ['h2', '<h2>标题</h2>'],
    ['quote', '<blockquote><p>引用内容</p></blockquote>'],
    ['ul', '<ul><li><p>列表项</p></li></ul>'],
    ['ol', '<ol><li><p>列表项</p></li></ol>'],
    ['codeblock', '<pre class="lsb-code"><code>代码</code></pre>'],
  ];
  for (const [cmd, marker] of placeholders) {
    setContent('');
    runCommand(cmd);
    const html = request('ph');
    expect(`占位文字 ${cmd}`, html.includes(marker), html.slice(0, 80));
  }

  // 块手柄：⋮ 菜单（轻点打开）与拖动排序
  setContent('<p>一</p><p>二</p><p>三</p>');
  const click = (el: Element | null) => {
    if (!el) return;
    try {
      el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch {
      /* jsdom 缺少布局 API，真机 WebView 不受影响 */
    }
  };
  const pointer = (type: string, target: Element, clientY: number, pointerId = 7) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    target.dispatchEvent(event);
  };
  // 真机序列：pointerdown → pointerup → click（click 不能把菜单关掉）
  const tap = (el: Element) => { pointer('pointerdown', el, 0); pointer('pointerup', el, 0); click(el); };
  const handles = () => Array.from(doc.querySelectorAll('[data-lsb-handle]'));
  const lastSheet = () => messages.filter((item) => item.type === 'sheet').pop() as
    { kind?: string; index?: number; items?: Array<{ key: string }> } | undefined;
  const blockAction = (action: string, index: number) => (win.__lsbBlockAction as (a: string, i: number) => void)(action, index);
  const addBlock = (kind: string) => (win.__lsbAddBlock as (k: string) => void)(kind);
  expect('块手柄数量', handles().length === 3, `handles=${handles().length}`);
  messages.length = 0;
  tap(handles()[1]);
  const blockSheet = lastSheet();
  expect('轻点手柄请求底部卡片', blockSheet?.kind === 'block' && blockSheet.index === 1, JSON.stringify(blockSheet));
  expect('卡片含上移/下移/删除',
    ['up', 'down', 'delete'].every((key) => (blockSheet?.items || []).some((item) => item.key === key)));
  blockAction('up', 1);
  expect('上移', request('mv') === '<p>二</p><p>一</p><p>三</p>', request('mv'));
  tap(handles()[0]);
  blockAction('down', 0);
  expect('下移', request('mv') === '<p>一</p><p>二</p><p>三</p>', request('mv'));
  tap(handles()[2]);
  blockAction('delete', 2);
  expect('删除', request('mv') === '<p>一</p><p>二</p>', request('mv'));

  // 手柄垂直居中且不重叠
  setContent('<p>甲</p><hr><p>乙</p>');
  const layoutEls = Array.from(view.dom.children) as Array<HTMLElement & { __top?: number; __height?: number }>;
  const layout = [[0, 28], [38, 1], [49, 28]];
  layoutEls.forEach((el, i) => { el.__top = layout[i][0]; el.__height = layout[i][1]; });
  view.dispatch(view.state.tr.insertText(''));
  const tops = Array.from(doc.querySelectorAll('[data-lsb-handle]')).map((el) => Number((el as HTMLElement).style.top.replace('px', '')));
  // 甲块居中=3；hr 太矮被下压到 28；乙块居中=52
  expect('手柄垂直居中', tops[0] === 3 && tops[2] === 52, `tops=${tops.join(',')}`);
  expect('手柄不重叠', tops.every((top, i) => i === 0 || top >= tops[i - 1] + 22), `tops=${tops.join(',')}`);

  // 底部「＋」插入块
  setContent('<p>第一段</p>');
  const addButton = () => doc.querySelector('[data-lsb-add]') as HTMLElement | null;
  expect('底部加号存在', Boolean(addButton()));
  messages.length = 0;
  click(addButton());
  const addSheet = lastSheet();
  expect('加号请求底部卡片', addSheet?.kind === 'add' && (addSheet.items || []).length === 10,
    `items=${(addSheet?.items || []).length}`);
  addBlock('h1');
  expect('插入标题 1', request('add') === '<p>第一段</p><h1></h1>', request('add'));
  click(addButton());
  addBlock('hr');
  expect('插入分割线并留出输入行', request('add') === '<p>第一段</p><h1></h1><hr><p></p>', request('add'));
  click(addButton());
  addBlock('ol');
  expect('插入有序列表', request('add').endsWith('<ol><li><p></p></li></ol>'), request('add'));

  // 拖动手柄排序
  setContent('<p>一</p><p>二</p><p>三</p>');
  const blockEls = Array.from(view.dom.children) as HTMLElement[];
  blockEls.forEach((el, i) => { (el as unknown as { __top?: number }).__top = i * 40; });
  const dragHandles = handles();
  pointer('pointerdown', dragHandles[0], 10);
  pointer('pointermove', dragHandles[0], 95);   // 落点在第三块上方 → 插到索引 2
  pointer('pointerup', dragHandles[0], 95);
  expect('拖拽排序', request('drag') === '<p>二</p><p>一</p><p>三</p>', request('drag'));

  // 非空块里点格式按钮：应在下面新增一行，而不是改掉已有内容
  setContent('<p>已有内容</p>');
  runCommand('h2');
  expect('非空段落点标题→新增一行', request('nl') === '<p>已有内容</p><h2>标题</h2>', request('nl'));
  setContent('<p>已有内容</p>');
  runCommand('ul');
  expect('非空段落点列表→新增一行', request('nl') === '<p>已有内容</p><ul><li><p>列表项</p></li></ul>', request('nl'));
  setContent('<p>已有内容</p>');
  runCommand('table');
  expect('非空段落点表格→新增一行', request('nl') === '<p>已有内容</p><table><tbody><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></tbody></table><p></p>', request('nl'));
  // 空块仍然就地转换
  setContent('');
  runCommand('h2');
  expect('空块点标题→就地转换', request('nl') === '<h2>标题</h2>', request('nl'));

  // 清空正文（原生按钮 → __lsbSetContent('')）
  setContent('<p>要清空的正文</p><h2>标题</h2>');
  (win.__lsbSetContent as (html: string) => void)('');
  expect('清空正文', request('clr') === '<p></p>', request('clr'));

  // 视频块：官方容器 → 内核 doc → 回写，保证不被吞掉
  setContent('<div class="nb-editor-youtube"><iframe src="https://www.youtube.com/embed/abc123XYZ_-"></iframe></div><p>文字</p>');
  expect('视频块保留', request('vid').includes('youtube.com/embed/abc123XYZ_-'), request('vid'));

  /**
   * 抖音：官网 iframe 由服务端生成，App 算不出 embed，所以绝不能产出 src="" 的空节点
   * （内核要求 src 非空，会把整个节点丢掉 → 富文本里视频消失）。这里锁住「原样保留链接」。
   */
  const douyinMd = '[抖音视频](https://www.douyin.com/video/7412345678901234567)';
  const douyinHtml = blocksToHtml(parseEditableArticle(douyinMd));
  expect('抖音不产出空 iframe', !/iframe[^>]*src=""/.test(douyinHtml), douyinHtml);
  setContent(douyinHtml);
  const douyinOut = request('dy');
  expect('抖音链接原样保留', douyinOut.includes('https://www.douyin.com/video/7412345678901234567'), douyinOut);
  expect(
    '抖音往返 markdown 不丢',
    blocksToMarkdown(parseEditableArticle(douyinOut)).includes('https://www.douyin.com/video/7412345678901234567'),
  );
  expect(
    '空 embed 视频块不产出坏节点',
    blocksToHtml([{ type: 'video', provider: 'douyin', embed: '', url: 'https://www.douyin.com/video/1' }]) === '',
  );

  const LOCKED_REPLY_VISIBLE = '<section class="nb-editor-reply-visible nb-editor-reply-visible-locked">'
    + '<div class="nb-editor-reply-visible-notice"><span aria-hidden="true">🔒</span>'
    + '<div><strong>回复后可见</strong><span>回复本主题后即可查看这部分内容。</span></div></div></section>';

  setContent('<p>测试文本</p>');
  runCommand('link', { href: 'https://linux.sb/t/1', text: '哔哩哔哩视频' });
  expect('命令 link', request('cmd').includes('<a href="https://linux.sb/t/1">哔哩哔哩视频</a>'));

  // 回复可见：官方 section → 内核 → markdown 标签；锁定块整段忽略，不把提示文案写进正文。
  const replyMd = '[回复可见]\n爱你哟！\n[/回复可见]';
  const replyHtml = blocksToHtml(parseEditableArticle(replyMd));
  expect('回复可见产出官方 section', replyHtml.includes('nb-editor-reply-visible-open') && replyHtml.includes('回复可见内容'));
  setContent(replyHtml);
  const replyOut = request('rv');
  expect('回复可见块保留', replyOut.includes('nb-editor-reply-visible-open') && replyOut.includes('爱你哟！'), replyOut.slice(0, 160));
  expect(
    '回复可见往返 markdown',
    blocksToMarkdown(parseEditableArticle(replyOut)).includes('[回复可见]')
      && blocksToMarkdown(parseEditableArticle(replyOut)).includes('爱你哟！'),
  );
  setContent('<p>已有内容</p>');
  runCommand('reply_visible', { html: '<p>秘密</p>' });
  const inserted = request('rvi');
  expect('命令 reply_visible', inserted.includes('nb-editor-reply-visible-open') && inserted.includes('秘密'), inserted.slice(0, 160));
  setContent(`${LOCKED_REPLY_VISIBLE}<p>公开段落</p>`);
  const lockedOut = request('rvl');
  expect('锁定块不进内核', !lockedOut.includes('回复后可见') && lockedOut.includes('公开段落'), lockedOut.slice(0, 160));

  console.log(skipped ? `\n${skipped} 项因 jsdom 布局 API 缺失跳过（真机 WebView 不受影响）` : '');
  console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
