# KiCad 网表开发者参考

本文是 schematic-studio 处理 KiCad 9 网表（`(version "E")`）的**长期维护型开发者参考**：格式要点、转义规则、取值词汇、网表元素 ↔ 工程字段的映射，以及常见扩展点。

- **权威来源**：`examples/tinytapeout-demo.net`（KiCad 9.0.8 导出，254285 字节 / 4680 行，SHA256 `2f92e581…a53f`）。本文所有数字都在该文件上实测过。
- **取代关系**：一次性规范 `docs/NETLIST_KICAD_SPEC.md` 已由本文取代，只保留作历史存档与逐字节勘误依据。两者冲突时**以本文与 `docs/CONTRACTS.md` 为准**。
- **接口权威**：函数签名、返回值形状见 [`CONTRACTS.md`](./CONTRACTS.md) 的 `src/netlist/kicad-format.js` / `kicad-reader.js` / `kicad-import.js` / `index.js` 四节；分层与 ADR 见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)（第 9 节「网表导出 / 导入管线」）。
- **面向使用者**的导入/导出操作步骤见 [`USAGE.md`](./USAGE.md)（不在本文范围）。

---

## 1. 三个模块与两条管线

| 模块 | 职责 | 纯函数 |
| --- | --- | --- |
| `src/netlist/kicad-format.js` | 格式化原语：S-表达式构造/渲染、`{slash}` 编解码、`pintype` 拼接、四类排序、稳定 UUID | ✅ |
| `src/netlist/kicad-reader.js` | 文本 → 结构化文档（词法 + 语法 + KiCad 9 投影），错误带 1-based 行号 | ✅ |
| `src/netlist/kicad-import.js` | 结构化文档 → 可编辑工程（库符号、多图纸、stub 导线 + 标签、net class） | ✅ |
| `src/netlist/index.js` | 工程 → 文本（`generateKiCad`，通过 `EXPORTERS.kicad` 暴露） | ✅ |

```text
导出（工程 → 文本）
  project ──analyzeProject()──> nets / components
         └─kicadContextOf()──> sheetInfos / symbolMap / libraries
                └─generateKiCad()──> sexpr/renderSExpr ──> UTF-8 无 BOM 文本（CRLF）

导入（文本 → 工程）
  text ──readKiCadNetlist()──> { version, design, components, libparts, libraries, nets }
       └─importKiCadNetlist()──> { ok, project, warnings, stats }
```

两条管线都**不写文件、不碰 DOM**：I/O 由 `src/ui/file-actions.js` 负责（`downloadText` / `readFileText`），这条边界由 `test/netlist/purity.test.mjs` 与 `test/integration/layering.test.mjs` 强制。

---

## 2. 文件级格式（必须逐字节遵守）

| 属性 | 要求 | 违反后果 |
| --- | --- | --- |
| 编码 | UTF-8，**无 BOM** | 与黄金样本字节不等；`git diff` 出现 `\ufeff` |
| 行尾 | **CRLF**（`\r\n`） | 逐字节比对失败（语义仍等价） |
| 文件末尾 | **无换行** | 多 1–2 字节 |
| 空行 | 无 | 排版不一致 |
| 独立成行的 `)` | **禁止**，闭括号并入最后一行 | 排版不一致 |
| 缩进 | 每层 2 空格，全部为空格（无 Tab） | 排版不一致 |

导出器常量：`KICAD_VERSION = 'E'`、`KICAD_NEWLINE = '\r\n'`、`DEFAULT_NET_CLASS = 'Default'`、`EMPTY_VALUE_SENTINEL = '~'`。

排版规则（`renderNode` 实现）：

- **R1** 行首缩进 = `2 × 深度`，`(export …` 为深度 0。
- **R2** 头行内联：结构名 + `inline` 叶列表，如 `(net (code "1") (name "+1V8") (class "pwr")`。
- **R3** `children` 各占一行，深度 +1。
- **R4** 闭括号追加到该 list 内容最后一行的末尾。
- **R5** 无 `children` 的节点整体一行（含 `value` 位置参数）。
- **R6** 行间不加空行。

---

## 3. 六分节结构

顺序**固定**：`design → components → libparts → libraries → nets`。

