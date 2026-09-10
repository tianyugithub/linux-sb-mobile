import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { CaptchaWidget } from '../components/CaptchaWidget';
import { OAuthBrowser } from '../components/OAuthBrowser';
import { GhostButton, Icon, Logo, PrimaryButton, ScreenHeader } from '../components/ui';
import { useKeyboardLift } from '../hooks/useKeyboardLift';
import { useNav } from '../navigation/nav';
import { api } from '../services/api';
import { ApiError } from '../services/client';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { clearRememberedLogin, loadRememberedLogin, saveRememberedLogin } from '../utils/remember-login';

export function AuthPasswordField({
  value,
  onChangeText,
  placeholder,
  visible,
  onToggle,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.authPasswordRow}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.dim}
        style={styles.authPasswordInput}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
      />
      <Pressable onPress={onToggle} hitSlop={8} style={styles.authEyeBtn} accessibilityLabel={visible ? '隐藏密码' : '显示密码'}>
        <Icon name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.muted} />
      </Pressable>
    </View>
  );
}

export function AuthScreen({ mode }: { mode: 'login' | 'register' }) {
  const nav = useNav();
  const kb = useKeyboardLift();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [codeWait, setCodeWait] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [capNonce, setCapNonce] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [oauth, setOauth] = useState<'github' | 'google' | null>(null);
  const isRegister = mode === 'register';

  useEffect(() => {
    if (isRegister) return;
    void loadRememberedLogin().then((saved) => {
      if (!saved) return;
      setName(saved.username);
      setPassword(saved.password);
      setRemember(true);
    });
  }, [isRegister]);

  /*
   * 这里原来有一段「自动登录」：进入登录页时若本机还留着站内 cookie，就拿它们直接登录。
   * 实测有害：残留的 cookie 往往已失效，自动登录会"成功"一次、随后又被判为未登录并弹回本页，
   * 形成来回跳转（人机验证组件被反复重挂，看起来就是"卡在正在加载人机验证"）。
   * 用户明确要求不要自动登录，去掉；正常登录走下面的手动提交。
   */

  useEffect(() => {
    if (codeWait <= 0) return;
    const timer = setTimeout(() => setCodeWait((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [codeWait]);

  const persistLogin = (username: string, nextPassword: string) => {
    if (remember) saveRememberedLogin({ username, password: nextPassword });
    else clearRememberedLogin();
  };

  const sendCode = async () => {
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail.includes('@')) {
      setError('请输入有效邮箱');
      return;
    }
    setSendingCode(true);
    setError('');
    try {
      await api.sendEmailCode(nextEmail);
      setCodeWait(60);
      nav.toast('验证码已发送，请查收邮箱');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '验证码发送失败');
    } finally {
      setSendingCode(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!captchaToken) throw new ApiError(400, { code: 'CAPTCHA', message: '请先完成人机验证', requestId: 'local' });
      const username = name.trim();
      if (isRegister) {
        if (password !== password2) throw new ApiError(400, { code: 'VALIDATION', message: '两次密码不一致', requestId: 'local' });
        try {
          await nav.signUp({
            username,
            password,
            email: email.trim().toLowerCase(),
            emailCode: emailCode.trim(),
            captchaToken,
          });
          persistLogin(username, password);
          return;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'REGISTERED_NEED_LOGIN') {
            persistLogin(username, password);
            nav.toast(err.message);
            nav.open({ name: 'login' });
            return;
          }
          throw err;
        }
      }
      await nav.signIn({ username, password, captchaToken });
      persistLogin(username, password);
    } catch (err) {
      setCaptchaToken(null);
      setCapNonce((value) => value + 1);
      setError(err instanceof ApiError ? err.message : isRegister ? '注册失败' : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = isRegister
    ? busy || !name.trim() || !password || !password2 || !email.trim() || !emailCode.trim() || !captchaToken
    : busy || !name.trim() || !password || !captchaToken;

  return (
    <KeyboardAvoidingView style={[styles.flex, Platform.OS === 'android' ? { paddingBottom: kb.lift } : null]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title={isRegister ? '注册' : '登录'} />
      <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled">
        <Logo />
        <Text style={styles.authLead}>{isRegister ? '使用用户名注册。邮箱仅用于验证，不会公开。' : '请使用 linux.sb 的用户名登录（不要用邮箱）。'}</Text>
        <View style={styles.authSwitch}>
          <Pressable onPress={() => nav.open({ name: 'login' })} style={[styles.authSwitchItem, !isRegister && styles.authSwitchActive]}><Text style={[styles.authSwitchText, !isRegister && styles.authSwitchTextActive]}>登录</Text></Pressable>
          <Pressable onPress={() => nav.open({ name: 'register' })} style={[styles.authSwitchItem, isRegister && styles.authSwitchActive]}><Text style={[styles.authSwitchText, isRegister && styles.authSwitchTextActive]}>注册</Text></Pressable>
        </View>
        <TextInput value={name} onChangeText={setName} placeholder={isRegister ? '用户名（不超过 20 字）' : '用户名'} placeholderTextColor={C.dim} style={styles.authInput} autoCapitalize="none" autoCorrect={false} maxLength={20} />
        <AuthPasswordField value={password} onChangeText={setPassword} placeholder="密码" visible={showPassword} onToggle={() => setShowPassword((value) => !value)} />
        {isRegister ? (
          <>
            <AuthPasswordField value={password2} onChangeText={setPassword2} placeholder="确认密码" visible={showPassword} onToggle={() => setShowPassword((value) => !value)} />
            <TextInput value={email} onChangeText={setEmail} placeholder="邮箱" placeholderTextColor={C.dim} style={styles.authInput} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
          </>
        ) : (
          <Pressable onPress={() => { const next = !remember; setRemember(next); if (!next) clearRememberedLogin(); }} style={styles.authRemember}>
            <View style={[styles.authCheck, remember && styles.authCheckOn]}>{remember ? <Icon name="checkmark" size={12} color="#fff" /> : null}</View>
            <Text style={styles.authRememberText}>记住密码</Text>
          </Pressable>
        )}
        <CaptchaWidget key={`${mode}-${capNonce}`} token={captchaToken} onToken={setCaptchaToken} />
        {isRegister ? (
          <View style={styles.codeRow}>
            <TextInput value={emailCode} onChangeText={setEmailCode} placeholder="6 位邮箱验证码" placeholderTextColor={C.dim} style={[styles.authInput, styles.codeInput]} keyboardType="number-pad" maxLength={6} />
            <Pressable
              onPress={sendCode}
              disabled={sendingCode || codeWait > 0 || !email.includes('@')}
              style={[styles.authSendCode, (sendingCode || codeWait > 0 || !email.includes('@')) && styles.authSendCodeOff]}
            >
              <Text style={styles.authSendCodeText}>{sendingCode ? '发送中' : codeWait > 0 ? `${codeWait}s` : '发送验证码'}</Text>
            </Pressable>
          </View>
        ) : null}
        {error ? <Text style={styles.authError}>{error}</Text> : null}
        <PrimaryButton
          block
          disabled={canSubmit}
          label={busy ? (isRegister ? '注册中…' : '登录中…') : isRegister ? '注册' : '登录'}
          onPress={submit}
        />
        {!isRegister ? (
          <>
            <Pressable onPress={() => nav.openWeb('https://linux.sb/password_recovery_forgot', '忘记密码')}><Text style={styles.forgot}>忘记密码？</Text></Pressable>
            <Text style={styles.oauthLabel}>OAuth 登录</Text>
            <Text style={styles.rulesText}>登录写在 linux.sb 上。授权页仍是 Google / GitHub，回来后会自动进入。</Text>
            <View style={styles.oauthRow}>
              <GhostButton flex icon="logo-github" label="GitHub" onPress={() => setOauth('github')} />
              <GhostButton flex icon="logo-google" label="Google" onPress={() => setOauth('google')} />
            </View>
          </>
        ) : null}
        <View style={styles.rules}>
          <Text style={styles.rulesTitle}>{isRegister ? '注册注意事项' : '登录注意事项'}</Text>
          <Text style={styles.rulesText}>{isRegister ? '请不要使用保留用户名或冒充他人。邮箱信息不会公开。' : '账号和密码与 linux.sb 网站相同。密码区分大小写。公共设备请勿勾选记住密码。'}</Text>
        </View>
      </ScrollView>
      {oauth ? (
        <OAuthBrowser
          provider={oauth}
          onClose={() => setOauth(null)}
          onSuccess={async (cookies) => {
            await nav.signIn({ username: oauth, provider: oauth, oauthCookies: cookies });
            setOauth(null);
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
