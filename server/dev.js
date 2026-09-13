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
      // 本地也合并 Trello：有 TRELLO_KEY 就拉真实数据，否则用 fixture（便于离线开发）
      if (url.pathname === '/api/bootstrap' && out.status === 200) {
        try {
          const { fetchTrello, fetchInbox, projectTrello, summarize } = await import('./trello.js');
          const { jstDate } = await import('./briefing.js');
          let boards = await fetchTrello(process.env);
          if (!boards) {
            const fx = path.join(root, 'server', 'trello-fixture.json');
            boards = await fs.readFile(fx, 'utf8').then(JSON.parse).catch(() => null);
          }
          if (boards) {
            const tp = projectTrello(boards, jstDate());
            out.json.projects = [...tp, ...out.json.projects];
            const inbox = await fetchInbox(process.env).catch(() => null);
            out.json.trello = { enabled: true, ...summarize(tp), inbox: inbox || JSON.parse(await fs.readFile(path.join(root,'server','inbox-fixture.json'),'utf8').catch(() => 'null')) || { count: 0, cards: [] } };
          } else {
            out.json.trello = { enabled: false, total: 0, lanes: [] };
          }
        } catch (e) {
          out.json.trello = { enabled: true, error: String(e.message || e), total: 0, lanes: [] };
        }
      }
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
const PORT = Number(process.env.PORT) || 8787;
server.listen(PORT, () => console.log(`MeWork dev on http://localhost:${PORT}`));
