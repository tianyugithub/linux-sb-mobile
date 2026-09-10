import type { TitleListingDto } from '../../types/api';
import type { LuckyStats } from './points';

/**
 * 幸运打赏：今日统计 + 中奖率估算。
 *
 * 规则的三个关键数字来自官方规则帖（脚本里写死为 每日 10 次 / 累计 1000 分归零 / 回帖门槛），
 * 官方改过至少一版，所以这里：优先从规则帖文本解析，解析不到才用兜底常量，
 * 并且 UI 上一律标明「估算」。
 */

export const LUCKY_RULE_TOPIC_ID = '20953';

export const LUCKY_FALLBACK_RULES = {
  /** 每日幸运奖励次数上限。 */
  dailyCap: 10,
  /** 今日幸运奖励累计达到该值后概率归零。 */
  highThreshold: 1000,
  /** 需要当日回帖达到该次数才解锁（脚本记录：新规则把门槛设为极大值 = 实际已下架）。 */
  replyCap: 99999,
  /** 初始档概率（%）。 */
  baseProb: 36,
  /** 倍率区间文案。 */
  multiplier: '2-20',
};

export type LuckyRules = typeof LUCKY_FALLBACK_RULES;

/** 从规则帖正文里抠数字；抠不到的字段保留兜底值。 */
export function parseLuckyRules(text: string, fallback: LuckyRules = LUCKY_FALLBACK_RULES): LuckyRules {
  const body = String(text || '').replace(/\s+/g, ' ');
  const pick = (re: RegExp, current: number) => {
    const hit = body.match(re);
    const value = hit ? Number(String(hit[1]).replace(/[,\s]/g, '')) : NaN;
    return Number.isFinite(value) && value > 0 ? value : current;
  };
  return {
    dailyCap: pick(/每日(?:最多)?\s*(\d+)\s*次/, fallback.dailyCap),
    highThreshold: pick(/(?:累计|达到)\s*(\d+)\s*(?:分|积分)(?:后)?(?:概率|中奖率)?/, fallback.highThreshold),
    replyCap: pick(/回帖\s*(\d+)\s*次/, fallback.replyCap),
    baseProb: pick(/中奖率?\s*(?:为|约|是)?\s*(\d+)\s*%/, fallback.baseProb),
    multiplier: body.match(/倍率?\s*([\d]+\s*[-~～]\s*[\d]+)/)?.[1]?.replace(/\s+/g, '') ?? fallback.multiplier,
  };
}

export type LuckyEstimate = {
  prob: number;
  multiplier: string;
  tier: 'locked' | 'over' | 'low' | 'normal';
  note: string;
  /** 回帖门槛未达标 = 概率锁定（当前规则下等于不可用）。 */
  locked?: boolean;
};

export function estimateLucky(stats: LuckyStats, repliesToday: number, rules: LuckyRules = LUCKY_FALLBACK_RULES): LuckyEstimate {
  const replies = Number.isFinite(repliesToday) ? repliesToday : 0;
  if (replies < rules.replyCap) {
    return {
      prob: 0,
      multiplier: '已下架',
      tier: 'locked',
      locked: true,
      note: `回帖 ${replies}/${rules.replyCap} 后解锁 · 当前规则下实际不可用`,
    };
  }
  if (stats.lucky >= rules.dailyCap) {
    return {
      prob: 0,
      multiplier: '不触发',
      tier: 'over',
      note: `已达每日 ${rules.dailyCap} 次抽奖上限（${stats.lucky}/${rules.dailyCap}）`,
    };
  }
  if (stats.luckyGained >= rules.highThreshold) {
    return {
      prob: 0,
      multiplier: '不触发',
      tier: 'over',
      note: `今日幸运奖励累计 ${stats.luckyGained} ≥ ${rules.highThreshold}，概率归 0`,
    };
  }
  return {
    prob: rules.baseProb,
    multiplier: rules.multiplier,
    tier: 'low',
    note: `幸运奖励累计 ${stats.luckyGained}/${rules.highThreshold} 分 · 已打赏 ${stats.distinctPlayers} 位玩家`,
  };
}

export function luckyRoi(stats: LuckyStats): number | null {
  if (stats.spent <= 0) return null;
  return Math.round((stats.luckyGained / stats.spent) * 100);
}
