import appConfig from '../../app.json';

/**
 * 应用信息的唯一来源。
 *
 * 版本号只写在 `app.json`（`expo.version` / `expo.android.versionCode`）里，
 * 「关于项目」页与设置页底部都从这里读，避免三处各写一份然后对不上。
 */
const expo = appConfig.expo;

export const APP_NAME = expo.name;
export const APP_SLUG = expo.slug;
export const APP_VERSION = expo.version;
export const APP_ID = expo.android?.package ?? '';
export const ANDROID_VERSION_CODE = Number(expo.android?.versionCode ?? 0);

/**
 * 项目主页。填在这里之后，「关于项目」页会出现「项目主页」入口，
 * 「检查更新」也从这里取 owner/repo，去读 release 或默认分支上的 app.json。
 */
export const PROJECT_URL: string = 'https://github.com/tianyugithub/linux-sb-mobile';

export const TECH_STACK = 'Expo 54 · React Native 0.81 · React 19';

export const APP_LICENSE = 'MIT';

/** 仓库里的许可证文件地址。 */
export const LICENSE_URL = PROJECT_URL ? `${PROJECT_URL}/blob/main/LICENSE` : '';

export const ABOUT_INTRO = '本项目是 linux.sb 社区的第三方移动客户端（非官方），使用 Expo 与 React Native 开发。'
  + '站点没有公开 API，客户端和网页端一样，直接请求官方页面并解析 HTML，登录状态沿用官方 Cookie。';

export const ABOUT_DATA = '所有请求都用你自己的账号会话发往 linux.sb，不会传到别的地方；'
  + '内置插件的统计只在本机算。';

export const ABOUT_DISCLAIMER = '本项目与 linux.sb 官方无隶属关系，社区内容的版权归原站与原作者所有。';
