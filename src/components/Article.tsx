import React, { useEffect, useMemo, useState } from 'react';
import { Image, Keyboard, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { mediaUrl } from '../services/client';
import { scaleTextStyle } from '../services/prefs';
import { usePrefs } from '../hooks/usePrefs';
import { VIDEO_LABEL, collectImageRun, hostOf, imageKey, parseArticle, spansToPlain, uniqueImages, type ArticleBlock, type InlineSpan, type TextAlign } from '../utils/article';
import { ImageGallery } from './ImageGallery';
import { CodeBlock } from './CodeBlock';
import { WebView } from 'react-native-webview';
import { Icon, webImg } from './ui';
import { codeFontFamily, resolveCodeTheme } from '../theme/code-themes';

function blockAlignStyle(align?: TextAlign) {
  return align === 'center' || align === 'right' ? { textAlign: align as 'center' | 'right' } : undefined;
}

function imageAlignFrame(align?: TextAlign) {
  if (align === 'center') return styles.articleAlignCenter;
  if (align === 'right') return styles.articleAlignRight;
  return undefined;
}

export function ArticleImage({
  src,
  caption,
  onOpen,
  index,
  count,
  grid = false,
  align,
}: {
  src: string;
  caption?: string;
  onOpen?: (uri: string) => void;
  index?: number;
  count?: number;
  grid?: boolean;
  align?: TextAlign;
}) {
  const proxied = mediaUrl(src) ?? src;
  const [uri, setUri] = useState(proxied);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUri(proxied);
    setFailed(false);
  }, [proxied, src]);
  if (failed) {
    return (
      <View style={grid ? styles.articleImageGridItem : undefined}>
        <Pressable onPress={() => onOpen?.(src)} style={styles.articleImageFallback}>
          <Text style={styles.articleLink}>图片未显示，点击打开原图</Text>
        </Pressable>
        {caption ? <Text selectable style={[styles.articleImageCaption, blockAlignStyle(align)]}>{caption}</Text> : null}
      </View>
    );
  }
  const onError = () => {
    if (uri !== src) setUri(src);
    else setFailed(true);
  };
  const open = () => onOpen?.(src);
  const badge = typeof index === 'number' && index >= 0 && (count ?? 0) > 1;
  if (Platform.OS === 'web') {
    return (
      <View style={grid ? styles.articleImageGridItem : undefined}>
        <Pressable onPress={open} style={grid ? styles.articleImageGridHit : styles.articleImageHit}>
          {webImg(uri, grid
            ? { width: '100%', height: '100%', borderRadius: 8, objectFit: 'cover', backgroundColor: C.surface, cursor: 'zoom-in' }
            : { width: '100%', maxHeight: 280, borderRadius: 8, objectFit: 'contain', backgroundColor: C.surface, cursor: 'zoom-in' },
          onError)}
          {badge ? <View style={styles.articleImageBadge}><Text style={styles.articleImageBadgeText}>{index + 1}/{count}</Text></View> : null}
        </Pressable>
        {caption ? <Text selectable style={[styles.articleImageCaption, blockAlignStyle(align)]}>{caption}</Text> : null}
      </View>
    );
  }
  return (
    <View style={grid ? styles.articleImageGridItem : undefined}>
      <Pressable onPress={open} style={grid ? styles.articleImageGridHit : styles.articleImageHit}>
        <Image source={{ uri }} style={grid ? styles.articleImageGridImage : styles.articleImage} resizeMode={grid ? 'cover' : 'contain'} onError={onError} />
        {badge ? <View style={styles.articleImageBadge}><Text style={styles.articleImageBadgeText}>{index + 1}/{count}</Text></View> : null}
      </Pressable>
      {caption ? <Text selectable style={[styles.articleImageCaption, blockAlignStyle(align)]}>{caption}</Text> : null}
    </View>
  );
}

export function openImageGallery(
  src: string,
  extras: string[],
  setGallery: (next: { uris: string[]; index: number } | null) => void,
) {
  Keyboard.dismiss();
  const uris = uniqueImages(extras.length ? extras : [src]);
  const index = uris.findIndex((item) => imageKey(item) === imageKey(src));
  if (index >= 0) {
    setGallery({ uris, index });
    return;
  }
  setGallery({ uris: uniqueImages([src, ...uris]), index: 0 });
}

