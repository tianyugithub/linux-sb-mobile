import type { Member } from '../../data';
import type { SessionDto, UserDto } from '../types/api';
import { requestId } from '../utils/time';
import { checkProofOfWork, sha256Hex } from '../utils/captcha';

export class MockApiError extends Error {
  code: string;
  status: number;
  requestId: string;

  constructor(status: number, code: string, message: string, id = requestId()) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = id;
  }
}

export type MockRequest = {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  body: unknown;
  token: string | null;
};

export type MockResponse = {
  status: number;
  data?: unknown;
  error?: { code: string; message: string; requestId: string };
};

type SessionRecord = {
  userId: string;
  token: string;
  refreshToken: string;
};

const users: Member[] = [];
const sessions = new Map<string, SessionRecord>();
const refreshIndex = new Map<string, string>();
const captchaChallenges = new Map<string, { nonce: string; difficulty: number }>();
const captchaTokens = new Set<string>();
const emailCodes = new Map<string, string>();
const credentials = new Map<string, { salt: string; hash: string; email?: string }>();
const DUMMY_SALT = '00'.repeat(16);

function toUserDto(member: Member): UserDto {
  const joinedAt = member.joined === '-' ? new Date().toISOString() : new Date(`${member.joined}-01T00:00:00+08:00`).toISOString();
  return {
    id: member.id,
    name: member.name,
    title: member.title,
    group: member.group,
    groupLabel: member.groupLabel || member.group,
    points: member.points,
    uid: member.uid,
    avatar: member.avatar,
    accent: member.accent,
    bio: member.bio,
    topicCount: member.topicCount,
    replyCount: member.replyCount,
    joinedAt,
  };
}

function createMember(name: string): Member {
  const created: Member = {
    id: `u_${Date.now().toString(36)}`,
    name,
    title: '饼友',
    group: '饼友',
    points: 0,
    uid: String(20000 + users.length),
    avatar: name.slice(0, 1),
    accent: '#6FA8FF',
    bio: '',
    topicCount: 0,
    replyCount: 0,
    joined: new Date().toISOString().slice(0, 7),
  };
  users.push(created);
  return created;
}

function currentUser(token: string | null): Member | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  return users.find((item) => item.id === session.userId) ?? null;
}

function requireUser(token: string | null): Member {
  const user = currentUser(token);
  if (!user) throw new MockApiError(401, 'UNAUTHORIZED', '请先登录');
  return user;
}

function issueSession(user: Member): SessionDto {
  const token = `tok.${user.id}.${Math.random().toString(36).slice(2, 10)}`;
  const refreshToken = `ref.${user.id}.${Math.random().toString(36).slice(2, 12)}`;
  const record = { userId: user.id, token, refreshToken };
  sessions.set(token, record);
  refreshIndex.set(refreshToken, token);
  return { token, refreshToken, user: toUserDto(user) };
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (item) => item.toString(16).padStart(2, '0')).join('');
}

function sameHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function savePassword(userId: string, password: string, email?: string) {
  const salt = randomSalt();
  const hash = await sha256Hex(`${salt}:${password}`);
  credentials.set(userId, { salt, hash, email });
}

async function authenticatePassword(username: string, password: string): Promise<Member> {
  const key = username.trim().toLowerCase();
  const byName = users.find((item) => item.name.toLowerCase() === key) ?? null;
  let user = byName;
  if (!user) {
    for (const [userId, record] of credentials) {
      if (record.email === key) {
        user = users.find((item) => item.id === userId) ?? null;
        break;
      }
    }
  }
  const record = user ? credentials.get(user.id) : undefined;
  const hash = await sha256Hex(`${record?.salt ?? DUMMY_SALT}:${password}`);
  if (!user || !record || !sameHex(hash, record.hash)) {
    throw new MockApiError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
  }
  return user;
}

function ok(data: unknown, status = 200): MockResponse {
  return { status, data };
}

