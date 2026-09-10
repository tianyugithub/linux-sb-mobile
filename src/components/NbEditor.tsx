import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native';
import type { IonName } from '../../data';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useAndroidBack, useAppInsets, useNav } from '../navigation/nav';
import { ActionSheet, GhostButton, Icon, PrimaryButton, ScreenHeader, type SheetItem } from './ui';
import { OutlineButton } from './account/AccountUi';
import { RichEditor, type RichEditorHandle, type SheetRequest } from './RichEditor';
import { sameSnapshot, sourceSnapshot, type EditorSnapshot } from '../editor/snapshot';
import type { PickedImage } from '../services/post-image';
import {
  hasOfficialImageUpload,
  isR2Ready,
  loadImageUploadTarget,
  loadR2Config,
  resolveImageUploadTarget,
  saveImageUploadTarget,
  type ImageUploadTarget,
} from '../services/r2-config';
import { blocksToMarkdown, parseEditableArticle } from '../utils/article';
import { blocksToHtml } from '../editor/blocks-html';
import { resolveVideoShare } from '../utils/video-link';
import { EMOJI_PACKS as EMOJI_PACKS_FALLBACK } from '../data/emoji-packs';
import { useOfficialAssets } from '../hooks/useOfficialAssets';
import {
  insertAtCaret,
  insertBlock,
  insertHorizontalRule,
  insertImageMarkdowns,
  insertLink,
  insertTableMarkdown,
  prefixLines,
  wrapInline,
  type Caret,
} from '../utils/markdown-edit';

export type EditorMode = 'source' | 'wysiwyg';

function restoreCaret(input: TextInput | null, caret: Caret) {
  requestAnimationFrame(() => {
    input?.setNativeProps({ selection: caret });
  });
}

export type UploadItem = {
  id: string;
  url: string;
  selected: boolean;
  status: 'queued' | 'uploading' | 'done' | 'error';
  progress: number;
  name?: string;
  description: string;
};