| 分节 | 子元素 | 必现性 |
| --- | --- | --- |
| `export` | `(version "E")` | 必现 |
| `design` | `source` `date` `tool` + `sheet*` | 必现 |
| `sheet` | `(number) (name) (tstamps)` + `title_block` | 每图纸 1 个 |
| `title_block` | `title` `company` `rev` `date` `source` + `comment × 9` | 9 槽恒输出 |
| `components` | `comp*` | 可为空 |
| `comp` | `ref`（内联）+ `value` `footprint` `datasheet?` `description?` `fields` `libsource` `property*` `sheetpath` `tstamps` | `datasheet`/`description` 空则省略 |
| `libparts` | `libpart*` | 可为空 |
| `libpart` | `(lib) (part)`（内联）+ `description` `docs?` `footprints?` `fields` `pins?` | `docs` 空则省略；0 引脚时无 `pins` |
| `libraries` | `library*` | 可为空 |
| `library` | `(logical)`（内联）+ `uri` | —— |
| `nets` | `net*` | 可为空 |
| `net` | `(code) (name) (class)`（内联）+ `node*` | `class` 恒输出（含 `Default`） |
| `node` | `(ref) (pin) (pinfunction?) (pintype)` | `pinfunction` 空则**整段省略** |

黄金样本实测规模：150 `comp` / 28 `libpart` / 2 `sheet` / 1 `library` / 114 `net` / 584 `node`。

---

## 4. 转义规则（最容易写错的地方）

### 4.1 字符串级转义

只需处理四个字符，且**顺序不可颠倒**（否则 `\` 被二次转义）：

| 字符 | 写法 | 黄金样本出现次数 |
| --- | --- | --- |
| `\` | `\\` | 9（`design/source` 5 处 + `libraries/library/uri` 4 处） |
| `"` | `\"` | 0（但必须支持） |
| 换行 | `\n` | 4（`comp J15` 的 `description` 与其 `field (name "Description")` 各 2 处） |
| 制表符 | `\t` | 0（但必须支持） |

实现：`escapeSExpr()`（导出）、`tokenizeSExpression()` 的 `STRING_ESCAPES`（导入）。

### 4.2 网络名里的 `{slash}`

**不是「所有 `/` 都变 `{slash}`」**。实测：

| 观测 | 数量 | 例 |
| --- | --- | --- |
| 网络名含裸 `/` | 12 | `/CC1`、`/RP2040/DVDD`、`/~{CRVRST}` |
| 网络名含 `{slash}` | 4 | `SDI{slash}out0`、`SDO{slash}out1`、`cinc{slash}out3`、`~{crst}{slash}out2` |
| 两者混用 | 0 | —— |

规律：

- 以 `/` **开头**的名字是 KiCad 的**层级路径前缀**（`/` = 根图，`/RP2040/` = 子图），分隔符原样保留。
- `{slash}` 只编码「标签文本里作为普通字符的 `/`」。

导出判定（`encodeNetName(name, { sheetPath, nameSource })`）：

```js
1. 自动名（Net-(…) / unconnected-(…)）        → 逐字写出
2. nameSource === 'local' 且 sheetPath ∉ {'', '/'}
     → 前置 sheetPath（若名字已带该前缀则先剥离再拼）
3. 名字以 '/' 开头，或已含 {slash}            → 视为已编码原文，逐字写出
4. 其余                                       → 前缀 + encodeLabelText(名字)
```

导入判定（`kicad-import.js`）：先 `{slash}` → `/` 解码，再按「节点所属图纸是否跨图」决定标签类型——单图纸且解码名以该图纸路径前缀开头时，标签文本去掉前缀、`kind='local'`；否则（含所有跨图纸网络）标签文本用完整解码名、`kind='global'`。跨图纸网络必须用 global，否则局部标签不会跨图合网。

### 4.3 `pinfunction` 与 libpart 引脚名保留原始 `/`

| 位置 | `/` 的处理 | 实测 |
| --- | --- | --- |
| `net@name` | 标签文本里的 `/` → `{slash}` | 见上 |
| `node@pinfunction` | **原样保留** | 35 / 360 含裸 `/`，含 `{slash}` 的 **0** |
| `libpart/pin@name` | **原样保留** | 35 / 287 含裸 `/`，含 `{slash}` 的 **0** |

同一个物理引脚在两个字段里写法不同，例如 `(name "mio[36]/~{ctrl_sel_rst}")` 对应的网络名是 `~{ctrl_sel_rst}`。

### 4.4 上划线 `~{…}`

`~{abc}` 表示上划线；可与 `{slash}` 共存（`~{crst}{slash}out2`）。模型层**逐字保留**，只在 UI 渲染时可选美化。

