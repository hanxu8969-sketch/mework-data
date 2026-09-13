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
    box.innerHTML = `<div class="brief-head"><b>📰 今日简报</b><span class="badge warn">${esc(b.date)} 尚未生成</span></div>
      <div class="brief-body"><p style="color:var(--muted)">每晚 21:00 生成次日简报（游戏市场 report + AI 市场 report），早上 07:00 推送到手机。</p></div>`;
    el.appendChild(box); return;
  }
  const stale = b.stale_days > 0;
  box.innerHTML = `<div class="brief-head">
      <b>📰 ${stale ? '最近一份简报' : '今日简报'}</b>
      <span class="badge ${stale ? 'warn' : ''}">${esc(b.date)}${stale ? ` · ${b.stale_days} 天前` : ''}</span>
      ${b.has_game_report ? '<span class="badge ok">🎮 游戏</span>' : '<span class="badge warn">🎮 未生成</span>'}
      ${b.has_ai_report ? '<span class="badge ok">🤖 AI</span>' : '<span class="badge warn">🤖 未生成</span>'}
    </div>
    <div class="brief-body solo">${md(b.body)}</div>`;
  el.appendChild(box);
}

function renderBriefingPanel(el) {
  const b = S.briefing;
  const box = document.createElement('section'); box.className = 'brief';
  if (!b) { box.innerHTML = '<div class="brief-head"><b>📰 今日简报</b><span class="badge">加载中…</span></div>'; el.appendChild(box); return; }
  if (b.missing) {
    box.innerHTML = `<div class="brief-head"><b>📰 今日简报</b><span class="badge">${esc(b.date)} 尚未生成</span></div>
      <div class="brief-body"><p style="color:var(--muted)">每晚 21:00 生成次日简报（游戏市场 report + AI 市场 report），早上 07:00 推送到手机。待办来自 Trello，见上方。</p></div>`;
    el.appendChild(box); return;
  }
  const open = localStorage.getItem('mw-brief-open') !== '0';
  const stale = b.stale_days > 0;
  box.innerHTML = `<div class="brief-head" role="button" tabindex="0">
      <b>📰 ${stale ? '最近一份简报' : '今日简报'}</b>
      <span class="badge ${stale ? 'warn' : ''}">${esc(b.date)}${stale ? ` · ${b.stale_days} 天前` : ''}</span>
      ${b.has_game_report ? '<span class="badge ok">🎮 游戏</span>' : '<span class="badge warn">🎮 未生成</span>'}
      ${b.has_ai_report ? '<span class="badge ok">🤖 AI</span>' : '<span class="badge warn">🤖 未生成</span>'}
      <span class="brief-toggle">${open ? '收起' : '展开'}</span>
    </div>
    <div class="brief-body" ${open ? '' : 'hidden'}>${md(b.body)}</div>`;
  const head = $('.brief-head', box), body = $('.brief-body', box);
  const toggle = () => {
    body.hidden = !body.hidden;
    $('.brief-toggle', box).textContent = body.hidden ? '展开' : '收起';
    try { localStorage.setItem('mw-brief-open', body.hidden ? '0' : '1'); } catch { }
  };
  head.onclick = toggle;
  head.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  el.appendChild(box);
}

// merge a patched/created task record back into local state
function upsertTask(rec, revision) {
  const p = S.data.projects.find((x) => x.id === rec.project_id);
  if (!p) return;
  const i = p.tasks.findIndex((t) => t.id === rec.id);
  const t = { ...rec, revision };
  if (i >= 0) p.tasks[i] = t; else p.tasks.push(t);
}
const allTasks = () => S.data ? S.data.projects.flatMap((p) => p.tasks.map((t) => ({ ...t, _project: p }))) : [];
const activeProjects = () => S.data ? S.data.projects.filter((p) => p.status === 'active') : [];
// Trello 是只读镜像；MeWork 自己的项目才可写
const trelloLanes = () => S.data ? S.data.projects.filter((p) => p.source === 'trello') : [];
const ownProjects = () => S.data ? S.data.projects.filter((p) => p.source !== 'trello' && p.status === 'active') : [];

// ---------- shared: complete / reopen ----------
async function toggleDone(t) {
  const done = t.status === 'done';
  try {
    const r = await api('PATCH', `/api/tasks/${t.id}`, {
      operation_id: opid(), project_id: t.project_id, expected_revision: t.revision,
      changes: done ? { status: 'doing', completed_at: '' } : { status: 'done' },
    });
    upsertTask(r.record, r.revision); render();
    toast(done ? '已重开 → doing' : '已完成 ✓');
  } catch (e) { handleWriteError(e); }
}
function handleWriteError(e) {
  if (e.status === 409) { toast('数据已在别处更新，已刷新最新版本', true); load(); }
  else toast(`保存失败：${e.message}`, true);
}

