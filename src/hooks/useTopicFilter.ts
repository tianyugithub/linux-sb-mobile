import { useEffect, useState } from 'react';
import { useNav } from '../navigation/nav';
import {
  getTopicFilterState,
  prepareTopicFilter,
  subscribeTopicFilter,
  type TopicFilterState,
} from '../services/topic-filter';

/**
 * 帖子列表屏蔽设置（官方 home_keyword_filter）。
 * 未登录时不启用——官方对 userId < 1 的访客连按钮都不渲染。
 */
export function useTopicFilter(): TopicFilterState {
  const nav = useNav();
  const [state, setState] = useState<TopicFilterState>(getTopicFilterState);
  useEffect(() => subscribeTopicFilter(() => setState(getTopicFilterState())), []);
  const userId = nav.loggedIn ? nav.me.id : '';
  useEffect(() => {
    void prepareTopicFilter(userId);
  }, [userId]);
  return state;
}
