# 开发流程

本文说明本仓库的**分支模型、并行开发方式、提交与测试要求、合并流程与禁止事项**。

- 接口契约以 [`CONTRACTS.md`](./CONTRACTS.md) 为唯一权威；分层与 ADR 见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)；KiCad 网表细节见 [`NETLIST_KICAD.md`](./NETLIST_KICAD.md)。
- 本文的命令都在 Windows PowerShell 下验证过；POSIX shell 等价命令一并给出。

---

## 1. 分支模型

```text
main                稳定基线（只在整批交付验收后由集成方推进）
 │
 └─ dev             集成分支：所有功能分支的唯一合并目标
     ├─ feat/<feature>      新功能 / 重构
     ├─ docs/<topic>        文档
     ├─ test/<topic>        测试与夹具
     └─ fix/<topic>         缺陷修复
```

规则：

- **`dev` 从 `main` 拉出并常驻主工作区**，不在主工作区切换分支。
- 每个功能从 **`dev`** 拉出自己的分支，在**独立 worktree** 里开发，完成后由集成方用 `git merge --no-ff` 合回 `dev`。
- 分支名用 `<type>/<kebab-topic>`：`feat/kicad9-exporter`、`docs/dev-docs`、`test/harness-stability`。
- 功能分支**只提交自己负责的路径**；跨模块改动要在提交说明里显式登记，避免合并时惊到别人。
- 一个功能分支只描述一件事。依赖别人尚未合并的分支时，用 `git merge --no-ff <依赖分支>` 叠加（**不要** rebase、不要改别人的提交）。

---

## 2. 并行开发：git worktree

每个成员一个 worktree，互不干扰工作区与 `index`。这样 `dev` 永远留在主工作区、可以随时查看，而各人的分支各有独立目录。

### 2.1 创建

```powershell
cd C:\workspace\sch
git worktree add C:\workspace\sch-wt-<name> -b <branch> dev
```

POSIX：

```sh
git worktree add ../sch-wt-<name> -b <branch> dev
```

- 第 2 个参数是**新目录**（不能在主工作区内），第 3 个参数是新分支名，最后的 `dev` 是起点。
- 目录命名约定：`sch-wt-<name>`（`name` 为成员或主题短名）。

### 2.2 查看与清理

```powershell
git worktree list                         # 列出全部 worktree 及其检出的分支/提交
git worktree remove C:\workspace\sch-wt-<name>   # 合并完成后清理（先确认工作区干净）
git branch -d <branch>                    # 分支已合入 dev 后可删
```

若目录被外部进程占用导致 `remove` 失败：先关闭占用进程，再 `git worktree prune` 后重试。

### 2.3 日常循环

```powershell
cd C:\workspace\sch-wt-<name>
git status                 # 确认只有自己的改动
npm test                   # 或 node --test
git add <自己的路径…>       # 显式列出，不用 -A
git commit -m "feat(scope): …"
```

提交前自检清单：

1. `git status` 里没有别人的文件、没有 `_env_backup/`、没有 `.agent-teams/`；
2. `npm test` 全绿（新增测试按 `test/<层>/<模块>.test.mjs` 镜像放置）；
3. 新增 JS 文件**首行是职责注释**（`test/scaffold.test.mjs` 会检查）；
4. 改了文档就点一遍文中链接与命令。

---

## 3. 提交规范

沿用 `ARCHITECTURE.md` 第 7 节：

- conventional commits：`<type>(<scope>): <简述>`，`type` ∈ `feat` / `fix` / `test` / `docs` / `chore` / `refactor` / `perf`。
- 一个提交只做一件事；结构、实现、测试、文档分别提交。
- 每个任务**至少 2 个提交**（例如实现 1 个 + 测试 1 个，或文档按主题拆分）。
- 说明写「为什么」，正文写影响范围与验证方式。

示例：

```text
feat(netlist): 实现 KiCad 9 (version E) 完整网表导出器

按 docs/NETLIST_KICAD.md 输出六分节 …
验证：node --test "test/netlist/**/*.test.mjs" 全绿；黄金样本往返用例 8/8
```

---

## 4. 测试要求

| 目的 | 命令 | 说明 |
| --- | --- | --- |
| 全量单元 + 集成 | `npm test`（`node --test`） | 提交前**必须**全绿 |
| 按层跑 | `node --test "test/netlist/**/*.test.mjs"` | Node 22+ 的位置参数不会展开目录，**必须用 glob 加引号** |
| 服务器冒烟 | `npm run smoke` | `scripts/smoke.mjs`：随机端口启动 `createServer`，校验静态资源的状态码/`Content-Type`/字节，含 404 与路径穿越 403 的反向检查；同逻辑被 `test/integration/server-smoke.test.mjs` 复用 |
| 浏览器主流程 | `npm run verify:browser` | `scripts/browser-flow.mjs`：headless Chrome + CDP 驱动真实界面，需要本机 Chrome/Edge（可用 `CHROME_PATH` 指定） |

约定：

- 只用 `node:test` + `node:assert/strict`，**不引入**任何第三方测试/断言库。
- 不用 `skip` 掩盖失败；失败要么修，要么在任务汇报里登记为「已知问题 + 原因」。
- 涉及 Canvas 时用记录型假 `ctx`；涉及 UI 时用 `test/ui/helpers/fake-dom.mjs`。
- **测试内启动 HTTP 服务必须静默**（见 §7）：`startServer({ port: 0, quiet: true })` 或用 `logger` 选项把启动日志重定向到内存/空函数，**禁止**让被测服务向 stdout 打印日志。`node:test` 通过 IPC 回传结果，测试进程的 stdout 噪声会污染测试帧通道，典型症状是 `Unable to deserialize cloned data`。注意 `scripts/smoke.mjs` 用的是 `createServer`（不打印日志），需要 `startServer` 的场景才会触发该问题。

