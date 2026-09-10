import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import type { Topic } from '../../data';
import type { CommentDto } from '../types/api';
import { api } from '../services/api';
import { pickPostImages, uploadPostImageFile } from '../services/post-image';
import { ApiError } from '../services/client';
import { useAsync } from '../hooks/useAsync';
import { useKeyboardLift } from '../hooks/useKeyboardLift';
import { styles } from '../theme/app-styles';
import { openAppHref, useAndroidBack, useNav } from '../navigation/nav';
import { ConfirmDialog, PrimaryButton, ScreenHeader, StatusBlock, commentPreview, type DialogState } from '../components/ui';
import { OutlineButton } from '../components/account/AccountUi';
import { NbEditorDock, useNbEditor } from '../components/NbEditor';

export function EditCommentScreen({
  topic,
  comment,
  onBack,
  onSaved,
}: {
  topic: Topic;
  comment: CommentDto;
  onBack: () => void;
  onSaved?: (saved: CommentDto) => void;
}) {
  const nav = useNav();
  const kb = useKeyboardLift();
  const editorQuery = useAsync(
    () => api.commentEditor(topic.id, comment.id),
    [topic.id, comment.id],
  );
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [confirm, setConfirm] = useState<DialogState | null>(null);
  useAndroidBack(Boolean(dialog), () => setDialog(null));
  useEffect(() => {
    if (!editorQuery.data) return;
    setBody(editorQuery.data.body || commentPreview(comment.body || ''));
  }, [editorQuery.data, comment.body]);
  const editor = useNbEditor({
    value: body,
    onChange: setBody,
    placeholder: '编辑回帖内容',
    onLink: (href) => openAppHref(nav, href),
    onPickImageFile: () => pickPostImages({ me: nav.me, toast: nav.toast }),
    onUploadImageFile: (file, onProgress, target) => uploadPostImageFile(file, { toast: nav.toast, onProgress, silent: true, target }),
    docked: true,
  });
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      // 所见即所得模式下先把活文档拉平回 markdown。
      const bodyText = await editor.flush();
      const saved = await api.updateComment(topic.id, comment.id, { body: bodyText.trim() });
      onSaved?.(saved);
      nav.toast('回帖已保存');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '保存失败';
      setError(message);
      nav.toast(message);
      throw err;
    } finally {
      setBusy(false);
    }
  };
  if (!nav.loggedIn) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="编辑回帖" onBack={onBack} />
        <View style={styles.emptyPage}>
          <Text style={styles.emptyTitle}>登录后才能编辑</Text>
          <PrimaryButton label="去登录" onPress={() => nav.open({ name: 'login' })} />
        </View>
      </View>
    );
  }
  if (editorQuery.error && !editorQuery.data) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title="编辑回帖" onBack={onBack} />
        <StatusBlock error={editorQuery.error} onRetry={editorQuery.reload} />
      </View>
    );
  }
  return (
    <KeyboardAvoidingView style={[styles.flex, Platform.OS === 'android' ? { paddingBottom: kb.lift } : null]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader
        title="编辑回帖"
        onBack={onBack}
        right={<PrimaryButton compact disabled={busy || editorQuery.loading || !body.trim()} label={busy ? '保存中' : '保存'} onPress={() => {
          const confirm = editorQuery.data?.confirm?.trim();
          if (confirm) {
            setDialog({
              title: '确认操作',
              text: confirm,
              confirmLabel: '确定',
              rulesUrl: editorQuery.data?.rulesUrl,
              onConfirm: save,
            });
            return;
          }
          void save();
        }} />}
      />
      <ScrollView contentContainerStyle={styles.composeContent} keyboardShouldPersistTaps="always">
        <Text style={styles.fieldLabel}>{topic.title}{comment.floor ? `  #${comment.floor}` : ''}</Text>
        {editorQuery.data?.quote ? <Text style={styles.editQuote}>{editorQuery.data.quote}</Text> : null}
        <View style={styles.composeLabelRow}>
          <Text style={styles.composeLabelTitle}>正文</Text>
          {body.trim() ? (
            <OutlineButton
              compact
              label="清空"
              onPress={() => setConfirm({
                title: '清空正文',
                text: '正文内容将被清空，且无法恢复。确定要清空吗？',
                confirmLabel: '清空',
                danger: true,
                onConfirm: () => editor.clear(),
              })}
            />
          ) : null}
        </View>
        <View style={styles.nbField}>
          {editor.field}
          {editor.preview}
        </View>
        {error ? <Text style={styles.authError}>{error}</Text> : null}
      </ScrollView>
      <ConfirmDialog dialog={confirm} onClose={() => setConfirm(null)} />
      <NbEditorDock lifted={kb.lift >= 80}>
        {editor.emoji}
        {editor.toolbar}
      </NbEditorDock>
      {editor.uploadManager}
      <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />
    </KeyboardAvoidingView>
  );
}
