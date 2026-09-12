// MeWork SPA
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const S = { data: null, view: 'today', tlStart: null, tlDays: 0, collapsed: new Set(), error: null, loading: true };

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
  api('GET', '/api/briefing').then((b) => { S.briefing = b; if (S.view === 'today') render(); }).catch(() => { });
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

function renderBriefingPanel(el) {
  const b = S.briefing;
  const box = document.createElement('section'); box.className = 'brief';
  if (!b) { box.innerHTML = '<div class="brief-head"><b>📰 今日简报</b><span class="badge">加载中…</span></div>'; el.appendChild(box); return; }
  if (b.missing) {
    box.innerHTML = `<div class="brief-head"><b>📰 今日简报</b><span class="badge">${esc(b.date)} 尚未生成</span></div>
      <div class="brief-body"><p style="color:var(--muted)">每天 07:00（JST）自动送达：游戏市场 report、AI 市场 report、今天的待办提醒。</p></div>`;
    el.appendChild(box); return;
  }
  const open = localStorage.getItem('mw-brief-open') !== '0';
  box.innerHTML = `<div class="brief-head" role="button" tabindex="0">
      <b>📰 今日简报</b>
      <span class="badge">${esc(b.date)}</span>
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
      <div class="tl-cards" ${open ? '' : 'hidden'}>${p.tasks.filter((t) => t.status !== 'done').map((t) => `
        <a class="tl-card" href="${esc(t.url)}" target="_blank" rel="noopener">
          <span class="tl-dot ${t.due && t.due < today ? 'over' : ''}"></span>
          <span class="tl-name">${esc(t.title)}</span>
          ${t.due ? `<span class="badge ${t.due < today ? 'due-over' : ''}">${fmtMd(t.due)}</span>` : ''}
          ${(t.labels || []).slice(0, 2).map((l) => `<span class="badge">${esc(l)}</span>`).join('')}
        </a>`).join('')}</div>`;
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

function renderToday(el) {
  el.innerHTML = '';
  const today = todayStr(), wend = weekEnd();
  const pr = document.createElement('div');
  pr.className = 'push-row'; pr.id = 'push-row'; pr.hidden = true;
  el.appendChild(pr);
  renderPushRow();
  // 顺序即优先级：先要做的事（Trello），再阅读材料（简报）
  renderTrelloSection(el);
  renderBriefingPanel(el);
  // quick create
  const qc = document.createElement('div'); qc.className = 'quick';
  qc.innerHTML = `
    <input type="text" id="qc-title" placeholder="快速创建：只需输入标题，回车即建（默认今天到期）" aria-label="新任务标题">
    <select id="qc-proj" aria-label="所属项目">${ownProjects().map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
    <button class="btn" id="qc-go">＋ 创建</button>`;
  el.appendChild(qc);
  const create = async () => {
    const title = $('#qc-title').value.trim();
    if (!title) return;
    $('#qc-go').disabled = true;
    try {
      const r = await api('POST', '/api/tasks', { operation_id: opid(), task: { project_id: $('#qc-proj').value, title, due: today } });
      upsertTask(r.record, r.revision); $('#qc-title').value = ''; render(); toast('已创建并写回 ✓');
    } catch (e) { toast(`创建失败：${e.message}`, true); }
    finally { $('#qc-go').disabled = false; }
  };
  $('#qc-go', qc).onclick = create;
  $('#qc-title', qc).onkeydown = (e) => { if (e.key === 'Enter') create(); };

  // project one-line progress
  const strip = document.createElement('div'); strip.className = 'pstrip';
  for (const p of ownProjects()) {
    const open = p.tasks.filter((t) => t.status !== 'done');
    const doing = open.filter((t) => t.status === 'doing').length;
    const over = open.filter((t) => t.due && t.due < today).length;
    const card = document.createElement('div'); card.className = 'pcard';
    card.innerHTML = `<h4>${esc(p.title)}</h4><div class="pline">${open.length} 项未完成 · ${doing} 进行中${over ? ` · <b style="color:var(--red)">${over} 逾期</b>` : ''}</div>`;
    card.onclick = () => switchView('timeline');
    strip.appendChild(card);
  }
  el.appendChild(strip);

  // Trello 卡片有自己的区块，这里只列 MeWork 自身的任务，避免同一条出现两次
  const ts = allTasks().filter((t) => t._project.status === 'active' && t._project.source !== 'trello');
  const overdue = sortTasks(ts.filter((t) => t.status !== 'done' && t.due && t.due < today));
  const todays = sortTasks(ts.filter((t) => t.due === today && t.status !== 'done'));
  const week = sortTasks(ts.filter((t) => t.status !== 'done' && t.due && t.due > today && t.due <= wend));
  const doneToday = ts.filter((t) => t.status === 'done' && (t.completed_at || '').slice(0, 10) === today);

  const sec = (title, arr, empty) => {
    const h = document.createElement('div'); h.className = 'section-h';
    h.innerHTML = `<h3>${title}</h3><span class="count">${arr.length}</span>`;
    el.appendChild(h);
    const list = document.createElement('div'); list.className = 'tlist';
    if (!arr.length) list.innerHTML = `<div class="state-box">${empty}</div>`;
    else arr.forEach((t) => list.appendChild(taskRow(t)));
    el.appendChild(list);
  };
  sec('🔥 逾期 Overdue', overdue, '没有逾期，干得漂亮');
  sec('📌 今天 Today', todays, '今天暂无到期任务');
  sec(`🗓️ 本周必做（未来 7 天，至 ${fmtMd(wend)}）`, week, '未来 7 天无到期任务');
  if (doneToday.length) sec('✅ 今天已完成', doneToday, '');
}

// ---------- Timeline ----------
function ensureTlRange() {
  if (S.tlStart) return;
  const t = todayStr();
  let min = addDays(t, -7), max = addDays(t, 30);
  for (const x of allTasks()) {
    if (x.start && x.start < min) min = x.start;
    if (x.due && x.due > max) max = x.due;
  }
  S.tlStart = min; S.tlDays = diffDays(min, max) + 7;
}
const COL = 34, LABEL_W = 170;

function renderTimeline(el) {
  ensureTlRange();
  el.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'tl-wrap';
  const inner = document.createElement('div'); inner.className = 'tl-inner';
  inner.style.width = LABEL_W + S.tlDays * COL + 'px';
  wrap.appendChild(inner);

  // header
  const head = document.createElement('div'); head.className = 'tl-head';
  const corner = document.createElement('div'); corner.className = 'tl-corner';
  corner.style.width = LABEL_W + 'px'; corner.textContent = '项目 / 任务';
  head.appendChild(corner);
  const today = todayStr();
  for (let i = 0; i < S.tlDays; i++) {
    const d = addDays(S.tlStart, i);
    const day = document.createElement('div'); day.className = 'tl-day';
    day.style.width = COL + 'px';
    const dow = new Date(toUTC(d)).getUTCDay();
    if (dow === 0 || dow === 6) day.classList.add('we');
    if (d === today) day.classList.add('today');
    day.textContent = fmtMd(d);
    head.appendChild(day);
  }
  inner.appendChild(head);

  // today line
  const ti = diffDays(S.tlStart, today);
  if (ti >= 0 && ti < S.tlDays) {
    const line = document.createElement('div'); line.className = 'tl-todayline';
    line.style.left = LABEL_W + ti * COL + COL / 2 + 'px';
    inner.appendChild(line);
  }

  // Timeline 只放有日期的东西；Trello 卡片多数没有 due，只有设了 due 的才会出现
  const timelineProjects = activeProjects().filter((p) => p.source !== 'trello' || p.tasks.some((t) => t.due));
  for (const p of timelineProjects) {
    const ph = document.createElement('div'); ph.className = 'tl-proj-h';
    const closed = S.collapsed.has(p.id);
    ph.innerHTML = `<div class="ph-inner"><span>${closed ? '▸' : '▾'}</span> ${esc(p.title)} <span class="count" style="color:var(--muted);font-weight:400">${p.tasks.filter((t) => t.status !== 'done').length} 未完成</span></div>`;
    ph.onclick = () => { closed ? S.collapsed.delete(p.id) : S.collapsed.add(p.id); render(); };
    inner.appendChild(ph);
    if (closed) continue;
    const lanes = sortTasks([...p.tasks.map((t) => ({ ...t, _project: p }))]).filter((t) => !(p.source === 'trello' && !t.due));
    for (const t of lanes) {
      const row = document.createElement('div'); row.className = 'tl-row';
      const lab = document.createElement('div'); lab.className = 'rowlabel';
      lab.style.width = LABEL_W + 'px'; lab.textContent = t.title; lab.title = t.title;
      lab.onclick = () => (t.read_only ? window.open(t.url, '_blank', 'noopener') : openDrawer(t.id, t.project_id));
      row.appendChild(lab);
      row.ondblclick = (e) => {
        if (e.target !== row) return;
        const dayIdx = Math.floor((e.offsetX + (e.target === row ? 0 : LABEL_W) - LABEL_W) / COL);
        quickCreateAt(row, p.id, addDays(S.tlStart, Math.max(0, dayIdx)), e.clientX);
      };
      const start = t.start || t.due, due = t.due || t.start;
      if (start && due) row.appendChild(makeBar(t, start, due));
      inner.appendChild(row);
    }
    // empty lane for creating new tasks in this project
    const emptyRow = document.createElement('div'); emptyRow.className = 'tl-row';
    const el2 = document.createElement('div'); el2.className = 'rowlabel'; el2.style.width = LABEL_W + 'px';
    el2.textContent = '＋ 双击空白日期快速创建'; el2.style.opacity = .6;
    emptyRow.appendChild(el2);
    emptyRow.ondblclick = (e) => {
      const rect = emptyRow.getBoundingClientRect();
      const dayIdx = Math.floor((e.clientX - rect.left + emptyRow.parentElement.parentElement.scrollLeft - LABEL_W) / COL);
      if (dayIdx >= 0) quickCreateAt(emptyRow, p.id, addDays(S.tlStart, dayIdx), e.clientX);
    };
    inner.appendChild(emptyRow);
  }

  const ext = document.createElement('div'); ext.className = 'tl-extend';
  const back = document.createElement('button'); back.className = 'btn ghost'; back.textContent = '← 向前 30 天';
  const fwd = document.createElement('button'); fwd.className = 'btn ghost'; fwd.textContent = '向后 30 天 →';
  back.onclick = () => { S.tlStart = addDays(S.tlStart, -30); S.tlDays += 30; const sl = wrap.scrollLeft; render(); $('.tl-wrap').scrollLeft = sl + 30 * COL; };
  fwd.onclick = () => { S.tlDays += 30; const sl = wrap.scrollLeft; render(); $('.tl-wrap').scrollLeft = sl; };
  el.appendChild(wrap);
  el.appendChild(ext); ext.append(back, fwd);

  // initial scroll to ~today-3
  requestAnimationFrame(() => {
    if (!wrap._scrolled) { wrap.scrollLeft = Math.max(0, (ti - 3) * COL); wrap._scrolled = true; }
  });
}

function makeBar(t, start, due) {
  const bar = document.createElement('div');
  bar.className = 'tl-bar' + (t.status === 'done' ? ' done' : t.status === 'blocked' ? ' blocked' : '') + (t.read_only ? ' ro' : '');
  bar.tabIndex = 0;
  bar.setAttribute('aria-label', `${t.title} ${start} 至 ${due}`);
  const i0 = diffDays(S.tlStart, start), i1 = diffDays(S.tlStart, due);
  bar.style.left = LABEL_W + i0 * COL + 2 + 'px';
  bar.style.width = Math.max(1, i1 - i0 + 1) * COL - 4 + 'px';

  // Trello 卡片只读：不给勾选框、不给缩放手柄、不能拖动，点击回 Trello
  if (t.read_only) {
    bar.innerHTML = `<span>📋 ${esc(t.title)}</span>`;
    bar.title = `${t.title}（Trello · 点击打开）`;
    const open = () => window.open(t.url, '_blank', 'noopener');
    bar.onclick = open;
    bar.onkeydown = (e) => { if (e.key === 'Enter') open(); };
    return bar;
  }

  bar.innerHTML = `<button class="bchk ${t.status === 'done' ? 'on' : ''}" aria-label="完成/重开"></button><span>${esc(t.title)}</span><div class="h l"></div><div class="h r"></div>`;
  $('.bchk', bar).onclick = (e) => { e.stopPropagation(); toggleDone(t); };
  bar.onkeydown = (e) => {
    if (e.key === 'Enter') openDrawer(t.id, t.project_id);
    if (e.key === ' ') { e.preventDefault(); toggleDone(t); }
  };

  // drag = move both; handles resize start/due; preview only, submit on drop, rollback on fail
  let mode = null, x0 = 0, d0 = 0, moved = false, longTimer = null, armed = false;
  const isCoarse = matchMedia('(pointer:coarse)').matches;
  bar.onpointerdown = (e) => {
    mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm';
    x0 = e.clientX; d0 = 0; moved = false; armed = !isCoarse;
    if (isCoarse) longTimer = setTimeout(() => { armed = true; bar.style.opacity = .8; }, 250);
    bar.setPointerCapture(e.pointerId);
  };
  bar.onpointermove = (e) => {
    if (mode === null || !armed) return;
    d0 = Math.round((e.clientX - x0) / COL);
    if (d0 !== 0) moved = true;
    const ni0 = mode === 'r' ? i0 : i0 + d0;
    const ni1 = mode === 'l' ? i1 : i1 + d0;
    if (ni1 < ni0) return; // 范围不可反转
    bar.style.left = LABEL_W + ni0 * COL + 2 + 'px';
    bar.style.width = (ni1 - ni0 + 1) * COL - 4 + 'px';
  };
  bar.onpointerup = async (e) => {
    clearTimeout(longTimer); bar.style.opacity = '';
    const m = mode; mode = null;
    if (!moved) { if (!e.target.classList.contains('bchk')) openDrawer(t.id, t.project_id); return; }
    let ns = start, nd = due;
    if (m !== 'r') ns = addDays(start, d0);
    if (m !== 'l') nd = addDays(due, d0);
    if (m === 'l') ns = addDays(start, d0);
    if (toUTC(nd) < toUTC(ns)) { render(); return; }
    try {
      const r = await api('PATCH', `/api/tasks/${t.id}`, {
        operation_id: opid(), project_id: t.project_id, expected_revision: t.revision,
        changes: { start: ns, due: nd },
      });
      upsertTask(r.record, r.revision); render(); toast(`已改期 ${fmtMd(ns)}–${fmtMd(nd)} ✓`);
    } catch (err2) { render(); handleWriteError(err2); }
  };
  return bar;
}

function quickCreateAt(row, projectId, dateStr, clientX) {
  $$('.tl-qc').forEach((x) => x.remove());
  const box = document.createElement('div'); box.className = 'tl-qc';
  box.style.left = Math.min(clientX, innerWidth - 260) + 'px';
  box.style.top = row.getBoundingClientRect().bottom + scrollY + 4 + 'px';
  box.innerHTML = `<input type="text" placeholder="${dateStr} 新任务标题…" aria-label="新任务标题"><button class="btn">建</button>`;
  document.body.appendChild(box);
  const inp = $('input', box); inp.focus();
  const close = () => { box.remove(); document.removeEventListener('pointerdown', out, true); };
  const out = (e) => { if (!box.contains(e.target)) close(); };
  document.addEventListener('pointerdown', out, true);
  const go = async () => {
    const title = inp.value.trim(); if (!title) return close();
    try {
      const r = await api('POST', '/api/tasks', { operation_id: opid(), task: { project_id: projectId, title, start: dateStr, due: dateStr } });
      upsertTask(r.record, r.revision); close(); render(); toast('已创建 ✓');
    } catch (e) { toast(`创建失败：${e.message}`, true); }
  };
  $('button', box).onclick = go;
  inp.onkeydown = (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') close(); };
}

// ---------- Projects view ----------
function renderProjects(el) {
  el.innerHTML = '';
  const grid = document.createElement('div'); grid.className = 'pj-grid';
  for (const p of S.data.projects) {
    const card = document.createElement('div'); card.className = 'pj-card';
    const open = p.tasks.filter((t) => t.status !== 'done').length;
    card.innerHTML = `<h3>${esc(p.title)}</h3>
      <div class="desc">${esc(p.body || '')}</div>
      <div class="pline"><span class="badge">${p.status}</span> <span class="badge pri-${p.priority}">${(p.priority || '').toUpperCase()}</span>
      <span class="badge">${open} 未完成 / ${p.tasks.length} 总数</span> <span class="badge">📎 ${p.artifacts.length}</span></div>`;
    grid.appendChild(card);
  }
  el.appendChild(grid);
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
  if (S.view === 'today') renderToday(el);
  if (S.view === 'timeline') renderTimeline(el);
  if (S.view === 'projects') renderProjects(el);
}
load();
initPush();