// ---------- Today view ----------
function priRank(p) { return { p0: 0, p1: 1, p2: 2, p3: 3 }[p] ?? 2; }
function sortTasks(arr) {
  return arr.sort((a, b) => priRank(a.priority) - priRank(b.priority) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
}
function taskRow(t) {
  const div = document.createElement('div');
  div.className = 'trow' + (t.status === 'done' ? ' done' : '');
  div.tabIndex = 0; div.setAttribute('role', 'button');
  div.setAttribute('aria-label', `任务 ${t.title}`);
  const today = todayStr();
  const overdue = t.due && t.status !== 'done' && t.due < today;
  div.innerHTML = `
    <button class="chk ${t.status === 'done' ? 'on' : ''}" aria-label="完成/重开"></button>
    <span class="t-title">${esc(t.title)}</span>
    ${t.status === 'doing' ? '<span class="badge st-doing">进行中</span>' : ''}
    ${t.status === 'blocked' ? '<span class="badge st-blocked">卡住</span>' : ''}
    <span class="badge pri-${t.priority}">${t.priority.toUpperCase()}</span>
    ${t.due ? `<span class="badge ${overdue ? 'due-over' : ''}">${overdue ? '逾期 ' : ''}${fmtMd(t.due)}</span>` : ''}
    <span class="badge">${esc(t._project.title)}</span>`;
  $('.chk', div).onclick = (e) => { e.stopPropagation(); toggleDone(t); };
  div.onclick = () => openDrawer(t.id, t.project_id);
  div.onkeydown = (e) => {
    if (e.key === 'Enter') openDrawer(t.id, t.project_id);
    if (e.key === ' ') { e.preventDefault(); toggleDone(t); }
  };
  return div;
}
function esc(s) { const d = document.createElement('span'); d.textContent = s ?? ''; return d.innerHTML; }


// 近期节点：把标题里写的发售日 / due 抽出来，按时间尺度分档。
// 这是每天早上真正要看的东西 —— 不需要改任何 Trello 习惯。
function renderMilestones(el) {
  const tr = S.data?.trello;
  if (!tr?.enabled || tr.error) return;
  const today = todayStr();
  const items = trelloLanes()
    .filter((p) => !p.is_done_lane)
    .flatMap((p) => p.tasks.filter((t) => t.status !== 'done' && t.milestone)
      .map((t) => ({ ...t, _lane: p.title, _board: p.board })))
    .sort((a, b) => a.milestone.localeCompare(b.milestone));
  if (!items.length) return;

  const sunday = addDays(today, 7 - (new Date(toUTC(today)).getUTCDay() || 7));
  const nextSun = addDays(sunday, 7);
  const monthEnd = addDays(today, 31);
  const bucket = (d) => d < today ? '过期' : d <= sunday ? '本周' : d <= nextSun ? '下周' : d <= monthEnd ? '本月内' : '以后';
  const ORDER = ['过期', '本周', '下周', '本月内', '以后'];
  const ICON = { 过期: '🔴', 本周: '🔥', 下周: '📌', 本月内: '🗓️', 以后: '🕓' };

  const groups = new Map();
  for (const it of items) {
    const b = bucket(it.milestone);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(it);
  }
  const near = ORDER.slice(0, 4).reduce((n, k) => n + (groups.get(k)?.length || 0), 0);

  const box = document.createElement('section'); box.className = 'ms';
  box.innerHTML = `<div class="ms-head"><b>⏰ 近期节点</b>
      <span class="badge">${near} 项在一个月内</span>
      <span class="badge">共 ${items.length}</span></div>`;
  const body = document.createElement('div'); body.className = 'ms-body';

  for (const key of ORDER) {
    const arr = groups.get(key);
    if (!arr?.length) continue;
    const later = key === '以后';
    const grp = document.createElement('div'); grp.className = 'ms-grp' + (later ? ' later' : '');
    const openDefault = !later;
    const isOpen = (localStorage.getItem('mw-ms-' + key) ?? (openDefault ? '1' : '0')) === '1';
    grp.innerHTML = `<div class="ms-grp-h" role="button" tabindex="0">
        <span>${ICON[key]}</span><b>${key}</b><span class="badge">${arr.length}</span>
        <span class="ms-caret">${isOpen ? '▾' : '▸'}</span></div>
      <div class="ms-rows" ${isOpen ? '' : 'hidden'}>${arr.map((t) => {
        const dd = diffDays(today, t.milestone);
        const rel = dd === 0 ? '今天' : dd > 0 ? `${dd} 天后` : `逾期 ${-dd} 天`;
        return `<a class="ms-row" href="${esc(t.url)}" target="_blank" rel="noopener">
          <span class="ms-date ${dd < 0 ? 'over' : dd <= 7 ? 'soon' : ''}">${fmtMd(t.milestone)}</span>
          <span class="ms-rel ${dd < 0 ? 'over' : ''}">${rel}</span>
          <span class="ms-title">${esc(t.title)}</span>
          <span class="badge">${esc(t._lane)}</span>
          ${t.milestone_source === 'title' ? '<span class="badge src" title="日期取自卡片标题">标题</span>' : ''}
        </a>`;
      }).join('')}</div>`;
    const h = $('.ms-grp-h', grp), rows = $('.ms-rows', grp);
    const toggle = () => {
      rows.hidden = !rows.hidden;
      $('.ms-caret', grp).textContent = rows.hidden ? '▸' : '▾';
      try { localStorage.setItem('mw-ms-' + key, rows.hidden ? '0' : '1'); } catch { }
    };
    h.onclick = toggle;
    h.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    body.appendChild(grp);
  }
  box.appendChild(body);
  el.appendChild(box);
}

// Trello 区：按列表分组的未完成卡片。只读——所有编辑都回 Trello 做。
function renderTrelloSection(el) {
  const tr = S.data?.trello;
  if (!tr) return;
  const today = todayStr();
  const box = document.createElement('section'); box.className = 'trello';

  if (tr.error) {
    box.innerHTML = `<div class="tl-head"><b>📋 Trello</b><span class="badge warn">读取失败</span></div>
      <div class="tl-err">${esc(tr.error)}</div>`;
    el.appendChild(box); return;
  }
  if (!tr.enabled) {
    box.innerHTML = `<div class="tl-head"><b>📋 Trello</b><span class="badge">未连接</span></div>
      <div class="tl-err" style="color:var(--muted)">配置 TRELLO_KEY / TRELLO_TOKEN 后，你的 Trello 卡片会在这里按列表显示。</div>`;
    el.appendChild(box); return;
  }

  const lanes = trelloLanes().filter((p) => !p.is_done_lane && p.open_count > 0);
  box.innerHTML = `<div class="tl-head">
      <b>📋 未完成合计 ${tr.total} 项</b>
      <span class="badge">来自 Trello · 只读</span>
    </div>`;
  const wrap = document.createElement('div'); wrap.className = 'tl-lanes';

  if (!lanes.length) {
    wrap.innerHTML = '<div class="state-box">Trello 里没有未完成的卡片 ✓</div>';
  }
  for (const p of lanes) {
    const lane = document.createElement('div'); lane.className = 'tl-lane';
    const open = localStorage.getItem('mw-lane-' + p.id) === '1';
    lane.innerHTML = `<div class="tl-lane-h" role="button" tabindex="0">
        <span class="tl-caret">${open ? '▾' : '▸'}</span>
        <b>${esc(p.title)}</b>
        <span class="badge">${p.open_count}</span>
        <span class="tl-board">${esc(p.board)}</span>
      </div>
      <div class="tl-cards" ${open ? '' : 'hidden'}>${p.tasks.filter((t) => t.status !== 'done').map((t, i) => `
        <div class="tl-card" data-i="${i}">
          <div class="tl-card-top">
            <span class="tl-dot ${t.due && t.due < today ? 'over' : ''}"></span>
            <span class="tl-name">${esc(t.title)}</span>
            ${t.due ? `<span class="badge ${t.due < today ? 'due-over' : ''}">${fmtMd(t.due)}</span>` : ''}
            ${(t.labels || []).slice(0, 3).map((l) => `<span class="badge lbl">${esc(l)}</span>`).join('')}
            ${t.body ? '<span class="tl-more">说明 ▾</span>' : ''}
            <a class="tl-open" href="${esc(t.url)}" target="_blank" rel="noopener" title="在 Trello 打开">↗</a>
          </div>
          ${t.body ? `<div class="tl-desc" hidden>${md(t.body)}</div>` : ''}
        </div>`).join('')}</div>`;
    // 点标题行展开说明；↗ 才跳 Trello
    $$('.tl-card', lane).forEach((card) => {
      const desc = $('.tl-desc', card), more = $('.tl-more', card);
      if (!desc) return;
      $('.tl-card-top', card).onclick = (e) => {
        if (e.target.closest('.tl-open')) return;
        desc.hidden = !desc.hidden;
        more.textContent = desc.hidden ? '说明 ▾' : '收起 ▴';
        card.classList.toggle('open', !desc.hidden);
      };
    });
    const h = $('.tl-lane-h', lane), body = $('.tl-cards', lane);
    const toggle = () => {
      body.hidden = !body.hidden;
      $('.tl-caret', lane).textContent = body.hidden ? '▸' : '▾';
      try { localStorage.setItem('mw-lane-' + p.id, body.hidden ? '0' : '1'); } catch { }
    };
    h.onclick = toggle;
    h.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    wrap.appendChild(lane);
  }
  box.appendChild(wrap);
  el.appendChild(box);
}

// 收件箱：每天真正要做的事（Trello Inbox，不在任何看板上）
function renderInbox(el) {
  const inbox = S.data?.trello?.inbox;
  if (!inbox?.cards?.length) return;
  const box = document.createElement('section'); box.className = 'inbox';
  const over = inbox.cards.filter((c) => c.overdue).length;
  box.innerHTML = `<div class="ib-head"><b>📥 收件箱</b>
      <span class="badge">${inbox.cards.length} 项</span>
      ${over ? `<span class="badge st-critical">⚠️ ${over} 项逾期</span>` : ''}
      <a class="ib-link" href="https://trello.com/my/inbox" target="_blank" rel="noopener">在 Trello 打开 ↗</a></div>`;
  const list = document.createElement('div'); list.className = 'ib-list';
  inbox.cards.forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'ib-row' + (c.overdue ? ' over' : '');
    row.innerHTML = `<div class="ib-top">
        <span class="ib-i">${i + 1}</span>
        <span class="ib-name">${esc(c.title)}</span>
        ${c.due ? `<span class="badge ${c.overdue ? 'st-critical' : ''}">${c.overdue ? '⚠️ 逾期 ' : ''}${fmtMd(c.due)}</span>` : ''}
        ${c.body ? '<span class="tl-more">说明 ▾</span>' : ''}
        <a class="tl-open" href="${esc(c.url)}" target="_blank" rel="noopener" title="在 Trello 打开">↗</a>
      </div>${c.body ? `<div class="tl-desc" hidden>${md(c.body)}</div>` : ''}`;
    const d = $('.tl-desc', row), more = $('.tl-more', row);
    if (d) $('.ib-top', row).onclick = (e) => {
      if (e.target.closest('.tl-open')) return;
      d.hidden = !d.hidden; more.textContent = d.hidden ? '说明 ▾' : '收起 ▴';
      row.classList.toggle('open', !d.hidden);
    };
    list.appendChild(row);
  });
  box.appendChild(list); el.appendChild(box);
}

