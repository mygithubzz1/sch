# T12 最终交付清单

- 项目：原理图工作室（schematic-studio），`C:\workspace\sch`
- 交付形态：零依赖、零构建的原生 ES Modules 单页应用 + 静态服务器 + 自动化测试
- 本清单中的命令均在 2026-11-16 于本机真实执行，输出为实际结果（Node v24、Chrome headless）
- 运行入口：`node server.mjs` → <http://127.0.0.1:8080>（默认仅监听回环）

## 1. 验收摘要

| 项目 | 结果 |
| --- | --- |
| 单元/集成测试 | **413 passed / 0 failed**（`npm test`，exit 0） |
| 服务器冒烟 | **91/91**（`npm run smoke`；T11 基线 83 项 + 本次拆分新增 8 个 UI 模块资源检查） |
| 浏览器主流程 | **12/12 通过，控制台 0 错误**（`npm run verify:browser`，headless Chrome + CDP） |
| 安全复验 | `/.git/config`、`/.agent-teams/**` 返回 **404**；`/src/main.js`、`/examples/demo-led.json` 返回 **200**；监听 **127.0.0.1** |
| 网表端到端 | LED 示例 **3 网络 / 6 引脚 / 4 元件 / 0 警告**；JSON / CSV / KiCad / Protel 四种导出均真实产出 |
| 可维护性拆分 | `src/ui/app.js` 由约 1350 行收敛为 **347 行**，拆出 8 个职责单一模块；测试与主流程全绿 |
| 仓库卫生 | 无 `node_modules`、无 `.tmp*`、无调试 `console.log`、无 TODO/FIXME、根目录无遗留层目录 |
| Git 历史 | 63 个提交，全部符合 conventional commits，无临时文件误提交 |

## 2. 运行与测试（真实输出）

```text
$ npm test
ℹ tests 413
ℹ pass 413
ℹ fail 0

$ npm run smoke
[smoke] 通过 91/91 项检查（194ms）
[smoke] 服务器地址 http://127.0.0.1:31290

$ npm run verify:browser
PASS 打开 LED 示例 + 生成网表 — 网络 3 引脚 6 元件 4 警告 0
PASS 网表网络集合 VCC/N$1/GND — GND,N$1,VCC
PASS 导出 SVG 真实产出 — LED 指示灯-图纸 1.svg
PASS 放置 R/C/GND 三个符号 — C,GND,R
PASS 连线并自动生成 junction — {"wires":2,"junctions":1}
PASS 修改位号/值/封装 — 1k/R_0603
PASS 撤销恢复位号/值/封装修改 — R1/电阻/R_0805
PASS 导出 KiCad 网表 — 未命名工程-图纸 1.net
PASS 导出 CSV 网表 — 未命名工程-图纸 1.net.csv
PASS 封装编辑器放置焊盘 — 2 -> 3
PASS 退出封装编辑 — schematic
PASS 控制台 0 错误 — errors=0

通过 12/12 项
```

- `npm test`：`node --test` 递归执行 `test/` 下 58 个测试文件，覆盖 core/model/library/netlist/render/editor/io/ui/integration/scaffold。
- `npm run smoke`：用 `createServer` 在随机端口启动，请求首页、样式、84 个 `src/` 模块与 2 份示例 JSON，断言状态码、Content-Type、`Cache-Control: no-store` 与字节一致。
- `npm run verify:browser`：启动随机端口服务器与 headless Chrome，用 CDP 驱动真实界面；需本机 Chrome/Edge（可用 `CHROME_PATH` 指定），证据截图见 `docs/review/browser-main-flow.png`。

## 3. 安全复验（D1 修复后）

命令：`node` 内用 `createServer(ROOT)` 监听 `127.0.0.1:0`，再 `fetch`：

```text
SERVER_LISTEN 127.0.0.1:44005
GET /.git/config -> 404 expected 404 type=text/html; charset=utf-8 bytes=242
GET /.agent-teams/schematic-studio/team.json -> 404 expected 404 type=text/html; charset=utf-8 bytes=242
GET /src/main.js -> 200 expected 200 type=text/javascript; charset=utf-8 bytes=919
GET /examples/demo-led.json -> 200 expected 200 type=application/json; charset=utf-8 bytes=2593
GET /docs/review/browser-flow.html -> 200 expected 200 type=text/html; charset=utf-8 bytes=696
```

结论：默认监听回环；点开头的敏感路径一律 404 且不泄露内容；业务资源与示例正常 200。

## 4. CJK 小字号重叠修复证据

