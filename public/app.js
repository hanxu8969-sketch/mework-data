// MeWork SPA
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const S = { data: null, view: 'brief', tlStart: null, tlDays: 0, collapsed: new Set(), error: null, loading: true };

// ---------- date helpers (Asia/Tokyo) ----------
const JST_FMT = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
const todayStr = () => JST_FMT.format(new Date());
const D = 86400000;
const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (s, n) => fromUTC(toUTC(s) + n * D);
const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / D);
const weekEnd = () => addDays(todayStr(), 7); // “本周必做” = 未来 7 天内到期
const fmtMd = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;

// ---------- api ----------
async function api(method, path, body, raw) {
  const opts = { method, headers: {} };
  if (raw !== undefined) { opts.body = raw; }
  else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  let json = null;
  try { json = await res.json(); } catch { }
  if (!res.ok) { const e = new Error((json && json.error) || `HTTP ${res.status}`); e.status = res.status; e.data = json; throw e; }
  return json;
}
const opid = () => crypto.randomUUID();
function esc(s) { const d = document.createElement('span'); d.textContent = s ?? ''; return d.innerHTML; }


function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 2500);
}

async function load() {
  S.loading = true; S.error = null; render();
  try { S.data = await api('GET', '/api/bootstrap'); }
  catch (e) { S.error = e.message; }
  S.loading = false; render();
  api('GET', '/api/briefing').then((b) => { S.briefing = b; if (S.view === 'brief') render(); }).catch(() => { });
}

// 极简 markdown → HTML（只支持简报用到的语法）
function md(src) {
  const lines = String(src || '').split('\n');
  const out = [];
  let inList = false, inQuote = false, table = null;
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_(.+?)_(?=[\s).,，。]|$)/g, '$1<i>$2</i>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };
  const closeTable = () => {
    if (!table) return;
    const [head, ...rows] = table;
    out.push('<div class="tw"><table><thead><tr>'
      + head.map((c) => `<th>${inline(c)}</th>`).join('')
      + '</tr></thead><tbody>'
      + rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
      + '</tbody></table></div>');
    table = null;
  };
  const cells = (ln) => ln.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  for (const ln of lines) {
    // 表格：| a | b |，第二行是 |---|---| 分隔线
    if (/^\s*\|.*\|\s*$/.test(ln)) {
      closeList(); closeQuote();
      if (/^\s*\|[\s:|-]+\|\s*$/.test(ln)) continue; // 分隔行丢弃
      if (!table) table = [cells(ln)]; else table.push(cells(ln));
      continue;
    }
    closeTable();

    const q = ln.match(/^\s*>\s?(.*)$/);
    if (q) {
      closeList();
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      if (q[1].trim()) out.push(`<p>${inline(q[1])}</p>`);
      continue;
    }
    closeQuote();

    const li = ln.match(/^\s*[-*]\s+(?:\[[ x]\]\s+)?(.*)$/);
    if (li) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    closeList();

    if (/^\s*---+\s*$/.test(ln)) { out.push('<hr>'); continue; }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    if (ln.trim()) out.push(`<p>${inline(ln)}</p>`);
  }
  closeTable(); closeQuote(); closeList();
  return out.join('');
}


// 简报独立成页：整页展开，不需要折叠
function renderBriefView(el) {
  el.innerHTML = '';
  const b = S.briefing;
  const box = document.createElement('section'); box.className = 'brief solo';
  if (!b) { box.innerHTML = '<div class="state-box">加载中…</div>'; el.appendChild(box); return; }
  if (b.missing) {
    box.innerHTML = `<div class="brief-head"><h3>今日简报</h3><span class="badge warn">${esc(b.date)} 尚未生成</span></div>
      <div class="brief-body"><p style="color:var(--muted)">每晚 21:00 生成次日简报（游戏市场 report + AI 市场 report），早上 07:00 推送到手机。</p></div>`;
    el.appendChild(box); return;
  }
  const stale = b.stale_days > 0;
  box.innerHTML = `<div class="brief-head">
      <h3>${stale ? '最近一份简报' : '今日简报'}</h3>
      <span class="badge ${stale ? 'warn' : ''}">${esc(b.date)}${stale ? ` · ${b.stale_days} 天前` : ''}</span>
      ${b.has_game_report ? '<span class="badge ok">🎮 游戏</span>' : '<span class="badge warn">🎮 未生成</span>'}
      ${b.has_ai_report ? '<span class="badge ok">🤖 AI</span>' : '<span class="badge warn">🤖 未生成</span>'}
    </div>
    <div class="brief-body solo">${md(b.body)}</div>`;
  el.appendChild(box);
}

