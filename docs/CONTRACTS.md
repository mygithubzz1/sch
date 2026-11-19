# 接口契约（全队唯一权威，实现必须一致）

> 维护规则：本文件是全队唯一的接口权威文档，任何实现与本文不一致时以本文为准。
> 修改契约必须同步修改本文件并在团队内广播；如发现契约缺陷，请在自己的模块内做兼容，并在任务汇报中说明。
> 所有模块路径均相对 `src/` 目录（测试路径相对仓库根目录）；`src/main.js` 只负责启动引导。

## 0. 顶层目录约定

- **单根布局**：所有可运行代码位于 `src/`；仓库根只保留 `index.html`、`server.mjs`、`package.json`、`.gitignore`、`.gitattributes`、`docs/`、`test/`。
- **层目录**：`src/core/`、`src/model/`、`src/library/`、`src/netlist/`、`src/render/`、`src/editor/`、`src/io/`、`src/ui/`。
- **入口**：`index.html` 通过 `<script type="module" src="./src/main.js">` 加载 `src/main.js`，后者导出并调用 `bootstrap(root)`。
- **测试**：`test/<层>/<模块>.test.mjs` 镜像 `src/<层>/<模块>.js`；脚手架冒烟测试为 `test/scaffold.test.mjs`。
- **跨层相对引用示例**：`src/library/symbol-library.js` → `import { uid } from '../core/id.js';`；`src/netlist/connectivity.js` → `import { findSheetById } from '../model/project.js';`；`src/render/view.js` → `import { clamp } from '../core/geometry.js';`。
- **禁止反向依赖**：依赖只能 `src/core -> (src/model | src/library) -> (src/netlist | src/render) -> src/editor -> src/io -> src/ui`，禁止下层 import 上层。

## src/core/id.js

    export function uid(prefix = 'id')  // 形如 "R-1a2b3c-7"，进程内唯一、可读

## src/core/geometry.js   纯函数，点 = {x:number, y:number}

    pt(x,y) add(a,b) sub(a,b) scale(a,k) dist(a,b) len(a)
    snapV(v,grid) snapPt(p,grid) rotatePoint(p,deg,origin) mirrorPoint(p)
    segmentDistance(p,a,b) pointInRect(p,rect) rectFromPoints(a,b) rectsIntersect(a,b)
    bboxOfPoints(points) -> {x,y,w,h}
    transformPoint(p, {x,y,rotation,mirror})   // 顺序：mirror -> rotate(deg) -> translate

## src/core/event-bus.js

    export function createBus() -> { on(name,fn)->off, off(name,fn), emit(name,payload), clear() }

## src/core/command.js

    命令对象 = { label:string, do(), undo() }
    export class CommandStack {
      constructor(state)     // state 传给命令的 this.state
      execute(cmd)  undo()  redo()  canUndo()  canRedo()  onChange(fn)->off  clear()
    }

## src/core/schema.js

    export const SCHEMA_VERSION = 1
    export function validateProject(json) -> { ok:boolean, errors:string[] }
    export function migrateProject(json)  // v1 原样返回

**可选 KiCad 元数据的校验口径**（校验函数私有，不导出）：

| 字段 | 校验 | 缺失时 |
| --- | --- | --- |
| `project.kicad` | 存在则是对象；`source/tool/date/version` 为字符串；`libraries` 为 `{logical:string, uri:string}[]` | 零错误 |
| `project.netClassAssignments` | 存在则是对象，值为非空字符串 | 零错误 |
| `sheet.kicad` | 存在则是对象；`number/name/tstamps` 为字符串 | 零错误 |
| `sheet.title.source` | 存在则是字符串（`comments` 沿用既有的 `string \| string[]`） | 零错误 |
| `symbol.kicad` | 存在则是对象；`datasheet/description/tstamps` 为字符串；`libsource`、`sheetpath` 为对象；`properties`/`fields` 为 `{name:string, value?:string}[]` | 零错误 |

**向后兼容承诺**：新增字段一律可选，`SCHEMA_VERSION` **保持 1**、`migrateProject()` 不变；不含任何 KiCad 字段的旧工程 JSON 必须原样通过校验。

