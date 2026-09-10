import type { IonName } from '../../data';

/**
 * 插件注册表：**唯一**来源。
 *
 * 插件是 App 里「官网没有、由社区脚本搬过来」的增强功能，因此：
 *   - 一律标注第三方与原作者署名（见 thirdParty），不与"对齐官方"混在一起；
 *   - 数据只在本机抓取与计算，不上传；
 *   - 默认关闭，由用户在 设置 → 插件 里手动开启；
 *   - 界面必须复用现有组件与 app-styles，不得自带一套样式。
 */

export type PluginModuleDef = {
  id: string;
  name: string;
  icon: IonName;
  /** 一句话说明这个模块干什么。 */
  blurb: string;
};

export type PluginThirdParty = {
  /** 原版作者（论坛昵称）。 */
  author: string;
  authorUrl: string;
  /** 二开作者与仓库。 */
  fork: string;
  forkUrl: string;
  license: string;
};

export type PluginDef = {
  id: string;
  name: string;
  tagline: string;
  icon: IonName;
  description: string;
  origin: PluginThirdParty;
  /** 需要登录 linux.sb 才能用。 */
  requiresLogin: boolean;
  defaultEnabled: boolean;
  modules: PluginModuleDef[];
};

export const PLUGINS: PluginDef[] = [
  {
    id: 'helper',
    name: '饼友助手',
    tagline: '积分账本 · 称号合成 · 称号监控 · 幸运打赏',
    icon: 'sparkles-outline',
    description: '把积分收支、称号合成、市场上架监控和幸运打赏统计收进一个页面，全部在本机计算。',
    origin: {
      author: '豆包本包（干货助手）',
      authorUrl: 'https://linux.sb/user/313',
      fork: 'Evander-8（二开版）',
      forkUrl: 'https://github.com/Evander-8/userscripts/tree/main/LINUX.SB%E5%8A%A9%E6%89%8B',
      license: 'MIT',
    },
    requiresLogin: true,
    defaultEnabled: false,
    modules: [
      { id: 'points', name: '积分账本', icon: 'wallet-outline', blurb: '今日 / 昨日 / 近七天收支、分类占比与时间线' },
      { id: 'synth', name: '称号合成', icon: 'flask-outline', blurb: '只统计熔炼与配方合成，按称号级别汇总产出' },
      { id: 'market', name: '称号监控', icon: 'pulse-outline', blurb: '按称号名 + 期望价盯最新挂牌，命中就提醒' },
      { id: 'lucky', name: '幸运打赏', icon: 'gift-outline', blurb: '今日打赏次数、幸运奖励收入与中奖率估算' },
    ],
  },
];

export function pluginById(id: string): PluginDef | null {
  return PLUGINS.find((item) => item.id === id) ?? null;
}

export function isPluginEnabled(enabled: Record<string, boolean>, id: string): boolean {
  const plugin = pluginById(id);
  if (!plugin) return false;
  return enabled[id] ?? plugin.defaultEnabled;
}