// 数字条：四个一眼可读的量，不用图表
function renderStats(el) {
  const tr = S.data?.trello; if (!tr?.enabled) return;
  const today = todayStr();
  const lanes = trelloLanes().filter((p) => !p.is_done_lane);
  const inboxOver = (tr.inbox?.cards || []).filter((c) => c.overdue).length;
  const ms = lanes.flatMap((p) => p.tasks.filter((t) => t.status !== 'done' && t.milestone));
  const in30 = ms.filter((t) => t.milestone >= today && t.milestone <= addDays(today, 30)).length;
  const stale = lanes.filter((p) => p.open_count > 0 && p.last_activity
    && (Date.now() - Date.parse(p.last_activity)) / 864e5 > 60).length;

  const tiles = [
    { n: tr.inbox?.count ?? 0, label: '收件箱待办', sub: inboxOver ? `⚠️ ${inboxOver} 项逾期` : '无逾期', bad: inboxOver > 0 },
    { n: tr.total, label: '未完成合计', sub: `${lanes.length} 条线` },
    { n: in30, label: '30 天内节点', sub: ms.length ? `共 ${ms.length} 个节点` : '暂无' },
    { n: stale, label: '停滞的线', sub: stale ? '⚠️ 超 60 天无动静' : '都在动', warn: stale > 0 },
  ];
  const box = document.createElement('div'); box.className = 'stats';
  box.innerHTML = tiles.map((t) => `<div class="stat${t.bad ? ' bad' : t.warn ? ' warn' : ''}">
      <div class="stat-n">${t.n}</div><div class="stat-l">${t.label}</div>
      <div class="stat-s">${esc(t.sub)}</div></div>`).join('');
  el.appendChild(box);
}

