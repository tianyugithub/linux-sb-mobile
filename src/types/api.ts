export type ApiErrorBody = {
  code: string;
  message: string;
  requestId: string;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  lastPage?: number;
  page?: number;
  /**
   * 这一页上游到底有没有数据行。
   *
   * 与 `items.length` 不同：积分流水页里筛「每日签到」时，中间好几页可能一条都不剩，
   * 但后面还有更早的记录，所以翻页要靠这个判断「到头了没」。
   */
  hasRows?: boolean;
};

/**
 * 首页侧栏「每日热帖」（官方 `daily-hot-topics-card`）。
 *
 * 官方按近 24 小时回复数排 8 条，只给 id / 标题 / 回复数，没有作者和版块。
 */
export type DailyHotTopicDto = {
  id: string;
  title: string;
  replies: number;
  /** 官方写的统计窗口，正常是「近 24 小时」。 */
  window: string;
};

/** 首页帖子列表：第一页会连「每日热帖」一起带回来（同一份 HTML，无额外请求）。 */
export type HomeFeedDto = CursorPage<TopicDto> & {
  hotTopics?: DailyHotTopicDto[];
};

export type TopicTagType =
  | 'pinned'
  | 'featured'
  | 'hot'
  | 'lottery'
  | 'card'
  | 'apply_featured'
  /** 官方 topic_stamp 印章：荐 / 精 / 热 / 新。 */
  | 'recommend'
  | 'essence'
  | 'new'
  /** 官方新加、App 还不认识的印章（文字仍照页面显示，颜色等学到后再上）。 */
  | 'stamp';

export type TopicTag = {
  type: TopicTagType;
  label: string;
  /** 官方 topic_stamp 的原始种类（topic-stamp-<kind>）。 */
  kind?: string;
  /** 官方 title 属性，用作无障碍说明。 */
  title?: string;
};

export type FeedSort = 'latest_comment' | 'latest_topic' | 'featured' | 'lottery' | 'card' | 'apply_featured' | 'footprint';

export type UserGroup = '访客' | '饼友' | '创作者' | '社区主理人';

export type UserDto = {
  id: string;
  name: string;
  title: string;
  group: UserGroup;
  groupLabel: string;
  points: number;
  uid: string;
  avatar: string;
  accent: string;
  bio: string;
  topicCount: number;
  replyCount: number;
  joinedAt: string;
  /** 是否在线：来自官网页面上的在线用户 id 列表。 */
  online?: boolean;
};

export type SessionDto = {
  token: string;
  refreshToken: string;
  user: UserDto;
};

export type CaptchaChallengeDto = {
  endpoint: string;
  widgetScript: string;
  wasmUrl: string;
};

export type ForumDto = {
  id: string;
  name: string;
  group: string;
  desc: string;
  topics: number;
  posts: number;
  today: number;
  accent: string;
  icon: string;
  latest: string;
  latestAt: string;
};

export type TopicDto = {
  id: string;
  title: string;
  body: string;
  forumId: string;
  forumName: string;
  authorId: string;
  authorName: string;
  authorTitle?: string;
  authorTitleSerial?: string;
  authorGroup?: string;
  avatar: string;
  accent: string;
  createdAt: string;
  replyCount: number;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  liked: boolean;
  favorited: boolean;
  tags: TopicTag[];
  lastPage?: number;
  hasUnread?: boolean;
  unreadPage?: number;
  unreadFloor?: string;
  lastReplier?: string;
  lastReplierId?: string;
  online?: boolean;
  editedBy?: string;
  editedById?: string;
  editedAt?: string;
};

export type TopicPermissions = {
  canEdit: boolean;
  canDelete: boolean;
  canComment: boolean;
  canLike: boolean;
  canFavorite: boolean;
  canReward: boolean;
};

export type BarrageItemDto = {
  user: string;
  text: string;
  amount: number | null;
  avatar?: string;
};

export type EssencePayoutDto = {
  name: string;
  points: number;
};

export type EssenceVoteDto = {
  status: string;
  statusKey: 'voting' | 'review' | 'featured' | 'ended';
  progress: number;
  max: number;
  supportVotes: number;
  supportPoints: number;
  opposeVotes: number;
  opposePoints: number;
  deadline: string;
  endedAt: string;
  pool: number;
  poolGift: number;
  poolAuthor: number;
  poolPaid: number;
  poolPending: number;
  poolResult: string;
  payouts: EssencePayoutDto[];
  success: string;
  weight: number;
  note: string;
  restriction: string;
  canVote: boolean;
  choice: 'support' | 'oppose' | null;
  /**
   * 我已经提交过的竞猜理由（官方把理由作为一条评议回帖发布，页面上也会回显）。
   * 有值 = 写过理由了，官方不再给表单（「已经写过理由的不再进行显示编辑框」）。
   */
  myReason?: string;
  /** 刚提交成功时那条评议回帖（官方把理由作为回帖发布，前台据此把它并进列表并定位）。 */
  postedCommentId?: string | null;
  postedComment?: CommentDto | null;
};

