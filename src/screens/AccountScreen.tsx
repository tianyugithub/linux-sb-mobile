import React, { useEffect, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { IonName } from '../../data';
import { api } from '../services/api';
import { ApiError } from '../services/client';
import { useAsync } from '../hooks/useAsync';
import { useKeyboardLift } from '../hooks/useKeyboardLift';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { ConfirmDialog, Icon, PrimaryButton, ScreenHeader, StatusBlock, UserAvatar, type DialogState } from '../components/ui';
import { copyText } from '../utils/share';
import { loadRememberedLogin, saveRememberedLogin } from '../utils/remember-login';
import { AuthPasswordField } from './AuthScreen';

const SITE = 'https://linux.sb';

function Field({
  label,
  hint,
  value,
  onChange,
  secure,
  keyboardType,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}{hint ? <Text style={styles.accNote}>  {hint}</Text> : null}</Text>
      {secure ? (
        <AuthPasswordField
          value={value}
          onChangeText={onChange}
          placeholder={placeholder || ''}
          visible={visible}
          onToggle={() => setVisible((on) => !on)}
          autoComplete={label.includes('新') ? 'new-password' : 'password'}
        />
      ) : (
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType={keyboardType}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={placeholder}
          placeholderTextColor={C.dim}
          style={styles.authInput}
        />
      )}
    </View>
  );
}

function AccRow({
  icon,
  title,
  value,
  sub,
  action,
  danger,
  last,
  onPress,
  extra,
}: {
  icon: IonName;
  title: string;
  value?: string;
  sub?: string;
  action?: string;
  danger?: boolean;
  last?: boolean;
  onPress?: () => void;
  extra?: React.ReactNode;
}) {
  const inner = (
    <>
      <View style={styles.settingsIcon}>
        <Icon name={icon} size={16} color={danger ? C.redBright : C.text} />
      </View>
      <View style={styles.settingsMain}>
        <View style={styles.settingsTop}>
          <Text numberOfLines={1} style={[styles.settingsTitle, danger && { color: C.redBright }]}>{title}</Text>
          {extra}
          {action ? <Text style={styles.accEdit}>{action}</Text> : null}
          {onPress && !extra && !action ? <Icon name="chevron-forward" size={16} color={C.dim} /> : null}
        </View>
        {value ? (
          <Text selectable style={styles.accRowValue}>{value}</Text>
        ) : null}
        {sub ? <Text style={styles.settingsSub}>{sub}</Text> : null}
      </View>
    </>
  );
  if (!onPress) {
    return <View style={[styles.accRow, last && styles.accRowLast]}>{inner}</View>;
  }
  return (
    <Pressable onPress={onPress} style={[styles.accRow, last && styles.accRowLast]}>
      {inner}
    </Pressable>
  );
}

