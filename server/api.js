// MeWork API core — runtime-agnostic; store injected (FsStore locally, GitHub provider in prod).
import { parseDoc, serializeDoc, parseYamlish } from './doc.js';

const TASK_STATUS = ['todo', 'doing', 'blocked', 'done'];
const PROJECT_STATUS = ['active', 'paused', 'done', 'archived'];
const PRIORITY = ['p0', 'p1', 'p2', 'p3'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const opCache = new Map(); // operation_id -> result (idempotent create/patch)

// 两种 provider 的 content 分别是 Buffer / Uint8Array，统一解码
const DEC = new TextDecoder();
const asText = (f) => (typeof f.text === 'string' ? f.text : DEC.decode(f.content));

function err(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, extra });
}
function nowIso() {
  // ISO with JST offset
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().replace('Z', '') .replace(/\.\d{3}$/, '') + '+09:00';
}
function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function taskPath(pid, tid) { return `content/projects/${pid}/tasks/${tid}.md`; }
function projectPath(pid) { return `content/projects/${pid}/project.md`; }
function manifestPath(pid) { return `content/projects/${pid}/artifacts/_manifest.json`; }

function validateTask(t) {
  if (!t.title || typeof t.title !== 'string') throw err(400, 'title required');
  if (t.status && !TASK_STATUS.includes(t.status)) throw err(400, `status must be one of ${TASK_STATUS}`);
  if (t.priority && !PRIORITY.includes(t.priority)) throw err(400, `priority must be one of ${PRIORITY}`);
  for (const k of ['start', 'due']) {
    if (t[k] != null && t[k] !== '' && !DATE_RE.test(t[k])) throw err(400, `${k} must be YYYY-MM-DD`);
  }
}
function validateProject(p) {
  if (!p.title || typeof p.title !== 'string') throw err(400, 'title required');
  if (p.status && !PROJECT_STATUS.includes(p.status)) throw err(400, `status must be one of ${PROJECT_STATUS}`);
  if (p.priority && !PRIORITY.includes(p.priority)) throw err(400, `priority must be one of ${PRIORITY}`);
}

async function readManifest(store, pid) {
  const f = await store.read(manifestPath(pid));
  if (!f) return { artifacts: [], revision: null };
  return { artifacts: JSON.parse(asText(f)).artifacts || [], revision: f.revision };
}
async function writeManifest(store, pid, artifacts, expected) {
  const body = JSON.stringify({ artifacts }, null, 2) + '\n';
  return store.write(manifestPath(pid), body, expected);
}

export async function bootstrap(store) {
  const taxFile = await store.read('content/taxonomy.yaml');
  const taxonomy = taxFile ? parseYamlish(asText(taxFile)) : {};
  const projects = [];
  for (const e of await store.list('content/projects')) {
    if (!e.dir) continue;
    const pf = await store.read(projectPath(e.name));
    if (!pf) continue;
    const { meta, body } = parseDoc(asText(pf));
    const tasks = [];
    for (const t of await store.list(`content/projects/${e.name}/tasks`)) {
      if (t.dir || !t.name.endsWith('.md')) continue;
      const tf = await store.read(`content/projects/${e.name}/tasks/${t.name}`);
      const td = parseDoc(asText(tf));
      tasks.push({ ...td.meta, body: td.body.trim(), revision: tf.revision });
    }
    const { artifacts } = await readManifest(store, e.name);
    projects.push({ ...meta, body: body.trim(), revision: pf.revision, tasks, artifacts });
  }
  return { taxonomy, projects, server_time: nowIso() };
}

export async function createTask(store, payload) {
  const { operation_id, task } = payload;
  if (!operation_id) throw err(400, 'operation_id required');
  if (opCache.has(operation_id)) return opCache.get(operation_id);
  if (!task || !task.project_id) throw err(400, 'task.project_id required');
  if (!(await store.read(projectPath(task.project_id)))) throw err(404, 'project not found');
  validateTask(task);
  const id = newId('tsk');
  const now = nowIso();
  const meta = {
    id, project_id: task.project_id, title: task.title,
    type: task.type || 'work', status: task.status || 'todo',
    priority: task.priority || 'p2',
    start: task.start || null, due: task.due || null,
    completed_at: null, created_at: now, updated_at: now,
  };
  const back = await store.write(taskPath(task.project_id, id), serializeDoc(meta, task.body || ''), null);
  const result = { record: { ...meta, body: (task.body || '').trim() }, revision: back.revision };
  opCache.set(operation_id, result);
  return result;
}

