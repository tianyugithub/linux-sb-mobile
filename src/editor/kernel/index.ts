/**
 * 所见即所得编辑内核（在 WebView 里运行）。
 *
 * 与原生侧的交换格式是 **HTML**，不是 markdown：
 *   原生 markdown --blocksToHtml--> HTML --本内核--> ProseMirror doc
 *   ProseMirror doc --DOMSerializer--> HTML --parseEditableArticle/blocksToMarkdown--> 原生 markdown
 * 这样内核不需要 markdown 解析器，且两侧的 HTML 契约由 blocks-html.ts 与 article.ts 共同保证。
 *
 * schema 只包含能落回 markdown 的节点（见 docs/wysiwyg-design.md §5）。
 */
import {
  DOMSerializer,
  DOMParser as PMDOMParser,
  Fragment,
  Schema,
  type Mark,
  type Node as PMNode,
  type NodeSpec,
  type MarkSpec,
} from 'prosemirror-model';
import { EditorState, Plugin, Selection, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history, redo, undo } from 'prosemirror-history';
import {
  baseKeymap,
  chainCommands,
  exitCode,
  setBlockType,
  toggleMark,
  wrapIn,
} from 'prosemirror-commands';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import {
  ellipsis,
  emDash,
  inputRules,
  smartQuotes,
  textblockTypeInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import { tableNodes } from 'prosemirror-tables';

type Tokens = Record<string, string>;
type Payload = Record<string, unknown> | undefined;

type Host = {
  post: (message: unknown) => void;
  tokens: Tokens;
  editable: boolean;
};

const ALIGNS = ['center', 'right'];

function alignAttrs(dom: HTMLElement): { textAlign: string | null } {
  const style = dom.getAttribute('style') || '';
  const inline = style.match(/text-align\s*:\s*(center|right|left)/i)?.[1];
  const attr = dom.getAttribute('align');
  const klass = dom.className.match(/align-(center|right|left)/)?.[1];
  const value = (inline || attr || klass || '').toLowerCase();
  return { textAlign: value === 'center' || value === 'right' ? value : null };
}

function alignDOM(attrs: { textAlign?: string | null }) {
  return attrs.textAlign && ALIGNS.includes(attrs.textAlign)
    ? { style: `text-align:${attrs.textAlign}` }
    : {};
}

const listNodes = (() => {
  const nodes = ((): Record<string, NodeSpec> => ({
    ordered_list: {
      content: 'list_item+',
      group: 'block',
      attrs: { order: { default: 1 } },
      parseDOM: [{ tag: 'ol', getAttrs: (dom) => ({ order: Number((dom as HTMLElement).getAttribute('start') || 1) }) }],
      toDOM: (node) => (node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0]),
    },
    bullet_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
    list_item: {
      content: 'paragraph block*',
      defining: true,
      parseDOM: [{ tag: 'li' }],
      toDOM: () => ['li', 0],
    },
  }))();
  return nodes;
})();

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: { textAlign: { default: null } },
      parseDOM: [{ tag: 'p', getAttrs: (dom) => alignAttrs(dom as HTMLElement) }],
      toDOM: (node) => ['p', alignDOM(node.attrs), 0],
    },
    heading: {
      content: 'inline*',
      group: 'block',
      defining: true,
      attrs: { level: { default: 2 }, textAlign: { default: null } },
      parseDOM: [1, 2, 3].map((level) => ({
        tag: `h${level}`,
        attrs: { level },
        getAttrs: (dom: HTMLElement | string) => ({ level, ...alignAttrs(dom as HTMLElement) }),
      })),
      toDOM: (node) => [`h${node.attrs.level}`, alignDOM(node.attrs), 0],
    },
    blockquote: {
      content: 'block+',
      group: 'block',
      defining: true,
      attrs: { textAlign: { default: null } },
      parseDOM: [{ tag: 'blockquote', getAttrs: (dom) => alignAttrs(dom as HTMLElement) }],
      toDOM: (node) => ['blockquote', alignDOM(node.attrs), 0],
    },
    reply_visible: {
      content: 'block+',
      group: 'block',
      defining: true,
      parseDOM: [
        {
          tag: 'section[class*="nb-editor-reply-visible-locked"]',
          ignore: true,
        },
        {
          tag: 'section[class*="nb-editor-reply-visible"]',
          contentElement: (dom) => {
            const el = dom as HTMLElement;
            const body = el.querySelector('.nb-editor-reply-visible-body');
            if (body) return body as HTMLElement;
            const holder = el.ownerDocument.createElement('div');
            Array.from(el.childNodes).forEach((child) => {
              if (child.nodeType === 1) {
                const klass = (child as HTMLElement).className || '';
                if (/\bnb-editor-reply-visible-(?:label|notice|body)\b/.test(klass)) return;
              }
              holder.appendChild(child.cloneNode(true));
            });
            return holder;
          },
        },
      ],
      // 内容洞必须是其父节点的唯一子节点（ProseMirror 约束），所以正文套一层 body。
      toDOM: () => [
        'section',
        { class: 'nb-editor-reply-visible nb-editor-reply-visible-open' },
        ['div', { class: 'nb-editor-reply-visible-label', contenteditable: 'false' }, '回复可见内容'],
        ['div', { class: 'nb-editor-reply-visible-body' }, 0],
      ],
    },
    horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
    code_block: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      attrs: { language: { default: null } },
      parseDOM: [
        {
          tag: 'pre',
          preserveWhitespace: 'full',
          getAttrs: (dom) => {
            const code = (dom as HTMLElement).querySelector('code');
            const klass = `${code?.className || ''} ${(dom as HTMLElement).className || ''}`;
            const language = klass.match(/(?:language|lang)-([a-zA-Z0-9_+-]+)/)?.[1] || null;
            return { language };
          },
        },
      ],
      toDOM: (node) => ['pre', { class: 'lsb-code' }, ['code', node.attrs.language ? { class: `language-${node.attrs.language}` } : {}, 0]],
    },
    video: {
      group: 'block',
      atom: true,
      draggable: false,
      attrs: {
        provider: { default: 'youtube' },
        embed: { default: '' },
        url: { default: '' },
      },
      parseDOM: [
        {
          tag: 'div[class*="nb-editor-"]',
          getAttrs: (dom) => {
            const el = dom as HTMLElement;
            const frame = el.querySelector('iframe');
            const src = frame?.getAttribute('src') || '';
            if (!src) return false;
            const klass = el.className || '';
            const provider = /douyin/.test(klass + src) ? 'douyin' : /bilibili/.test(klass + src) ? 'bilibili' : 'youtube';
            return { provider, embed: src, url: src };
          },
        },
        {
          tag: 'iframe[src]',
          getAttrs: (dom) => {
            const src = (dom as HTMLElement).getAttribute('src') || '';
            if (!src) return false;
            const provider = /douyin/.test(src) ? 'douyin' : /bilibili/.test(src) ? 'bilibili' : 'youtube';
            return { provider, embed: src, url: src };
          },
        },
      ],
      toDOM: (node) => [
        'div',
        { class: `nb-editor-${node.attrs.provider}` },
        ['iframe', { src: node.attrs.embed, allowfullscreen: 'true', loading: 'lazy' }],
      ],
    },
    image: {
      group: 'block',
      atom: true,
      draggable: true,
      attrs: { src: {}, alt: { default: null }, align: { default: null } },
      parseDOM: [
        {
          tag: 'figure',
          getAttrs: (dom) => {
            const el = dom as HTMLElement;
            const img = el.querySelector('img');
            const caption = el.querySelector('figcaption');
            const klass = el.className.match(/align-(center|right)/)?.[1] || null;
            return {
              src: img?.getAttribute('src') || null,
              alt: (caption?.textContent || img?.getAttribute('alt') || '').trim() || null,
              align: klass,
            };
          },
        },
        {
          tag: 'img[src]',
          getAttrs: (dom) => ({
            src: (dom as HTMLElement).getAttribute('src'),
            alt: (dom as HTMLElement).getAttribute('alt') || null,
            align: null,
          }),
        },
      ],
      toDOM: (node) => {
        const align = node.attrs.align && ALIGNS.includes(node.attrs.align) ? ` align-${node.attrs.align}` : '';
        return [
          'figure',
          { class: `lsb-figure${align}` },
          ['img', { src: node.attrs.src, alt: node.attrs.alt || '' }],
          ...(node.attrs.alt ? [['figcaption', node.attrs.alt]] : []),
        ];
      },
    },
    ...listNodes,
    ...tableNodes({
      tableGroup: 'block',
      cellContent: 'inline*',
      cellAttributes: {
        textAlign: {
          default: null,
          getFromDOM: (dom) => alignAttrs(dom).textAlign,
          setDOMAttr: (value, attrs) => {
            if (value) attrs.style = `text-align:${String(value)}`;
          },
        },
      },
    }),
  },
  marks: {
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
    strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }], toDOM: () => ['s', 0] },
    code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href') }) }],
      toDOM: (mark) => ['a', { href: mark.attrs.href }, 0],
    },
  } as Record<string, MarkSpec>,
});