// Trello 是只读镜像；MeWork 自己的项目才可写
const trelloLanes = () => S.data ? S.data.projects.filter((p) => p.source === 'trello') : [];

// ── 今日：打开就该看到能动手的事，不是一屏数字 ──
// 顺序即优先级：摘要一行 → 收件箱（真正的 todo）→ 近期节点。

function summaryBar(el, today) {
  const tr = S.data?.trello; if (!tr?.enabled) return;
  const lanes = trelloLanes().filter((p) => !p.is_done_lane);
  const inboxOver = (tr.inbox?.cards || []).filter((c) => c.overdue).length;
  const soon = lanes.flatMap((p) => p.tasks.filter((t) => t.status !== 'done' && t.milestone
    && t.milestone >= today && t.milestone <= addDays(today, 14))).length;
  const dow = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(toUTC(today)).getUTCDay()];

  const bar = document.createElement('div'); bar.className = 'sum';
  bar.innerHTML = `<div class="sum-date"><b>${+today.slice(5, 7)}月${+today.slice(8, 10)}日</b> ${dow}</div>
    <div class="sum-n"><b>${tr.inbox?.count ?? 0}</b> 待办</div>
    ${inboxOver ? `<div class="sum-n bad"><b>${inboxOver}</b> 逾期</div>` : ''}
    <div class="sum-n"><b>${soon}</b> 两周内节点</div>
    <div class="sum-n muted"><b>${tr.total}</b> 未完成</div>`;
  el.appendChild(bar);
}

function renderInbox(el) {
  const inbox = S.data?.trello?.inbox;
  const box = document.createElement('section'); box.className = 'card';
  if (!inbox?.cards?.length) {
    box.innerHTML = `<div class="card-h"><h3>收件箱</h3>
      <a class="lnk" href="https://trello.com/my/inbox" target="_blank" rel="noopener">Trello ↗</a></div>
      <div class="empty">收件箱是空的。新的待办在 Trello 收件箱里记，这里会同步显示。</div>`;
    el.appendChild(box); return;
  }
  box.innerHTML = `<div class="card-h"><h3>收件箱</h3><span class="n">${inbox.cards.length}</span>
      <a class="lnk" href="https://trello.com/my/inbox" target="_blank" rel="noopener">Trello ↗</a></div>`;
  const list = document.createElement('div'); list.className = 'rows';
  inbox.cards.forEach((c) => {
    const row = document.createElement('div'); row.className = 'row' + (c.overdue ? ' bad' : '');
    row.innerHTML = `<div class="row-main">
        <span class="mark">${c.overdue ? '!' : ''}</span>
        <span class="ttl">${esc(c.title)}</span>
        ${c.due ? `<span class="meta${c.overdue ? ' bad' : ''}">${c.overdue ? '逾期 ' : ''}${fmtMd(c.due)}</span>` : ''}
        <a class="go" href="${esc(c.url)}" target="_blank" rel="noopener" aria-label="在 Trello 打开">↗</a>
      </div>${c.body ? `<div class="row-desc" hidden>${md(c.body)}</div>` : ''}`;
    const d = $('.row-desc', row);
    if (d) {
      row.classList.add('expandable');
      $('.row-main', row).onclick = (e) => {
        if (e.target.closest('.go')) return;
        d.hidden = !d.hidden; row.classList.toggle('open', !d.hidden);
      };
    }
    list.appendChild(row);
  });
  box.appendChild(list); el.appendChild(box);
}

