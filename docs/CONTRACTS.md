# 接口契约（全队唯一权威，实现必须一致）

> 维护规则：本文件是全队唯一的接口权威文档，任何实现与本文不一致时以本文为准。
> 修改契约必须同步修改本文件并在团队内广播；如发现契约缺陷，请在自己的模块内做兼容，并在任务汇报中说明。
> 目录路径均相对仓库根目录；`src/main.js` 只负责启动引导。

## core/id.js

    export function uid(prefix = 'id')  // 形如 "R-1a2b3c-7"，进程内唯一、可读

## core/geometry.js   纯函数，点 = {x:number, y:number}

    pt(x,y) add(a,b) sub(a,b) scale(a,k) dist(a,b) len(a)
    snapV(v,grid) snapPt(p,grid) rotatePoint(p,deg,origin) mirrorPoint(p)
    segmentDistance(p,a,b) pointInRect(p,rect) rectFromPoints(a,b) rectsIntersect(a,b)
    bboxOfPoints(points) -> {x,y,w,h}
    transformPoint(p, {x,y,rotation,mirror})   // 顺序：mirror -> rotate(deg) -> translate

## core/event-bus.js

    export function createBus() -> { on(name,fn)->off, off(name,fn), emit(name,payload), clear() }

## core/command.js

    命令对象 = { label:string, do(), undo() }
    export class CommandStack {
      constructor(state)     // state 传给命令的 this.state
      execute(cmd)  undo()  redo()  canUndo()  canRedo()  onChange(fn)->off  clear()
    }

## core/schema.js

    export const SCHEMA_VERSION = 1
    export function validateProject(json) -> { ok:boolean, errors:string[] }
    export function migrateProject(json)  // v1 原样返回

## model/project.js  纯数据 + 纯函数，禁止 import DOM

    createProject(name?) createSheet(name?) createSymbolInstance(partial) createWire(points)
    createJunction(x,y) createLabel(partial) createText(partial) clone(json)
    Project = { schemaVersion:1, name, units:'mm', grid:2.54, sheets:[Sheet], library:{symbols:[],footprints:[]}, meta:{created,modified} }
    Sheet = { id, name, symbols:[SymbolInstance], wires:[Wire], junctions:[Junction], labels:[Label], texts:[Text],
              title:{ title, company, rev, date, comments } }
    SymbolInstance = { id, symbolId, designator, value, x, y, rotation:(0|90|180|270), mirror:boolean, footprintId:string|null, fields:{} }
    Wire = { id, points:[Point], width:number }
    Junction = { id, x, y }
    Label = { id, x, y, rotation, text, kind:'local'|'global' }
    Text = { id, x, y, rotation, text, size }
    SymbolDef = { id, name, refPrefix, description, power:boolean, pins:[Pin], graphics:[Graphic] }
    Pin = { id, name, number, x, y, length,
            orientation:'left'|'right'|'up'|'down',        // 从连接端点 (x,y) 朝符号本体延伸的方向
            electricalType:'input'|'output'|'bidirectional'|'passive'|'power_in'|'power_out'|'open_collector'|'not_connected' }
    Graphic = {type:'line',points,width?,fill?} | {type:'polyline',points,width?,fill?} |
              {type:'rect',x,y,w,h,width?,fill?} | {type:'circle',cx,cy,r,width?,fill?} |
              {type:'arc',cx,cy,r,start:deg,end:deg,width?} | {type:'text',x,y,text,size?,rotation?}
    FootprintDef = { id, name, description, pads:[Pad], graphics:[FGraphic] }
    Pad = { id, number, x, y, w, h, shape:'rect'|'roundrect'|'circle'|'oval', rotation, layer:'top'|'bottom'|'tht', drill }
    FGraphic = Graphic + { layer:'silkscreen'|'courtyard'|'assembly'|'fab' }

## model/store.js   应用状态 + 撤销栈（无 DOM）

    export function createStore(project)
     -> { getProject(), setProject(p,{history}), getSheet(), getSheetId(), setSheetId(id),
          update(mutator,{label}) /* 通过 CommandStack 执行，可撤销 */,
          undo(), redo(), canUndo(), canRedo(),
          getSelection(), setSelection(ids), getHover(), setHover(id),
          commands /* CommandStack */, on(evt,fn)->off, emit(evt,payload) /* changed|selection|view|sheet */ }