export async function patchTask(store, tid, payload) {
  const { operation_id, expected_revision, project_id, changes = {}, body } = payload;
  if (!operation_id) throw err(400, 'operation_id required');
  if (opCache.has(operation_id)) return opCache.get(operation_id);
  if (!project_id || !expected_revision) throw err(400, 'project_id and expected_revision required');
  const cur = await store.read(taskPath(project_id, tid));
  if (!cur) throw err(404, 'task not found');
  if (cur.revision !== expected_revision) {
    const { meta, body: b } = parseDoc(asText(cur));
    throw err(409, 'stale revision', { latest: { ...meta, body: b.trim(), revision: cur.revision } });
  }
  const { meta, body: oldBody } = parseDoc(asText(cur));
  validateTask({ ...meta, ...changes });
  const allowed = ['title', 'type', 'status', 'priority', 'start', 'due', 'completed_at'];
  for (const k of Object.keys(changes)) {
    if (!allowed.includes(k)) throw err(400, `field not editable: ${k}`);
    meta[k] = changes[k] === '' ? null : changes[k];
  }
  if (changes.status === 'done' && !changes.completed_at) meta.completed_at = nowIso();
  if (changes.status && changes.status !== 'done') meta.completed_at = null;
  meta.updated_at = nowIso();
  const back = await store.write(taskPath(project_id, tid), serializeDoc(meta, body !== undefined ? body : oldBody), expected_revision);
  const result = { record: { ...meta, body: (body !== undefined ? body : oldBody).trim() }, revision: back.revision };
  opCache.set(operation_id, result);
  return result;
}

// 系统级元数据写入（日历字段）——不走用户字段白名单，但同样 expected_revision + read-back。
// 后台同步不与用户抢写：撞到 409 用最新 revision 重试一次，仍失败则放弃，下轮再来。
const CAL_FIELDS = ['calendar_id', 'calendar_event_id', 'calendar_sync_hash', 'calendar_synced_at', 'calendar_mode'];
export async function patchTaskMeta(store, task, meta) {
  for (const k of Object.keys(meta)) {
    if (!CAL_FIELDS.includes(k)) throw err(400, `not a calendar field: ${k}`);
  }
  const rel = taskPath(task.project_id, task.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await store.read(rel);
    if (!cur) throw err(404, 'task not found');
    const { meta: m, body } = parseDoc(asText(cur));
    Object.assign(m, meta);
    try {
      const back = await store.write(rel, serializeDoc(m, body), cur.revision);
      return { record: m, revision: back.revision };
    } catch (e) {
      if (e.code === 409 && attempt === 0) continue;
      throw e;
    }
  }
}

export async function createProject(store, payload) {
  const { operation_id, project } = payload;
  if (!operation_id) throw err(400, 'operation_id required');
  if (opCache.has(operation_id)) return opCache.get(operation_id);
  validateProject(project || {});
  const id = newId('prj');
  const now = nowIso();
  const meta = {
    id, title: project.title, type: project.type || 'side',
    platforms: project.platforms || [], status: project.status || 'active',
    priority: project.priority || 'p2', created_at: now, updated_at: now,
  };
  const back = await store.write(projectPath(id), serializeDoc(meta, project.body || ''), null);
  const result = { record: { ...meta, body: (project.body || '').trim() }, revision: back.revision };
  opCache.set(operation_id, result);
  return result;
}

export async function patchProject(store, pid, payload) {
  const { operation_id, expected_revision, changes = {}, body } = payload;
  if (!operation_id) throw err(400, 'operation_id required');
  if (opCache.has(operation_id)) return opCache.get(operation_id);
  const cur = await store.read(projectPath(pid));
  if (!cur) throw err(404, 'project not found');
  if (cur.revision !== expected_revision) throw err(409, 'stale revision', { latest_revision: cur.revision });
  const { meta, body: oldBody } = parseDoc(asText(cur));
  validateProject({ ...meta, ...changes });
  const allowed = ['title', 'type', 'status', 'priority', 'platforms'];
  for (const k of Object.keys(changes)) {
    if (!allowed.includes(k)) throw err(400, `field not editable: ${k}`);
    meta[k] = changes[k];
  }
  meta.updated_at = nowIso();
  const back = await store.write(projectPath(pid), serializeDoc(meta, body !== undefined ? body : oldBody), expected_revision);
  const result = { record: { ...meta, body: (body !== undefined ? body : oldBody).trim() }, revision: back.revision };
  opCache.set(operation_id, result);
  return result;
}

