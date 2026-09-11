import React from 'react';
import { Modal, Pressable, Switch, Text, TextInput, View } from 'react-native';
import type {
  TopicLotteryComposeDto,
  TopicRedPacketComposeDto,
  TopicLotteryPrizeInputDto,
  TopicSpecialType,
  TopicVirtualCardComposeDto,
} from '../types/api';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { GhostButton, PrimaryButton } from './ui';

const TYPE_CARDS: { value: TopicSpecialType; title: string; copy: string }[] = [
  { value: '', title: '普通帖', copy: '发布普通讨论主题' },
  { value: 'lottery', title: '抽奖帖', copy: '用户回帖参与抽奖！' },
  { value: 'virtual_card', title: '发卡帖', copy: '用户用积分或烧饼兑换卡密' },
  { value: 'red_packet', title: '红包帖', copy: '用户合格回复后领取积分红包' },
];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function toLocalStamp(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function clampStamp(value: Date, min?: string, max?: string) {
  let next = value.getTime();
  const minAt = min ? new Date(min).getTime() : NaN;
  const maxAt = max ? new Date(max).getTime() : NaN;
  if (!Number.isNaN(minAt)) next = Math.max(next, minAt);
  if (!Number.isNaN(maxAt)) next = Math.min(next, maxAt);
  return toLocalStamp(new Date(next));
}

function prizeValueMeta(type: string, walletName: string) {
  if (type === 'points') return { label: '每份积分', help: '每位中奖者获得的积分', placeholder: '例如：100' };
  if (type === 'wallet') return { label: `每份${walletName}`, help: '发布时从钱包托管给中奖者', placeholder: '例如：100' };
  if (type === 'code') return { label: '兑换码', help: '每行一个，数量必须等于份数', placeholder: 'CODE-001\nCODE-002' };
  return { label: '发奖说明', help: '中奖后由发帖人线下联系发奖', placeholder: '例如：站内信联系收货信息' };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.composeField}>
      <Text style={styles.composeFieldLabel}>{label}</Text>
      {hint ? <Text style={styles.composeFieldHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function PublishWarning({ href, onLink }: { href: string; onLink: (href: string) => void }) {
  return (
    <View style={styles.composeWarning}>
      <Text style={styles.composeWarningText}>
        ⚠️ 请勿发布虚假抽奖和发卡，否则封号处理！发布前请阅读
        {href ? (
          <Text style={styles.composeWarningLink} onPress={() => onLink(href)}>《审核标准》</Text>
        ) : '《审核标准》'}
        。
      </Text>
    </View>
  );
}

function ToggleRow({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.composeToggleRow}>
      <View style={styles.composeToggleCopy}>
        <Text style={styles.composeToggleTitle}>{title}</Text>
        <Text style={styles.composeFieldHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: C.line, true: C.red }}
        thumbColor="#fff"
      />
    </View>
  );
}

export function TopicTypePicker({
  specialType,
  hasLottery,
  hasCard,
  hasRedPacket,
  onSelect,
}: {
  specialType: TopicSpecialType;
  hasLottery: boolean;
  hasCard: boolean;
  hasRedPacket: boolean;
  onSelect: (value: TopicSpecialType) => void;
}) {
  if (!hasLottery && !hasCard && !hasRedPacket) return null;
  const items = TYPE_CARDS.filter((item) => {
    if (item.value === '') return true;
    if (item.value === 'lottery') return hasLottery;
    if (item.value === 'virtual_card') return hasCard;
    return hasRedPacket;
  });
  return (
    <View style={styles.composeSection}>
      <Text style={styles.composeSectionTitle}>主题类型</Text>
      <View style={styles.composeTypeRow}>
        {items.map((item) => {
          const on = specialType === item.value;
          return (
            <Pressable
              key={item.title}
              onPress={() => onSelect(item.value)}
              style={[styles.composeTypeCard, on && styles.composeTypeCardOn]}
            >
              <View style={[styles.composeTypeDot, on && styles.composeTypeDotOn]} />
              <Text style={[styles.composeTypeTitle, on && styles.composeTypeTitleOn]}>{item.title}</Text>
              <Text style={styles.composeTypeCopy} numberOfLines={2}>{item.copy}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function LotteryFields({
  lottery,
  onChange,
  onLink,
}: {
  lottery: TopicLotteryComposeDto;
  onChange: (next: TopicLotteryComposeDto) => void;
  onLink: (href: string) => void;
}) {
  const setPrize = (index: number, patch: Partial<TopicLotteryPrizeInputDto>) => {
    onChange({
      ...lottery,
      prizes: lottery.prizes.map((item, current) => (current === index ? { ...item, ...patch } : item)),
    });
  };
  const chips = [
    { label: '12小时', hours: 12 },
    { label: '1天', hours: 24 },
    { label: '2天', hours: 48 },
    { label: '3天', hours: 72 },
  ];
  return (
    <View style={styles.composePanel}>
      <PublishWarning href={lottery.reviewUrl} onLink={onLink} />
      <Text style={styles.composeWalletNote}>
        {`发布抽奖至少需托管 ${lottery.walletMin} 个${lottery.walletName}；当前钱包余额 ${lottery.walletBalance} 个。余额不足请`}
        <Text style={styles.composeWarningLink} onPress={() => onLink(lottery.walletUrl)}>去充值</Text>
        。
      </Text>
      <Field label="开奖时间" hint="最晚可设置为 3 天后">
        <TextInput
          value={lottery.drawAt}
          onChangeText={(drawAt) => onChange({ ...lottery, drawAt })}
          placeholder={lottery.drawMin || '2026-09-10T20:00'}
          placeholderTextColor={C.dim}
          style={styles.composeInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.composeChipWrap}>
          {chips.map((chip) => (
            <Pressable
              key={chip.label}
              onPress={() => onChange({
                ...lottery,
                drawAt: clampStamp(new Date(Date.now() + chip.hours * 3600 * 1000), lottery.drawMin, lottery.drawMax),
              })}
              style={styles.composeMiniChip}
            >
              <Text style={styles.composeMiniChipText}>{chip.label}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label="自动开奖人数" hint={`达到人数后自动开奖，填0不启用，上限为${lottery.participantMax}人。`}>
        <TextInput
          value={lottery.participantTarget}
          onChangeText={(participantTarget) => onChange({ ...lottery, participantTarget })}
          keyboardType="number-pad"
          style={styles.composeInput}
        />
      </Field>
      <Field label="参与回复最少字数" hint="去除空白后计算，低于门槛不能回复参与">
        <TextInput
          value={lottery.minReplyChars}
          onChangeText={(minReplyChars) => onChange({ ...lottery, minReplyChars })}
          keyboardType="number-pad"
          style={styles.composeInput}
        />
      </Field>
      <ToggleRow
        title="回帖需要验证码"
        hint="默认开启，参与抽奖必须完成人机验证，可以自行取消。"
        value={lottery.replyCaptcha}
        onChange={(replyCaptcha) => onChange({ ...lottery, replyCaptcha })}
      />
      {lottery.ruleNote ? <Text style={styles.composeRuleNote}>{lottery.ruleNote}</Text> : null}
      <View style={styles.composePrizeHead}>
        <Text style={styles.composePrizeHeadTitle}>奖品设置</Text>
        <Pressable
          onPress={() => onChange({
            ...lottery,
            prizes: [...lottery.prizes, { name: '', type: lottery.prizeTypes[0]?.value || 'points', quantity: '1', value: '' }],
          })}
          style={styles.composeAddPrize}
        >
          <Text style={styles.composeAddPrizeText}>添加奖品</Text>
        </Pressable>
      </View>
      {lottery.prizes.map((prize, index) => {
        const meta = prizeValueMeta(prize.type, lottery.walletName);
        return (
          <View key={`prize-${index}`} style={styles.composePrizeCard}>
            <View style={styles.composePrizeTop}>
              <TextInput
                value={prize.name}
                onChangeText={(name) => setPrize(index, { name })}
                placeholder="例如：一等奖"
                placeholderTextColor={C.dim}
                style={[styles.composeInput, styles.composePrizeName]}
              />
              <TextInput
                value={prize.quantity}
                onChangeText={(quantity) => setPrize(index, { quantity })}
                keyboardType="number-pad"
                placeholder="份数"
                placeholderTextColor={C.dim}
                style={[styles.composeInput, styles.composePrizeQty]}
              />
              {lottery.prizes.length > 1 ? (
                <Pressable onPress={() => onChange({ ...lottery, prizes: lottery.prizes.filter((_, current) => current !== index) })} hitSlop={8}>
                  <Text style={styles.composePrizeRemove}>×</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.composeChipWrap}>
              {lottery.prizeTypes.map((item) => (
                <Pressable
                  key={item.value}
                  onPress={() => setPrize(index, { type: item.value })}
                  style={[styles.composeMiniChip, prize.type === item.value && styles.composeMiniChipOn]}
                >
                  <Text style={[styles.composeMiniChipText, prize.type === item.value && styles.composeMiniChipTextOn]}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.composeFieldLabel}>{meta.label}</Text>
            <TextInput
              value={prize.value}
              onChangeText={(value) => setPrize(index, { value })}
              placeholder={meta.placeholder}
              placeholderTextColor={C.dim}
              style={[styles.composeInput, styles.composeTextarea]}
              multiline
            />
            <Text style={styles.composeFieldHint}>{meta.help}</Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * 红包帖的表单（对应官网发帖页的 `.red-packet-compose`）。
 *
 * 官网的限值来自 `data-red-packet-*`（单份 50–1000 积分、总额至少 500），
 * 这里只做即时校验与花费预估，最终仍以服务端为准。
 */
export function RedPacketFields({
  redPacket,
  onChange,
  onLink,
}: {
  redPacket: TopicRedPacketComposeDto;
  onChange: (next: TopicRedPacketComposeDto) => void;
  onLink: (href: string) => void;
}) {
  const isRandom = redPacket.distribution === 'random';
  const pieces = Math.max(1, Number.parseInt(redPacket.count, 10) || 1);
  const unit = Math.max(0, Number.parseInt(redPacket.fixedAmount, 10) || 0);
  const total = Math.max(0, Number.parseInt(redPacket.totalAmount, 10) || 0);
  const cost = isRandom ? total : pieces * unit;
  const minUnit = redPacket.minUnit > 0 ? redPacket.minUnit : 1;
  const maxUnit = redPacket.maxUnit > 0 ? redPacket.maxUnit : minUnit;
  const minTotal = Math.max(pieces * minUnit, redPacket.minTotal > 0 ? redPacket.minTotal : 1);
  const after = redPacket.points - cost;
  const tooLittle = cost > 0 && cost > redPacket.points;
  const totalHint = `随机金额红包按总额发放：至少 ${minTotal} 积分，最多 ${maxUnit * pieces} 积分。`;
  return (
    <View style={styles.composePanel}>
      <PublishWarning href={redPacket.reviewUrl} onLink={onLink} />
      <Field label="红包类型" hint="固定金额：每份一样多；随机金额：按总额随机拆分。">
        <View style={styles.composeChipWrap}>
          {([
            { value: 'fixed', label: '固定金额红包' },
            { value: 'random', label: '随机金额红包' },
          ] as const).map((item) => (
            <Pressable
              key={item.value}
              onPress={() => onChange({ ...redPacket, distribution: item.value })}
              style={[styles.composeMiniChip, redPacket.distribution === item.value && styles.composeMiniChipOn]}
            >
              <Text style={[styles.composeMiniChipText, redPacket.distribution === item.value && styles.composeMiniChipTextOn]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label="领取规则" hint="先到先得：合格回复按顺序发完为止；随机获得：每人只有一次机会，按概率发放。">
        <View style={styles.composeChipWrap}>
          {([
            { value: 'first_come', label: '先到先得' },
            { value: 'random_chance', label: '随机获得' },
          ] as const).map((item) => (
            <Pressable
              key={item.value}
              onPress={() => onChange({ ...redPacket, claimRule: item.value })}
              style={[styles.composeMiniChip, redPacket.claimRule === item.value && styles.composeMiniChipOn]}
            >
              <Text style={[styles.composeMiniChipText, redPacket.claimRule === item.value && styles.composeMiniChipTextOn]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label="最低回复字数" hint="可设置 5 至 50 个字；不足字数的回帖领不到红包。">
        <TextInput
          value={redPacket.minReplyChars}
          onChangeText={(minReplyChars) => onChange({ ...redPacket, minReplyChars })}
          keyboardType="number-pad"
          style={styles.composeInput}
        />
      </Field>
      <Field label="红包份数" hint="1 至 1000 份，发帖人不能领取，同一用户只能领取一次。">
        <TextInput
          value={redPacket.count}
          onChangeText={(count) => onChange({ ...redPacket, count })}
          keyboardType="number-pad"
          style={styles.composeInput}
        />
      </Field>
      {isRandom ? (
        <Field label="红包总额" hint={totalHint}>
          <TextInput
            value={redPacket.totalAmount}
            onChangeText={(totalAmount) => onChange({ ...redPacket, totalAmount })}
            keyboardType="number-pad"
            style={styles.composeInput}
          />
        </Field>
      ) : (
        <Field label="单个红包" hint={`每份 ${minUnit} 至 ${maxUnit} 积分。`}>
          <TextInput
            value={redPacket.fixedAmount}
            onChangeText={(fixedAmount) => onChange({ ...redPacket, fixedAmount })}
            keyboardType="number-pad"
            style={styles.composeInput}
          />
        </Field>
      )}
      <Text style={styles.composeWalletNote}>
        {`积分余额 ${redPacket.points}，本次总消耗 ${cost}，发布后余额 ${after}。`}
        {tooLittle ? ' 余额不足，请先获取积分。' : ''}
      </Text>
    </View>
  );
}

export function VirtualCardFields({
  card,
  onChange,
  onLink,
}: {
  card: TopicVirtualCardComposeDto;
  onChange: (next: TopicVirtualCardComposeDto) => void;
  onLink: (href: string) => void;
}) {
  return (
    <View style={styles.composePanel}>
      <PublishWarning href={card.reviewUrl} onLink={onLink} />
      <Field label="卡片名称" hint="例如：月卡兑换码、软件激活码。">
        <TextInput
          value={card.name}
          onChangeText={(name) => onChange({ ...card, name })}
          style={styles.composeInput}
        />
      </Field>
      <Field label="积分种类" hint="可选择站内积分；启用社区钱包后也可选择烧饼。">
        <View style={styles.composeChipWrap}>
          {card.currencies.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => onChange({ ...card, currency: item.value })}
              style={[styles.composeMiniChip, card.currency === item.value && styles.composeMiniChipOn]}
            >
              <Text style={[styles.composeMiniChipText, card.currency === item.value && styles.composeMiniChipTextOn]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label="兑换价格">
        <TextInput
          value={card.price}
          onChangeText={(price) => onChange({ ...card, price })}
          keyboardType="number-pad"
          style={styles.composeInput}
        />
      </Field>
      <Field label="每人限购数量" hint="默认为 1；填写 0 表示不限制。同一用户达到数量后不能继续兑换。">
        <TextInput
          value={card.purchaseLimit}
          onChangeText={(purchaseLimit) => onChange({ ...card, purchaseLimit })}
          keyboardType="number-pad"
          style={styles.composeInput}
        />
      </Field>
      <ToggleRow
        title="购买成功后自动回帖"
        hint="默认关闭。开启后，买家兑换成功会自动回复本帖，可用于公开购买动态或顶帖。"
        value={card.autoReply}
        onChange={(autoReply) => onChange({ ...card, autoReply })}
      />
      <Field label="自动回帖内容" hint="支持变量：{card_name} 卡片名称、{price} 消耗积分、{username} 买家用户名。请勿填写卡密变量或敏感信息。">
        <TextInput
          value={card.autoReplyContent}
          onChangeText={(autoReplyContent) => onChange({ ...card, autoReplyContent })}
          style={[styles.composeInput, styles.composeTextarea]}
          multiline
        />
      </Field>
      <Field label="添加虚拟卡" hint="每行一张卡。编辑帖子时这里只显示未售出的卡；已售卡和购买记录不会被修改。最多 5000 张。">
        <TextInput
          value={card.values}
          onChangeText={(values) => onChange({ ...card, values })}
          style={[styles.composeInput, styles.composeCardValues]}
          multiline
          textAlignVertical="top"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>
    </View>
  );
}

export function WalletNoticeDialog({
  visible,
  walletName,
  walletMin,
  walletUrl,
  helpUrl,
  onClose,
  onRecharge,
  onHelp,
}: {
  visible: boolean;
  walletName: string;
  walletMin: number;
  walletUrl: string;
  helpUrl: string;
  onClose: () => void;
  onRecharge: (url: string) => void;
  onHelp: (url: string) => void;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={styles.confirmModalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.confirmPanel, { backgroundColor: C.surface, borderColor: C.line }]}>
          <View style={styles.confirmHead}>
            <Text style={styles.confirmTitle}>钱包余额不足</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="关闭">
              <Text style={styles.confirmClose}>×</Text>
            </Pressable>
          </View>
          <View style={styles.confirmBody}>
            <Text style={styles.confirmMessage}>
              {`发布抽奖至少需要 ${walletMin} 个${walletName}，请先充值后再填写抽奖信息。\n烧饼将作为奖品之一抽给饼友！ `}
            </Text>
            {helpUrl ? (
              <Pressable onPress={() => onHelp(helpUrl)} hitSlop={6}>
                <Text style={styles.confirmRules}>点击查看详细说明 &gt;&gt;</Text>
              </Pressable>
            ) : null}
            <View style={styles.confirmActions}>
              <GhostButton label="取消" onPress={onClose} />
              <PrimaryButton label="去充值" onPress={() => { onRecharge(walletUrl); onClose(); }} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
