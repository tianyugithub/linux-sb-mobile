import type { ImageSourcePropType } from 'react-native';
import { titleDef } from './title-catalog';

const TITLE_IMAGES: Record<string, ImageSourcePropType> = {
  萌新: require('../../assets/titles/title-mengxin.png'),
  潜水员: require('../../assets/titles/title-qianshuiyuan.png'),
  吃瓜群众: require('../../assets/titles/title-chigua.png'),
  路人甲: require('../../assets/titles/title-lurenjia.png'),
  打酱油的: require('../../assets/titles/title-dajiangyou.png'),
  常客: require('../../assets/titles/title-changke.png'),
  话题王: require('../../assets/titles/title-huatiwang.png'),
  回复达人: require('../../assets/titles/title-huifudaren.png'),
  夜猫子: require('../../assets/titles/title-yemaozi.png'),
  表情包大户: require('../../assets/titles/title-biaoqingbao.png'),
  反贼: require('../../assets/titles/title-fanzei.png'),
  论坛之星: require('../../assets/titles/title-luntanzhixing.png'),
  万人迷: require('../../assets/titles/title-wanrenmi.png'),
  键盘侠: require('../../assets/titles/title-jianpanxia.png'),
  精华收割机: require('../../assets/titles/title-jinghuashouge.png'),
  社交达人: require('../../assets/titles/title-shejiaodaren.png'),
  欧皇: require('../../assets/titles/title-ouhuang.png'),
  氪金大佬: require('../../assets/titles/title-kejin.png'),
  传说之龙: require('../../assets/titles/title-chuanqizhilong.png'),
  全站偶像: require('../../assets/titles/title-quanzhanouxiang.png'),
  管理员之友: require('../../assets/titles/title-guanliyuan.png'),
  隐藏大佬: require('../../assets/titles/title-yincangdalao.png'),
  富可敌国: require('../../assets/titles/title-fukediguo.png'),
  非必要不抽奖: require('../../assets/titles/title-feibiyabouchoujiang.png'),
  秩序破坏神: require('../../assets/titles/title-zhixupohuaishen.png'),
  真的站长: require('../../assets/titles/title-zhendezhangzhang.png'),
  建设者: require('../../assets/titles/title-jianshezhe.png'),
  创作者: require('../../assets/titles/title-chuangzuozhe.png'),
  伪装者: require('../../assets/titles/title-weizhuangzhe.png'),
};

const FALLBACK = require('../../assets/titles/title-default.png');

export function titleArt(name?: string | null): ImageSourcePropType {
  if (!name) return FALLBACK;
  const key = name.trim();
  if (TITLE_IMAGES[key]) return TITLE_IMAGES[key];
  const def = titleDef(key);
  if (def && TITLE_IMAGES[def.name]) return TITLE_IMAGES[def.name];
  return FALLBACK;
}