## src/model/project.js  纯数据 + 纯函数，禁止 import DOM

    createProject(name?, options?) createSheet(name?, options?) createSymbolInstance(partial)
    createWire(points) createJunction(x,y) createLabel(partial) createText(partial) clone(json)
    Project = { schemaVersion:1, name, units:'mm', grid:2.54, sheets:[Sheet], library:{symbols:[],footprints:[]}, meta:{created,modified},
                kicad?:ProjectKicad, netClassAssignments?:{[netName]:className} }
    ProjectKicad = { source, tool, date, version, libraries:[{ logical, uri }] }      // 全部可选，version 缺省 'E'
    Sheet = { id, name, symbols:[SymbolInstance], wires:[Wire], junctions:[Junction], labels:[Label], texts:[Text],
              title:Title, kicad?:SheetKicad }
    SheetKicad = { number, name, tstamps }        // name 是 KiCad 图纸路径（'/'、'/RP2040/'），不是人工图纸名
    Title = { title, company, rev, date,
              source?:string,                     // → title_block/source；仅在提供时保留
              comments:string|string[] }          // string[9] 或 \n 分隔的 string；数组截断 ≤9、逐项字符串化，不自动补齐
    SymbolInstance = { id, symbolId, designator, value, x, y, rotation:(0|90|180|270), mirror:boolean,
                       footprintId:string|null, fields:{}, kicad?:SymbolKicad }
    SymbolKicad = { datasheet, description, tstamps,
                    libsource?:{ lib, part, description },
                    properties?:[{ name, value? }],   // 保序；无 value = 网表里自闭合
                    fields?:[{ name, value? }],       // 保序
                    sheetpath?:{ names, tstamps } }
    Wire = { id, points:[Point], width:number }
    Junction = { id, x, y }
    Label = { id, x, y, rotation, text, kind:'local'|'global' }
    Text = { id, x, y, rotation, text, size }
    SymbolDef = { id, name, refPrefix, description,
                  docs:string, footprints:string[], keywords:string, fpFilters:string[],
                  fields:[{ name, value? }],          // libpart 字段；缺省为 5 条（见 §补充说明 12）
                  power:boolean, pins:[Pin], graphics:[Graphic] }
    Pin = { id, name, number, x, y, length,
            orientation:'left'|'right'|'up'|'down',   // 从连接端点 (x,y) 朝符号本体延伸的方向
            electricalType:'input'|'output'|'bidirectional'|'tri_state'|'passive'|'free'|'unspecified'|
                           'power_in'|'power_out'|'open_collector'|'open_emitter'|'no_connect',
            noConnect:boolean,                       // true ⇒ 导出 pintype 追加 '+no_connect'
            free:boolean }                           // true ⇒ 导出 pintype 追加 '+free'
    // 旧词汇 'not_connected' 保留为可读别名：读入时迁移为 no_connect + noConnect:true
    // （见 src/library/symbol-library.js 的 LEGACY_PIN_ELECTRICAL_TYPES）
    Graphic = {type:'line',points,width?,fill?} | {type:'polyline',points,width?,fill?} |
              {type:'rect',x,y,w,h,width?,fill?} | {type:'circle',cx,cy,r,width?,fill?} |
              {type:'arc',cx,cy,r,start:deg,end:deg,width?} | {type:'text',x,y,text,size?,rotation?}
    FootprintDef = { id, name, description, pads:[Pad], graphics:[FGraphic] }
    Pad = { id, number, x, y, w, h, shape:'rect'|'roundrect'|'circle'|'oval', rotation, layer:'top'|'bottom'|'tht', drill }
    FGraphic = Graphic + { layer:'silkscreen'|'courtyard'|'assembly'|'fab' }

`normalizeProject()` / `normalizeSheet()` / `normalizeTitle()` / `normalizeSymbolInstance()` 都是**白名单重建**：新增字段必须在对应函数里显式放行，否则会在第一次「打开 → 保存」后静默丢失。`normalizeLibrary()` 用 `clone` 保留未知键，因此 `library.symbols[*]` 的扩展字段无需额外白名单。

## src/model/store.js   应用状态 + 撤销栈（无 DOM）

    export function createStore(project)
     -> { getProject(), setProject(p,{history}), getSheet(), getSheetId(), setSheetId(id),
          update(mutator,{label}) /* 通过 CommandStack 执行，可撤销 */,
          undo(), redo(), canUndo(), canRedo(),
          getSelection(), setSelection(ids), getHover(), setHover(id),
          commands /* CommandStack */, on(evt,fn)->off, emit(evt,payload) /* changed|selection|view|sheet */ }