export function UploadManager({
  open,
  uploading,
  picking = false,
  items,
  notice,
  onToggle,
  onToggleAll,
  onDescriptionChange,
  onUploadMore,
  onInsert,
  onInsertUrl,
  onStartUpload,
  onRetry,
  onRemove,
  onClose,
  canChooseTarget = false,
  target,
  onTargetChange,
}: {
  open: boolean;
  uploading: boolean;
  picking?: boolean;
  items: UploadItem[];
  notice?: string;
  onToggle: (id: string) => void;
  onToggleAll?: () => void;
  onDescriptionChange: (id: string, description: string) => void;
  onUploadMore: () => void;
  onInsert: () => void;
  onInsertUrl?: () => void;
  onStartUpload: () => void;
  onRetry?: (id: string) => void;
  onRemove?: (id: string) => void;
  onClose: () => void;
  canChooseTarget?: boolean;
  target?: ImageUploadTarget | null;
  onTargetChange?: (next: ImageUploadTarget) => void;
}) {
  if (!open) return null;
  const locked = uploading || picking;
  const doneItems = items.filter((item) => item.status === 'done');
  const pendingCount = items.filter((item) => item.status === 'queued' || item.status === 'error').length;
  const selectedCount = doneItems.filter((item) => item.selected).length;
  const allDoneSelected = doneItems.length > 0 && selectedCount === doneItems.length;

  const stateText = (item: UploadItem) => {
    if (item.status === 'queued') return '等待上传';
    if (item.status === 'uploading') return `上传中 ${item.progress}%`;
    if (item.status === 'error') return '上传失败';
    return '已上传';
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={locked ? undefined : onClose}
    >
      <View style={styles.confirmModalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={locked ? undefined : onClose} />
        <View style={styles.confirmPanel}>
          <View style={styles.confirmHead}>
            <Text style={styles.confirmTitle}>图片上传</Text>
            <View style={styles.uploadHeadRight}>
              {pendingCount ? (
                <Text style={styles.uploadCount}>待上传 {pendingCount} 张</Text>
              ) : doneItems.length ? (
                <Text style={styles.uploadCount}>已选 {selectedCount}/{doneItems.length}</Text>
              ) : null}
              {!locked ? (
                <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="关闭">
                  <Text style={styles.confirmClose}>×</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {canChooseTarget && onTargetChange ? (
            <View style={styles.uploadTargetRow}>
              <Text style={styles.uploadTargetLabel}>上传到</Text>
              <Pressable
                disabled={locked}
                onPress={() => onTargetChange('official')}
                style={[styles.composeMiniChip, target === 'official' && styles.composeMiniChipOn]}
                accessibilityLabel="上传到官网"
              >
                <Text style={[styles.composeMiniChipText, target === 'official' && styles.composeMiniChipTextOn]}>官网</Text>
              </Pressable>
              <Pressable
                disabled={locked}
                onPress={() => onTargetChange('r2')}
                style={[styles.composeMiniChip, target === 'r2' && styles.composeMiniChipOn]}
                accessibilityLabel="上传到 CF 图库"
              >
                <Text style={[styles.composeMiniChipText, target === 'r2' && styles.composeMiniChipTextOn]}>CF 图库</Text>
              </Pressable>
            </View>
          ) : null}

          <ScrollView style={styles.uploadList} contentContainerStyle={styles.uploadListContent}>
            {items.length ? items.map((item) => (
              <View key={item.id} style={styles.uploadRow}>
                <Pressable
                  disabled={item.status !== 'done'}
                  onPress={() => onToggle(item.id)}
                  style={styles.uploadThumbWrap}
                  accessibilityLabel={item.selected ? '取消选择这张图片' : '选择这张图片'}
                >
                  <Image source={{ uri: item.url }} style={styles.uploadThumb} />
                  {item.status === 'done' ? (
                    <View style={[styles.uploadMark, item.selected && styles.uploadMarkOn]}>
                      {item.selected ? <Icon name="checkmark" size={13} color="#fff" /> : null}
                    </View>
                  ) : null}
                  {item.status === 'uploading' ? (
                    <View style={styles.uploadThumbMask}>
                      <Text style={styles.uploadThumbPct}>{item.progress}%</Text>
                    </View>
                  ) : null}
                </Pressable>

                <View style={styles.uploadRowBody}>
                  <Text style={styles.uploadRowName} numberOfLines={1}>{item.name || '图片'}</Text>
                  <Text style={[styles.uploadRowState, item.status === 'error' && styles.uploadRowError]}>
                    {stateText(item)}
                  </Text>
                  {item.status === 'uploading' ? (
                    <View style={styles.uploadProgressTrack}>
                      <View style={[styles.uploadProgressFill, { width: `${Math.max(4, item.progress)}%` }]} />
                    </View>
                  ) : null}
                  {item.status === 'done' ? (
                    <TextInput
                      value={item.description}
                      onChangeText={(description) => onDescriptionChange(item.id, description)}
                      placeholder="图片说明（选填）"
                      placeholderTextColor={C.dim}
                      maxLength={80}
                      style={styles.uploadCaptionInput}
                    />
                  ) : null}
                </View>

                {item.status === 'queued' && onRemove ? (
                  <Pressable onPress={() => onRemove(item.id)} disabled={locked} hitSlop={8} style={styles.uploadRetry} accessibilityLabel="从队列移除">
                    <Icon name="close" size={17} color={C.muted} />
                  </Pressable>
                ) : null}
                {item.status === 'error' ? (
                  <View style={styles.uploadRowActions}>
                    {onRetry ? (
                      <Pressable onPress={() => onRetry(item.id)} disabled={locked} hitSlop={8} style={styles.uploadRetry} accessibilityLabel="重试上传">
                        <Icon name="refresh" size={17} color={C.blue} />
                      </Pressable>
                    ) : null}
                    {onRemove ? (
                      <Pressable onPress={() => onRemove(item.id)} disabled={locked} hitSlop={8} style={styles.uploadRetry} accessibilityLabel="移除这张">
                        <Icon name="close" size={17} color={C.muted} />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            )) : (
              <View style={styles.uploadEmptyWrap}>
                <View style={styles.uploadEmptyIcon}>
                  <Icon name="images-outline" size={22} color={C.muted} />
                </View>
                <Text style={styles.uploadEmptyText}>
                  {picking ? '正在打开相册…' : '还没有图片。相册可一次选多张，先加入队列，再点「上传」开始上传。'}
                </Text>
              </View>
            )}

            {notice ? <Text style={styles.uploadNotice}>{notice}</Text> : null}
            {doneItems.length > 1 && onToggleAll && !locked ? (
              <Pressable onPress={onToggleAll} hitSlop={6}>
                <Text style={styles.uploadNoticeAction}>{allDoneSelected ? '取消全选' : '全选已上传'}</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          <View style={styles.uploadFooter}>
            <View style={styles.uploadFooterLeft}>
              <OutlineButton compact label={items.length ? '继续选择' : '选择图片'} icon="images-outline" onPress={locked ? undefined : onUploadMore} />
              {onInsertUrl ? (
                <OutlineButton compact label="从网址" icon="link-outline" onPress={locked ? undefined : onInsertUrl} />
              ) : null}
            </View>
            {pendingCount ? (
              <PrimaryButton
                label={`上传 ${pendingCount} 张`}
                disabled={locked}
                onPress={onStartUpload}
              />
            ) : (
              <PrimaryButton
                label={selectedCount ? `插入 ${selectedCount} 张` : '插入'}
                disabled={locked || !selectedCount}
                onPress={onInsert}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function EditorPromptDialog({
  open,
  title,
  hint,
  placeholder,
  value,
  error,
  busy = false,
  second,
  onChange,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  hint: string;
  placeholder?: string;
  value: string;
  error?: string;
  busy?: boolean;
  second?: { label: string; placeholder?: string; value: string; onChange: (next: string) => void };
  onChange: (next: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useAndroidBack(open, onClose);
  if (!open) return null;
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.confirmModalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.confirmPanel}>
          <View style={styles.confirmHead}>
            <Text style={styles.confirmTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="关闭">
              <Text style={styles.confirmClose}>×</Text>
            </Pressable>
          </View>
          <View style={styles.confirmBody}>
            <Text style={styles.dialogText}>{hint}</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder={placeholder}
              placeholderTextColor={C.dim}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={styles.composeInput}
            />
            {second ? (
              <TextInput
                value={second.value}
                onChangeText={second.onChange}
                placeholder={second.placeholder}
                placeholderTextColor={C.dim}
                style={styles.composeInput}
              />
            ) : null}
            {error ? <Text style={styles.authError}>{error}</Text> : null}
            <View style={styles.confirmActions}>
              <GhostButton label="取消" onPress={onClose} />
              <PrimaryButton
                label={busy ? '解析中…' : '插入'}
                disabled={!value.trim() || busy}
                onPress={onConfirm}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function NbEditorBar({
  value,
  caretRef,
  inputRef,
  onChange,
  onEmoji,
  onImage,
  compact = false,
  docked = false,
  mode = 'source',
  onToggleMode,
  onCommand,
  onInsertLink,
  onVideo,
  onFullscreen,
  fullscreen = false,
  snapshot,
}: {
  value: string;
  caretRef: React.MutableRefObject<Caret>;
  inputRef?: React.RefObject<TextInput | null>;
  onChange: (next: string) => void;
  onEmoji?: () => void;
  onImage?: () => void | Promise<void>;
  compact?: boolean;
  docked?: boolean;
  mode?: EditorMode;
  onToggleMode?: () => void;
  /** 所见即所得模式下把按钮动作发给 WebView 内核。 */
  onCommand?: (name: string, payload?: Record<string, unknown>) => void;
  /** 打开插入链接弹窗（官方行为：选中文字作标题）。 */
  onInsertLink?: () => void;
  /** 打开插入视频弹窗（官方行为：解析抖音/哔哩哔哩/YouTube 链接）。 */
  onVideo?: () => void;
  onFullscreen?: () => void;
  fullscreen?: boolean;
  /** 内核回传的选区状态，用于按钮高亮。 */
  snapshot?: EditorSnapshot | null;
}) {
  const apply = (next: { value: string; caret: Caret }) => {
    caretRef.current = next.caret;
    onChange(next.value);
    restoreCaret(inputRef?.current ?? null, next.caret);
  };
  const live = () => ({ value, caret: caretRef.current });
  /** 有内核时走命令，否则走源码 markdown 操作。 */
  const run = (name: string, fallback: () => void, payload?: Record<string, unknown>) => {
    if (onCommand) {
      onCommand(name, payload);
      return;
    }
    fallback();
  };
  const size = docked ? 20 : 16;
  const btn = (key: string, onPress: () => void, child: React.ReactNode, active = false) => (
    <Pressable
      key={key}
      focusable={false}
      onPressIn={() => inputRef?.current?.focus()}
      onPress={onPress}
      hitSlop={2}
      style={[
        styles.nbBtn,
        compact && styles.nbBtnCompact,
        docked && styles.nbBtnDocked,
        active && styles.nbBtnActive,
      ]}
      accessibilityLabel={key}
    >
      {child}
    </Pressable>
  );
  const toolColor = C.scheme === 'light' ? C.green : C.muted;
  const toolColorOn = C.scheme === 'light' ? C.green : C.text;
  const glyph = (label: string, active = false) => (
    <Text style={[styles.nbBtnGlyph, docked && styles.nbBtnGlyphDocked, active && styles.nbBtnGlyphOn]}>{label}</Text>
  );
  const ion = (name: IonName, active = false) => <Icon name={name} size={size} color={active ? toolColorOn : toolColor} />;
  const split = (key: string) => <View key={key} style={styles.nbSplit} />;
  const on = (name: string) => Boolean(snapshot?.marks?.[name]);
  const block = snapshot?.block || 'paragraph';
  const bulletOn = block === 'list' && !snapshot?.ordered;
  const orderedOn = block === 'list' && Boolean(snapshot?.ordered);
  const tools: React.ReactNode[] = [];
  tools.push(btn('粗体', () => run('bold', () => apply(wrapInline(live().value, live().caret, '**', '**', '粗体文字'))), glyph('B', on('strong')), on('strong')));
  tools.push(btn('斜体', () => run('italic', () => apply(wrapInline(live().value, live().caret, '*', '*', '斜体文字'))), glyph('I', on('em')), on('em')));
  tools.push(btn('删除线', () => run('strike', () => apply(wrapInline(live().value, live().caret, '~~', '~~', '删除线文字'))), glyph('S', on('strike')), on('strike')));
  if (!compact) {
    tools.push(split('s1'));
    tools.push(btn('标题', () => run('h2', () => apply(prefixLines(live().value, live().caret, '## ', '标题'))), glyph('H', block === 'heading'), block === 'heading'));
    tools.push(btn('引用', () => run('quote', () => apply(prefixLines(live().value, live().caret, '> ', '引用内容'))), ion('return-down-forward-outline', block === 'quote'), block === 'quote'));
    tools.push(split('s2'));
  }
  tools.push(btn('行内代码', () => run('inline-code', () => apply(wrapInline(live().value, live().caret, '`', '`', '代码'))), ion('code-slash-outline', on('code')), on('code')));
  if (!compact) {
    tools.push(btn('代码块', () => run('codeblock', () => apply(insertBlock(live().value, live().caret, '```\n代码\n```\n', 4, 6))), ion('terminal-outline', block === 'code_block'), block === 'code_block'));
    tools.push(split('s3'));
    tools.push(btn('列表', () => run('ul', () => apply(prefixLines(live().value, live().caret, '- ', '列表项'))), ion('list-outline', bulletOn), bulletOn));
    tools.push(btn('有序列表', () => run('ol', () => apply(prefixLines(live().value, live().caret, '', '列表项', true))), ion('list-outline', orderedOn), orderedOn));
  }
  if (onInsertLink) {
    tools.push(btn('链接', onInsertLink, ion('link-outline', on('link'))));
  } else {
    tools.push(btn('链接', () => apply(insertLink(live().value, live().caret)), ion('link-outline', on('link'))));
  }
  if (onVideo) tools.push(btn('视频', onVideo, ion('videocam-outline')));
  if (!compact) {
    tools.push(btn('表格', () => run('table', () => apply(insertTableMarkdown(live().value, live().caret))), ion('grid-outline')));
    tools.push(btn('分隔线', () => run('hr', () => apply(insertHorizontalRule(live().value, live().caret))), glyph('—')));
  }
  if (onImage) {
    tools.push(btn('图片', () => { void onImage(); }, ion('image-outline')));
  }
  if (onEmoji) tools.push(btn('表情', onEmoji, ion('happy-outline')));
  if (onFullscreen) {
    tools.push(btn('全屏', onFullscreen, ion(fullscreen ? 'contract-outline' : 'expand-outline'), fullscreen));
  }

  // 与工具条其它按钮同款：纯图标 + 同样的选中态（nbBtn / nbBtnActive）。
  const modeSwitch = onToggleMode ? (
    <View style={styles.nbModeGroup}>
      {split('sMode')}
      {btn(
        '代码模式 Markdown',
        () => { if (mode !== 'source') onToggleMode(); },
        ion('code-slash-outline', mode === 'source'),
        mode === 'source',
      )}
      {btn(
        '所见即所得 富文本',
        () => { if (mode !== 'wysiwyg') onToggleMode(); },
        ion('text-outline', mode === 'wysiwyg'),
        mode === 'wysiwyg',
      )}
    </View>
  ) : null;

  return (
    <View style={[styles.nbBarRow, docked && styles.nbBarRowDocked, !compact && !docked && styles.nbBarAttached]}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        style={styles.nbBarScroll}
        contentContainerStyle={[
          styles.nbBar,
          compact && styles.nbBarCompact,
          docked && styles.nbBarDocked,
        ]}
      >
        {tools}
      </ScrollView>
      {modeSwitch}
    </View>
  );
}

export function useUploadQueue(opts?: {
  pick: () => Promise<PickedImage[] | null>;
  upload: (file: PickedImage, onProgress: (percent: number) => void) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [notice, setNotice] = useState('');
  const [picking, setPicking] = useState(false);
  const busyRef = useRef(false);
  // 保留原始文件，失败时可以直接重试（否则只能让用户重新选图）
  const filesRef = useRef(new Map<string, PickedImage>());
  // 只有「正在上传」才算忙；等待上传(queue)是等用户点「上传」，不能锁住界面
  const uploading = items.some((item) => item.status === 'uploading');

  const openManager = () => {
    setOpen(true);
    setNotice('');
  };

  const patch = (id: string, next: Partial<UploadItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)));
  };

  const uploadOne = async (id: string, file: PickedImage) => {
    patch(id, { status: 'uploading', progress: 8 });
    try {
      const url = await opts!.upload(file, (progress) => patch(id, { progress }));
      patch(id, { url, status: 'done', progress: 100 });
      return true;
    } catch (error) {
      patch(id, { status: 'error', progress: 0 });
      setNotice(error instanceof Error ? error.message : '上传失败');
      return false;
    }
  };

  const addFromPicker = opts
    ? async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      setPicking(true);
      setNotice('');
      try {
        const files = await opts.pick();
        if (!files?.length) {
          setNotice('未选择文件');
          return;
        }
        const stamp = Date.now();
        const batch = files.map((file, index) => {
          const id = `${stamp}-${index}-${Math.random().toString(36).slice(2, 7)}`;
          filesRef.current.set(id, file);
          return { id, file };
        });
        setItems((prev) => [
          ...prev,
          ...batch.map(({ id, file }) => ({
            id,
            url: file.uri,
            selected: true,
            status: 'queued' as const,
            progress: 0,
            name: file.label || file.name,
            description: '',
          })),
        ]);
        // 只入队，上传由用户点「上传」触发
        setNotice(`已加入队列 ${batch.length} 张`);
      } finally {
        busyRef.current = false;
        setPicking(false);
      }
    }
    : undefined;

  const uploadList = async (ids: string[]) => {
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const file = filesRef.current.get(id);
      if (!file) continue;
      const done = await uploadOne(id, file);
      if (done) ok += 1;
      else fail += 1;
    }
    if (ok && !fail) setNotice(ok > 1 ? `已上传 ${ok} 张` : '上传成功');
    else if (ok && fail) setNotice(`已上传 ${ok} 张，失败 ${fail} 张`);
    else if (!ok && fail) setNotice(fail > 1 ? `${fail} 张图片都上传失败` : '上传失败');
    else setNotice('');
  };

  /** 开始上传队列里所有待上传（含失败重试）的图片 */
  const startUpload = () => {
    if (busyRef.current) return;
    const ids = items.filter((item) => item.status === 'queued' || item.status === 'error').map((item) => item.id);
    if (!ids.length) return;
    busyRef.current = true;
    setNotice('');
    void uploadList(ids).finally(() => { busyRef.current = false; });
  };

  /** 从队列移除（未上传/失败的才能移除） */
  const remove = (id: string) => {
    if (busyRef.current || items.some((item) => item.id === id && item.status === 'uploading')) return;
    filesRef.current.delete(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  /** 单张重试 */
  const retry = (id: string) => {
    const file = filesRef.current.get(id);
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setNotice('');
    void uploadList([id]).finally(() => { busyRef.current = false; });
  };

  const close = () => {
    // 上传中或正在选图时不允许关闭；关掉时保留队列，重新打开还在
    if (uploading || busyRef.current) return;
    setNotice('');
    setOpen(false);
  };

  const toggle = (id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)));
  };

  const toggleAll = () => {
    setItems((prev) => {
      const done = prev.filter((item) => item.status === 'done');
      const allOn = done.length > 0 && done.every((item) => item.selected);
      return prev.map((item) => (item.status === 'done' ? { ...item, selected: !allOn } : item));
    });
  };

  const changeDescription = (id: string, description: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, description } : item)));
  };

  const takeSelected = () => items.filter((item) => item.selected && item.status === 'done');

  const clearAfterInsert = () => {
    setItems([]);
    setNotice('');
    setOpen(false);
  };

  return {
    open,
    items,
    notice,
    uploading,
    picking,
    openManager,
    addFromPicker,
    startUpload,
    retry,
    remove,
    close,
    toggle,
    toggleAll,
    changeDescription,
    takeSelected,
    clearAfterInsert,
  };
}

export function useNbEditor({
  value,
  onChange,
  placeholder,
  minHeight = 190,
  onLink,
  onPickImageFile,
  onUploadImageFile,
  docked = false,
  inputStyle,
  onFocus,
  onBlur,
  richText = 'always',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minHeight?: number;
  onLink: (href: string) => void;
  onPickImageFile?: () => Promise<PickedImage[] | null>;
  onUploadImageFile?: (
    file: PickedImage,
    onProgress: (percent: number) => void,
    target?: ImageUploadTarget | null,
  ) => Promise<string>;
  docked?: boolean;
  /** 覆盖源码模式输入框样式（底部内联回复框要沿用评论框的观感）。 */
  inputStyle?: StyleProp<TextStyle>;
  onFocus?: () => void;
  onBlur?: () => void;
  /**
   * 富文本（所见即所得）在哪里可用：
   *   'always'     默认，任何状态都能切（发帖页 / 编辑回帖页）
   *   'fullscreen' 极简的内联回复框不算富文本入口，只有全屏编辑里才给（用户要求：极简模式保持和以前一样）
   */
  richText?: 'always' | 'fullscreen';
}) {
  const inputRef = useRef<TextInput>(null);
  const caretRef = useRef<Caret>({ start: value.length, end: value.length });
  const valueRef = useRef(value);
  valueRef.current = value;
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mode, setMode] = useState<EditorMode>('source');
  const modeRef = useRef<EditorMode>('source');
  const richRef = useRef<RichEditorHandle>(null);
  const [wysiwyg, setWysiwyg] = useState<{ html: string; token: number } | null>(null);
  const [snapshot, setSnapshot] = useState<EditorSnapshot | null>(null);
  const [sourceState, setSourceState] = useState<EditorSnapshot | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  /** 全屏时编辑区的可视高度（`nbFullBody` 的实测高度，减掉内容区下内边距）。 */
  const [fullBodyH, setFullBodyH] = useState(0);
  const [prompt, setPrompt] = useState<null | 'link' | 'video' | 'image'>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptSecond, setPromptSecond] = useState('');
  const [promptError, setPromptError] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);
  const [emojiPack, setEmojiPack] = useState(0);
  // 表情面板数据以官网 plugins.js 为准（读不到用内置副本）
  const officialAssets = useOfficialAssets();
  const packs = officialAssets.emojiPacks?.length ? officialAssets.emojiPacks : EMOJI_PACKS_FALLBACK;
  const [sheet, setSheet] = useState<SheetRequest | null>(null);
  const insets = useAppInsets();
  const nav = useNav();
  const [uploadTarget, setUploadTarget] = useState<ImageUploadTarget | null>(null);
  const [canChooseTarget, setCanChooseTarget] = useState(false);
  const uploadTargetRef = useRef<ImageUploadTarget | null>(null);
  uploadTargetRef.current = uploadTarget;
  const refreshUploadTarget = async () => {
    const [config, saved] = await Promise.all([loadR2Config(), loadImageUploadTarget()]);
    const official = hasOfficialImageUpload(nav.me);
    const r2 = isR2Ready(config);
    setCanChooseTarget(Boolean(official && r2));
    setUploadTarget(resolveImageUploadTarget({ official, r2, saved }));
  };
  const uploads = useUploadQueue(
    onPickImageFile && onUploadImageFile
      ? {
        pick: onPickImageFile,
        upload: (file, onProgress) => onUploadImageFile(file, onProgress, uploadTargetRef.current),
      }
      : undefined,
  );
  useEffect(() => {
    void refreshUploadTarget();
  }, [nav.me]);
  useEffect(() => {
    if (uploads.open) void refreshUploadTarget();
  }, [uploads.open]);

  const onSelectionChange = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    caretRef.current = event.nativeEvent.selection;
    refreshSourceState(valueRef.current, event.nativeEvent.selection);
  };

  const commit = (next: { value: string; caret: Caret }) => {
    caretRef.current = next.caret;
    onChange(next.value);
    restoreCaret(inputRef.current, next.caret);
  };

  const pickImage = onPickImageFile ? () => { uploads.openManager(); } : undefined;

  const insertSelectedUploads = () => {
    const selected = uploads.takeSelected();
    if (!selected.length) return;
    if (modeRef.current === 'wysiwyg') {
      selected.forEach((item) => richRef.current?.command('image', { src: item.url, alt: item.description.trim() }));
    } else {
      const images = selected.map((item) => ({ url: item.url, caption: item.description.trim() }));
      commit(insertImageMarkdowns(valueRef.current, caretRef.current, images.map((item) => ({ url: item.url, alt: item.caption })), true));
    }
    uploads.clearAfterInsert();
  };

  /** 进入所见即所得时对当前 markdown 做一次快照；之后 WebView 持有活文档。 */
  const enterWysiwyg = () => {
    setWysiwyg({ html: blocksToHtml(parseEditableArticle(valueRef.current)), token: Date.now() });
    setEmojiOpen(false);
    Keyboard.dismiss();
  };

  const toggleMode = () => {
    setMode((prev) => {
      const next: EditorMode = prev === 'source' ? 'wysiwyg' : 'source';
      modeRef.current = next;
      if (next === 'wysiwyg') enterWysiwyg();
      else {
        setWysiwyg(null);
        setSnapshot(null);
        refreshSourceState(valueRef.current, caretRef.current);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      return next;
    });
  };

  const onRichChange = (html: string) => {
    onChange(blocksToMarkdown(parseEditableArticle(html)));
  };

  // 代码模式没有内核，按光标所在行/选区两侧推导按钮高亮，避免"选了也没状态"。
  const refreshSourceState = (text: string, caret: Caret) => {
    const next = sourceSnapshot(text, caret);
    setSourceState((prev) => (sameSnapshot(prev, next) ? prev : next));
  };

  useEffect(() => {
    if (modeRef.current === 'source') refreshSourceState(value, caretRef.current);
  }, [value]);

  const openPrompt = (kind: 'link' | 'video' | 'image') => {
    setPromptError('');
    setPromptValue(kind === 'video' ? '' : 'https://');
    setPromptSecond(kind === 'image' ? (valueRef.current.slice(caretRef.current.start, caretRef.current.end).trim() || '图片描述') : '');
    setPrompt(kind);
  };

  /** 代码模式写 markdown，富文本模式发内核命令，两种模式产出同一个链接。 */
  const insertLinkNode = (fallbackLabel: string, href: string) => {
    const caret = caretRef.current;
    const selected = valueRef.current.slice(caret.start, caret.end).trim();
    const label = selected || fallbackLabel;
    if (modeRef.current === 'wysiwyg') {
      richRef.current?.command('link', { href, text: label });
      return;
    }
    commit(insertAtCaret(valueRef.current, caret, `[${label}](${href})`));
  };

  const confirmPrompt = async () => {
    const raw = promptValue.trim();
    if (!raw || promptBusy) return;
    if (prompt === 'video') {
      setPromptBusy(true);
      const video = await resolveVideoShare(raw);
      setPromptBusy(false);
      if (!video) {
        setPromptError('识别不到抖音 / 哔哩哔哩 / YouTube 视频链接');
        return;
      }
      if (modeRef.current === 'wysiwyg') {
        richRef.current?.command('link', { href: video.url, text: video.label });
      } else {
        // 与官方一致：前后空行 + [平台名](地址)
        commit(insertBlock(valueRef.current, caretRef.current, `\n\n[${video.label}](${video.url})\n\n`, 0, 0));
      }
      setPrompt(null);
      return;
    }
    if (!/^https?:\/\//i.test(raw)) {
      setPromptError(prompt === 'image' ? '图片地址需要以 http:// 或 https:// 开头' : '链接需要以 http:// 或 https:// 开头');
      return;
    }
    if (prompt === 'image') {
      const alt = promptSecond.trim() || '图片描述';
      if (modeRef.current === 'wysiwyg') {
        richRef.current?.command('image', { src: raw, alt });
      } else {
        commit(insertImageMarkdowns(valueRef.current, caretRef.current, [{ url: raw, alt }], true));
      }
      setPrompt(null);
      return;
    }
    insertLinkNode('链接文字', raw);
    setPrompt(null);
  };

  const insertEmoji = (item: string) => {
    if (modeRef.current === 'wysiwyg') {
      richRef.current?.command('text', { text: item });
      return;
    }
    commit(insertAtCaret(valueRef.current, caretRef.current, item));
  };

  /** 极简（内联）状态下不给富文本入口，全屏里才放开。 */
  const richAllowed = richText === 'always' || fullscreen;
  const toolbar = (
    <NbEditorBar
      docked={docked}
      value={value}
      caretRef={caretRef}
      inputRef={inputRef}
      onChange={onChange}
      mode={mode}
      onToggleMode={richAllowed ? toggleMode : undefined}
      onCommand={mode === 'wysiwyg' ? (name, payload) => richRef.current?.command(name, payload) : undefined}
      onInsertLink={() => openPrompt('link')}
      onVideo={() => openPrompt('video')}
      onFullscreen={() => setFullscreen((open) => {
        const next = !open;
        if (!next && richText === 'fullscreen' && modeRef.current === 'wysiwyg') toggleMode();
        return next;
      })}
      fullscreen={fullscreen}
      snapshot={mode === 'wysiwyg' ? snapshot : sourceState}
      onEmoji={() => setEmojiOpen((open) => !open)}
      onImage={pickImage}
    />
  );

  // 与官方一致：四个分类 + 「点一下插入到正文」。
  useEffect(() => {
    if (emojiPack >= packs.length) setEmojiPack(0);
  }, [packs.length, emojiPack]);

  const emoji = emojiOpen ? (
    <View style={docked ? styles.nbEmojiDock : styles.nbEmojiPanel}>
      {/* 官方面板标题就是「点一下插入到正文」，但评论区里这行纯属占地（用户明确要求去掉）。
          发帖正文的全屏编辑器保留，与官方一致。 */}
      {docked ? null : <Text style={styles.fieldLabel}>点一下插入到正文</Text>}
      <View style={styles.nbEmojiTabs}>
        {packs.map((pack, index) => (
          <Pressable
            key={pack.name}
            focusable={false}
            onPress={() => setEmojiPack(index)}
            style={[styles.chip, emojiPack === index && styles.chipActive]}
          >
            <Text style={[styles.chipText, emojiPack === index && styles.chipTextActive]}>{pack.name}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={styles.nbEmojiList} contentContainerStyle={styles.nbEmojiGrid} keyboardShouldPersistTaps="always">
        {(packs[emojiPack]?.items ?? []).map((entry) => {
          const item = Array.isArray(entry) ? entry[0] : entry;
          const hint = Array.isArray(entry) ? entry[1] : entry;
          return (
            <Pressable
              key={item}
              focusable={false}
              onPressIn={() => { if (modeRef.current === 'source') inputRef.current?.focus(); }}
              onPress={() => insertEmoji(item)}
              style={styles.emojiCell}
              accessibilityLabel={hint}
            >
              <Text style={styles.emojiText}>{item}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  ) : null;

  /**
   * 全屏时编辑区要撑满可视高度。
   *
   * 编辑器高度一直是按**内容**算的（内容少就只给最小高度），所以进了全屏也只在顶上留一个小框、
   * 下面全空着。这里量出 `nbFullBody` 的可视高度当最小高度：内容少时铺满整屏（点哪都能落光标），
   * 内容超出时照旧由外层 ScrollView 滚 —— 分页与键盘行为都不变。
   */
  const fillHeight = fullscreen && fullBodyH > 0
    ? Math.max(minHeight, fullBodyH - (StyleSheet.flatten(styles.nbFullBodyInner).paddingBottom ?? 0))
    : undefined;
  const surfaceMinHeight = fillHeight ?? minHeight;

  const surface = mode === 'wysiwyg' && wysiwyg ? (
    <RichEditor
      key={wysiwyg.token}
      ref={richRef}
      html={wysiwyg.html}
      minHeight={surfaceMinHeight}
      maxHeight={fillHeight ? Number.MAX_SAFE_INTEGER : (docked ? 320 : 520)}
      seamless={Boolean(fillHeight)}
      compact={docked}
      placeholder={placeholder}
      onChange={onRichChange}
      onState={setSnapshot}
      onLink={onLink}
      onSheet={setSheet}
    />
  ) : (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={onChange}
      onSelectionChange={onSelectionChange}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      placeholderTextColor={C.dim}
      style={[
        styles.nbInput,
        docked && !fullscreen && styles.nbInputSolo,
        fullscreen && styles.nbSurfaceSeamless,
        inputStyle,
        { minHeight: surfaceMinHeight },
      ]}
      multiline
      textAlignVertical="top"
      scrollEnabled
      blurOnSubmit={false}
    />
  );

  // 手机端：块菜单/插入块一律走原生底部上滑卡片。
  const sheetItems: SheetItem[] | null = sheet ? sheet.items.map((item) => ({
    label: `${item.glyph}  ${item.label}`,
    danger: item.danger,
    onPress: () => {
      if (sheet.kind === 'add') richRef.current?.addBlock(item.key);
      else richRef.current?.blockAction(item.key, sheet.index);
    },
  })) : null;

  const promptDialog = (
    <EditorPromptDialog
      open={prompt !== null}
      title={prompt === 'video' ? '插入视频' : prompt === 'image' ? '插入图片' : '插入链接'}
      hint={prompt === 'video'
        ? '粘贴抖音 / 哔哩哔哩 / YouTube 链接或整段分享文案，会自动识别平台。'
        : prompt === 'image'
          ? '填写图片地址与描述，效果与官方编辑器一致。'
          : '选中文字会作为链接标题，否则用「链接文字」。'}
      placeholder={prompt === 'video' ? 'https://www.bilibili.com/video/BV...' : 'https://'}
      value={promptValue}
      error={promptError}
      busy={promptBusy}
      second={prompt === 'image' ? {
        label: '图片描述',
        placeholder: '图片描述',
        value: promptSecond,
        onChange: setPromptSecond,
      } : undefined}
      onChange={(next) => { setPromptValue(next); setPromptError(''); }}
      onConfirm={() => { void confirmPrompt(); }}
      onClose={() => setPrompt(null)}
    />
  );

  const field = (
    <>
      {fullscreen ? (
        <Modal visible animationType="slide" onRequestClose={() => setFullscreen(false)}>
          <View style={[styles.nbFull, { paddingTop: insets.top, paddingBottom: insets.bottom + 6 }]}>
            <ScreenHeader title="全屏编辑" onBack={() => setFullscreen(false)} />
            <View style={styles.nbFullInner}>
              <View style={styles.nbFullBars}>
                {toolbar}
                {emoji}
              </View>
              <ScrollView
                style={styles.nbFullBody}
                contentContainerStyle={styles.nbFullBodyInner}
                onLayout={(event) => setFullBodyH(Math.round(event.nativeEvent.layout.height))}
                keyboardShouldPersistTaps="handled"
              >
                {surface}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : surface}
      {promptDialog}
      {sheet ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSheet(null)}>
          <ActionSheet
            title={sheet.kind === 'add' ? '插入内容' : '块操作'}
            items={sheetItems}
            onClose={() => setSheet(null)}
          />
        </Modal>
      ) : null}
    </>
  );

  const uploadManager = (
    <UploadManager
      open={uploads.open}
      uploading={uploads.uploading}
      picking={uploads.picking}
      items={uploads.items}
      notice={uploads.notice}
      onToggle={uploads.toggle}
      onToggleAll={uploads.toggleAll}
      onDescriptionChange={uploads.changeDescription}
      onUploadMore={() => { void uploads.addFromPicker?.(); }}
      onInsert={insertSelectedUploads}
      onInsertUrl={() => { uploads.close(); openPrompt('image'); }}
      onStartUpload={uploads.startUpload}
      onRetry={uploads.retry}
      onRemove={uploads.remove}
      onClose={uploads.close}
      canChooseTarget={canChooseTarget}
      target={uploadTarget}
      onTargetChange={(next) => {
        setUploadTarget(next);
        uploadTargetRef.current = next;
        void saveImageUploadTarget(next);
      }}
    />
  );

  /** 清空正文：两种模式都归零，富文本同步清空活文档。 */
  const clear = () => {
    valueRef.current = '';
    caretRef.current = { start: 0, end: 0 };
    onChange('');
    setSnapshot(null);
    if (modeRef.current === 'wysiwyg') richRef.current?.reset();
  };

  /** 提交/切模式前把所见即所得的活文档拉平回 markdown。 */
  const flush = async (): Promise<string> => {
    if (modeRef.current !== 'wysiwyg' || !richRef.current) return valueRef.current;
    const html = await richRef.current.flush();
    const md = blocksToMarkdown(parseEditableArticle(html));
    valueRef.current = md;
    onChange(md);
    return md;
  };

  return {
    field,
    preview: null as React.ReactNode,
    toolbar,
    emoji,
    uploadManager,
    flush,
    clear,
    /** 供外部按钮使用（底部回复框的表情/展开按钮）。 */
    focus: () => inputRef.current?.focus(),
    toggleEmoji: () => setEmojiOpen((open) => !open),
    setEmojiOpen,
    emojiOpen,
    mode,
  };
}

export function NbEditorDock({ children, lifted }: { children: React.ReactNode; lifted: boolean }) {
  const insets = useAppInsets();
  return (
    <View style={[styles.nbDock, lifted ? null : { paddingBottom: insets.bottom }]}>
      {children}
    </View>
  );
}

export function NbEditor({
  value,
  onChange,
  placeholder,
  minHeight = 190,
  onLink,
  onPickImageFile,
  onUploadImageFile,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minHeight?: number;
  onLink: (href: string) => void;
  onPickImageFile?: () => Promise<PickedImage[] | null>;
  onUploadImageFile?: (
    file: PickedImage,
    onProgress: (percent: number) => void,
    target?: ImageUploadTarget | null,
  ) => Promise<string>;
}) {
  const editor = useNbEditor({ value, onChange, placeholder, minHeight, onLink, onPickImageFile, onUploadImageFile });
  return (
    <View style={styles.nbField}>
      {editor.toolbar}
      {editor.emoji}
      {editor.field}
      {editor.preview}
      {editor.uploadManager}
    </View>
  );
}
