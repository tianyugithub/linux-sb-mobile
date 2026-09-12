/**
 * 官网搜索页（meilisearch 插件）离线回归。
 *
 * 样本取自 2026-09-12 登录态 `/search`：创作者 / 佩戴 UR 称号会给
 * `.meilisearch-search-cost-note.is-free`，表单没有 `data-meilisearch-search-charge-form`，
 * 不弹扣分确认。普通账号才挂 charge-form、文案是扣 1 积分。
 * 搜过一次之后结果页会带 `access` 票据，翻页 / 换范围 / 排序都要带上。
 *
 *   npm run check:search
 */
import { parseSearchPage } from '../src/services/live';

let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  if (!ok) fails += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};

const PAID = '<section class="meilisearch-search-page"><div class="meilisearch-search-head"><h2>搜索</h2>'
  + '<form class="meilisearch-search-form" method="post" action="/meilisearch_search" data-no-ajax="1" '
  + 'data-meilisearch-search-charge-form data-search-cost="1" data-search-balance="12">'
  + '<input type="hidden" name="_csrf" value="x">'
  + '<input type="search" name="q" value="" placeholder="搜索标题、主题内容和回帖" minlength="2" maxlength="120">'
  + '<input type="hidden" name="scope" value="all">'
  + '<input type="hidden" name="charge_confirmed" value="0"></form>'
  + '<p class="meilisearch-search-cost-note">每次提交搜索扣除 1 积分。确认后才会执行搜索。</p>'
  + '<div class="meilisearch-search-empty">输入关键词，搜索社区中的主题和回帖。</div></div></section>';

const FREE = '<section class="meilisearch-search-page"><div class="meilisearch-search-head"><h2>搜索</h2>'
  + '<form class="meilisearch-search-form" method="post" action="/meilisearch_search" data-no-ajax="1" '
  + 'data-search-cost="1" data-search-balance="994">'
  + '<input type="hidden" name="_csrf" value="x">'
  + '<input type="search" name="q" value="" placeholder="搜索标题、主题内容和回帖">'
  + '<input type="hidden" name="scope" value="all">'
  + '<input type="hidden" name="charge_confirmed" value="0"></form>'
  + '<p class="meilisearch-search-cost-note is-free">您是创作者用户组 / 佩戴UR称号，搜索免积分！</p>'
  + '<nav class="meilisearch-search-scopes" aria-label="搜索范围">'
  + '<a class="meilisearch-search-scope is-active" href="/search">全部内容</a>'
  + '<a class="meilisearch-search-scope" href="/search?scope=title">标题</a>'
  + '<a class="meilisearch-search-scope" href="/search?scope=body">主题正文</a>'
  + '<a class="meilisearch-search-scope" href="/search?scope=reply">回帖</a>'
  + '<a class="meilisearch-search-scope" href="/search?scope=user">用户</a></nav>'
  + '<div class="meilisearch-search-empty">输入关键词，搜索社区中的主题和回帖。</div></div></section>';

