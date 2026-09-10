/**
 * 帖子列表屏蔽设置的上下文回归。
 *
 * 背景：官网的「常用关键词 / 可屏蔽版块 / 默认屏蔽版块」只存在于首页按钮的 data-* 里，
 * 只有 GET /topic-filter 能带回来。曾经本地设置缓存还新鲜时（5 分钟内刚同步过）
 * 就直接早退、不去取上下文 —— 表现为设置页里「常用关键词 / 屏蔽版块」整块消失。
 *
 *   npm run check:filter
 */
import { restoreSiteSession } from '../src/services/site-session';
import { hydrateSession } from '../src/services/session';
import { getTopicFilterState, prepareTopicFilter, topicFilterError } from '../src/services/topic-filter';

/** 最小可用的官网首页片段：列表 + 屏蔽设置按钮（含全部 data-*）。 */
const HOME = `<!doctype html><html><body>
<ul class="post-list">
  <li class="post-item"><a class="post-title" href="/topic/1">示例主题</a></li>
</ul>
<button class="home-keyword-filter-button" type="button" data-home-keyword-filter-open
  data-home-keyword-filter-presets="[&quot;中转站&quot;,&quot;公益站&quot;]"
  data-home-keyword-filter-forum-policy="{&quot;enabled&quot;:true,&quot;forums&quot;:[{&quot;id&quot;:2,&quot;name&quot;:&quot;福利放送&quot;,&quot;default&quot;:false},{&quot;id&quot;:8,&quot;name&quot;:&quot;我要推广&quot;,&quot;default&quot;:true}],&quot;defaultForumIds&quot;:[8],&quot;currentForumId&quot;:0,&quot;warning&quot;:&quot;&quot;}"
  data-home-keyword-filter-user-id="10695"
  data-home-keyword-filter-settings-url="/home_keyword_filter_settings"
  data-home-keyword-filter-csrf="test-csrf" aria-label="设置帖子列表屏蔽"></button>
</body></html>`;

const SETTINGS = {
  ok: 1,
  exists: 0,
  settings: { presets: [], custom: [], users: [], forum_excluded_ids: [], forum_extra_ids: [] },
  updatedAt: 0,
};

const store = (globalThis as unknown as { __secureStore: Map<string, string> }).__secureStore;

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input).replace('https://linux.sb', '');
  if (url.includes('home_keyword_filter_settings')) {
    return new Response(JSON.stringify(SETTINGS), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(HOME, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}) as typeof fetch;

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

async function main() {
  console.log('帖子列表屏蔽设置 · 上下文回归');

  store.set('lsb.access', 'lsb.test');
  store.set('lsb.refresh', 'r.test');
  store.set('lsb.cookies', 'bbs_auth=test');
  store.set('lsb.user', JSON.stringify({ id: '10695', name: 'miapi' }));
  // 关键场景：本地设置刚同步过（缓存新鲜），此时也必须补齐上下文
  store.set('lsb.topic-filter.v2.10695', JSON.stringify({
    settings: { presets: [], custom: [], users: [], forumExcludedIds: [], forumExtraIds: [] },
    pending: false,
    syncedAt: Date.now(),
  }));

  await hydrateSession();
  restoreSiteSession({
    sessions: {
      'lsb.test': {
        cookies: 'bbs_auth=test',
        refreshToken: 'r.test',
        // 这里只关心屏蔽设置链路，用户对象给最小可用形状即可
        user: { id: '10695', name: 'miapi' } as never,
      },
    },
    refresh: { 'r.test': 'lsb.test' },
  });

  await prepareTopicFilter('10695');
  const state = getTopicFilterState();
  check('缓存新鲜时仍能拿到常用关键词', state.context.presets.length === 2, JSON.stringify(state.context.presets));
  check('缓存新鲜时仍能拿到可屏蔽版块', state.context.forums.length === 2, JSON.stringify(state.context.forums.map((f) => f.name)));
  check('默认屏蔽版块正确', state.context.defaultForumIds.join(',') === '8', state.context.defaultForumIds.join(','));
  check('版块屏蔽开关已读到', state.context.forumEnabled === true);
  check('settings 地址与 csrf 已读到', Boolean(state.context.settingsUrl && state.context.csrf));
  check('没有同步错误', topicFilterError() === '', topicFilterError());

  console.log(fails ? `✗ ${fails} 项失败` : '✓ 全部通过');
  process.exit(fails ? 1 : 0);
}

void main();