function renderMilestones(el) {
  const today = todayStr();
  const items = trelloLanes().filter((p) => !p.is_done_lane)
    .flatMap((p) => p.tasks.filter((t) => t.status !== 'done' && t.milestone)
      .map((t) => ({ ...t, _lane: p.title })))
    .filter((t) => t.milestone <= addDays(today, 30))
    .sort((a, b) => a.milestone.localeCompare(b.milestone));
  const box = document.createElement('section'); box.className = 'card';
  box.innerHTML = `<div class="card-h"><h3>近期节点</h3><span class="n">${items.length}</span>
      <span class="sub">未来 30 天</span></div>`;
  if (!items.length) {
    box.innerHTML += '<div class="empty">未来 30 天没有节点。完整安排见「日程」。</div>';
    el.appendChild(box); return;
  }
  const list = document.createElement('div'); list.className = 'rows';
  list.innerHTML = items.map((t) => {
    const dd = diffDays(today, t.milestone);
    return `<a class="row link" href="${esc(t.url)}" target="_blank" rel="noopener">
      <div class="row-main">
        <span class="date${dd < 0 ? ' bad' : dd <= 7 ? ' soon' : ''}">${fmtMd(t.milestone)}</span>
        <span class="ttl">${esc(t.title)}</span>
        <span class="lane">${esc(t._lane)}</span>
        <span class="meta">${dd === 0 ? '今天' : dd > 0 ? `${dd} 天后` : `逾期 ${-dd} 天`}</span>
      </div></a>`;
  }).join('');
  box.appendChild(list); el.appendChild(box);
}

function renderToday(el) {
  el.innerHTML = '';
  const today = todayStr();
  const pr = document.createElement('div');
  pr.className = 'push-row'; pr.id = 'push-row'; pr.hidden = true;
  el.appendChild(pr);
  renderPushRow();
  summaryBar(el, today);
  renderInbox(el);
  renderMilestones(el);
}

// ---------- 日程：以项目为主轴的月度安排 ----------
// 按月平铺会丢掉「哪个客户在什么时候」这层关系，对 BD 来说那才是重点。
// 所以：顶部「项目 × 月份」网格看全局，下面每个项目按月排开。
function renderCalendar(el) {
  el.innerHTML = '';
  const today = todayStr();
  const curMonth = today.slice(0, 7);
  const lanes = trelloLanes().filter((p) => !p.is_done_lane && p.open_count > 0);
  if (!lanes.length) {
    el.innerHTML = '<div class="state-box">没有未完成的事项。</div>';
    return;
  }

  // 每条线：按月分桶 + 未定日期
  const rows = lanes.map((p) => {
    const open = p.tasks.filter((t) => t.status !== 'done');
    const months = new Map();
    const undated = [];
    for (const t of open) {
      if (!t.milestone) { undated.push(t); continue; }
      const m = t.milestone.slice(0, 7);
      if (!months.has(m)) months.set(m, []);
      months.get(m).push(t);
    }
    for (const arr of months.values()) arr.sort((a, b) => a.milestone.localeCompare(b.milestone));
    return { p, months, undated, dated: open.length - undated.length };
  }).sort((a, b) => b.dated - a.dated || b.p.open_count - a.p.open_count);

  const allMonths = [...new Set(rows.flatMap((r) => [...r.months.keys()]))].sort();

  // ── 全局网格：行=项目，列=月份 ──
  if (allMonths.length) {
    const grid = document.createElement('section'); grid.className = 'gcal';
    grid.innerHTML = `<div class="card-h gcal-h"><h3>项目 × 月份</h3><span class="sub">数字为该月事项数</span></div>`;
    const tbl = document.createElement('div'); tbl.className = 'gcal-tbl';
    const maxN = Math.max(...rows.flatMap((r) => [...r.months.values()].map((a) => a.length)), 1);
    tbl.innerHTML = `<div class="gcal-row head">
        <span class="gcal-lane"></span>
        ${allMonths.map((m) => `<span class="gcal-cell head${m === curMonth ? ' now' : ''}">
          <b>${+m.slice(5)}月</b><small>${m.slice(2, 4)}</small></span>`).join('')}
        <span class="gcal-cell head und">未定</span>
      </div>` + rows.map((r) => `<a class="gcal-row" href="#p-${esc(r.p.id)}">
        <span class="gcal-lane" title="${esc(r.p.title)}">${esc(r.p.title)}</span>
        ${allMonths.map((m) => {
          const n = r.months.get(m)?.length || 0;
          const op = n ? (0.28 + 0.72 * (n / maxN)).toFixed(2) : 0;
          return `<span class="gcal-cell${m === curMonth ? ' now' : ''}">${n
            ? `<span class="gcal-dot" style="opacity:${op}">${n}</span>` : ''}</span>`;
        }).join('')}
        <span class="gcal-cell und">${r.undated.length ? `<span class="gcal-dot none">${r.undated.length}</span>` : ''}</span>
      </a>`).join('');
    grid.appendChild(tbl);
    el.appendChild(grid);
  }

  // ── 每个项目一张卡，卡内按月排开 ──
  for (const r of rows) {
    const sec = document.createElement('section'); sec.className = 'pcal'; sec.id = `p-${r.p.id}`;
    const next = r.p.next_milestone;
    const dd = next ? diffDays(today, next) : null;
    sec.innerHTML = `<div class="card-h pcal-h">
        <h3>${esc(r.p.title)}</h3>
        <span class="badge">${r.p.open_count} 项</span>
        ${next ? `<span class="badge ${dd < 0 ? 'st-critical' : dd <= 30 ? 'soon' : ''}">下一节点 ${fmtMd(next)}</span>` : ''}
        <span class="pcal-board">${esc(r.p.board)}</span>
        <a class="tl-open" href="${esc(r.p.url)}" target="_blank" rel="noopener" title="在 Trello 打开">↗</a>
      </div>`;
    const body = document.createElement('div'); body.className = 'pcal-body';
    const blocks = [];
    for (const [m, arr] of [...r.months].sort((a, b) => a[0].localeCompare(b[0]))) {
      blocks.push(`<div class="pcal-mo${m === curMonth ? ' now' : ''}">
        <div class="pcal-mo-l">${m.slice(0, 4)}<b>${+m.slice(5)}月</b>${m === curMonth ? '<span class="badge soon">本月</span>' : ''}</div>
        <div class="pcal-items">${arr.map((t) => {
          const d = diffDays(today, t.milestone);
          return `<a class="pcal-i" href="${esc(t.url)}" target="_blank" rel="noopener">
            <span class="pcal-d">${+t.milestone.slice(8)}日</span>
            <span class="pcal-t">${esc(t.title)}</span>
            <span class="cal-rel${d < 0 ? ' past' : d <= 14 ? ' soon' : ''}">${d === 0 ? '今天' : d > 0 ? `${d}天后` : `${-d}天前`}</span>
          </a>`;
        }).join('')}</div></div>`);
    }
    if (r.undated.length) {
      blocks.push(`<div class="pcal-mo und">
        <div class="pcal-mo-l"><b>未定日期</b></div>
        <div class="pcal-items">${r.undated.map((t) => `<a class="pcal-i" href="${esc(t.url)}" target="_blank" rel="noopener">
          <span class="pcal-d dash">—</span><span class="pcal-t">${esc(t.title)}</span></a>`).join('')}</div></div>`);
    }
    body.innerHTML = blocks.join('');
    sec.appendChild(body);
    el.appendChild(sec);
  }
}

