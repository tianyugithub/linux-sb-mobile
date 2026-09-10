import type { Caret } from '../utils/markdown-edit';

/** 工具条按钮高亮所需的选区状态，两种模式产出同一形状。 */
export type EditorSnapshot = {
  marks: Record<string, boolean>;
  block: string;
  level: number;
  ordered: boolean;
  align: 'center' | 'right' | null;
};

export const EMPTY_SNAPSHOT: EditorSnapshot = {
  marks: {},
  block: 'paragraph',
  level: 0,
  ordered: false,
  align: null,
};

export function sameSnapshot(a: EditorSnapshot | null, b: EditorSnapshot): boolean {
  if (!a) return false;
  return a.block === b.block
    && a.level === b.level
    && a.ordered === b.ordered
    && a.align === b.align
    && a.marks.strong === b.marks.strong
    && a.marks.em === b.marks.em
    && a.marks.strike === b.marks.strike
    && a.marks.code === b.marks.code;
}

/**
 * 代码模式（原生 TextInput）下的状态推导：只看光标所在行与选区两侧的标记。
 * 所见即所得模式由内核回传真实状态，不需要这个。
 */
export function sourceSnapshot(value: string, caret: Caret): EditorSnapshot {
  const start = Math.max(0, Math.min(caret.start, value.length));
  const end = Math.max(start, Math.min(caret.end, value.length));
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const breakAt = value.indexOf('\n', end);
  const lineEnd = breakAt < 0 ? value.length : breakAt;
  const line = value.slice(lineStart, lineEnd);
  const before = value.slice(lineStart, start);
  const after = value.slice(end, lineEnd);
  const selected = value.slice(start, end);

  // 光标左侧出现奇数个标记 → 处于该标记的区间内（`**a** 和 **b**` 中间也不会误判）。
  const parity = (marker: string) => {
    let count = 0;
    let index = 0;
    for (;;) {
      const at = before.indexOf(marker, index);
      if (at < 0) break;
      count += 1;
      index = at + marker.length;
    }
    return count % 2 === 1;
  };
  const selectedWraps = (open: string, close: string) => (
    selected.length > open.length + close.length && selected.startsWith(open) && selected.endsWith(close)
  );

  const fence = /^\s*```/.test(line);
  const bold = parity('**') || parity('__') || selectedWraps('**', '**');
  const heading = line.match(/^\s{0,3}(#{1,3})\s/);
  const quote = /^\s{0,3}>\s/.test(line);
  const bullet = /^\s*[-+*]\s/.test(line);
  const ordered = /^\s*\d+\.\s/.test(line);
  const align = line.match(/text-align\s*:\s*(center|right)/)?.[1];

  return {
    marks: {
      strong: bold,
      em: !bold && (parity('*') || parity('_') || selectedWraps('*', '*')),
      strike: parity('~~') || selectedWraps('~~', '~~'),
      code: !fence && (parity('`') || selectedWraps('`', '`')),
    },
    block: fence ? 'code_block' : heading ? 'heading' : quote ? 'quote' : (bullet || ordered) ? 'list' : 'paragraph',
    level: heading ? heading[1].length : 0,
    ordered: ordered && !bullet,
    align: align === 'center' || align === 'right' ? align : null,
  };
}
