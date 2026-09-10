import { APP_VERSION, PROJECT_URL } from '../data/app-info';

/**
 * 检查更新。
 *
 * 版本来源就是项目仓库本身：优先读 GitHub 的 latest release（含 APK 资源），
 * 没有 release 就回退读默认分支上的 `app.json`。
 * 解析、比较、挑选 APK 都是纯函数，能离线回归（`npm run check:update`）。
 */

export type UpdateResult =
  | { status: 'latest'; current: string; latest: string }
  | {
      status: 'available';
      current: string;
      latest: string;
      url: string;
      notes: string;
      apkUrl?: string;
      apkName?: string;
      apkSize?: number;
    }
  | { status: 'error'; current: string; message: string };

export type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  content_type?: string;
  size?: number;
};

type RepoRef = { owner: string; repo: string };

/** 从项目主页里取出 owner/repo。 */
export function parseRepo(url: string): RepoRef | null {
  const hit = /github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(url);
  if (!hit) return null;
  return { owner: hit[1], repo: hit[2].replace(/\.git$/, '') };
}

/**
 * 版本号拆成数字段：`v0.1.10` → [0, 1, 10]。
 *
 * 先砍掉预发布与构建元数据（`0.2.0-beta.1` → `0.2.0`），否则那个 `-beta.1`
 * 会被当成第 4、5 段数字，让预发布版显得比正式版还新。认不出的段按 0 处理。
 */
export function parseVersion(input: string): number[] {
  const core = String(input ?? '')
    .trim()
    .replace(/^[vV]/, '')
    .split(/[-+]/)[0];
  return core.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
}

/** 比较两个版本号：a > b 返回正数，相等返回 0，a < b 返回负数。 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function pickReleaseApk(assets: ReleaseAsset[] | null | undefined): { url: string; name: string; size: number } | null {
  const list = (assets ?? []).filter((item) => {
    const name = String(item.name ?? '').toLowerCase();
    const type = String(item.content_type ?? '').toLowerCase();
    const url = String(item.browser_download_url ?? '').trim();
    if (!url) return false;
    return name.endsWith('.apk') || type.includes('android.package-archive');
  });
  const preferred = list.find((item) => /release\.apk$/i.test(String(item.name)))
    || list.find((item) => /\.apk$/i.test(String(item.name)))
    || list[0];
  const url = String(preferred?.browser_download_url ?? '').trim();
  if (!url) return null;
  return {
    url,
    name: String(preferred?.name ?? 'update.apk'),
    size: Number(preferred?.size ?? 0) || 0,
  };
}

export function formatApkSize(bytes?: number): string {
  const size = Number(bytes ?? 0);
  if (!Number.isFinite(size) || size <= 0) return '';
  const mb = size / (1024 * 1024);
  const label = mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1).replace(/\.0$/, '');
  return `${label}M`;
}

export function updatePromptText(next: Extract<UpdateResult, { status: 'available' }>): string {
  const notes = next.notes.replace(/\*\*/g, '').replace(/^---+$/gm, '').trim().slice(0, 240);
  const size = formatApkSize(next.apkSize);
  const pack = next.apkUrl
    ? `将下载安装包${size ? `（${size}）` : ''}并打开系统安装界面。`
    : '未找到安装包，将打开项目发布页。';
  const lead = `当前版本 v${next.current}。${pack}`;
  return notes ? `${notes}\n\n${lead}` : lead;
}

type RemoteVersion = {
  version: string;
  url: string;
  notes: string;
  apkUrl?: string;
  apkName?: string;
  apkSize?: number;
};

async function fetchRemoteVersion(ref: RepoRef): Promise<RemoteVersion | null> {
  const timeout = 8_000;
  const withTimeout = async (url: string): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json' },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // ① 有 release 就按 release 走（能带上发布说明、发布页和 APK）
  try {
    const res = await withTimeout(`https://api.github.com/repos/${ref.owner}/${ref.repo}/releases/latest`);
    if (res.ok) {
      const data = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        body?: string;
        assets?: ReleaseAsset[];
      };
      const version = String(data.tag_name ?? '').trim();
      if (version) {
        const apk = pickReleaseApk(data.assets);
        return {
          version,
          url: data.html_url || `https://github.com/${ref.owner}/${ref.repo}/releases`,
          notes: String(data.body ?? '').trim(),
          apkUrl: apk?.url,
          apkName: apk?.name,
          apkSize: apk?.size,
        };
      }
    }
  } catch {
    /* 没网或超时就落到 app.json 那条路 */
  }

  // ② 没发过 release：读默认分支上的 app.json（版本号在仓库里只写这一处）
  try {
    const res = await withTimeout(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/main/app.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as { expo?: { version?: string } };
    const version = String(data.expo?.version ?? '').trim();
    if (!version) return null;
    return { version, url: PROJECT_URL, notes: '' };
  } catch {
    return null;
  }
}

/** 同一次运行里只查一次，避免反复进出「关于项目」页都发请求。 */
let memo: UpdateResult | null = null;

export async function checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateResult> {
  if (memo && !options.force) return memo;
  const ref = parseRepo(PROJECT_URL);
  if (!ref) {
    memo = { status: 'error', current: APP_VERSION, message: '项目仓库地址未配置' };
    return memo;
  }
  const remote = await fetchRemoteVersion(ref);
  if (!remote) {
    memo = { status: 'error', current: APP_VERSION, message: '读取仓库版本失败，请检查网络' };
    return memo;
  }
  if (compareVersions(remote.version, APP_VERSION) > 0) {
    memo = {
      status: 'available',
      current: APP_VERSION,
      latest: remote.version,
      url: remote.url,
      notes: remote.notes,
      apkUrl: remote.apkUrl,
      apkName: remote.apkName,
      apkSize: remote.apkSize,
    };
    return memo;
  }
  memo = { status: 'latest', current: APP_VERSION, latest: remote.version };
  return memo;
}

/** 测试与调试用：清掉本次运行的缓存。 */
export function resetUpdateMemo() {
  memo = null;
}
