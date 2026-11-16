# 原理图工作室（schematic-studio）

一个零依赖、零构建的浏览器端原理图编辑器：纯 HTML / CSS / 原生 ES Modules 实现，
自带小型静态服务器，现代 Chrome / Edge 打开即用。支持原理图绘制与编辑、符号/封装库、
封装绘制、连通性分析与 ERC、JSON / CSV / KiCad / Protel 网表导出、SVG / PNG 导出、
工程保存与完整撤销重做。

![界面概览：首次启动的欢迎面板与整体布局（左侧元件库、中间画布、右侧属性、底部网表与状态栏）](docs/images/app-overview.png)

## 功能概览

- **原理图绘制与编辑**：符号放置（R 旋转 / X 镜像）、连续画线并吸附端点、自动结点、标签与文本、点选 / 框选 / 拖动 / 删除、网格吸附、完整撤销重做。
- **符号库**：18 个内置符号（电阻、电容、电感、二极管、LED、NPN/PNP、GND/VCC/+5V 电源、按钮、晶振、运放、IC_8、MCU_16、2/4 脚连接器），支持搜索与分类。
- **封装库与封装绘制**：10 个内置封装（0402/0603/0805、SOT-23、SOIC-8、DIP-8、排针、QFP-32），封装编辑器支持焊盘与丝印/Courtyard 绘制、图层配色与编号管理。
- **连通性分析与网表导出**：按导线、引脚、结点、全局/局部标签与电源符号推导网络（命名优先级：电源名 > 全局标签 > 局部标签 > `N$n`），提供 6 类 ERC 检查，导出 JSON / CSV / KiCad 6 / Protel(PCBNEW) 网表。
- **导出**：SVG 矢量图（纯函数，不依赖 canvas）与 PNG 位图（2 倍分辨率）。
- **工程持久化**：`.schproj.json` 保存 / 打开（严格 schema 校验并列出错误路径）、localStorage 本地草稿与恢复。
- **示例工程**：LED 指示灯、MCU 最小系统，从「文件 → 打开示例」一键载入。

## 快速开始

```bash
node server.mjs      # 或 npm start
```

浏览器打开 <http://localhost:8080>（`PORT` 环境变量可改端口）。无需 `npm install`。
首次启动可点击「开始使用」，然后通过「文件 → 打开示例：LED 指示灯」立即看到一张完整电路；
完整操作步骤、快捷键、网表格式与 FAQ 见 **[docs/USAGE.md](docs/USAGE.md)**。

## 功能矩阵

| 能力 | 说明 | 关键实现 | 对应测试 |
| --- | --- | --- | --- |
| 原理图绘制与编辑 | 放置/旋转/镜像符号、连续画线与端点吸附、自动结点、选择框选拖动、撤销重做 | `src/editor/**`、`src/model/store.js` | `test/editor/*.test.mjs` |
| 符号库 | 18 个内置符号；`createSymbolLibrary` 检索、序列化与深拷贝 | `src/library/builtin-symbols.js`、`src/library/symbol-library.js` | `test/library/*.test.mjs` |
| 封装库与封装绘制 | 10 个内置封装；焊盘/图形编辑、图层、编号递增、保存到工程库 | `src/library/builtin-footprints.js`、`src/editor/footprint-*.js`、`src/render/footprint-renderer.js` | `test/library/*`、`test/editor/footprint-*.test.mjs` |
| 连通性分析与 ERC | 并查集合并引脚/导线/结点/标签/电源；悬空引脚、单脚网络、重复位号、缺封装、未连接导线、电源冲突 6 类检查 | `src/netlist/connectivity.js`、`src/netlist/erc.js` | `test/netlist/connectivity.test.mjs`、`test/netlist/erc.test.mjs` |
| 网表导出 | JSON / CSV / KiCad 6 S 表达式 / Protel(PCBNEW) 四种格式，含预览、复制与下载 | `src/netlist/index.js`、`src/ui/dialogs/export-dialog.js` | `test/netlist/exporters.test.mjs` |
| 图形导出 | SVG（纯函数、复用渲染图元与主题）、PNG（2 倍分辨率、画布尺寸可恢复） | `src/io/svg-export.js`、`src/io/svg-primitives.js`、`src/io/png-export.js` | `test/io/svg-export.test.mjs`、`test/io/png-export.test.mjs` |
| 工程持久化 | 序列化/反序列化、schema 校验与 warnings、localStorage 草稿、浏览器下载 | `src/io/project-io.js`、`src/core/schema.js` | `test/io/project-io.test.mjs`、`test/core/schema.test.mjs` |
| 界面与交互 | 菜单/工具栏/面板/对话框/快捷键/多图纸/封装模式/首次提示 | `src/ui/**` | `test/ui/*.test.mjs` |
| 示例工程 | LED 示例（VCC/N$1/GND）与 MCU 示例（+5V/GND/XTAL 等） | `examples/demo-led.json`、`examples/demo-mcu.json` | 见 `docs/USAGE.md` 第 10 节（集成任务覆盖） |

## 架构

分层单向依赖（只能向下 import，禁止反向依赖），各层目录均位于 `src/`：

