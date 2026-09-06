// node server/calendar.test.js  — 日历同步引擎单测（含真实事件样本）
import assert from 'node:assert/strict';
import { planTaskSync, projectEvents, syncHash, desiredEvent, eventRange } from './calendar.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ✓', name); };

const base = { id: 'tsk_x', project_id: 'prj_game', title: 'TGS 准备', status: 'doing', start: '2026-09-01', due: '2026-09-11' };

console.log('desiredEvent / 全天区间');
t('end.date 排他（due 次日）', () => {
  const e = desiredEvent(base);
  assert.equal(e.start.date, '2026-09-01');
  assert.equal(e.end.date, '2026-09-12');
  assert.equal(e.reminders.overrides[0].minutes, 60);
  assert.equal(e.extendedProperties.private.mework_task_id, 'tsk_x');
});
t('无 start 时用 due 单日', () => {
  const e = desiredEvent({ ...base, start: null });
  assert.equal(e.start.date, '2026-09-11');
  assert.equal(e.end.date, '2026-09-12');
});
t('start 晚于 due 时收敛为 due（范围不反转）', () => {
  const e = desiredEvent({ ...base, start: '2026-09-20' });
  assert.equal(e.start.date, '2026-09-11');
});
t('跨月边界', () => {
  assert.equal(desiredEvent({ ...base, start: '2026-09-30', due: '2026-09-30' }).end.date, '2026-10-01');
  assert.equal(desiredEvent({ ...base, start: '2026-12-31', due: '2026-12-31' }).end.date, '2027-01-01');
});

console.log('planTaskSync');
t('未链接 → create', () => {
  const p = planTaskSync(base, null);
  assert.equal(p.action, 'create');
  assert.equal(p.body.start.date, '2026-09-01');
});
t('已同步且两端未变 → noop（幂等）', () => {
  const h = syncHash(base);
  const task = { ...base, calendar_event_id: 'ev1', calendar_sync_hash: h };
  const remote = { id: 'ev1', status: 'confirmed', start: { date: '2026-09-01' }, end: { date: '2026-09-12' } };
  assert.equal(planTaskSync(task, remote).action, 'noop');
});
t('看板改期 → update（看板为准）', () => {
  const oldHash = syncHash(base);
  const task = { ...base, due: '2026-09-15', calendar_event_id: 'ev1', calendar_sync_hash: oldHash };
  const remote = { id: 'ev1', status: 'confirmed', start: { date: '2026-09-01' }, end: { date: '2026-09-12' } };
  const p = planTaskSync(task, remote);
  assert.equal(p.action, 'update');
  assert.equal(p.body.end.date, '2026-09-16');
});
t('仅日历侧被拖动 → conflict（不静默覆盖）', () => {
  const task = { ...base, calendar_event_id: 'ev1', calendar_sync_hash: syncHash(base) };
  const remote = { id: 'ev1', status: 'confirmed', start: { date: '2026-09-05' }, end: { date: '2026-09-20' } };
  const p = planTaskSync(task, remote);
  assert.equal(p.action, 'conflict');
  assert.equal(p.board.due, '2026-09-11');
  assert.equal(p.calendar.start, '2026-09-05');
  assert.ok(p.resolve.keep_board && p.resolve.keep_calendar);
});
t('任务完成 → delete 事件（任务保留）', () => {
  const task = { ...base, status: 'done', calendar_event_id: 'ev1', calendar_sync_hash: syncHash(base) };
  const p = planTaskSync(task, { id: 'ev1', status: 'confirmed', start: { date: '2026-09-01' }, end: { date: '2026-09-12' } });
  assert.equal(p.action, 'delete');
});
t('due 被清空 → delete', () => {
  const task = { ...base, due: null, calendar_event_id: 'ev1' };
  assert.equal(planTaskSync(task, { id: 'ev1', status: 'confirmed' }).action, 'delete');
});
t('用户在 Google 删了事件 → unlink，不复活也不删任务', () => {
  const task = { ...base, calendar_event_id: 'ev1', calendar_sync_hash: syncHash(base) };
  assert.equal(planTaskSync(task, null).action, 'unlink');
  assert.equal(planTaskSync(task, { id: 'ev1', status: 'cancelled' }).action, 'unlink');
});
t('unlinked 后不再重建（幂等收敛）', () => {
  const task = { ...base, calendar_mode: 'unlinked', calendar_event_id: null };
  assert.equal(planTaskSync(task, null).action, 'noop');
});
t('未映射日历的项目 → noop', () => {
  assert.equal(planTaskSync({ ...base, project_id: 'prj_unknown' }, null).action, 'noop');
});
t('重复运行 create→noop（不重复建事件）', () => {
  const p1 = planTaskSync(base, null);
  const task2 = { ...base, calendar_event_id: 'ev_new', calendar_sync_hash: p1.hash };
  const remote = { id: 'ev_new', status: 'confirmed', start: p1.body.start, end: p1.body.end };
  assert.equal(planTaskSync(task2, remote).action, 'noop');
});