function docToHtml(doc: PMNode): string {
  const holder = document.createElement('div');
  holder.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
  return holder.innerHTML;
}

function htmlToDoc(html: string): PMNode {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  return PMDOMParser.fromSchema(schema).parse(holder);
}

/**
 * 空文档时给唯一段落加一个装饰类，让 CSS 能显示预设文字。
 * 不能用 `p:empty::before`：ProseMirror 会在空段落里插 <br class="ProseMirror-trailingBreak">。
 */
function placeholderPlugin(text: string) {
  return new Plugin({
    props: {
      decorations(state) {
        if (!text || state.doc.childCount !== 1) return null;
        const first = state.doc.firstChild;
        if (!first || first.type.name !== 'paragraph' || first.content.size > 0) return null;
        return DecorationSet.create(state.doc, [Decoration.node(0, first.nodeSize, { class: 'lsb-placeholder' })]);
      },
    },
  });
}

/**
 * 每个顶层块右侧的「⋮」手柄 + 菜单（上移 / 下移 / 删除）。
 *
 * 不往 ProseMirror 的 DOM 里塞按钮，而是在编辑器旁边挂一层绝对定位的手柄，
 * 每次更新按块的真实位置重新排布——这样不会干扰内核的渲染与选区。
 */
type BlockRef = { offset: number; node: PMNode; el: HTMLElement };