- 根因：世界坐标文本在 `dpr * scale` 变换下以 1.27px 局部字号绘制，Chrome/Skia 把字形步进量化到 1px，CJK 相邻字形重叠约 21%。
- 修复：新增 `src/render/text.js`，以 8 倍排版分辨率设字体再缩回，最终字号不变、字距正确；symbols/renderer/footprint-renderer 全部文本复用；全局标签边框按实测宽度绘制。
- 修复前证据：[docs/review/cjk-before.png](review/cjk-before.png)（1.27 mm 中文重叠）。
- 修复后证据：[docs/review/cjk-after.png](review/cjk-after.png)（同页面同参数无重叠；2.54 mm 文本不变）。
- 复现页：[docs/review/cjk-repro.html](review/cjk-repro.html)（`node server.mjs` 后访问）；细节见 [REVIEW.md](REVIEW.md) 第 3 节。
- 使用提示已写入 USAGE FAQ：默认 4 px/mm 时 1.27 mm 文本约 5 CSS px，阅读小字需放大或改用 2.54 mm。

## 5. 网表端到端证据

真实命令（读取 `examples/demo-led.json` → `deserializeProject` → `buildNetlist` → 四个导出器）：

```text
NETLIST demo-led ok=true nets=3 pins=6 components=4 warnings=0
  names=GND,N$1,VCC
  EXPORT json ext=net.json bytes=2997 JSON.parse ok
  EXPORT csv ext=net.csv bytes=100 header ok
  EXPORT kicad ext=net bytes=1126 (export ok
  EXPORT protel ext=net bytes=121 sections ok
NETLIST demo-mcu ok=true nets=16 pins=26 components=8 warnings=10
  names=+5V,GND,N$1,N$2,N$3,N$4,N$5,N$6,N$7,N$8,N$9,N$10,N$11,N$12,XTAL_IN,XTAL_OUT
```

- demo-led：GND（#PWR02.1、D1.2）/ N$1（D1.1、R1.2）/ VCC（#PWR01.1、R1.1），与 t9 示例和 USAGE 截图一致。
- demo-mcu：含 +5V、GND、XTAL_IN/XTAL_OUT 与 10 个未用引脚的 N$n 网络；10 条警告为故意保留的 FLOATING_PIN（演示 ERC）。
- 四种格式特征：JSON 可 `JSON.parse`；CSV 表头 `designator,pin,name,net`；KiCad 以 `(export` 开头；Protel 含 `[Components]` 与 `[NETLIST]`。

## 6. 浏览器主流程复验（真实界面）

命令：`npm run verify:browser`（headless Chrome，随机端口，真实鼠标/键盘事件 + 真实下载目录）。

| 步骤 | 结果 |
| --- | --- |
| 启动应用 → 关闭欢迎对话框 | 通过（脚本会点击「开始使用」） |
| 文件 → 打开示例：LED 指示灯 | 通过，工程名变为「LED 指示灯」 |
| 生成网表 | 通过：网络 3 / 引脚 6 / 元件 4 / 警告 0，网络为 GND、N$1、VCC |
| 文件 → 导出 SVG | 通过：真实下载 `LED 指示灯-图纸 1.svg`，含 `<svg` 与 `#PWR01` |
| 放置 R、C、GND 符号 | 通过：3 个实例（R/C/GND） |
| 导线工具连线 + 自动 junction | 通过：2 条导线、1 个 junction；引脚坐标由 store + 符号库计算 |
| 属性面板改位号/值/封装 | 通过：R1 → R9、值 1k、封装 R_0603 |
| 撤销 | 通过：三次撤销回到 R1 / 电阻 / R_0805 |
| 导出 KiCad / CSV | 通过：真实下载 `.net` 与 `.csv`，内容分别含 `(export` 与 `designator,pin,name,net` 表头 |
| 封装编辑 → 焊盘工具 → 画布点击 | 通过：焊盘数 2 → 3（编辑内置封装） |
| 返回原理图（未保存确认） | 通过：模式恢复 schematic |
| 控制台错误 | **0**（监听 Runtime.exceptionThrown / console.error / Log.entryAdded） |

证据截图：[docs/review/browser-main-flow.png](review/browser-main-flow.png)。

## 7. 功能矩阵

