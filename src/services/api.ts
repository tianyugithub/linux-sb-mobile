import type { Album, ForumBoard, Member, MessageItem, RankRow, TitleItem, Topic } from '../../data';
import type { IonName } from '../../data';
import type {
  BarrageItemDto,
  CaptchaChallengeDto,
  CollectionDto,
  CommentDto,
  CommentEditorDto,
  CursorPage,
  DirectConversationDto,
  DailyHotTopicDto,
  DirectMessageDto,
  DirectThreadDto,
  DonateInfoDto,
  EssenceVoteDto,
  FeedSort,
  ForumDto,
  HomeFeedDto,
  IdentityDto,
  InvitePageDto,
  NotificationDto,
  WalletPageDto,
  WalletRedeemDto,
  PointsDto,
  ProfileDto,
  RankDto,
  ReportFormDto,
  SearchResultDto,
  SearchScope,
  SearchSort,
  SessionDto,
  TitleDto,
  TitleDrawDto,
  TitleForgePageDto,
  TitleMarketMineDto,
  TitleMarketOrderDto,
  LedgerRowDto,
  TopicFilterDto,
  TitleMarketPageDto,
  TitleRecipeDto,
  TitleRecyclePageDto,
  TitlesPageDto,
  TopicDetailDto,
  TopicDto,
  TopicEditorDto,
  TopicComposeInput,
  TopicCollectionPickDto,
  TopicVirtualCardDto,
  UploadDto,
  UserDto,
} from '../types/api';
import { formatRelative } from '../utils/time';
import { FEED_TABS, LEADERBOARD_TABS } from '../data/feed-nav';
import { apiRequest } from './client';
import { clearSession, getRefreshToken, setSession } from './session';

// 与首页 tab 单一来源：src/data/feed-nav.ts
const SORT_MAP: Record<string, FeedSort> = Object.fromEntries(
  FEED_TABS.map((tab) => [tab.label, tab.slug]),
) as Record<string, FeedSort>;

// 值直接用官方 `?type=`：不再经中间值二次翻译
const LEADERBOARD_MAP: Record<string, string> = Object.fromEntries(
  LEADERBOARD_TABS.map((tab) => [tab.label, tab.type]),
) as Record<string, string>;

const NOTIF_KIND: Record<string, string> = {
  提及: 'mention',
  打赏: 'reward',
  系统: 'system',
};

export function mapTopic(dto: TopicDto): Topic {
  const status = dto.tags.find((tag) => tag.type === 'pinned' || tag.type === 'lottery' || tag.type === 'card')?.label;
  const avatarUrl = dto.avatar.includes('/') ? dto.avatar : undefined;
  return {
    id: dto.id,
    title: dto.title,
    author: dto.authorName,
    authorId: dto.authorId,
    authorTitle: dto.authorTitle,
    authorTitleSerial: dto.authorTitleSerial,
    authorGroup: dto.authorGroup,
    forum: dto.forumName,
    forumId: dto.forumId,
    time: formatRelative(dto.createdAt),
    replies: dto.replyCount,
    heat: dto.tags.some((tag) => tag.type === 'hot'),
    featured: dto.tags.some((tag) => tag.type === 'featured' || tag.type === 'essence'),
    status,
    tags: dto.tags,
    lastPage: dto.lastPage,
    hasUnread: dto.hasUnread,
    unreadPage: dto.unreadPage,
    unreadFloor: dto.unreadFloor,
    lastReplier: dto.lastReplier,
    lastReplierId: dto.lastReplierId,
    avatar: avatarUrl ? dto.authorName.slice(0, 1) : dto.avatar,
    avatarUrl,
    accent: dto.accent,
    body: dto.body,
    online: dto.online,
    editedBy: dto.editedBy,
    editedById: dto.editedById,
    editedAt: dto.editedAt,
  };
}

