// MeWork Service Worker —— 收到空负载推送后自己去拉今天的待办，再弹通知。
const BOARD = '/';
const PRI = { p0: '🔴', p1: '🟠', p2: '🔵', p3: '⚪' };

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const jstToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());


const jstParts = () => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', weekday: 'short', hour: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { dow: p.weekday, hour: Number(p.hour) };
};
const daysSince = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 864e5) : null);

// 周回顾：本周动过 / 停滞 / 未来两周节点 / 收件箱积压
function buildWeekly(data, today) {
  const lanes = (data.projects || []).filter((p) => p.source === 'trello' && !p.is_done_lane);
  const moved = lanes.filter((p) => (daysSince(p.last_activity) ?? 99) <= 7);
  const stalled = lanes.filter((p) => p.open_count > 0 && (daysSince(p.last_activity) ?? 0) > 60)
    .sort((a, b) => daysSince(b.last_activity) - daysSince(a.last_activity));
  const addD = (n) => {
    const [y, m, d] = today.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const next14 = lanes.flatMap((p) => (p.tasks || []).filter((t) => t.status !== 'done'
    && t.milestone && t.milestone >= today && t.milestone <= addD(14)));
  const inboxOld = (data.trello?.inbox?.cards || []).filter((c) => (daysSince(c.last_activity) ?? 0) > 14);

  const md = `${+today.slice(5, 7)}/${+today.slice(8, 10)}`;
  const lines = [`本周动过 ${moved.length} 条线 · 共 ${lanes.length} 条`];
  if (stalled.length) {
    lines.push(`⚠️ 停滞 ${stalled.length}：${stalled.slice(0, 2).map((p) => `${p.title} ${daysSince(p.last_activity)}天`).join('、')}`);
  } else lines.push('✅ 没有停滞的线');
  lines.push(`📌 未来两周 ${next14.length} 个节点`);
  if (inboxOld.length) lines.push(`📥 收件箱积压 ${inboxOld.length} 项（超 14 天）`);
  return { title: `📋 周回顾 · ${md}`, body: lines.join('\n'), tag: 'mework-weekly' };
}

async function buildNotification() {
  const today = jstToday();
  // same-origin fetch 会带上 Access cookie
  const res = await fetch('/api/bootstrap', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`bootstrap ${res.status}`);
  const data = await res.json();

  // 周五傍晚发周回顾，其余时间发每日待办
  const { dow, hour } = jstParts();
  if (dow === 'Fri' && hour >= 15) return buildWeekly(data, today);

  const md = `${+today.slice(5, 7)}月${+today.slice(8, 10)}日`;
  const tr = data.trello || {};
  const lines = [];
  let title;

  // 主体：Trello 各列表的未完成数
  if (tr.enabled && !tr.error) {
    title = tr.total > 0 ? `☀️ ${md} · 未完成 ${tr.total} 项` : `☀️ ${md} · Trello 已清空`;
    if (tr.total > 0) {
      lines.push(...(tr.lanes || []).slice(0, 7).map((l) => `• ${l.title} ${l.count}`));
      const rest = (tr.lanes || []).slice(7).reduce((n, l) => n + l.count, 0);
      if (rest) lines.push(`• 其余 ${rest}`);
    } else {
      lines.push('✅ 没有未完成的卡片');
    }
  } else {
    title = `☀️ ${md} · 早安`;
    lines.push(tr.error ? '⚠️ Trello 读取失败，打开看板查看' : '打开看板查看今天的安排');
  }

  // 逾期的 Trello 卡片单独点名（设了 due 才有）
  const overdue = (data.projects || [])
    .filter((p) => p.source === 'trello' && !p.is_done_lane)
    .flatMap((p) => (p.tasks || []).filter((t) => t.status !== 'done' && t.due && t.due < today));
  if (overdue.length) lines.push(`🔥 逾期 ${overdue.length}：${overdue.slice(0, 2).map((t) => t.title).join('、')}`);

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
      tag: n.tag || 'mework-morning',
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
