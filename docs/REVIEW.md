# T11 代码评审与修复报告

- 评审对象：`C:\workspace\sch` 原理图工作室（schematic-studio）
- 评审基线：`a724db9`（T10 完成时，npm test 404 通过）
- 评审范围：src/ 全部 76 个模块、test/ 51 个测试文件、docs/（README、ARCHITECTURE、CONTRACTS、USAGE）、examples/、server.mjs、scripts/
- 评审方法：逐层契约核对 → 静态检查（导入图/分层/文件规模/重复实现/硬编码）→ 鲁棒性脚本 → 真实浏览器端到端 → 文档与截图比对 → 按严重度逐项修复（一修一提交）

## 1. 结论摘要

| 类别 | 结果 |
| --- | --- |
| 契约一致性 | docs/CONTRACTS.md 逐模块核对，**0 项缺失**（27 个模块、全部约定函数/常量/类方法） |
| 分层依赖 | 76 模块 / 233 条导入边 / **0 条反向依赖**（core→model|library→netlist|render→editor→io→ui） |
| 测试 | 修复前 404 → 修复后 **413 passed / 0 failed**；`npm run smoke` 83/83 通过 |
| 必修项 | A（小字号中文重叠）、B（UI 测试白名单）均修复并有真实浏览器证据 |
| 必修缺陷（T10 清单） | D1 / D2 / D3 / D4 / D5 / D6 全部修复，含 7 个独立修复提交 |
| 文档一致性 | 两张 USAGE 截图按 LED 示例重新生成；README/USAGE 中服务器地址、浏览器要求、测试数、示例导入方式全部同步 |
| 遗留 | 3 个超大文件（app.js 1350 行等）与少量低优先级可维护性建议，见第 7 节 |

## 2. 发现与处理清单

严重度：blocker = 安全/正确性，high = 用户可见缺陷，medium = 可维护性/一致性，low = 建议。