console.log('projectEvents（真实事件样本）');
const realEvents = [
  { id: '67s2d6njmbo9klodadm8q3q181', summary: '轻井泽保养所', status: 'confirmed', start: { date: '2026-09-10T00:00:00Z' }, end: { date: '2026-09-11T00:00:00Z' }, eventType: 'DEFAULT', __calendarId: 'hanxu8969@gmail.com' },
  { id: '46m8knmgmjl3k5nn7c029r7o2c', summary: 'Reservation at モルゲン 五反田駅前店', status: 'confirmed', location: 'モルゲン 五反田駅前店', eventType: 'FROM_GMAIL', start: { dateTime: '2026-09-15T18:30:00+09:00', timeZone: 'Asia/Tokyo' }, end: { dateTime: '2026-09-15T19:30:00+09:00', timeZone: 'Asia/Tokyo' }, __calendarId: 'hanxu8969@gmail.com' },
  { id: '62np2vvt12454m4plvjki2s567', summary: '母誕生日', status: 'confirmed', start: { date: '2026-10-10T00:00:00Z' }, end: { date: '2026-10-11T00:00:00Z' }, eventType: 'DEFAULT', __calendarId: 'hanxu8969@gmail.com' },
  { id: 'mirror1', summary: '[MeWork] TGS 准备', status: 'confirmed', start: { date: '2026-09-11' }, end: { date: '2026-09-12' } },
  { id: 'gone', summary: '已取消', status: 'cancelled', start: { date: '2026-09-10' }, end: { date: '2026-09-11' } },
];
t('窗口过滤 + 全天/定时解析', () => {
  const p = projectEvents(realEvents, '2026-09-06', '2026-09-16');
  assert.deepEqual(p.map((x) => x.id), ['67s2d6njmbo9klodadm8q3q181', '46m8knmgmjl3k5nn7c029r7o2c']);
  assert.equal(p[0].all_day, true);
  assert.equal(p[0].date, '2026-09-10');
  assert.equal(p[1].all_day, false);
  assert.equal(p[1].time, '18:30');
  assert.equal(p[1].end_time, '19:30');
  assert.equal(p[1].source, 'gmail');
  assert.equal(p[1].location, 'モルゲン 五反田駅前店');
});
t('自己的镜像事件不回流（不建第二份事实）', () => {
  assert.equal(projectEvents(realEvents, '2026-09-01', '2026-12-31').some((x) => x.id === 'mirror1'), false);
});
t('cancelled 事件被排除', () => {
  assert.equal(projectEvents(realEvents, '2026-09-01', '2026-12-31').some((x) => x.id === 'gone'), false);
});
t('全部只读', () => {
  assert.ok(projectEvents(realEvents, '2026-09-01', '2026-12-31').every((x) => x.read_only === true));
});
t('按日期+时间排序', () => {
  const p = projectEvents(realEvents, '2026-09-01', '2026-12-31');
  const dates = p.map((x) => x.date);
  assert.deepEqual(dates, [...dates].sort());
});

console.log('eventRange');
t('UTC 午夜的全天 date 正确截取', () => {
  assert.deepEqual(eventRange({ start: { date: '2026-09-10T00:00:00Z' }, end: { date: '2026-09-11T00:00:00Z' } }), { start: '2026-09-10', end: '2026-09-11' });
});

console.log(`\n✅ ${pass} passed`);
