// MeWork Cloudflare Worker — API + Access 鉴权 + Cron
// 浏览器只调用 authenticated API；GitHub / Google 凭据只存在 Worker secret，永不下发到前端。
import { handleApi } from './api.js';
import { GitHubStore } from './github-store.js';
import { GoogleCalendar } from './google.js';
import { syncBoardToCalendar, fetchProjection } from './sync.js';
import { writeBriefing, readBriefing, jstDate } from './briefing.js';
import { pushAll, saveSubscription, removeSubscription } from './push.js';
import { fetchTrello, fetchInbox, projectTrello, summarize, exportTrelloToStore } from './trello.js';

// ---- Cloudflare Access JWT 校验 ----
let jwksCache = { keys: null, exp: 0 };
async function getJwks(teamDomain) {
  if (jwksCache.keys && Date.now() < jwksCache.exp) return jwksCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('jwks fetch failed');
  const j = await res.json();
  jwksCache = { keys: j.keys, exp: Date.now() + 3600_000 };
  return j.keys;
}
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

async function verifyAccess(request, env) {
  if (env.DEV_BYPASS_AUTH === '1') return { email: 'dev@localhost' };
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64u(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64u(p)));
  if (payload.aud && !(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(env.ACCESS_AUD)) return null;
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  const jwk = (await getJwks(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  if (env.ALLOWED_EMAIL && payload.email !== env.ALLOWED_EMAIL) return null;
  return { email: payload.email };
}

const storeOf = (env) => new GitHubStore({ token: env.GITHUB_TOKEN, owner: env.GITHUB_OWNER, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || 'main' });
const gcalOf = (env) => (env.GOOGLE_REFRESH_TOKEN
  ? new GoogleCalendar({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken: env.GOOGLE_REFRESH_TOKEN })
  : null);

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const user = await verifyAccess(request, env);
    if (!user) return json(401, { error: '未登录或无权访问（Cloudflare Access）' });

    const store = storeOf(env);

    // Web Push：订阅管理与自测
    if (url.pathname === '/api/push/key' && request.method === 'GET') {
      return json(200, { publicKey: env.VAPID_PUBLIC_KEY || null });
    }
    if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
      const sub = await request.json().catch(() => null);
      if (!sub?.endpoint || !sub?.keys) return json(400, { error: '订阅数据不完整' });
      return json(200, await saveSubscription(store, sub));
    }
    if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
      const { endpoint } = (await request.json().catch(() => ({}))) || {};
      if (!endpoint) return json(400, { error: '缺 endpoint' });
      return json(200, await removeSubscription(store, endpoint));
    }
    // 诊断：确认卡片已取到，并探测收件箱的正确入口
    if (url.pathname === '/api/trello/raw' && request.method === 'GET') {
      if (!env.TRELLO_KEY || !env.TRELLO_TOKEN) return json(200, { configured: false });
      const K = `key=${env.TRELLO_KEY}&token=${env.TRELLO_TOKEN}`;
      const probe = async (path) => {
        try {
          const r = await fetch(`https://api.trello.com/1${path}${path.includes('?') ? '&' : '?'}${K}`);
          const t = await r.text();
          let d = null; try { d = JSON.parse(t); } catch { }
          return { status: r.status, kind: Array.isArray(d) ? `array(${d.length})` : typeof d, peek: t.slice(0, 220) };
        } catch (e) { return { error: String(e.message || e) }; }
      };
      const out = { fixed: null, inboxProbe: {} };
      try {
        const boards = await fetchTrello(env);
        out.fixed = (boards || []).map((b) => ({
          name: b.name, lists: b.lists?.length ?? null, cards: b.cards?.length ?? null,
          open: (b.cards || []).filter((c) => !c.dueComplete).length,
        }));
      } catch (e) { out.fixed = { error: String(e.message || e) }; }
      out.inboxProbe['members/me?fields=prefs'] = await probe('/members/me?fields=prefs');
      out.inboxProbe['boards filter=all'] = await probe('/members/me/boards?filter=all&fields=name,type');
      return json(200, out);
    }
    if (url.pathname === '/api/trello/export' && request.method === 'POST') {
      const boards = await fetchTrello(env);
      if (!boards) return json(400, { error: 'Trello 未配置' });
      return json(200, await exportTrelloToStore(store, projectTrello(boards, jstDate()), jstDate()));
    }
    // 也接受 GET，方便在浏览器里直接点链接自测（仅诊断用，已在 Access 之后）
    if (url.pathname === '/api/push/test') {
      const r = await pushAll(store, env);
      return json(200, { ...r, 提示: r.sent ? `已向 ${r.sent} 台设备发送，手机上几秒内应收到通知` : '没有已订阅的设备，请先在手机主屏 App 里开启提醒' });
    }

    // 日历：只读投影
    if (url.pathname === '/api/calendar/today' && request.method === 'GET') {
      const gcal = gcalOf(env);
      if (!gcal) return json(200, { enabled: false, events: [] });
      const from = url.searchParams.get('from') || jstDate();
      const to = url.searchParams.get('to') || jstDate(new Date(Date.now() + 7 * 864e5));
      try { return json(200, { enabled: true, events: await fetchProjection(gcal, from, to) }); }
      catch (e) { return json(200, { enabled: true, events: [], error: String(e.message || e) }); }
    }
    // 日历：手动触发写回
    if (url.pathname === '/api/calendar/sync' && request.method === 'POST') {
      const gcal = gcalOf(env);
      if (!gcal) return json(400, { error: 'Calendar 未启用（缺 GOOGLE_REFRESH_TOKEN）' });
      return json(200, await syncBoardToCalendar(store, gcal, { dryRun: url.searchParams.get('dry') === '1' }));
    }

    const raw = ['POST', 'PUT', 'PATCH'].includes(request.method) ? new Uint8Array(await request.arrayBuffer()) : null;
    let body = null;
    if (raw?.length && (request.headers.get('content-type') || '').includes('json')) {
      try { body = JSON.parse(new TextDecoder().decode(raw)); }
      catch { return json(400, { error: 'invalid json' }); }
    }
    // bootstrap 合并 Trello（只读投影）；Trello 挂了不影响 MeWork 自身数据
    if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
      const base = await handleApi(store, 'GET', '/api/bootstrap', {}, null, null);
      if (base.status === 200) {
        try {
          const today = jstDate();
          const [boards, inbox] = await Promise.all([
            fetchTrello(env),
            fetchInbox(env).catch(() => null),
          ]);
          if (boards) {
            const tp = projectTrello(boards, today);
            base.json.projects = [...tp, ...base.json.projects];
            base.json.trello = { enabled: true, ...summarize(tp), inbox: inbox || { count: 0, cards: [] } };
          } else {
            base.json.trello = { enabled: false, total: 0, lanes: [] };
          }
        } catch (e) {
          base.json.trello = { enabled: true, error: String(e.message || e), total: 0, lanes: [] };
        }
      }
      return json(base.status, base.json);
    }

    const out = await handleApi(store, request.method, url.pathname, Object.fromEntries(url.searchParams), body, raw);
    if (out.raw) return new Response(out.raw, { status: out.status, headers: { 'content-type': out.contentType, 'cache-control': 'no-store' } });

    // 写操作成功后顺带同步日历，不阻塞响应
    if (out.status < 300 && ['POST', 'PATCH'].includes(request.method) && url.pathname.startsWith('/api/tasks')) {
      const gcal = gcalOf(env);
      if (gcal) ctx.waitUntil(syncBoardToCalendar(store, gcal).catch(() => { }));
    }
    return json(out.status, out.json);
  },

  async scheduled(event, env, ctx) {
    const store = storeOf(env);
    const date = jstDate();
    const jstHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(new Date()));
    const jstDow = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(new Date());

    const tasks = [];
    // 07:00 JST：推送今日待办到手机。跑在云端，Mac 关机也照发。
    // 简报由 Mac 上的定时代理在 06:30 先写好；没写成也照发待办，SW 会如实标注"简报尚未生成"。
    if (jstHour === 7) {
      tasks.push((async () => {
        // 只在当天简报还不存在时补一份「仅待办」的骨架 —— 绝不覆盖 Mac 已写入的 report
        const existing = await readBriefing(store, date).catch(() => null);
        if (!existing) await writeBriefing(store, date, {}).catch(() => { });
        return pushAll(store, env);
      })());
    }
    // 周五 17:00 JST：推送周回顾。内容由 Service Worker 自取 /api/bootstrap 后按当天是周五组装，
    // 所以这里只需触发推送本身（空负载推送，省掉 RFC 8291 负载加密）。
    if (jstDow === 'Fri' && jstHour === 17) tasks.push(pushAll(store, env));
    // 每轮都把 Trello 导出成 markdown 落库 —— Obsidian 靠 git 同步读到它
    tasks.push((async () => {
      const boards = await fetchTrello(env);
      if (!boards) return { skipped: 'Trello 未配置' };
      return exportTrelloToStore(store, projectTrello(boards, date), date);
    })().catch((e) => ({ error: String(e.message || e) })));

    const gcal = gcalOf(env);
    if (gcal) tasks.push(syncBoardToCalendar(store, gcal));
    ctx.waitUntil(Promise.allSettled(tasks));
  },
};