const RESULTS = '<section class="meilisearch-search-page"><form class="meilisearch-search-form" method="post" '
  + 'action="/meilisearch_search" data-no-ajax="1" data-search-cost="1" data-search-balance="994">'
  + '<input type="search" name="q" value="linux" placeholder="搜索标题、主题内容和回帖">'
  + '<input type="hidden" name="scope" value="all"></form>'
  + '<p class="meilisearch-search-cost-note is-free">您是创作者用户组 / 佩戴UR称号，搜索免积分！</p>'
  + '<div class="meilisearch-search-summary"><span>搜索“linux” · 全部内容 · 相关性 · 2013 个主题</span>'
  + '<form class="meilisearch-search-sort-form" method="get" action="/search" data-meilisearch-search-sort-form>'
  + '<input type="hidden" name="q" value="linux">'
  + '<input type="hidden" name="access" value="1789190743.deadbeef">'
  + '<input type="hidden" name="scope" value="all">'
  + '<label class="meilisearch-search-sort"><span>结果排序</span>'
  + '<select name="sort" data-meilisearch-search-sort>'
  + '<option value="relevance" selected>相关性</option>'
  + '<option value="latest">最新回复</option>'
  + '<option value="created">最新发布</option>'
  + '<option value="replies">回复最多</option>'
  + '<option value="views">浏览最多</option></select></label></form></div>'
  + '<ul class="meilisearch-search-results">'
  + '<li class="meilisearch-search-result"><div class="meilisearch-search-result-main">'
  + '<a class="meilisearch-search-result-title" href="/topic/13351">'
  + '<mark class="meilisearch-search-highlight">linux</mark></a>'
  + '<div class="meilisearch-search-result-snippet"><mark class="meilisearch-search-highlight">linux</mark>系统需要学习</div>'
  + '<div class="meilisearch-search-result-meta"><span>命中标题</span><span>技术交流</span>'
  + '<span>2026-08-17</span><span>0 条回复</span><span>76 次浏览</span></div></div></li>'
  + '<li class="meilisearch-search-result"><div class="meilisearch-search-result-main">'
  + '<a class="meilisearch-search-result-title" href="/topic/1">带图</a>'
  + '<div class="meilisearch-search-result-snippet">正文</div>'
  + '<div class="meilisearch-search-result-meta"><span>命中正文</span>'
  + '<span class="meilisearch-search-image-tag">包含图片</span></div></div></li>'
  + '</ul>'
  + '<div class="meilisearch-search-pagination" aria-label="搜索结果分页">第 1 页'
  + '<a href="/search?q=linux&amp;access=1789190743.deadbeef&amp;p=2">下一页</a></div>'
  + '</section>';

console.log('搜索页 · 免积分 / access 票据回归');

const paid = parseSearchPage(PAID, '', 'all', 'relevance', 1);
check('普通账号要扣积分', paid.free === false && paid.cost === 1, `free=${paid.free} cost=${paid.cost}`);
check('普通账号文案取自页面', paid.costNote === '每次提交搜索扣除 1 积分。确认后才会执行搜索。', paid.costNote);
check('空页没有 access 票据', paid.access === '', paid.access);

const free = parseSearchPage(FREE, '', 'all', 'relevance', 1);
check('UR / 创作者认成免积分', free.free === true && free.cost === 0, `free=${free.free} cost=${free.cost}`);
check(
  '免积分文案原样（含 UR 称号）',
  free.costNote === '您是创作者用户组 / 佩戴UR称号，搜索免积分！',
  free.costNote,
);
check('data-search-cost=1 时免积分也不按 1 去弹窗', free.cost === 0);

const results = parseSearchPage(RESULTS, 'linux', 'all', 'relevance', 1);
check('结果页仍是免积分', results.free === true);
check('解析 access 票据', results.access === '1789190743.deadbeef', results.access);
check('命中条数', results.hits.length === 2, String(results.hits.length));
check('高亮标记拆成纯文本标题', results.hits[0]?.title === 'linux', JSON.stringify(results.hits[0]?.title));
check('命中范围', results.hits[0]?.match === '命中标题', results.hits[0]?.match);
check('包含图片标签', results.hits[1]?.hasImage === true);
check('下一页', results.nextPage === '2', String(results.nextPage));
check('主题总数', results.total === 2013, String(results.total));

const oldRegexTrap = parseSearchPage(
  '<p class="meilisearch-search-cost-note is-free">您是创作者用户组 / 佩戴UR称号，搜索免积分！</p>'
  + '<form data-search-cost="1" data-search-balance="1"></form>',
  '',
  'all',
  'relevance',
  1,
);
check('is-free 多 class 时仍能读到文案（旧正则会漏）', oldRegexTrap.free && oldRegexTrap.costNote.includes('免积分'), oldRegexTrap.costNote);

console.log(fails ? `\n✗ 未通过：${fails} 项` : '\n✓ 通过：搜索免积分与 access 票据正常');
process.exit(fails ? 1 : 0);
