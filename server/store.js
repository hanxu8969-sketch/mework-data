// MeWork canonical store — filesystem provider (local mode).
// revision = sha1 of file content; production GitHub provider keeps the same interface.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export { parseYamlish, toYamlish, parseDoc, serializeDoc } from './doc.js';

export function sha1(buf) {
  return createHash('sha1').update(buf).digest('hex');
}

export class FsStore {
  constructor(root) {
    this.root = root; // directory that contains content/
  }
  abs(rel) {
    const p = path.normalize(path.join(this.root, rel));
    if (!p.startsWith(path.normalize(this.root)) || !rel.startsWith('content/')) {
      throw Object.assign(new Error('path outside store'), { code: 400 });
    }
    return p;
  }
  async read(rel) {
    try {
      const buf = await fs.readFile(this.abs(rel));
      return { path: rel, content: buf, revision: sha1(buf) };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  // expected_revision: null means "must not exist yet"
  async write(rel, content, expected_revision) {
    const cur = await this.read(rel);
    if (expected_revision === null && cur) {
      throw Object.assign(new Error('already exists'), { code: 409, current: cur.revision });
    }
    if (expected_revision !== null && (!cur || cur.revision !== expected_revision)) {
      throw Object.assign(new Error('stale revision'), { code: 409, current: cur ? cur.revision : null });
    }
    const p = this.abs(rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
    const back = await this.read(rel); // exact read-back
    if (!back || !back.content.equals(Buffer.from(content))) {
      throw Object.assign(new Error('read-back mismatch'), { code: 500 });
    }
    return back;
  }
  async list(relDir) {
    try {
      const entries = await fs.readdir(this.abs(relDir), { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, dir: e.isDirectory() }));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }
}