事件登记：

- 契约事件为 `changed`、`selection`、`view`、`sheet`。
- **附加事件 `hover`**（payload `{ id }`）：用于悬浮高亮，属于允许的扩展，监听方可选；不得用它替代上述四事件。
- `setProject(p, { history: false })`（默认）视为新建文档：**清空撤销栈与当前选择**，并广播一次 `changed`（`reason: 'clear'`）；`history: true` 时作为可撤销的「加载工程」进入命令栈。

## src/library/symbol-library.js + src/library/builtin-symbols.js

    createSymbolLibrary(symbols?) -> { add, remove, get(id), list(), search(q), toJSON(), fromJSON(json) }
    builtinSymbols() -> SymbolDef[]   // 至少 R C C_POL L D LED NPN PNP GND VCC +5V SW_PUSH CONN_2 CONN_4 XTAL OPAMP IC_8 MCU_16

    export const PIN_ELECTRICAL_TYPES       // 12 值 KiCad 词汇（见上面 Pin.electricalType）
    export const LEGACY_PIN_ELECTRICAL_TYPES // ['not_connected']，读入别名，至少再保留一个版本
    export const DEFAULT_SYMBOL_FIELD_NAMES  // ['Reference','Value','Footprint','Datasheet','Description']
    export function isPinElectricalType(value) -> boolean        // 含旧词汇别名
    export function normalizeSymbolFields(raw) -> [{ name, value? }]
    export function defaultSymbolFields(symbol) -> [{ name, value? }]   // 5 条缺省，见 §补充说明 12

`normalizeSymbolDef()` 在 `fields` 缺失时用 `defaultSymbolFields()` 补 5 条；`normalizePin()` 把旧值 `not_connected` 迁移为 `no_connect` + `noConnect:true`，并保证 `noConnect`/`free` 恒为布尔。

## src/library/footprint-library.js + src/library/builtin-footprints.js

    createFootprintLibrary(footprints?) 同构；builtinFootprints() 至少 R_0402 R_0603 R_0805 C_0603 SOT-23 SOIC-8 DIP-8 PIN_HDR_1x2 PIN_HDR_1x4 QFP-32

## src/netlist/connectivity.js

    buildConnectivity(project, sheet) -> { nets:[Net], warnings:[{code,message,ref?}] }
    buildProjectConnectivity(project) -> { nets:[Net], warnings:[...] }
    analyzeSheet(project, sheet, options?) -> { ok, sheetId, sheetIndex, nets:[DetailNet], components:[DetailComponent], warnings, stats }
    analyzeProject(project, options?) -> { ok, nets:[DetailNet], components:[DetailComponent], warnings, stats, sheets:[sheetResult] }
    resolveSymbolMap(project, options?) -> Map<symbolId, SymbolDef>
    naturalCompare(a, b) -> number
    export const CONNECTIVITY_TOLERANCE = 1e-6

    Net = { name, class, pins:[{ designator, pinNumber, pinName, symbolId, instanceId, sheetId,
                                 pinfunction, electricalType, pintype, noConnect, free }] }

    DetailNet = { id, name, nameSource:'power'|'global'|'local'|'auto', class, sheetId, sheetIds, sheetIndex, order,
                  powerNames:[], pins:[], wires:[], junctions:[], labels:[] }
    DetailComponent = { designator, value, footprintId, symbolId, instanceId, sheetId, x, y, power, refPrefix,
                        virtual, resolved, pins:[{ number, name, electricalType, noConnect, free }],
                        kicad? /* 来自 symbol.kicad 的深拷贝透传，未提供时不产生该键 */ }

    连接规则：导线端点/折点、引脚端点、junction、同名 label；power 符号(power:true 且引脚 electricalType=power_in/power_out)以其 pin.name 作为全局网络名(GND/VCC/+5V)
    命名优先级：电源名 > global label > local label > 自动 N$n
    net class：读 project.netClassAssignments[net.name]，缺失/非字符串/空串一律回退 'Default'
    引脚口径：pinfunction 取 pinName 原文；electricalType 把 not_connected 归一为 no_connect；pintype 为 electricalType 别名
    编码边界：connectivity 内**不**做 {slash} / ~{ } 编解码，net.name 保持模型网络名原文（编解码属导出/导入层）