export function AccountScreen() {
  const nav = useNav();
  const kb = useKeyboardLift();
  const query = useAsync(() => api.profile({ fresh: true }), [nav.loggedIn], `profile:${nav.loggedIn ? nav.me.id : '0'}`);
  const data = query.data;
  const [open, setOpen] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [username, setUsername] = useState('');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [email, setEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [codeLeft, setCodeLeft] = useState(0);
  const [seed, setSeed] = useState('');
  const [infinite, setInfinite] = useState(false);
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useEffect(() => {
    if (!data) return;
    setBio(data.bio);
    setInfinite(data.infiniteScroll);
  }, [data]);
  useEffect(() => {
    if (codeLeft <= 0) return;
    const timer = setTimeout(() => setCodeLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [codeLeft]);

  const toggle = (key: string) => setOpen((current) => (current === key ? null : key));

  const run = async (key: string, task: () => Promise<{ message?: string }>, toast = true) => {
    setBusy(key);
    try {
      const result = await task();
      query.reload();
      await nav.refreshMe();
      if (toast) nav.toast(result.message || '已保存');
      return result;
    } catch (error) {
      nav.toast(error instanceof ApiError ? error.message : '保存失败');
      throw error;
    } finally {
      setBusy('');
    }
  };

  const saveInfinite = async (next: boolean) => {
    setInfinite(next);
    try {
      await run('infinite', () => api.saveInfiniteScroll(next));
    } catch {
      setInfinite(!next);
    }
  };

  const pickAvatar = async (camera: boolean) => {
    const perm = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      nav.toast(camera ? '请允许使用相机' : '请允许访问相册');
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    };
    const picked = camera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
      nav.toast('原图不能超过 10MB');
      return;
    }
    const mime = asset.mimeType || 'image/jpeg';
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(mime) && !/\.(jpe?g|png|webp)$/i.test(asset.fileName || asset.uri)) {
      nav.toast('请选择图片文件');
      return;
    }
    const type = /^image\/png$/i.test(mime) ? 'image/png' : /^image\/webp$/i.test(mime) ? 'image/webp' : 'image/jpeg';
    const name = type === 'image/png' ? 'avatar.png' : type === 'image/webp' ? 'avatar.webp' : 'avatar.jpg';
    setDialog({
      title: '确认操作',
      text: `上传头像将扣除 ${data?.avatarCost ?? 50} 积分，24 小时内只能更新一次。确认继续吗？`,
      onConfirm: async () => {
        await run('avatar', () => api.saveAvatarUpload({ uri: asset.uri, name, type }));
      },
    });
  };

  if (!nav.loggedIn) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="个人资料" />
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>登录后管理个人资料</Text>
          <PrimaryButton label="登录" onPress={() => nav.open({ name: 'login' })} />
        </View>
      </View>
    );
  }

  const name = data?.username || nav.me.name;
  const avatar = data?.avatar || nav.me.avatarUrl;
  const points = data?.points ?? nav.me.points;
  const uid = data?.uid || nav.me.uid;

  return (
    <View style={styles.flex}>
      <ScreenHeader title="个人资料" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 48 + kb.lift }}
        refreshControl={<RefreshControl refreshing={Boolean(query.fetching && data)} onRefresh={query.reload} tintColor={C.muted} />}
      >
        {query.loading && !data ? <StatusBlock loading error={query.error} onRetry={query.reload} /> : null}
        {query.error && !data ? <StatusBlock error={query.error} onRetry={query.reload} /> : null}
        {data ? (
          <>
            <View style={styles.userHero}>
              <Pressable onPress={() => toggle('avatar')} style={styles.userIdentity}>
                <UserAvatar name={name} url={avatar || undefined} accent={nav.me.accent} size={64} radius={32} />
                <View style={styles.userIdentityText}>
                  <Text numberOfLines={1} style={styles.userName}>{name}</Text>
                  <Pressable
                    onPress={() => { void copyText(uid).then(() => nav.toast('已复制 UID')); }}
                    hitSlop={6}
                  >
                    <Text style={styles.userUid}>UID {uid} · 复制</Text>
                  </Pressable>
                  <Text style={styles.userUid}>{points} 积分{data.joinedAt ? ` · ${data.joinedAt} 加入` : ''}</Text>
                </View>
              </Pressable>
              {data.bio ? <Text style={styles.userBio}>{data.bio}</Text> : null}
            </View>

            <View style={styles.accSection}>
              <Text style={[styles.profileSectionTitle, styles.settingsFirstSection]}>账号</Text>
              <AccRow
                icon="person-outline"
                title="用户名"
                value={data.username}
                sub={data.usernameHint || undefined}
                action={open === 'username' ? '收起' : undefined}
                onPress={() => toggle('username')}
              />
              {open === 'username' ? (
                <View style={styles.accEditor}>
                  <Field label="新用户名" value={username} onChange={setUsername} placeholder="输入新用户名" />
                  <Field label="当前密码" hint="用于确认是本人操作。" value={usernamePassword} onChange={setUsernamePassword} secure />
                  <Text style={styles.accNote}>每次消耗 {data.usernameCost} 积分。当前积分 {data.points}。</Text>
                  <PrimaryButton
                    block
                    disabled={!username.trim() || !usernamePassword || busy === 'username'}
                    label={busy === 'username' ? '修改中' : `支付 ${data.usernameCost} 积分修改`}
                    onPress={() => setDialog({
                      title: '确认操作',
                      text: `修改用户名将扣除 ${data.usernameCost} 积分，确认继续吗？`,
                      onConfirm: async () => {
                        await run('username', async () => {
                          const result = await api.saveProfileUsername({ new_username: username.trim(), current_password: usernamePassword });
                          const saved = await loadRememberedLogin();
                          if (saved) await saveRememberedLogin({ username: username.trim(), password: saved.password });
                          return result;
                        });
                      },
                    })}
                  />
                </View>
              ) : null}

              <AccRow
                icon="mail-outline"
                title="邮箱"
                value={data.email || '未绑定'}
                sub={data.emailVerified || '需要新邮箱验证码'}
                action={open === 'email' ? '收起' : undefined}
                onPress={() => toggle('email')}
              />
              {open === 'email' ? (
                <View style={styles.accEditor}>
                  <Field label="当前密码" hint="用于验证是本人操作。" value={emailPassword} onChange={setEmailPassword} secure />
                  <Field label="新邮箱" value={email} onChange={setEmail} keyboardType="email-address" placeholder="name@example.com" />
                  <Field label="邮箱验证码" value={emailCode} onChange={setEmailCode} keyboardType="numeric" placeholder="6 位验证码" />
                  <PrimaryButton
                    block
                    disabled={!email.trim() || !emailPassword || codeLeft > 0 || busy === 'email-code'}
                    label={codeLeft > 0 ? `${codeLeft}s` : (busy === 'email-code' ? '发送中' : '发送验证码')}
                    onPress={() => {
                      void run('email-code', () => api.sendProfileEmailCode({ email: email.trim(), current_password: emailPassword }))
                        .then(() => setCodeLeft(60))
                        .catch(() => undefined);
                    }}
                  />
                  <PrimaryButton
                    block
                    disabled={!email.trim() || !emailPassword || !emailCode.trim() || busy === 'email'}
                    label={busy === 'email' ? '保存中' : '保存新邮箱'}
                    onPress={() => { void run('email', () => api.saveProfileEmail({ current_password: emailPassword, email: email.trim(), email_code: emailCode.trim() })); }}
                  />
                </View>
              ) : null}

              <AccRow
                icon="create-outline"
                title="简介"
                value={data.bio || '未填写'}
                action={open === 'bio' ? '收起' : undefined}
                onPress={() => toggle('bio')}
              />
              {open === 'bio' ? (
                <View style={styles.accEditor}>
                  <TextInput
                    value={bio}
                    onChangeText={setBio}
                    multiline
                    placeholder="介绍一下自己"
                    placeholderTextColor={C.dim}
                    style={[styles.bodyInput, { minHeight: 96 }]}
                  />
                  <PrimaryButton
                    block
                    disabled={busy === 'bio'}
                    label={busy === 'bio' ? '保存中' : '保存简介'}
                    onPress={() => { void run('bio', () => api.saveProfileBio(bio)); }}
                  />
                </View>
              ) : null}

              <AccRow
                icon="image-outline"
                title="头像"
                sub={open === 'avatar' ? '相册或拍照裁切后上传，也可使用预置头像' : `更换消耗 ${data.avatarCost} 积分，24 小时内只能更新一次`}
                action={open === 'avatar' ? '收起' : undefined}
                last
                onPress={() => toggle('avatar')}
              />
              {open === 'avatar' ? (
                <View style={styles.accEditor}>
                  <Text style={styles.accNote}>{data.avatarNote}</Text>
                  <View style={styles.accAvatarActions}>
                    <Pressable
                      disabled={busy === 'avatar'}
                      onPress={() => { void pickAvatar(false); }}
                      style={styles.accAvatarBtn}
                    >
                      <Icon name="images-outline" size={18} color={C.text} />
                      <Text style={styles.accAvatarBtnText}>相册裁切</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy === 'avatar'}
                      onPress={() => { void pickAvatar(true); }}
                      style={styles.accAvatarBtn}
                    >
                      <Icon name="camera-outline" size={18} color={C.text} />
                      <Text style={styles.accAvatarBtnText}>拍照裁切</Text>
                    </Pressable>
                  </View>
                  <View style={styles.accSeeds}>
                    {data.avatarSeeds.map((item) => (
                      <Pressable key={item} onPress={() => setSeed(item)} style={[styles.accSeed, seed === item && styles.accSeedOn]}>
                        <Image source={{ uri: `https://api.dicebear.com/10.x/fun-emoji/png?seed=${item}` }} style={styles.accSeedImg} />
                      </Pressable>
                    ))}
                  </View>
                  <PrimaryButton
                    block
                    disabled={!seed || busy === 'avatar'}
                    label={busy === 'avatar' ? '保存中' : `使用预置头像 · ${data.avatarCost} 积分`}
                    onPress={() => setDialog({
                      title: '确认操作',
                      text: `更换头像将扣除 ${data.avatarCost} 积分，24 小时内只能更新一次。确认继续吗？`,
                      onConfirm: async () => { await run('avatar', () => api.saveAvatarPreset(seed)); },
                    })}
                  />
                </View>
              ) : null}
            </View>

            <View style={styles.accSection}>
              <Text style={styles.profileSectionTitle}>安全</Text>
              <AccRow
                icon="lock-closed-outline"
                title="密码"
                value={data.passwordHint}
                action={open === 'password' ? '收起' : undefined}
                last
                onPress={() => toggle('password')}
              />
              {open === 'password' ? (
                <View style={styles.accEditor}>
                  <Field label="当前密码" hint="用于验证是本人操作。" value={currentPassword} onChange={setCurrentPassword} secure />
                  <Field label="新密码" value={password} onChange={setPassword} secure />
                  <Field label="确认密码" value={password2} onChange={setPassword2} secure />
                  <PrimaryButton
                    block
                    disabled={!currentPassword || !password || !password2 || busy === 'password'}
                    label={busy === 'password' ? '保存中' : '保存密码'}
                    onPress={() => { void run('password', async () => {
                      const result = await api.saveProfilePassword({ current_password: currentPassword, password, password2 });
                      const saved = await loadRememberedLogin();
                      if (saved) await saveRememberedLogin({ username: saved.username, password });
                      return result;
                    }); }}
                  />
                </View>
              ) : null}
            </View>

            <View style={styles.accSection}>
              <Text style={styles.profileSectionTitle}>登录绑定</Text>
              <AccRow icon="logo-github" title="GitHub" value={data.github.status} />
              <AccRow icon="logo-google" title="Google" value={data.google.status} last />
            </View>

            <View style={styles.accSection}>
              <Text style={styles.profileSectionTitle}>阅读</Text>
              <AccRow
                icon="infinite-outline"
                title={data.infiniteTitle}
                sub={data.infiniteNote}
                last
                extra={(
                  <Switch
                    value={infinite}
                    onValueChange={(next) => { void saveInfinite(next); }}
                    disabled={busy === 'infinite'}
                    trackColor={{ true: C.red }}
                  />
                )}
              />
            </View>

            <View style={styles.accSection}>
              <Text style={styles.profileSectionTitle}>其他</Text>
              <AccRow
                icon="trash-outline"
                title="注销账号"
                sub={data.deleteNote}
                danger
                last
                onPress={() => nav.openWeb(`${SITE}${data.deleteUrl.startsWith('/') ? data.deleteUrl : `/${data.deleteUrl}`}`, '申请注销账号')}
              />
            </View>
          </>
        ) : null}
      </ScrollView>
      <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
    </View>
  );
}