| 需求 | 实现位置 | 验证方式 | 结论 |
| --- | --- | --- | --- |
| 原理图绘制与编辑（放置/选择/框选/拖动/删除/旋转/镜像/标签/文本） | `src/editor/schematic-editor.js`、`src/editor/tools/*`、`src/editor/commands.js` | 浏览器主流程放置 R/C/GND；`test/editor/tools.test.mjs`、`test/editor/commands.test.mjs` | 通过 |
| 连线、端点吸附、自动 junction | `src/editor/snapping.js`、`src/editor/wire-utils.js`、`src/editor/tools/wire-tool.js` | 浏览器主流程（2 导线 / 1 junction）；`test/editor/snapping.test.mjs`、`test/editor/tools.test.mjs` | 通过 |
| 符号库 / 封装库 | `src/library/*`（18 符号 / 10 封装） | 浏览器打开示例并解析符号；`test/library/*` | 通过 |
| 封装绘制（焊盘/丝印/Courtyard/图层/编号） | `src/editor/footprint-editor.js`、`src/editor/footprint-tools/*`、`src/render/footprint-renderer.js` | 浏览器主流程焊盘 2→3；`test/editor/footprint-editor.test.mjs` | 通过 |
| 连通性分析与 ERC | `src/netlist/connectivity.js`、`src/netlist/erc.js` | 网表端到端（3/6/4/0、16/26/8/10）；`test/netlist/*` | 通过 |
| 网表导出 JSON / CSV / KiCad / Protel | `src/netlist/index.js`、`src/ui/dialogs/export-dialog.js` | 真实下载 KiCad/CSV；四格式字节与特征断言；`test/netlist/exporters.test.mjs` | 通过 |
| SVG / PNG 导出 | `src/io/svg-export.js`、`src/io/svg-primitives.js`、`src/io/png-export.js` | 浏览器真实下载 SVG；`test/io/svg-export.test.mjs`、`test/io/png-export.test.mjs` | 通过 |
| 工程保存 / 读取 / 草稿 | `src/io/project-io.js`、`src/ui/file-actions.js` | 序列化/反序列化/损坏 JSON/往返网表 deepEqual；`test/io/project-io.test.mjs`、`test/integration/serialization-e2e.test.mjs` | 通过 |
| 撤销 / 重做 | `src/core/command.js`、`src/model/store.js`、`src/editor/commands.js` | 浏览器撤销位号/值/封装；命令栈分支截断单元测试 | 通过 |
| 多图纸 / 界面外壳 / 快捷键 | `src/ui/**`、`src/ui/styles.css` | `test/ui/*`；浏览器主流程覆盖菜单/工具栏/面板/封装模式 | 通过 |
| 示例工程与文档 | `examples/*.json`、`docs/USAGE.md`、`README.md` | 示例严格校验；文档与三张截图逐条核对 | 通过 |

## 8. 可维护性收尾（组合根拆分）

- `src/ui/app.js`：**1350 → 347 行**，只保留上下文、装配顺序、事件接线、销毁与返回 API。
- 新增模块（单文件均 < 250 行）：
  - `src/ui/chrome-sync.js`：派生状态、状态栏/工具栏/模式栏、空图纸提示、库签名。
  - `src/ui/editor-setup.js`：编辑器创建、吸附开关包装、封装编辑器事件、尺寸调度、指针状态。
  - `src/ui/footprint-mode.js`：封装模式进入/退出、工具、保存/新建/编辑封装。
  - `src/ui/file-actions.js`：新建/打开/保存/另存/恢复、示例、SVG/PNG/封装库/网表导出、网表生成与定位。
  - `src/ui/edit-actions.js`：工具切换、放置、撤销重做、删除/全选、缩放适配、吸附、旋转镜像、工程属性。
  - `src/ui/sheet-actions.js`：图纸新建/重命名/删除。
  - `src/ui/toolbar-actions.js`：菜单与工具栏动作表。
  - `src/ui/ui-utils.js`：`messageOf`/`readFileText`。
- 约束保持：所有模块只通过 `ctx` 访问共享状态；UI 仍只经 store/editor/commands 改数据；未新增跨层依赖；导入图测试与分层扫描通过（`src/` 84 个 JS 模块）。
- 顺手修复（评审发现之外）：`openModal` 之前忽略传入的按钮节点，导致网表导出对话框的「复制 / 下载文件」实际无效——已修复并纳入浏览器主流程回归。

### 保留项与后续方案（不在本轮强拆）