### 4.5 `~` 是空值哨兵，不是空串

| 场景 | 网表写法 | 模型 |
| --- | --- | --- |
| 字段为空 | **省略整个子节点** | `undefined` / 无该键 |
| 字段为「无」 | `(datasheet "~")` / `(docs "~")` | 字符串 `"~"` |
| 字段有值 | `(datasheet "https://…")` | 原字符串 |

`~` **只**用于 `datasheet` / `docs`。空串另有写法：`(property … (value ""))`、`(pin (num "1") (name ""))`。

### 4.6 `property` 的两种空值形态

| 网表 | 模型 | 含义 |
| --- | --- | --- |
| `(property (name "dnp"))` | `{ name: 'dnp' }` | 无 `value` 子节点（28 次） |
| `(property (name "JLC") (value ""))` | `{ name: 'JLC', value: '' }` | 有 `value`，值为空串（158 次） |

`field` 不同：空值一律自闭合（`(field (name "Datasheet"))`），黄金样本里 `(field … "")` 出现 **0** 次，所以导出侧把空串也归一为省略。

---

## 5. 取值词汇

### 5.1 `net@class`

来自工程的 net class 定义，**不是固定枚举**——只有 `Default` 是缺省。黄金样本 9 种：

| class | 网表侧网络数 | 例 |
| --- | --- | --- |
| `Default` | 69 | `/CC1`、`Net-(R1-Pad2)`、`boot_mode` |
| `ioout` | 12 | `SDI{slash}out0`、`out0`…`out7` |
| `ioin` | 8 | `in0`…`in7` |
| `iobidir` | 8 | `uio0`…`uio7` |
| `config` | 7 | `HK_CSB`、`ctrl_ena` |
| `pwr` | 3 | `+1V8`、`+3V3`、`GND` |
| `clk` | 3 | `RP_proj_clk`、`project_clk`、`xclk` |
| `pwrhi` | 2 | `+5V`、`VBUS` |
| `usbdiff` | 2 | `usb_d+`、`usb_d-` |
| **合计** | **114** | 非 Default 共 45 |

> 与「net class 映射」的差额：导入器为 **108** 个网络写 `project.netClassAssignments`（含 **63** 个 `Default`），因为 6 个 `unconnected-(…)` 网络不建标签、不产生键。114 = 108 + 6，69 = 63 + 6。详见 §7.3。

### 5.2 `node@pintype`

```
pintype := baseType ( '+no_connect' | '+free' )*
```

- `baseType` ∈ 12 值：`input` `output` `bidirectional` `tri_state` `passive` `free` `unspecified` `power_in` `power_out` `open_collector` `open_emitter` `no_connect`。
- `baseType === 'no_connect'` 时**不再**追加 `+no_connect`（得裸 `no_connect`）。
- `+free` 在黄金样本中出现 0 次（前向兼容扩展）。

黄金样本 9 种形态：`passive` 320、`bidirectional` 118、`power_in` 85、`input` 43、`output` 11、`power_out` 3、`bidirectional+no_connect` 2、`no_connect` 1、`input+no_connect` 1。

导出用 `pintypeOf(pin)`，导入用 `split('+')` 还原 `{ base, noConnect, free }`。
**`libpart/pin@type` 不带修饰符**——它只写基础类型（`pintypeOf(pin).split('+')[0]`）。

### 5.3 `libpart/pin@type`

实测 7 种：`passive` 94、`bidirectional` 76、`power_in` 63、`input` 39、`output` 11、`power_out` 3、`no_connect` 1（共 287）。

---

## 6. 排序与编号

| 对象 | 规则 | 实现 |
| --- | --- | --- |
| `comp` | 先图纸顺序（`sheet.kicad.number` 数值升序），再图纸内位号**自然序** | `compareComponentKeys()` + `sortComponentsForKiCad()` |
| `libpart` | `part` 自然序，相同再比 `lib` | `compareLibparts()` |
| `net` | 网络名**自然序**，排序后依次编号 `code = 1..N` | `compareNetNames()` |
| `node` | `(ref, pin)` **纯 ASCII 字节序**（不是自然序！） | `sortPinsAscii()` |

判别证据（都是实测反例，不要「顺手统一成自然序」）：

