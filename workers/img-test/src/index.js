const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization, cookie, x-linux-cookie',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    },
  });
}

function extOf(type, name = '') {
  const mapped = ALLOWED.get(type);
  if (mapped) return mapped;
  const fromName = String(name).toLowerCase().match(/\.(jpe?g|png|webp|gif)$/)?.[1];
  if (fromName === 'jpeg') return 'jpg';
  return fromName || 'png';
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json({ ok: true });
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({ ok: true, bucket: 'liunxsb' });
    }

    const fileMatch = url.pathname.match(/^\/i\/([a-z0-9]+)(?:\.[a-z0-9]+)?$/i);
    if (request.method === 'GET' && fileMatch) {
      const object = await env.IMAGES.get(fileMatch[1]);
      if (!object) return json({ error: 'NOT_FOUND' }, 404);
      const headers = new Headers();
      headers.set('content-type', object.httpMetadata?.contentType || 'image/jpeg');
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      headers.set('access-control-allow-origin', '*');
      if (object.httpEtag) headers.set('etag', object.httpEtag);
      return new Response(object.body, { headers });
    }

    if (request.method === 'POST' && url.pathname === '/upload') {
      if (!env.IMAGES) return json({ error: 'NO_BUCKET' }, 500);
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return json({ error: 'NO_FILE' }, 400);
      const type = String(file.type || 'image/jpeg').toLowerCase();
      if (!ALLOWED.has(type)) return json({ error: 'BAD_TYPE', type }, 400);
      const buf = await file.arrayBuffer();
      if (buf.byteLength < 24 || buf.byteLength > MAX_BYTES) return json({ error: 'BAD_SIZE' }, 400);
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      await env.IMAGES.put(id, buf, {
        httpMetadata: { contentType: type },
        customMetadata: { name: String(file.name || '').slice(0, 80) },
      });
      const publicUrl = `${url.origin}/i/${id}.${extOf(type, file.name)}`;
      return json({
        id,
        url: publicUrl,
        expiresAt: new Date(Date.now() + 10 * 365 * 864e5).toISOString(),
      });
    }

    return json({ error: 'NOT_FOUND' }, 404);
  },
};
