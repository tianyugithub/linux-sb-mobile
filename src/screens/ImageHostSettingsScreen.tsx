import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { IonName } from '../../data';
import { useKeyboardLift } from '../hooks/useKeyboardLift';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { CompactTag, Icon, ScreenHeader } from '../components/ui';
import {
  EMPTY_R2_CONFIG,
  clearR2Config,
  hasOfficialImageUpload,
  isR2Ready,
  loadR2Config,
  probeR2Config,
  saveR2Config,
  type R2Config,
} from '../services/r2-config';

type Tone = 'progress' | 'ok' | 'warn' | 'err';
type Status = { tone: Tone; message: string };

const FIELDS: {
  key: keyof Pick<R2Config, 'accountId' | 'token' | 'bucket' | 'publicHost'>;
  label: string;
  hint: string;
  placeholder: string;
  icon: IonName;
  secret?: boolean;
}[] = [
  {
    key: 'accountId',
    label: '账户 ID',
    hint: 'Overview 右侧那串 32 位，不要填 S3 Access Key ID',
    placeholder: '32 位十六进制',
    icon: 'key-outline',
  },
  {
    key: 'token',
    label: 'API 令牌',
    hint: 'User API Token，需要该桶对象写入，一般是 cfut_ 开头',
    placeholder: 'cfut_…',
    icon: 'lock-closed-outline',
    secret: true,
  },
  {
    key: 'bucket',
    label: '桶名',
    hint: 'R2 里创建桶时的短名字，不是域名',
    placeholder: '例如 my-images',
    icon: 'file-tray-outline',
  },
  {
    key: 'publicHost',
    label: '公网域名',
    hint: '绑到这个桶的自定义域名或 xxx.r2.dev，不要带 https://',
    placeholder: 'img.example.com',
    icon: 'globe-outline',
  },
];

function bannerStyle(tone: Tone) {
  if (tone === 'ok') return styles.r2BannerOk;
  if (tone === 'err') return styles.r2BannerErr;
  if (tone === 'warn') return styles.r2BannerWarn;
  return styles.r2BannerProgress;
}

function bannerColor(tone: Tone) {
  if (tone === 'ok') return C.green;
  if (tone === 'err') return C.redBright;
  if (tone === 'warn') return C.orange;
  return C.blue;
}

function bannerIcon(tone: Tone): IonName {
  if (tone === 'ok') return 'checkmark-circle';
  if (tone === 'err') return 'close-circle';
  if (tone === 'warn') return 'alert-circle';
  return 'cloud-outline';
}

function StatusBanner({ status }: { status: Status }) {
  const color = bannerColor(status.tone);
  return (
    <View style={[styles.r2Banner, bannerStyle(status.tone)]}>
      <View style={styles.r2BannerIcon}>
        {status.tone === 'progress' ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <Icon name={bannerIcon(status.tone)} size={18} color={color} />
        )}
      </View>
      <Text style={[styles.r2BannerText, { color }]}>{status.message}</Text>
    </View>
  );
}