export type DonateInfoDto = {
  blocked?: boolean;
  title?: string;
  message?: string;
  warning?: string;
  replyNeed?: number;
  replyHave?: number;
  rewardPeople: number;
  likeCount: number;
  totalPoints: number;
  balance: number;
  presets: number[];
};

export type ReportReasonDto = {
  id: string;
  label: string;
};

export type ReportFormDto = {
  title: string;
  targetType: 'reply' | 'topic';
  targetId: string;
  targetUser: string;
  topicTitle: string;
  deposit: number;
  warning: string;
  detailsHint: string;
  reasons: ReportReasonDto[];
  closed?: boolean;
  message?: string;
};

export type TopicCollectionPickDto = {
  id: string;
  title: string;
  included: boolean;
};

export type TopicSpecialType = '' | 'lottery' | 'virtual_card';

export type TopicComposeForumDto = {
  id: string;
  name: string;
};

export type TopicLotteryPrizeInputDto = {
  name: string;
  type: string;
  quantity: string;
  value: string;
};

export type TopicOptionDto = {
  value: string;
  label: string;
};

export type TopicLotteryComposeDto = {
  originalType: string;
  drawAt: string;
  drawMin: string;
  drawMax: string;
  participantTarget: string;
  participantMax: number;
  minReplyChars: string;
  replyCaptcha: boolean;
  walletName: string;
  walletUrl: string;
  walletHelpUrl: string;
  walletMin: number;
  walletBalance: number;
  reviewUrl: string;
  ruleNote: string;
  prizes: TopicLotteryPrizeInputDto[];
  prizeTypes: TopicOptionDto[];
};

export type TopicVirtualCardComposeDto = {
  originalType: string;
  name: string;
  currency: string;
  currencies: TopicOptionDto[];
  price: string;
  purchaseLimit: string;
  autoReply: boolean;
  autoReplyContent: string;
  values: string;
  reviewUrl: string;
};

export type TopicEditorDto = {
  title: string;
  body: string;
  forum: string;
  forumId: string;
  forums: TopicComposeForumDto[];
  specialType: TopicSpecialType;
  lottery: TopicLotteryComposeDto | null;
  virtualCard: TopicVirtualCardComposeDto | null;
};

export type TopicComposeInput = {
  title: string;
  body: string;
  forum: string;
  specialType?: TopicSpecialType;
  lottery?: {
    originalType?: string;
    drawAt: string;
    participantTarget: string;
    minReplyChars: string;
    replyCaptcha: boolean;
    prizes: TopicLotteryPrizeInputDto[];
  };
  virtualCard?: {
    originalType?: string;
    name: string;
    currency: string;
    price: string;
    purchaseLimit: string;
    autoReply: boolean;
    autoReplyContent: string;
    values: string;
  };
};

export type TopicDetailDto = {
  topic: TopicDto;
  permissions: TopicPermissions;
  /**
   * 这帖回帖需要人机验证（官方 `cap-verification-widget`）。
   * 只有抽奖帖且作者保留了「回帖需要验证码」（默认开启）时才会出现，
   * 提交回帖时必须带上 `cap_token`，否则官网直接拒绝。
   */
  replyCaptcha?: boolean;
  /** 该页 `data-cap-*` 给出的验证服务配置（缺省时前台回退到登录页那份）。 */
  replyCaptchaConfig?: CaptchaChallengeDto | null;
  vote: EssenceVoteDto | null;
  barrage: BarrageItemDto[];
  lottery: TopicLotteryDto | null;
  virtualCard: TopicVirtualCardDto | null;
  collections: TopicCollectionPickDto[];
};

export type TopicLotteryPrizeDto = {
  name: string;
  desc: string;
};

export type TopicLotteryWinnerDto = {
  userId: string;
  name: string;
  prize: string;
};

export type TopicLotteryDto = {
  title: string;
  subtitle: string;
  status: string;
  drawn: boolean;
  participants: number;
  condition: string;
  result: string;
  prizes: TopicLotteryPrizeDto[];
  winners: TopicLotteryWinnerDto[];
};

export type TopicVirtualCardDto = {
  kicker: string;
  name: string;
  status: string;
  stock: string;
  price: number;
  priceUnit: string;
  tip: string;
  sold: string;
  limit: string;
  codes: string[];
  canBuy: boolean;
  buyLabel: string;
  maxQuantity: number;
  notice: string;
};

