// frontmatter 文档解析/序列化 —— 纯逻辑，无 Node 依赖，Worker 与本地共用。
// patch 必须保留未修改字段和正文：解析后只覆盖指定 key，其余原样写回。
export function parseYamlish(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = parseScalar(m[2]);
  }
  return out;
}
function parseScalar(v) {
  v = v.trim();
  if (v === '' || v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[')) {
    const inner = v.slice(1, v.indexOf(']'));
    return inner.trim() === '' ? [] : inner.split(',').map((s) => s.trim());
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v.replace(/^["']|["']$/g, '');
}
export function toYamlish(obj) {
  return Object.entries(obj)
    .map(([k, v]) => {
      if (v === null || v === undefined) return `${k}: null`;
      if (Array.isArray(v)) return `${k}: [${v.join(', ')}]`;
      return `${k}: ${v}`;
    })
    .join('\n');
}
export function parseDoc(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  return { meta: parseYamlish(m[1]), body: m[2].replace(/^\n/, '') };
}
export function serializeDoc(meta, body) {
  return `---\n${toYamlish(meta)}\n---\n\n${(body || '').trim()}\n`;
}
