# MeWork 部署清单

目标：手机在任何网络下都能打开，需要邮箱登录，Mac 关着也能访问。
凭据全部由你本人输入，我不接触，也不会出现在仓库或对话里。

本地仓库已经初始化并提交好了（30 个文件，`content/` 在仓库根）。按顺序做下面 5 步。

---

## ① wrangler 登录 ✅ 已完成

已登录 hanxu8969@gmail.com，Account ID `0890eb0ac49cd9ff6f0966d2d2de1e08`。

> 粘贴命令时注意别粘重复。之前那次失败就是粘成了
> `nnpx wrangler loginnpx wrangler login...`，wrangler 只打了帮助文本。
> 粘之前按 `Ctrl+U` 清空当前行比较保险。

---

## ② 建空的 GitHub 私有仓库（1 分钟）

打开 https://github.com/new

- **Repository name**：`mework-data`
- **Private** ← 一定要选
- 下面三个框（Add a README / .gitignore / license）**全都不要勾**

点 Create repository。建完先别管那个页面，进第 ③ 步。

> 必须是完全空的仓库，勾了 README 会和本地已有的提交冲突。

---

## ③ 生成 GitHub token（3 分钟）

⚠️ **顺序很重要**：token 要在推送之前拿到 —— GitHub 已经不支持用密码推送，
推送时的「密码」就是这个 token。而 token 又需要仓库先存在才能勾选，所以是 ②→③。

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
→ Generate new token

- **Token name**：mework
- **Expiration**：1 year
- **Repository access**：Only select repositories → 只勾 `mework-data`
- **Permissions** → Repository permissions → **Contents** 改成 **Read and write**
  （只要这一项，其余保持 No access）

点 Generate token，**立刻复制**（形如 `github_pat_...`）。页面一关就再也看不到了，
丢了只能重新生成。先粘到一个临时地方，等会儿要用两次。

---

## ④ 推送代码 + 写入 secret（2 分钟）

把 `<你的用户名>` 换成你的 GitHub 用户名：

```bash
cd "/Users/diana/Downloads/Claude Skills/follow-builders-main/mework"
git remote add origin https://github.com/<你的用户名>/mework-data.git
git push -u origin main
```

推送时会问：
- `Username`：你的 GitHub 用户名
- `Password`：**粘贴第 ③ 步的 token**（不是 GitHub 密码；粘贴时不回显，正常现象）

然后编辑 `wrangler.toml`，把 `GITHUB_OWNER` 的 `REPLACE_ME` 换成你的用户名：

```toml
GITHUB_OWNER = "<你的 GitHub 用户名>"
GITHUB_REPO  = "mework-data"
```

再把同一个 token 交给 Worker（同样不回显）：

```bash
npx wrangler secret put GITHUB_TOKEN
```

这一步之后临时存的 token 就可以删掉了。

---

## ⑤ 首次部署（1 分钟）

```bash
npx wrangler deploy
```

成功后会输出一个地址，形如 `https://mework.<你的子域>.workers.dev`。
**先别急着用** —— 这时还没有登录保护，任何人拿到地址都能访问。立刻做第 ⑥ 步。

---

## ⑥ 加 Cloudflare Access 登录保护（5 分钟）

Cloudflare 控制台 → **Zero Trust** → Access → Applications → **Add an application** → Self-hosted

- **Application name**：MeWork
- **Session duration**：1 month（免得每次都登）
- **Public hostname**：填第 ④ 步输出的 workers.dev 地址
- **Policy**：Action = Allow，Include → **Emails** → `hanxu8969@gmail.com`

创建完成后，在应用的 **Overview** 里复制 **Application Audience (AUD) Tag**。

回到 `wrangler.toml`，填最后两个值：

```toml
ACCESS_TEAM_DOMAIN = "<你的团队名>.cloudflareaccess.com"
ACCESS_AUD = "<刚复制的 AUD Tag>"
```

团队名在 Zero Trust → Settings → Custom Pages 顶部能看到，形如 `xxx.cloudflareaccess.com`。

再部署一次让配置生效：

```bash
npx wrangler deploy
```

---

## 验收（照着做一遍）

1. 手机用**移动网络**（关掉 Wi-Fi）打开那个地址 → 应该先跳转到登录页
2. 输入 hanxu8969@gmail.com → 收验证码邮件 → 登录 → 看到看板
3. 建一条任务，刷新页面 → 改动还在
4. 打开 GitHub 仓库 → `content/projects/.../tasks/` 下应该多了一个 .md 文件
5. 用一个**没授权的邮箱**或无痕窗口打开 → 应该被拒绝

第 4 步是关键：它证明数据真的写回了 GitHub，Obsidian 那边 pull 一下就能看到同样的内容。

---

## 之后：Obsidian 接上

把 `mework-data` 仓库 clone 到本地任意位置，在 Obsidian 里把这个文件夹作为 vault 打开（或作为已有 vault 的子文件夹）。看板改了就 `git pull`，Obsidian 里改了就 `git push`。

## 可选：Google 日历自动同步

不配这三个 secret 的话，日历整段不启用，也不会在你的日历里创建任何东西。要启用需要在 Google Cloud Console 建 OAuth 客户端拿 refresh token：

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
```

---

## 注意：部署后每日简报仍然依赖这台 Mac

部署解决的是「手机随时能看看板」和「待办自动更新」。但游戏和 AI 那两份**研究报告**是由这台 Mac 上的定时 Claude 代理产出的 —— Worker 自己不会做研究。所以 7 点那份完整简报，仍然需要桌面 App 开着。