// 各线负载：单序列水平条形图（长度表大小，单一色相，直接标数）
function renderLoadChart(el) {
  const lanes = trelloLanes().filter((p) => !p.is_done_lane && p.open_count > 0)
    .sort((a, b) => b.open_count - a.open_count);
  if (lanes.length < 2) return;
  const max = lanes[0].open_count;
  const box = document.createElement('section'); box.className = 'chart';
  box.innerHTML = `<div class="ch-head"><b>📊 各线未完成</b>
      <span class="badge">共 ${lanes.reduce((n, p) => n + p.open_count, 0)} 项</span></div>`;
  const body = document.createElement('div'); body.className = 'ch-body';
  body.innerHTML = lanes.map((p) => {
    const idle = p.last_activity ? Math.round((Date.now() - Date.parse(p.last_activity)) / 864e5) : null;
    const stale = idle !== null && idle > 60;
    return `<div class="ch-row" title="${esc(p.title)}：${p.open_count} 项未完成${idle !== null ? `，${idle} 天前有动静` : ''}">
      <span class="ch-label">${esc(p.title)}</span>
      <span class="ch-track"><span class="ch-bar" style="width:${Math.max(3, (p.open_count / max) * 100)}%"></span></span>
      <span class="ch-val">${p.open_count}</span>
      ${stale ? `<span class="ch-flag" title="超 60 天无动静">⚠️ ${idle}天</span>` : '<span class="ch-flag"></span>'}
    </div>`;
  }).join('');
  box.appendChild(body);
  el.appendChild(box);
}

