import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { editorPage, editorTokens, type EditorTokens } from '../editor/editor-page';
import type { EditorSnapshot } from '../editor/snapshot';
import { styles } from '../theme/app-styles';
import { C } from '../theme/palette';

/**
 * 所见即所得编辑器容器（WebView + ProseMirror 内核）。
 *
 * 交换格式是 HTML（内核不需要 markdown 解析器）：
 *   原生 markdown → blocksToHtml → 内核 doc
 *   内核 doc → DOMSerializer → HTML → parseEditableArticle/blocksToMarkdown → 原生 markdown
 *
 * 协议（见 docs/wysiwyg-design.md §6）：
 *   RN → WV  __lsbSetContent(html) / __lsbSetTheme(tokens) / __lsbSetEditable(bool)
 *            __lsbCommand(name, payload) / __lsbRequestHtml(tag) / __lsbFocus()
 *   WV → RN  {type:'ready'} {type:'change',html} {type:'state',...} {type:'height',px}
 *            {type:'html',html,tag} {type:'link',href} {type:'error',message}
 */

export type { EditorSnapshot };

export type SheetRequest = {
  kind: 'block' | 'add';
  index: number;
  items: Array<{ key: string; label: string; glyph: string; danger: boolean }>;
};

export type RichEditorHandle = {
  command: (name: string, payload?: Record<string, unknown>) => void;
  reset: () => void;
  blockAction: (action: string, index: number) => void;
  addBlock: (kind: string) => void;
  flush: () => Promise<string>;
  focus: () => void;
};

type Props = {
  html: string;
  minHeight?: number;
  maxHeight?: number;
  editable?: boolean;
  compact?: boolean;
  placeholder?: string;
  onChange?: (html: string) => void;
  onState?: (snapshot: EditorSnapshot) => void;
  onLink?: (href: string) => void;
  onReady?: () => void;
  onSheet?: (request: SheetRequest) => void;
};

type Message =
  | { type: 'ready' }
  | { type: 'height'; px: number }
  | { type: 'change'; html: string }
  | { type: 'html'; html: string; tag?: string }
  | { type: 'link'; href: string }
  | { type: 'error'; message?: string }
  | { type: 'drag'; on?: boolean }
  | ({ type: 'sheet' } & SheetRequest)
  | ({ type: 'state' } & EditorSnapshot);

const FLUSH_TIMEOUT = 600;

export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor({
  html,
  minHeight = 190,
  maxHeight = 520,
  editable = true,
  compact = false,
  placeholder,
  onChange,
  onState,
  onLink,
  onReady,
  onSheet,
}, ref) {
  const viewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  // 外壳有 12px 内边距，内核高度按内容区算，保证与代码模式的输入框总高一致。
  const innerMin = Math.max(80, minHeight - 24);
  const [height, setHeight] = useState(innerMin);
  const pending = useRef<{ resolve: (html: string) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const lastHtml = useRef(html);
  const [page] = useState(() => editorPage({
    html,
    tokens: editorTokens(),
    editable,
    compact,
    placeholder,
  }));

  const run = useCallback((js: string) => {
    viewRef.current?.injectJavaScript(`${js};true;`);
  }, []);

  useImperativeHandle(ref, () => ({
    command(name: string, payload?: Record<string, unknown>) {
      run(`window.__lsbCommand(${JSON.stringify(name)},${JSON.stringify(payload ?? null)})`);
    },
    reset() {
      run('window.__lsbSetContent("")');
    },
    blockAction(action: string, index: number) {
      run(`window.__lsbBlockAction(${JSON.stringify(action)},${Number(index) || 0})`);
    },
    addBlock(kind: string) {
      run(`window.__lsbAddBlock(${JSON.stringify(kind)})`);
    },
    flush() {
      if (!ready) return Promise.resolve(lastHtml.current);
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          pending.current = null;
          resolve(lastHtml.current);
        }, FLUSH_TIMEOUT);
        pending.current = { resolve, timer };
        run('window.__lsbRequestHtml("flush")');
      });
    },
    focus() {
      run('window.__lsbFocus()');
    },
  }), [html, ready, run]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let message: Message;
    try {
      message = JSON.parse(event.nativeEvent.data) as Message;
    } catch {
      return;
    }
    if (message.type === 'ready') {
      setReady(true);
      onReady?.();
      return;
    }
    if (message.type === 'height') {
      const px = Number(message.px);
      if (Number.isFinite(px)) setHeight(Math.max(innerMin, Math.min(maxHeight, Math.round(px))));
      return;
    }
    if (message.type === 'change') {
      lastHtml.current = message.html;
      onChange?.(message.html);
      return;
    }
    if (message.type === 'html') {
      const waiting = pending.current;
      if (waiting && (message.tag === 'flush' || !message.tag)) {
        pending.current = null;
        clearTimeout(waiting.timer);
        waiting.resolve(message.html);
      }
      return;
    }
    if (message.type === 'state') {
      onState?.({
        marks: message.marks || {},
        block: message.block || 'paragraph',
        level: Number(message.level) || 0,
        ordered: Boolean(message.ordered),
        align: message.align === 'center' || message.align === 'right' ? message.align : null,
      });
      return;
    }
    if (message.type === 'link') {
      if (message.href) onLink?.(message.href);
      return;
    }
    if (message.type === 'drag') {
      setDragging(Boolean(message.on));
      return;
    }
    if (message.type === 'sheet') {
      onSheet?.({
        kind: message.kind,
        index: Number(message.index) || 0,
        items: Array.isArray(message.items) ? message.items : [],
      });
      return;
    }
    if (message.type === 'error') setFailed(true);
  }, [innerMin, maxHeight, onChange, onLink, onReady, onSheet, onState]);

  useEffect(() => {
    if (!ready) return;
    run(`window.__lsbSetTheme(${JSON.stringify(editorTokens())})`);
  }, [ready, run]);

  useEffect(() => {
    if (!ready) return;
    run(`window.__lsbSetEditable(${editable ? 'true' : 'false'})`);
  }, [ready, editable, run]);

  useEffect(() => () => {
    const waiting = pending.current;
    if (waiting) {
      clearTimeout(waiting.timer);
      waiting.resolve(lastHtml.current);
      pending.current = null;
    }
  }, []);

  if (failed) {
    return (
      <View style={[styles.nbRichFallback, { minHeight }]}>
        <Text style={styles.nbRichFallbackText}>编辑器加载失败，请切到代码模式继续编辑。</Text>
      </View>
    );
  }

  // 内容超过上限后由编辑器自己滚动；拖拽块时也要打开 nestedScrollEnabled，
  // 否则父级 ScrollView 会先截走竖向手势（表现为"滑动的是页面"或拖动中断）。
  const scrollable = height >= maxHeight;

  return (
    <View style={[styles.nbRichWrap, { minHeight }]}>
      <WebView
        ref={viewRef}
        originWhitelist={['*']}
        source={{ html: page, baseUrl: 'https://linux.sb/' }}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={scrollable}
        nestedScrollEnabled={scrollable || dragging}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        setBuiltInZoomControls={false}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        androidLayerType="hardware"
        style={{ height, backgroundColor: 'transparent' }}
        containerStyle={styles.nbRichWeb}
      />
      {!ready ? (
        <View style={[styles.nbRichLoading, { height: innerMin }]} pointerEvents="none">
          <ActivityIndicator color={C.dim} />
        </View>
      ) : null}
    </View>
  );
});
