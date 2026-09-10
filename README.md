# LINUX SB Mobile

linux.sb 社区的第三方移动客户端，非官方项目。使用 Expo 与 React Native 开发，同一份代码可构建
Android 与 iOS 应用，目前仅在 Android 上完成构建与验证。

| | |
| --- | --- |
| 应用标识 | `sb.linux.mobile` |
| 当前版本 | 0.1.2 |
| 开源许可 | MIT |

## 功能

| 模块 | 内容 |
| --- | --- |
| 首页 | 版块切换与排序（新评论、新帖子、精华、抽奖、发卡、足迹、申精）；每日热帖；列表关键词与版块屏蔽 |
| 帖子 | 正文渲染（富文本、代码高亮、视频、图片、链接卡片）；楼层与盖楼；点赞打赏、收藏、淘帖专辑、举报 |
| 讨论 | 精华申请与竞猜；抽奖帖参与；回帖、回复与编辑（含人机验证） |
| 编辑 | Markdown 与所见即所得双模式（WebView 内核）；表情库、图片上传、全屏编辑、草稿 |
| 账号 | 登录（含人机验证）；签到中心与积分流水；称号中心与合成；榜单、邀请码、身份认证 |
| 沟通 | 私信（支持引用）；通知中心；搜索（帖子、用户、版块）；用户主页 |
| 设置 | 字号、深浅色、代码主题与字体、图片托管、帖子列表屏蔽规则；关于项目与检查更新 |
| 插件 | 「饼友助手」：积分账本、称号合成统计、称号市场监控、幸运打赏估算（默认关闭，仅本机统计） |

## 实现方式

linux.sb 未提供公开 API，因此客户端沿用网页端的访问方式：请求官方页面并解析 HTML，
登录状态使用官方 Cookie，图片与附件通过站点已有的上传通道提交。页面解析与业务接口集中在
`src/services/live.ts`，其余模块只负责渲染与状态管理。

这一方案的优势是功能覆盖面可以随官网同步演进，官方页面已经渲染出来的数据也可以直接使用；
代价是解析层与官网结构强耦合，官方改版后相关功能可能失效，需要依靠自查脚本定期核对。

## 环境要求

- Node.js 20 及以上
- 构建 Android 需要 Android SDK 与 JDK 17
- 构建 iOS 需要 Xcode，且仓库未包含 ios 原生工程，需先执行 `npx expo prebuild -p ios`

## 开发

```bash
npm install
npm start           # 启动 Expo 开发服务器
npm run android     # 编译并安装到已连接的安卓设备
npm run web         # 浏览器预览，需另行执行 npm run api
npm run typecheck   # TypeScript 类型检查
```

web 端的接口与静态资源由 `server/index.ts` 提供，默认监听 8788 端口；原生端不经过该服务。

## 构建发布版本

发布版本需要自己的签名密钥，密钥库与凭据都不应提交到仓库。

**1. 生成密钥库**（只需一次，请离线备份；丢失后无法再发布同应用的更新）

```bash
keytool -genkeypair -v -keystore ~/keystores/linux-sb-release.jks \
  -alias linux-sb -keyalg RSA -keysize 2048 -validity 10950
```

**2. 写入凭据** 至 `android/keystore.properties`（该文件已在 `.gitignore` 中）

```properties
storeFile=/absolute/path/to/linux-sb-release.jks
storePassword=…
keyAlias=linux-sb
keyPassword=…
```

**3. 构建与校验**

```bash
cd android && ./gradlew assembleRelease
# 产物：android/app/build/outputs/apk/release/app-release.apk
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

未配置 `android/keystore.properties` 时，release 构建会回退到 `debug.keystore`，
以便他人克隆仓库后直接构建。注意更换签名后无法覆盖安装，需要先卸载旧签名的应用。

版本号只在 `app.json` 中维护（`expo.version` 与 `android.versionCode`），
应用内的版本展示与「检查更新」都从这里读取。

## 检查更新

「关于项目」页读取项目仓库的最新版本并与当前版本比较：优先取 GitHub 的 latest release，
没有 release 时回退读取默认分支 `app.json` 中的 `expo.version`。仓库地址配置在
`src/data/app-info.ts` 的 `PROJECT_URL`。

## 项目结构

```
src/services/live.ts   页面解析与业务接口
src/services/          会话、查询缓存、本地通知、图片托管、检查更新
src/screens/           页面
src/components/        通用组件
src/theme/             颜色令牌与全局样式
src/editor/            编辑器内核，运行于 WebView；kernel.generated.ts 为构建产物
src/plugins/           插件注册表与统计逻辑，默认关闭且仅在本机计算
src/navigation/        路由、安全区、链接分流
scripts/               自查与回归脚本
server/                web 端接口与静态托管
modules/               原生模块，包含 Cookie 与本地通知
```

## 开发约定

- 业务代码不得写死颜色值，颜色统一取 `src/theme/palette.ts` 的令牌，通用样式集中在
  `src/theme/app-styles.ts`；界面元素优先复用 `src/components/ui.tsx` 与账户模块组件。
- 修改 `src/editor/kernel/` 下的内核源码后，需执行 `npm run build:editor` 重新生成产物。
- 提交前应通过类型检查与下列脚本，其中 `check:drift` 需要联网：

```bash
npm run check:ui        # 写死颜色与自建 StyleSheet
npm run check:hooks     # hook 调用不得出现在 return 之后（会崩 App）
npm run check:update    # 检查更新的版本解析与比较
npm run check:kernel    # 编辑器内核产物与源码一致
npm run check:cache     # 冷启动快照
npm run check:stamp     # 官方帖子印章识别
npm run check:filter    # 帖子列表屏蔽规则
npm run check:checkin   # 签到数据装配
npm run check:hot       # 每日热帖解析
npm run check:captcha   # 人机验证与精华申请约束
npm run check:helper    # 插件统计逻辑
npm run check:drift     # 官网结构标记与内置数据
```

## 已知限制

- 页面解析依赖官网结构，官方改版后需要同步更新解析层。
- 仓库未包含 ios 原生工程，iOS 端尚未完整验证。
- 部分功能受官方页面条件约束，例如抽奖帖回帖的人机验证、精华申请竞猜的提交次数。

## 许可证

本项目基于 [MIT 许可证](./LICENSE) 发布。

## 免责声明

本项目为非官方客户端，与 linux.sb 官方无隶属关系，社区内容的版权归原站与原作者所有。
客户端使用使用者本人的账号会话，不上传用户内容；内置插件的统计仅在本机完成。
