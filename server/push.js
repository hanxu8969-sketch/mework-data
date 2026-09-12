// Web Push（RFC 8292 VAPID）——跑在 Cloudflare 云端，不依赖任何本机设备。
// 采用「空负载推送」：不传内容，由 Service Worker 醒来后自己拉取，
// 这样省掉 RFC 8291 的负载加密，出错面小得多。
const SUB_PATH = 'content/push-subscriptions.json';
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function importVapidKey(jwkJson) {
  return crypto.subtle.importKey('jwk', JSON.parse(jwkJson), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function signJWT(key, audience, subject) {
  const header = b64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(new TextEncoder().encode(JSON.stringify({
    aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject,
  })));
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  return `${header}.${payload}.${b64u(sig)}`;
}

export async function readSubscriptions(store) {
  const f = await store.read(SUB_PATH);
  if (!f) return { subs: [], revision: null };
  const text = typeof f.text === 'string' ? f.text : new TextDecoder().decode(f.content);
  return { subs: JSON.parse(text).subscriptions || [], revision: f.revision };
}

export async function saveSubscription(store, sub) {
  const { subs, revision } = await readSubscriptions(store);
  const next = subs.filter((s) => s.endpoint !== sub.endpoint);
  next.push({ ...sub, created_at: new Date().toISOString() });
  const body = JSON.stringify({ subscriptions: next }, null, 2) + '\n';
  await store.write(SUB_PATH, body, revision);
  return { count: next.length };
}

export async function removeSubscription(store, endpoint) {
  const { subs, revision } = await readSubscriptions(store);
  const next = subs.filter((s) => s.endpoint !== endpoint);
  if (next.length === subs.length) return { removed: 0 };
  await store.write(SUB_PATH, JSON.stringify({ subscriptions: next }, null, 2) + '\n', revision);
  return { removed: subs.length - next.length };
}

/** 发一条空负载推送；SW 收到后自己去拉今天的待办。失效订阅自动清掉。 */
export async function pushAll(store, env, { ttl = 3600 } = {}) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) return { skipped: 'VAPID 未配置' };
  const { subs } = await readSubscriptions(store);
  if (!subs.length) return { skipped: '没有已订阅的设备' };

  const key = await importVapidKey(env.VAPID_PRIVATE_JWK);
  const report = { sent: 0, gone: 0, failed: [] };

  for (const sub of subs) {
    try {
      const aud = new URL(sub.endpoint).origin;
      const jwt = await signJWT(key, aud, env.VAPID_SUBJECT || 'mailto:hanxu8969@gmail.com');
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          TTL: String(ttl),
          Urgency: 'normal',
          Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
          'Content-Length': '0',
        },
      });
      if (res.status === 404 || res.status === 410) {
        await removeSubscription(store, sub.endpoint); // 设备已注销，清掉
        report.gone++;
      } else if (res.ok || res.status === 201) {
        report.sent++;
      } else {
        report.failed.push({ status: res.status, body: (await res.text()).slice(0, 120) });
      }
    } catch (e) {
      report.failed.push({ error: String(e.message || e) });
    }
  }
  return report;
}
