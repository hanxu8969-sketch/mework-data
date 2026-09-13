// Trello → MeWork 单向投影（只读）。
// Trello 是任务的唯一事实源；MeWork 只做提醒、时间线和阅读，绝不回写。
// 用嵌套资源一次拉全（boards + lists + cards），只花 1 个子请求 —— 免费版每次调用限 50 个。
const API = 'https://api.trello.com/1';

export const EXCLUDED_BOARDS = ['納品情報のお知らせ'];
// 列表名命中即视为「已完成」栏：其中的卡片不计入未完成
const DONE_LIST = /(^|[\s\W])(done|finish(ed)?|complete[d]?|完了|完成|已完成)([\s\W]|$)/i;

const jstDateOf = (iso) => iso
  ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  : null;


/** 卡片说明：剥掉图片 markdown 与 smartCard 后缀，其余原样保留（这些说明里有真内容） */
function cleanDesc(desc) {
  return String(desc || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')              // 图片
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '[$1]($2)') // smartCard-inline 等后缀
    .replace(/\u200c/g, '')                                // Trello 邮件卡常见的零宽字符
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


/**
 * 从卡片标题里抽发售日 —— 用户的日期习惯写在标题（「（2026年10月27日発売）」），
 * 不在 due 字段。不抽出来的话这份客户日程就完全用不上。
 * 支持：2026年10月27日 / 2026/10/27 / 2026-10-27
 */
const JP_DATE = /(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})\s*日?/;
export function parseTitleDate(title) {
  const m = JP_DATE.exec(String(title || ''));
  if (!m) return null;
  const [, y, mo, d] = m;
  const Y = +y, M = +mo, D = +d;
  if (M < 1 || M > 12 || D < 1 || D > 31) return null;
  const iso = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
  // 排除 2月30日 这类不存在的日期
  const dt = new Date(`${iso}T00:00:00Z`);
  return dt.getUTCFullYear() === Y && dt.getUTCMonth() + 1 === M && dt.getUTCDate() === D ? iso : null;
}

export const isDoneList = (name) => DONE_LIST.test(name || '');