function renderToday(el) {
  el.innerHTML = '';
  const pr = document.createElement('div');
  pr.className = 'push-row'; pr.id = 'push-row'; pr.hidden = true;
  el.appendChild(pr);
  renderPushRow();
  renderStats(el);       // 一眼看量
  renderInbox(el);       // 今天真正要做的
  renderLoadChart(el);   // 各线负载
  renderMilestones(el);  // 近期节点
}

// ---------- 日程：按月分组的发售/节点日历 ----------
// 原来是按天的甘特图，但节点跨度长达一年多、且多数卡片没有日期，
// 按天铺开几乎全是空白。按月分组才是这批数据的正确尺度。
function renderCalendar(el) {
  el.innerHTML = '';
  const today = todayStr();
  const curMonth = today.slice(0, 7);
  const items = trelloLanes().filter((p) => !p.is_done_lane)
    .flatMap((p) => p.tasks.filter((t) => t.status !== 'done' && t.milestone)
      .map((t) => ({ ...t, _lane: p.title, _board: p.board })))
    .sort((a, b) => a.milestone.localeCompare(b.milestone));

  const undated = trelloLanes().filter((p) => !p.is_done_lane)
    .flatMap((p) => p.tasks.filter((t) => t.status !== 'done' && !t.milestone)
      .map((t) => ({ ...t, _lane: p.title })));

  if (!items.length) {
    el.innerHTML = '<div class="state-box">还没有带日期的事项。<br>在 Trello 给卡片设 due，或把发售日写进标题（如「（2026年10月27日発売）」），这里就会出现。</div>';
    return;
  }

  // 月份密度条
  const byMonth = new Map();
  for (const it of items) {
    const m = it.milestone.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(it);
  }
  const strip = document.createElement('div'); strip.className = 'cal-strip';
  strip.innerHTML = [...byMonth].map(([m, arr]) => {
    const past = m < curMonth;
    return `<a class="cal-chip${m === curMonth ? ' now' : ''}${past ? ' past' : ''}" href="#m-${m}">
      <span class="cal-chip-m">${+m.slice(5)}月</span>
      <span class="cal-chip-y">${m.slice(0, 4)}</span>
      <span class="cal-dots">${'●'.repeat(Math.min(arr.length, 5))}</span>
      <span class="cal-chip-n">${arr.length}</span></a>`;
  }).join('');
  el.appendChild(strip);

  for (const [m, arr] of byMonth) {
    const sec = document.createElement('section'); sec.className = 'cal-mo'; sec.id = `m-${m}`;
    const label = `${m.slice(0, 4)}年${+m.slice(5)}月`;
    sec.innerHTML = `<div class="cal-mo-h">
        <b>${label}</b>${m === curMonth ? '<span class="badge soon">本月</span>' : ''}
        <span class="badge">${arr.length} 项</span></div>`;
    const list = document.createElement('div'); list.className = 'cal-rows';
    list.innerHTML = arr.map((t) => {
      const dd = diffDays(today, t.milestone);
      const rel = dd === 0 ? '今天' : dd > 0 ? `${dd} 天后` : `${-dd} 天前`;
      return `<a class="cal-row" href="${esc(t.url)}" target="_blank" rel="noopener">
        <span class="cal-d">${+t.milestone.slice(8)}<small>日</small></span>
        <span class="cal-t">${esc(t.title)}</span>
        <span class="badge">${esc(t._lane)}</span>
        <span class="cal-rel${dd < 0 ? ' past' : dd <= 14 ? ' soon' : ''}">${rel}</span>
      </a>`;
    }).join('');
    sec.appendChild(list);
    el.appendChild(sec);
  }

  if (undated.length) {
    const sec = document.createElement('section'); sec.className = 'cal-mo undated';
    sec.innerHTML = `<div class="cal-mo-h"><b>未定日期</b><span class="badge">${undated.length} 项</span>
      <span class="cal-note">在 Trello 设 due 或把日期写进标题即可排进上面</span></div>`;
    const list = document.createElement('div'); list.className = 'cal-rows';
    list.innerHTML = undated.map((t) => `<a class="cal-row" href="${esc(t.url)}" target="_blank" rel="noopener">
        <span class="cal-d dash">—</span><span class="cal-t">${esc(t.title)}</span>
        <span class="badge">${esc(t._lane)}</span></a>`).join('');
    sec.appendChild(list);
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
    box.innerHTML = `<div class="rv-h"><b>${title}</b><span class="badge">${rows.length}</span>
        ${sub ? `<span class="rv-sub">${esc(sub)}</span>` : ''}</div>
      <div class="rv-body">${rows.length ? rows.join('') : `<div class="rv-empty">${empty}</div>`}</div>`;
    el.appendChild(box);
  };

  const head = document.createElement('div'); head.className = 'rv-title';
  head.innerHTML = `<h2>本周检视</h2><span class="rv-date">${today}</span>`;
  el.appendChild(head);

  sec('✅ 本周动过', '最近 7 天有活动', moved.map(({ p, d }) =>
    `<div class="rv-row"><span class="rv-name">${esc(p.title)}</span>
      <span class="badge">${p.open_count} 项未完成</span>
      <span class="rv-when">${d === 0 ? '今天' : `${d} 天前`}</span></div>`),
  '本周没有任何一条线有动静 —— 值得警惕');

  sec('⚠️ 停滞', '超 60 天无动静且仍有未完成', stalled.map(({ p, d }) =>
    `<div class="rv-row bad"><span class="rv-name">${esc(p.title)}</span>
      <span class="badge">${p.open_count} 项未完成</span>
      <span class="rv-when bad">${d} 天前</span></div>`),
  '没有停滞的线 ✓', 'warn');

  sec('📌 未来两周节点', '', next14.map((t) => {
    const dd = diffDays(today, t.milestone);
    return `<a class="rv-row" href="${esc(t.url)}" target="_blank" rel="noopener">
      <span class="rv-name">${esc(t.title)}</span>
      <span class="badge">${esc(t._lane)}</span>
      <span class="rv-when soon">${fmtMd(t.milestone)} · ${dd === 0 ? '今天' : `${dd} 天后`}</span></a>`;
  }), '未来两周没有节点');

  sec('📥 收件箱积压', '超 14 天没碰过', inboxOld.map((c) =>
    `<a class="rv-row" href="${esc(c.url)}" target="_blank" rel="noopener">
      <span class="rv-name">${esc(c.title)}</span>
      <span class="rv-when">${days(c.last_activity)} 天前</span></a>`),
  '收件箱都是新鲜的 ✓');
}

