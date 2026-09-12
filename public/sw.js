// MeWork Service Worker —— 收到空负载推送后自己去拉今天的待办，再弹通知。
const BOARD = '/';
const PRI = { p0: '🔴', p1: '🟠', p2: '🔵', p3: '⚪' };

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const jstToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

async function buildNotification() {
  const today = jstToday();
  // same-origin fetch 会带上 Access cookie
  const res = await fetch('/api/bootstrap', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`bootstrap ${res.status}`);
  const data = await res.json();

  const rank = { p0: 0, p1: 1, p2: 2, p3: 3 };
  const open = (data.projects || [])
    .filter((p) => p.status === 'active')
    .flatMap((p) => (p.tasks || []).filter((t) => t.status !== 'done').map((t) => ({ ...t, _p: p.title })));
  const sort = (a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || String(a.due || '9999').localeCompare(String(b.due || '9999'));
  const overdue = open.filter((t) => t.due && t.due < today).sort(sort);
  const due = open.filter((t) => t.due === today).sort(sort);

  const md = `${+today.slice(5, 7)}月${+today.slice(8, 10)}日`;
  let title, lines = [];
  if (overdue.length || due.length) {
    const bits = [];
    if (overdue.length) bits.push(`逾期 ${overdue.length}`);
    if (due.length) bits.push(`今天 ${due.length}`);
    title = `☀️ ${md} · ${bits.join(' · ')}`;
    lines = [...overdue, ...due].slice(0, 5).map((t) => `${PRI[t.priority] || '•'} ${t.title} — ${t._p}`);
    if (overdue.length + due.length > 5) lines.push(`…还有 ${overdue.length + due.length - 5} 项`);
  } else {
    title = `☀️ ${md} · 今天没有到期任务`;
    lines = ['✅ 逾期和今日到期都清空了'];
  }

  // 简报状态：如实反映，不谎报
  try {
    const b = await fetch(`/api/briefing?date=${today}`, { credentials: 'same-origin' }).then((r) => r.json());
    if (b && !b.missing && (b.has_game_report || b.has_ai_report)) {
      const tags = [b.has_game_report ? '🎮 游戏' : null, b.has_ai_report ? '🤖 AI' : null].filter(Boolean).join(' ');
      lines.push(`📰 今日简报已就绪 ${tags}`);
    } else {
      lines.push('📰 今日简报尚未生成');
    }
  } catch { /* 简报读不到不影响待办通知 */ }

  return { title, body: lines.join('\n') };
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let n;
    try {
      n = await buildNotification();
    } catch {
      // 拉不到（登录过期、离线）也必须弹一条，否则 iOS 会警告"收到推送却没通知"
      n = { title: '☀️ MeWork 早间提醒', body: '打开看板查看今天的待办与简报' };
    }
    await self.registration.showNotification(n.title, {
      body: n.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'mework-morning',
      renotify: true,
      data: { url: BOARD },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(self.location.origin)) return c.focus();
    }
    return self.clients.openWindow(event.notification.data?.url || BOARD);
  })());
});