const HANDLE_ACTIONS: Array<{ key: string; label: string; glyph: string; danger?: boolean }> = [
  { key: 'up', label: '上移', glyph: '↑' },
  { key: 'down', label: '下移', glyph: '↓' },
  { key: 'delete', label: '删除', glyph: '✕', danger: true },
];

/** 底部「＋」可选插入的块类型（与工具栏的格式一一对应）。 */
const ADD_TYPES: Array<{ key: string; label: string; glyph: string }> = [
  { key: 'paragraph', label: '正文', glyph: '¶' },
  { key: 'h1', label: '标题 1', glyph: 'H1' },
  { key: 'h2', label: '标题 2', glyph: 'H2' },
  { key: 'h3', label: '标题 3', glyph: 'H3' },
  { key: 'quote', label: '引用', glyph: '❝' },
  { key: 'ul', label: '无序列表', glyph: '•' },
  { key: 'ol', label: '有序列表', glyph: '1.' },
  { key: 'code', label: '代码块', glyph: '</>' },
  { key: 'table', label: '表格', glyph: '⊞' },
  { key: 'hr', label: '分割线', glyph: '—' },
];

function createBlockNode(kind: string): PMNode | null {
  const paragraph = () => schema.nodes.paragraph.create();
  if (kind === 'paragraph') return paragraph();
  if (kind === 'h1' || kind === 'h2' || kind === 'h3') {
    return schema.nodes.heading.create({ level: Number(kind.slice(1)) });
  }
  if (kind === 'quote') return schema.nodes.blockquote.create(null, paragraph());
  if (kind === 'ul' || kind === 'ol') {
    const item = schema.nodes.list_item.create(null, paragraph());
    const list = kind === 'ul' ? schema.nodes.bullet_list : schema.nodes.ordered_list;
    return list.create(null, item);
  }
  if (kind === 'code') return schema.nodes.code_block.create();
  if (kind === 'table') return buildTable(3, 3);
  if (kind === 'hr') return schema.nodes.horizontal_rule.create();
  return null;
}

type DragState = {
  index: number;
  pointerId: number;
  startY: number;
  originalTop: number;
  moved: boolean;
  target: number | null;
  handle: HTMLElement;
  indicator: HTMLElement;
};

class BlockHandles {
  private view: EditorView;
  private post: (message: unknown) => void;
  private container: HTMLDivElement;
  private addBar: HTMLDivElement;
  private drag: DragState | null = null;