// ---------- Projects view ----------
function renderProjects(el) {
  el.innerHTML = '';
  const today = todayStr();
  const lanes = trelloLanes();
  const own = S.data.projects.filter((p) => p.source !== 'trello');

  if (!lanes.length) {
    el.innerHTML = '<div class="state-box">Trello 未连接或没有卡片</div>';
  }

  // 按看板分组，每条列表一张卡
  const byBoard = new Map();
  for (const p of lanes) {
    if (!byBoard.has(p.board)) byBoard.set(p.board, []);
    byBoard.get(p.board).push(p);
  }
  for (const [board, ps] of byBoard) {
    const h = document.createElement('div'); h.className = 'section-h';
    const total = ps.reduce((n, x) => n + x.open_count, 0);
    h.innerHTML = `<h3>${esc(board)}</h3><span class="count">${total} 项未完成</span>`;
    el.appendChild(h);

    const grid = document.createElement('div'); grid.className = 'pj-grid';
    for (const p of ps.filter((x) => !x.is_done_lane)) {
      const idle = p.last_activity
        ? Math.round((Date.now() - Date.parse(p.last_activity)) / 864e5) : null;
      const ms = p.next_milestone;
      const dd = ms ? diffDays(today, ms) : null;
      // 停滞判定：60 天没动静且还有未完成
      const stale = idle !== null && idle > 60 && p.open_count > 0;
      const card = document.createElement('div');
      card.className = 'pj-card' + (stale ? ' stale' : '') + (p.open_count === 0 ? ' empty' : '');
      card.innerHTML = `
        <div class="pj-top"><h3>${esc(p.title)}</h3>
          <span class="pj-n ${p.open_count ? '' : 'zero'}">${p.open_count}</span></div>
        <div class="pj-meta">
          ${ms ? `<span class="badge ${dd < 0 ? 'due-over' : dd <= 14 ? 'ok' : ''}">下一节点 ${fmtMd(ms)}${dd >= 0 ? ` · ${dd} 天后` : ` · 逾期 ${-dd} 天`}</span>` : '<span class="badge">无节点日期</span>'}
          ${idle !== null ? `<span class="badge ${stale ? 'warn' : ''}">${idle} 天前有动静</span>` : ''}
        </div>
        <ol class="pj-list">${p.tasks.filter((t) => t.status !== 'done')
          .map((t) => {
            const d = t.milestone ? diffDays(today, t.milestone) : null;
            return `<li class="pj-item"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a>${
              t.milestone ? `<span class="badge ${d < 0 ? 'st-critical' : d <= 30 ? 'soon' : ''}">${fmtMd(t.milestone)}</span>` : ''}</li>`;
          }).join('')
          || '<li class="pj-item none">全部完成 ✓</li>'}
        </ol>
        <a class="pj-open" href="${esc(p.url)}" target="_blank" rel="noopener">在 Trello 打开 ↗</a>`;
      grid.appendChild(card);
    }
    el.appendChild(grid);
  }

  // MeWork 自有项目：只作为附件容器
  const withArt = own.filter((p) => p.artifacts.length);
  if (withArt.length) {
    const h = document.createElement('div'); h.className = 'section-h';
    h.innerHTML = '<h3>📎 附件</h3><span class="count">存放在 MeWork，不含任务</span>';
    el.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'pj-grid';
    for (const p of withArt) {
      const card = document.createElement('div'); card.className = 'pj-card';
      card.innerHTML = `<div class="pj-top"><h3>${esc(p.title)}</h3><span class="pj-n">${p.artifacts.length}</span></div>
        <div class="pj-list">${p.artifacts.map((a) => `<div class="pj-item">📄 <a href="/api/files/${encodeURIComponent(a.path)}" target="_blank">${esc(a.label)}</a></div>`).join('')}</div>`;
      grid.appendChild(card);
    }
    el.appendChild(grid);
  }
}