- `comp`：`C42` 出现在 `C29` **之前** ⇒ 不是全局自然序，而是「先按图纸分组」。根图 125 个、`/RP2040/` 25 个。
- `node`：`C10` 排在 `C4` **之前**、`pin "12"` 排在 `pin "6"` **之前** ⇒ 纯字节序。
- `net`：`Net-(R2-Pad2)` 排在 `Net-(R10-Pad2)` **之前** ⇒ 是自然序（数字段按数值比较），与 `connectivity.js` 的 `naturalCompare` 一致。

---

## 7. 网表元素 ↔ 工程字段映射

### 7.1 设计段与图纸段

| 网表元素 | 工程字段 | 缺省 |
| --- | --- | --- |
| `export/version` | `project.kicad.version` | `'E'` |
| `design/source` | `project.kicad.source` | `project.name` |
| `design/date` | `project.kicad.date` | `dateStamp()`：`meta.modified` **原样**（完整 ISO 时间戳，如 `2026-11-19T10:25:58.000Z`），缺失时取当前 `new Date().toISOString()` |
| `design/tool` | `project.kicad.tool` | `'schematic-studio'` |
| `sheet@number/name/tstamps` | `sheet.kicad.{number,name,tstamps}` | `String(index+1)` / `'/'` / `'/'` |
| `title_block/title…date` | `sheet.title.{title,company,rev,date}` | `''` |
| `title_block/source` | `sheet.title.source` | `''`（旧工程无该键时输出空串） |
| `title_block/comment n` | `commentsAsSlots9(sheet.title.comments)[n-1]` | `''`（恒 9 槽） |

`sheet.title.comments` 是**双形态**：`string[9]`（导入器产出）或 `string`（UI 文本域、旧工程，按 `\n` 切槽）。两者都由 `commentsAsSlots9()` 补足/截断到 9 槽后输出。

### 7.2 元件段

| 网表元素 | 工程字段 | 缺省 / 备注 |
| --- | --- | --- |
| `comp@ref` | `component.designator` | —— |
| `comp/value` | `component.value` | `''` |
| `comp/footprint` | `component.footprintId` | `''` |
| `comp/datasheet` | `symbol.kicad.datasheet` | 旧工程无 `kicad` 元数据时写 `'~'`；有元数据且为空 ⇒ **省略整段** |
| `comp/description` | `symbol.kicad.description` | 空 ⇒ 省略 |
| `comp/fields/field` | `symbol.kicad.fields`（保序） | 无该键时由 `symbol.fields`（对象）派生 + `Footprint`/`Datasheet`/`Description` 三条 |
| `comp/libsource` | `symbol.kicad.libsource` → 回退工程库/符号定义 | `lib` 缺省 `'schematic-studio'`，`part` 取符号 id 去 `lib:` 前缀 |
| `comp/property` | `symbol.kicad.properties`（保序） | 无该键时由用户字段派生 + `Sheetname`/`Sheetfile` |
| `comp/sheetpath@names/tstamps` | `symbol.kicad.sheetpath` | 所属图纸的 `sheet.kicad.{name,tstamps}` |
| `comp/tstamps` | `symbol.kicad.tstamps` | `stableUuid(instanceId ‖ designator ‖ 'comp')`——即按 `instanceId`、退化到 `designator`、再退化到常量，取第一个非空值；稳定、非随机 |

`fields` 与 `properties` 必须用**有序数组**保存：KiCad 输出的是原理图插入顺序，对象键序无法表达，也无法区分「无 value」与「空串」。
`datasheet` / `description` / `fields` / `properties` / `sheetpath` / `tstamps` 在 `symbol.kicad` 里全部**可选**；缺省路径保证旧工程导出行为不回归。

#### `tstamps` 的多值形态

KiCad 对多单元符号的实例会写**多个位置字符串**：

```
(tstamps "4c9d5f26-…" "d330ac86-…" "342c76f3-…")     ← J4，L1188，3 个
(tstamps "71933cd7-…" "…" "…" "…" "…")              ← U4，L2766，5 个
```

黄金样本 150 个 `comp` 共 **156** 个 `tstamps` 值：148 个单值、J4 三值、U4 五值。

契约形状为 **`tstamps: string | string[]`**：单值存 `string`，多值存数组，导出按原顺序逐个输出（`(tstamps "a" "b" "c")` 的多个位置字符串）。该双形态已落地；配合 §2 的行尾规则与 §4.2 的编码规则，导入→导出可与 KiCad 9 原文件**逐字节相同**（见 §11）。