export function mapUser(dto: UserDto): Member {
  return {
    id: dto.id,
    name: dto.name,
    title: dto.title,
    group: dto.group,
    groupLabel: dto.groupLabel,
    points: dto.points,
    uid: dto.uid,
    avatar: dto.avatar.includes('/') ? dto.name.slice(0, 1) : dto.avatar,
    avatarUrl: dto.avatar.includes('/') ? dto.avatar : undefined,
    accent: dto.accent,
    bio: dto.bio,
    topicCount: dto.topicCount,
    replyCount: dto.replyCount,
    joined: dto.joinedAt ? dto.joinedAt.slice(0, 7) : '',
    online: dto.online,
  };
}

export function mapForum(dto: ForumDto): ForumBoard {
  return {
    name: dto.name,
    group: dto.group,
    desc: dto.desc,
    topics: dto.topics,
    posts: dto.posts,
    today: dto.today,
    accent: dto.accent,
    icon: dto.icon as IonName,
    latest: dto.latest,
    latestTime: formatRelative(dto.latestAt),
  };
}

export function mapNotification(dto: NotificationDto): MessageItem {
  return {
    id: dto.id,
    kind: dto.kind,
    name: dto.actorName,
    text: dto.text,
    topic: dto.topicTitle,
    topicId: dto.topicId ?? undefined,
    replyId: dto.replyId ?? undefined,
    time: formatRelative(dto.createdAt),
    avatar: dto.actorAvatar.includes('/') ? dto.actorName.slice(0, 1) : dto.actorAvatar,
    avatarUrl: dto.actorAvatar.includes('/') ? dto.actorAvatar : undefined,
    accent: dto.accent,
    unread: dto.unread,
  };
}

