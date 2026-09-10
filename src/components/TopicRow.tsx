import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Topic } from '../../data';
import { useNav } from '../navigation/nav';
import { usePrefs } from '../hooks/usePrefs';
import { scaleTextStyle } from '../services/prefs';
import { styles } from '../theme/app-styles';
import { hydrateTopicSeen, subscribeTopicSeen, topicShowsUnread } from '../utils/topic-seen';
import { CompactTag, Icon, UserAvatar, pickUserId, stampLabel, stampTone, topicTagList } from './ui';

export function TopicRow({ topic, onPress, onUnread }: { topic: Topic; onPress: () => void; onUnread?: () => void }) {
  const nav = useNav();
  const { fontFactor } = usePrefs();
  const [, bump] = useState(0);
  useEffect(() => {
    void hydrateTopicSeen().then(() => bump((n) => n + 1));
    return subscribeTopicSeen(() => bump((n) => n + 1));
  }, []);
  const userId = pickUserId(topic.authorId);
  const openAuthor = () => {
    if (!userId) {
      nav.toast('无法打开该用户');
      return;
    }
    nav.openUser(userId);
  };
  const tags = topicTagList(topic);
  const left = tags.filter((tag) => tag.type === 'pinned');
  const after = tags.filter((tag) => tag.type !== 'pinned');
  const unread = topicShowsUnread(topic.id, topic.replies, topic.hasUnread);
  const lastReplierId = pickUserId(topic.lastReplierId);
  const openLastReplier = () => {
    if (!lastReplierId) return;
    nav.openUser(lastReplierId);
  };
  const openListed = () => {
    if (unread) (onUnread ?? onPress)();
    else onPress();
  };
  return (
    <View style={styles.topicRow}>
      <Pressable onPress={openAuthor} hitSlop={8} style={styles.avatarHit}>
        <UserAvatar name={topic.author} url={topic.avatarUrl} accent={topic.accent} online={Boolean(topic.online)} />
      </Pressable>
      <View style={styles.topicBody}>
        <View style={styles.topicTitleLine}>
          {left.map((tag) => (
            <CompactTag key={`${tag.type}-${tag.label}`} tone={stampTone(tag.type, tag.label, tag.kind)}>{stampLabel(tag)}</CompactTag>
          ))}
          <Pressable onPress={openListed} style={({ pressed }) => [styles.topicTitleHit, pressed && styles.pressed]}>
            <Text numberOfLines={2} style={scaleTextStyle(styles.topicTitle, fontFactor)}>{topic.title}</Text>
          </Pressable>
          {after.map((tag) => (
            <CompactTag
              key={`${tag.type}-${tag.label}`}
              tone={stampTone(tag.type, tag.label, tag.kind)}
              accessibilityLabel={tag.title}
            >
              {stampLabel(tag)}
            </CompactTag>
          ))}
          {unread ? (
            <Pressable onPress={onUnread ?? onPress} hitSlop={6} style={styles.topicUnreadNotice} accessibilityLabel="有新回复">
              <View style={styles.topicUnreadDot} />
              <Text style={styles.topicUnreadNoticeText}>未读</Text>
            </Pressable>
          ) : null}
        </View>
        {topic.body ? (
          <Text numberOfLines={2} style={styles.topicReplyExcerpt}>{topic.body}</Text>
        ) : null}
        <View style={styles.metaLine}>
          <Pressable onPress={openAuthor} hitSlop={6} style={styles.metaItem}>
            <Icon name="person-outline" size={13} />
            <Text style={styles.meta} numberOfLines={1}>{topic.author}</Text>
          </Pressable>
          <View style={styles.metaItem}><Icon name="folder-outline" size={13} /><Text style={styles.meta} numberOfLines={1}>{topic.forum}</Text></View>
          <View style={styles.metaItem}><Icon name="chatbubble-outline" size={13} /><Text style={styles.meta}>{String(topic.replies)}</Text></View>
          {topic.lastReplier ? (
            <Pressable onPress={lastReplierId ? openLastReplier : openListed} hitSlop={6} style={styles.metaItem}>
              <Icon name="person-outline" size={13} />
              <Text style={styles.meta} numberOfLines={1}>{topic.lastReplier}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.meta}>{topic.time}</Text>
        </View>
      </View>
    </View>
  );
}