### 7.3 库符号段与网络段

| 网表元素 | 工程字段 | 缺省 |
| --- | --- | --- |
| `libpart@lib` / `@part` | 库符号 `libsource.lib` / `id` 去 `lib:` 前缀 | `'schematic-studio'` / 符号 id |
| `libpart/description` | `SymbolDef.description` | `''` |
| `libpart/docs` | `SymbolDef.docs` | 空 ⇒ 省略 |
| `libpart/footprints/fp` | `SymbolDef.footprints` ∪ `fpFilters`（去重保序） | 空 ⇒ 省略 |
| `libpart/fields` | `SymbolDef.fields`（保序） | 5 条缺省：`Reference`(refPrefix) `Value`(name‖id) `Footprint`(无值) `Datasheet`(`~`) `Description`(description) |
| `libpart/pins/pin` | `SymbolDef.pins`（`num` / `name` / 基础类型） | 0 引脚时省略整个 `pins` 段 |
| `library@logical` / `uri` | `project.kicad.libraries[*]` | 空 ⇒ 省略整个 `libraries` 段 |
| `net@code` | 排序后的序号 `1..N` | —— |
| `net@name` | `encodeNetName(net.name, { sheetPath, nameSource })` | —— |
| `net@class` | `net.class` → `project.netClassAssignments[名]` | `'Default'` |
| `node@ref` / `@pin` | `pin.designator` / `pin.pinNumber` | —— |
| `node@pinfunction` | `pin.pinfunction` ‖ `pin.pinName` ‖ `pin.name`；`'~'` 归一为空 ⇒ 省略 | 省略 |
| `node@pintype` | `pintypeOf(pin)` | `'passive'` |

#### net class 映射的三处口径（容易混淆）

1. **网表侧**（`net@class`，114 个网络）：`Default` 69 + 非 Default 45。
2. **映射侧**（`project.netClassAssignments`，**108** 个键）：`Default` **63** + 非 Default **45**。差异是 6 个 `unconnected-(…)` 网络不建标签、不产生键（它们在源文件里都是 `Default`）。
3. **导出回退**：`netClassOf()` 在 `net.class` 与映射都缺失/非法时返回 `'Default'`，因此**写入 `Default` 键与不写，导出结果相同**。

导入器写 `Default` 键与 `docs/NETLIST_KICAD_SPEC.md` §8.2「不写 Default」的旧口径相反；影响仅为键数量，不影响正确性，本文按现行实现（含 Default 键）记录。

#### `unconnected-(…)` 网络的合成

`connectivity` 只产出「有引脚的网络」，单引脚自动网络是 `N$n`；KiCad 则把未进入任何网络的引脚写成独立子网。导出器据此合成（`realNetsOf` + `synthesizeUnconnectedNets`）：

- 先剔除单引脚且 `nameSource === 'auto'` 的网络（电源符号的单脚网络**保留**）；
- 再为「未出现在任何保留网络里的引脚」合成 `unconnected-(<ref>-<引脚名>-Pad<pin>)`，引脚名为空或等于引脚号时省略中间段；
- 判定依据是「未进网」，**不是** `noConnect`——悬空的 passive 引脚同样合成，而 `no_connect` 类型引脚因不进网也自然被覆盖；
- 合成网络与真实网络一起按网络名自然序排序后统一编号。

导入侧反向处理：`unconnected-(…)` 前缀的网络不建标签（悬空引脚留给下一轮导出重新合成）。

---

## 8. 常用代码片段

```js
// 1) 导出 KiCad 9 网表
import { generateKiCad, EXPORTERS } from './src/netlist/index.js';
const text = generateKiCad(project);            // 纯函数，UTF-8 无 BOM、CRLF、末尾无换行
const same = EXPORTERS.kicad.generate(project); // 等价：注册表入口

// 2) 只解析不建工程（排错 / 检查外部网表）
import { readKiCadNetlist } from './src/netlist/kicad-reader.js';
const doc = readKiCadNetlist(text);
if (!doc.ok) console.error(doc.errors);         // [{ line, code, message }]，line 为 1-based
else console.log(doc.version, doc.components.length, doc.nets.length);

// 3) 导入为可编辑工程
import { importKiCadNetlist } from './src/netlist/kicad-import.js';
const result = importKiCadNetlist(text);
if (result.ok) {
  console.log(result.stats);                    // { sheets, components, libparts, libraries, nets, nodes,
                                                //   labels, wires, netsLabeled, netsSkippedUnconnected, classes }
  console.log(result.warnings);                 // [{ code, message }]，不抛异常
} else {
  console.log(result.errors, result.diagnostics); // errors: string[]（带行号的人话），diagnostics: 结构化
}

// 4) 往返自检（导入 → 导出 → 再解析）
import { readFileSync } from 'node:fs';
const source = readFileSync('examples/tinytapeout-demo.net', 'utf8');
const roundTrip = generateKiCad(importKiCadNetlist(source).project);
const a = readKiCadNetlist(source);
const b = readKiCadNetlist(roundTrip);
console.log(a.nets.length === b.nets.length, a.design.sheets.length === b.design.sheets.length);
```