## library/symbol-library.js + builtin-symbols.js

    createSymbolLibrary(symbols?) -> { add, remove, get(id), list(), search(q), toJSON(), fromJSON(json) }
    builtinSymbols() -> SymbolDef[]   // 至少 R C C_POL L D LED NPN PNP GND VCC +5V SW_PUSH CONN_2 CONN_4 XTAL OPAMP IC_8 MCU_16

## library/footprint-library.js + builtin-footprints.js

    createFootprintLibrary(footprints?) 同构；builtinFootprints() 至少 R_0402 R_0603 R_0805 C_0603 SOT-23 SOIC-8 DIP-8 PIN_HDR_1x2 PIN_HDR_1x4 QFP-32

## netlist/connectivity.js

    buildConnectivity(project, sheet) -> { nets:[Net], warnings:[{code,message,ref?}] }
    Net = { name, pins:[{ designator, pinNumber, pinName, symbolId, instanceId, sheetId }] }
    连接规则：导线端点/折点、引脚端点、junction、同名 label；power 符号(power:true 且引脚 electricalType=power_in/power_out)以其 pin.name 作为全局网络名(GND/VCC/+5V)
    命名优先级：电源名 > global label > local label > 自动 N$n

## netlist/index.js

    buildNetlist(project) -> { ok, nets, warnings, stats }
    export const EXPORTERS = { json, csv, kicad, protel }  // 每项 { id, label, extension, mime, generate(project)->string }
    kicad = KiCad 6+ S-表达式；protel = PCBNEW/Protel .net 文本(COMPONENTS/NETS)；csv = designator,pin,net 行

## render/view.js   纯函数

    createView() -> { offsetX, offsetY, scale }
    worldToScreen(view,p) screenToWorld(view,p) zoomAt(view, screenPt, factor) fitView(bbox,width,height,padding)

## render/renderer.js

    export class SchematicRenderer {
      constructor(canvas, options?)   // options:{ theme, grid }
      setState({ project, sheet })  setView(view)  getView()  setSelection(ids)  setHover(id)
      resize()  requestRender()  render()  worldToScreen(p)  screenToWorld(p)  fitToContent()
    }
    必须支持 devicePixelRatio 高清渲染；绘制网格、标题栏、符号图形/引脚/引脚名与号、位号与值、导线、junction 圆点、标签、文本、选中与 hover 高亮

## render/footprint-renderer.js

    export class FootprintRenderer   // 同构 API，绘制焊盘/丝印/courtyard/图层配色，支持焊盘选中

## render/theme.js

    export const DEFAULT_THEME = { background, grid, gridMajor, wire, junction, symbol, symbolFill, pin, pinText, label, labelGlobal, selection, hover, padTop, padBottom, padDrill, silk, courtyard }

## render/grid.js

    export function drawGrid(ctx, view, size, step)

## render/symbols.js

    export function drawSymbol(ctx, symbolDef, transform, theme, opts)   // 供画布与 SVG 导出复用

## editor/snapping.js   纯函数

    collectAnchors(project, sheet) -> Point[]   // 引脚端点、导线端点与折点、junction、标签锚点
    findSnapPoint(anchors, p, worldTol) -> Point|null
    snapToGrid(p, grid) -> Point

## editor/commands.js   全部可撤销命令

    addWireCommand(sheetId, points) removeEntitiesCommand(sheetId, ids) moveEntitiesCommand(sheetId, ids, delta)
    addSymbolCommand(sheetId, instance) setSymbolFieldCommand(sheetId, id, key, value) addLabelCommand(...)

## editor/schematic-editor.js

    createSchematicEditor({ canvas, store, renderer }) -> { setTool(name), getTool(), getActiveTool(),
      destroy(), focus(), refresh(), getStore(), getRenderer() }
    工具模块导出 = { id, cursor, onActivate(ctx), onDeactivate(ctx), onPointerDown(e), onPointerMove(e),
      onPointerUp(e), onDoubleClick(e), onKeyDown(e) }，ctx = { store, commands, editor, renderer,
      screenToWorld, worldToScreen, grid, bus }
    必须工具：select（点选/框选/拖动）、wire（连续画线、端点吸附、自动 junction、回车或双击结束）、
    place（放置符号，R 旋转、X 镜像、Esc 取消）、label、text、erase

## editor/footprint-editor.js

    createFootprintEditor({ canvas, store, renderer })  // 工具：select、pad（放焊盘）、move、graphic（画丝印线/矩形），支持新建/删除焊盘与编号递增

