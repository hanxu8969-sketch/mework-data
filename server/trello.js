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

export const isDoneList = (name) => DONE_LIST.test(name || '');

export async function fetchTrello(env) {
  if (!env.TRELLO_KEY || !env.TRELLO_TOKEN) return null;
  const qs = new URLSearchParams({
    key: env.TRELLO_KEY,
    token: env.TRELLO_TOKEN,
    filter: 'open',
    fields: 'name,shortUrl',
    lists: 'open',
    list_fields: 'name,pos',
    cards: 'open',
    card_fields: 'name,due,dueComplete,idList,shortUrl,desc,labels,dateLastActivity',
  });
  const res = await fetch(`${API}/members/me/boards?${qs}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 150);
    const hint = res.status === 401 ? 'TRELLO_KEY/TOKEN 无效或已过期'
      : res.status === 429 ? 'Trello 限流，稍后重试'
        : 'Trello 返回异常';
    throw Object.assign(new Error(`Trello ${res.status}：${hint}（${body}）`), { code: res.status === 401 ? 401 : 502 });
  }
  return res.json();
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
          completed_at: null,
          body: (c.desc || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim().slice(0, 400),
          labels: (c.labels || []).map((l) => l.name || l.color).filter(Boolean),
          url: c.shortUrl,
          last_activity: c.dateLastActivity || null,
          source: 'trello',
          read_only: true,
        };
      }).sort((a, b2) =>
        (a.status === 'done') - (b2.status === 'done')
        || String(a.due || '9999').localeCompare(String(b2.due || '9999'))
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