## src/netlist/kicad-format.js   纯函数，KiCad 网表格式化原语

    export const KICAD_VERSION = 'E'          // 唯一支持的网表版本
    export const KICAD_NEWLINE = '\r\n'      // 黄金样本行尾；文件末尾不再补换行
    export const DEFAULT_NET_CLASS = 'Default'
    export const EMPTY_VALUE_SENTINEL = '~'  // datasheet / docs 的「无」
    export const PIN_ELECTRICAL_TYPES         // 与 symbol-library.js 同步的 12 值副本（避免网表层硬依赖 library 层）

    escapeSExpr(value) -> string              // \ → \\，" → \"，换行 → \n，Tab → \t（顺序不可颠倒）
    sexpr(name, { inline?, value?, children? }) -> SNode
    renderSExpr(node) -> string               // 2 空格/层、结构子元素各一行、闭括号并入末行、CRLF、末尾无换行
    encodeLabelText(value) -> string          // 全部 '/' → '{slash}'（仅用于「标签文本」）
    decodeLabelText(value) -> string          // '{slash}' → '/'
    encodeNetName(name, { sheetPath?, nameSource? }) -> string   // 见 NETLIST_KICAD.md §4.2
    baseElectricalTypeOf(pin) -> string       // not_connected → no_connect；未知 → passive
    pintypeOf(pin) -> string                  // base[+no_connect][+free]
    commentsAsSlots9(comments) -> string[9]   // string[] 截断 ≤9；string 按换行切槽；缺失补 ''
    compareAscii(a, b) compareComponentKeys({sheetOrder,designator}, …)
    compareNetNames(a, b) compareLibparts({part,lib}, …)
    sortPinsAscii(pins) -> pins[]             // node 排序：(ref, pin) 纯 ASCII 字节序
    stableUuid(seed) -> string                // 8-4-4-4-12 形状的确定性 UUID（不依赖随机/时间）

`SNode = { name, inline:[[key,value],…], value?:string, children:SNode[] }`。

## src/netlist/kicad-reader.js   纯函数，文本 → 结构化文档（不建工程、不抛异常）

    tokenizeSExpression(text) -> { ok, tokens:[{type:'list-start'|'list-end'|'string'|'atom', value, line}], errors }
    parseSExpression(text) -> { ok, tree:any[]|null, errors:[{line,code,message}] }   // line 为 1-based
    readKiCadNetlist(text) -> {
      ok:boolean, version:string|null,
      design: { source, date, tool,
                sheets:[{ number, name, tstamps,
                          titleBlock:{ title, company, rev, date, source, comments:string[9] } }] } | null,
      components: [{ ref, value, footprint, datasheet?, description?,
                     fields:[{name,value?}], libsource:{lib,part,description},
                     properties:[{name,value?}], sheetpath:{names,tstamps}, tstamps }],
      libparts: [{ lib, part, description, docs?, footprints:string[], fields:[{name,value?}],
                   pins:[{ num, name, type }] }],
      libraries: [{ logical, uri }],
      nets: [{ code, name, class, nodes:[{ ref, pin, pinfunction?, pintype }] }],
      errors:[{line,code,message}], warnings:[{code,message}]
    }

    // 错误码：INVALID_INPUT EMPTY_INPUT MISSING_EXPORT UNTERMINATED_STRING UNTERMINATED_LIST DEPTH_EXCEEDED
    //         TRAILING_TOKEN INVALID_TOKEN MISSING_VERSION MISSING_SECTION MISSING_SHEET
    //         MISSING_COMP_REF MISSING_PROPERTY_NAME MISSING_PIN_NUM MISSING_PIN_TYPE MISSING_LIBPART_KEY
    //         MISSING_LIBRARY_LOGICAL MISSING_NODE_KEY MISSING_NET_NAME
    // 告警码：UNEXPECTED_VERSION UNKNOWN_SECTION MISSING_LIBPARTS MISSING_LIBRARIES
    //         COMP_LIBSOURCE_MISSING COMP_TSTAMPS_MISSING