## io/project-io.js

    serializeProject(project)->string  deserializeProject(text)->{project,warnings}
    saveToLocalStorage(key,project) loadFromLocalStorage(key) downloadText(name,text,mime) downloadBlob(name,blob)

## io/svg-export.js

    projectToSVG(project, sheet, options?) -> string   // 纯函数，不依赖 canvas

## io/png-export.js

    exportSheetPNG(canvas, scale?) -> Promise<Blob>

## ui

    ui/app.js: export async function startApp(rootEl)   // 组装 store/库/渲染器/编辑器/面板/快捷键
    ui/store 使用 model/store.js；ui/toolbar.js、ui/panels/{library,properties,netlist,layers}-panel.js、
    ui/dialogs/export-dialog.js、ui/styles.css；index.html 与 src/main.js 由 UI 任务定稿

## 工程约束（原文）

【必读】先读 docs/CONTRACTS.md 与 docs/ARCHITECTURE.md，不一致处以 CONTRACTS.md 为准（发现契约缺陷请在自己的模块内做兼容并在汇报中说明）。

【硬性约束】纯原生 HTML/CSS/ES Modules；零第三方依赖、零 CDN、零构建步骤；必须能 node server.mjs 启动并在现代 Chrome/Edge 直接运行；core/model/library/netlist/render/view/io 的纯函数模块禁止依赖 DOM（保证 node --test 可直接测试）；分层依赖只能单向：core -> model/library -> netlist/render -> editor -> io -> ui，禁止反向 import。

【代码风格】ES Modules；2 空格缩进；语句结尾使用分号；单引号；文件与目录 kebab-case；每个文件顶部一句注释说明职责；函数小而单一；禁止全局可变状态；错误处理显式返回结果而不是吞掉异常。

【Git 规范】只 git add 自己负责的路径后提交；conventional commits（feat/fix/test/docs/chore(scope): 中文或英文简述）；一个任务至少 2 个按逻辑拆分的提交；严禁 git add -A、git commit --amend、git rebase、git reset --hard、切分支、push；遇到 index.lock 冲突 sleep 2 秒重试（最多 5 次）。

【完成标准】模块可被 import、有对应单元测试（test/<模块>/*.test.mjs，node:test + node:assert）、npm test 全绿；任务结束时用 agent_teams_update_task 汇报：已实现接口清单、文件清单、测试结果、遗留问题。

## 补充说明（不改变语义，仅供实现对齐）

1. **模块位置**：`core/`、`model/`、`library/`、`netlist/`、`render/`、`editor/`、`io/`、`ui/` 均为仓库根目录下的目录，模块内相对引用使用显式扩展名（如 `import { uid } from '../core/id.js'`）。
2. **uid 格式**：`<prefix>-<片段>-<序号>`，例如 `R-1a2b3c-7`；只保证同一进程内唯一且人类可读，不保证跨进程稳定，也不得作为网络名或位号使用。
3. **事件名**：`model/store.js` 的 `on/emit` 使用契约列出的 `changed | selection | view | sheet` 四个事件名；`created|modified` 等元数据变化一律通过 `changed` 通知。
4. **坐标与单位**：世界坐标单位为 mm，屏幕坐标为 CSS 像素；`render/view.js` 中的 world↔screen 变换是唯一权威实现，编辑器与面板不得自行推导。
5. **错误返回**：`validateProject` 失败时返回 `{ ok:false, errors:[...] }`；`deserializeProject` 解析失败时返回 `{ project:null, warnings:[...] }`，调用方负责提示，禁止抛出未捕获异常。
6. **导出器契约**：`EXPORTERS` 每项必须提供 `id / label / extension / mime / generate(project)`，`generate` 必须为纯函数且返回完整字符串（不含 BOM）。
7. **工具契约**：所有工具方法都必须存在（即使为空实现），`onActivate/onDeactivate` 用于清理临时状态；`ctx.grid` 为当前栅格尺寸（mm）。
8. **测试放置**：单元测试放在 `test/<层>/<模块>.test.mjs`，脚手架冒烟测试为 `test/scaffold.test.mjs`；测试不得依赖 canvas 或网络。
9. **契约缺陷处理**：若某接口无法同时满足可测试性与功能需求，在自己的模块内做向后兼容（例如允许 `options` 注入 `requestAnimationFrame`），并在 `agent_teams_update_task` 汇报中登记。