// ---------- 周回顾（PDCA 的 Check）----------
function renderReview(el) {
  el.innerHTML = '';
  const today = todayStr();
  const lanes = trelloLanes().filter((p) => !p.is_done_lane);
  const days = (iso) => iso ? Math.round((Date.now() - Date.parse(iso)) / 864e5) : null;

  const moved = [], stalled = [];
  for (const p of lanes) {
    const d = days(p.last_activity);
    if (d === null) continue;
    if (d <= 7) moved.push({ p, d });
    else if (d > 60 && p.open_count > 0) stalled.push({ p, d });
  }
  moved.sort((a, b) => a.d - b.d);
  stalled.sort((a, b) => b.d - a.d);

  const next14 = lanes.flatMap((p) => p.tasks
    .filter((t) => t.status !== 'done' && t.milestone && t.milestone >= today && t.milestone <= addDays(today, 14))
    .map((t) => ({ ...t, _lane: p.title })))
    .sort((a, b) => a.milestone.localeCompare(b.milestone));

  const inbox = S.data?.trello?.inbox?.cards || [];
  const inboxOld = inbox.filter((c) => (days(c.last_activity) ?? 0) > 14);

  const sec = (title, sub, rows, empty, cls = '') => {
    const box = document.createElement('section'); box.className = 'rv ' + cls;
    box.innerHTML = `<div class="card-h"><h3>${title}</h3><span class="n">${rows.length}</span>
        ${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>
      <div class="rv-body">${rows.length ? rows.join('') : `<div class="rv-empty">${empty}</div>`}</div>`;
    el.appendChild(box);
  };

  const head = document.createElement('div'); head.className = 'rv-title';
  head.innerHTML = `<h2>本周检视</h2><span class="rv-date">${today}</span>`;
  el.appendChild(head);

  sec('本周动过', '最近 7 天有活动', moved.map(({ p, d }) =>
    `<div class="rv-row"><span class="rv-name">${esc(p.title)}</span>
      <span class="badge">${p.open_count} 项未完成</span>
      <span class="rv-when">${d === 0 ? '今天' : `${d} 天前`}</span></div>`),
  '本周没有任何一条线有动静 —— 值得警惕');

  sec('停滞', '超 60 天无动静且仍有未完成', stalled.map(({ p, d }) =>
    `<div class="rv-row bad"><span class="rv-name">${esc(p.title)}</span>
      <span class="badge">${p.open_count} 项未完成</span>
      <span class="rv-when bad">${d} 天前</span></div>`),
  '没有停滞的线 ✓', 'warn');

  sec('未来两周节点', '', next14.map((t) => {
    const dd = diffDays(today, t.milestone);
    return `<a class="rv-row" href="${esc(t.url)}" target="_blank" rel="noopener">
      <span class="rv-name">${esc(t.title)}</span>
      <span class="badge">${esc(t._lane)}</span>
      <span class="rv-when soon">${fmtMd(t.milestone)} · ${dd === 0 ? '今天' : `${dd} 天后`}</span></a>`;
  }), '未来两周没有节点');

  renderLoadChart(el);
  sec('收件箱积压', '超 14 天没碰过', inboxOld.map((c) =>
    `<a class="rv-row" href="${esc(c.url)}" target="_blank" rel="noopener">
      <span class="rv-name">${esc(c.title)}</span>
      <span class="rv-when">${days(c.last_activity)} 天前</span></a>`),
  '收件箱都是新鲜的 ✓');
}

