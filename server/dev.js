// MeWork local dev server (node server/dev.js) — serves public/ + /api on :8787
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from './store.js';
import { handleApi } from './api.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store = new FsStore(root);
const pub = path.join(root, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };
  try {
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      let json = null;
      if (raw.length && (req.headers['content-type'] || '').includes('json')) {
        try { json = JSON.parse(raw.toString()); } catch { return send(400, JSON.stringify({ error: 'invalid json' })); }
      }
      const q = Object.fromEntries(url.searchParams);
      const out = await handleApi(store, req.method, url.pathname, q, json, raw);
      if (out.raw) return send(out.status, out.raw, out.contentType);
      return send(out.status, JSON.stringify(out.json));
    }
    // static
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(pub, rel));
    if (!file.startsWith(pub)) return send(400, 'bad path', 'text/plain');
    try {
      const buf = await fs.readFile(file);
      return send(200, buf, MIME[path.extname(file)] || 'application/octet-stream');
    } catch {
      const buf = await fs.readFile(path.join(pub, 'index.html'));
      return send(200, buf, MIME['.html']);
    }
  } catch (e) {
    console.error(e);
    send(500, JSON.stringify({ error: e.message }));
  }
});
server.listen(8787, () => console.log('MeWork dev on http://localhost:8787'));
