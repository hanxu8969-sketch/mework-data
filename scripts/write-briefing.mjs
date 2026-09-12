#!/usr/bin/env node
// 写入每日简报，不依赖本地 HTTP 服务。
//   node scripts/write-briefing.mjs [--date YYYY-MM-DD] [--game 路径] [--ai 路径]
// 缺哪份研究就如实留空（渲染成「未生成」），绝不用占位内容冒充。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../server/store.js';
import { writeBriefing, jstDate } from '../server/briefing.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const readIf = async (p) => {
  if (!p) return null;
  try { return (await fs.readFile(p, 'utf8')).trim() || null; } catch { return null; }
};

const date = arg('date') || jstDate();
const research = { game: await readIf(arg('game')), ai: await readIf(arg('ai')) };
const r = await writeBriefing(new FsStore(root), date, research);

console.log(JSON.stringify({
  path: r.path,
  date,
  game_report: research.game ? `${research.game.length} 字` : '未生成',
  ai_report: research.ai ? `${research.ai.length} 字` : '未生成',
  agenda: {
    overdue: r.agenda.overdue.length,
    today: r.agenda.today.length,
    week: r.agenda.week.length,
    blocked: r.agenda.blocked.length,
  },
}, null, 2));
