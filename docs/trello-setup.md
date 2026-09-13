# 接上 Trello（3 分钟）

代码已部署，只差一对 API 凭据。配好之后，你的 Trello 卡片会按列表出现在 MeWork 首页，早上 7 点的推送也会汇报各列表的未完成数。

**只读。** 权限只申请 `read`，MeWork 永远不会改你的 Trello。

---

## ① 拿 API Key

打开 https://trello.com/power-ups/admin

- 如果还没有 Power-Up：点 **New** 建一个，名字随便填（比如 `MeWork`），Workspace 选你自己的，其它留空，创建。
- 进入这个 Power-Up → **API Key** 标签页 → **Generate a new API Key**

复制那串 **API Key**（32 位十六进制）。

## ② 换只读 Token

把下面这行里的 `<你的APIKey>` 替换掉，在浏览器打开：

```
https://trello.com/1/authorize?expiration=never&scope=read&response_type=token&name=MeWork&key=<你的APIKey>
```

页面会问是否允许 MeWork 读取你的看板 —— 注意确认上面写的是 **read**（只读），然后点绿色的 **Allow**。

下一页会显示一串 **Token**（64 位），复制它。

> `expiration=never` 表示不过期，省得每月重配。想要有效期就把它改成 `30days`。

## ③ 写进 Worker

两条命令，粘贴时不会回显：

```bash
cd "/Users/diana/Downloads/Claude Skills/follow-builders-main/mework"
npx wrangler secret put TRELLO_KEY
npx wrangler secret put TRELLO_TOKEN
```

粘贴前按一下 `Ctrl+U` 清空当前行，避免粘重复（之前踩过两次）。

配完**不用重新部署**，secret 即时生效，刷新看板就能看到。

---

## 验证

刷新 https://mework.hx-lab.workers.dev ，首页顶部应该出现「📋 未完成合计 N 项」，下面按列表分组。点任意卡片会跳回 Trello。

如果显示「读取失败」，错误信息会直接说明原因：`401` 是 key/token 无效（多半粘贴出错），`429` 是限流稍后自动恢复。

---

## 映射规则

| Trello | MeWork |
|---|---|
| 看板（board） | 分组标签，显示在列表右侧 |
| 列表（list） | 项目 / Timeline 泳道 |
| 卡片（card） | 只读任务 |
| 名字含 Done / Finish / 完了 / 完成 的列表 | 视为已完成栏，不计入未完成数，排到最后 |
| 卡片的 `dueComplete` | 已完成 |
| 卡片的 due date | 用于逾期标红和 Timeline 定位 |

**没有 due date 的卡片照常显示和计数**，只是不会出现在 Timeline 上（时间线需要日期才能定位）。你现在绝大多数卡片都没设 due，所以 Timeline 会比较空——想让某件事上时间线，在 Trello 里给它设个截止日即可。

「納品情報のお知らせ」看板已排除，要改的话告诉我，在 `server/trello.js` 的 `EXCLUDED_BOARDS` 里。

## 数据边界

MeWork 里的三个项目（游戏市场跟踪 / AI 市场跟踪 / 日常杂务）和它们的任务仍然存在，显示在 Trello 区块下方，用于放不适合进 Trello 的东西。既然你说待办只在 Trello 维护，这几条会自然沉寂——想清掉直接说，我删。
