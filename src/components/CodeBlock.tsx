import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { usePrefs } from '../hooks/usePrefs';
import {
  codeFontFamily,
  codeSizeOf,
  resolveCodeTheme,
  type CodeFontId,
  type CodeSizeId,
  type CodeTheme,
  type CodeThemeId,
} from '../theme/code-themes';
import { prepareCode, tokensToLines, type HlToken } from '../utils/highlight';

function LineTokens({
  tokens,
  theme,
  fontFamily,
  fontSize,
  lineHeight,
}: {
  tokens: HlToken[];
  theme: CodeTheme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}) {
  return (
    <Text selectable style={{ fontFamily, fontSize, lineHeight }}>
      {tokens.length ? tokens.map((tok, index) => (
        <Text key={index} style={{ color: theme.colors[tok.k], fontFamily, fontSize, lineHeight }}>
          {tok.t}
        </Text>
      )) : <Text style={{ color: theme.colors.text }}>{' '}</Text>}
    </Text>
  );
}

export function CodeBlock({
  text,
  lang,
  compact,
  last,
  flush,
  onCopy,
  preview,
  forceTheme,
  forceFont,
  forceSize,
}: {
  text: string;
  lang?: string;
  compact?: boolean;
  last?: boolean;
  flush?: boolean;
  onCopy?: (value: string) => void;
  preview?: boolean;
  forceTheme?: CodeThemeId;
  forceFont?: CodeFontId;
  forceSize?: CodeSizeId;
}) {
  const prefs = usePrefs();
  const theme = resolveCodeTheme(forceTheme ?? prefs.codeTheme, prefs.scheme);
  const fontFamily = codeFontFamily(forceFont ?? prefs.codeFont, prefs.codeFontsReady);
  const size = codeSizeOf(forceSize ?? prefs.codeSize);
  const fontSize = compact ? Math.max(11, size.fontSize - 1) : size.fontSize;
  const lineHeight = compact ? Math.max(16, size.lineHeight - 1) : size.lineHeight;
  const prepared = useMemo(
    () => prepareCode(text, lang, preview ? true : prefs.codePrettyJson),
    [text, lang, preview, prefs.codePrettyJson],
  );
  const lines = useMemo(() => tokensToLines(prepared.tokens), [prepared.tokens]);
  const showGutter = preview ? false : prefs.codeLineNumbers && !compact && lines.length > 1;
  const wrap = preview ? true : prefs.codeWrap;
  const gutterW = Math.max(22, String(lines.length).length * fontSize * 0.62 + 10);
  const body = lines.map((tokens, index) => (
    <View key={index} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {showGutter ? (
        <Text
          style={{
            width: gutterW,
            color: theme.gutterText,
            fontFamily,
            fontSize: fontSize - 1,
            lineHeight,
            textAlign: 'right',
            paddingRight: 10,
          }}
        >
          {index + 1}
        </Text>
      ) : null}
      <View style={{ flex: wrap ? 1 : undefined, minWidth: wrap ? 0 : undefined }}>
        <LineTokens
          tokens={tokens}
          theme={theme}
          fontFamily={fontFamily}
          fontSize={fontSize}
          lineHeight={lineHeight}
        />
      </View>
    </View>
  ));

  return (
    <View
      style={{
        borderRadius: preview ? 8 : 10,
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: 'hidden',
        marginTop: preview || flush ? 0 : 10,
        marginBottom: preview || last || flush ? 0 : 12,
      }}
    >
      {preview ? null : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: compact ? 28 : 34,
            paddingHorizontal: 10,
            backgroundColor: theme.header,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
            gap: 8,
          }}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.accent, opacity: 0.9 }} />
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: theme.headerText,
              fontSize: 11,
              fontWeight: '800',
              letterSpacing: 0.6,
            }}
          >
            {prepared.label}
          </Text>
          {onCopy ? (
            <Pressable hitSlop={8} onPress={() => onCopy(prepared.text)}>
              <Text style={{ color: theme.copy, fontSize: 11, fontWeight: '700' }}>复制</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      {wrap ? (
        <View style={{ paddingVertical: compact || preview ? 8 : 10, paddingHorizontal: compact || preview ? 10 : 12 }}>
          {body}
        </View>
      ) : (
        <ScrollView
          horizontal
          nestedScrollEnabled
          bounces={false}
          showsHorizontalScrollIndicator
          contentContainerStyle={{ paddingVertical: compact ? 8 : 10, paddingHorizontal: compact ? 10 : 12 }}
        >
          <View>{body}</View>
        </ScrollView>
      )}
    </View>
  );
}