export type CommentDto = {
  /** 「精华竞猜 · 预测会/不会加精」：竞猜理由作为评议回帖发布时官方给的标签。 */
  essenceLabel?: string;
  id: string;
  topicId: string;
  parentId: string | null;
  parentFloor: string | null;
  authorId: string;
  authorName: string;
  authorTitle: string;
  authorTitleSerial?: string;
  authorGroup?: string;
  uid: string;
  avatar: string;
  accent: string;
  body: string;
  mention: string | null;
  createdAt: string;
  likeCount: number;
  liked: boolean;
  floor: string | null;
  canEdit: boolean;
  canDelete: boolean;
  online?: boolean;
  coined?: boolean;
  likeTiers?: number[];
  editedBy?: string;
  editedById?: string;
  editedAt?: string;
  deleteConfirm?: string;
  deleteRulesUrl?: string;
};

export type CommentEditorDto = {
  body: string;
  confirm?: string;
  quote?: string;
  rulesUrl?: string;
  deleteConfirm?: string;
};

export type NotificationKind = 'mention' | 'reward' | 'system' | 'reply';

export type NotificationDto = {
  id: string;
  kind: NotificationKind;
  actorName: string;
  actorAvatar: string;
  accent: string;
  text: string;
  topicId: string | null;
  replyId?: string | null;
  topicTitle: string;
  createdAt: string;
  unread: boolean;
};

/** 积分流水一行（插件「积分账本」用，官方 points-rewards-detail 的原始字段）。 */
export type LedgerRowDto = {
  reason: string;
  /** ISO 时间。 */
  time: string;
  delta: number;
};

export type TopicFilterDto = {
  /** 账号上是否存过个人屏蔽设置（官方返回的 exists）。 */
  exists: boolean;
  settings: {
    presets: string[];
    custom: string[];
    users: string[];
    forumExcludedIds: string[];
    forumExtraIds: string[];
  };
  /** 页面提供的上下文：常用关键词、可屏蔽版块、默认屏蔽版块。 */
  context: {
    userId: string;
    settingsUrl: string;
    csrf: string;
    presets: string[];
    forums: { id: string; name: string; default: boolean }[];
    defaultForumIds: string[];
    forumEnabled: boolean;
    forumWarning: string;
  };
};

export type DirectThreadDto = {
  id: string;
  userId: string;
  name: string;
  preview: string;
  createdAt: string;
  avatar: string;
  accent: string;
};

export type DirectMessageDto = {
  id: string;
  mine: boolean;
  authorName: string;
  avatar: string;
  accent: string;
  content: string;
  quote?: string;
  createdAt: string;
};

export type DirectConversationDto = {
  partnerId: string;
  name: string;
  avatar: string;
  accent: string;
  lastId: string;
  messages: DirectMessageDto[];
};

export type RankDto = {
  rank: number;
  userId: string;
  name: string;
  group: string;
  value: string;
  avatar: string;
  accent: string;
  self?: boolean;
};

export type LeaderboardDto = {
  type: string;
  subtitle: string;
  items: RankDto[];
  self: RankDto | null;
};

export type TitleDto = {
  id: string;
  name: string;
  rarity: 'N' | 'R' | 'SR' | 'SSR' | 'UR';
  owned: boolean;
  equipped: boolean;
  desc: string;
  copies: number;
  usable: number;
  obtainedAt: string;
};

export type TitlePoolDto = {
  rarity: TitleDto['rarity'];
  count: number;
  rate: string;
};

export type TitleNewsDto = {
  user: string;
  name: string;
};

export type TitlesPageDto = {
  equipped: string;
  drawCost: number;
  drawTenCost: number;
  drawHundredCost: number;
  ownedCount: number;
  total: number;
  items: TitleDto[];
  pool: TitlePoolDto[];
  news: TitleNewsDto[];
};

export type TitleDrawDto = {
  name: string;
  names: string[];
  fresh: boolean[];
  counts?: number[];
  balance: number;
  flash: string;
};

export type TitleForgeRecipeDto = {
  source: TitleDto['rarity'];
  target: TitleDto['rarity'];
  cost: number;
  rarityKey: string;
};

export type TitleForgeMaterialDto = {
  id: string;
  name: string;
  rarity: TitleDto['rarity'];
  desc: string;
  copies: number;
  usable: number;
  rarityKey: string;
};

export type TitleForgePageDto = {
  recipes: TitleForgeRecipeDto[];
  materials: TitleForgeMaterialDto[];
};

export type TitleRecyclePageDto = {
  price: number;
  items: TitleForgeMaterialDto[];
};

export type TitleRecipeMaterialDto = {
  name: string;
  have: number;
  need: number;
  ready: boolean;
};

export type TitleRecipeDto = {
  id: string;
  name: string;
  subtitle: string;
  rarity: TitleDto['rarity'];
  ready: boolean;
  materials: TitleRecipeMaterialDto[];
};