`datasheet` / `description` / `docs` / `pinfunction` 在网表里省略时**保持缺键**（`undefined`），以区分「缺 token」与「空串字面量」。
`MAX_DEPTH = 256`；输入允许 CRLF、允许无结尾换行、允许前导 BOM。

## src/netlist/kicad-import.js   纯函数，结构化文档 → 可编辑工程

    export const UNCONNECTED_NET_PREFIX = 'unconnected-('
    importKiCadNetlist(text, { name? }) -> 
      成功 { ok:true, project:Project, warnings:[{code,message}],
             stats:{ sheets, components, libparts, libraries, nets, nodes,
                     labels, wires, netsLabeled, netsSkippedUnconnected, classes:{[className]:count} } }
      失败 { ok:false, errors:string[], diagnostics:[{line,code,message}], warnings:[...] }

    // 告警码：DUPLICATE_SHEET_PATH DUPLICATE_COMP_REF DUPLICATE_LIBPART UNKNOWN_SHEETPATH UNKNOWN_LIBPART
    //         UNKNOWN_PIN_TYPE SYMBOL_BUILD_FAILED PIN_MODIFIER_CONFLICT PIN_TYPE_MISMATCH
    //         EMPTY_NET_NAME MISSING_PIN_POINT NET_CLASS_CONFLICT
    // errors 为带行号的人话（"第 N 行 [CODE] 说明"），diagnostics 为结构化形式；MAX_WARNINGS = 200

契约要点：

1. `libpart` → `library.symbols[*]`：`id = "<lib>:<part>"`，引脚几何为自动生成（本体左侧一列、`x=-2.54`、`orientation:'right'`），并显式带回 `libsource = { lib, part }`。
2. `comp` → 符号实例：按 `sheetpath.names` 归入对应图纸（找不到则归根图并记 `UNKNOWN_SHEETPATH`），`instanceId = 'sym-' + tstamps`（缺失时 `sheet.id + '-' + ref`）。
3. 连通性用「每引脚 2.54mm stub 导线 + 同名网络标签」重建：标签同名即在连通性分析中合网；`no_connect` 类型的引脚不生成 stub。
4. 网络名先 `{slash}`→`/` 解码，再按图纸前缀判定 local/global（跨图纸一律 global），见 NETLIST_KICAD.md §4.2。
5. `unconnected-(…)` 网络不建标签；悬空引脚留给导出侧重新合成。
6. net class 写入 `project.netClassAssignments`，**按现行实现包含 `Default` 键**（黄金样本为 108 键 = 63 Default + 45 非 Default）。
7. 成功后必定通过 `validateProject`；失败绝不抛异常、不产出半套工程。
8. 导入不还原导线路径与符号原始图形，只保证引脚—网络关系与全部网表元数据可重新导出。

## src/netlist/index.js

    buildNetlist(project, options?) -> { ok, nets:[{name, class, pins:[…]}], warnings, stats,
                                         components:[{ designator, value, footprintId, symbolId, instanceId,
                                                       sheetId, power, refPrefix, virtual, pins, kicad? }] }
    generateJSON(project, options?) -> string    // schematic-studio-netlist v1
    generateCSV(project, options?) -> string     // 表头 designator,pin,name,net，LF 行尾
    generateKiCad(project, options?) -> string   // KiCad 9，见下
    generateProtel(project, options?) -> string  // [Design]/[Components]/[NETLIST]，CRLF 行尾

    export const EXPORTERS = { json, csv, kicad, protel }   // 每项 { id, label, extension, mime, generate(project)->string }
    export const EXPORTER_LIST
    getExporter(id) -> exporter|null

**每个导出器的共同契约**：

- `id` 必须等于注册表键；`extension` 不带前导点；`mime` 形如 `text/plain`。
- `generate(project, options?)` 是**纯函数**：不改动入参、两次调用结果相同、返回完整字符串、**不含 BOM**。
- 四种格式的 id 与数量（`json / csv / kicad / protel`）是稳定契约，只能改 `label` 文案（ADR-5）。

**`generateKiCad(project, options?)` 的额外契约**（细则见 [`NETLIST_KICAD.md`](./NETLIST_KICAD.md)）：