export function InlineText({
  spans,
  style,
  onLink,
  onSecret,
}: {
  spans: InlineSpan[];
  style?: object;
  onLink: (href: string, host: string) => void;
  onSecret: () => void;
}) {
  const prefs = usePrefs();
  const theme = resolveCodeTheme(prefs.codeTheme, prefs.scheme);
  const inlineCodeStyle = {
    color: theme.colors.string,
    backgroundColor: theme.inlineBg,
    fontFamily: codeFontFamily(prefs.codeFont, prefs.codeFontsReady),
    paddingHorizontal: 4,
  };
  return (
    /* selectable：长按可选中并复制（RN 的 Text 默认不可选）。正文、评论、引用、标题、
       表格单元都从这里渲染，所以一处就够；点链接仍然照常跳转。 */
    <Text selectable style={style}>
      {spans.map((span, index) => {
        if (span.type === 'mention') {
          return (
            <Text key={index} style={styles.articleMention} onPress={() => onLink(span.href || span.text, hostOf(span.href))}>
              {span.text}
            </Text>
          );
        }
        if (span.type === 'link') {
          return (
            <Text key={index} style={styles.articleLink} onPress={() => onLink(span.href, hostOf(span.href))}>
              {span.text}
            </Text>
          );
        }
        if (span.type === 'code') {
          return <Text key={index} style={[styles.articleInlineCode, inlineCodeStyle]}>{span.text}</Text>;
        }
        if (span.type === 'strong') {
          return <Text key={index} style={styles.articleStrong}>{span.text}</Text>;
        }
        if (span.type === 'em') {
          return <Text key={index} style={styles.articleEm}>{span.text}</Text>;
        }
        if (span.type === 'strike') {
          return <Text key={index} style={styles.articleStrike}>{span.text}</Text>;
        }
        if (span.type === 'secret') {
          return (
            <Text key={index} style={styles.secretText} onPress={onSecret}>
              {span.mask}
            </Text>
          );
        }
        return <Text key={index}>{span.text}</Text>;
      })}
    </Text>
  );
}

export const ARTICLE_FOLD_HEIGHT = 560;

/** 按字符估算文本宽度：CJK 约 1 个字宽，其余约 0.55 个字宽。 */
function textWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    width += /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char) ? fontSize : fontSize * 0.55;
  }
  return width;
}

/** 表格每列的宽度：取该列所有单元格里最长一行来估算，再夹在 [88, 260] 之间。 */
function columnWidths(block: Extract<ArticleBlock, { type: 'table' }>, fontSize: number): number[] {
  const columns = Math.max(block.headers.length, 1);
  return Array.from({ length: columns }, (_unused, col) => {
    const cells = [block.headers[col], ...block.rows.map((row) => row[col])].filter(Boolean) as InlineSpan[][];
    const longest = cells.reduce((max, cell) => {
      const lines = spansToPlain(cell).split('\n');
      return Math.max(max, ...lines.map((line) => textWidth(line, fontSize)));
    }, 0);
    return Math.min(260, Math.max(88, Math.round(longest) + 20));
  });
}

export function ArticleTable({
  block,
  compact,
  fontFactor,
  onLink,
  onSecret,
}: {
  block: Extract<ArticleBlock, { type: 'table' }>;
  compact?: boolean;
  fontFactor: number;
  onLink: (href: string, host: string) => void;
  onSecret: () => void;
}) {
  const cellText = scaleTextStyle(compact ? styles.articleTableCellTextCompact : styles.articleTableCellText, fontFactor);
  const headText = scaleTextStyle(styles.articleTableHeadText, fontFactor);
  const colCount = Math.max(block.headers.length, 1);
  const alignAt = (index: number) => block.aligns[index] ?? 'left';
  // 每一列用同一个宽度（所有行共用），否则各行按内容各自分配宽度，竖线就会错位
  const baseWidths = useMemo(
    () => columnWidths(block, compact ? 12 : 13),
    [block, compact],
  );
  const [wrapWidth, setWrapWidth] = useState(0);
  const totalBase = baseWidths.reduce((sum, width) => sum + width, 0);
  const extra = wrapWidth > totalBase ? Math.floor((wrapWidth - totalBase) / colCount) : 0;
  const colWidths = baseWidths.map((width) => width + extra);
  const renderRow = (cells: InlineSpan[][], header: boolean, rowKey: string) => (
    <View key={rowKey} style={[styles.articleTableRow, header && styles.articleTableHeadRow]}>
      {cells.map((cell, index) => (
        <View
          key={`${rowKey}-${index}`}
          style={[
            styles.articleTableCell,
            header && styles.articleTableHead,
            { width: colWidths[index] ?? 88 },
          ]}
        >
          <InlineText
            spans={cell.length ? cell : [{ type: 'text', text: ' ' }]}
            style={[header ? headText : cellText, { textAlign: alignAt(index) }]}
            onLink={onLink}
            onSecret={onSecret}
          />
        </View>
      ))}
    </View>
  );
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      bounces={false}
      showsHorizontalScrollIndicator
      onLayout={(event) => setWrapWidth(event.nativeEvent.layout.width)}
      style={styles.articleTableWrap}
      contentContainerStyle={styles.articleTableScroll}
    >
      <View style={styles.articleTable}>
        {renderRow(block.headers, true, 'h')}
        {block.rows.map((row, index) => renderRow(row, false, `r${index}`))}
      </View>
    </ScrollView>
  );
}