// ---------- Drawer ----------
const FSEL = { title: '#d-title', status: '#d-status', priority: '#d-pri', start: '#d-start', due: '#d-due', type: '#d-type' };
const FIELDS = [['title', '标题'], ['status', '状态'], ['priority', '优先级'], ['start', '开始'], ['due', '截止'], ['type', '类型']];
function collectForm() {
  const o = {};
  for (const k of Object.keys(FSEL)) o[k] = $(FSEL[k]).value;
  o.body = $('#d-body').value;
  return o;
}
function applyForm(v) {
  for (const k of Object.keys(FSEL)) if (v[k] !== undefined) $(FSEL[k]).value = v[k] || '';
  if (v.body !== undefined) $('#d-body').value = v.body || '';
}
function findTask(tid, pid) {
  const p = S.data.projects.find((x) => x.id === pid);
  return p && p.tasks.find((t) => t.id === tid);
}
function openDrawer(tid, pid) {
  const t = findTask(tid, pid);
  if (!t) return;
  const p = S.data.projects.find((x) => x.id === pid);
  const dr = $('#drawer'), mask = $('#drawer-mask');
  dr.hidden = mask.hidden = false;
  const arts = p.artifacts.filter((a) => a.task_id === t.id);
  dr.innerHTML = `
    <button class="d-close" aria-label="关闭">✕</button>
    <h2>任务详情</h2>
    <div class="meta-proj">${esc(p.title)} · ${t.id} · rev ${t.revision.slice(0, 8)}</div>
    <div id="d-conflict"></div>
    <label style="font-size:12px;color:var(--muted)">标题<input type="text" id="d-title" value="${esc(t.title)}"></label>
    <div class="f-grid" style="margin-top:10px">
      <label>状态<select id="d-status">${['todo', 'doing', 'blocked', 'done'].map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>优先级<select id="d-pri">${['p0', 'p1', 'p2', 'p3'].map((s) => `<option ${s === t.priority ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>开始 start<input type="date" id="d-start" value="${t.start || ''}"></label>
      <label>截止 due<input type="date" id="d-due" value="${t.due || ''}"></label>
      <label>类型<select id="d-type">${['work', 'research', 'digest', 'chore', 'plan'].map((s) => `<option ${s === t.type ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>完成于<input type="text" value="${t.completed_at || '—'}" disabled></label>
    </div>
    <label style="font-size:12px;color:var(--muted)">备注 notes<textarea id="d-body">${esc(t.body || '')}</textarea></label>
    <h3 style="margin:14px 0 6px;font-size:14px">📎 附件 <span style="color:var(--muted);font-weight:400">(${arts.length})</span></h3>
    <div class="alist">${arts.map((a) => `
      <div class="arow" data-aid="${a.id}"><span>${a.kind === 'script' ? '⚙️' : '📄'}</span>
      <a href="/api/files/${encodeURIComponent(a.path)}" target="_blank">${esc(a.label)}</a>
      <button class="btn ghost a-unlink" style="min-height:30px;padding:4px 10px">移除</button></div>`).join('') || '<div style="color:var(--muted);font-size:13px">暂无附件</div>'}
    </div>
    <input type="file" id="d-file" hidden>
    <div class="d-actions">
      <button class="btn" id="d-save">保存</button>
      <button class="btn ghost" id="d-upload">上传附件</button>
    </div>`;
  $('.d-close', dr).onclick = closeDrawer;
  mask.onclick = closeDrawer;
  dr.onkeydown = (e) => { if (e.key === 'Escape') closeDrawer(); };

  $('#d-save').onclick = () => saveWith(findTask(tid, pid), collectForm());

  async function saveWith(baseline, proposed) {
    const changes = {};
    for (const k of Object.keys(FSEL)) if ((baseline[k] || '') !== (proposed[k] || '')) changes[k] = proposed[k];
    const bodyChanged = (proposed.body || '').trim() !== (baseline.body || '').trim();
    if (!Object.keys(changes).length && !bodyChanged) return closeDrawer();
    try {
      const payload = { operation_id: opid(), project_id: pid, expected_revision: baseline.revision, changes };
      if (bodyChanged) payload.body = proposed.body;
      const r = await api('PATCH', `/api/tasks/${tid}`, payload);
      upsertTask(r.record, r.revision); closeDrawer(); render(); toast('已保存并写回 ✓');
    } catch (e) {
      if (e.status === 409 && e.data && e.data.latest) {
        upsertTask(e.data.latest, e.data.latest.revision);
        showConflict(e.data.latest, proposed);
      } else toast(`保存失败：${e.message}`, true);
    }
  }

  // 三方冲突面板：latest（别处最新）vs proposed（我的），逐字段选择，全部字段保留不丢
  function showConflict(latest, proposed) {
    const rows = [...FIELDS, ['body', '备注']].filter(([k]) => (latest[k] || '') !== (proposed[k] || ''));
    const box = document.createElement('div'); box.className = 'conflict';
    box.innerHTML = `
      <b>⚠️ 冲突：该任务已在别处被修改</b>
      <div style="margin:4px 0 8px">你的改动<b>尚未提交</b>，一个字段都没丢。逐项选择保留哪一版，然后点「解决冲突并保存」。</div>
      <table class="cft"><thead><tr><th>字段</th><th>最新（别处）</th><th>我的（未提交）</th></tr></thead><tbody>
      ${rows.map(([k, label], i) => `<tr>
        <td>${label}</td>
        <td><label><input type="radio" name="cf${i}" value="latest" checked> ${esc(String(latest[k] ?? '') || '（空）').slice(0, 60)}</label></td>
        <td><label><input type="radio" name="cf${i}" value="mine"> ${esc(String(proposed[k] ?? '') || '（空）').slice(0, 60)}</label></td>
      </tr>`).join('')}
      </tbody></table>
      <div class="d-actions">
        <button class="btn" id="cf-save">解决冲突并保存</button>
        <button class="btn ghost" id="cf-mine">全部用我的</button>
        <button class="btn ghost" id="cf-latest">全部用最新</button>
      </div>`;
    const holder = $('#d-conflict'); holder.innerHTML = ''; holder.appendChild(box);
    $('#d-conflict').scrollIntoView({ block: 'nearest' });
    const setAll = (v) => $$(`input[type=radio][value=${v}]`, box).forEach((r) => { r.checked = true; });
    $('#cf-mine', box).onclick = () => setAll('mine');
    $('#cf-latest', box).onclick = () => setAll('latest');
    $('#cf-save', box).onclick = () => {
      const merged = { ...latest };
      rows.forEach(([k], i) => {
        const pick = $(`input[name=cf${i}]:checked`, box).value;
        merged[k] = pick === 'mine' ? proposed[k] : latest[k];
      });
      applyForm(merged);
      holder.innerHTML = '';
      saveWith(findTask(tid, pid), merged);
    };
  }
  $('#d-upload').onclick = () => $('#d-file').click();
  $('#d-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    await uploadFile(f, pid, tid, 'new');
  };
  $$('.a-unlink', dr).forEach((btn) => {
    btn.onclick = async () => {
      const aid = btn.closest('.arow').dataset.aid;
      try {
        await api('POST', `/api/artifacts/unlink?project_id=${pid}&artifact_id=${aid}&operation_id=${opid()}`, {});
        const proj = S.data.projects.find((x) => x.id === pid);
        proj.artifacts = proj.artifacts.filter((a) => a.id !== aid);
        openDrawer(tid, pid); toast('已移除引用（文件保留）');
      } catch (err2) { toast(`移除失败：${err2.message}`, true); }
    };
  });

  async function uploadFile(f, pid2, tid2, mode) {
    const qs = new URLSearchParams({ project_id: pid2, name: f.name, task_id: tid2, mode, operation_id: opid() });
    try {
      const r = await api('PUT', `/api/artifacts?${qs}`, undefined, f);
      const proj = S.data.projects.find((x) => x.id === pid2);
      const i = proj.artifacts.findIndex((a) => a.id === r.record.id);
      if (i >= 0) proj.artifacts[i] = r.record; else proj.artifacts.push(r.record);
      openDrawer(tid2, pid2); toast('附件已上传 ✓');
    } catch (e2) {
      if (e2.status === 409) {
        const choice = prompt(`已存在同名附件「${f.name}」。输入 1=引用现有 2=重命名上传 3=替换内容`, '2');
        if (choice === '2') return uploadFile(f, pid2, tid2, 'rename');
        if (choice === '3') return uploadFile(f, pid2, tid2, 'replace');
        if (choice === '1') {
          const proj = S.data.projects.find((x) => x.id === pid2);
          const ex = proj.artifacts.find((a) => a.path.endsWith('/' + f.name));
          if (ex && !ex.task_id) ex.task_id = tid2;
          toast('已引用现有附件');
          openDrawer(tid2, pid2);
        }
      } else toast(`上传失败：${e2.message}`, true);
    }
  }
}
function closeDrawer() { $('#drawer').hidden = $('#drawer-mask').hidden = true; }

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
  if (S.view === 'projects') renderProjects(el);
}
load();
initPush();
