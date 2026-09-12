// GitHub canonical store provider — 与 FsStore 同接口；revision = blob SHA
const API = 'https://api.github.com';

// 把 GitHub 的失败翻译成能直接指向修复动作的中文，绝不回显 token
async function ghError(res, what) {
  let detail = '';
  try { detail = ((await res.json()).message || '').slice(0, 120); } catch { }
  const hint = {
    401: 'GITHUB_TOKEN 无效或粘贴出错（重新 wrangler secret put）',
    403: 'token 有效但无权限：检查 fine-grained token 的 Contents 是否为 Read and write，且仓库范围勾了本仓库',
    404: '仓库或分支不存在，或 token 看不到该仓库',
    409: '版本冲突',
  }[res.status] || 'GitHub 返回异常';
  return Object.assign(
    new Error(`GitHub ${what} 失败 ${res.status}：${hint}${detail ? `（${detail}）` : ''}`),
    { code: res.status === 401 || res.status === 403 ? 401 : 500 },
  );
}

export class GitHubStore {
  constructor({ token, owner, repo, branch = 'main' }) {
    Object.assign(this, { token, owner, repo, branch });
  }
  get headers() {
    return {
      authorization: `Bearer ${this.token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'mework-worker',
      'x-github-api-version': '2022-11-28',
    };
  }
  async read(rel) {
    const url = `${API}/repos/${this.owner}/${this.repo}/contents/${encodeURI(rel)}?ref=${this.branch}`;
    const res = await fetch(url, { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) throw await ghError(res, `read ${rel}`);
    const j = await res.json();
    const content = Uint8Array.from(atob(j.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
    return { path: rel, content, revision: j.sha, text: new TextDecoder().decode(content) };
  }
  async write(rel, content, expected_revision) {
    const cur = await this.read(rel);
    if (expected_revision === null && cur) throw Object.assign(new Error('already exists'), { code: 409, current: cur.revision });
    if (expected_revision !== null && (!cur || cur.revision !== expected_revision)) {
      throw Object.assign(new Error('stale revision'), { code: 409, current: cur ? cur.revision : null });
    }
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
    let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
    const body = {
      message: `mework: update ${rel}`,
      content: btoa(bin),
      branch: this.branch,
      ...(cur ? { sha: cur.revision } : {}),
    };
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${encodeURI(rel)}`, {
      method: 'PUT', headers: { ...this.headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.status === 409 || res.status === 422) throw Object.assign(new Error('stale revision'), { code: 409 });
    if (!res.ok) throw await ghError(res, `write ${rel}`);
    const back = await this.read(rel); // exact read-back
    if (!back) throw Object.assign(new Error('read-back missing'), { code: 500 });
    const same = back.content.length === bytes.length && back.content.every((v, i) => v === bytes[i]);
    if (!same) throw Object.assign(new Error('read-back mismatch'), { code: 500 });
    return back;
  }
  async list(relDir) {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}/contents/${encodeURI(relDir)}?ref=${this.branch}`, { headers: this.headers });
    if (res.status === 404) return [];
    if (!res.ok) throw await ghError(res, `list ${relDir}`);
    const j = await res.json();
    return (Array.isArray(j) ? j : []).map((e) => ({ name: e.name, dir: e.type === 'dir' }));
  }
}
