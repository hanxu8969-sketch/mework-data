# 在 Obsidian 里看 MeWork 的内容

看板、手机、Obsidian 三边看到的是**同一份 markdown 文件**，通过 GitHub 仓库 `hanxu8969-sketch/mework-data` 同步。

## 一次性设置（5 分钟）

### ① 把仓库 clone 到一个你愿意长期放着的位置

不要用现在这个 `Downloads/Claude Skills/...` 目录当 vault——那是开发目录，混着代码。单独 clone 一份纯数据副本：

```bash
cd ~/Documents
git clone https://github.com/hanxu8969-sketch/mework-data.git MeWork
```

凭据已在钥匙串，不会再问密码。

### ② 在 Obsidian 里打开

Obsidian → 左下角「打开其他仓库库」→ **Open folder as vault** → 选 `~/Documents/MeWork/content`

**注意选到 `content` 这一层**，不要选仓库根目录——根目录里有 `server/`、`public/` 等代码，Obsidian 会把它们当笔记索引，很乱。

打开后你会看到：

```
briefings/2026-09-12.md          ← 每日简报
projects/prj_game/project.md     ← 项目
projects/prj_game/tasks/*.md     ← 任务（frontmatter 里是可查询字段）
projects/prj_game/artifacts/     ← 附件
taxonomy.yaml                    ← 枚举定义
```

任务的 frontmatter 就是 Obsidian 的 properties，`status`、`priority`、`due` 这些字段可以直接用 Dataview 之类的插件查询。

## 日常同步

Obsidian 本身不会自动 git 同步，有两种做法：

**手动**（够用）：想看最新内容前跑一次
```bash
cd ~/Documents/MeWork && git pull
```

**自动**（推荐）：装 Obsidian 社区插件 **Obsidian Git**
- 设置 → 第三方插件 → 浏览 → 搜 "Obsidian Git" → 安装并启用
- 在插件设置里把 **Vault backup interval** 设成 10 分钟，**Pull on startup** 打开
- 之后打开 Obsidian 就自动拉取，你在 Obsidian 里的编辑也会定时推回去

> 用 Obsidian Git 时 vault 要指向**仓库根目录**才能识别 `.git`。
> 如果你既想自动同步、又不想看到代码文件夹，就在 Obsidian 设置 →「文件与链接」→
> 「排除的文件」里加上 `server`、`public`、`scripts`、`docs`、`node_modules`。

## 冲突怎么办

三边同时改同一条任务时，git 可能报冲突。任务文件很小，直接看一眼选一版即可：

```bash
cd ~/Documents/MeWork
git status                 # 看哪个文件冲突
git checkout --theirs <文件>   # 用远端（看板/手机）的版本
# 或
git checkout --ordinary <文件> # 用本地（Obsidian）的版本
git add -A && git commit -m "解决冲突" && git push
```

实践中很少发生——看板写的是任务和简报，你在 Obsidian 里通常是补正文说明，两边动的不是同一行。

## 一个提醒

在 Obsidian 里改任务的 frontmatter 时，**不要动 `id` 和 `created_at`**。改标题、正文、`due`、`priority` 都没问题，看板下次读取就会反映出来。`id` 是任务的稳定标识，改了会被当成另一条任务。