  constructor(view: EditorView, post: (message: unknown) => void) {
    this.view = view;
    this.post = post;
    this.container = document.createElement('div');
    this.container.className = 'lsb-handles';
    this.addBar = document.createElement('div');
    this.addBar.className = 'lsb-add';
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'lsb-add-btn';
    addButton.textContent = '＋';
    addButton.setAttribute('aria-label', '添加块');
    addButton.dataset.lsbAdd = '1';
    this.addBar.appendChild(addButton);
    this.addBar.addEventListener('click', this.onClick);
    this.container.addEventListener('click', this.onClick);
    this.container.addEventListener('pointerdown', this.onPointerDown);
    this.container.addEventListener('pointermove', this.onPointerMove);
    this.container.addEventListener('pointerup', this.onPointerUp);
    this.container.addEventListener('pointercancel', this.onPointerCancel);
    this.update();
    window.addEventListener('resize', this.update);
  }

  destroy() {
    window.removeEventListener('resize', this.update);
    this.container.remove();
    this.addBar.remove();
  }

  update = () => {
    const parent = this.view.dom.parentNode;
    if (!parent) return;
    if (this.container.parentNode !== parent) parent.appendChild(this.container);
    if (this.drag) return;
    this.container.textContent = '';
    if (!this.view.editable) return;
    const blocks = this.collect();
    const size = 22;
    let floor = -Infinity;
    blocks.forEach((block, index) => {
      // 垂直居中于所在块；块太矮时依次下压，避免相邻手柄叠在一起。
      const center = block.el.offsetTop + block.el.offsetHeight / 2;
      const top = Math.max(0, Math.max(Math.round(center - size / 2), floor));
      floor = top + size + 2;
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'lsb-handle';
      handle.textContent = '⋮';
      handle.setAttribute('aria-label', '块菜单');
      handle.dataset.lsbHandle = String(index);
      handle.style.top = `${top}px`;
      this.container.appendChild(handle);
    });
    this.ensureAddButton();
  };

  /** 底部常驻的「＋」：点开选块类型，插入后自动聚焦并留出输入空间。 */
  private ensureAddButton() {
    const parent = this.view.dom.parentNode;
    if (!parent) return;
    const bar = this.addBar;
    if (bar.parentNode !== parent) parent.appendChild(bar);
    else if (bar !== parent.lastChild) parent.appendChild(bar);
  }

  /** 手机端不用浮层：把菜单项交给原生，弹底部上滑卡片。 */
  private requestSheet(kind: 'block' | 'add', index = -1) {
    const source = kind === 'add' ? ADD_TYPES : HANDLE_ACTIONS;
    this.post({
      type: 'sheet',
      kind,
      index,
      items: source.map((item) => ({
        key: item.key,
        label: item.label,
        glyph: item.glyph,
        danger: 'danger' in item ? Boolean(item.danger) : false,
      })),
    });
  }

