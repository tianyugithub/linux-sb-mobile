/**
 * 精华申请（申精）相关的官方约束。
 *
 * 官方 `topic_essence_review_vote` 表单里的竞猜理由：
 *   <textarea name="reason" rows="3" maxlength="300"
 *     placeholder="请填写竞猜理由，提交后会作为一条评议回帖发布" required></textarea>
 *
 * 两条要紧的事实：
 *   1. 上限 300 字，必填；
 *   2. **理由会作为一条评议回帖发布**，所以提交成功后要能定位到那条回帖。
 *
 * 另外，作者的「申请帖子加精」表单（`topic-essence-review-apply-form` → `/topic_essence_review_apply`）
 * 并没有理由字段：一键提交 + 官方自带确认文案，理由只出现在竞猜（评议）里。
 */
export const ESSENCE_REASON_MAX = 300;

/**
 * 理由下限。
 *
 * 注意：官方页面里**查不到这个下限** —— 理由框只有 `required` 和 `maxlength="300"`，
 * 页面三个脚本（`t.linux.sb/script.js`、`/app/assets/index.js`、`/app/assets/plugins.js`）
 * 里连「竞猜」「essence」都没有，所以下限与「不能重复竞猜」都是**服务端**在提交时拦的
 * （下线时官网只会给一句 flash 报错）。这里按实测规则在本地先拦一道，省一次往返。
 */
export const ESSENCE_REASON_MIN = 5;
