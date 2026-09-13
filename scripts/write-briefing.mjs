#!/usr/bin/env node
// 写简报的**唯一入口**。定时任务和手动生成都走这里，
// 由它独占 pull → 查重 → 写入 → commit → push 全流程，杜绝两个会话互相覆盖。
//
//   node scripts/write-briefing.mjs [--date YYYY-MM-DD] [--game 路径] [--ai 路径]
//                                   [--force] [--no-push]
//
// 缺哪份研究就如实留空（渲染成「未生成」），绝不用占位内容冒充。
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsStore } from '../server/store.js';
import { writeBriefing, readBriefing, jstDate } from '../server/briefing.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
const flag = (n) => argv.includes(`--${n}`);
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const readIf = async (p) => {
  if (!p) return null;
  try { return (await fs.readFile(p, 'utf8')).trim() || null; } catch { return null; }
};
const die = (msg, extra = {}) => {
  console.log(JSON.stringify({ ok: false, error: msg, ...extra }, null, 2));
  process.exit(1);
};

const date = arg('date') || jstDate();
const store = new FsStore(root);

// 1) 先与远端对齐 —— 别人（另一个会话、Worker、手机）可能刚写过
try {
  if (git('status', '--porcelain')) {
    git('add', '-A');
    git('-c', 'user.email=hanxu8969@gmail.com', '-c', 'user.name=XU HAN',
      'commit', '-q', '-m', `写简报前保存本地改动 ${new Date().toISOString().slice(0, 16)}`);
  }
  git('pull', '--rebase', 'origin', 'main');
} catch (e) {
  const out = String(e.stdout || '') + String(e.stderr || '');
  try { git('rebase', '--abort'); } catch { }
  die('拉取远端失败，仓库已回到原状；请手动处理后重试', { detail: out.slice(0, 400) });
}

// 2) 查重 —— 这一天已经有真内容就不动它，除非显式 --force
const existing = await readBriefing(store, date).catch(() => null);
if (existing && (existing.has_game_report || existing.has_ai_report) && !flag('force')) {
  die(`${date} 的简报已经有内容了（游戏:${existing.has_game_report} AI:${existing.has_ai_report}，生成于 ${existing.generated_at || '未知'}）。`
    + '可能是另一个会话或定时任务刚写过。确实要覆盖就加 --force。',
  { date, existing_bytes: (existing.body || '').length });
}

// 3) 写入
const research = { game: await readIf(arg('game')), ai: await readIf(arg('ai')) };
const r = await writeBriefing(store, date, research);

// 4) 提交并推送 —— 不推上去，手机和看板就看不到
let pushed = false, pushError = null;
if (!flag('no-push')) {
  try {
    git('add', '-A');
    if (git('status', '--porcelain')) {
      git('-c', 'user.email=hanxu8969@gmail.com', '-c', 'user.name=XU HAN', 'commit', '-q', '-m', `简报 ${date}`);
    }
    git('push', 'origin', 'main');
    pushed = true;
  } catch (e) {
    pushError = (String(e.stdout || '') + String(e.stderr || '')).slice(0, 300);
  }
}

console.log(JSON.stringify({
  ok: true,
  path: r.path,
  date,
  overwrote: !!(existing && (existing.has_game_report || existing.has_ai_report)),
  game_report: research.game ? `${research.game.length} 字` : '未生成',
  ai_report: research.ai ? `${research.ai.length} 字` : '未生成',
  pushed,
  ...(pushError ? { push_error: pushError, hint: '未推送成功——手机和看板看不到，请处理后重试' } : {}),
}, null, 2));
if (pushError) process.exit(1);