```text
ui            DOM 装配、面板、快捷键、样式
 |
 v
io            工程序列化 / SVG / PNG 导出
 |
 v
editor        工具、可撤销命令、编辑器、吸附
 |
 v
netlist / render   连通性分析与网表；视图变换与 Canvas 渲染
 |
 v
model / library    工程数据与状态仓库；符号库与封装库
 |
 v
core          ID、几何、事件总线、命令栈、schema
```

详细分层规则、目录约定与架构决策记录（ADR）见 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**；
全队唯一权威接口契约见 **[docs/CONTRACTS.md](docs/CONTRACTS.md)**。

### 开发约定

- 纯原生 HTML / CSS / ES Modules；**零第三方依赖、零 CDN、零构建步骤**。
- **单根布局**：可运行代码全部位于 `src/`（`core` / `model` / `library` / `netlist` / `render` / `editor` / `io` / `ui` 为层目录），入口是 `src/main.js`，测试在 `test/<层>/` 并镜像 `src/`。
- 分层单向依赖：`src/core -> (src/model | src/library) -> (src/netlist | src/render) -> src/editor -> src/io -> src/ui`，禁止反向 import。
- 纯函数层（`src/core`、`src/model`、`src/library`、`src/netlist`、`src/render` 的纯函数模块与 `src/io` 序列化）禁止依赖 DOM，便于 `node --test` 直接测试。
- 代码风格：2 空格缩进、分号结尾、单引号、文件与目录 kebab-case、每个文件顶部一句职责注释。

## 目录结构

```text
sch/
├── index.html              # 应用外壳
├── server.mjs              # 零依赖静态服务器（导出 createServer 供测试）
├── package.json            # 无依赖，scripts: start / test
├── .gitattributes          # 统一 LF 换行
├── src/
│   ├── main.js             # bootstrap(root) 启动入口
│   ├── core/               # ID、几何、事件总线、命令栈、schema
│   ├── model/              # 工程数据与纯函数、状态仓库
│   ├── library/            # 符号库与封装库（含内置数据）
│   ├── netlist/            # 连通性分析、ERC 与四种网表导出
│   ├── render/             # 视图变换、画布渲染、主题、网格、符号绘制
│   ├── editor/             # 吸附、可撤销命令、编辑器与工具
│   ├── io/                 # 工程序列化、SVG / PNG 导出
│   └── ui/                 # 菜单/工具栏/面板/对话框/样式，含示例入口
├── examples/
│   ├── demo-led.json       # LED 示例（VCC → 220R → LED → GND）
│   └── demo-mcu.json       # MCU 最小系统示例
├── docs/
│   ├── ARCHITECTURE.md     # 分层架构与 ADR
│   ├── CONTRACTS.md        # 接口契约（唯一权威）
│   ├── USAGE.md            # 使用教程（含截图与 FAQ）
│   └── images/             # 界面截图
└── test/                   # node:test 用例（镜像 src/ 的层目录）
```

## 运行与测试

```bash
node server.mjs     # 启动静态服务器，默认仅监听 127.0.0.1:8080
npm test            # 等价 node --test，运行 test/ 下全部用例
npm run smoke       # 启动随机端口服务器并冒烟请求全部静态资源
```

- 运行环境：Node.js 22+（使用内置 `node:test` 与 JSON 模块动态导入）；浏览器需现代 Chrome / Edge（支持 JSON 模块动态导入，约 123+）。旧版浏览器仍可启动编辑器，打开示例时会在对话框提示升级。
- 默认只监听回环地址；需要在局域网访问时显式放开：`HOST=0.0.0.0 node server.mjs` 或 `node server.mjs --host 0.0.0.0`。以点开头的路径段（`.git`、`.agent-teams`、`.env` 等）一律返回 404。
- 全部用例当前 362 个，`npm test` 全绿；纯逻辑层（core/model/library/netlist/render 的纯函数/io 序列化）不依赖 DOM，可直接在 Node 中测试。
- 服务器冒烟：`node server.mjs` 后访问 `/`、`/src/main.js`、`/examples/demo-led.json` 应返回 200 与正确 MIME。

## Git 规范

- conventional commits：`<type>(<scope>): <简述>`（feat / fix / test / docs / chore / refactor），一个提交只做一件事。
- 只暂存自己负责的路径；禁止 `git add -A`、`--amend`、`rebase`、`reset --hard`、切分支与 push。
- 提交前运行 `npm test`；URL 与临时文件不进入仓库。

## 已知限制

- 连接判断基于几何重合（容差 1e-6 mm），不包含总线、层次化图纸、差分对等高级概念；导线交叉但未落结点不会误连。
- 撤销采用整工程快照（命令 `do/undo` 深拷贝），超大工程会随历史深度增加内存占用；可通过 `CommandStack` 的 `maxDepth` 限制。
- ERC 只覆盖 6 类基础检查，不做电气规则全量校验（如驱动能力、扇出、时序）。
- 封装编辑器支持焊盘与基本图形，不含 3D 预览、封装 DRC 或自动布线。
- SVG 导出标题栏为简化排版；PNG 依赖 Canvas，导出分辨率为固定 2 倍。
- 示例数据通过动态 `import()` 按需加载 JSON 模块；不支持 JSON 模块的旧浏览器不会白屏，仅「打开示例」时提示升级。
- 工程草稿只保存一份（localStorage key `schematic-studio:draft`），不支持云端同步或多工程库。
- 未实现网表反向导入与 PCB 布局。