async function tget(env, path, params = {}) {
  const qs = new URLSearchParams({ key: env.TRELLO_KEY, token: env.TRELLO_TOKEN, ...params });
  const res = await fetch(`${API}${path}?${qs}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 150);
    const hint = res.status === 401 ? 'TRELLO_KEY/TOKEN 无效或已过期'
      : res.status === 429 ? 'Trello 限流，稍后重试'
        : 'Trello 返回异常';
    throw Object.assign(new Error(`Trello ${res.status} ${path}：${hint}（${body}）`), { code: res.status === 401 ? 401 : 502 });
  }
  return res.json();
}

const CARD_FIELDS = 'name,due,dueComplete,idList,shortUrl,desc,labels,dateLastActivity';

/**
 * 拉全 Trello。
 * ⚠️ /members/me/boards 只能嵌套 lists，**不能同时嵌套 cards**（实测 cards 字段直接缺失），
 * 所以卡片必须按看板单独取。4 个看板 ≈ 5 个子请求，远低于免费版 50 的上限。
 * 另外 Inbox 不在 boards 列表里，单独取。
 */
export async function fetchTrello(env) {
  if (!env.TRELLO_KEY || !env.TRELLO_TOKEN) return null;
  const boards = await tget(env, '/members/me/boards', {
    filter: 'open', fields: 'name,shortUrl', lists: 'open', list_fields: 'name,pos',
  });
  const wanted = (boards || []).filter((b) => !EXCLUDED_BOARDS.includes(b.name));
  await Promise.all(wanted.map(async (b) => {
    b.cards = await tget(env, `/boards/${b.id}/cards`, { filter: 'open', fields: CARD_FIELDS })
      .catch(() => []);
  }));
  return wanted;
}

/** Trello 收件箱 —— 用户的每日 todo 在这里，它不在 boards 列表中 */
export async function fetchInbox(env) {
  if (!env.TRELLO_KEY || !env.TRELLO_TOKEN) return null;
  // 收件箱是账号级的特殊看板，board id 存在 member 的 prefs 里
  const me = await tget(env, '/members/me', { fields: 'id,prefs' }).catch(() => null);
  const inboxId = me?.prefs?.idBoardInbox || me?.prefs?.inbox?.boardId || null;
  if (!inboxId) return null;
  const [lists, cards] = await Promise.all([
    tget(env, `/boards/${inboxId}/lists`, { filter: 'open', fields: 'name,pos' }).catch(() => []),
    tget(env, `/boards/${inboxId}/cards`, { filter: 'open', fields: CARD_FIELDS }).catch(() => []),
  ]);
  return { id: inboxId, name: '收件箱', shortUrl: 'https://trello.com/my/inbox', lists, cards };
}

/**
 * board/list/card → MeWork 的 project/task 形状。
 * list = 项目（Timeline 泳道）；card = 只读任务。
 * 未完成 = 不在「已完成」栏 且 dueComplete 不为 true。
 * 有 due 的卡片才能上 Timeline；其余照常出现在列表和计数里。
 */
export function projectTrello(boards, today) {
  const projects = [];
  for (const b of boards || []) {
    if (EXCLUDED_BOARDS.includes(b.name)) continue;
    const lists = new Map((b.lists || []).map((l) => [l.id, l]));
    const grouped = new Map();
    for (const c of b.cards || []) {
      if (!grouped.get(c.idList)) grouped.set(c.idList, []);
      grouped.get(c.idList).push(c);
    }
    for (const [listId, list] of lists) {
      const cards = grouped.get(listId) || [];
      if (!cards.length) continue;
      const doneLane = isDoneList(list.name);
      const tasks = cards.map((c) => {
        const due = jstDateOf(c.due);
        const titleDate = parseTitleDate(c.name);
        // 节点日：due 优先，其次标题里写的发售日
        const milestone = due || titleDate;
        const done = doneLane || c.dueComplete === true;
        return {
          id: `trello_${c.id}`,
          project_id: `trello_${listId}`,
          title: c.name,
          type: 'work',
          status: done ? 'done' : 'todo',
          priority: !done && due && due < today ? 'p0' : !done && due === today ? 'p1' : 'p2',
          start: due,
          due,
          milestone,
          milestone_source: due ? 'due' : (titleDate ? 'title' : null),
          completed_at: null,
          body: cleanDesc(c.desc),
          labels: (c.labels || []).map((l) => l.name || l.color).filter(Boolean),
          url: c.shortUrl,
          last_activity: c.dateLastActivity || null,
          source: 'trello',
          read_only: true,
        };
      }).sort((a, b2) =>
        (a.status === 'done') - (b2.status === 'done')
        || String(a.milestone || '9999').localeCompare(String(b2.milestone || '9999'))
        || String(b2.last_activity || '').localeCompare(String(a.last_activity || '')));

      projects.push({
        id: `trello_${listId}`,
        title: list.name,
        board: b.name,
        type: 'trello',
        status: 'active',
        priority: 'p2',
        source: 'trello',
        read_only: true,
        is_done_lane: doneLane,
        url: b.shortUrl,
        body: `Trello · ${b.name}`,
        open_count: tasks.filter((t) => t.status !== 'done').length,
        next_milestone: tasks.filter((t) => t.status !== 'done' && t.milestone)
          .map((t) => t.milestone).sort()[0] || null,
        last_activity: tasks.map((t) => t.last_activity).filter(Boolean).sort().reverse()[0] || null,
        tasks,
        artifacts: [],
      });
    }
  }
  // 未完成多的列排前；已完成栏沉底
  return projects.sort((a, b) =>
    a.is_done_lane - b.is_done_lane
    || b.open_count - a.open_count
    || a.board.localeCompare(b.board)
    || a.title.localeCompare(b.title));
}

/** 推送与首页用的汇总：各列表未完成数 */
export function summarize(projects) {
  const lanes = projects.filter((p) => !p.is_done_lane && p.open_count > 0);
  return {
    total: lanes.reduce((n, p) => n + p.open_count, 0),
    lanes: lanes.map((p) => ({ title: p.title, board: p.board, count: p.open_count })),
  };
}

/* ── Obsidian 导出 ────────────────────────────────────────────────
   把 Trello 投影写成 markdown 落进仓库，经 git 同步进 Obsidian。
   一个列表一个文件（在 Obsidian 里就是一条客户线的项目笔记），外加一份索引。
   只写未完成项 —— 已完成的留在 Trello，不占笔记空间。                */

const fm = (o) => '---\n' + Object.entries(o)
  .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v === null ? 'null' : v}`)
  .join('\n') + '\n---\n\n';

const slug = (s) => String(s).replace(/[\/\\:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** 单条列表 → markdown */
export function renderLaneMarkdown(p, today) {
  const open = p.tasks.filter((t) => t.status !== 'done');
  const done = p.tasks.filter((t) => t.status === 'done');
  const out = [fm({
    title: p.title,
    board: p.board,
    source: 'trello',
    open_count: p.open_count,
    next_milestone: p.next_milestone || null,
    last_activity: p.last_activity ? p.last_activity.slice(0, 10) : null,
    synced_at: today,
  })];
  out.push(`# ${p.title}`, '', `> Trello · ${p.board} — [在 Trello 打开](${p.url})`,
    '> 本文件由 MeWork 从 Trello 自动生成，**改这里不会回写 Trello**。', '');

  if (!open.length) out.push('_没有未完成的卡片。_', '');
  for (const t of open) {
    out.push(`## ${t.title}`);
    const meta = [];
    if (t.milestone) meta.push(`节点 **${t.milestone}**${t.milestone_source === 'title' ? '（取自标题）' : ''}`);
    if (t.labels?.length) meta.push(`标签 ${t.labels.join(' / ')}`);
    if (t.last_activity) meta.push(`最后活动 ${t.last_activity.slice(0, 10)}`);
    meta.push(`[卡片](${t.url})`);
    out.push(meta.join(' · '), '');
    if (t.body) out.push(t.body, '');
  }
  if (done.length) out.push('---', '', `_已完成 ${done.length} 项（略）_`, '');
  return out.join('\n');
}

/** 索引页 */
export function renderIndexMarkdown(projects, today) {
  const lanes = projects.filter((p) => !p.is_done_lane);
  const total = lanes.reduce((n, p) => n + p.open_count, 0);
  const out = [fm({ title: 'Trello 总览', source: 'trello', open_total: total, synced_at: today })];
  out.push('# Trello 总览', '', `未完成合计 **${total}** 项 · 同步于 ${today}`, '');

  const ms = lanes.flatMap((p) => p.tasks
    .filter((t) => t.status !== 'done' && t.milestone)
    .map((t) => ({ ...t, lane: p.title })))
    .sort((a, b) => a.milestone.localeCompare(b.milestone));
  if (ms.length) {
    out.push('## 近期节点', '', '| 日期 | 事项 | 线 |', '|---|---|---|',
      ...ms.map((t) => `| ${t.milestone} | [${t.title.replace(/\|/g, '\\|')}](${t.url}) | ${t.lane} |`), '');
  }

  const byBoard = new Map();
  for (const p of lanes) {
    if (!byBoard.has(p.board)) byBoard.set(p.board, []);
    byBoard.get(p.board).push(p);
  }
  for (const [board, ps] of byBoard) {
    out.push(`## ${board}`, '');
    for (const p of ps) {
      const idle = p.last_activity ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(p.last_activity)) / 864e5) : null;
      const flags = [];
      if (p.next_milestone) flags.push(`下一节点 ${p.next_milestone}`);
      if (idle !== null && idle > 60 && p.open_count > 0) flags.push(`⚠️ ${idle} 天无动静`);
      out.push(`- [[Trello/${slug(p.title)}|${p.title}]] — ${p.open_count} 项${flags.length ? `（${flags.join('，')}）` : ''}`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** 写入 store：content/trello/ 下一列表一文件 + 索引 */
export async function exportTrelloToStore(store, projects, today) {
  const written = [];
  const put = async (rel, body) => {
    const cur = await store.read(rel).catch(() => null);
    const text = typeof cur?.text === 'string' ? cur.text : cur ? new TextDecoder().decode(cur.content) : null;
    if (text === body) return; // 内容没变就不写，避免每次同步都产生提交
    await store.write(rel, body, cur ? cur.revision : null);
    written.push(rel);
  };
  await put('content/trello/_index.md', renderIndexMarkdown(projects, today));
  for (const p of projects.filter((x) => !x.is_done_lane)) {
    await put(`content/trello/${slug(p.title)}.md`, renderLaneMarkdown(p, today));
  }
  return { written: written.length, files: written };
}
