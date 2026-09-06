# MeWork · Decision Record（冻结版）

冻结日期：2026-09-06 ｜ 用户：XU HAN (hanxu8969@gmail.com) ｜ 时区：Asia/Tokyo

## 已确认（用户回答 Q01–Q10）

| # | 决策 | 内容 |
|---|------|------|
| D01 | 名称/语言 | MeWork；界面中文为主、字段英文双语混排 |
| D02 | 核心问题 | ① 今日+本周必做一眼可见（源头含 Google 日历）② 项目 Timeline ③ 附件/脚本随任务存放 |
| D03 | 初始 Projects | 游戏市场跟踪（主业/BD，主机PC详细+手游大厂简略+公司详情）；AI 市场跟踪（副业，大佬动向/Trends/报告/学习）；日常杂务 |
| D04 | 状态流 | Task: todo → doing → (blocked) → done；Project: active/paused/done/archived |
| D05 | 首页 | 今日待办（逾期置顶、priority→due 排序）+ 本周必做 + 各项目一句话进度 |
| D06 | 首版功能 | Today/本周、Timeline、创建/编辑抽屉、附件挂载、Google 日历读取、手机访问、周五生成下周优先任务、每日游戏/AI 简报 |
| D07 | 旧数据 | 无批量迁移；空库+3 初始 Project；Trello（4 boards，按客户分列）/Obsidian 并行，可随时经 MCP 读 Trello 抽样 |
| D08 | 访问 | 仅本人；登录后可看/改/传附件；无多人协作 |
| D09 | 设备/部署 | 电脑为主手机可看；Cloudflare Workers + Assets；Cloudflare Access 邮箱验证 hanxu8969@gmail.com；暂无自定义域名 |
| D10 | 日历 | 双向：Google 事件投影进今日；有 due 未完成任务写回 Google；提醒提前 1 小时；改期以看板为准，冲突可视化由用户选；Apple 端通过同一 Google 账户双向编辑（设备侧添加账户，交付附步骤） |

## 采用默认（蓝图安全默认值，未询问）

- 时区 Asia/Tokyo；全天日期 `YYYY-MM-DD`；具体时间 ISO offset；overdue 动态计算不落库。
- 稳定 UUID 风格 id（`prj_*`/`tsk_*`/`art_*`）；标题变化不改 id；状态存在字段里。
- Canonical store 单一事实：`content/`（Obsidian 兼容 markdown + YAML frontmatter）；生产 provider=GitHub（revision=blob SHA），本地 provider=文件系统（revision=内容 SHA1）。
- 写协议：PATCH {path, expected_revision, changes, operation_id}；写前比对 revision，写后 exact read-back；stale→409；operation_id 幂等。
- 错误码：400 invalid / 401·403 auth / 404 missing / 409 stale revision·同名冲突。
- 附件：按 canonical path 去重；同名返回冲突让用户选（引用/重命名/替换）；unlink≠物理删除；替换先写新对象再换引用。
- Timeline 交互、移动端可用性、性能预算（LCP≤2.5s、交互≤200ms、50 Projects/500 Tasks）按蓝图第 3 页全套默认。
- 浏览器只走 authenticated API；密钥只在服务端。

## 已启用的自动化（Cron）

| 任务 | 时间（JST） | 产出 |
|------|------------|------|
| 每日游戏简报 | 每天 07:30 | 全球新上线游戏：主机/PC 详细（内容、公司详情、可攻略点），手游大厂简略 → 生成 1 条简报任务+附件 |
| 每日 AI 简报 | 每天 07:30 | AI 大佬动向 / Trends 摘要 → 生成 1 条简报任务+附件 |
| 下周优先任务 | 每周五 17:00 | 汇总未完成+下周 due+日历事件，生成下周优先级清单任务 |

实现：Workers Cron 创建任务骨架；研究性内容由 Claude 定时云代理写入 canonical store（Phase G/H 配置）。

## 暂不启用

- 自定义域名、多人协作、重复事件展开/多日历账户、iCloud 原生 CalDAV（Apple 走 Google 账户路径）。