// ---------- 每日提醒（Web Push）----------
const b64ToU8 = (s) => {
  const p = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function initPush() {
  if (!('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register('/sw.js'); } catch { return; }
  renderPushRow();
}

async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  // iOS 只有加到主屏后才允许申请通知权限
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('通知权限被拒绝，可在系统设置里改回来', true); return renderPushRow(); }
  const { publicKey } = await api('GET', '/api/push/key');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
  await api('POST', '/api/push/subscribe', sub.toJSON());
  toast('已开启，每天早上 7 点提醒你 ✓');
  renderPushRow();
}

async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => { });
    await sub.unsubscribe();
  }
  toast('已关闭每日提醒');
  renderPushRow();
}

async function renderPushRow() {
  const host = $('#push-row');
  if (!host) return;
  const st = await pushState();
  const msg = {
    unsupported: ['此浏览器不支持推送通知', null],
    'needs-install': ['想收每日提醒？先点分享按钮 →「加入主屏幕」，再从主屏打开', null],
    denied: ['通知已被系统拒绝，需到 设置 → 通知 → MeWork 里打开', null],
    off: ['每天早上 7 点提醒今日待办与简报', '开启提醒'],
    on: ['✅ 每日提醒已开启（早上 7 点）', '关闭'],
  }[st];
  if (!msg) return;
  host.innerHTML = `<span>${esc(msg[0])}</span>${msg[1] ? `<button class="btn ghost" id="push-btn">${msg[1]}</button>` : ''}`;
  host.hidden = false;
  const btn = $('#push-btn', host);
  if (btn) btn.onclick = () => (st === 'on' ? disablePush() : enablePush());
}

// ---------- shell ----------
function switchView(v) {
  S.view = v;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach((x) => { x.hidden = x.id !== 'view-' + v; });
  render();
}
$$('.tab').forEach((t) => { t.onclick = () => switchView(t.dataset.view); });

function render() {
  const el = $('#view-' + S.view);
  if (S.loading) { el.innerHTML = '<div class="state-box">加载中…</div>'; return; }
  if (S.error) {
    el.innerHTML = `<div class="state-box error">加载失败：${esc(S.error)} <br><br><button class="btn" onclick="location.reload()">重试</button></div>`;
    return;
  }
  if (!S.data) return;
  if (S.view === 'brief') renderBriefView(el);
  if (S.view === 'today') renderToday(el);
  if (S.view === 'calendar') renderCalendar(el);
  if (S.view === 'review') renderReview(el);
}
load();
initPush();
