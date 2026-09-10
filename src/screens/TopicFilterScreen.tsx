import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { PrimaryButton, ScreenHeader, StatusBlock } from '../components/ui';
import { OutlineButton, ToggleChips } from '../components/account/AccountUi';
import {
  EMPTY_TOPIC_FILTER,
  TOPIC_FILTER_CLEAR,
  TOPIC_FILTER_CLEAR_HELP,
  TOPIC_FILTER_CUSTOM_HELP,
  TOPIC_FILTER_CUSTOM_LABEL,
  TOPIC_FILTER_FORUM_HELP,
  TOPIC_FILTER_FORUM_LABEL,
  TOPIC_FILTER_FORUM_WARNING_TITLE,
  TOPIC_FILTER_INTRO,
  TOPIC_FILTER_PRESET_EMPTY,
  TOPIC_FILTER_PRESET_LABEL,
  TOPIC_FILTER_RESET,
  TOPIC_FILTER_SAVE,
  TOPIC_FILTER_SAVED,
  TOPIC_FILTER_SYNCING,
  TOPIC_FILTER_SYNC_FAILED,
  TOPIC_FILTER_TITLE,
  TOPIC_FILTER_USERS_HELP,
  TOPIC_FILTER_USERS_LABEL,
  configuredForumIds,
  filterForumAvailable,
  normalizeFilterValue,
  parseFilterLines,
  sanitizeFilterSettings,
  TOPIC_FILTER_MAX_USERS,
  TOPIC_FILTER_MAX_WORDS,
} from '../data/topic-filter';
import {
  clearTopicFilterSettings,
  saveTopicFilterSettings,
} from '../services/topic-filter';
import { keywordFilterLimits } from '../services/official-assets';
import { useTopicFilter } from '../hooks/useTopicFilter';

/**
 * 帖子列表屏蔽设置（对齐官方插件 home_keyword_filter）：
 * 常用关键词（服务端预设，可多选）、屏蔽版块（默认集合 + 个人增减）、
 * 自定义关键词与屏蔽用户（每行一个），保存后同步到 linux.sb 账号。
 */
