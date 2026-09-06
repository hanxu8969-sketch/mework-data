# MeWork 运行手册

## 1. 本地运行

```bash
cd mework && node server/dev.js     # → http://localhost:8787
```

数据就在 `mework/content/`，是普通 markdown + YAML frontmatter，**Obsidian 可直接打开这个目录当库用**。看板改一次、Obsidian 里就变一次，反过来也一样（刷新页面即可）。

## 2. 数据结构（canonical store）

```
content/taxonomy.yaml                                  # schema_version、枚举值
content/projects/<project-id>/project.md               # 项目
content/projects/<project-id>/tasks/<task-id>.md       # 任务
content/projects/<project-id>/artifacts/<file>         # 附件实体
content/projects/<project-id>/artifacts/_manifest.json # 附件索引
content/briefings/YYYY-MM-DD.md                        # 每日简报
content/calendar-conflicts.json                        # 日历冲突待裁决
```

- `revision`：本地 = 文件内容 SHA1；线上 = GitHub blob SHA。
- 每次写入都带 `expected_revision`，写完 **exact read-back** 校验；对不上就报错，不会留下半截数据。
- 每次创建/修改都带 `operation_id`，重试同一个 key 不会重复建。

## 3. API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/bootstrap` | 一次拉全量：taxonomy + projects + tasks + artifacts |
| POST | `/api/tasks` | 建任务。`{operation_id, task:{project_id,title,...}}` |
| PATCH | `/api/tasks/:id` | 改任务。`{operation_id, project_id, expected_revision, changes, body?}` |
| POST | `/api/projects` · PATCH `/api/projects/:id` | 同上 |
| PUT | `/api/artifacts?project_id=&name=&mode=` | 传附件。`mode` = `new`（同名 409）\| `rename` \| `replace` |
| POST | `/api/artifacts/unlink` | 解除引用，**不物理删除文件** |
| GET | `/api/briefing?date=` · PUT `/api/briefing` | 读/写每日简报 |
| GET | `/api/calendar/today` · POST `/api/calendar/sync` | 日历投影 / 手动同步（仅线上） |

错误码：`400` 字段非法 · `401/403` 未授权 · `404` 不存在 · `409` revision 过期或同名冲突。

## 4. 部署到 Cloudflare（需要你本人操作的部分）

凭据全部由你自己输入，我不接触、也不会出现在仓库或聊天里。

**a. 建数据仓库**：新建一个 **private** 仓库（例如 `mework-data`），把 `content/` 推上去。

**b. 建 GitHub token**：Settings → Developer settings → Fine-grained tokens，只勾这一个仓库、权限 `Contents: Read and write`。

**c. 填 `wrangler.toml`** 里三个 `REPLACE_ME`：`GITHUB_OWNER`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`（AUD 在建完 Access 应用后才有，见 e）。

**d. 写入 secrets**（逐条执行，粘贴时不会回显）：
```bash
cd mework
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

**e. 加 Cloudflare Access**：Zero Trust → Access → Applications → Add self-hosted，域名填 Worker 的地址，Policy 设成 `Emails = hanxu8969@gmail.com`。建好后复制 **Application Audience (AUD) Tag** 填回 `wrangler.toml` 的 `ACCESS_AUD`，再 `npx wrangler deploy` 一次。

**f. 验收**：手机和电脑各打开一次 → 应该先跳登录 → 登录后能看到看板、能改一条任务、刷新后改动还在。

## 5. 日历（已启用，双向）

**项目 → 日历的映射**（用你已有的日历，不新建任何日历资源）：

| 项目 | 目标日历 |
|---|---|
| 游戏市场跟踪 | ゲームイベンド |
| 日常杂务 | 生活 |
| AI 市场跟踪 | TODO（主日历） |

**规则**
- 有 `due` 且未完成的任务 → 在对应日历生成一条全天事件，标题带 `[MeWork]` 前缀，**提醒提前 60 分钟**。
- 日历事件（含日本节假日、Gmail 自动生成的预约）→ 只读投影进「今日」，**不会**变成第二份任务。
- **改期以看板为准**。你在 Google 那边拖动了事件 → 记为冲突写进 `content/calendar-conflicts.json`，由你裁决，系统不会静默覆盖。
- 任务完成或清掉 due → 自动删掉镜像事件。你在 Google 手动删掉事件 → 系统解除链接、**不复活也不删任务**。

**Apple 日历双向编辑**：iPhone「设置 → 应用 → 日历 → 账户 → 添加账户 → Google」，登录 hanxu8969@gmail.com，打开「日历」开关。Mac 是「系统设置 → 互联网账户 → Google」。之后 Apple 日历里的增删改**直接落回 Google**，MeWork 照常对账 —— 不需要单独的 iCloud 通道。

**⚠️ 全天事件的时区陷阱**（已验证）：Google 全天事件必须传**裸日期** `{"date":"2026-09-01"}`。若传带偏移的时间戳（如 `2026-09-01T00:00:00+09:00`），在 UTC 时区的日历上会**整体前移一天**。生产代码 `desiredEvent()` 走的是裸日期，无此问题；手工调 API 时要注意。

**启用 Google 同步**（可选，不配则整段不启用、不创建任何日历资源）：
在 Google Cloud Console 建 OAuth 客户端、拿到 refresh token 后：
```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
```

## 6. 定时产出

| 任务 | 时间 | 产出 | 在哪管理 |
|---|---|---|---|
| 每日简报 | 每天 07:00（实际约 07:09，系统抖动） | 游戏 report + AI report + 今日待办 → 写入看板顶部 | 侧边栏「Scheduled」→ `mework-daily-briefing` |
| 下周优先任务 | 每周五 17:00 | 在「日常杂务」下建一条排好序的下周计划 | `mework-weekly-plan` |
| 日历对账 | 每 3 小时（Worker Cron，部署后生效） | 看板 ⇄ Google 双向同步 | `wrangler.toml` |

**定时任务只在这个 App 开着时运行**；关着的话，下次启动时补跑。

改时间：直接跟我说「简报改成 8 点」即可，不用编辑文件。

## 7. 常见问题

- **保存时弹「冲突」**：说明这条任务在别处也被改了。面板会逐字段列出「最新（别处）」和「我的（未提交）」，勾选后点「解决冲突并保存」——你的输入一个字都不会丢。
- **附件同名**：会问你「引用现有 / 重命名上传 / 替换内容」，不会静默覆盖。
- **Timeline 拖不动**：手机端需要**长按 250ms** 再拖，避免和页面纵向滚动打架。
- **简报显示「未生成」**：说明那一步研究失败了，是如实标注，不是占位内容。可以直接让我重跑。
