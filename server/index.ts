import '../src/services/session-store';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { captchaWidgetPage, getCaptchaConfig, handleAuthRequest } from '../src/services/upstream-auth';
import { handleLiveRequest } from '../src/services/live';

const PORT = Number(process.env.API_PORT || 8788);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, X-Request-Id',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      if (!chunks.length) {
        resolve(undefined);
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(payload));
}

const DIST = join(process.cwd(), 'dist');

const API_PREFIXES = [
  '/auth/',
  '/home/',
  '/forums',
  '/topics',
  '/reports',
  '/users',
  '/notifications',
  '/direct-messages',
  '/leaderboard',
  '/points',
  '/titles',
  '/invites',
  '/collections',
  '/identity',
  '/uploads',
  '/search',
  '/media',
  '/cap',
];

function isLocalAuth(pathname: string): boolean {
  return pathname.startsWith('/auth/') || pathname === '/users/me';
}

function isApiPath(pathname: string): boolean {
  if (pathname === '/health') return true;
  return API_PREFIXES.some((prefix) => {
    if (prefix.endsWith('/')) return pathname.startsWith(prefix);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

function mimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.ico':
      return 'image/x-icon';
    case '.map':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

function distFile(pathname: string): string | null {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = normalize(join(DIST, relative));
  const root = normalize(DIST) + sep;
  if (resolved !== normalize(DIST) && !resolved.startsWith(root)) return null;
  if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  return null;
}

function sendFile(res: ServerResponse, filePath: string) {
  const stat = statSync(filePath);
  res.writeHead(200, {
    'content-type': mimeType(filePath),
    'content-length': stat.size,
    'cache-control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}

function allowedMedia(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'linux.sb' || host.endsWith('.linux.sb')) return url;
    if (host === 'imgur.la' || host.endsWith('.imgur.la')) return url;
    if (host === 'imgur.com' || host.endsWith('.imgur.com')) return url;
    if (host === 'pic.sl.al' || host.endsWith('.sl.al')) return url;
    if (host === 'i.imgur.com') return url;
    return null;
  } catch {
    return null;
  }
}

async function proxyMedia(raw: string | null, res: ServerResponse) {
  const target = allowedMedia(raw);
  if (!target) {
    send(res, 400, { error: { code: 'BAD_MEDIA', message: '不支持的图片地址', requestId: 'bff' } });
    return;
  }
  try {
    const headers: Record<string, string> = {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    };
    if (target.hostname === 'linux.sb' || target.hostname.endsWith('.linux.sb')) {
      headers.Referer = 'https://linux.sb/';
    }
    const upstream = await fetch(target, {
      headers,
      redirect: 'follow',
    });
    const finalUrl = allowedMedia(upstream.url);
    if (!finalUrl || !upstream.ok || !upstream.body) {
      send(res, upstream.status >= 400 ? upstream.status : 502, {
        error: { code: 'MEDIA_UPSTREAM', message: '图片暂时无法加载', requestId: 'bff' },
      });
      return;
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/') && !contentType.includes('svg')) {
      send(res, 415, { error: { code: 'NOT_IMAGE', message: '目标不是图片', requestId: 'bff' } });
      return;
    }
    const length = upstream.headers.get('content-length');
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'public, max-age=86400',
      ...(length ? { 'content-length': length } : {}),
      ...CORS,
    });
    const { Readable } = await import('node:stream');
    Readable.fromWeb(upstream.body as never).pipe(res);
  } catch {
    send(res, 502, { error: { code: 'MEDIA_UPSTREAM', message: '图片暂时无法加载', requestId: 'bff' } });
  }
}

async function proxyCap(req: IncomingMessage, res: ServerResponse, url: URL) {
  const matched = url.pathname.match(/^\/cap\/([a-f0-9]+)\/(challenge|redeem)\/?$/i);
  if (!matched || (req.method !== 'POST' && req.method !== 'OPTIONS')) {
    send(res, 404, { error: { code: 'NOT_FOUND', message: '验证接口不存在', requestId: 'bff' } });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  try {
    const upstream = await fetch(`https://cap.linux.sb/${matched[1]}/${matched[2]}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': req.headers['content-type'] || 'application/json',
        'user-agent': req.headers['user-agent'] || 'Mozilla/5.0',
      },
      body: body.length ? body : undefined,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      ...CORS,
    });
    res.end(text);
  } catch {
    send(res, 502, { error: { code: 'CAPTCHA_UPSTREAM', message: '人机验证服务暂时不可用', requestId: 'bff' } });
  }
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    send(res, 400, { error: { code: 'BAD_REQUEST', message: '无效请求', requestId: 'bff' } });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname.startsWith('/cap/')) {
    await proxyCap(req, res, url);
    return;
  }
  if (url.pathname === '/cap-widget' && req.method === 'GET') {
    try {
      const html = captchaWidgetPage(await getCaptchaConfig());
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...CORS,
      });
      res.end(html);
    } catch {
      send(res, 502, { error: { code: 'CAPTCHA_UPSTREAM', message: '人机验证加载失败', requestId: 'bff' } });
    }
    return;
  }
  if (url.pathname === '/media' && (req.method === 'GET' || req.method === 'HEAD')) {
    await proxyMedia(url.searchParams.get('u'), res);
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && !isApiPath(url.pathname)) {
    const file = distFile(url.pathname) ?? (extname(url.pathname) ? null : distFile('/index.html'));
    if (file) {
      sendFile(res, file);
      return;
    }
  }
  if (url.pathname === '/health') {
    send(res, 200, { data: { ok: true } });
    return;
  }

  const query: Record<string, string | undefined> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    send(res, 400, { error: { code: 'INVALID_JSON', message: '请求体不是 JSON', requestId: 'bff' } });
    return;
  }

  try {
    const handler = isLocalAuth(url.pathname) ? handleAuthRequest : handleLiveRequest;
    const result = await handler({
      method: req.method,
      path: url.pathname,
      query,
      body,
      token,
    });
    if (result.error) {
      send(res, result.status, { error: result.error });
      return;
    }
    send(res, result.status, { data: result.data });
  } catch (error) {
    send(res, 500, {
      error: {
        code: 'INTERNAL',
        message: error instanceof Error ? error.message : '服务暂时不可用',
        requestId: 'bff',
      },
    });
  }
});

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const item of addrs ?? []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LINUX SB API listening on http://0.0.0.0:${PORT}`);
  lanAddresses().forEach((ip) => console.log(`LAN: http://${ip}:${PORT}/`));
  if (existsSync(join(DIST, 'index.html'))) {
    console.log(`Web preview: http://127.0.0.1:${PORT}/`);
  }
});