export function ArticleVideo({
  block,
  onOpen,
}: {
  block: Extract<ArticleBlock, { type: 'video' }>;
  onOpen: (href: string, host: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const vertical = block.provider === 'douyin';
  const frameStyle = vertical ? styles.articleVideoVertical : styles.articleVideoWide;
  const wrapperStyle = [styles.articleVideoWrap, vertical && styles.articleVideoWrapVertical];

  if (playing && block.embed) {
    // 不能直接用 uri 打开 embed：那样没有 Referer，YouTube 会报「配置错误」(Error 153)。
    // 套一层本地 HTML 并指定 baseUrl，让 iframe 的请求带上和官方页面一致的来源。
    const page = `<!DOCTYPE html><html><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">`
      + `<style>html,body{margin:0;height:100%;background:${C.videoBg};overflow:hidden}`
      + `iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style></head>`
      + `<body><iframe src="${escapeAttr(block.embed)}" `
      + `allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>`;
    return (
      <View style={wrapperStyle}>
        <WebView
          source={{ html: page, baseUrl: 'https://linux.sb/' }}
          style={frameStyle}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          androidLayerType="hardware"
          setBuiltInZoomControls={false}
          scrollEnabled={false}
          overScrollMode="never"
        />
      </View>
    );
  }

  const poster = youtubePoster(block);
  return (
    <Pressable
      onPress={() => { if (block.embed) setPlaying(true); else onOpen(block.url, hostOf(block.url)); }}
      style={wrapperStyle}
      accessibilityLabel={`播放${VIDEO_LABEL[block.provider]}`}
    >
      <View style={frameStyle}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.articleVideoPoster} resizeMode="cover" />
        ) : (
          <View style={[styles.articleVideoPoster, styles.articleVideoFallback]} />
        )}
        <View style={styles.articleVideoPlay}>
          <Icon name="play" size={24} color="#fff" />
        </View>
        <Text style={styles.articleVideoBadge}>{VIDEO_LABEL[block.provider]}</Text>
      </View>
    </Pressable>
  );
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function youtubePoster(block: Extract<ArticleBlock, { type: 'video' }>): string {
  if (block.provider !== 'youtube') return '';
  const id = block.embed.match(/\/embed\/([0-9A-Za-z_-]{6,})/)?.[1];
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : '';
}