export type TitleListingDto = {
  id: string;
  name: string;
  rarity: TitleDto['rarity'];
  price: number;
  stock: number;
  remain: string;
  max: number;
  sold?: number;
  status?: string;
  cancelPath?: string;
};

export type TitleMarketPageDto = {
  items: TitleListingDto[];
  total: number;
  nextCursor: string | null;
  maxPage?: number;
};

export type TitleSellOptionDto = {
  id: string;
  name: string;
  rarity: TitleDto['rarity'];
  usable: number;
  priceLimit: number;
};

export type TitleMarketMineDto = {
  sellable: TitleSellOptionDto[];
  listings: TitleListingDto[];
};

export type TitleMarketOrderDto = {
  id: string;
  name: string;
  rarity: TitleDto['rarity'];
  quantity: number;
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  at: string;
};

export type InviteGuestDto = {
  userId: string;
  name: string;
  avatar: string;
  accent: string;
  note: string;
};

export type InvitePageDto = {
  title: string;
  linkTitle: string;
  link: string;
  code: string;
  lead: string;
  rule: string;
  copyLabel: string;
  firstAward: number;
  secondAward: number;
  invited: number;
  invitedLabel: string;
  firstPoints: number;
  firstPeople: number;
  firstLabel: string;
  secondPoints: number;
  secondPeople: number;
  secondLabel: string;
  listTitle: string;
  empty: string;
  guests: InviteGuestDto[];
};

export type CollectionDto = {
  id: string;
  title: string;
  author: string;
  count: number;
  updatedAt: string;
  desc: string;
  accent: string;
  public: boolean;
};

export type IdentityBenefitDto = {
  title: string;
  desc: string;
};

export type IdentityCriterionDto = {
  title: string;
  detail: string;
  pass: boolean;
  soft: boolean;
};

export type IdentityDto = {
  ready: boolean;
  loggedIn: boolean;
  failNote: string;
  heroTitle: string;
  heroLead: string;
  benefitsTitle: string;
  benefitsLead: string;
  benefits: IdentityBenefitDto[];
  benefitsNote: string;
  creatorTitle: string;
  creator: IdentityCriterionDto[];
  accountTitle: string;
  account: IdentityCriterionDto[];
  emailSummary: string;
  emailHelp: string;
  githubHelp: string;
  rules: string[];
  agreeLabel: string;
  applyLabel: string;
  applicationsTitle: string;
  applications: string[];
};

export type ProfileOauthDto = {
  provider: string;
  bound: boolean;
  status: string;
};

export type ProfileDto = {
  username: string;
  uid: string;
  email: string;
  joinedAt: string;
  points: number;
  avatar: string;
  bio: string;
  usernameHint: string;
  usernameCost: number;
  emailVerified: string;
  passwordHint: string;
  avatarNote: string;
  avatarCost: number;
  avatarSeeds: string[];
  infiniteScroll: boolean;
  infiniteTitle: string;
  infiniteNote: string;
  github: ProfileOauthDto;
  google: ProfileOauthDto;
  deleteNote: string;
  deleteUrl: string;
};

export type WalletLedgerDto = {
  time: string;
  text: string;
  amount: string;
};

export type WalletPageDto = {
  title: string;
  lead: string;
  balance: number;
  unit: string;
  redeemHint: string;
  placeholder: string;
  helpUrl: string;
  shopUrl: string;
  ledger: WalletLedgerDto[];
  orders: WalletLedgerDto[];
};

export type WalletRedeemDto = {
  ok: boolean;
  message: string;
  balance: number;
};

export type PointsDto = {
  balance: number;
  checkedIn: boolean;
  streak: number;
  total: number;
  history: { date: string; gain: number | null }[];
  /** 签到记录首屏只带了第一页，剩下的由签到页并发补齐。 */
  historyPartial?: boolean;
  /** 继续取签到记录的游标（第二页起）。 */
  historyCursor?: string | null;
  /** 积分流水一共几页（并发补齐签到历史时用来封顶）。 */
  historyLastPage?: number;
};

export type UploadDto = {
  id: string;
  url: string;
  expiresAt: string;
};

export type SearchScope = 'all' | 'title' | 'body' | 'reply' | 'user';

export type SearchSort = 'relevance' | 'latest' | 'created' | 'replies' | 'views';

export type SearchHitDto = {
  id: string;
  title: string;
  snippet: string;
  forumName: string;
  createdAt: string;
  replyCount: number;
  viewCount: number;
  match: string;
  hasImage: boolean;
};

export type SearchResultDto = {
  q: string;
  scope: string;
  sort: string;
  summary: string;
  cost: number;
  balance: number;
  costNote: string;
  placeholder: string;
  emptyHint: string;
  total: number;
  page: number;
  nextPage: string | null;
  hits: SearchHitDto[];
  topics: TopicDto[];
  users: UserDto[];
  forums: ForumDto[];
};