async function dispatch(req: MockRequest): Promise<unknown> {
  const { method, path, body, token } = req;
  const payload = (body ?? {}) as Record<string, unknown>;

  if (method === 'GET' && path === '/auth/captcha') {
    const id = `cap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const nonce = Math.random().toString(36).slice(2, 10);
    captchaChallenges.set(id, { nonce, difficulty: 2 });
    return { id, nonce, difficulty: 2 };
  }

  if (method === 'POST' && path === '/auth/captcha/verify') {
    const id = String(payload.id ?? '');
    const nonce = String(payload.nonce ?? '');
    const solution = String(payload.solution ?? '');
    const challenge = captchaChallenges.get(id);
    if (!challenge || !solution || nonce !== challenge.nonce) {
      throw new MockApiError(400, 'VALIDATION', '人机验证失败，请重试');
    }
    const valid = await checkProofOfWork(challenge.nonce, solution, challenge.difficulty);
    if (!valid) throw new MockApiError(400, 'VALIDATION', '人机验证失败，请重试');
    captchaChallenges.delete(id);
    const captchaToken = `cap.${id}.${Math.random().toString(36).slice(2, 10)}`;
    captchaTokens.add(captchaToken);
    return { token: captchaToken };
  }

  if (method === 'POST' && path === '/auth/email-code') {
    const email = String(payload.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) throw new MockApiError(400, 'VALIDATION', '请输入有效邮箱');
    const code = String(100000 + Math.floor(Math.random() * 900000));
    emailCodes.set(email, code);
    return { ok: true, preview: code };
  }

  if (method === 'POST' && path === '/auth/login') {
    const username = String(payload.username ?? '').trim();
    const password = String(payload.password ?? '');
    const provider = String(payload.provider ?? '');
    const captchaToken = String(payload.captchaToken ?? '');
    if (provider) {
      throw new MockApiError(501, 'OAUTH_UNAVAILABLE', 'GitHub / Google 登录尚未接入');
    }
    if (!username) throw new MockApiError(400, 'VALIDATION', '请输入用户名');
    if (!password) throw new MockApiError(400, 'VALIDATION', '请输入密码');
    if (!captchaToken || !captchaTokens.has(captchaToken)) {
      throw new MockApiError(400, 'CAPTCHA', '请先完成人机验证');
    }
    captchaTokens.delete(captchaToken);
    const user = await authenticatePassword(username, password);
    if (user.group === '访客') user.group = '饼友';
    return issueSession(user);
  }

  if (method === 'POST' && path === '/auth/register') {
    const username = String(payload.username ?? '').trim();
    const password = String(payload.password ?? '');
    const email = String(payload.email ?? '').trim().toLowerCase();
    const emailCode = String(payload.emailCode ?? '').trim();
    const captchaToken = String(payload.captchaToken ?? '');
    if (!username || username.length > 20) throw new MockApiError(400, 'VALIDATION', '用户名不合法');
    if (password.length < 6) throw new MockApiError(400, 'VALIDATION', '密码至少 6 位');
    if (!email) throw new MockApiError(400, 'VALIDATION', '请输入邮箱');
    if (emailCodes.get(email) !== emailCode) throw new MockApiError(400, 'VALIDATION', '邮箱验证码不正确');
    if (!captchaToken || !captchaTokens.has(captchaToken)) {
      throw new MockApiError(400, 'CAPTCHA', '请先完成人机验证');
    }
    captchaTokens.delete(captchaToken);
    emailCodes.delete(email);
    if (users.some((item) => item.name.toLowerCase() === username.toLowerCase())) {
      throw new MockApiError(409, 'CONFLICT', '用户名已被占用');
    }
    if ([...credentials.values()].some((item) => item.email === email)) {
      throw new MockApiError(409, 'CONFLICT', '邮箱已被占用');
    }
    const user = createMember(username);
    await savePassword(user.id, password, email);
    return issueSession(user);
  }

  if (method === 'POST' && path === '/auth/refresh') {
    const refreshToken = String(payload.refreshToken ?? '');
    const oldToken = refreshIndex.get(refreshToken);
    if (!oldToken) throw new MockApiError(401, 'UNAUTHORIZED', '会话已失效');
    const old = sessions.get(oldToken);
    sessions.delete(oldToken);
    refreshIndex.delete(refreshToken);
    const user = users.find((item) => item.id === old?.userId);
    if (!user) throw new MockApiError(401, 'UNAUTHORIZED', '会话已失效');
    return issueSession(user);
  }

  if (method === 'POST' && path === '/auth/logout') {
    if (token) {
      const session = sessions.get(token);
      sessions.delete(token);
      if (session) refreshIndex.delete(session.refreshToken);
    }
    return { ok: true };
  }

  if (method === 'GET' && path === '/users/me') {
    return toUserDto(requireUser(token));
  }

  throw new MockApiError(404, 'NOT_FOUND', '接口不存在');
}

export async function handleMockRequest(req: MockRequest): Promise<MockResponse> {
  try {
    const data = await dispatch(req);
    return ok(data);
  } catch (error) {
    if (error instanceof MockApiError) {
      return {
        status: error.status,
        error: { code: error.code, message: error.message, requestId: error.requestId },
      };
    }
    return {
      status: 500,
      error: { code: 'INTERNAL', message: '服务暂时不可用', requestId: requestId() },
    };
  }
}