---

## 5. 合并回 dev（由集成方执行）

```powershell
cd C:\workspace\sch            # 主工作区，常驻 dev
git status                     # 必须干净
git log --oneline -10          # 确认 dev 当前 HEAD
git merge --no-ff <branch> -m "chore(integration): 合并 <说明>"
npm test                       # 合并后再跑一次全量
```

约定：

- **只用 `--no-ff`**：保留功能分支的边界，`git log --graph` 能看出批次。
- 合并前先看 `git log --oneline dev..<branch>` 与 `git diff --stat dev...<branch>`，确认改动范围符合任务边界。
- 合并后立刻校验不可再生的夹具（见 §6），再清理 worktree 与已合并分支。
- 一次合并失败（冲突）时：**不要 rebase、不要 reset**。两种可行做法——由集成方在 `dev` 上手工解决冲突后继续 `--no-ff` 合并；或在功能分支的 worktree 里 `git merge dev` 解决冲突并提交，再请集成方合并。无论哪种，解决后必须重跑 `npm test`。

### 5.1 冲突处理

1. 冲突文件先看清「两边各自的意图」，不要整块选一边。
2. 契约类文件（`docs/CONTRACTS.md`、`docs/ARCHITECTURE.md`）冲突时，以**最新契约 + 实际代码**为准，不允许保留两份矛盾描述。
3. 解决后必须重跑 `npm test`；文档冲突额外检查 Markdown 链接。
4. `index.lock` 存在时：`Start-Sleep 2`（POSIX `sleep 2`）后重试，最多 5 次；仍失败说明有并发进程，先找进程。

---

## 6. 不可再生的夹具与字节校验

`examples/tinytapeout-demo.net` 是 KiCad 9 网表黄金样本，**必须逐字节保持**：

- `.gitattributes` 里的 `*.net -text` 禁止 Git 把它规范化成 LF；其余文件仍走 `* text=auto eol=lf`。
- 基线：**254285 字节**、SHA256 `2f92e581…a53f`、CRLF、无 BOM、无结尾换行。

合并或改写涉网表代码后立即校验：

```powershell
$p = 'examples/tinytapeout-demo.net'
(Get-Item $p).Length                                  # 254285
(Get-FileHash $p -Algorithm SHA256).Hash.ToLower()    # 2f92e581…
git status --porcelain -- examples/                   # 应为空
git cat-file -s (git rev-parse HEAD:$p)               # 254285（提交后 blob 大小）
```

POSIX：

```sh
wc -c examples/tinytapeout-demo.net && shasum -a 256 examples/tinytapeout-demo.net
git status --porcelain -- examples/
```

若 `git status` 显示该文件被修改而你没动它，通常是 `.gitattributes` 被改回 `text=auto` 或某次提交带入了 CRLF 规范化——先查 `git check-attr text eol -- examples/tinytapeout-demo.net`（应为 `text: unset`）。

---

## 7. 禁止事项（硬性）

| 禁止 | 原因 |
| --- | --- |
| `git add -A` / `git add .` | 会把别人的文件、`_env_backup/`、`.agent-teams/` 带进提交 |
| `git commit --amend` | 改写已推送/已评审的提交，审计链断裂 |
| `git rebase` | 重写历史，其他分支的基点失效 |
| `git reset --hard` | 不可恢复地丢弃未提交工作 |
| `git push` | 集成由固定流程统一推进 |
| 在**主工作区**切换分支 | `dev` 必须常驻主工作区，供所有人查看 |
| 在测试进程里往 stdout 写日志 | 污染 `node:test` 的 IPC 帧通道（`Unable to deserialize cloned data`） |
| 提交 `_env_backup/`、`.agent-teams/`、`.tmp/` | 本地环境与团队状态，不属于代码 |

被禁止的操作一旦发生，正确做法是**在汇报中如实登记**并让集成方决定如何收敛，不要用另一个破坏性操作去「抹掉」。

---

## 8. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `fatal: '<path>' is not a git repository` | 在 worktree 外执行 git，或路径拼错 | `cd` 到 worktree 根再执行 |
| `fatal: '<branch>' is already checked out at …` | 同一分支被两个 worktree 检出 | 一个分支只能一个 worktree；用新分支或先 `worktree remove` |
| `index.lock` 已存在 | 并发 git 进程 | 等待 2 秒重试（最多 5 次），仍失败则找进程 |
| `node --test test/netlist` 报 `Cannot find module` | Node 22+ 位置参数按**文件**解析，不展开目录 | 改用 `node --test "test/netlist/**/*.test.mjs"` |
| 新增测试文件后偶发 `Unable to deserialize cloned data` | 测试进程 stdout 被污染 | 见 §4 与 §7：服务静默 |
| 文档里的命令直接粘贴报错 | 用了 POSIX 写法在 PowerShell 里跑 | 用本文给出的 PowerShell 版本（`$p`、`Start-Sleep`、`Get-FileHash`） |
| `git status` 显示 `examples/tinytapeout-demo.net` 被改 | `.gitattributes` 丢了 `*.net -text` | 见 §6，恢复该行并重新检出 |
