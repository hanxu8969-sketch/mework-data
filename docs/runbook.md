# MeWork 运行手册

**看板**：https://mework.hx-lab.workers.dev （Cloudflare Access 邮箱登录）
**数据仓库**：`hanxu8969-sketch/mework-data`

## 它是什么

Trello 的只读镜像 + 每日简报。**所有 TODO 在 Trello 记和改，MeWork 不写回。**

四个页面对应四个用途：

| 页面 | 用途 |
|---|---|
| **简报** | 每天早上读游戏市场 + AI 市场两份 report |
| **今日** | 今天要做什么：收件箱待办 + 未来 30 天节点 |
| **日程** | 每周排期：项目 × 月份网格 + 每个项目的月度安排 |
| **回顾** | 本周动过 / 停滞 / 未来两周节点 / 收件箱积压 |

## 自动化

| 时间（JST） | 做什么 | 跑在哪 | Mac 关机 |
|---|---|---|---|
| 每天 07:00 | 手机推送今日待办 | Cloudflare | ✅ 照常 |
| 每周五 17:00 | 手机推送周回顾 | Cloudflare | ✅ 照常 |
| 每 3 小时 | Trello 导出 markdown 给 Obsidian | Cloudflare | ✅ 照常 |
| 每晚 21:00 | 生成次日简报（联网研究 + AI 判断）| Mac 定时任务 | ❌ 需 App 开着 |

只有简报依赖这台 Mac —— Worker 做不了联网研究。App 没开的话，
第二天看板会显示最近一份有内容的简报并标注「N 天前」，不会假装有。

## Trello 映射

- **列表 → 项目泳道**；卡片 → 只读任务；名字含 Done/Finish/完了 的列表视为已完成栏
- **收件箱**（Trello Inbox）→ 今日页的待办清单，这是每天真正要做的事
- **节点日期**取自卡片的 due；没有 due 时**从标题里抽**（「（2026年10月27日発売）」这类写法）
- 「納品情報のお知らせ」看板已排除（改 `server/trello.js` 的 `EXCLUDED_BOARDS`）

想让某件事进日程，在 Trello 设 due 或把日期写进标题即可。

## Obsidian

仓库 clone 在 `~/Documents/MeWork`，软链接挂进 iCloud 库「知识库+文稿/MeWork」。
launchd `com.mework.sync` 每 10 分钟双向同步；日志 `~/Library/Logs/mework-sync.log`。
Trello 导出在 `content/trello/`，一条客户线一个文件，frontmatter 可用 Dataview 查。

立刻同步：`~/Documents/MeWork/sync.sh`

## 手机

Safari 打开看板 → 分享 → 加入主屏幕 → **从主屏图标打开**（Cookie 与 Safari 分开，需重新登录）
→ 首页顶部「开启提醒」→ 允许通知。**必须从主屏打开**，Safari 标签页里 iOS 不给推送权限。

自测推送：浏览器打开 `/api/push/test`，返回 `sent: 1` 即已发出。

## 常用端点

| 路径 | 用途 |
|---|---|
| `/api/trello/raw` | 诊断：看 Trello 原始返回结构 |
| `/api/trello/export` (POST) | 立刻导出 markdown 给 Obsidian |
| `/api/push/test` | 立刻推一条通知到手机 |
| `/api/briefing?date=YYYY-MM-DD` | 读指定日期的简报 |

## 阈值（想改就说）

停滞判定 **60 天**无动静且仍有未完成 · 收件箱积压 **14 天** · 近期节点窗口 **30 天**

## 已知限制

- 简报依赖 Mac 开着（见上）
- MeWork 自身的附件上传已随只读化移除；用 Trello 卡片的附件
- 免费版 Worker 每次调用上限 50 个子请求，当前用约 6 个，充裕