  /** 在文档末尾插入一个块；能直接打字的就聚焦到块内，否则补一个空段落。 */
  addBlock(kind: string) {
    const node = createBlockNode(kind);
    if (!node) return;
    const end = this.view.state.doc.content.size;
    const transaction = this.view.state.tr;
    transaction.insert(end, node);
    let caret = end + 1;
    if (!node.isTextblock && node.type.name === 'horizontal_rule') {
      transaction.insert(end + node.nodeSize, schema.nodes.paragraph.create());
      caret = end + node.nodeSize + 1;
    }
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(caret), 1));
    this.view.dispatch(transaction.scrollIntoView());
    this.view.focus();
    this.update();
  }

  private collect(): BlockRef[] {
    const children = Array.from(this.view.dom.children) as HTMLElement[];
    const blocks: BlockRef[] = [];
    this.view.state.doc.forEach((node, offset, index) => {
      const el = children[index];
      if (el) blocks.push({ offset, node, el });
    });
    return blocks;
  }

  private onPointerDown = (event: PointerEvent) => {
    const handle = (event.target as HTMLElement | null)?.closest?.('[data-lsb-handle]') as HTMLElement | null;
    if (!handle || !this.view.editable) return;
    const index = Number(handle.dataset.lsbHandle || '-1');
    const blocks = this.collect();
    if (!blocks[index]) return;
    event.preventDefault();
    const indicator = document.createElement('div');
    indicator.className = 'lsb-drop';
    this.container.appendChild(indicator);
    blocks[index].el.classList.add('lsb-dragging');
    handle.classList.add('lsb-handle-dragging');
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* 忽略 */
    }
    this.drag = {
      index,
      pointerId: event.pointerId,
      startY: event.clientY,
      originalTop: handle.offsetTop,
      moved: false,
      target: null,
      handle,
      indicator,
    };
    // 让 WebView 抢住手势，避免父级 ScrollView 中途把拖动抢走
    this.post({ type: 'drag', on: true });
  };

  private onPointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 6) return;
    drag.moved = true;
    drag.handle.style.top = `${event.clientY - 11}px`;
    const blocks = this.collect();
    let target = blocks.length;
    for (let i = 0; i < blocks.length; i += 1) {
      const rect = blocks[i].el.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        target = i;
        break;
      }
    }
    drag.target = target;
    const last = blocks[blocks.length - 1];
    const top = target < blocks.length
      ? blocks[target].el.offsetTop - 3
      : last.el.offsetTop + last.el.offsetHeight + 1;
    drag.indicator.style.top = `${top}px`;
    drag.indicator.style.display = 'block';
  };

  private onPointerUp = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { index, target, moved } = drag;
    this.endDrag();
    if (!moved) {
      this.requestSheet('block', index);
      return;
    }
    if (target === null || target === index || target === index + 1) return;
    this.move(index, target);
  };

  private onPointerCancel = () => this.endDrag();

  private endDrag() {
    const drag = this.drag;
    if (!drag) return;
    drag.handle.style.top = `${drag.originalTop}px`;
    drag.handle.classList.remove('lsb-handle-dragging');
    drag.indicator.remove();
    this.view.dom.querySelectorAll('.lsb-dragging').forEach((el) => el.classList.remove('lsb-dragging'));
    this.drag = null;
    this.post({ type: 'drag', on: false });
    this.update();
  }

  private move(index: number, target: number) {
    const blocks = this.collect();
    const source = blocks[index];
    if (!source) return;
    const { offset, node } = source;
    const transaction = this.view.state.tr;
    transaction.delete(offset, offset + node.nodeSize);
    const end = this.view.state.doc.content.size;
    const insertAt = target >= blocks.length
      ? end - node.nodeSize
      : (target <= index ? blocks[target].offset : blocks[target].offset - node.nodeSize);
    transaction.insert(insertAt, node);
    this.view.dispatch(transaction.scrollIntoView());
    this.view.focus();
  }

  private onClick = (event: Event) => {
    const node = event.target as HTMLElement | null;
    if (node?.closest?.('[data-lsb-add]')) {
      event.preventDefault();
      this.requestSheet('add');
    }
  };

  run(action: string, index: number) {
    const blocks = this.collect();
    const target = blocks[index];
    if (!target) return;
    const { offset, node } = target;
    const transaction = this.view.state.tr;
    if (action === 'delete') {
      transaction.delete(offset, offset + node.nodeSize);
    } else if (action === 'up' && index > 0) {
      const prev = blocks[index - 1];
      transaction.delete(offset, offset + node.nodeSize);
      transaction.insert(prev.offset, node);
    } else if (action === 'down' && index < blocks.length - 1) {
      const next = blocks[index + 1];
      transaction.delete(offset, offset + node.nodeSize);
      transaction.insert(next.offset - node.nodeSize + next.node.nodeSize, node);
    } else {
      return;
    }
    this.view.dispatch(transaction.scrollIntoView());
    this.view.focus();
  }
}

function buildTable(rows: number, cols: number): PMNode {
  const cell = () => schema.nodes.table_cell.createAndFill();
  const row = () => schema.nodes.table_row.create(null, Array.from({ length: cols }, cell).filter(Boolean) as PMNode[]);
  return schema.nodes.table.create(null, Array.from({ length: rows }, row).filter(Boolean) as PMNode[]);
}