export function ImageHostSettingsScreen() {
  const nav = useNav();
  const kb = useKeyboardLift();
  const official = hasOfficialImageUpload(nav.me);
  const [form, setForm] = useState<R2Config>({ ...EMPTY_R2_CONFIG });
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [showToken, setShowToken] = useState(false);
  const ready = isR2Ready(form);
  const patch = (key: keyof R2Config, value: string) => {
    setStatus(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    void loadR2Config().then(setForm);
  }, []);

  const run = async (key: string, work: () => Promise<void>) => {
    if (busy) return;
    Keyboard.dismiss();
    setBusy(key);
    try {
      await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      setStatus({ tone: 'err', message });
      nav.toast(message);
    } finally {
      setBusy('');
    }
  };

  return (
    <View style={styles.flex}>
      <ScreenHeader title="图床" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.r2Page, { paddingBottom: 48 + kb.lift }]}
      >
        <View style={styles.hubCard}>
          <View style={styles.r2IntroTop}>
            <View style={styles.settingsIcon}>
              <Icon name="image-outline" size={16} color={C.text} />
            </View>
            <View style={styles.r2IntroCopy}>
              <View style={styles.r2IntroTitleRow}>
                <Text style={styles.r2IntroTitle}>Cloudflare R2</Text>
                <CompactTag tone={official || ready ? 'success' : 'warning'}>
                  {official && ready ? '可选' : official ? '官网' : ready ? '已填写' : '未配置'}
                </CompactTag>
              </View>
              <Text style={styles.hubCardLead}>
                {official
                  ? '你已有 linux.sb 图片上传权限。填好 Cloudflare R2 后，发帖和回帖插图可以选择传到官网还是自己的图库。'
                  : '普通账号官网没有上传额度。用相册插图前，请填写自己的 Cloudflare R2。令牌只保存在这台手机上。'}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.codeSetSectionTitle}>凭证</Text>
        <View style={styles.hubCard}>
          {FIELDS.map((field, index) => (
            <View key={field.key} style={[styles.r2Field, index === FIELDS.length - 1 && styles.r2FieldLast]}>
              <View style={styles.r2FieldHead}>
                <Icon name={field.icon} size={14} color={C.muted} />
                <Text style={styles.r2FieldName}>{field.label}</Text>
              </View>
              <View style={field.secret ? styles.r2SecretWrap : undefined}>
                <TextInput
                  value={form[field.key] || ''}
                  onChangeText={(value) => patch(field.key, value)}
                  secureTextEntry={field.secret && !showToken}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  placeholder={field.placeholder}
                  placeholderTextColor={C.dim}
                  style={[styles.r2Input, field.secret && styles.r2SecretInput]}
                />
                {field.secret ? (
                  <Pressable onPress={() => setShowToken((on) => !on)} style={styles.r2Eye} hitSlop={8}>
                    <Icon name={showToken ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.muted} />
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.r2Hint}>{field.hint}</Text>
            </View>
          ))}
          <Text style={styles.r2Hint}>
            不要填 S3 Access Key / Secret。发帖插入的是 https://域名/文件名，linux.sb 会保留外链图片。
          </Text>
        </View>

        <Text style={styles.codeSetSectionTitle}>操作</Text>
        <View style={[styles.hubCard, styles.r2Actions]}>
          {status ? <StatusBanner status={status} /> : null}
          <Pressable
            disabled={Boolean(busy)}
            onPress={() => {
              void run('save', async () => {
                setStatus({ tone: 'progress', message: '保存中…' });
                const saved = await saveR2Config(form);
                setForm(saved);
                if (isR2Ready(saved)) {
                  setStatus({ tone: 'ok', message: '保存成功' });
                  nav.toast('保存成功');
                  return;
                }
                setStatus({ tone: 'warn', message: '已保存，还没填完四项' });
                nav.toast('已保存，还没填完四项');
              });
            }}
            style={[styles.primaryBtn, styles.primaryBtnBlock, styles.r2Btn, busy ? styles.primaryBtnDisabled : null]}
          >
            {busy === 'save' ? <ActivityIndicator size="small" color="#fff" /> : null}
            <Text style={styles.primaryBtnText}>{busy === 'save' ? '保存中' : '保存'}</Text>
          </Pressable>
          <Pressable
            disabled={Boolean(busy)}
            onPress={() => {
              void run('probe', async () => {
                setStatus({ tone: 'progress', message: '测试中，正在连接 Cloudflare…' });
                const result = await probeR2Config(form);
                if (result.config) {
                  const saved = await saveR2Config(result.config);
                  setForm(saved);
                }
                setStatus({ tone: result.ok ? 'ok' : 'err', message: result.message });
                nav.toast(result.ok ? '测试通过' : result.message);
              });
            }}
            style={[styles.r2TestBtn, busy ? styles.primaryBtnDisabled : null]}
          >
            {busy === 'probe' ? <ActivityIndicator size="small" color={C.text} /> : <Icon name="pulse-outline" size={16} color={C.text} />}
            <Text style={styles.r2TestBtnText}>{busy === 'probe' ? '测试中' : '测试连接'}</Text>
          </Pressable>
          <Pressable
            disabled={Boolean(busy)}
            onPress={() => {
              void run('clear', async () => {
                await clearR2Config();
                setForm({ ...EMPTY_R2_CONFIG });
                setShowToken(false);
                const message = '已清除本机图床配置';
                setStatus({ tone: 'ok', message });
                nav.toast(message);
              });
            }}
            style={styles.r2Clear}
          >
            <Text style={styles.accEdit}>清除本机配置</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
