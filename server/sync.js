// 把 planTaskSync 的计划真正落到 Google + 写回 store（幂等、冲突不覆盖）
import { CAL_CONFIG, planTaskSync, projectEvents } from './calendar.js';
import { bootstrap, patchTaskMeta } from './api.js';

const CONFLICT_PATH = 'content/calendar-conflicts.json';

export async function syncBoardToCalendar(store, gcal, { dryRun = false } = {}) {
  const { projects } = await bootstrap(store);
  const report = { created: 0, updated: 0, deleted: 0, unlinked: 0, noop: 0, conflicts: [], errors: [] };

  for (const p of projects) {
    const calId = CAL_CONFIG.projectCalendar[p.id];
    if (!calId) continue;
    for (const task of p.tasks) {
      try {
        let remote = null;
        if (task.calendar_event_id) remote = await gcal.getEvent(calId, task.calendar_event_id);
        const plan = planTaskSync(task, remote);
        if (plan.action === 'noop') { report.noop++; continue; }
        if (dryRun) { report[plan.action] = (report[plan.action] || 0) + 1; continue; }

        if (plan.action === 'create') {
          const ev = await gcal.createEvent(calId, plan.body);
          await patchTaskMeta(store, task, { calendar_id: calId, calendar_event_id: ev.id, calendar_sync_hash: plan.hash, calendar_synced_at: new Date().toISOString(), calendar_mode: 'synced' });
          report.created++;
        } else if (plan.action === 'update') {
          await gcal.updateEvent(calId, plan.event_id, plan.body);
          await patchTaskMeta(store, task, { calendar_sync_hash: plan.hash, calendar_synced_at: new Date().toISOString() });
          report.updated++;
        } else if (plan.action === 'delete') {
          await gcal.deleteEvent(calId, plan.event_id);
          await patchTaskMeta(store, task, { calendar_event_id: null, calendar_sync_hash: null, calendar_synced_at: null, calendar_mode: 'none' });
          report.deleted++;
        } else if (plan.action === 'unlink') {
          await patchTaskMeta(store, task, { calendar_event_id: null, calendar_sync_hash: null, calendar_mode: 'unlinked' });
          report.unlinked++;
        } else if (plan.action === 'conflict') {
          report.conflicts.push({ task_id: task.id, project_id: p.id, title: task.title, ...plan });
        }
      } catch (e) {
        report.errors.push({ task_id: task.id, error: String(e.message || e) });
      }
    }
  }
  // 冲突写入 store，供 UI 显示让用户选
  const cur = await store.read(CONFLICT_PATH);
  const body = JSON.stringify({ updated_at: new Date().toISOString(), conflicts: report.conflicts }, null, 2) + '\n';
  if (!dryRun) await store.write(CONFLICT_PATH, body, cur ? cur.revision : null);
  return report;
}

export async function fetchProjection(gcal, fromDate, toDate) {
  const all = [];
  for (const calId of CAL_CONFIG.readOnlyCalendars) {
    try {
      const r = await gcal.listEvents(calId, `${fromDate}T00:00:00+09:00`, `${toDate}T23:59:59+09:00`);
      for (const ev of (r?.items || [])) all.push({ ...ev, __calendarId: calId });
    } catch { /* 单个日历失败不影响其它 */ }
  }
  return projectEvents(all, fromDate, toDate);
}