| 文件 | 现状 | 原因 | 后续方案 |
| --- | --- | --- | --- |
| `src/ui/panels/properties-panel.js`（891 行） | 多实体属性表单集中，分支多 | 拆分需同步改造 UI 测试与焦点/绑定逻辑，交付窗口内风险高于收益 | 按实体拆 `property-forms/{symbol,wire,label,text,sheet,footprint}.js`，面板只做调度；配套快照测试后分步迁移 |
| `src/netlist/connectivity.js`（749 行） | 并查集、命名、电源/标签规则集中 | 核心算法已被 39+ 用例覆盖，拆分收益主要体现在阅读体验 | 抽出 `netlist/union-find.js` 与 `netlist/naming.js`，保持 `buildConnectivity` 等公共 API 不变，再迁移测试 |
| `src/editor/tools/*`、`src/editor/footprint-tools/*` 幽灵图形回退色（R3，low） | `#4ea1ff` 等 10 余处回退值 | 渲染层已完全主题化，回退值仅在主题缺键时生效，不影响当前界面 | 集中为 `editor/overlay-colors.js` 常量（无行为变化，可单测），随下次编辑器改动一并落地 |

## 9. 仓库卫生

| 检查 | 结果 |
| --- | --- |
| `console.log` / `debugger` / TODO / FIXME | `src/` 扫描无命中（启动日志已移除；错误路径保留 `console.error`） |
| 临时文件 / 依赖目录 | 无 `node_modules`、无 `.tmp*`；`.gitignore` 覆盖 `node_modules/`、`.tmp/`、`dist/`、`*.log`、`.agent-teams/`、系统文件 |
| 根目录结构 | 仅 `index.html`、`server.mjs`、`package.json`、`.gitignore`、`.gitattributes`、`README.md`、`src/`、`test/`、`docs/`、`examples/`、`scripts/`；无遗留根级层目录 |
| 未使用文件 | `docs/review/cjk-repro.html`（复现证据）、`browser-flow.html`（验证装配页）、截图与脚本均有引用 |
| 文档与截图 | USAGE 截图（schematic-editing.png / netlist-panel.png）与 LED 示例一致；README 顶部 app-overview.png；CJK 前后对比图在 docs/review |
| README 同步 | 测试数 413、`npm run smoke`、`npm run verify:browser`、默认 127.0.0.1、点路径 404、示例动态导入均已同步 |

## 10. Git 历史摘要

- 提交总数：**65**（含本清单定稿提交及其后的 2 个 docs 修订提交）。
- 类型分布：`feat` 24 / `test` 13 / `docs` 14 / `fix` 8 / `chore` 5 / `refactor` 1 = **65**。
- 复算命令：`git rev-list --count HEAD` 与 `git log --pretty=format:%s | ...`（上方数字为实际输出）。
- 非 conventional 提交：**0**（全部匹配 `<type>(<scope>): 简述` 或 `<type>: 简述`）。
- 未发现临时文件/构建产物/依赖目录被提交；未使用 `--amend`、`rebase`、`reset --hard`、切分支或 push。
- T12 收尾提交：

```text
11c5687 refactor(ui): 拆分 app.js 为组合根与独立动作模块
f66c0dd fix(ui): 导出网表对话框的复制/下载按钮未挂载
bc1e30a test(browser): 新增 headless Chrome 主流程验证与证据
c93713a chore: 移除应用启动的调试 console.log
6fb9c58 docs(final): 新增 T12 最终交付清单并同步 README
5d897ea docs(final): 补充评审遗留 R3（编辑器回退色）处理说明
（本统计校准提交为第 7 个 T12 收尾提交）
```

## 11. 已知限制

- 连接判断基于几何重合（容差 1e-6 mm），不含总线、层次化图纸、差分对；导线交叉但未落结点不会误连。
- 撤销采用整工程快照，超大工程内存随历史深度增长；可用 `CommandStack.maxDepth` 限制。
- ERC 只覆盖 6 类基础检查（悬空引脚、单脚网络、重复位号、缺封装、未连接导线、电源冲突）。
- 封装编辑器支持焊盘/线/矩形与丝印、Courtyard、Assembly、Fab 图层，不含 3D、封装 DRC 或自动布线。
- SVG 标题栏为简化排版；PNG 固定 2 倍分辨率并依赖 Canvas。
- 示例通过动态 JSON 模块导入；不支持 `import()` JSON 模块的旧浏览器仍可启动，但打开示例会提示升级。
- 工程草稿只有一份（localStorage key `schematic-studio:draft`），无云端同步或多工程库。
- `properties-panel.js`（891 行）与 `connectivity.js`（749 行）的大文件拆分方案见第 8 节，属后续维护项。
- 浏览器端到端脚本依赖本机 Chrome/Edge（`CHROME_PATH` 可覆盖），不作为 `npm test` 的默认步骤。

## 12. 复验命令清单

```bash
node server.mjs                 # 默认 http://127.0.0.1:8080
npm test                        # 413 passed
npm run smoke                   # 91/91
npm run verify:browser          # 12/12（需本机 Chrome/Edge）
```
