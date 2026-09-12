# MeWork

这个文件夹是软链接，实体在 `~/Documents/MeWork/content`，通过 GitHub 仓库 `hanxu8969-sketch/mework-data` 与看板同步。

看板：https://mework.hx-lab.workers.dev

## 里面是什么

- `briefings/` — 每日简报（游戏市场 report + AI 市场 report + 今日待办），每天早上自动生成
- `projects/` — 三条线：`prj_game` 游戏市场跟踪、`prj_ai` AI 市场跟踪、`prj_chores` 日常杂务
  - `tasks/*.md` — 任务，frontmatter 就是 Obsidian properties（`status` / `priority` / `due` 可用 Dataview 查询）
  - `artifacts/` — 附件
- `taxonomy.yaml` — 字段枚举定义

## 同步

后台任务每 10 分钟自动 pull/push 一次，开机也会立即同步一次。不需要手动操作，也不依赖 Obsidian 开着。

想立刻同步：终端执行 `~/Documents/MeWork/sync.sh`
查看同步日志：`~/Library/Logs/mework-sync.log`（无事发生时不写日志）

## 编辑注意

改标题、正文、`due`、`priority` 都没问题，看板下次读取就会反映。

**不要改 `id` 和 `created_at`** —— `id` 是任务的稳定标识，改了会被当成另一条任务。

## 手机

iPhone 的 Obsidian **看不到这个文件夹**（iCloud 不跟随软链接同步内容）。手机上直接用看板网页：https://mework.hx-lab.workers.dev
