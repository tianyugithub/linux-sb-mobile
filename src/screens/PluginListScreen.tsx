import React from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import type { IonName } from '../../data';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { usePrefs } from '../hooks/usePrefs';
import { OutlineButton } from '../components/account/AccountUi';
import { CompactTag, Icon, ScreenHeader, StatusBlock } from '../components/ui';
import { PLUGINS } from '../plugins/registry';

/**
 * 设置 → 插件。
 *
 * 视觉沿用设置页与 hubCard 的语言：一张卡 = 一个插件，
 * 卡片里是「图标 + 名称 + 第三方标签 + 说明 + 模块标签 + 开关 + 动作」。
 */
export function PluginListScreen() {
  const nav = useNav();
  const prefs = usePrefs();
  const enabledCount = PLUGINS.filter((plugin) => prefs.plugins[plugin.id] ?? plugin.defaultEnabled).length;

  return (
    <View style={styles.flex}>
      <ScreenHeader title="插件" />
      <ScrollView contentContainerStyle={styles.helperPage}>
        <View style={styles.hubCard}>
          <View style={styles.pluginHero}>
            <View style={styles.pluginHeroIcon}>
              <Icon name="extension-puzzle-outline" size={20} color={C.muted} />
            </View>
            <View style={styles.pluginHeroCopy}>
              <Text style={styles.hubCardTitle}>App 插件</Text>
              <Text style={styles.pluginHeroTagline}>已启用 {enabledCount} / {PLUGINS.length} 个</Text>
            </View>
          </View>
          <Text style={styles.hubCardLead}>
            插件是社区作者做的增强功能（官网没有）。数据只在这台手机上抓取与计算，不会上传；
            默认全部关闭，需要的自己打开，随时可以关回去。
          </Text>
        </View>

        {PLUGINS.length ? PLUGINS.map((plugin) => {
          const enabled = prefs.plugins[plugin.id] ?? plugin.defaultEnabled;
          return (
            <View key={plugin.id} style={styles.hubCard}>
              <View style={styles.pluginHero}>
                <View style={styles.pluginHeroIcon}>
                  <Icon name={plugin.icon as IonName} size={20} color={enabled ? C.red : C.muted} />
                </View>
                <View style={styles.pluginHeroCopy}>
                  <View style={styles.pluginTitleRow}>
                    <Text style={styles.hubCardTitle}>{plugin.name}</Text>
                    <CompactTag tone="warning">第三方</CompactTag>
                  </View>
                  <Text style={styles.pluginHeroTagline}>{plugin.tagline}</Text>
                </View>
                <Switch
                  value={enabled}
                  onValueChange={(next) => {
                    void prefs.setPluginEnabled(plugin.id, next);
                    nav.toast(next ? `${plugin.name} 已启用` : `${plugin.name} 已关闭`);
                  }}
                  trackColor={{ false: C.line, true: C.red }}
                  thumbColor="#fff"
                />
              </View>

              <Text style={styles.hubCardLead}>{plugin.description}</Text>

              <View style={styles.pluginChipRow}>
                {plugin.modules.map((module) => (
                  <CompactTag key={module.id} tone="default">{module.name}</CompactTag>
                ))}
              </View>

              <View style={styles.pluginFooter}>
                <OutlineButton
                  compact
                  label={enabled ? '打开插件' : '先启用再打开'}
                  icon={enabled ? 'arrow-forward-outline' : 'lock-closed-outline'}
                  onPress={() => {
                    if (!enabled) {
                      nav.toast('先打开右侧开关再进入');
                      return;
                    }
                    nav.open({ name: 'helper' });
                  }}
                />
                <Pressable
                  onPress={() => nav.openWeb(plugin.origin.forkUrl, `${plugin.name} 出处`)}
                  hitSlop={6}
                  style={styles.pluginSource}
                  accessibilityLabel="查看出处"
                >
                  <Text style={styles.pluginSourceText}>查看出处</Text>
                </Pressable>
              </View>

              <Text style={styles.pluginCredit}>
                原版：{plugin.origin.author} · 二开：{plugin.origin.fork} · {plugin.origin.license}
              </Text>
            </View>
          );
        }) : (
          <StatusBlock empty emptyTitle="还没有插件" emptyCopy="以后加进来的插件都会出现在这里。" />
        )}
      </ScrollView>
    </View>
  );
}