export const api = {
  login: async (input: { username: string; password?: string; provider?: 'github' | 'google'; captchaToken?: string; oauthCookies?: string }) => {
    const session = await apiRequest<SessionDto>('POST', '/auth/login', { body: input, auth: false });
    setSession(session.token, session.refreshToken);
    return session;
  },
  register: async (input: { username: string; password: string; email: string; inviteCode?: string; emailCode: string; captchaToken?: string }) => {
    const session = await apiRequest<SessionDto>('POST', '/auth/register', { body: input, auth: false });
    setSession(session.token, session.refreshToken);
    return session;
  },
  refresh: async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error('NO_REFRESH');
    const session = await apiRequest<SessionDto>('POST', '/auth/refresh', { body: { refreshToken }, auth: false });
    setSession(session.token, session.refreshToken);
    return session;
  },
  logout: async () => {
    try {
      await apiRequest<{ ok: boolean }>('POST', '/auth/logout');
    } finally {
      clearSession();
    }
  },
  captcha: () => apiRequest<CaptchaChallengeDto>('GET', '/auth/captcha', { auth: false }),
  sendEmailCode: (email: string) =>
    apiRequest<{ ok: boolean; preview?: string }>('POST', '/auth/email-code', { body: { email }, auth: false }),
  me: () => apiRequest<UserDto>('GET', '/users/me'),
  homeFeed: (input: { forum?: string; sort?: string; cursor?: string | null }) =>
    apiRequest<HomeFeedDto>('GET', '/home/feed', {
      query: {
        forum: !input.forum || input.forum === '全部' ? 'all' : input.forum,
        sort: SORT_MAP[input.sort ?? ''] ?? 'latest_comment',
        cursor: input.cursor ?? undefined,
      },
    }),
  forums: () => apiRequest<{ items: ForumDto[] }>('GET', '/forums', { auth: false }),
  forumTopics: (forumId: string, input: { sort?: string; cursor?: string | null }) =>
    apiRequest<CursorPage<TopicDto> & { board?: { name: string; desc: string; topics: number } }>('GET', `/forums/${encodeURIComponent(forumId)}/topics`, {
      query: {
        sort: SORT_MAP[input.sort ?? ''] ?? 'latest_comment',
        cursor: input.cursor ?? undefined,
      },
      auth: false,
    }),
  topic: (id: string) => apiRequest<TopicDetailDto>('GET', `/topics/${encodeURIComponent(id)}`),
  createTopic: (input: TopicComposeInput) =>
    apiRequest<TopicDto>('POST', '/topics', { body: input }),
  updateTopic: (id: string, input: TopicComposeInput) =>
    apiRequest<TopicDto>('PATCH', `/topics/${encodeURIComponent(id)}`, { body: input }),
  deleteTopic: (id: string) => apiRequest<{ ok: boolean }>('DELETE', `/topics/${encodeURIComponent(id)}`),
  topicComposer: (id?: string) =>
    id
      ? apiRequest<TopicEditorDto>('GET', `/topics/${encodeURIComponent(id)}/edit`)
      : apiRequest<TopicEditorDto>('GET', '/topics/compose'),
  topicEditor: (id: string) =>
    apiRequest<TopicEditorDto>('GET', `/topics/${encodeURIComponent(id)}/edit`),
  topicCollections: (id: string, input: { collectionId?: string; name?: string; remove?: boolean }) =>
    apiRequest<{ ok: boolean; message: string; items: TopicCollectionPickDto[] }>('POST', `/topics/${encodeURIComponent(id)}/collections`, {
      body: input,
    }),
  comments: (id: string, cursor?: string | null, replyId?: string, floor?: string) =>
    apiRequest<CursorPage<CommentDto>>('GET', `/topics/${encodeURIComponent(id)}/comments`, {
      query: { cursor: cursor ?? undefined, replyId: replyId || undefined, floor: floor || undefined },
    }),
  createComment: (id: string, input: { body: string; parentId?: string; parentFloor?: string; capToken?: string }) =>
    apiRequest<CommentDto>('POST', `/topics/${encodeURIComponent(id)}/comments`, { body: input }),
  commentEditor: (topicId: string, commentId: string) =>
    apiRequest<CommentEditorDto>('GET', `/topics/${encodeURIComponent(topicId)}/comments/${encodeURIComponent(commentId)}/edit`),
  updateComment: (topicId: string, commentId: string, input: { body: string }) =>
    apiRequest<CommentDto>('PATCH', `/topics/${encodeURIComponent(topicId)}/comments/${encodeURIComponent(commentId)}`, { body: input }),
  deleteComment: (topicId: string, commentId: string) =>
    apiRequest<{ ok: boolean }>('DELETE', `/topics/${encodeURIComponent(topicId)}/comments/${encodeURIComponent(commentId)}`),
  likeTopic: (id: string) => apiRequest<{ liked: boolean; likeCount: number; barrage?: BarrageItemDto[] }>('POST', `/topics/${encodeURIComponent(id)}/like`),
  favoriteTopic: (id: string) => apiRequest<{ favorited: boolean; favoriteCount: number }>('POST', `/topics/${encodeURIComponent(id)}/favorite`),
  rewardTopic: (id: string, amount = 10) => apiRequest<{ rewarded: number; balance: number }>('POST', `/topics/${encodeURIComponent(id)}/reward`, { body: { amount } }),
  donateInfo: (id: string) => apiRequest<DonateInfoDto>('GET', `/topics/${encodeURIComponent(id)}/donate`),
  donateTopic: (id: string, amount?: number | string) =>
    apiRequest<{ liked: boolean; likeCount: number; rewarded: number; balance: number; barrage?: BarrageItemDto[]; message?: string }>(
      'POST',
      `/topics/${encodeURIComponent(id)}/donate`,
      { body: { amount: amount === undefined || amount === '' ? '' : String(amount) } },
    ),
  reactComment: (topicId: string, commentId: string, points = 0) =>
    apiRequest<{ liked: boolean; coined: boolean; likeCount: number; message?: string }>(
      'POST',
      `/topics/${encodeURIComponent(topicId)}/comments/${encodeURIComponent(commentId)}/react`,
      { body: { points } },
    ),
  buyVirtualCard: (id: string, quantity = 1) =>
    apiRequest<{ ok: boolean; message: string; card: TopicVirtualCardDto | null }>('POST', `/topics/${encodeURIComponent(id)}/virtual-card`, {
      body: { quantity },
    }),
  voteTopic: (id: string, input: { vote: 'support' | 'oppose'; reason: string }) =>
    apiRequest<EssenceVoteDto>('POST', `/topics/${encodeURIComponent(id)}/vote`, { body: input }),
  reportForm: (targetType: 'reply' | 'topic', targetId: string) =>
    apiRequest<ReportFormDto>('GET', `/reports/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`),
  submitReport: (input: { targetType: 'reply' | 'topic'; targetId: string; reasonType: string; details?: string }) =>
    apiRequest<{ ok: boolean; message: string }>('POST', '/reports', { body: input }),
  user: (id: string) => apiRequest<UserDto>('GET', `/users/${encodeURIComponent(id)}`),
  userTopics: (id: string, cursor?: string | null) =>
    apiRequest<CursorPage<TopicDto>>('GET', `/users/${encodeURIComponent(id)}/topics`, { query: { cursor: cursor ?? undefined } }),
  userReplies: (id: string, cursor?: string | null) =>
    apiRequest<CursorPage<TopicDto>>('GET', `/users/${encodeURIComponent(id)}/replies`, { query: { cursor: cursor ?? undefined } }),
  userFavorites: (id: string, cursor?: string | null) =>
    apiRequest<CursorPage<TopicDto>>('GET', `/users/${encodeURIComponent(id)}/favorites`, { query: { cursor: cursor ?? undefined } }),
  notifications: (kind?: string, cursor?: string | null) =>
    apiRequest<CursorPage<NotificationDto> & { unread: number }>('GET', '/notifications', {
      query: { kind: !kind || kind === '全部' ? 'all' : (NOTIF_KIND[kind] ?? kind), cursor: cursor ?? undefined },
    }),
  notificationUnread: () => apiRequest<{ unread: number }>('GET', '/notifications/unread'),
  readNotifications: (ids?: string[]) => apiRequest<{ ok: boolean; unread: number }>('POST', '/notifications/read', { body: { ids } }),
  topicFilter: () => apiRequest<TopicFilterDto>('GET', '/topic-filter'),
  saveTopicFilter: (settings: TopicFilterDto['settings']) =>
    apiRequest<TopicFilterDto>('POST', '/topic-filter', { body: { settings } }),
  directMessages: () => apiRequest<{ items: DirectThreadDto[] }>('GET', '/direct-messages'),
  directThread: (userId: string, opts?: { fresh?: boolean }) =>
    apiRequest<DirectConversationDto>('GET', `/direct-messages/${encodeURIComponent(userId)}`, {
      query: { fresh: opts?.fresh ? '1' : undefined },
    }),
  sendDirectMessage: (userId: string, content: string) =>
    apiRequest<{ ok: boolean; message: DirectMessageDto | null; lastId?: string }>(
      'POST',
      `/direct-messages/${encodeURIComponent(userId)}`,
      { body: { content } },
    ),
  leaderboard: (tab: string) =>
    apiRequest<{ type: string; subtitle: string; items: RankDto[]; self: RankDto | null }>('GET', '/leaderboard', {
      query: { type: LEADERBOARD_MAP[tab] ?? 'points' },
      auth: false,
    }),
  points: (opts?: { history?: boolean }) =>
    apiRequest<PointsDto>('GET', '/points', { query: { history: opts?.history ? '1' : undefined } }),
  checkin: () => apiRequest<{ gain: number; balance: number; checkedIn: boolean }>('POST', '/points/checkin'),
  titles: () => apiRequest<TitlesPageDto>('GET', '/titles'),
  drawTitle: (count: 1 | 10 | 100 = 1) => apiRequest<TitleDrawDto>('POST', '/titles/draw', { body: { count } }),
  equipTitle: (name: string) => apiRequest<{ equipped: string }>('POST', '/titles/equip', { body: { name } }),
  unequipTitle: () => apiRequest<{ equipped: string }>('POST', '/titles/unequip'),
  giftTitle: (input: { name: string; username: string; instanceId?: string }) =>
    apiRequest<{ ok: boolean; flash: string }>('POST', '/titles/gift', { body: input }),
  titleForge: () => apiRequest<TitleForgePageDto>('GET', '/titles/forge'),
  forgeTitles: (source: string, materials: Array<{ id: string; quantity: number }>) =>
    apiRequest<{ ok: boolean; times: number; flash: string; names: string[]; counts: number[] }>('POST', '/titles/forge', { body: { source, materials } }),
  titleRecycle: () => apiRequest<TitleRecyclePageDto>('GET', '/titles/recycle'),
  recycleTitles: (items: Array<{ id: string; quantity: number }>) =>
    apiRequest<{ ok: boolean; flash: string; price: number }>('POST', '/titles/recycle', { body: { items } }),
  titleRecipes: () => apiRequest<{ items: TitleRecipeDto[] }>('GET', '/titles/recipes'),
  craftTitle: (recipeId: string) =>
    apiRequest<{ ok: boolean; flash: string }>('POST', '/titles/recipes/craft', { body: { recipeId } }),
  titleMarket: (query?: { q?: string; rarity?: string; sort?: string; cursor?: string | null; fresh?: boolean }) =>
    apiRequest<TitleMarketPageDto>('GET', '/titles/market', {
      query: {
        q: query?.q || undefined,
        rarity: query?.rarity || undefined,
        sort: query?.sort || undefined,
        cursor: query?.cursor ?? undefined,
        fresh: query?.fresh ? '1' : undefined,
      },
    }),
  checkinPage: (cursor: string) =>
    apiRequest<CursorPage<PointsDto['history'][number]> & { page: number }>('GET', '/points/checkins', {
      query: { cursor },
    }),
  pointsLedger: (cursor?: string | null) =>
    apiRequest<CursorPage<LedgerRowDto> & { page: number }>('GET', '/points/ledger', {
      query: { cursor: cursor ?? undefined },
    }),
  buyTitleListing: (listingId: string, quantity: number) =>
    apiRequest<{ ok: boolean; flash: string }>('POST', '/titles/market/buy', { body: { listingId, quantity } }),
  titleMarketMine: () => apiRequest<TitleMarketMineDto>('GET', '/titles/market/mine'),
  publishTitleListing: (input: { titleId: string; quantity: number; unitPrice: number; durationHours: number; instanceId?: string }) =>
    apiRequest<{ ok: boolean; flash: string }>('POST', '/titles/market/publish', { body: input }),
  cancelTitleListing: (listingId: string) =>
    apiRequest<{ ok: boolean; flash: string }>('POST', '/titles/market/cancel', { body: { listingId } }),
  titleMarketOrders: () => apiRequest<{ items: TitleMarketOrderDto[] }>('GET', '/titles/market/orders'),
  invites: () => apiRequest<InvitePageDto>('GET', '/invites'),
  wallet: (opts?: { fresh?: boolean }) =>
    apiRequest<WalletPageDto>('GET', '/wallet', { query: { fresh: opts?.fresh ? '1' : undefined } }),
  redeemWallet: (code: string) =>
    apiRequest<WalletRedeemDto>('POST', '/wallet/redeem', { body: { code } }),
  collections: (tab: 'everyone' | 'mine') =>
    apiRequest<{ items: CollectionDto[] }>('GET', '/collections', { query: { tab } }),
  collectionTopics: (id: string, cursor?: string | null) =>
    apiRequest<CursorPage<TopicDto>>('GET', `/collections/${encodeURIComponent(id)}/topics`, {
      query: { cursor: cursor ?? undefined },
      auth: false,
    }),
  identity: () => apiRequest<IdentityDto>('GET', '/identity'),
  applyIdentity: () => apiRequest<{ ok: boolean; message?: string }>('POST', '/identity/apply', { body: { rules_agreed: '1' } }),
  profile: (opts?: { fresh?: boolean }) =>
    apiRequest<ProfileDto>('GET', '/profile', { query: { fresh: opts?.fresh ? '1' : undefined } }),
  saveProfileBio: (bio: string) => apiRequest<{ ok: boolean; message: string }>('POST', '/profile/bio', { body: { bio } }),
  saveProfilePassword: (input: { current_password: string; password: string; password2: string }) =>
    apiRequest<{ ok: boolean; message: string }>('POST', '/profile/password', { body: input }),
  saveProfileUsername: (input: { new_username: string; current_password: string }) =>
    apiRequest<{ ok: boolean; message: string }>('POST', '/profile/username', { body: input }),
  saveProfileEmail: (input: { current_password: string; email: string; email_code: string }) =>
    apiRequest<{ ok: boolean; message: string }>('POST', '/profile/email', { body: input }),
  sendProfileEmailCode: (input: { email: string; current_password: string }) =>
    apiRequest<{ ok: boolean; message: string }>('POST', '/profile/email-code', { body: input }),
  saveInfiniteScroll: (enabled: boolean) =>
    apiRequest<{ ok: boolean; message: string }>('POST', '/profile/infinite', { body: { enabled: enabled ? '1' : '0' } }),
  saveAvatarPreset: (seed: string) =>
    apiRequest<{ ok: boolean; message: string }>('POST', '/profile/avatar-preset', { body: { seed } }),
  saveAvatarUpload: (file: { uri: string; name: string; type: string }) =>
    apiRequest<{ ok: boolean; message: string }>('POST', '/profile/avatar-upload', { body: file }),
  upload: (file: { uri: string; name: string; type: string; target?: 'official' | 'r2' }) =>
    apiRequest<UploadDto>('POST', '/uploads', { body: file }),
  search: (input: { q?: string; scope?: SearchScope | string; sort?: SearchSort | string; page?: number; charge?: boolean } = {}) =>
    apiRequest<SearchResultDto>(input.charge ? 'POST' : 'GET', '/search', {
      query: input.charge ? undefined : {
        q: input.q,
        scope: input.scope,
        sort: input.sort,
        page: input.page,
      },
      body: input.charge ? { q: input.q, scope: input.scope, sort: input.sort, charge: true } : undefined,
    }),
};