export function ArticleBody({
  text,
  onLink,
  onSecret,
  onCopy,
  foldable,
  compact,
  foldHeight = ARTICLE_FOLD_HEIGHT,
  onImage,
  gallerySrcs,
}: {
  text: string;
  onLink: (href: string, host: string) => void;
  onSecret: () => void;
  onCopy: (value: string) => void;
  foldable?: boolean;
  compact?: boolean;
  foldHeight?: number;
  onImage?: (uri: string) => void;
  gallerySrcs?: string[];
}) {
  const blocks = useMemo(() => parseArticle(text), [text]);
  const images = useMemo(
    () => uniqueImages(blocks.filter((block): block is Extract<ArticleBlock, { type: 'image' }> => block.type === 'image').map((block) => block.src)),
    [blocks],
  );
  const siblings = gallerySrcs?.length ? uniqueImages(gallerySrcs) : images;
  const [gallery, setGallery] = useState<{ uris: string[]; index: number } | null>(null);
  const openImage = (src: string) => {
    if (onImage) {
      onImage(src);
      return;
    }
    openImageGallery(src, siblings, setGallery);
  };
  const plainLen = useMemo(
    () => text.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, '').length,
    [text],
  );
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [prevText, setPrevText] = useState(text);
  if (text !== prevText) {
    setPrevText(text);
    setExpanded(false);
    setContentHeight(0);
  }
  const overflows = Boolean(foldable && (contentHeight > foldHeight + 8 || plainLen >= 720));
  const collapsed = overflows && !expanded;
  const { fontFactor } = usePrefs();
  const textStyle = scaleTextStyle(compact ? styles.articleCompact : styles.article, fontFactor);
  const quoteStyle = scaleTextStyle(styles.articleQuoteText, fontFactor);
  return (
    <View style={compact ? styles.articleWrapCompact : styles.articleWrap}>
      <View
        collapsable={false}
        style={collapsed ? [styles.articleFold, { maxHeight: foldHeight }] : styles.articleFoldClip}
      >
        <View
          collapsable={false}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height;
            setContentHeight((prev) => (height > prev ? height : prev));
          }}
        >
        {blocks.map((block, index) => {
          const last = index === blocks.length - 1;
          if (block.type === 'code') {
            return (
              <CodeBlock
                key={index}
                text={block.text}
                lang={block.lang}
                compact={compact}
                last={last}
                onCopy={onCopy}
              />
            );
          }
          if (block.type === 'image') {
            const group = collectImageRun(blocks, index);
            if (!group) return null;
            const grid = group.length > 1;
            return (
              <View key={index} style={[grid ? styles.articleImageGrid : imageAlignFrame(group[0].align)]}>
                {group.map((image, imageOffset) => {
                  const imageIndex = siblings.findIndex((item) => imageKey(item) === imageKey(image.src));
                  return (
                    <ArticleImage
                      key={`${image.src}-${imageOffset}`}
                      src={image.src}
                      caption={image.caption}
                      align={image.align}
                      onOpen={openImage}
                      index={imageIndex}
                      count={siblings.length}
                      grid={grid}
                    />
                  );
                })}
              </View>
            );
          }
          if (block.type === 'table') {
            return (
              <ArticleTable
                key={index}
                block={block}
                compact={compact}
                fontFactor={fontFactor}
                onLink={onLink}
                onSecret={onSecret}
              />
            );
          }
          if (block.type === 'spacer') {
            return <View key={index} style={styles.articleSpacer} />;
          }
          if (block.type === 'hr') {
            return <View key={index} style={styles.articleHr} />;
          }
          if (block.type === 'h') {
            const headingSize = block.level <= 1 ? 24 : block.level === 2 ? 20 : 17;
            const headingStyle = scaleTextStyle([
              styles.articleHeading,
              { fontSize: headingSize, lineHeight: Math.round(headingSize * 1.35) },
            ], fontFactor);
            return (
              <View key={index} style={[compact ? styles.articleHeadingWrapCompact : styles.articleHeadingWrap, index === 0 && styles.articleHeadingFirst]}>
                <InlineText spans={block.spans} style={[headingStyle, blockAlignStyle(block.align)]} onLink={onLink} onSecret={onSecret} />
              </View>
            );
          }
          if (block.type === 'list') {
            return (
              <View key={index} style={[styles.articleList, last && styles.articleBlockLast, block.align && block.align !== 'left' ? { alignItems: block.align === 'right' ? 'flex-end' : 'center' } : null]}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.articleListRow}>
                    <Text style={textStyle}>{block.ordered ? `${itemIndex + 1}.` : '•'}</Text>
                    <InlineText spans={item} style={[textStyle, styles.articleListText, blockAlignStyle(block.align)]} onLink={onLink} onSecret={onSecret} />
                  </View>
                ))}
              </View>
            );
          }
          if (block.type === 'quote') {
            return (
              <View key={index} style={[styles.articleQuote, last && styles.articleBlockLast]}>
                <InlineText spans={block.spans} style={[quoteStyle, blockAlignStyle(block.align)]} onLink={onLink} onSecret={onSecret} />
              </View>
            );
          }
          if (block.type === 'video') {
            return <ArticleVideo key={index} block={block} onOpen={onLink} />;
          }
          return (
            <View key={index} style={[compact ? styles.articlePCompact : styles.articleP, last && styles.articlePLast]}>
              <InlineText spans={block.spans} style={[textStyle, blockAlignStyle(block.align)]} onLink={onLink} onSecret={onSecret} />
            </View>
          );
        })}
        </View>
        {collapsed ? (
          <LinearGradient
            colors={[C.fade, C.canvas]}
            style={styles.articleFoldFade}
            pointerEvents="none"
          />
        ) : null}
      </View>
      {overflows ? (
        <Pressable onPress={() => setExpanded((value) => !value)} style={styles.articleExpand}>
          <Text style={styles.articleExpandText}>{expanded ? '收起全文' : '展开全文'}</Text>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={C.muted} />
        </Pressable>
      ) : null}
      {gallery ? (
        <ImageGallery
          visible
          uris={gallery.uris}
          index={gallery.index}
          onClose={() => setGallery(null)}
        />
      ) : null}
    </View>
  );
}
