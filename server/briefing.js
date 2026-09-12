// 每日简报：由 Claude 定时代理产出「交给用户看」的报告，不是用户要做的任务。
// 每天 07:00 JST 送达三块：① 游戏市场 report ② AI 市场 report ③ 今天的待办提醒。
import { bootstrap, createTask } from './api.js';
import { parseDoc, serializeDoc } from './doc.js';

export const jstDate = (d = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const addDays = (s, n) => {
  const [y, m, dd] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
export const briefingPath = (date) => `content/briefings/${date}.md`;

const RANK = { p0: 0, p1: 1, p2: 2, p3: 3 };
const rank = (t) => RANK[t.priority] ?? 2;

/** ③ 今日待办提醒：从看板算出来的事实，不需要 AI 生成 */
export async function todayAgenda(store, date = jstDate()) {
  const { projects } = await bootstrap(store);
  const open = projects
    .filter((p) => p.status === 'active')
    .flatMap((p) => p.tasks.filter((t) => t.status !== 'done').map((t) => ({ ...t, _project: p.title })));
  const sort = (a, b) => rank(a) - rank(b) || String(a.due || '9999').localeCompare(String(b.due || '9999'));
  return {
    date,
    overdue: open.filter((t) => t.due && t.due < date).sort(sort),
    today: open.filter((t) => t.due === date).sort(sort),
    week: open.filter((t) => t.due && t.due > date && t.due <= addDays(date, 7)).sort(sort),
    blocked: open.filter((t) => t.status === 'blocked'),
  };
}

export function renderAgenda(a) {
  const line = (t) => `- **${t.priority.toUpperCase()}** ${t.title} — ${t._project}${t.due ? ` · due ${t.due}` : ''}${t.status === 'blocked' ? ' · ⚠️卡住' : ''}`;
  const sec = (title, arr, empty) => [`### ${title}（${arr.length}）`, ...(arr.length ? arr.map(line) : [empty]), ''];
  return [
    ...sec('🔥 逾期，先清这些', a.overdue, '- 没有逾期 ✓'),
    ...sec('📌 今天到期', a.today, '- 今天没有到期任务'),
    ...sec('🗓️ 未来 7 天', a.week, '- 暂无'),
    ...(a.blocked.length ? sec('⛔ 卡住的事', a.blocked, '') : []),
  ].join('\n');
}

/**
 * 简报骨架。research 由定时 Claude 代理填入：
 *   { game: '<markdown>', ai: '<markdown>' }
 * 缺任一块时如实标注"未生成"，绝不用占位内容冒充结果。
 */
// 简报只放两份 report。待办由 Trello 驱动、经推送与首页呈现，
// 不在这里重复一份 —— 两处数据源不同，重复只会对不上。
export function renderBriefing(date, agenda, research = {}) {
  const meta = {
    date,
    generated_at: new Date().toISOString(),
    has_game_report: !!research.game,
    has_ai_report: !!research.ai,
  };
  const body = [
    `# ${date} 每日简报`,
    '',
    '## 🎮 游戏市场 report',
    research.game || '_本次未生成（研究步骤失败或未运行）。_',
    '',
    '## 🤖 AI 市场 report',
    research.ai || '_本次未生成（研究步骤失败或未运行）。_',
  ].join('\n');
  return serializeDoc(meta, body);
}

export async function writeBriefing(store, date, research) {
  const agenda = await todayAgenda(store, date);
  const content = renderBriefing(date, agenda, research);
  const cur = await store.read(briefingPath(date));
  const back = await store.write(briefingPath(date), content, cur ? cur.revision : null);
  return { path: briefingPath(date), revision: back.revision, agenda };
}

export async function readBriefing(store, date) {
  const f = await store.read(briefingPath(date));
  if (!f) return null;
  const text = typeof f.text === 'string' ? f.text : new TextDecoder().decode(f.content);
  const { meta, body } = parseDoc(text);
  return { ...meta, body, revision: f.revision };
}

/** 周五：生成下周优先任务（这个是可执行计划，仍以任务形式落到看板） */
export async function runWeeklyPlan(store, date = jstDate()) {
  const { projects } = await bootstrap(store);
  const monday = addDays(date, 3);
  const sunday = addDays(date, 9);
  const open = projects.flatMap((p) => p.tasks.filter((t) => t.status !== 'done').map((t) => ({ ...t, _p: p.title })));
  const overdue = open.filter((t) => t.due && t.due <= date).sort((a, b) => rank(a) - rank(b) || a.due.localeCompare(b.due));
  const next = open.filter((t) => t.due && t.due > date && t.due <= sunday).sort((a, b) => rank(a) - rank(b) || a.due.localeCompare(b.due));
  const line = (t) => `- [ ] **${t.priority.toUpperCase()}** ${t.title} — ${t._p}${t.due ? ` · due ${t.due}` : ''}${t.status === 'blocked' ? ' · ⚠️卡住' : ''}`;
  const title = `下周优先任务 · ${monday} 起`;

  const p = projects.find((x) => x.id === 'prj_chores');
  if (!p) return { skipped: 'project missing' };
  if (p.tasks.some((t) => t.title === title)) return { skipped: 'already exists' };

  const body = [
    `## 下周优先任务（${monday} ~ ${sunday}）`, `生成于 ${date}（周五）。按 priority → due 排序。`, '',
    `### 🔥 必须先清（逾期 / 本周未完成）— ${overdue.length} 项`,
    ...(overdue.length ? overdue.map(line) : ['- 无，干净收尾 ✓']), '',
    `### 📌 下周到期 — ${next.length} 项`,
    ...(next.length ? next.map(line) : ['- 暂无']), '',
    '### 🎯 想推进但还没排期', '补 1–3 件真正想推进的事，并给它们定 due。',
  ].join('\n');

  const r = await createTask(store, {
    operation_id: `cron-week-${monday}`,
    task: { project_id: 'prj_chores', title, type: 'plan', priority: 'p0', start: monday, due: monday, body },
  });
  return { created: r.record.id };
}
