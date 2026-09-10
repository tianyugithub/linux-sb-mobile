import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { IonName } from '../../data';
import { FONT_LABEL, nextFontSize } from '../services/prefs';
import { hasOfficialImageUpload, isR2Ready, loadR2Config } from '../services/r2-config';
import { h3Status } from 'linux-notify';
import {
  disablePush,
  enablePush,
  isIgnoringBattery,
  isPushEnabled,
  openSystemNotificationSettings,
  requestBatteryExemption,
  sendTestNotification,
} from '../services/push';
import { usePrefs } from '../hooks/usePrefs';
import { useTopicFilter } from '../hooks/useTopicFilter';
import { isPluginEnabled, PLUGINS } from '../plugins/registry';
import { C, SCHEME_LABEL } from '../theme/palette';
import { CODE_FONT_LABEL, CODE_THEME_LABEL } from '../theme/code-themes';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { Icon, ScreenHeader, SettingsRow, ActionSheet, type SheetItem } from '../components/ui';
import {
  ACCESS_CHANNEL_LABEL,
  ACCESS_CHANNELS,
} from '../utils/linux-access';
import { topicFilterRules } from '../data/topic-filter';
import { APP_NAME, APP_VERSION } from '../data/app-info';

export function SettingsScreen() {
  const nav = useNav();
  const prefs = usePrefs();
  const topicFilter = useTopicFilter();
  const pluginCount = PLUGINS.filter((plugin) => isPluginEnabled(prefs.plugins, plugin.id)).length;
  const filterRules = topicFilterRules(topicFilter.settings, topicFilter.context, true);
  const pendingFilter = topicFilter.pending;
  const ruleCount = filterRules.ruleCount;
  const [h3Last, setH3Last] = useState('');
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    const read = () => setH3Last(h3Status());
    read();
    const timer = setInterval(read, 3000);
    return () => clearInterval(timer);
  }, []);
  const [batteryOff, setBatteryOff] = useState(false);
  const [r2Ready, setR2Ready] = useState(false);
  const [accessSheet, setAccessSheet] = useState<SheetItem[] | null>(null);
  const officialUpload = hasOfficialImageUpload(nav.me);
  useEffect(() => {
    void isPushEnabled().then(setPushOn);
    setBatteryOff(isIgnoringBattery());
    void loadR2Config().then((config) => setR2Ready(isR2Ready(config)));
  }, []);
  return (
    <View style={styles.flex}>
      <ScreenHeader title="设置" />
      <ScrollView contentContainerStyle={styles.pagePad}>
      <Text style={[styles.profileSectionTitle, styles.settingsFirstSection]}>访问</Text>
      <SettingsRow
        icon="globe-outline"
        title="官网访问通道"
        value={ACCESS_CHANNEL_LABEL[prefs.accessChannel]}
        onPress={() => {
          setAccessSheet(ACCESS_CHANNELS.map((next) => ({
            label: ACCESS_CHANNEL_LABEL[next],
            onPress: () => {
              void (async () => {
                if (next === prefs.accessChannel) return;
                await prefs.setAccessChannel(next);
                nav.toast(`已改为${ACCESS_CHANNEL_LABEL[next]}`);
              })();
            },
          })));
        }}
      />
      <SettingsRow
        icon="flash-outline"
        title="HTTP/3 优先"
        subtitle={prefs.accessChannel === 'mirror'
          ? '镜像通道用不到；切到 DoH / 直连后生效'
          : `DoH / 直连下先走 QUIC，失败自动回落${h3Last ? ` · 上次：${h3Last}` : ''}`}
        value={prefs.h3First ? '开启' : '关闭'}
        onPress={() => {
          void (async () => {
            const next = !prefs.h3First;
            await prefs.setH3First(next);
            nav.toast(next ? '已开启 HTTP/3 优先' : '已关闭 HTTP/3 优先');
          })();
        }}
      />
      <Text style={styles.profileSectionTitle}>阅读</Text>
      <SettingsRow
        icon={prefs.scheme === 'dark' ? 'moon-outline' : 'sunny-outline'}
        title="外观"
        subtitle="浅色为白天模式，深色适合夜间阅读"
        value={SCHEME_LABEL[prefs.scheme]}
        onPress={async () => {
          const next = prefs.scheme === 'dark' ? 'light' : 'dark';
          await prefs.setScheme(next);
          nav.toast(`已切换为${SCHEME_LABEL[next]}模式`);
        }}
      />
      <SettingsRow
        icon="text-outline"
        title="字号"
        subtitle="作用于帖子标题和正文"
        value={FONT_LABEL[prefs.fontSize]}
        onPress={async () => {
          const next = nextFontSize(prefs.fontSize);
          await prefs.setFontSize(next);
          nav.toast(`字号已设为${FONT_LABEL[next]}`);
        }}
      />
      <SettingsRow
        icon="code-slash-outline"
        title="代码与 JSON"
        subtitle="主题、字体、字号和格式"
        value={`${CODE_THEME_LABEL[prefs.codeTheme]} · ${CODE_FONT_LABEL[prefs.codeFont]}`}
        chevron
        onPress={() => nav.open({ name: 'code-settings' })}
      />
      <SettingsRow
        icon="image-outline"
        title="图床"
        subtitle={officialUpload && r2Ready
          ? '官网和 CF 图库都可用，发帖插图时可以选择'
          : officialUpload
            ? '已有官网上传权限，也可再填自己的 Cloudflare R2'
            : '没有上传权限时，用自己的 Cloudflare R2 插图'}
        value={officialUpload && r2Ready ? '可选' : officialUpload ? '官网' : (r2Ready ? '已填写' : '未配置')}
        chevron
        onPress={() => nav.open({ name: 'image-host' })}
      />
      <SettingsRow
        icon="funnel-outline"
        title="帖子列表屏蔽设置"
        subtitle="按关键词、用户名或版块隐藏帖子，规则同步到 linux.sb 账号"
        value={pendingFilter ? '待同步' : ruleCount ? `已启用 ${ruleCount} 条` : '默认'}
        onPress={() => nav.open({ name: 'topic-filter' })}
      />
      <SettingsRow
        icon="document-text-outline"
        title="发帖须知提示"
        subtitle="新建主题时先确认社区发帖规范"
        value={prefs.postingNoticeSkip ? '不再提示' : '每次提示'}
        onPress={async () => {
          const next = !prefs.postingNoticeSkip;
          await prefs.setPostingNoticeSkip(next);
          nav.toast(next ? '发帖须知不再自动弹出' : '发帖须知恢复每次提示');
        }}
      />
      <SettingsRow
        icon="extension-puzzle-outline"
        title="插件"
        subtitle="社区作者做的增强功能，默认关闭"
        value={pluginCount ? `已启用 ${pluginCount} 个` : '全部关闭'}
        chevron
        onPress={() => nav.open({ name: 'plugins' })}
      />
      <Text style={styles.profileSectionTitle}>通知</Text>
      <SettingsRow
        icon="notifications-outline"
        title="消息推送"
        subtitle="有新回复、提及、打赏时弹出系统通知。后台用系统闹钟轻量检查，不再常驻「消息守护」。"
        value={pushOn ? '已开启' : '已关闭'}
        disabled={pushBusy}
        onPress={async () => {
          setPushBusy(true);
          try {
            if (!pushOn) {
              const ok = await enablePush();
              setPushOn(ok);
              nav.toast(ok ? '消息推送已开启' : '请在系统设置中允许通知');
            } else {
              await disablePush();
              setPushOn(false);
              nav.toast('消息推送已关闭');
            }
          } finally {
            setPushBusy(false);
          }
        }}
      />
      <SettingsRow
        icon="flash-outline"
        title="忽略电池限制"
        subtitle="OPPO / ColorOS 建议打开，否则休眠后可能收不到新消息"
        value={batteryOff ? '已忽略' : '未忽略'}
        onPress={() => {
          requestBatteryExemption();
          setTimeout(() => setBatteryOff(isIgnoringBattery()), 800);
        }}
      />
      <SettingsRow
        icon="notifications-outline"
        title="发送测试通知"
        subtitle="立刻弹出一条，用来确认系统通知通道可用"
        chevron
        onPress={async () => {
          const ok = await sendTestNotification();
          nav.toast(ok ? '已发送测试通知' : '当前环境无法发送通知');
        }}
      />
      <SettingsRow
        icon="settings-outline"
        title="系统通知权限"
        chevron
        onPress={() => { void openSystemNotificationSettings(); }}
      />
      <Text style={styles.profileSectionTitle}>账号</Text>
      {nav.loggedIn ? (
        <SettingsRow
          icon="person-outline"
          title="个人资料"
          chevron
          onPress={() => nav.open({ name: 'account' })}
        />
      ) : null}
      {nav.loggedIn ? (
        <SettingsRow icon="log-out-outline" title="退出登录" danger onPress={nav.signOut} />
      ) : (
        <SettingsRow icon="log-in-outline" title="登录" onPress={() => nav.open({ name: 'login' })} />
      )}
      <Text style={styles.profileSectionTitle}>其他</Text>
      <SettingsRow
        icon="information-circle-outline"
        title="关于项目"
        subtitle="版本、项目来源与说明"
        value={`v${APP_VERSION}`}
        chevron
        onPress={() => nav.open({ name: 'about' })}
      />
      <Text style={styles.version}>{APP_NAME} · v{APP_VERSION}</Text>
      </ScrollView>
      <ActionSheet title="官网访问通道" items={accessSheet} onClose={() => setAccessSheet(null)} />
    </View>
  );
}
