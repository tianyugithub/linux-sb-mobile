import React, { useEffect, useState } from 'react';
import { Image, Platform, ScrollView, Text, View } from 'react-native';
import {
  ABOUT_DATA,
  ABOUT_DISCLAIMER,
  ABOUT_INTRO,
  ANDROID_VERSION_CODE,
  APP_ID,
  APP_LICENSE,
  APP_NAME,
  APP_VERSION,
  LICENSE_URL,
  PROJECT_URL,
  TECH_STACK,
} from '../data/app-info';
import { downloadAndInstallUpdate } from '../services/app-install';
import { checkForUpdate, updatePromptText, type UpdateResult } from '../services/app-update';
import { copyText } from '../utils/share';
import { readCrashLog } from 'linux-notify';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import {
  CompactTag,
  ConfirmDialog,
  ScreenHeader,
  SettingsRow,
  type DialogState,
} from '../components/ui';

/**
 * 关于项目。
 *
 * 版本号等全部来自 `src/data/app-info.ts`（唯一来源是 app.json），页面里不写死。
 * 「检查更新」读 GitHub latest release：有 APK 就直接下载安装，没有再打开发布页。
 */
export function AboutScreen() {
  const nav = useNav();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [crashLog, setCrashLog] = useState('');

  useEffect(() => {
    setCrashLog(readCrashLog());
  }, []);

  /** 检查更新：读项目仓库里的最新版本，和当前版本比。 */
  const runCheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const next = await checkForUpdate({ force: true });
      setResult(next);
      if (next.status === 'latest') {
        nav.toast(`已是最新版本 v${next.current}`);
      } else if (next.status === 'error') {
        nav.toast(next.message);
      } else if (next.status === 'available') {
        const canInstall = Platform.OS === 'android' && Boolean(next.apkUrl);
        setDialog({
          title: `发现新版本 v${next.latest.replace(/^[vV]/, '')}`,
          text: updatePromptText(next),
          confirmLabel: canInstall ? '下载安装' : '打开发布页',
          onConfirm: async () => {
            if (!canInstall) {
              nav.openBrowser(next.url, `新版本 v${next.latest}`);
              return;
            }
            try {
              await downloadAndInstallUpdate(next, nav.toast);
            } catch (err) {
              const message = err instanceof Error ? err.message : '下载失败';
              if (message !== 'NEED_PERMISSION') nav.toast(message);
              throw err;
            }
          },
        });
      }
    } finally {
      setChecking(false);
    }
  };

  const updateHint = checking
    ? '正在检查…'
    : result?.status === 'latest'
      ? `已是最新版本 v${result.current}`
      : result?.status === 'available'
        ? `有新版本 v${result.latest.replace(/^[vV]/, '')}，当前 v${result.current}`
        : result?.status === 'error'
          ? result.message
          : '从项目仓库下载最新安装包';

  return (
    <View style={styles.flex}>
      <ScreenHeader title="关于项目" />
      <ScrollView contentContainerStyle={styles.pagePad}>
        <View style={styles.aboutHero}>
          <Image source={require('../../assets/icon.png')} style={styles.aboutIcon} />
          <View style={styles.aboutHeroCopy}>
            <View style={styles.aboutNameRow}>
              <Text numberOfLines={1} style={styles.aboutName}>{APP_NAME}</Text>
              <CompactTag tone="info">非官方客户端</CompactTag>
            </View>
            <Text style={styles.aboutTagline}>linux.sb 社区的第三方移动客户端</Text>
          </View>
        </View>

        <Text style={[styles.profileSectionTitle, styles.settingsFirstSection]}>应用信息</Text>
        <SettingsRow icon="pricetag-outline" title="版本" value={APP_VERSION} />
        <SettingsRow icon="cube-outline" title="应用标识" value={APP_ID} />
        <SettingsRow icon="construct-outline" title="构建号" value={String(ANDROID_VERSION_CODE)} />
        <SettingsRow icon="layers-outline" title="技术栈" subtitle={TECH_STACK} />
        <SettingsRow
          icon="document-text-outline"
          title="开源许可"
          value={APP_LICENSE}
          chevron={Boolean(LICENSE_URL)}
          onPress={LICENSE_URL ? () => nav.openBrowser(LICENSE_URL, '开源许可') : undefined}
        />
        {PROJECT_URL ? (
          <SettingsRow
            icon="logo-github"
            title="项目主页"
            value={PROJECT_URL.replace(/^https?:\/\//, '')}
            chevron
            onPress={() => nav.openBrowser(PROJECT_URL, '项目主页')}
          />
        ) : null}
        <SettingsRow
          icon="cloud-download-outline"
          title="检查更新"
          subtitle={updateHint}
          value={result?.status === 'available' ? `v${result.latest.replace(/^[vV]/, '')}` : undefined}
          disabled={checking}
          chevron
          onPress={() => { void runCheck(); }}
        />
        <SettingsRow
          icon="bug-outline"
          title="崩溃日志"
          subtitle="只存在本机，不上传。首页会弹；打不开就去系统「下载」拿 LINUX-SB-崩溃日志.txt。"
          value={crashLog ? '有记录' : '无'}
          chevron
          onPress={() => {
            if (!crashLog) {
              nav.toast('还没有崩溃记录');
              return;
            }
            const preview = crashLog.length > 280 ? `${crashLog.slice(0, 280)}…` : crashLog;
            setDialog({
              title: '崩溃日志',
              text: `${preview}\n\n复制后发给开发即可。记录里没有登录 cookie。`,
              confirmLabel: '复制',
              onConfirm: async () => {
                await copyText(crashLog);
                nav.toast('已复制');
              },
            });
          }}
        />

        <Text style={styles.profileSectionTitle}>说明</Text>
        <Text style={styles.aboutCopy}>{ABOUT_INTRO}</Text>
        <Text style={styles.aboutCopy}>{ABOUT_DATA}</Text>
        <Text style={styles.aboutCopy}>{ABOUT_DISCLAIMER}</Text>

        <Text style={styles.version}>{APP_NAME} · v{APP_VERSION}</Text>
      </ScrollView>
      <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}