export function mapRank(dto: RankDto): RankRow {
  const avatarUrl = dto.avatar.includes('/') ? dto.avatar : undefined;
  return {
    rank: dto.rank,
    name: dto.name,
    group: dto.group,
    value: dto.value,
    avatar: avatarUrl ? dto.name.slice(0, 1) : dto.avatar,
    avatarUrl,
    userId: dto.userId,
    accent: dto.accent,
    self: dto.self,
  };
}

export function mapTitle(dto: TitleDto): TitleItem {
  return { name: dto.name, rarity: dto.rarity, owned: dto.owned, desc: dto.desc };
}

export function mapCollection(dto: CollectionDto): Album {
  return {
    id: dto.id,
    title: dto.title,
    author: dto.author,
    count: dto.count,
    updated: formatRelative(dto.updatedAt),
    desc: dto.desc,
    accent: dto.accent,
    public: dto.public,
  };
}

export function mapDirect(dto: DirectThreadDto) {
  return {
    id: dto.id,
    userId: dto.userId,
    name: dto.name,
    preview: dto.preview,
    time: formatRelative(dto.createdAt),
    avatar: dto.avatar.includes('/') ? dto.name.slice(0, 1) : dto.avatar,
    avatarUrl: dto.avatar.includes('/') ? dto.avatar : undefined,
    accent: dto.accent,
  };
}

export type { DailyHotTopicDto };