// mode: 'new' (409 on same name) | 'replace' | 'rename' (server picks free name)
export async function uploadArtifact(store, q, bodyBuf) {
  const { project_id, name, task_id, label, kind, mode = 'new', operation_id } = q;
  if (!operation_id) throw err(400, 'operation_id required');
  if (opCache.has(operation_id)) return opCache.get(operation_id);
  if (!project_id || !name) throw err(400, 'project_id and name required');
  if (/[/\\]|^\.\./.test(name)) throw err(400, 'invalid name');
  if (!(await store.read(projectPath(project_id)))) throw err(404, 'project not found');
  const manifest = await readManifest(store, project_id);
  let finalName = name;
  const relOf = (n) => `content/projects/${project_id}/artifacts/${n}`;
  const existing = manifest.artifacts.find((a) => a.path === relOf(name));
  if (existing && mode === 'new') {
    throw err(409, 'name conflict', { conflict: existing, options: ['reference', 'rename', 'replace'] });
  }
  if (existing && mode === 'rename') {
    let i = 2;
    while (manifest.artifacts.find((a) => a.path === relOf(finalName))) {
      const dot = name.lastIndexOf('.');
      finalName = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`;
      i++;
    }
  }
  const rel = relOf(finalName);
  const now = nowIso();
  // replace: write new content first, then swap the reference (never orphan mid-way)
  const curFile = await store.read(rel);
  await store.write(rel, bodyBuf, curFile ? curFile.revision : null);
  let artifacts;
  if (existing && mode === 'replace') {
    artifacts = manifest.artifacts.map((a) =>
      a.path === rel ? { ...a, size: bodyBuf.length, updated_at: now, task_id: task_id || a.task_id, label: label || a.label } : a);
  } else {
    artifacts = [...manifest.artifacts, {
      id: newId('art'), label: label || finalName, kind: kind || 'file', path: rel,
      project_id, task_id: task_id || null, visibility: 'private',
      size: bodyBuf.length, created_at: now, updated_at: now,
    }];
  }
  await writeManifest(store, project_id, artifacts, manifest.revision);
  const rec = artifacts.find((a) => a.path === rel);
  const result = { record: rec };
  opCache.set(operation_id, result);
  return result;
}

// unlink = remove reference only; file stays unless nothing else references it AND purge requested
export async function unlinkArtifact(store, q) {
  const { project_id, artifact_id, operation_id } = q;
  if (!operation_id) throw err(400, 'operation_id required');
  if (opCache.has(operation_id)) return opCache.get(operation_id);
  const manifest = await readManifest(store, project_id);
  const target = manifest.artifacts.find((a) => a.id === artifact_id);
  if (!target) throw err(404, 'artifact not found');
  const rest = manifest.artifacts.filter((a) => a.id !== artifact_id);
  await writeManifest(store, project_id, rest, manifest.revision);
  const result = { record: target, unlinked: true };
  opCache.set(operation_id, result);
  return result;
}

export async function handleApi(store, method, pathname, query, jsonBody, rawBody) {
  try {
    if (method === 'GET' && pathname === '/api/bootstrap') return { status: 200, json: await bootstrap(store) };
    if (method === 'GET' && pathname === '/api/briefing') {
      const { readBriefing, jstDate } = await import('./briefing.js');
      const b = await readBriefing(store, query.date || jstDate());
      return { status: 200, json: b || { missing: true, date: query.date || jstDate() } };
    }
    if (method === 'PUT' && pathname === '/api/briefing') {
      const { writeBriefing, jstDate } = await import('./briefing.js');
      const date = (jsonBody && jsonBody.date) || jstDate();
      const research = (jsonBody && jsonBody.research) || {};
      return { status: 200, json: await writeBriefing(store, date, research) };
    }
    if (method === 'POST' && pathname === '/api/tasks') return { status: 201, json: await createTask(store, jsonBody) };
    let m;
    if (method === 'PATCH' && (m = pathname.match(/^\/api\/tasks\/([\w-]+)$/)))
      return { status: 200, json: await patchTask(store, m[1], jsonBody) };
    if (method === 'POST' && pathname === '/api/projects') return { status: 201, json: await createProject(store, jsonBody) };
    if (method === 'PATCH' && (m = pathname.match(/^\/api\/projects\/([\w-]+)$/)))
      return { status: 200, json: await patchProject(store, m[1], jsonBody) };
    if (method === 'PUT' && pathname === '/api/artifacts')
      return { status: 201, json: await uploadArtifact(store, query, rawBody) };
    if (method === 'POST' && pathname === '/api/artifacts/unlink')
      return { status: 200, json: await unlinkArtifact(store, query) };
    if (method === 'GET' && pathname.startsWith('/api/files/')) {
      const rel = decodeURIComponent(pathname.slice('/api/files/'.length));
      const f = await store.read(rel);
      if (!f) return { status: 404, json: { error: 'not found' } };
      return { status: 200, raw: f.content, contentType: rel.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/octet-stream' };
    }
    return { status: 404, json: { error: 'no such endpoint' } };
  } catch (e) {
    const code = e.code && Number.isInteger(e.code) ? e.code : 500;
    return { status: code, json: { error: e.message, ...(e.extra || {}) } };
  }
}