完整的语义往返断言见 `test/integration/kicad-roundtrip.test.mjs`（8 个用例：网络名集合、每网络引脚集合、`code` 序、节点守恒、`pintype`/`pinfunction`、`net class` 直方图、图纸与 9 槽评论、文件级字节特征、二次往返不动点）。

---

## 9. 常见扩展点

### 9.1 新增一种导出格式

1. `src/netlist/index.js`：写 `generateXxx(project, options)`，签名与 `generateKiCad` 一致（纯函数、返回完整字符串、无 BOM）。
2. 在 `EXPORTERS` 里加一项 `{ id, label, extension, mime, generate }`——**`extension` 不带前导点**，`mime` 形如 `text/plain`。
3. `EXPORTER_LIST` / `getExporter` 自动生效；`src/ui/dialogs/export-dialog.js` 的 `FORMAT_NOTES` 可按需补一条版本说明。
4. 加 `test/netlist/<格式>-exporter.test.mjs`，并在 `test/netlist/exporters.test.mjs` 的注册表断言里补 id。
5. 若新格式也需要版本说明或 UI 文案，只改 `src/ui`，**不要**在网表层引入 DOM。

> `kicad` 这个 id 与「四种格式」的结构是稳定契约（ADR-5）：可以升级 `label` 文本，但不得改 id、不得删格式。

### 9.2 新增一项库元数据（例：`ki_locked`）

1. `src/library/symbol-library.js`：`normalizeSymbolDef()` 白名单加字段（默认值要保证旧库不变形）。
2. `src/core/schema.js`：若该字段出现在工程 JSON 的 `library.symbols[*]`，**无需**额外校验（`library` 用 `clone` 保留未知键）；若出现在 `symbol.kicad`，则加 `optionalString` 校验。
3. `src/netlist/index.js`：在 `libpartNode()` / `componentPropertiesOf()` 里决定它落到 `property` 还是新子元素。
4. `src/netlist/kicad-reader.js` + `kicad-import.js`：补反向映射（reader 只做投影，import 负责落库）。
5. 双向测试：导出 → 解析 → 导入 → 再导出，断言该字段不变。

### 9.3 新增工程级可选字段

必须同时改四处，否则会在第一次「打开 → 保存」后**静默丢失**：

1. `src/model/project.js` 的对应 `normalize*()`（`normalizeProject` / `normalizeSheet` / `normalizeTitle` / `normalizeSymbolInstance` 都是**白名单重建**）；
2. `src/core/schema.js` 加「存在即校验形状」的可选校验（缺失时零错误）；
3. 导出/导入映射；
4. 回归测试：不含新字段的旧工程 JSON 经 `normalizeProject` 后与改动前深相等。

**不要升 `SCHEMA_VERSION`**：新增字段一律可选，v1 继续成立（见 §10）。

---

## 10. 向后兼容承诺

- `SCHEMA_VERSION` 保持 **1**，`migrateProject()` 不变；`project.kicad`、`project.netClassAssignments`、`sheet.kicad`、`sheet.title.source`、`symbol.kicad`、`net.class`、`pin.noConnect`/`free` 全部**可选**。
- 旧工程（无任何 KiCad 字段）必须：通过 `validateProject`、经 `normalizeProject` 后形状与改动前一致、导出结果除排版与已登记的语义修正外不回归。
- 引脚电气类型：旧值 `not_connected` 保留为可读别名（读入时迁移为 `no_connect` + `noConnect: true`），`LEGACY_PIN_ELECTRICAL_TYPES` 至少再保留一个版本。
- 新增字段的缺省值见 §7；缺省路径必须让「无 KiCad 元数据的工程」也能导出结构合法的网表。