- 输出必须是 `(export (version "E") …)`，且**恰好包含六个分节**，顺序固定：
  `design`（含每图纸 `sheet` + `title_block` 9 槽 `comment`）→ `components` → `libparts` → `libraries` → `nets`。
- 文件级：UTF-8 无 BOM、`\r\n` 行尾、**文件末尾无换行**、无空行、无独立成行的 `)`、每层 2 空格缩进。
- `comp` 必须输出 `value/footprint/(datasheet)/(description)/fields/libsource/property*/sheetpath/tstamps`；`datasheet`、`description` 为空时**整段省略**。
- `net` 必须输出 `(class "…")`（含 `Default`）；`node` 的 `pinfunction` 为空时**整段省略**；`pintype` 支持 `+no_connect`/`+free`。
- 排序：`comp` 先图纸顺序再图纸内位号自然序；`node` 按 `(ref, pin)` 纯 ASCII 序；`net` 按网络名自然序编号 `1..N`。
- 单引脚自动网络（`N$n`）必须被合成 `unconnected-(…)`（电源符号的单脚网络除外）。

## src/render/view.js   纯函数

    createView() -> { offsetX, offsetY, scale }
    worldToScreen(view,p) screenToWorld(view,p) zoomAt(view, screenPt, factor) fitView(bbox,width,height,padding)

## src/render/renderer.js

    export class SchematicRenderer {
      constructor(canvas, options?)   // options:{ theme, grid }
      setState({ project, sheet })  setView(view)  getView()  setSelection(ids)  setHover(id)
      resize()  requestRender()  render()  worldToScreen(p)  screenToWorld(p)  fitToContent()
    }
    必须支持 devicePixelRatio 高清渲染；绘制网格、标题栏、符号图形/引脚/引脚名与号、位号与值、导线、junction 圆点、标签、文本、选中与 hover 高亮

## src/render/footprint-renderer.js

    export class FootprintRenderer   // 同构 API，绘制焊盘/丝印/courtyard/图层配色，支持焊盘选中

## src/render/theme.js

    export const DEFAULT_THEME = { background, grid, gridMajor, wire, junction, symbol, symbolFill, pin, pinText, label, labelGlobal, selection, hover, padTop, padBottom, padDrill, silk, courtyard }

## src/render/grid.js

    export function drawGrid(ctx, view, size, step)

## src/render/symbols.js

    export function drawSymbol(ctx, symbolDef, transform, theme, opts)   // 供画布与 SVG 导出复用

## src/editor/snapping.js   纯函数

    collectAnchors(project, sheet) -> Point[]   // 引脚端点、导线端点与折点、junction、标签锚点
    findSnapPoint(anchors, p, worldTol) -> Point|null
    snapToGrid(p, grid) -> Point

## src/editor/commands.js   全部可撤销命令

    addWireCommand(sheetId, points) removeEntitiesCommand(sheetId, ids) moveEntitiesCommand(sheetId, ids, delta)
    addSymbolCommand(sheetId, instance) setSymbolFieldCommand(sheetId, id, key, value) addLabelCommand(...)

## src/editor/schematic-editor.js

    createSchematicEditor({ canvas, store, renderer }) -> { setTool(name), getTool(), getActiveTool(),
      destroy(), focus(), refresh(), getStore(), getRenderer() }
    工具模块导出 = { id, cursor, onActivate(ctx), onDeactivate(ctx), onPointerDown(e), onPointerMove(e),
      onPointerUp(e), onDoubleClick(e), onKeyDown(e) }，ctx = { store, commands, editor, renderer,
      screenToWorld, worldToScreen, grid, bus }
    必须工具：select（点选/框选/拖动）、wire（连续画线、端点吸附、自动 junction、回车或双击结束）、
    place（放置符号，R 旋转、X 镜像、Esc 取消）、label、text、erase

## src/editor/footprint-editor.js

    createFootprintEditor({ canvas, store, renderer })  // 工具：select、pad（放焊盘）、move、graphic（画丝印线/矩形），支持新建/删除焊盘与编号递增

## src/io/project-io.js

    serializeProject(project)->string  deserializeProject(text)->{project,warnings}
    saveToLocalStorage(key,project) loadFromLocalStorage(key) downloadText(name,text,mime) downloadBlob(name,blob)

