import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { usePrefs } from '../hooks/usePrefs';
import { styles } from '../theme/app-styles';
import {
  CODE_FONT_META,
  CODE_PREVIEW_SAMPLE,
  CODE_SIZE_META,
  CODE_THEME_META,
  codeFontFamily,
  codeThemeSwatch,
  type CodeThemeGroup,
} from '../theme/code-themes';
import { CodeBlock } from '../components/CodeBlock';
import { Icon, ScreenHeader } from '../components/ui';
import type { IonName } from '../../data';
import { C } from '../theme/palette';

function MenuCheck({ on }: { on: boolean }) {
  return <Text style={[styles.codeSetCheck, !on && { opacity: 0 }]}>✓</Text>;
}

function ToggleRow({
  icon,
  title,
  hint,
  on,
  last,
  onPress,
}: {
  icon: IonName;
  title: string;
  hint: string;
  on: boolean;
  last?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.codeSetItem, last && styles.codeSetItemLast]}>
      <View style={styles.codeSetFontMark}>
        <Icon name={icon} size={16} color={C.text} />
      </View>
      <View style={styles.codeSetItemMain}>
        <Text style={styles.codeSetItemTitle}>{title}</Text>
        <Text style={styles.codeSetItemHint}>{hint}</Text>
      </View>
      <Text style={[styles.codeSetItemHint, on && { color: C.blue, fontWeight: '800' }]}>{on ? '开' : '关'}</Text>
    </Pressable>
  );
}

export function CodeSettingsScreen() {
  const prefs = usePrefs();
  const renderThemeGroup = (title: string, group: CodeThemeGroup) => {
    const items = CODE_THEME_META.filter((item) => item.group === group);
    return (
      <>
        <Text style={styles.codeSetSectionTitle}>{title}</Text>
        <View style={styles.codeSetGroup}>
          {items.map((item, index) => {
            const theme = codeThemeSwatch(item.id, prefs.scheme);
            const on = prefs.codeTheme === item.id;
            const last = index === items.length - 1;
            return (
              <Pressable
                key={item.id}
                onPress={() => { void prefs.setCodeTheme(item.id); }}
                style={[styles.codeSetItem, on && styles.codeSetItemOn, last && styles.codeSetItemLast]}
              >
                <View style={[styles.codeSetSwatch, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                  <View style={styles.codeSetSwatchRow}>
                    <View style={[styles.codeSetDot, { backgroundColor: theme.colors.keyword }]} />
                    <View style={[styles.codeSetDot, { backgroundColor: theme.colors.string }]} />
                  </View>
                  <View style={styles.codeSetSwatchRow}>
                    <View style={[styles.codeSetDot, { backgroundColor: theme.colors.key }]} />
                    <View style={[styles.codeSetDot, { backgroundColor: theme.colors.fn }]} />
                  </View>
                </View>
                <View style={styles.codeSetItemMain}>
                  <Text style={styles.codeSetItemTitle}>{item.label}</Text>
                  <Text style={styles.codeSetItemHint}>{item.hint}</Text>
                </View>
                <MenuCheck on={on} />
              </Pressable>
            );
          })}
        </View>
      </>
    );
  };
  return (
    <View style={styles.flex}>
      <ScreenHeader title="代码高亮" />
      <ScrollView contentContainerStyle={styles.codeSetPad}>
        <Text style={styles.codeSetLead}>主题页和回帖里的代码、JSON 都按这里的主题、字体和格式显示。</Text>

        <Text style={styles.codeSetSectionTitle}>预览</Text>
        <View style={styles.codeSetPreview}>
          <CodeBlock text={CODE_PREVIEW_SAMPLE} lang="json" flush />
        </View>
        <Text style={styles.codeSetCaption}>改下面的选项，这块会立刻跟着变。</Text>

        {renderThemeGroup('跟随', 'auto')}
        {renderThemeGroup('浅色风格', 'light')}
        {renderThemeGroup('经典主题', 'classic')}

        <Text style={styles.codeSetSectionTitle}>字体</Text>
        <View style={styles.codeSetGroup}>
          {CODE_FONT_META.map((item, index) => {
            const on = prefs.codeFont === item.id;
            const last = index === CODE_FONT_META.length - 1;
            return (
              <Pressable
                key={item.id}
                onPress={() => { void prefs.setCodeFont(item.id); }}
                style={[styles.codeSetItem, on && styles.codeSetItemOn, last && styles.codeSetItemLast]}
              >
                <View style={styles.codeSetFontMark}>
                  <Text style={[styles.codeSetFontMarkText, { fontFamily: codeFontFamily(item.id, prefs.codeFontsReady) }]}>Aa</Text>
                </View>
                <View style={styles.codeSetItemMain}>
                  <Text style={styles.codeSetItemTitle}>{item.label}</Text>
                  <Text style={styles.codeSetItemHint}>{item.hint}</Text>
                </View>
                <MenuCheck on={on} />
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.codeSetSectionTitle}>字号</Text>
        <View style={styles.codeSetSegment}>
          {CODE_SIZE_META.map((item, index) => {
            const on = prefs.codeSize === item.id;
            const last = index === CODE_SIZE_META.length - 1;
            return (
              <Pressable
                key={item.id}
                onPress={() => { void prefs.setCodeSize(item.id); }}
                style={[styles.codeSetSegBtn, on && styles.codeSetSegBtnOn, last && styles.codeSetSegBtnLast]}
              >
                <Text style={[styles.codeSetSegText, on && styles.codeSetSegTextOn]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.codeSetSectionTitle}>显示</Text>
        <View style={styles.codeSetGroup}>
          <ToggleRow
            icon="list-outline"
            title="行号"
            hint="代码块左侧显示行号"
            on={prefs.codeLineNumbers}
            last={false}
            onPress={() => { void prefs.setCodeLineNumbers(!prefs.codeLineNumbers); }}
          />
          <ToggleRow
            icon="return-down-forward-outline"
            title="自动换行"
            hint="关闭后可左右滑动查看长行"
            on={prefs.codeWrap}
            last={false}
            onPress={() => { void prefs.setCodeWrap(!prefs.codeWrap); }}
          />
          <ToggleRow
            icon="code-slash-outline"
            title="JSON 格式化"
            hint="自动缩进、对齐括号和字段"
            on={prefs.codePrettyJson}
            last
            onPress={() => { void prefs.setCodePrettyJson(!prefs.codePrettyJson); }}
          />
        </View>
      </ScrollView>
    </View>
  );
}