---

## 11. 逐字节还原与已知差异

### 11.1 逐字节还原（当前能力）

导入 `examples/tinytapeout-demo.net` 后再导出，输出与 KiCad 9 原文件**逐字节相同**：

| 指标 | 值 |
| --- | --- |
| 字节数 | 254285（两侧一致） |
| SHA-256 | `2f92e581a7b7451307f6536d9858e42351d2378cdc22b3dfb9ab19e4e831a53f` |
| 行数 / 行尾 | 4680 行、4679 处 CRLF、0 处裸 LF |
| 其他 | 无 BOM、末字节为 `)`、0 行差异 |

该能力由 `test/integration/kicad-roundtrip.test.mjs` 的逐字节断言保障。**成立的前提是三件事同时正确**（改任何一处都会让字节比对失败）：

1. **文件级格式**：CRLF 行尾、末尾不补换行、无 BOM、闭括号并入末行（§2）；
2. **名称编码**：标签文本里的 `/` → `{slash}`、层级路径前缀保留、`pinfunction` 不编码（§4.2、§4.3）；
3. **多值字段保序**：`comp/tstamps` 的多个位置字符串按原顺序输出，不截断、不重排（§7.2）。

> 维护提示：若逐字节断言报出「仅 J4 / U4 两行不同（约 234 字节）」，说明多值 `tstamps` 保真缺失（模型侧退化为单值），而不是编码或行尾问题。

### 11.2 语义等价但非逐字节的已知差异

| # | 现象 | 影响 | 状态 |
| --- | --- | --- | --- |
| 1 | 自动网络名用 `N$n`，KiCad 用 `Net-(…)` / `unconnected-(…)` | **新建工程**的网络名与 KiCad 惯例不同；导入的工程沿用源网表名，不受影响 | 已知；`unconnected-(…)` 已在导出侧合成 |
| 2 | `netClassAssignments` 写入 `Default` 键 | 键数量 108 而非 45；导出回退不受影响 | 已知（见 §7.3） |
| 3 | 导入的符号几何是自动生成的（矩形本体 + 左列引脚 + flow 布局），不是原始符号图形 | 原理图外观与原图不同；连通性与网表语义完整 | 设计取舍（ADR-6） |
| 4 | 导入不还原导线路径，只生成 2.54mm stub | 原理图不可视复现，但引脚-网络关系可完整重建 | 设计取舍（ADR-6） |
| 5 | 引脚电气类型冲突（同符号不同实例的 `pintype` 基础类型不一致） | 记 `PIN_TYPE_MISMATCH` warning，取最后一次观测 | 已知；黄金样本 warnings = 0 |
| 6 | **新建**工程的 `design/date` 取 `meta.modified`（完整 ISO，如 `2026-11-19T10:25:58.000Z`），不是 KiCad 的 `+0800` 本地偏移写法 | 只影响新建工程的首行元数据；导入的工程沿用源文件日期，故不影响逐字节还原 | 已知；有 `project.kicad.date` 时以它为准 |

---

## 12. 排错速查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `MISSING_EXPORT` | 文件不是 `(export …)` 开头（例如喂了 `.kicad_sch`） | 确认输入是网表 |
| `UNTERMINATED_STRING` / `UNTERMINATED_LIST` | 文件被截断或手工编辑破坏 | 用 `readKiCadNetlist` 的行号定位 |
| `UNEXPECTED_VERSION` warning | `version` 不是 `"E"` | 仍按 E 解析；核对是否 KiCad 6/7 网表 |
| 导入后网络变多 | 6 个 `unconnected-(…)` 被跳过，悬空引脚成了单引脚自动网络 | 期望行为（§7.3） |
| 逐字节比对仅 J4 / U4 两行不同 | 多值 `tstamps` 保真缺失（退化为单值） | 见 §11.1 维护提示 |
| 逐字节比对大面积不同 | 行尾或名称编码被破坏（`\n` 代替 CRLF、`{slash}` 被重复编码） | 检查 §2 与 §4.2 |
| 导出文本带 BOM / 多一个空行 | 调用方又包了一层编码或 `join('\n') + '\n'` | `generateKiCad` 已含行尾与末尾处理，直接写文件即可 |
| `PIN_MODIFIER_CONFLICT` warning | 同一符号同一引脚在不同实例上的 `no_connect`/`free` 不一致 | 检查源网表是否本身矛盾 |