## src/io/svg-export.js

    projectToSVG(project, sheet, options?) -> string   // 纯函数，不依赖 canvas

## src/io/png-export.js

    exportSheetPNG(canvas, scale?) -> Promise<Blob>

## src/ui

    src/ui/app.js: export async function startApp(rootEl)   // 组装 store/库/渲染器/编辑器/面板/快捷键
    src/ui 使用 src/model/store.js；src/ui/toolbar.js、src/ui/panels/{library,properties,netlist,layers}-panel.js、
    src/ui/dialogs/export-dialog.js、src/ui/styles.css；index.html 与 src/main.js 由 UI 任务定稿

    src/ui/toolbar.js:  export const MENU_DEFINITIONS   // 菜单结构（供结构测试）；文件菜单含 { id:'importNetlist', label:'导入 KiCad 网表…' }
    src/ui/layout.js:   layout.netlistFileInput          // 独立 <input type="file" accept=".net,text/plain">，不覆盖工程的 fileInput
    src/ui/file-actions.js: createFileActions(ctx) -> { …, openNetlistImport(), handleNetlistFileChange() }
    src/ui/view-model.js:   netRows(result) -> [{ name, class, pins:[…] }]   // class 缺失/空串归一为 'Default'
    src/ui/dialogs/export-dialog.js: export const FORMAT_NOTES = { kicad:'KiCad 9 (version E)', … }

## 工程约束（原文）

【必读】先读 docs/CONTRACTS.md 与 docs/ARCHITECTURE.md，不一致处以 CONTRACTS.md 为准（发现契约缺陷请在自己的模块内做兼容并在汇报中说明）。

【硬性约束】纯原生 HTML/CSS/ES Modules；零第三方依赖、零 CDN、零构建步骤；必须能 node server.mjs 启动并在现代 Chrome/Edge 直接运行；core/model/library/netlist/render/view/io 的纯函数模块禁止依赖 DOM（保证 node --test 可直接测试）；分层依赖只能单向：core -> model/library -> netlist/render -> editor -> io -> ui，禁止反向 import。

【代码风格】ES Modules；2 空格缩进；语句结尾使用分号；单引号；文件与目录 kebab-case；每个文件顶部一句注释说明职责；函数小而单一；禁止全局可变状态；错误处理显式返回结果而不是吞掉异常。

【Git 规范】只 git add 自己负责的路径后提交；conventional commits（feat/fix/test/docs/chore(scope): 中文或英文简述）；一个任务至少 2 个按逻辑拆分的提交；严禁 git add -A、git commit --amend、git rebase、git reset --hard、切分支、push；遇到 index.lock 冲突 sleep 2 秒重试（最多 5 次）。

