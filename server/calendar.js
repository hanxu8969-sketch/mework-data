// MeWork ⇄ Google Calendar 同步引擎（纯逻辑，可离线测试）
// 事实源：看板。日历事件是 due 未完成任务的投影。改期以看板为准；日历侧改动记为冲突交用户选。
import { createHash } from 'node:crypto';

export const CAL_CONFIG = {
  // 项目 → 目标日历（用用户已有日历，不新建任何 Calendar 资源）
  projectCalendar: {
    prj_game: '65407d59bcea16dbb129fde14f502a6408a1adaeff3c7b37f6d5001ea4c769ad@group.calendar.google.com', // ゲームイベンド
    prj_chores: '4tr71kcq8u61rr7lijkef583vs@group.calendar.google.com', // 生活
    prj_ai: 'hanxu8969@gmail.com', // TODO（主日历）
  },
  // 只读投影进「今日」的日历（不写回）
  readOnlyCalendars: [
    'ja.japanese#holiday@group.v.calendar.google.com',
    'hanxu8969@gmail.com',
    '4tr71kcq8u61rr7lijkef583vs@group.calendar.google.com',
    '65407d59bcea16dbb129fde14f502a6408a1adaeff3c7b37f6d5001ea4c769ad@group.calendar.google.com',
  ],
  timeZone: 'Asia/Tokyo',
  reminderMinutes: 60, // D10：提前 1 小时。全天任务事件的提醒落在前一天 23:00。
  tagPrefix: '[MeWork]',
};

export function syncHash(task) {
  const core = { title: task.title, start: task.start || null, due: task.due, status: task.status, project_id: task.project_id };
  return createHash('sha1').update(JSON.stringify(core)).digest('hex').slice(0, 16);
}

const addDay = (d) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
};

// 任务 → 期望的日历事件（全天事件；Google 的 end.date 是排他的）
export function desiredEvent(task) {
  const startDate = task.start && task.start <= task.due ? task.start : task.due;
  return {
    summary: `${CAL_CONFIG.tagPrefix} ${task.title}`,
    description: `MeWork 任务 ${task.id}｜项目 ${task.project_id}｜状态 ${task.status}\n（此事件由看板生成，改期请以看板为准）`,
    start: { date: startDate },
    end: { date: addDay(task.due) },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: CAL_CONFIG.reminderMinutes }] },
    extendedProperties: { private: { mework_task_id: task.id, mework_project_id: task.project_id } },
  };
}

export const eventNeedsSync = (t) => !!(t.due && t.status !== 'done' && CAL_CONFIG.projectCalendar[t.project_id] && t.calendar_mode !== 'unlinked');

// Google 事件的日期区间（全天用 date，定时用 dateTime 的日期部分）
export function eventRange(ev) {
  const s = ev.start?.date ? ev.start.date.slice(0, 10) : (ev.start?.dateTime || '').slice(0, 10);
  const e = ev.end?.date ? ev.end.date.slice(0, 10) : (ev.end?.dateTime || '').slice(0, 10);
  return { start: s, end: e };
}

/**
 * 为一个任务规划同步动作。纯函数：不发请求。
 * remote=null 表示远端不存在（未创建，或已被用户删除）。
 * 返回 {action, ...}；action ∈ create|update|delete|noop|unlink|conflict
 */
export function planTaskSync(task, remote) {
  const hash = syncHash(task);
  const want = eventNeedsSync(task);
  const linked = !!task.calendar_event_id;

  if (!want) {
    if (linked && remote) return { action: 'delete', event_id: task.calendar_event_id, reason: task.status === 'done' ? 'task done' : 'no due date' };
    if (linked && !remote) return { action: 'unlink', reason: 'remote already gone' };
    return { action: 'noop' };
  }
  if (!linked) return { action: 'create', body: desiredEvent(task), hash };
  if (!remote || remote.status === 'cancelled') {
    // 用户在日历侧删除了事件 → 不复活、不删任务，只解除链接（避免反复重建）
    return { action: 'unlink', reason: 'deleted in Google; task kept' };
  }

  const boardChanged = task.calendar_sync_hash !== hash;
  const desired = desiredEvent(task);
  const r = eventRange(remote);
  const remoteMoved = r.start !== desired.start.date || r.end !== desired.end.date;

  if (!boardChanged && !remoteMoved) return { action: 'noop' };
  if (boardChanged) return { action: 'update', event_id: task.calendar_event_id, body: desired, hash }; // 看板为准
  // 只有日历侧动了 → 冲突，交用户选
  return {
    action: 'conflict', event_id: task.calendar_event_id,
    board: { start: desired.start.date, due: task.due },
    calendar: { start: r.start, due: r.end },
    resolve: { keep_board: { action: 'update', body: desired, hash }, keep_calendar: { start: r.start, due: r.end } },
  };
}

/** 把 Google 事件投影成「今日」只读条目（不建第二份事实） */
export function projectEvents(events, fromDate, toDate) {
  const out = [];
  for (const ev of events) {
    if (ev.status === 'cancelled') continue;
    if ((ev.summary || '').startsWith(CAL_CONFIG.tagPrefix)) continue; // 自己写回的镜像，不再投影回来
    const allDay = !!ev.start?.date;
    const date = allDay ? ev.start.date.slice(0, 10) : (ev.start?.dateTime || '').slice(0, 10);
    if (!date || date < fromDate || date > toDate) continue;
    out.push({
      kind: 'calendar_event',
      id: ev.id,
      calendar_id: ev.__calendarId || null,
      title: ev.summary || '(无标题)',
      date,
      all_day: allDay,
      time: allDay ? null : (ev.start.dateTime || '').slice(11, 16),
      end_time: allDay ? null : (ev.end?.dateTime || '').slice(11, 16),
      location: ev.location || null,
      source: ev.eventType === 'FROM_GMAIL' ? 'gmail' : 'calendar',
      link: ev.htmlLink || null,
      read_only: true,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')));
}