| ID | 严重度 | 位置 | 问题 | 结论 |
| --- | --- | --- | --- | --- |
| D1 | blocker | server.mjs | 静态根为仓库根且默认监听 `::`，`/.git/config`、`/.agent-teams/**` 可被下载 | 已修复（回环默认 + 点路径 404 + 测试） |
| D2 | high | src/io/svg-export.js | 未显式传符号库时直接导出 demo-led 会得到 4 个 `symbol-missing` 占位框 | 已修复（内置符号兜底 + 回归断言） |
| D3/B | medium | test/ui/shell.test.mjs | `src/ui/example-projects.js` 不在 UI_FILES；examples/ 导入缺少显式白名单规则 | 已修复（白名单 + 纳入检查，保留「UI 只引用 src 模块」约束） |
| D4 | medium | src/editor/index.js | 编辑器层门面未被 src/main.js 链路引用（74/75 可达），存在双入口风险 | 已修复（UI 统一经 `../editor/index.js` 引用） |
| D5/A | high | src/render/symbols.js、renderer.js、footprint-renderer.js | 1.27 mm 中文在 Canvas 上字距被量化、字形重叠 | 已修复（高分辨率排版 + measureText 量宽），见第 3 节 |
| D6 | high | src/ui/example-projects.js | 静态 `import ... with { type: 'json' }` 在不支持 import attributes 的浏览器整站白屏 | 已修复（动态 import + 友好对话框降级） |
| R1 | medium | docs/images/*.png | USAGE 称截图为「LED 示例 + 文件菜单含打开示例」，旧截图实际是「UI 端到端验收」且菜单无示例入口 | 已修复（重新生成 schematic-editing.png、netlist-panel.png） |
| R2 | low | README/USAGE | localhost/默认监听、浏览器版本、测试数 362、示例静态导入等描述过期 | 已修复（随文档提交同步） |
| R3 | low | src/editor/tools/* | 幽灵图形主题色回退值（`#4ea1ff` 等）分散在多个工具 | 保留（建议集中常量），见第 7 节 |
| R4 | medium | src/ui/app.js（1350 行）等 3 个文件 | 单文件超 400 行，圈复杂度偏高 | 保留（拆分风险大于收益），见第 7 节 |

## 3. 必修项 A：小字号中文重叠

### 3.1 根因

世界坐标文本在已应用 `dpr * scale` 的变换下以「世界单位字号」绘制（1.27 mm 文本 = `1.27px` 字体）。Chrome/Skia 在局部字号过小时会把**字形步进量化到 1px**：1.27px 的 CJK 文本实际按 1px 步进排版，相邻字形相互覆盖约 21%，表现为重叠/挤压（与缩放、DPR 无关，只与「局部字号 < 2px」有关）。

最小复现（`docs/review/cjk-repro.html`，DPR=2，真实 Chrome）：

- 修复前：`docs/review/cjk-before.png`（scale 4 左图：1.27mm 中文注释、标签、R1 值均出现叠字）
- 修复后：`docs/review/cjk-after.png`（同页面同参数：字形与字距正确，2.54mm 文本不变形）

### 3.2 修复

1. 新增 `src/render/text.js`：`drawCanvasText` 以 **8 倍排版分辨率**设置字体（`size * 8`），再用 `ctx.scale(1/8)` 缩回，最终字号不变但字体度量在安全区间计算，彻底消除步进量化；`measureCanvasText` 用相同排版测量回归世界单位宽度。
2. 所有 Canvas 文本统一走该辅助：`render/symbols.js`（引脚名/号、图形文字）、`render/renderer.js`（位号、值、网络标签、自由文本）、`render/footprint-renderer.js`（焊盘编号、封装图形文字）。
3. 全局标签边框宽度由 `measureCanvasText` 实测（不可用时回退 `measureTextWidth` 估算），避免文字溢出标签框。

### 3.3 验证

- 真实浏览器：`node server.mjs`（127.0.0.1:8125）+ headless Chrome（DPR=2）渲染 `docs/review/cjk-repro.html`，前后截图见上；1.27 mm 中文在 scale 4/8 下均无重叠。
- 单元测试：新增 `test/render/text.test.mjs`（4 用例）验证 8 倍排版、缩放回退顺序、空文本、测量一致性与旋转顺序。
- 受限条件（已写入 USAGE FAQ）：默认视图 4 px/mm 时 1.27 mm 文本仅约 5 CSS px，可读性受屏幕限制；**渲染不再重叠**，阅读小字需放大到 8 倍以上或改用 2.54 mm 字号。

## 4. 必修项 B：UI 测试白名单与 examples 导入

- `test/ui/shell.test.mjs` 的 `UI_FILES` 增加 `example-projects.js`（文件齐备性、首行注释、Node 可导入、依赖方向检查全部覆盖）。
- 新增规则 `DATA_IMPORT_ALLOWED_FILES = {'example-projects.js'}` 与 `DATA_IMPORT_PATTERN = /^\.\.\/\.\.\/examples\/[a-z0-9-]+\.json$/`：
  - 只有白名单文件可以导入 `examples/*.json`，且必须是**存在的 JSON 数据文件**（数据导入，不是模块依赖）；
  - 其它 import 仍必须解析到 `src/` 下合法层，**「UI 只能引用 src/ 模块」约束原样保留**；
  - 额外扫描 UI 源码里的 examples 字面量，防止绕过 import 语法。
- 新增 3 个用例：白名单/越界规则、动态 JSON 导入静态检查（禁止静态 import attributes、必须 try/catch）、`loadExampleProject` 真实动态加载与未知 id 结构化错误。

## 5. 其他修复项（D1/D2/D4/D6）

### D1 静态服务器安全

- `startServer` 默认监听 `127.0.0.1`；仅 `--host` / `HOST` / `options.host` 显式放开；新增 `resolveHost`/`resolvePort`（端口 0 表示系统分配）。
- `resolveRequestPath` 对任何以点开头的路径段返回 **404**（`.git`、`.agent-teams`、`.env`、`.vscode` …）；`..` 穿越仍为 403。
- 保留 `/index.html`、`/src/**`、`/examples/**`、`/docs/images/**` 正常 200。
- 测试（test/scaffold.test.mjs +3）：点路径 404 且不泄露内容、正常资源 200、默认绑定 127.0.0.1、`--host`/`HOST` 放开、随机端口。

### D2 SVG 导出符号解析

- `projectToSVG` 的解析顺序统一为：`symbolResolver` > `project.library` / `options.symbols` / `options.library` > **builtinSymbols() 兜底**；新增 `useBuiltinSymbols:false` 严格模式。
- 回归断言：`examples/demo-led.json` 直接导出 **不含 `symbol-missing`**；未知符号仍绘制占位框。

### D4 编辑器门面

- `src/ui/app.js` 的 4 个 editor 深层导入合并为 `import { ... } from '../editor/index.js'`，编辑器层门面成为唯一入口（导入图 76/76 可达）。

### D6 示例动态导入

- `src/ui/example-projects.js` 改为 `load: () => import('../../examples/demo-led.json', { with: { type: 'json' } })` 按需加载；`loadExampleProject(id)` 返回 `{id,label,data,error}`，失败不抛异常。
- `app.js openExample` 失败时弹出「无法打开示例工程」并提示升级浏览器，不再白屏。
- README/USAGE/FAQ 同步最低浏览器版本与降级行为。

## 6. 常规评审结论

### 6.1 契约一致性

对 27 个契约模块逐一用脚本核验（函数/类/常量/对象字段）：`core/id|geometry|event-bus|command|schema`、`model/project|store`、`library/*`、`netlist/connectivity|index`、`render/view|theme|grid|symbols|renderer|footprint-renderer`、`editor/snapping|commands|schematic-editor|footprint-editor`、`io/project-io|svg-export|png-export`、`ui/app`。

- 缺失接口：**0**
- `DEFAULT_THEME` 契约 18 键齐全；`EXPORTERS` 四项均含 `id/label/extension/mime/generate`；`store` 契约 17 个成员齐全。
- 文档 `docs/CONTRACTS.md` 已统一为 `src/` 前缀（架构文档在 T11 前已修正），实现与契约无偏差。

### 6.2 分层与耦合

- 导入图：76 模块 / 233 边 / 0 反向依赖（脚本按层权重复核：core 0 → model|library 1 → netlist|render 2 → editor 3 → io 4 → ui 5）。
- UI 修改数据全部经 `store.update`（命令栈）或封装命令；editor 工具只通过 `ctx.commands` 修改数据（`commands.js` 内是唯一 `sheet.*.push` 的地方）；io 不引用 editor/ui；render 不引用 editor/io/ui。
- 几何无重复实现：UI 缩略图与 SVG 导出都复用 `render/symbols.js` 的 `drawSymbol`/`drawSymbolPrimitives`；序列化只有 `io/project-io.js` 一份。
- 文件位置：src 顶层正好 8 个层目录 + main.js；仓库根仅 server.mjs（scripts/ 为工具脚本），无遗留根级 library/render 目录（T10 分层测试覆盖）。

### 6.3 鲁棒性矩阵（脚本实跑）

| 场景 | 结果 |
| --- | --- |
| 空工程 / 空 sheet | `buildNetlist` ok=true、0 网络 0 警告；`projectToSVG` 正常输出 A4 页面；渲染器显示网格与标题栏 |
| 引用已删除符号（symbolId 不存在） | 网表返回 `UNKNOWN_SYMBOL` 警告、不抛异常；渲染器画虚线占位框；SVG 输出 `symbol-missing` |
| 重复位号 | ERC 输出 `DUPLICATE_DESIGNATOR`（2 条），网表仍可生成 |
| 缺失封装 | ERC 输出 `MISSING_FOOTPRINT`；导出器正常 |
| 损坏/空/数组/null JSON | `deserializeProject` 全部返回 `{project:null, warnings:[...]}`，无抛出；schemaVersion=99 返回 7 条可读警告 |
| 序列化往返 | 往返后网表 deepEqual；`serializeProject` 不修改入参 |
| 非法缩放/尺寸 | view 层限制 0.05~20；PNG 导出非法 scale 以 RangeError 拒绝 |

### 6.4 真实浏览器主流程

- 环境：`node server.mjs`（127.0.0.1:8125）+ headless Chrome（CDP），1662×904 视图。
- 步骤与结果：关闭欢迎对话框 → 文件菜单（12 项，含两个「打开示例」）→ 打开 LED 示例（动态 JSON 导入成功，工程名变为「LED 指示灯」）→ 工具菜单生成网表 → 底部面板显示「网络 3 · 引脚 6 · 元件 4 · 警告 0」，网络为 GND（#PWR02.1、D1.2）/ N$1（D1.1、R1.2）/ VCC（#PWR01.1、R1.1）→ 截图 `docs/review/browser-flow.png`。
- 控制台错误 / 未捕获异常 / 未处理 Promise：**0**（CDP Runtime.exceptionThrown + console.error + Log.entryAdded 监听）。

### 6.5 文档与截图一致性

- USAGE 截图说明与 LED 示例文案一致：重新生成 `docs/images/schematic-editing.png`（文件菜单展开、含「打开示例」、工程名「LED 指示灯」、电路 VCC→R1 220R→D1 LED→GND）与 `docs/images/netlist-panel.png`（网表 3/6/4/0，GND 与 N$1 展开）。
- `README.md`：服务器默认地址改为 127.0.0.1:8080、补充 HOST 放开与点路径 404 说明、测试数 362→413、示例导入改为动态导入描述。
- `docs/USAGE.md`：启动地址、浏览器版本、打开示例菜单项、FAQ 中的静态导入描述、1.27 mm 小字说明全部同步。
- 三张截图均可在当前代码下复现（截图为真实运行，非手绘）。

## 7. 遗留问题与建议（未在本轮修复）

| 严重度 | 位置 | 现状 | 建议 |
| --- | --- | --- | --- |
| medium | src/ui/app.js（1350 行） | 应用装配、文件命令、示例、导出、封装模式等集中在一个闭包，可读性下降 | 按「文件命令 / 导出 / 封装模式」拆出 `ui/file-actions.js`、`ui/export-actions.js`，通过依赖注入保持行为；需配套 UI 测试后再拆 |
| medium | src/ui/panels/properties-panel.js（891 行） | 多类型属性表单集中，分支多 | 按实体类型拆 `property-forms/`（symbol/wire/label/text/sheet/footprint），面板只做调度 |
| medium | src/netlist/connectivity.js（749 行） | 并查集、命名、电源/label 规则集中；T5 自测充分 | 抽出 `netlist/naming.js` 与 `netlist/union-find.js`，保持 `buildConnectivity` 公共 API 不变 |
| low | src/editor/tools/*、footprint-tools/* | 幽灵图形主题色回退值（`#4ea1ff`、`#ffd166` 等）散落 10 余处 | 集中为 `editor/overlay-colors.js` 常量（渲染层已完全主题化，不违反「渲染器不硬编码颜色」） |
| low | src/render/text.js | 8 倍排版分辨率对超小字号（<0.25 mm）仍有极限 | 现有数据最小字号 0.4 mm，可接受；如未来支持更小字号，按 `Math.ceil(2 / size)` 动态提高分辨率 |
| low | 全局 | 撤销使用整工程快照，超大工程内存随历史增长 | 已由 `CommandStack.maxDepth` 限制；后续可改为实体级差量命令 |
| low | 测试 | 浏览器端到端脚本未入库（本次以 CDP 临时脚本验证，截图入库） | 如需 CI 可把 `docs/review/cjk-repro.html` 的截图与主流程脚本参数化纳入 `scripts/` |

## 8. 指标汇总

| 指标 | 数值 |
| --- | --- |
| src 模块数 | 76（8 层 + main.js） |
| src 总行数 | 14774 |
| 导入边 / 反向依赖 | 233 / 0 |
| 测试文件 / 用例 | 51 / 413（全部通过） |
| 测试代码行数 | 7276 |
| 最大文件 | src/ui/app.js 1350 行；properties-panel.js 891；connectivity.js 749 |
| 服务器冒烟 | 83/83 资源检查通过 |
| 提交数 | 58（本次评审新增 9 个提交，见附录） |
| 临时文件误提交 | 0（`git log --all --name-only` 扫描无 tmp/temp/node_modules） |

## 9. 验证命令与输出

```text
$ npm test
ℹ tests 413  ℹ pass 413  ℹ fail 0   （exit 0）

$ npm run smoke
[smoke] 通过 83/83 项检查（137ms）   （exit 0）

$ node server.mjs            # 输出 http://127.0.0.1:8080，仅监听回环
$ GET /.git/config           # 404（修复前 200）
$ GET /.agent-teams/...      # 404（修复前 200）
$ GET /src/main.js           # 200 text/javascript
$ GET /examples/demo-led.json# 200 application/json
```

浏览器验证（headless Chrome + CDP）：控制台错误 0；网表面板「网络 3 引脚 6 元件 4 警告 0」；证据 `docs/review/browser-flow.png`。

## 10. Git 历史审查

- 56 个既有提交按主题拆分（脚手架 / core+model / library / render / netlist / editor / io / ui / examples+docs / 集成测试 / 冒烟），无「一锅端」提交；每条修复提交只包含对应文件。
- 未发现误提交临时文件、构建产物、依赖目录；仓库根只有 `server.mjs` 一个脚本（`scripts/smoke.mjs` 在 scripts/ 下）。
- 本次 T11 新增提交（一修一提交）：
  1. `8de363a` fix(render): 修复小字号中文文本在 Canvas 上字距量化重叠（含 text.js、test/render/text.test.mjs、docs/review 证据）
  2. `3636a51` fix(server): 默认仅监听回环并拒绝点开头的敏感路径
  3. `9034e2d` fix(io): SVG 导出未显式传符号库时回退内置符号
  4. `cd26288` fix(editor): UI 统一经 editor/index.js 门面引用编辑器层
  5. `99eac43` fix(ui): 示例工程改为动态 JSON 导入并在旧浏览器友好降级
  6. `76cd30f` test(ui): 将 examples 定义为数据导入白名单并覆盖动态导入降级
  7. `aca08fe` chore(pkg): 增加 npm run smoke 冒烟脚本入口
  8. `446992b` docs(images): 按 LED 示例文案重新生成原理图与网表界面截图
  9. `7011d32` docs(review): 新增 T11 评审报告并同步 README/USAGE 文档（本文件首版；随后的修订提交仅补记哈希与提交数）

## 11. 证据文件

| 文件 | 说明 |
| --- | --- |
| docs/review/cjk-before.png | 修复前：1.27 mm 中文重叠（DPR=2，scale 4/8） |
| docs/review/cjk-after.png | 修复后：同参数无重叠，2.54 mm 文本保持原样 |
| docs/review/cjk-repro.html | 复现页面（`node server.mjs` 后访问 `/docs/review/cjk-repro.html`） |
| docs/review/browser-flow.png | 真实浏览器主流程：LED 示例 + 网表 3/6/4/0 |
| docs/images/schematic-editing.png、netlist-panel.png | 重新生成的 USAGE 截图 |