export function mount(options: { tokens: Tokens; html: string; editable: boolean; placeholder?: string }) {
  const host: Host = { post: () => {}, tokens: options.tokens, editable: options.editable };
  const target = document.getElementById('doc');
  if (!target) throw new Error('NO_TARGET');

  host.post = (message: unknown) => {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  };

  let changeTimer = 0;
  let stateTimer = 0;
  let blockHandles: BlockHandles | null = null;

  const view = new EditorView(target, {
    state: EditorState.create({
      doc: htmlToDoc(options.html),
      plugins: [
        placeholderPlugin(options.placeholder || ''),
        new Plugin({
          view: (editorView) => {
            blockHandles = new BlockHandles(editorView, host.post);
            return blockHandles;
          },
        }),
        inputRules({
          rules: [
            textblockTypeInputRule(/^(#{1,3})\s$/, schema.nodes.heading, (match) => ({ level: match[1].length })),
            textblockTypeInputRule(/^```$/, schema.nodes.code_block),
            wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
            wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list),
            wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list, (match) => ({ order: Number(match[1]) })),
            ...smartQuotes,
            ellipsis,
            emDash,
          ],
        }),
        history(),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Shift-Mod-z': redo,
          'Shift-Enter': (state, dispatch) => {
            if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
            return true;
          },
          'Mod-b': toggleMark(schema.marks.strong),
          'Mod-i': toggleMark(schema.marks.em),
          Enter: chainCommands(splitListItem(schema.nodes.list_item), (state, dispatch) => {
            if (state.selection.$from.parent.type !== schema.nodes.code_block) return false;
            if (dispatch) dispatch(state.tr.insertText('\n'));
            return true;
          }),
          Tab: sinkListItem(schema.nodes.list_item),
          'Shift-Tab': liftListItem(schema.nodes.list_item),
          Backspace: chainCommands(exitCode, (state, dispatch) => {
            const { $from, empty } = state.selection;
            if (!empty || $from.parentOffset > 0) return false;
            const parent = $from.parent;
            if (parent.type !== schema.nodes.code_block && parent.type !== schema.nodes.heading) return false;
            if (dispatch) dispatch(state.tr.setBlockType($from.before(), $from.after(), schema.nodes.paragraph));
            return true;
          }),
        }),
        keymap(baseKeymap),
      ],
    }),
    editable: () => host.editable,
    /**
     * 安卓输入法在代码块里按回车，往往不产生 keydown（只发 beforeinput / 或 keyCode 229），
     * 所以这里两条通道都接住，避免代码块里换不了行。
     */
    handleDOMEvents: {
      keydown(view, event) {
        const keyboard = event as KeyboardEvent;
        if (keyboard.key !== 'Enter' || keyboard.isComposing || keyboard.keyCode === 229) return false;
        if (view.state.selection.$from.parent.type !== schema.nodes.code_block) return false;
        keyboard.preventDefault();
        view.dispatch(view.state.tr.insertText('\n').scrollIntoView());
        return true;
      },
      beforeinput(view, event) {
        const input = event as InputEvent;
        const kind = input.inputType || '';
        if (kind !== 'insertParagraph' && kind !== 'insertLineBreak') return false;
        if (view.state.selection.$from.parent.type !== schema.nodes.code_block) return false;
        input.preventDefault();
        view.dispatch(view.state.tr.insertText('\n').scrollIntoView());
        return true;
      },
    },
    dispatchTransaction(transaction: Transaction) {
      const next = view.state.apply(transaction);
      view.updateState(next);
      if (transaction.docChanged) {
        window.clearTimeout(changeTimer);
        changeTimer = window.setTimeout(() => host.post({ type: 'change', html: docToHtml(next.doc) }), 250);
      }
      window.clearTimeout(stateTimer);
      stateTimer = window.setTimeout(() => host.post({ type: 'state', ...readState(next) }), 60);
    },
    attributes: { class: 'lsb-doc', 'data-placeholder': options.placeholder || '' },
  });

  function readState(state: EditorState) {
    const { $from, from, to, empty } = state.selection;
    const marks: Record<string, boolean> = {};
    for (const name of ['strong', 'em', 'strike', 'code', 'link']) {
      const mark = schema.marks[name];
      marks[name] = mark ? (empty ? mark.isInSet($from.marks()) !== undefined : state.doc.rangeHasMark(from, to, mark)) : false;
    }
    const parent = $from.parent;
    let block = parent.type.name;
    let ordered = false;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const name = $from.node(depth).type.name;
      if (name === 'bullet_list' || name === 'ordered_list') {
        block = 'list';
        ordered = name === 'ordered_list';
      } else if (name === 'blockquote') block = 'quote';
      else if (name === 'code_block') block = 'code_block';
    }
    return {
      marks,
      block,
      level: parent.type.name === 'heading' ? parent.attrs.level : 0,
      ordered,
      align: (parent.attrs.textAlign as string | null) || null,
    };
  }

  let heightTimer = 0;
  const measure = () => {
    window.clearTimeout(heightTimer);
    heightTimer = window.setTimeout(() => {
      host.post({ type: 'height', px: Math.ceil(document.body.scrollHeight) });
    }, 50);
  };
  if (window.ResizeObserver) {
    try {
      new ResizeObserver(measure).observe(document.body);
    } catch (error) { /* ignore */ }
  }

  const command = (name: string, payload: Payload) => {
    const run = (fn: Command) => {
      const handled = fn(view.state, view.dispatch, view);
      view.focus();
      return handled;
    };

    /** 与代码模式一致：光标处插入占位文字并选中，告诉用户这个格式是干嘛的。 */
    const insertPlaceholder = (text: string, mark?: Mark) => {
      const transaction = view.state.tr;
      transaction.replaceSelectionWith(schema.text(text, mark ? [mark] : []), false);
      const end = transaction.selection.from;
      transaction.setSelection(TextSelection.create(transaction.doc, Math.max(0, end - text.length), end));
      view.dispatch(transaction.scrollIntoView());
    };
    const emptyBlock = () => {
      const { $from } = view.state.selection;
      return $from.parent.isTextblock && $from.parent.content.size === 0;
    };
    const markCommand = (name: 'strong' | 'em' | 'strike' | 'code', text: string) => {
      const mark = schema.marks[name];
      if (!view.state.selection.empty) return toggleMark(mark)(view.state, view.dispatch, view);
      insertPlaceholder(text, mark.create());
      return true;
    };
    /** 选区所在的顶层块（含偏移量）。 */
    const topBlock = () => {
      const pos = view.state.selection.$from.pos;
      const doc = view.state.doc;
      let offset = 0;
      for (let i = 0; i < doc.childCount; i += 1) {
        const node = doc.child(i);
        if (pos >= offset && pos <= offset + node.nodeSize) return { offset, node };
        offset += node.nodeSize;
      }
      return null;
    };
    /** 在指定位置插入块、落好光标、必要时补一个空段落。 */
    const finishInsert = (transaction: Transaction, at: number, node: PMNode, text: string) => {
      transaction.insert(at, node);
      const canType = node.isTextblock
        || ['blockquote', 'bullet_list', 'ordered_list'].includes(node.type.name);
      let caret = at + 1;
      // 表格光标落在第一个单元格，但后面仍补一行，方便从表格里出来继续写。
      if (!canType || node.type.name === 'table') {
        transaction.insert(at + node.nodeSize, schema.nodes.paragraph.create());
        if (!canType) caret = at + node.nodeSize + 1;
      }
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(caret), 1));
      if (text) {
        const from = transaction.selection.from;
        transaction.insertText(text, from);
        transaction.setSelection(TextSelection.create(transaction.doc, from, from + text.length));
      }
      view.dispatch(transaction.scrollIntoView());
      return true;
    };
    /** 在当前块之后新增一个块（"每次点击增加一行"）。 */
    const insertAfterCurrent = (kind: string, text: string) => {
      const node = createBlockNode(kind);
      const target = topBlock();
      if (!node || !target) return false;
      return finishInsert(view.state.tr, target.offset + target.node.nodeSize, node, text);
    };
    /** 空块就地转换；非空块则在下面新增一行，避免把用户已有的内容改掉。 */
    const blockCommand = (kind: string, base: Command, text: string) => {
      if (!emptyBlock()) return insertAfterCurrent(kind, text);
      const handled = base(view.state, view.dispatch, view);
      if (handled && text) insertPlaceholder(text);
      return handled;
    };
    switch (name) {
      case 'bold': return run(() => markCommand('strong', '粗体文字'));
      case 'italic': return run(() => markCommand('em', '斜体文字'));
      case 'strike': return run(() => markCommand('strike', '删除线文字'));
      case 'inline-code': return run(() => markCommand('code', '代码'));
      case 'h1': return run(() => blockCommand('h1', setBlockType(schema.nodes.heading, { level: 1 }), '标题'));
      case 'h2': return run(() => blockCommand('h2', setBlockType(schema.nodes.heading, { level: 2 }), '标题'));
      case 'h3': return run(() => blockCommand('h3', setBlockType(schema.nodes.heading, { level: 3 }), '标题'));
      case 'paragraph': return run(setBlockType(schema.nodes.paragraph));
      case 'quote': return run(() => blockCommand('quote', wrapIn(schema.nodes.blockquote), '引用内容'));
      case 'ul': return run(() => blockCommand('ul', wrapInList(schema.nodes.bullet_list), '列表项'));
      case 'ol': return run(() => blockCommand('ol', wrapInList(schema.nodes.ordered_list), '列表项'));
      case 'codeblock': return run(() => blockCommand('code', setBlockType(schema.nodes.code_block), '代码'));
      case 'hr': return run(() => {
        if (!emptyBlock()) return insertAfterCurrent('hr', '');
        const node = schema.nodes.horizontal_rule.create();
        return finishInsert(view.state.tr, view.state.selection.from, node, '') || true;
      });
      case 'image': {
        const src = String(payload?.src || '');
        if (!src) return false;
        const node = schema.nodes.image.create({ src, alt: payload?.alt ? String(payload.alt) : null });
        view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
        return true;
      }
      case 'table': {
        if (!emptyBlock()) return insertAfterCurrent('table', '');
        const at = view.state.selection.from;
        return finishInsert(view.state.tr, at, buildTable(3, 3), '');
      }
      case 'link': {
        const href = String(payload?.href || '');
        if (!href) return false;
        const text = String(payload?.text || href);
        // 第二个参数 false：不要让光标处的 marks 覆盖链接标记
        view.dispatch(view.state.tr.replaceSelectionWith(schema.text(text, [schema.marks.link.create({ href })]), false).scrollIntoView());
        return true;
      }
      case 'reply_visible': {
        const html = String(payload?.html || '').trim();
        const inner = htmlToDoc(html || '<p></p>').content;
        const content = inner.size ? inner : Fragment.from(schema.nodes.paragraph.create());
        const node = schema.nodes.reply_visible.create(null, content);
        if (!emptyBlock()) {
          const target = topBlock();
          if (!target) return false;
          return finishInsert(view.state.tr, target.offset + target.node.nodeSize, node, '');
        }
        return finishInsert(view.state.tr, view.state.selection.from, node, '');
      }
      case 'text': {
        const text = String(payload?.text || '');
        if (!text) return false;
        view.dispatch(view.state.tr.insertText(text).scrollIntoView());
        return true;
      }
      default: return false;
    }
  };

  /**
   * 用事务替换文档，而不是新建 EditorState：
   * EditorState.create 会生成新的 plugins 数组，导致 ProseMirror 销毁并重建所有插件视图
   * （块手柄会因此留下一个失效实例的 DOM）。
   */
  (window as unknown as Record<string, unknown>).__lsbSetContent = (html: string) => {
    const next = htmlToDoc(html);
    const transaction = view.state.tr.replaceWith(0, view.state.doc.content.size, next.content);
    transaction.setSelection(Selection.atStart(transaction.doc));
    view.dispatch(transaction);
    measure();
  };
  (window as unknown as Record<string, unknown>).__lsbSetTheme = (tokens: Tokens) => {
    const root = document.documentElement;
    Object.keys(tokens).forEach((key) => root.style.setProperty(`--${key}`, tokens[key]));
  };
  (window as unknown as Record<string, unknown>).__lsbSetEditable = (on: boolean) => {
    host.editable = on;
    view.setProps({ editable: () => on });
  };
  (window as unknown as Record<string, unknown>).__lsbCommand = command;
  (window as unknown as Record<string, unknown>).__lsbBlockAction = (action: string, index: number) => {
    blockHandles?.run(String(action), Number(index));
  };
  (window as unknown as Record<string, unknown>).__lsbAddBlock = (kind: string) => {
    blockHandles?.addBlock(String(kind));
  };
  (window as unknown as Record<string, unknown>).__lsbRequestHtml = (tag: string) => {
    host.post({ type: 'html', html: docToHtml(view.state.doc), tag: tag || '' });
  };
  (window as unknown as Record<string, unknown>).__lsbFocus = () => view.focus();

  document.addEventListener('click', (event) => {
    const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
    if (!anchor) return;
    event.preventDefault();
    host.post({ type: 'link', href: anchor.getAttribute('href') || '' });
  }, true);

  measure();
  host.post({ type: 'ready' });
  host.post({ type: 'state', ...readState(view.state) });
  return view;
}