export function TopicFilterScreen() {
  const nav = useNav();
  const filter = useTopicFilter();
  // 上限以官网 plugins.js 为准（读不到用内置值）
  const limits = keywordFilterLimits();
  const { settings, context, ready } = filter;
  const [presets, setPresets] = useState<string[]>(settings.presets);
  const [forums, setForums] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState(settings.custom.join('\n'));
  const [users, setUsers] = useState(settings.users.join('\n'));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  // 同步（含远端拉取）完成后回填表单，但不覆盖用户已经改过的内容。
  useEffect(() => {
    if (touched) return;
    setPresets(settings.presets);
    setForums(configuredForumIds(settings, context));
    setCustom(settings.custom.join('\n'));
    setUsers(settings.users.join('\n'));
  }, [settings, context, touched]);

  const forumAvailable = filterForumAvailable(context);
  const forumRows = context.forums;
  const configuredCount = useMemo(
    () => presets.length + parseFilterLines(custom, limits.maxWords).length
      + parseFilterLines(users, limits.maxUsers).length + forums.size,
    [presets, custom, users, forums, limits.maxWords, limits.maxUsers],
  );

  const togglePreset = (word: string) => {
    setTouched(true);
    const key = normalizeFilterValue(word);
    setPresets((prev) => (prev.some((item) => normalizeFilterValue(item) === key)
      ? prev.filter((item) => normalizeFilterValue(item) !== key)
      : [...prev, word]));
  };

  const toggleForum = (id: string) => {
    setTouched(true);
    setForums((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async (task: () => Promise<boolean>, done: string) => {
    setBusy(true);
    setStatus(TOPIC_FILTER_SYNCING);
    try {
      const ok = await task();
      setStatus(ok ? '' : TOPIC_FILTER_SYNC_FAILED);
      if (ok) nav.toast(done);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : TOPIC_FILTER_SYNC_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const nextPresets = presets;
    const selectedForums = new Set(forums);
    setTouched(false);
    void run(() => saveTopicFilterSettings(sanitizeFilterSettings({
      presets: nextPresets,
      custom: parseFilterLines(custom, limits.maxWords),
      users: parseFilterLines(users, limits.maxUsers),
      // 官方同样是「默认集合 - 取消的 + 额外的」两个字段。
      forumExcludedIds: context.defaultForumIds.filter((id) => !selectedForums.has(id)),
      forumExtraIds: [...selectedForums].filter((id) => !context.defaultForumIds.includes(id)),
    }, context)), TOPIC_FILTER_SAVED);
  };

  const reset = () => {
    setPresets(EMPTY_TOPIC_FILTER.presets);
    setForums(new Set(context.defaultForumIds));
    setCustom('');
    setUsers('');
    setTouched(false);
    void run(() => clearTopicFilterSettings(), TOPIC_FILTER_RESET);
  };

  if (!nav.loggedIn) {
    return (
      <View style={styles.flex}>
        <ScreenHeader title={TOPIC_FILTER_TITLE} />
        <StatusBlock
          empty
          emptyTitle="登录后设置"
          emptyCopy="屏蔽设置保存在 linux.sb 账号上，网站与 App 共用同一份规则。"
        />
        <View style={styles.topicFilterActions}>
          <PrimaryButton label="去登录" onPress={() => nav.open({ name: 'login' })} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScreenHeader title={TOPIC_FILTER_TITLE} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.topicFilterPage}
      >
        <Text style={styles.topicFilterIntro}>{TOPIC_FILTER_INTRO}</Text>

        <View style={styles.topicFilterSection}>
          <Text style={styles.profileSectionTitle}>{TOPIC_FILTER_PRESET_LABEL}</Text>
          {context.presets.length ? (
            <ToggleChips items={context.presets} values={presets} onToggle={togglePreset} />
          ) : (
            <Text style={styles.composeFieldHint}>{TOPIC_FILTER_PRESET_EMPTY}</Text>
          )}
        </View>

        {context.forumWarning ? (
          <View style={styles.topicFilterWarn}>
            <Text style={styles.topicFilterWarnTitle}>{TOPIC_FILTER_FORUM_WARNING_TITLE}</Text>
            <Text style={styles.topicFilterWarnText}>{context.forumWarning}</Text>
          </View>
        ) : forumAvailable && forumRows.length ? (
          <View style={styles.topicFilterSection}>
            <Text style={styles.profileSectionTitle}>{TOPIC_FILTER_FORUM_LABEL}</Text>
            {forumRows.map((forum) => {
              const on = forums.has(forum.id);
              return (
                <View key={forum.id} style={styles.composeToggleRow}>
                  <View style={styles.composeToggleCopy}>
                    <Text style={styles.composeToggleTitle}>{forum.name}</Text>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={() => toggleForum(forum.id)}
                    trackColor={{ false: C.line, true: C.red }}
                    thumbColor="#fff"
                  />
                </View>
              );
            })}
            <Text style={styles.composeFieldHint}>{TOPIC_FILTER_FORUM_HELP}</Text>
          </View>
        ) : null}

        <View style={styles.topicFilterField}>
          <Text style={styles.profileSectionTitle}>{TOPIC_FILTER_CUSTOM_LABEL}</Text>
          <TextInput
            value={custom}
            onChangeText={(value) => {
              setTouched(true);
              setCustom(value);
            }}
            multiline
            maxLength={limits.customMaxLen}
            placeholder={`最多 ${limits.maxWords} 个关键词`}
            placeholderTextColor={C.dim}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.composeInput, styles.topicFilterTextarea]}
          />
          <Text style={styles.composeFieldHint}>{TOPIC_FILTER_CUSTOM_HELP}</Text>
        </View>

        <View style={styles.topicFilterField}>
          <Text style={styles.profileSectionTitle}>{TOPIC_FILTER_USERS_LABEL}</Text>
          <TextInput
            value={users}
            onChangeText={(value) => {
              setTouched(true);
              setUsers(value);
            }}
            multiline
            maxLength={limits.usersMaxLen}
            placeholder={`最多 ${limits.maxUsers} 个用户名`}
            placeholderTextColor={C.dim}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.composeInput, styles.topicFilterTextarea]}
          />
          <Text style={styles.composeFieldHint}>{TOPIC_FILTER_USERS_HELP}</Text>
        </View>

        <Text style={styles.composeFieldHint}>{TOPIC_FILTER_CLEAR_HELP}</Text>
        <View style={styles.topicFilterSection}>
          <Text style={styles.topicFilterStatus}>
            {status || (filter.pending
              ? TOPIC_FILTER_SYNC_FAILED
              : ready
                ? `已启用 ${configuredCount} 条屏蔽规则`
                : TOPIC_FILTER_SYNCING)}
          </Text>
          <View style={styles.topicFilterActions}>
            <OutlineButton label={TOPIC_FILTER_CLEAR} onPress={busy ? undefined : reset} flex />
            <PrimaryButton label={TOPIC_FILTER_SAVE} onPress={busy ? undefined : save} block disabled={busy} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