【完成标准】模块可被 import、有对应单元测试（test/<模块>/*.test.mjs，node:test + node:assert）、npm test 全绿；任务结束时用 agent_teams_update_task 汇报：已实现接口清单、文件清单、测试结果、遗留问题。

## 补充说明（不改变语义，仅供实现对齐）

1. **模块位置**：所有模块位于 `src/` 下——`src/core/`、`src/model/`、`src/library/`、`src/netlist/`、`src/render/`、`src/editor/`、`src/io/`、`src/ui/`；跨层相对引用使用显式扩展名（如 `src/library/x.js` 中 `import { uid } from '../core/id.js'`）。
2. **uid 格式**：`<prefix>-<片段>-<序号>`，例如 `R-1a2b3c-7`；只保证同一进程内唯一且人类可读，不保证跨进程稳定，也不得作为网络名或位号使用。
3. **事件名**：`src/model/store.js` 的 `on/emit` 使用契约列出的 `changed | selection | view | sheet` 四个事件名；附加事件 `hover`（`{ id }`）仅用于悬浮高亮，属于允许的扩展；`setProject(p, { history: false })` 会清空历史与选择并广播 `changed`（`reason: 'clear'`）；`created|modified` 等元数据变化一律通过 `changed` 通知。
4. **坐标与单位**：世界坐标单位为 mm，屏幕坐标为 CSS 像素；`src/render/view.js` 中的 world↔screen 变换是唯一权威实现，编辑器与面板不得自行推导。
5. **错误返回**：`validateProject` 失败时返回 `{ ok:false, errors:[...] }`；`deserializeProject` 解析失败时返回 `{ project:null, warnings:[...] }`，调用方负责提示，禁止抛出未捕获异常。
6. **导出器契约**：`EXPORTERS` 每项必须提供 `id / label / extension / mime / generate(project)`，`generate` 必须为纯函数且返回完整字符串（不含 BOM）。
7. **工具契约**：所有工具方法都必须存在（即使为空实现），`onActivate/onDeactivate` 用于清理临时状态；`ctx.grid` 为当前栅格尺寸（mm）。
8. **测试放置**：单元测试放在仓库根 `test/<层>/<模块>.test.mjs`（镜像 `src/<层>/`），脚手架冒烟测试为 `test/scaffold.test.mjs`；测试不得依赖 canvas 或网络。
9. **契约缺陷处理**：若某接口无法同时满足可测试性与功能需求，在自己的模块内做向后兼容（例如允许 `options` 注入 `requestAnimationFrame`），并在 `agent_teams_update_task` 汇报中登记。
10. **换行与仓库配置**：仓库使用 `.gitattributes` 统一 LF（`* text=auto eol=lf`、`*.json text eol=lf`），避免 Windows 下的 CRLF 噪声；**唯一例外**是 KiCad 网表夹具 `*.net -text`——黄金样本 `examples/tinytapeout-demo.net` 由 KiCad 在 Windows 上导出，含 CRLF 与字符串内的 `\n` 转义字面量，规范化会破坏字节可复现性（提交后 blob 应为 254285 字节）。提交前请保持工作区干净。
11. **向后兼容承诺**：`SCHEMA_VERSION` 保持 **1**；`project.kicad`、`project.netClassAssignments`、`sheet.kicad`、`sheet.title.source`、`symbol.kicad`、`net.class`、`pin.noConnect`/`free` 全部**可选**。不含这些字段的旧工程必须通过 `validateProject`、经 `normalizeProject` 后形状不变、导出结果不回归。
12. **libpart 缺省字段**：`SymbolDef.fields` 缺失时补 5 条，**顺序固定** `Reference`(`refPrefix`) → `Value`(`name`‖`id`) → `Footprint`(无 value) → `Datasheet`(`~`) → `Description`(`description`)，实现见 `defaultSymbolFields()`。`Footprint` 无 value 对应网表里的自闭合 `(field (name "Footprint"))`。
13. **netClassAssignments 的三个口径**（勿混用）：网表侧 114 个网络 = 69 `Default` + 45 非 Default；映射侧 `project.netClassAssignments` 为 **108** 键 = **63** `Default` + 45 非 Default（6 个 `unconnected-(…)` 网络不建标签故无键）；导出回退在 `net.class` 与映射都缺失/非法时返回 `'Default'`，因此写不写 `Default` 键导出结果相同。导入器**按现行实现写入 `Default` 键**。
14. **`symbol.kicad.tstamps` 双形态**：`string | string[]`——单值存 `string`；KiCad 多单元符号的 `(tstamps "a" "b" "c")` 含多个 UUID 时存数组，导出按原顺序逐个输出。与 `sheet.title.comments` 的双形态风格一致。黄金样本 150 个 `comp` 共 156 个值（148 单值、`J4` 三值、`U4` 五值）。**逐字节还原承诺**：导入 `examples/tinytapeout-demo.net` 后再导出，输出与 KiCad 9 原文件逐字节相同（254285 字节，SHA-256 `2f92e581…a53f`，0 行差异），由 `test/integration/kicad-roundtrip.test.mjs` 的逐字节断言保障；该承诺同时依赖 §10 的行尾规则与 `kicad-format.js` 的名称编码规则，三者任一被改动都必须重跑该断言。
15. **测试内启动服务必须静默**：`node:test` 通过 IPC 回传结果，测试进程向 stdout 写日志可能污染测试帧通道（表现为 `Unable to deserialize cloned data`）。测试里调用 `server.mjs` 的 `startServer()` 必须显式静默——`startServer({ quiet: true })`，或用 `logger` 选项把三条启动日志重定向到内存/空函数；**禁止**让被测服务向 stdout 打印。该 `quiet`/`logger` 选项随测试帧通道修复引入（ADR-5 之后的独立修复），默认行为仍是 `console.log`，三条日志文案逐字未变。

