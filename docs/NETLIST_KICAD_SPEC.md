# KiCad 9 网表格式规范与数据契约（version `E`）

> [!IMPORTANT]
> **本文已被 [`NETLIST_KICAD.md`](./NETLIST_KICAD.md) 取代（存档保留）。**
>
> - **现行开发者参考**：[`NETLIST_KICAD.md`](./NETLIST_KICAD.md)——长期维护的格式要点、字段映射、扩展点与排错速查。
> - **接口权威**：[`CONTRACTS.md`](./CONTRACTS.md)。
> - 本文保留的原因：它是 T1 阶段的**一次性实测规范**，逐条记录了黄金样本上的原始测量（含行号、出现次数与「已证伪的假设」14 条），是后续勘误与决策追溯的依据。**不要按本文实现新代码**；与 `NETLIST_KICAD.md` 或代码冲突时，以那两者为准。
> - 已知被后续实现细化的两处：①`sheet.title.comments` 与 `symbol.kicad.tstamps` 现均为**双形态**（`string | string[]`）；②导入器会为 108 个网络写 `netClassAssignments`（含 63 个 `Default`），与本文 §8.2「不写 Default」的原始口径相反，但不影响导出回退。

本文最初是 schematic-studio 导出 / 导入 KiCad 9 网表的格式与数据契约，用于锁定 T1–T5 的实现口径。

- **权威样本**：`examples/tinytapeout-demo.net`（KiCad **9.0.8** 导出，`(version "E")`，254285 字节 / 4680 行，由 `Eeschema 9.0.8-6-gca86c82f9b4-dirty` 生成）。
- **本文所有数字、行号、取值都可在该文件上用 §12 的脚本复算**；没有凭记忆写下的「KiCad 应该如此」。凡属推断而非实测，均显式标注「（推断）」。
- 符号约定：`?(…)` 表示可选元素，`…*` 表示 0..n 次重复，`→` 表示映射到模型字段。

---

## 0. 术语与读取顺序

| 术语 | 含义 |
| --- | --- |
| **网表编码原文** | 文件字符串字面量里的字符序列，仅做 S-表达式反转义（`\\`→`\`、`\"`→`"`、`\n`→换行、`\t`→制表符），不做 `{slash}` / `~{…}` 解码 |
| **`{slash}`** | KiCad 用来在**网络名 / 标签文本**中表示字面 `/` 的占位记号（见 §5.2） |
| **`~{…}`** | KiCad 用来表示「上划线（overbar）」的标记，`~{abc}` 在 KiCad 里显示为带一条上划线的 `abc`（见 §5.3） |
| **`~`（独占）** | 空值哨兵，只用于 `datasheet` / `docs` 表示「无」（见 §4.4） |
| **槽（slot）** | `title_block` 的 9 个 `comment` 位置，`number` 固定 `"1"`…`"9"` |

---

## 1. 实测统计总表

| 项目 | 实测值 | 备注 |
| --- | --- | --- |
| 字节数 / 字符数 | 254285 / 254 283 | 差值来自 2 个 `±`（U+00B1，各 2 字节） |
| 行数 | 4680 | 按 CRLF 切分；文件**无结尾换行** |
| 顶层 5 节 | `design` `components` `libparts` `libraries` `nets` | 顺序固定，见 §3.0 |
| `comp` | **150** | 无重复位号 |
| `sheet` | **2** | `/`（125 comp）、`/RP2040/`（25 comp） |
| `title_block` | **2**（每 sheet 1 个） | 每个含 9 条 `comment` |
| `libpart` | **28** | 全部 `lib="TinyTapeout"` |
| `library` | **1** | `logical="TinyTapeout"` |
| `net` | **114** | `code` 严格 `1..114`，无重名 |
| `node` | **584** | 平均 5.1 节点/网；最小 1、最大 123（`GND`） |
| comp `field` | **981**（13 种字段名） | 其中 316 无值 |
| comp `property` | **1140**（16 种属性名） | 其中 28 完全无值、158 值为 `""` |
| libpart `field` | **143**（8 种字段名） | 其中 23 无值 |
| libpart `pin` | **287** | 其中 34 个 `name` 为 `""` |
| 空 `pinfunction` | `(pinfunction "")` **0** 次、`(pinfunction "~")` **0** 次 | 空时整段省略（224 个 node 无该子节点） |
| 含 `{slash}` 的字符串 | 4（全部是网络名） | `SDI{slash}out0` `SDO{slash}out1` `cinc{slash}out3` `~{crst}{slash}out2` |
| 含裸 `/` 的网络名 | 12 | 层级路径前缀 `/`、`/RP2040/` 等 |
| 含裸 `/` 的 `pinfunction` | 35 / 360 | `pinfunction` **不**做 `{slash}` 编码 |

---

## 2. 文件级格式

### 2.1 编码、换行与结尾

实测（§12 复算脚本第 1 段）：

| 属性 | 值 | 说明 |
| --- | --- | --- |
| 编码 | UTF-8，**无 BOM** | 首字节为 `0x28`（`(`） |
| 换行 | **CRLF**（4679 个 `\r\n`，0 个裸 LF） | Windows 上的 KiCad 默认 |
| 结尾 | **文件末尾没有换行** | 最后一个字符是 `)` |
| 空行 | 0 | 全文没有空行 |
| 行首空白 | 制表符 0 个；缩进全为空格且为偶数个 | 见 §2.3 |
| 仅含 `)` 的行 | **0** | 闭括号一律并入最后一行（§2.3 R4） |

> **对 T3 的硬性含义**：导出器默认必须输出 `\r\n` 且**不加**结尾换行，否则「解析 → 再导出」不可能逐字节相等。
> **对仓库的含义**：`.gitattributes` 用 `* text=auto eol=lf`，会把该样本的 CRLF 规范化成 LF。本分支已追加 `*.net -text`（见 `.gitattributes` 末两行），使黄金样本按原始字节入库（`git cat-file -s` = 254285 = 工作区文件大小）。

### 2.2 S-表达式词法与字符串转义

文法（足够实现解析与生成，无需 KiCad 源码）：

```
document := list
list     := '(' element* ')'
element  := list | string | atom
string   := '"' quoted-char* '"'
quoted-char
         := 任意非 '"' 非 '\' 的字符
          | '\\' '\\'        → 字面反斜杠 '\'
          | '\\' '"'         → 字面双引号 '"'
          | '\\' 'n'         → 换行 LF
          | '\\' 't'         → 制表符 TAB
atom     := 除空白、'('、')'、'"' 之外的非空字符序列
```

- 引号是**必需**的：全部字段值都以字符串字面量出现；`atom` 只用于结构名（`export` `net` `node` …）。
- 出现在文件中的转义实测（§12 复算脚本第 5 段）：

| 转义 | 次数 | 出现位置 |
| --- | --- | --- |
| `\\`（字面反斜杠） | 9 | `(source "C:\\workspace\\…")`（5）、`(uri "C:\\workspace\\…")`（4） |
| `\n`（换行） | 4 | `(description "\nUSB-C …\n")` 与对应 `(field (name "Description") …)` **各 2 次** |
| `\"` | 0 | 样本中无引号需要转义，但**必须**支持（现有测试已覆盖） |
| `\t` | 0 | 样本中无制表符，但**必须**支持 |

- **反转义**：读取时 `\\`→`\`、`\"`→`"`、`\n`→换行、`\t`→制表符；其余 `\x` 序列（样本中不存在）保守保留为 `x`。
- **转义**：写出时依次 `\`→`\\`、`"`→`\"`、换行→`\n`、制表符→`\t`。**顺序不可颠倒**（否则 `\` 会被二次转义）。
- 现有实现 `src/netlist/index.js:95-103` 的 `escapeSExpr` 已符合本条，T3 可原样复用。

### 2.3 排版（缩进 / 换行 / 闭括号）

实测行首缩进直方图：`0→1`、`2→5`、`4→298`、`6→2901`、`8→1475`（合计 4680）。可归纳为 6 条规则：

- **R1 缩进**：行首空格数 = `2 × 深度`，深度 = 该行**首个** token 所在 list 的嵌套层数（`(export …` 为深度 0）。
- **R2 头行内联**：多行元素的「头行」把结构名 + 内联标量 + 内联单行子列表写在同一行，例如
  - `  (design`、`    (sheet (number "1") (name "/") (tstamps "/")`
  - `    (comp (ref "C1")`、`    (libpart (lib "TinyTapeout") (part "C_Small")`
  - `    (library (logical "TinyTapeout")`
  - `    (net (code "1") (name "+1V8") (class "pwr")`
- **R3 结构子元素各占一行**：如 `(value …)`、`(fields`、`(property …)`、`(pinfunction …)` 所在层级为「父深度 +1」。
- **R4 闭括号并入最后一行**：任何 list 的 `)` 都追加在其内容最后一行的末尾，**绝不单独成行**。例：
  - `      (tstamps "00db537f-…"))` ← `tstamps)` + `comp)`
  - 第 37 行 `        (comment (number "9") (value "")))))` ← `value)` `comment)` `title_block)` `sheet)` `design)` 共 5 个
  - 第 4680 行（文件最后一行）`      (node … (pintype "bidirectional")))))` ← `node)` `net)` `nets)` `export)` 共 4 个
- **R5 叶节点单行**：无结构子元素的 list 整体一行，如 `(version "E")`、`(ref "C1")`、`(fp "C_*")`、`(pin (num "1") (name "") (type "passive"))`、`(node (ref "C1") (pin "1") (pintype "passive"))`、`(field (name "MPN") "…")`、`(property (name "MPN") (value "…"))`。
- **R6 无空行**，也**没有**「只有闭括号」的收尾行。

> 现有实现 `src/netlist/index.js:232-233` 用 `lines.push('  )')` 收尾，违反 R4/R5；T3 必须改为「闭括号追加」。

---

## 3. 语法分节与元素清单

### 3.0 顶层顺序

实测顶层子节点顺序恒为：

```
design → components → libparts → libraries → nets
```

`(export (version "E")` 在第 1 行，`design` 第 2 行、`components` 第 38 行、`libparts` 第 3352 行、`libraries` 第 3979 行、`nets` 第 3982 行。**T3 必须按此顺序输出，T4 必须允许任意顺序输入（顺序不参与语义）。**

### 3.1 `export`

```
(export (version "E") <design> <components> <libparts> <libraries> <nets>)
```

| 元素 | 出现 | 契约 |
| --- | --- | --- |
| `version` | 必现 | 本规范固定为 `"E"`（KiCad 9） |

### 3.2 `design`

```
(design
  (source "<.kicad_sch 绝对路径>")
  (date "<ISO-8601 带时区偏移>")
  (tool "<生成器名与版本>")
  <sheet>*)
```

实测（第 2–37 行）：

| 元素 | 实测值 | 说明 |
| --- | --- | --- |
| `source` | `C:\\workspace\\kicad\\demos\\tiny_tapeout\\tinytapeout-demo.kicad_sch` | **源原理图文件路径**，反斜杠以 `\\` 转义；不是工程名 |
| `date` | `2026-11-19T10:25:58+0800` | 完整时间戳 **带 UTC 偏移**（不是只有日期） |
| `tool` | `Eeschema 9.0.8-6-gca86c82f9b-dirty` | 生成器标识 |

#### 3.2.1 `sheet`

```
(sheet (number "<n>") (name "<sheet 路径>") (tstamps "<UUID 路径>")
  (title_block …))
```

实测 2 个：

| `number` | `name` | `tstamps` | 行号 |
| --- | --- | --- | --- |
| `"1"` | `"/"` | `"/"` | 6 |
| `"2"` | `"/RP2040/"` | `"/5384e408-8f0c-411c-b558-df35c2e889ec/"` | 22 |

- `name` 是 **KiCad sheet 路径**（首尾带 `/`），与 `Sheetname` 属性的人工名（`Root` / `RP2040`）**不同**；不要混用。
- `tstamps` 是 `UUID` 路径，根图为 `"/"`。

#### 3.2.2 `title_block`

```
(title_block
  (title "<标题>") (company "<公司>") (rev "<版本>") (date "<日期>")
  (source "<源文件名>")
  (comment (number "1") (value "<c1>")) … (comment (number "9") (value "<c9>")))
```

- 6 个标量/结构子元素顺序固定：`title` `company` `rev` `date` `source` `comment×9`。
- **`comment` 恒为 9 条**，`number` 恒为 `"1"`…`"9"`，值为空时写 `(value "")`（本样本每个 `title_block` 的槽位 4–9 共 6 条为空）。
- `title_block` 的 `date`（`"2023-11-22"`）与 `design` 的 `date`（时间戳）**是两个不同字段**，不要合并。

实测值（sheet 1 / sheet 2）：

| 字段 | sheet 1 | sheet 2 |
| --- | --- | --- |
| `title` | `TinyTapeout 4/5 Demo Board PRELIM` | `RP2040 Basic Support` |
| `company` | `Psychogenic Technologies` | 同左 |
| `rev` | `1.0.4` | `1.0.3` |
| `date` | `2023-11-22` | `2023-11-22` |
| `source` | `tinytapeout-demo.kicad_sch` | `rp2040.kicad_sch` |
| `comment 1..3` | `See LICENSE.txt for details` / `Licensed under Apache 2.0` / `(C) 2023 Pat Deegan` | 同左 |
| `comment 4..9` | 全 `""` | 全 `""` |

### 3.3 `components` / `comp`

```
(components
  (comp (ref "<位号>")
    (value "<值>")
    (footprint "<LIB:FOOTPRINT>")
    ?(datasheet "<URL|~>")
    ?(description "<描述>")
    (fields
      (field (name "<字段名>") ?"<值>")*)
    (libsource (lib "<库逻辑名>") (part "<符号名>") (description "<符号描述>"))
    (property (name "<属性名>") ?(value "<值>"))*
    (sheetpath (names "<sheet 路径>") (tstamps "<UUID 路径>"))
    (tstamps "<UUID>"))*)
```

**子元素顺序固定**（实测 11 种组合，全部服从该顺序）：

`ref` → `value` → `footprint` → `datasheet?` → `description?` → `fields` → `libsource` → `property*` → `sheetpath` → `tstamps`

| 元素 | 出现次数 | 规则 |
| --- | --- | --- |
| `ref` / `value` / `footprint` / `libsource` / `fields` / `sheetpath` / `tstamps` | 150 / 150 | **必现** |
| `datasheet` | **140** | **值为空时整段省略**；`"~"` 表示「无数据手册」（125 次）；否则为 URL |
| `description` | **2**（`J15`@L1327、`Y1`@L3336） | 符号描述，非空才输出 |
| `property` | 1140 | 每 comp 4–10 条，见 §3.3.2 |
| `field` | 981 | 每 comp 3–9 条，见 §3.3.1 |

#### 3.3.1 `fields` / `field`

`fields` 块恒存在（150/150），子元素全为 `field`。

- **每 comp 的 `field` 条数为 3–9**（实测分布：3→18、4→2、5→11、6→37、7→25、8→46、9→11）。
- 13 种字段名实测：`Footprint`(150) `Datasheet`(150) `Description`(150) `MPN`(132) `Characteristics`(115) `MPN_ALT`(114) `Part number`(88) `JLC`(59) `DigikeyPN`(19) `DNP`(1) `MAXIMUM_PACKAGE_HEIGHT`(1) `MANUFACTURER`(1) `Status`(1)。
- **顺序是原理图里的插入顺序，不是字母序**——因此模型中必须用**有序数组**保存（§8.5），不能退化成对象键。
- `Footprint` / `Datasheet` / `Description` **每个 comp 必有**（各 150），即使为空。
- **空值写法**：省略 `value` token，写成自闭合 `(field (name "Datasheet"))`。样本中 `(field (name "X") "")` 出现 **0 次**（实测 316 个空字段全部为自闭合形态）。

#### 3.3.2 `property`

`property` 与 `fields` 是**两套平行视图**，不能互相替代：

- **每 comp 的 `property` 条数为 4–10**（实测分布：4→6、5→21、6→9、7→25、8→31、9→46、10→12）。
- `fields` = 位号/值/封装/数据手册/描述 + 用户自定义字段（BOM 视角）。
- `property` = 上述用户字段的**并集**加上 KiCad 实例内部属性：`Sheetname`(150)、`Sheetfile`(150)、`ki_keywords`(142)、`ki_fp_filters`(139)、`exclude_from_bom`(17)、`dnp`(11)，以及 1 个用户自定义的大写 `DNP`(1)。
- **两种空值形态都真实存在，必须区分保存**：
  - `(property (name "dnp"))` —— 无 `value` 子节点（28 次）
  - `(property (name "JLC") (value ""))` —— 有 `value` 且为空串（158 次）

#### 3.3.3 `libsource`

恒为 `(libsource (lib "…") (part "…") (description "…"))`，三个子元素**全部必现**（150/150，无空 description）。

- `lib` = 库逻辑名（本例恒 `TinyTapeout`，与 `libraries/library@logical` 对应）
- `part` = 符号名（与 `libparts/libpart@part` 对应）
- `description` = 符号描述（与 `libpart/description` 同源）

#### 3.3.4 `sheetpath` / `tstamps`

- `sheetpath (names "/") (tstamps "/")` —— 该实例所属 sheet 的路径；实测 `/`→125、`/RP2040/`→25，与 `sheet@name` 一一对应。
- `tstamps` = 实例自身 UUID（150 个，全不重复）。

### 3.4 `libparts` / `libpart`

```
(libparts
  (libpart (lib "<库逻辑名>") (part "<符号名>")
    (description "<描述>")
    ?(docs "<URL|~>")
    ?(footprints (fp "<通配符>")*)
    (fields (field (name "…") ?"<值>")*)
    ?(pins (pin (num "<号>") (name "<名>") (type "<电气类型>"))*)) *)
```

实测 28 个，子元素顺序固定为：`lib`+`part`（头行内联）→ `description` → `docs?` → `footprints?` → `fields` → `pins?`。

| 元素 | 出现 | 说明 |
| --- | --- | --- |
| `description` | 28/28 | 必现、非空 |
| `docs` | **25/28** | 缺失 3 个：`CARAVEL_TT04_BREAKOUT_REVB`、`PMOD_HOST_2x6`、`USB4500-03-0-A_REVA`；`"~"` 18 次表示「无」 |
| `footprints` | **24/28** | 缺失 4 个：上述 3 个 + `SW_Push`；每个含 1–4 个 `fp` |
| `fields` | 28/28 | 24 个为 5 条（`Reference` `Value` `Footprint` `Datasheet` `Description`，**顺序固定**）；`USB4500-03-0-A_REVA` 例外有 8 条（尾部追加 `MAXIMUM_PACKAGE_HEIGHT` `MPN` `MANUFACTURER`） |
| `pins` | **27/28** | 缺失 1 个：`Fiducial`（虚拟符号，0 引脚）→ 该 libpart **没有** `pins` 块 |

`libpart/fields` 的 143 条中 23 条无值：`Footprint` **20/28 无值**、`Datasheet` **3/28 无值**；其余（`Reference` `Value` `Description` 及 USB4500 的 3 条扩展字段）**全部有值**。

`(footprints (fp "C_*"))` 的 `fp` 是**封装通配符**（KiCad 的 `ki_fp_filters`），不是具体封装名。

`(pins (pin (num "1") (name "") (type "passive")) …)`：
- `num` 是**字符串**（可以是 `"A4_B9"` 之类）。
- `name` 空时写 `""`（34 次），**不是**省略、也不是 `~`。
- `type` 词汇见 §4.3。

### 3.5 `libraries` / `library`

```
(libraries
  (library (logical "<库逻辑名>")
    (uri "<.kicad_sym 绝对路径>")))
```

实测 1 条（第 3979–3981 行）：

```
(library (logical "TinyTapeout")
  (uri "C:\\workspace\\kicad\\demos\\tiny_tapeout/tinytapeout-kicad-libs/symbols/TinyTapeout.kicad_sym"))
```

- `uri` 在本例中是**本地文件路径**（反斜杠转义 + 混入 1 个正斜杠），不保证是 URI scheme。
- 该段与 `libparts/libpart@lib`、`comp/libsource@lib` 通过 `logical` 关联。

### 3.6 `nets` / `net` / `node`

```
(nets
  (net (code "<n>") (name "<网络名>") (class "<net class>")
    (node (ref "<位号>") (pin "<引脚号>") ?(pinfunction "<引脚功能>") (pintype "<类型>"))*)*)
```

- `code` / `name` / `class` 三者内联在头行，**必现**（`class` 出现 114/114，`Default` 也显式写出，不省略）。
- `code` 从 `"1"` 连续递增到 `"114"`，无重复（实测 `codesSequential: true`）。
- `node` 子元素顺序固定：`ref` → `pin` → `pinfunction?` → `pintype`。
- **`pinfunction` 为空时整段省略**：584 个 node 中 360 个有、224 个没有；`(pinfunction "")` 与 `(pinfunction "~")` 各出现 **0** 次。
- `pintype` 恒有（584/584），空值不存在。

---

## 4. 取值词汇表

### 4.1 `net@class`（9 种，实测分布）

| class | 网络数 | 代表网络 |
| --- | --- | --- |
| `Default` | 69 | `/CC1`、`/RP2040/QSPI_CLK`、`Net-(R1-Pad2)`、`boot_mode`、`gpio` |
| `ioout` | 12 | `SDI{slash}out0`、`out0`…`out7`、`cinc{slash}out3` |
| `ioin` | 8 | `in0`…`in7` |
| `iobidir` | 8 | `uio0`…`uio7` |
| `config` | 7 | `HK_CSB`、`ctrl_ena`、`~{ctrl_sel_rst}` |
| `pwr` | 3 | `+1V8`、`+3V3`、`GND` |
| `clk` | 3 | `RP_proj_clk`、`project_clk`、`xclk` |
| `pwrhi` | 2 | `+5V`、`VBUS` |
| `usbdiff` | 2 | `usb_d+`、`usb_d-` |

class 名不是固定枚举——它来自工程里的 net class 定义，实现必须把**任意字符串**透传，只把 `"Default"` 当作缺省。

### 4.2 `node@pintype`（实测 9 种形态）

| `pintype` | 次数 | 形态 |
| --- | --- | --- |
| `passive` | 320 | 基础类型 |
| `bidirectional` | 118 | 基础类型 |
| `power_in` | 85 | 基础类型 |
| `input` | 43 | 基础类型 |
| `output` | 11 | 基础类型 |
| `power_out` | 3 | 基础类型 |
| `bidirectional+no_connect` | 2 | 基础类型 + 修饰符（`J15` SBU1/SBU2） |
| `no_connect` | 1 | 本身即基础类型（`U3` pin 4） |
| `input+no_connect` | 1 | 基础类型 + 修饰符（`X1` pin 1 Tri-State） |

**编码规则（据实测归纳，并与 KiCad 电气类型枚举一致）**：

```
pintype := baseType ( '+no_connect' | '+free' )?
```

- `baseType` ∈ §8.7 的 12 值词汇。
- 引脚带「不连接」标记时追加 `+no_connect`；`baseType` 本身为 `no_connect` 时**不再追加**（得裸 `no_connect`）。
- 引脚带「自由（free）」标记时追加 `+free`。**样本中 `+free` 出现 0 次**——属前向兼容扩展，不是实测证据。
- 解析方向：先按 `+` 切分，右侧是修饰符，左侧是基础类型。

### 4.3 `libpart/pin@type`（实测 7 种）

`passive`(94) `bidirectional`(76) `power_in`(63) `input`(39) `output`(11) `power_out`(3) `no_connect`(1)。

注意 **libpart 引脚类型不带修饰符**：`+no_connect` / `+free` 只出现在 `node@pintype`。

### 4.4 `~` 空值哨兵

`"~"` **只**用于 `datasheet` 与 `docs`，表示「无」，且是**显式写出**的（`datasheet "~"` 125 次、`docs "~"` 18 次）。

「空」与「无」是两个不同状态，实现必须区分：

| 场景 | 网表写法 | 模型含义 |
| --- | --- | --- |
| 字段完全空 | **省略子节点**（`(datasheet …)` 消失 / `(field (name "X"))`） | `undefined` / 空 |
| 字段为「无」 | `(datasheet "~")` | 字符串 `"~"` |
| 字段有值 | `(datasheet "https://…")` | 原字符串 |

⚠️ 常见误解：`~` **不是**通用的空串哨兵。`(value "")`、`(name "")`、`(property … (value ""))` 都真实存在，说明空串有独立写法。

### 4.5 自动网络名

KiCad 对「没有标签、也没有电源名」的网络自动命名，实测两类（共 43 个）：

| 形态 | 例子 | 出现 |
| --- | --- | --- |
| `Net-(<位号>-<引脚名或 Pad<号>>)` | `Net-(C1-Pad2)`、`Net-(D1-A)`、`Net-(U6-XIN)` | 37 |
| `unconnected-(<位号>-<引脚名或 Pad<号>>)` | `unconnected-(J15-SBU1-PadA8)`、`unconnected-(U3-NC-Pad4)`、`unconnected-(X1-Tri-State-Pad1)` | 6 |

- 引脚名为空时用 `Pad<pin>`；否则直接用引脚名（`A`、`DP`、`XIN`、`NC`、`Tri-State`…）。
- 名内不含 `/`，因此不涉及 `{slash}`。
- 现有实现用 `N$n`（`src/netlist/connectivity.js:6`），与 KiCad 不一致；这**不阻碍**语义往返（名字本身就是数据），但会阻碍与本样本的逐字节比对。

---

## 5. 转义规则（关键）

### 5.1 字符串级转义

见 §2.2。只有 `\` `"` 换行 制表符 四个字符需要转义。

### 5.2 网络名中的 `{slash}`

**规则（从实测数据精确归纳，不要简化成「所有 `/` 都变 `{slash}`」）**：

| 观测 | 计数 | 例 |
| --- | --- | --- |
| 网络名含裸 `/` | 12 | `/CC1`、`/CC2`、`/RP2040/DVDD`、`/RP2040/QSPI_SD0`、`/~{CRVRST}` … |
| 网络名含 `{slash}` | 4 | `SDI{slash}out0`、`SDO{slash}out1`、`cinc{slash}out3`、`~{crst}{slash}out2` |
| 网络名同时含裸 `/` 与 `{slash}` | **0** | —— |

结构规律：

- 含**裸 `/`** 的 12 个名字全部以 `/` **开头**（`/…`），是 KiCad 的**层级路径前缀**（`/` = 根图，`/RP2040/` = 子图）。路径分隔符**原样保留**。
- 含 `{slash}` 的 4 个名字**都不以 `/` 开头**，它们来自**全局标签**（global label）文本里的字面 `/`。例如标签 `SDI/out0` → 网络名 `SDI{slash}out0`。

**因此**：`{slash}` 编码作用于「标签文本里作为普通字符的 `/`」，而层级路径的 `/` 是结构分隔符、不编码。二者不会在同一条名字里混用。

> 实现提示：我们的模型没有 KiCad 的层级路径前缀（网表是全工程扁平的），所以对本模型而言「网络名中的 `/`」全部等价于「标签里的字面 `/`」。§8.8 因此把 `net.name` 定为**网表编码原文**，导出时不重新编码——这是保证黄金样本语义往返的前提。

### 5.3 上划线 `~{…}`

- 写法 `~{text}`，渲染为上划线 `text`；可出现在**网络名**与**pinfunction / 引脚名**中。
- 实测 13 个字符串含 `~{`（8 个不同值）：`~{OE}`、`~{CS}`、`/RP2040/~{CRVRST}`、`~{ctrl_sel_rst}`、`~{project_rst}`、`~{crst}{slash}out2`、`~{rst}/mio[7]`、`mio[36]/~{ctrl_sel_rst}`。
- 与 `{slash}` **可同时出现**（`~{crst}{slash}out2`），处理顺序无关（两者互不含对方的分隔符）。
- 模型层**逐字保留** `~{}` 标记；只在 UI 渲染时可选地美化为上划线。

### 5.4 `pinfunction` 保留原始 `/`

**这是最容易被写错的一条**：

| 位置 | `/` 的处理 | 实测证据 |
| --- | --- | --- |
| 网络名 `net@name` | 标签里的 `/` → `{slash}`；路径前缀的 `/` 保留 | §5.2 |
| `node@pinfunction` | **原样保留** `/`，从不变 `{slash}` | 35/360 个含裸 `/`，含 `{slash}` 的 0 个 |
| `libpart/pin@name` | **原样保留** `/` | 35/287 个含裸 `/`，含 `{slash}` 的 0 个 |

实例（第 4671 行）：

```
(net (code "113") (name "~{ctrl_sel_rst}") (class "config")
  (node (ref "J4") (pin "A8") (pinfunction "mio[36]/~{ctrl_sel_rst}") (pintype "input"))
```

同一个物理引脚在两个字段里有两种 `/` 写法，必须分别对待。

### 5.5 实现口径小结

| 方向 | 网络名 | pinfunction / 引脚名 |
| --- | --- | --- |
| 解析（导入） | 逐字保留（只做 S-表达式反转义） | 逐字保留 |
| 生成（导出） | 逐字写出 | 逐字写出 |
| UI 显示 | 可把 `{slash}`→`/`、`~{x}`→上划线 | 可把 `~{x}`→上划线 |

---

## 6. 排序与编号规则（全部实测）

### 6.1 `components` / `comp`

**规则：先按图纸顺序（`sheet@number` 升序），再按图纸内位号的「自然序」。**

实测位号序列：`C1 … C28, C42, C43, C56…C61, D1…D4, F1, FID1…FID3, J1…J9, J12…J18, JP1…JP8, MT1…MT4, NT1, R1…R33, R41…R48, SW1…SW4, TP1, U1…U4, U7, X1`（125 个，全属 sheet `/`），随后 `C29…C41, J10, J11, R34…R40, U5, U6, Y1`（25 个，sheet `/RP2040/`）。

验证：两个子序列各自 `naturalCompare` 严格递增 ✅；整体**不是**全局自然序（`C42` 出现在 `C29` 之前）✅ ——这正是「先分组再排序」的判别证据。

### 6.2 `libparts` / `libpart`

按 `(lib, part)` 自然序：`74CBTLV3257, AP2112K-1.8, AZ1117-3.3, CARAVEL_TT04_BREAKOUT_REVB, C_Small, Conn_01x02 … W25Q32JVSS` ✅（`naturalCompare` 验证通过）。

### 6.3 `nets` 的编号与顺序

**规则：先按网络名「自然序」排序（大小写敏感、数字段按数值比较），再依次赋 `code = 1..N`。**

验证结果（§12 复算脚本第 6(b) 段）：

| 假设 | 结论 |
| --- | --- |
| `code` = 1..114 连续且与出现顺序一致 | ✅ |
| 顺序 == 仓库 `naturalCompare(name)` 排序 | ✅ **完全一致** |
| 顺序 == 纯 ASCII 字典序 | ❌ 首个反例在第 42 位：`Net-(R2-Pad2)` 与 `Net-(R10-Pad2)` |

> 好消息：现有 `src/netlist/connectivity.js:631,762` 已用 `naturalCompare` 排序，与 KiCad 一致。

### 6.4 `net` 内 `node` 顺序

**规则：按 `(ref, pin)` 的「纯 ASCII 字节序」排序**（不是自然序！）。

验证（§12 复算脚本第 6(c) 段）：全部 114 个网络的节点序列与 `plain-strcmp(ref) || plain-strcmp(pin)` 完全一致 ✅。

判别证据（`+3V3` 网）：`C1, C10, C12, C14, C19, C23, C31, C4, C43, C5, C56 …` —— `C10` 排在 `C4` 之前，`C1` 排在 `C10` 之前，是纯字节序。

同一位号内的引脚号同样是字节序：`J12` 的 `pin "12"` 排在 `pin "6"` 之前；`J4` 的 `A19, B1, B15, B17, B3, B37, B39`。

> 现有实现 `src/netlist/index.js:88-93` 的 `sortedPins` 用 `naturalCompare`，**与此不符**（会把 `pin "3"` 排在 `pin "12"` 前）。T3 必须改。

---

## 7. 与现有实现的差距表

图例：**缺失** = 完全不输出/不读；**错误** = 有输出但语义不符；**部分** = 有条件缺失；**一致** = 无需改动。

### 7.1 `src/netlist/index.js` — `generateKiCad`（第 192–234 行）

| # | 网表元素 / 规则 | 现有实现 | 差距 | 位置 |
| --- | --- | --- | --- | --- |
| G1 | `export (version "E")` | 输出 | 一致 | `L201` |
| G2 | `design/source` = **源 .kicad_sch 路径** | 写 `project.name`（工程名） | **错误** | `L203`（`projectNameOf` `L30-33`） |
| G3 | `design/date` = 带偏移的 ISO 时间戳 | 只写 `YYYY-MM-DD`（取自 `meta.modified`，否则当天） | **错误** | `L204`（`dateStamp` `L22-28`） |
| G4 | `design/tool` | 写 `"schematic-studio"` | 一致（值可不同） | `L205` |
| G5 | `design/sheet` + `title_block`（含 9 条 comment） | **完全不输出**，`design` 在第 206 行即闭合 | **缺失** | `L206-207` |
| G6 | `comp/datasheet` | **不输出** | **缺失** | `L211-214` |
| G7 | `comp/description`（非空才输出） | **不输出** | **缺失** | `L211-214` |
| G8 | `comp/fields`（`field` 列表，保序） | **不输出** | **缺失** | `L211-214` |
| G9 | `comp/property`（保序，区分无值/空串） | **不输出** | **缺失** | `L211-214` |
| G10 | `comp/sheetpath` | **不输出** | **缺失** | `L211-214` |
| G11 | `comp/tstamps` | **不输出** | **缺失** | `L211-214` |
| G12 | `comp/libsource/description` | 只写 `lib` + `part` | **缺失** | `L214` |
| G13 | `libparts` 整段 | **不输出** | **缺失** | 无 |
| G14 | `libraries` 整段 | **不输出** | **缺失** | 无 |
| G15 | `net/class` | **不输出** | **缺失** | `L220` |
| G16 | `node/pinfunction` **空时省略** | 无条件输出，空名回退成 `"~"` | **错误**（KiCad 9 省略整段；样本 `(pinfunction "~")` 出现 0 次） | `L225` + `pinFunctionText` `L82-86` |
| G17 | `node/pintype` 支持 `+no_connect` / `+free` 修饰符 | 直接透传 `electricalType` | **缺失** | `L226` |
| G18 | `node` 排序 = `(ref,pin)` 纯 ASCII 序 | `naturalCompare` | **错误** | `sortedPins` `L88-93` |
| G19 | `comp` 排序 = 图纸顺序 + 图纸内自然序 | 全局 `naturalCompare(designator)` | **部分**（单图纸工程等价） | `sortedComponents` `L78-80` |
| G20 | 闭括号并入最后一行（R4/R5） | 单独输出 `  )` 行 | **错误** | `L206` `L217` `L229` `L232` |
| G21 | CRLF + 无结尾换行 | `join('\n') + '\n'` | **错误** | `L233` |
| G22 | `EXPORTERS.kicad.label` / `extension` | `'KiCad 6 网表'` / `'net'` | **部分**（版本标识过时） | `L288-294` |
| G23 | `escapeSExpr`（`\` `"` `\n` `\t`） | 已实现且顺序正确 | 一致 | `L95-103` |

### 7.2 `src/netlist/connectivity.js`

| # | 规则 | 现有实现 | 差距 | 位置 |
| --- | --- | --- | --- | --- |
| C1 | 引脚电气类型词汇 | 见 §7.4 | **缺失**（无 `tri_state/free/unspecified/open_emitter/no_connect`） | `electricalTypeOf` `L52-56` |
| C2 | `no_connect` 引脚要作为 `unconnected-(…)` 网络出现 | `if (type === 'not_connected') continue;` **直接丢弃** | **错误** | `L433` |
| C3 | 自动网络名 `Net-(…)` / `unconnected-(…)` | 自造 `N$n` | **不一致**（不阻碍语义往返） | `AUTO_NET_PREFIX` `L6`、`assignNetNames` `L284-329` |
| C4 | net class 回填 | 无 `class` 概念 | **缺失** | `netToContract` `L336-352` |
| C5 | nets 按 `naturalCompare(name)` 排序 | 已实现 | 一致 | `L631`、`L762` |
| C6 | `net@name` 与 `{slash}` / `~{}` | 直接用标签文本，不解码也不编码 | 一致（§8.8 定为原文口径） | `L268-281` |

### 7.3 `src/model/project.js` 与 `src/core/schema.js`

| # | 规则 | 现有实现 | 差距 | 位置 |
| --- | --- | --- | --- | --- |
| M1 | `sheet.title` 含 `title/company/rev/date/comments` | 已有 | 一致 | `project.js:90-102`（`createSheet`）、`L132-144`（`normalizeTitle`） |
| M2 | `sheet.title.source` | 无字段；`normalizeTitle` 重建对象会**丢弃**未知键 | **缺失** | `project.js:132-144` |
| M3 | `sheet.title.comments` 支持 9 槽数组 | `Array → join('\n')`，数组形态被**压平** | **错误**（丢失槽位） | `project.js:134-136` |
| M4 | `project.kicad` / `project.netClassAssignments` | `normalizeProject` 按白名单重建，**静默丢弃**未知顶层键 | **缺失（高危）** | `project.js:245-261` |
| M5 | `sheet.kicad` | `normalizeSheet` 按白名单重建，丢弃未知键 | **缺失（高危）** | `project.js:205-219` |
| M6 | `symbol.kicad` | `normalizeSymbolInstance` 按白名单重建，丢弃未知键 | **缺失（高危）** | `project.js:146-160` |
| M7 | `library.symbols[*]` 的扩展元数据 | `normalizeLibrary` 用 `.map(clone)`，**不丢键** | 一致（无需改动） | `project.js:221-227` |
| M8 | 未知键不报错 | `validateProject` 只校验已知键 | 一致 → 新增字段**必须保持可选、不升 schema 版本** | `schema.js:191-219` |
| M9 | `SCHEMA_VERSION` | `= 1` | 保持 1（§8.9） | `schema.js:2` |
| M10 | `validateTitle` 接受 `string \| string[]` | 已支持 | 一致 | `schema.js:90-100` |

> **M4/M5/M6 是本次改动最大的隐性风险**：`validateProject` 对未知键放行，但 `normalizeProject` / `normalizeSheet` / `normalizeSymbolInstance` **按白名单重建对象**，所以「加个字段」并不会自动持久化——它会在第一次 load→save 后消失。已实测（下面这段探针的输出可直接用 §12 脚本同法复算）：
>
> ```
> validateProject(raw)            → { ok: true,  errors: [] }     // 放行
> normalizeProject(raw) 保留 kicad → false                        // 丢弃
> normalizeProject(raw) 保留 netClassAssignments → false          // 丢弃
> normalizeProject(raw) title.comments: ['a','b'] → "a\nb"        // 压平
> ```
> T2 必须为 §8 的每个新键**显式加白名单**，否则 T3/T4 的数据在保存/重开后凭空消失。

### 7.4 `src/library/symbol-library.js`

| # | 规则 | 现有实现 | 差距 | 位置 |
| --- | --- | --- | --- | --- |
| L1 | `PIN_ELECTRICAL_TYPES` | 8 值：`input output bidirectional passive power_in power_out open_collector not_connected` | **缺失** `tri_state` `free` `unspecified` `open_emitter` `no_connect`；`not_connected` 非 KiCad 词汇 | `L14-23` |
| L2 | 引脚 `noConnect` / `free` 标记 | `normalizePin` 白名单无此键 | **缺失** | `L32-45` |
| L3 | 符号元数据 `docs/footprints/keywords/fpFilters/fields` | `normalizeSymbolDef` 白名单无此键（有 `description`） | **缺失** | `L52-65` |
| L4 | `validateSymbolDef` 接受新类型 | 只校验 8 值 | **缺失** | `L68-125` |
| L5 | 符号 `pins` 至少 1 个 | 强制要求 | **不一致**（`Fiducial` 有 0 引脚，但作为工程内库符号可以不校验） | `L78` |

### 7.5 `src/ui`（T5 相关现状）

| # | 规则 | 现有实现 | 差距 | 位置 |
| --- | --- | --- | --- | --- |
| U1 | 导入入口 | 只支持 `.json` 工程（`deserializeProject`） | **缺失** `.net` 分支 | `src/ui/file-actions.js:116` |
| U2 | 网络行展示 net class | `netRows` 只给 `name` + `pins` | **缺失** | `src/ui/view-model.js:192-209` |
| U3 | 摘要展示 class 分布 | `netlistSummary` 只有 net/pin/component/warning 计数 | **缺失** | `src/ui/view-model.js:177-190` |
| U4 | 标题栏编辑 `source` / 9 槽 comment | `properties-panel` 只有单行 `comments` 文本域 | **缺失** | `src/ui/panels/properties-panel.js:629-631` |
| U5 | 导出器标签 | `'KiCad 6 网表'` | **过时** | `src/netlist/index.js:290` |

---

## 8. 规范数据契约（下游必须逐字遵循）

### 8.0 总则

1. **全部新增字段可选**。缺失时必须按「缺省值」语义工作，不得报错、不得升级 `SCHEMA_VERSION`（保持 `1`）。
2. **旧工程 JSON 零改动**：不加任何新字段的工程必须 (a) 通过 `validateProject`，(b) 经 `normalizeProject` 后与原行为逐字段等价，(c) 导出结果除 §7 列明的排版/语义修正外无回归。
3. **有序性即数据**：`fields` / `properties` / `footprints` / `comments` / `libraries` / `libparts` / `pins` 一律用**数组**保存，因为 KiCad 输出顺序是原理图插入顺序，对象键序不足以表达（且无法区分「无 value」与「空串」）。
4. **区分 `undefined` 与 `''`**：`undefined` = 网表中省略该 token；`''` = 写出空字符串字面量。这条对 `field` / `property` 的逐字节往返是必需的（§3.3.1、§3.3.2）。
5. **JSON 形状一律为纯数据**：不得出现 `Map`/`Set`/类实例，必须 `structuredClone` 与 `JSON.stringify` 可往返。

### 8.1 `project.kicad`

```jsonc
project.kicad = {                    // 可选；缺失时按下列缺省值导出
  "source": "",                      // string  → design/source（源 .kicad_sch 路径）
  "tool": "schematic-studio",         // string  → design/tool
  "date": "",                         // string  → design/date；空则用 meta.modified 原样（ISO 带 Z）
  "version": "E",                     // string  → export/version；本规范固定 "E"
  "libraries": [                      // array   → libraries/library*
    { "logical": "TinyTapeout", "uri": "C:\\…\\TinyTapeout.kicad_sym" }
  ]
}
```

- 类型：`source` / `tool` / `date` / `version` 为 `string`；`libraries` 为 `{logical:string, uri:string}[]`。
- `libraries` 与 `libparts[*].lib` 通过 `logical` 关联；`logical` 重复时保留首个。
- 缺省时 `source` 取工程名（**行为不变，不回归**）；`version` 恒 `"E"`。

### 8.2 `project.netClassAssignments`

```jsonc
project.netClassAssignments = {        // 可选；键 = 网络名（网表编码原文），值 = class 名
  "GND": "pwr",
  "usb_d+": "usbdiff",
  "SDI{slash}out0": "ioout"
}
```

- 未出现的网络名 ⇒ class 为 `"Default"`（**不得**因此写入 `"Default"` 键到映射里；导出的 `Default` 由缺省规则产生）。
- 键必须与 `net.name` **完全一致**（逐字节，含 `{slash}` / `~{}` 原文）。
- 校验：值必须是非空 `string`；空值键视为非法（记 warning 并忽略）。

### 8.3 `sheet.kicad` 与 `sheet.title`

```jsonc
sheet.kicad = {                        // 可选 → design/sheet
  "number": "1",                       // string  → sheet@number（"1" 起）
  "name": "/",                         // string  → sheet@name（KiCad sheet 路径，首尾带 /）
  "tstamps": "/"                       // string  → sheet@tstamps（UUID 路径，根图 "/"）
}

sheet.title = {
  "title":   "",                       // string  → title_block/title
  "company": "",                       // string  → title_block/company
  "rev":     "",                       // string  → title_block/rev
  "date":    "",                       // string  → title_block/date（YYYY-MM-DD）
  "source":  "",                       // string  → title_block/source（可选，默认 ""）
  "comments": ["","","","","","","","",""]   // string[9] 或 string
}
```

`comments` 的双形态（**必须同时支持**）：

| 形态 | 来源 | 语义 | 规范化要求 |
| --- | --- | --- | --- |
| `string[9]` | KiCad 导入器产出（**推荐形态**） | 槽位一一对应 `comment 1..9`，不足补 `""` | 截断到 ≤9 项；每项 `String()` 强制 |
| `string` | 旧工程 / 属性面板文本域（`\n` 分行） | 按 `\n` 切行后映射到槽位 | **原样保留，不 join、不 split** |
| `undefined` | 旧工程 | 全部 9 槽为空 | 导出按全空处理 |

导出映射：`commentsAsSlots9(comments)` → 长度恰为 9 的字符串数组（不足补 `""`，超出截断），逐槽输出 `(comment (number "n") (value "<slot>"))`。

> T2 必改 `src/model/project.js:134-136`：把 `Array.isArray(...) ? join('\n') : …` 改成「数组保持数组（截断 ≤9、逐项转字符串），字符串保持字符串」。现有测试只断言字符串形态（`test/model/project.test.mjs:127`），不受影响。

### 8.4 `symbol.kicad`

```jsonc
symbol.kicad = {                       // 可选 → components/comp 的扩展子元素
  "datasheet": "",                     // string  → comp/datasheet；"" ⇒ 整段省略；"~" ⇒ 原样写出
  "description": "",                   // string  → comp/description；"" ⇒ 整段省略
  "tstamps": "",                       // string  → comp/tstamps（实例 UUID）
  "libsource": {                       // object  → comp/libsource
    "lib": "",                         // string  → libsource@lib
    "part": "",                        // string  → libsource@part；缺省回退 symbol.symbolId
    "description": ""                  // string  → libsource/description
  },
  "properties": [                      // array（保序）→ comp/property*
    { "name": "MPN", "value": "CL10A105KA8NNNC" },
    { "name": "dnp" }                  // 无 value ⇒ 自闭合 (property (name "dnp"))
  ],
  "fields": [                          // array（保序）→ comp/fields/field*
    { "name": "Footprint", "value": "C_0603" },
    { "name": "Datasheet" }            // 无 value ⇒ 自闭合 (field (name "Datasheet"))
  ],
  "sheetpath": {                       // object  → comp/sheetpath
    "names": "/",                      // string  → sheetpath@names
    "tstamps": "/"                     // string  → sheetpath@tstamps
  }
}
```

- `properties[*].value` 与 `fields[*].value` 的类型为 `string | undefined`（**不是** `string | null`）。
- `properties` 的 `value === undefined` ⇒ `(property (name "X"))`；`value === ""` ⇒ `(property (name "X") (value ""))`。**两者不可互换**。
- `fields` 的 `value === undefined || value === ""` ⇒ 自闭合 `(field (name "X"))`（与 KiCad 实测一致：`(field … "")` 出现 0 次）。
- 缺省（`symbol.kicad` 不存在）时：`datasheet` 省略、`description` 省略、`fields` 由既有 `symbol.fields`（对象，`src/model/project.js:158`）**按插入序**转成数组补 `Footprint`/`Datasheet`/`Description`（值取 `symbol.footprintId` / `""` / `""`）、`properties` 由同一来源生成并补 `Sheetname`/`Sheetfile`。
- `sheetpath` 缺省时由所属 `sheet.kicad` 推导（`{ names: sheetPathOf(sheet), tstamps: sheetTstampsOf(sheet) }`）。

### 8.5 库符号（`library.symbols[*]`）元数据

```jsonc
library.symbols[i] = {
  "id": "TinyTapeout:R_Small",         // 必填（既有约束）
  "name": "R_Small",
  "refPrefix": "R",
  "description": "Resistor, small symbol",   // → libpart/description 与 comp/libsource/description
  "docs": "~",                               // → libpart/docs；"" 或 undefined ⇒ 省略
  "footprints": ["R_*"],                     // → libpart/footprints/fp//
  "keywords": "R res resistor",              // → comp/property ki_keywords（导入侧）
  "fpFilters": ["R_*"],                      // → comp/property ki_fp_filters（导入侧）
  "fields": [                                // → libpart/fields；缺省按下表补全
    { "name": "Reference",  "value": "R" },
    { "name": "Value",      "value": "R_Small" },
    { "name": "Footprint" },                  // 无 value 键 = 自闭合 (field (name "Footprint"))
    { "name": "Datasheet",  "value": "~" },
    { "name": "Description","value": "Resistor, small symbol" }
  ],
  "pins": [ /* 见 §8.7 */ ],
  "power": false,
  "graphics": [ /* 既有 */ ]
}
```

`fields` 缺省补全规则（**顺序固定**：`Reference` → `Value` → `Footprint` → `Datasheet` → `Description`）：

| 名称 | 缺省值 |
| --- | --- |
| `Reference` | `refPrefix` |
| `Value` | `name`（无则 `id`） |
| `Footprint` | `undefined`（自闭合） |
| `Datasheet` | `"~"` |
| `Description` | `description` |

`footprints` 与 `fpFilters` 语义等价（KiCad 里是同一个 `ki_fp_filters` 通配符列表），实现须保持**两者写出时取并集去重、且 `footprints` 优先**。

### 8.6 `net.class`

```jsonc
net.class = "pwr"      // 可选 string；缺失视为 "Default"
```

- 位于 `buildNetlist().nets[i]` / `analyzeProject().nets[i]` / `netToContract()` 的输出上（`src/netlist/connectivity.js:336-352`、`src/netlist/index.js:60`）。
- 取值来自 `project.netClassAssignments[net.name]`，缺省 `"Default"`。
- `netToContract` 的返回形状扩展为 `{ name, class, pins: [...] }`（新增 `class` 是可加的，不破坏既有调用方）。

### 8.7 引脚：电气类型与标记

```jsonc
pin = {
  "id": "sym-pin-1",
  "number": "1",            // string
  "name": "VCC",
  "x": 0, "y": 0, "length": 2.54, "orientation": "right",
  "electricalType": "power_in",   // 见下表 12 值
  "noConnect": true,              // 可选 boolean；true ⇒ pintype 追加 "+no_connect"
  "free": true                    // 可选 boolean；true ⇒ pintype 追加 "+free"
}
```

**12 值词汇（KiCad 9 全集，`PIN_ELECTRICAL_TYPES` 目标值）**：

| 值 | 说明 | 样本中出现 |
| --- | --- | --- |
| `input` | 输入 | ✅ |
| `output` | 输出 | ✅ |
| `bidirectional` | 双向 | ✅ |
| `tri_state` | 三态 | — |
| `passive` | 无源 | ✅ |
| `free` | 自由 | — |
| `unspecified` | 未指定 | — |
| `power_in` | 电源输入 | ✅ |
| `power_out` | 电源输出 | ✅ |
| `open_collector` | 开集 | — |
| `open_emitter` | 开射 | — |
| `no_connect` | 不连接（引脚类型本身） | ✅ |

**`pintype` 拼装（导出）**：

```js
function pintypeOf(pin) {
  const base = PIN_ELECTRICAL_TYPES.includes(pin.electricalType) ? pin.electricalType : 'passive';
  let type = base;
  if (pin.noConnect === true && base !== 'no_connect') type += '+no_connect';
  if (pin.free === true) type += '+free';
  return type;
}
```

**解析（导入）**：先按 `+` 切分；右侧 token 为 `no_connect` ⇒ `pin.noConnect = true`，为 `free` ⇒ `pin.free = true`；左侧 token 必须落在 12 值内，否则回退 `passive` 并记 warning。

**兼容**：既有 8 值中的 `not_connected` 必须**保留为可读别名**（映射到 `no_connect` + `noConnect: true`），否则旧工程会被判非法。建议：`normalizePin` 内做 `not_connected → no_connect` 的迁移，`PIN_ELECTRICAL_TYPES` 同时容忍旧值一个版本。

### 8.8 `net.name` 与 `pinfunction` 的口径

```jsonc
net  = { "name": "SDI{slash}out0", "class": "ioout", "pins": [ … ] }
node = { "pinfunction": "mio[36]/~{ctrl_sel_rst}", "pintype": "input" }
```

- `net.name` = **网表编码原文**（可含 `{slash}`、`~{}`、以 `/` 开头）。导出逐字写出，导入逐字读入，**两端都不做编码/解码**。
- `node@pinfunction` 取自模型里的引脚名（`pin.name`，与 `libpart/pin@name` 同源），**原始 `/`，不编码**。
- UI 层可对显示做美化（§5.5），**不得写回模型**。
- 由此保证：`parse(fixture) → rebuild → export` 的网络名与 `pinfunction` 逐字节不变。

### 8.9 向后兼容矩阵

| 新增字段 | 缺失时的行为 | 导出结果 | 需改 `normalize*` |
| --- | --- | --- | --- |
| `project.kicad` | 用缺省（工程名 / 空 date / `"E"` / 空 libraries） | 与今天**等价**（除 §7 排版修正） | ✅ `normalizeProject` |
| `project.netClassAssignments` | 全部网络 `Default` | 每网都写 `(class "Default")` | ✅ `normalizeProject` |
| `sheet.kicad` | 由 `sheet.id`/序号推导 `number`、`name="/"`、`tstamps="/"` | 仍输出 `sheet` 段 | ✅ `normalizeSheet` |
| `sheet.title.source` | `""` | 仍输出 `(source "")` | ✅ `normalizeTitle` |
| `sheet.title.comments` | `""` ⇒ 9 槽全空 | 仍输出 9 条 `comment` | ✅ `normalizeTitle` |
| `symbol.kicad` | 由既有字段推导（§8.4） | 仍输出 comp 全字段 | ✅ `normalizeSymbolInstance` |
| `library.symbols[*].docs/footprints/…` | 空数组 / `""` | 相应子段省略 | ❌ 已由 `clone` 保留 |
| `pin.electricalType` 新值 | 旧 8 值仍合法 | 原样 | ❌（仅扩枚举） |
| `pin.noConnect` / `pin.free` | `false` | 不加修饰符 | ✅ `normalizePin` |
| `net.class` | `"Default"` | 写 `(class "Default")` | ❌（派生字段） |
| `SCHEMA_VERSION` | —— | **保持 `1`**，`migrateProject` 不变 | ❌ |

### 8.10 导出映射总表（模型 → 网表）

| 网表元素 | 取值来源 | 缺省 |
| --- | --- | --- |
| `export/version` | `project.kicad.version` | `"E"` |
| `design/source` | `project.kicad.source` | `project.name` |
| `design/date` | `project.kicad.date` ‖ `project.meta.modified` | 当前 ISO 时间戳 |
| `design/tool` | `project.kicad.tool` | `"schematic-studio"` |
| `sheet@number/name/tstamps` | `sheet.kicad.*` | `String(index+1)` / `"/"` / `"/"` |
| `title_block/title…rev` | `sheet.title.*` | `""` |
| `title_block/source` | `sheet.title.source` | `""` |
| `title_block/comment n` | `commentsAsSlots9(sheet.title.comments)[n-1]` | `""` |
| `comp@ref` | `symbol.designator` | `"U?"` |
| `comp/value` | `symbol.value` | `""` |
| `comp/footprint` | `symbol.footprintId` | `""` |
| `comp/datasheet` | `symbol.kicad.datasheet` | 省略 |
| `comp/description` | `symbol.kicad.description` | 省略 |
| `comp/fields/field` | `symbol.kicad.fields`（保序） | 由 `symbol.fields` 派生（§8.4） |
| `comp/libsource` | `symbol.kicad.libsource` | `{ lib: "schematic-studio", part: symbol.symbolId, description: "" }` |
| `comp/property` | `symbol.kicad.properties`（保序） | 派生 + `Sheetname`/`Sheetfile` |
| `comp/sheetpath@names` | `symbol.kicad.sheetpath.names` | 所属 sheet 的 `kicad.name` |
| `comp/sheetpath@tstamps` | `symbol.kicad.sheetpath.tstamps` | 所属 sheet 的 `kicad.tstamps` |
| `comp/tstamps` | `symbol.kicad.tstamps` | `symbol.id` 派生的稳定 UUID |
| `libpart@lib/part` | 库符号的 `libsource.lib` / `id` 去库前缀 | `"schematic-studio"` / `symbolId` |
| `libpart/description` | 库符号 `description` | `""` |
| `libpart/docs` | 库符号 `docs` | 省略 |
| `libpart/footprints/fp` | 库符号 `footprints` ∪ `fpFilters` | 省略 |
| `libpart/fields` | 库符号 `fields` | 5 条缺省（§8.5） |
| `libpart/pins/pin` | 库符号 `pins` | 省略（0 引脚时不写 `pins` 块） |
| `library@logical` / `uri` | `project.kicad.libraries[*]` | 省略整段 |
| `net@code` | 排序后的序号 1..N | —— |
| `net@name` | `net.name`（原文） | —— |
| `net@class` | `net.class` | `"Default"` |
| `node@ref` / `@pin` | pin 的 `designator` / `pinNumber` | —— |
| `node@pinfunction` | 引脚名；空则**整段省略** | 省略 |
| `node@pintype` | `pintypeOf(pin)`（§8.7） | `"passive"` |

---

## 9. 「语义往返」的定义（验收口径）

**定义**：设 `NET = parse(text)`（S-表达式树，字符串已反转义），`text' = export(rebuild(NET))`，则

```
semanticRoundTrip(text) == true  ⇔  normalize(parse(text')) == normalize(parse(text))
```

其中 `normalize(tree)` 为**只剥离格式差异**的规范化：

1. 删除所有仅影响排版的空白与换行；
2. 保留每个 list 内**元素顺序**（顺序是数据，§8.0 第 3 条）；
3. 保留每个字符串的**精确内容**（含 `{slash}`、`~{}`、`~`、空串）；
4. 保留「token 缺失」与「token 为空串」的区别；
5. 不比较：行尾符、缩进、闭括号位置、文件末尾换行。

**逐字节往返**（可选、更强）：`export(rebuild(parse(fixture))) === readFile(fixture)`。达成条件是本文全部排版规则（§2.3 R1–R6）、排序规则（§6）与 §8 契约同时满足。**T3 的验收以「逐字节相等」为目标，以「语义往返」为最低门槛。**

---

## 10. 下游验收清单

### T2 — 数据模型 / schema / 连通性

- [ ] `normalizeProject` 显式保留 `kicad` 与 `netClassAssignments`；`normalizeSheet` 保留 `kicad`；`normalizeSymbolInstance` 保留 `kicad`；`normalizeTitle` 保留 `source` 且**不再把数组型 `comments` 压平**（§7.3 M2–M6，§8.9）。
- [ ] `validateProject` 对新增可选字段做「存在即校验形状」的类型检查（`kicad.source` 为 string、`netClassAssignments` 的值非空 string、`symbol.kicad.properties` 为 `{name,value?}[]` …），**缺失时零错误**；`SCHEMA_VERSION` 仍为 `1`，`migrateProject` 不变。
- [ ] `PIN_ELECTRICAL_TYPES` 扩为 12 值（§8.7），`normalizePin` 保留 `noConnect`/`free` 并把旧值 `not_connected` 迁移为 `no_connect` + `noConnect:true`；`normalizeSymbolDef` 保留 `docs`/`footprints`/`keywords`/`fpFilters`/`fields`；`validateSymbolDef` 接受新词汇。
- [ ] `connectivity` 不再丢弃 `no_connect` 引脚（§7.2 C2）：为其生成独立网络，命名遵循 `unconnected-(<ref>-<pinname|Pad<pin>>)`，并参与 `stats.pins`/`stats.nets`。
- [ ] net class 回填：`assignNetNames` 之后按 `project.netClassAssignments[net.name]` 设置 `net.class`（缺省 `"Default"`），`netToContract` 透出 `class`（§8.6）。
- [ ] 回归快照：一份**不含任何新字段**的旧工程 JSON，`normalizeProject` 输出与改动前逐字段深相等，且 `validateProject` 通过（在 `test/model/` 与 `test/netlist/` 各加一条断言）。

### T3 — KiCad 9 导出器（`generateKiCad`）

- [ ] 输出完整 5 段：`design`（含 `sheet` + `title_block` 9 条 `comment`）、`components`、`libparts`、`libraries`、`nets`（§3.0 顺序）。
- [ ] `comp` 补齐 `datasheet`/`description`/`fields`/`property`/`sheetpath`/`tstamps`，`libsource` 带 `description`；`datasheet`/`description` 为空时**整段省略**（§3.3）。
- [ ] `net` 输出 `(class "…")`；`node` 的 `pinfunction` 为空时**整段省略**（删除 `pinFunctionText` 的 `"~"` 回退，§7.1 G16），并同步改写 `test/netlist/exporters.test.mjs` 中「空引脚名写成 `~`」的断言；`pintype` 支持 `+no_connect`/`+free`（§8.7）。
- [ ] 排版满足 §2.3 R1–R6：2 空格/层、结构子元素各占一行、**闭括号并入最后一行**（不得有独占 `)` 的行）、`\r\n`、**无结尾换行**、无 BOM。
- [ ] 排序：`comp` = 图纸顺序 + 图纸内位号自然序；`node` = `(ref, pin)` **纯 ASCII** 序；`net` = 网络名自然序并编号 `1..N`（§6）。
- [ ] 黄金样本验收：`generateKiCad(import(fixture))` 与 `examples/tinytapeout-demo.net` **逐字节相等**；退化时至少满足 §9 语义往返，并在测试中显式记录只差分项。

### T4 — 解析导入器（`src/netlist/kicad-import.js`）

- [ ] 词法器 + 解析器：支持 `atom`/字符串、`\\` `\"` `\n` `\t` 反转义、CRLF、无结尾换行、任意顶层顺序；所有错误带 **1-based 行号**（§2.2、§3.0）。
- [ ] `export`/`design`/`sheet`/`title_block` → `project.kicad`、`sheet.kicad`、`sheet.title`（`comments` 补足 `string[9]`，`source` 落在 `title.source`；§8.1–8.3）。
- [ ] `comp` → 符号实例 + `symbol.kicad`：`datasheet`/`description`/`tstamps`/`libsource{lib,part,description}`/`properties`（保序，区分无值与空串）/`fields`（保序）/`sheetpath`（§8.4）。
- [ ] `libpart` → 库符号：`description`/`docs`/`footprints`/`keywords`/`fpFilters`/`fields`（5 条缺省保序）与 `pins`（12 值类型 + `noConnect`），0 引脚符号合法（§8.5、§8.7）。
- [ ] `net` → 网表 + `project.netClassAssignments`（**只写非 `Default` 的项**）；`net.name` 逐字保留，不还原 `{slash}`/`~{}`（§8.2、§8.8）。
- [ ] 失败契约：返回 `{ ok:false, diagnostics:[{line, code, message}] }`，**绝不抛异常**、不产出半套工程；`ok:true` 时产物必须通过 `validateProject`。

### T5 — UI 导入入口与 net class 展示

- [ ] 文件菜单/工具栏新增「导入 KiCad 网表…」，复用 `src/ui/file-actions.js` 的读文件路径（`.net`），走 `src/netlist/kicad-import.js`（分层合法：`ui → io → netlist`）。
- [ ] 导入成功走 `store.setProject(project)` 并广播 `changed`；失败用现有 toast/dialog 展示前 N 条 `diagnostics` + 总数，不白屏。
- [ ] `netRows`（`src/ui/view-model.js:192`）增加 `class` 字段并在网表面板以徽章/列展示；`netlistSummary` 增加按 class 的分组计数（§7.5 U2/U3）。
- [ ] 属性面板标题栏增加 `source` 输入，`comments` 编辑支持最多 9 行且与 9 槽一一对应（§7.5 U4）。
- [ ] 导出对话框与 `EXPORTERS.kicad.label` 更名（如「KiCad 9 网表」），默认扩展名保持 `net`（§7.1 G22）。
- [ ] UI 层不复制解析/生成逻辑：所有格式知识留在 `src/netlist/`，UI 只做调用与展示（新增文件首行必须写职责注释，`test/scaffold.test.mjs` 会检查）。

---

## 11. 附录：黄金样本原文摘录

**(a) 文件头（第 1–12 行）**

```
(export (version "E")
  (design
    (source "C:\\workspace\\kicad\\demos\\tiny_tapeout\\tinytapeout-demo.kicad_sch")
    (date "2026-11-19T10:25:58+0800")
    (tool "Eeschema 9.0.8-6-gca86c82f9b4-dirty")
    (sheet (number "1") (name "/") (tstamps "/")
      (title_block
        (title "TinyTapeout 4/5 Demo Board PRELIM")
        (company "Psychogenic Technologies")
        (rev "1.0.4")
```

**(b) 一个最简 `comp`（C1，第 39–59 行）**

```
    (comp (ref "C1")
      (value "1uF")
      (footprint "Capacitor_SMD:C_0603_1608Metric")
      (datasheet "~")
      (fields
        (field (name "MPN") "CL10A105KA8NNNC")
        (field (name "MPN_ALT") "C0603C105K4RAC7411")
        (field (name "Characteristics") "1u 10V XR 0603")
        (field (name "Footprint") "Capacitor_SMD:C_0603_1608Metric")
        (field (name "Datasheet") "~")
        (field (name "Description")))
      (libsource (lib "TinyTapeout") (part "C_Small") (description "Unpolarized capacitor, small symbol"))
      (property (name "MPN") (value "CL10A105KA8NNNC"))
      (property (name "MPN_ALT") (value "C0603C105K4RAC7411"))
      (property (name "Characteristics") (value "1u 10V XR 0603"))
      (property (name "Sheetname") (value "Root"))
      (property (name "Sheetfile") (value "tinytapeout-demo.kicad_sch"))
      (property (name "ki_keywords") (value "capacitor cap"))
      (property (name "ki_fp_filters") (value "C_*"))
      (sheetpath (names "/") (tstamps "/"))
      (tstamps "00db537f-1037-4fb6-9d9b-01d9f1f6a64d"))
```

**(c) 一个同时带 `datasheet` 与 `description` 的 `comp`（Y1，第 3332–3351 行节选）**

```
    (comp (ref "Y1")
      (value "12.0MHz")
      (footprint "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm")
      (datasheet "https://www.we-online.com/components/products/datasheet/830108206909.pdf")
      (description "12 MHz ±10ppm Crystal 8pF 120 Ohms 4-SMD, No Lead")
      (fields
        (field (name "MPN") "830208220401")
        (field (name "DigikeyPN") "1923-830208220401DKR-ND")
```

**(d) 一个完整 `libpart`（C_Small，第 3509–3522 行）**

```
    (libpart (lib "TinyTapeout") (part "C_Small")
      (description "Unpolarized capacitor, small symbol")
      (docs "~")
      (footprints
        (fp "C_*"))
      (fields
        (field (name "Reference") "C")
        (field (name "Value") "C_Small")
        (field (name "Footprint"))
        (field (name "Datasheet") "~")
        (field (name "Description") "Unpolarized capacitor, small symbol"))
      (pins
        (pin (num "1") (name "") (type "passive"))
        (pin (num "2") (name "") (type "passive"))))
```

**(e) 0 引脚的 `libpart`（Fiducial，第 3654–3664 行）**

```
    (libpart (lib "TinyTapeout") (part "Fiducial")
      (description "Fiducial Marker")
      (docs "~")
      (footprints
        (fp "Fiducial*"))
      (fields
        (field (name "Reference") "FID")
        (field (name "Value") "Fiducial")
        (field (name "Footprint"))
        (field (name "Datasheet") "~")
        (field (name "Description") "Fiducial Marker")))
```

**(f) `libraries`（第 3979–3981 行）**

```
  (libraries
    (library (logical "TinyTapeout")
      (uri "C:\\workspace\\kicad\\demos\\tiny_tapeout/tinytapeout-kicad-libs/symbols/TinyTapeout.kicad_sym")))
```

**(g) 两个关键 `net`（第 4444–4446、4667–4669 行）**

```
    (net (code "65") (name "SDI{slash}out0") (class "ioout")
      (node (ref "U4") (pin "7") (pintype "passive"))
      (node (ref "U6") (pin "5") (pinfunction "GPIO3") (pintype "bidirectional")))
```

```
    (net (code "112") (name "~{crst}{slash}out2") (class "ioout")
      (node (ref "U4") (pin "4") (pintype "passive"))
      (node (ref "U6") (pin "9") (pinfunction "GPIO7") (pintype "bidirectional")))
```

**(h) `no_connect` 相关的三条 `net`（第 4641–4653 行节选）**

```
    (net (code "102") (name "unconnected-(J15-SBU1-PadA8)") (class "Default")
      (node (ref "J15") (pin "A8") (pinfunction "SBU1") (pintype "bidirectional+no_connect")))
    (net (code "103") (name "unconnected-(J15-SBU2-PadB8)") (class "Default")
      (node (ref "J15") (pin "B8") (pinfunction "SBU2") (pintype "bidirectional+no_connect")))
    (net (code "106") (name "unconnected-(U3-NC-Pad4)") (class "Default")
      (node (ref "U3") (pin "4") (pinfunction "NC") (pintype "no_connect")))
```

**(i) 文件尾（第 4680 行，注意 4 个连续闭括号且全文无结尾换行）**

```
      (node (ref "U6") (pin "7") (pinfunction "GPIO5") (pintype "bidirectional")))))
```

---

## 12. 附录：统计的复现方式

本文全部数字由一次性脚本在黄金样本上算出（脚本不入库，位于 gitignore 的 `.tmp/`）。下面这段 Node 脚本**自包含**，在仓库根存成 `.tmp/spec-stats.mjs` 后执行 `node .tmp/spec-stats.mjs` 即可复算本文所有关键数字（注释里的期望值就是实测输出）：

```js
// 规范文档 §12 的自包含复算脚本：在仓库根执行 `node .tmp/spec-stats.mjs`。
import { readFileSync } from 'node:fs';

const buf = readFileSync('examples/tinytapeout-demo.net');
const text = buf.toString('utf8');
const lines = text.split('\r\n');
const count = (re) => lines.filter((line) => re.test(line)).length;

// 1) 文件级
console.log('bytes/chars', buf.length, text.length); // 254285 254283
console.log('lines', lines.length); // 4680
console.log('BOM', buf[0] === 0xef); // false
console.log('bare LF', (text.match(/(?<!\r)\n/g) || []).length); // 0
console.log('endsWithNewline', text.endsWith('\n')); // false
console.log('blank lines', count(/^\s*$/)); // 0
console.log('paren-only lines', count(/^\s*\)+\s*$/)); // 0

// 2) 分节行号（1-based）
for (const name of ['export', 'design', 'components', 'libparts', 'libraries', 'nets']) {
  const index = lines.findIndex((line) => line.includes('(' + name) && !/^ {6}/.test(line));
  console.log(name, index + 1); // 1 2 38 3352 3979 3982
}

// 3) 计数
console.log('comp', count(/^ {4}\(comp \(ref "/)); // 150
console.log('net', count(/^ {4}\(net \(code "/)); // 114
console.log('node', count(/^ {6}\(node \(ref "/)); // 584
console.log('libpart', count(/^ {4}\(libpart \(lib "/)); // 28
console.log('sheet', count(/^ {4}\(sheet \(number "/)); // 2
console.log('library', count(/^ {4}\(library \(logical "/)); // 1
console.log('libpart pin', count(/^ {8}\(pin \(num "/)); // 287

// 4) 空 pinfunction 与 `~` 空值哨兵
console.log('pinfunction ""', count(/\(pinfunction ""\)/)); // 0
console.log('pinfunction "~"', count(/\(pinfunction "~"\)/)); // 0
console.log('datasheet "~"', count(/^ {6}\(datasheet "~"\)/)); // 125
console.log('docs "~"', count(/^ {6}\(docs "~"\)/)); // 18
console.log('field with ""', count(/^ {8}\(field \(name "[^"]+"\) ""\)/)); // 0
console.log('property with value ""', count(/^ {6}\(property \(name "[^"]+"\) \(value ""\)\)/)); // 158

// 5) 转义
console.log('{slash} lines', count(/\{slash\}/)); // 4（全部是 net@name）
console.log('pinfunction with raw /', count(/\(pinfunction "[^"]*\//)); // 35
console.log('libpart pin name with raw /', count(/^ {8}\(pin \(num "[^"]*"\) \(name "[^"]*\//)); // 35

// 6) 排序验证
const { naturalCompare } = await import('../src/netlist/connectivity.js');
const plain = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// (a) comp：先按 sheetpath 分组，再各自自然序递增；整体不递增
const comps = [];
let currentComp = null;
for (const line of lines) {
  const head = /^ {4}\(comp \(ref "([^"]+)"\)/.exec(line);
  if (head) {
    currentComp = { ref: head[1], sheet: null };
    comps.push(currentComp);
    continue;
  }
  const path = /^ {6}\(sheetpath \(names "((?:[^"\\]|\\.)*)"\)/.exec(line);
  if (path && currentComp && currentComp.sheet === null) currentComp.sheet = path[1];
}
const groups = new Map();
for (const comp of comps) {
  if (!groups.has(comp.sheet)) groups.set(comp.sheet, []);
  groups.get(comp.sheet).push(comp.ref);
}
console.log(
  'comp groups',
  [...groups.entries()].map(([sheet, refs]) => [sheet, refs.length]), // ['/',125] ['/RP2040/',25]
);
console.log(
  'each comp group is natural-sorted',
  [...groups.values()].every(
    (refs) => JSON.stringify(refs) === JSON.stringify([...refs].sort(naturalCompare)),
  ), // true
);
console.log(
  'global comp natural order',
  JSON.stringify(comps.map((c) => c.ref)) ===
    JSON.stringify([...comps.map((c) => c.ref)].sort(naturalCompare)), // false
);

// (b) net：code 连续 1..N 且顺序等于 naturalCompare(name)
const netNames = lines
  .map((line) => /^ {4}\(net \(code "(\d+)"\) \(name "((?:[^"\\]|\\.)*)"\)/.exec(line))
  .filter(Boolean)
  .map((match) => [Number(match[1]), match[2]]);
console.log('net codes 1..N', netNames.every(([code], index) => code === index + 1)); // true
console.log(
  'net order == naturalCompare',
  JSON.stringify([...netNames].sort((a, b) => naturalCompare(a[1], b[1])).map(([code]) => code)) ===
    JSON.stringify(netNames.map(([code]) => code)), // true
);

// (c) net 内 node：按 (ref, pin) 纯 ASCII 序
const nets = [];
let currentNet = null;
for (const line of lines) {
  const head = /^ {4}\(net \(code "\d+"\) \(name "((?:[^"\\]|\\.)*)"\)/.exec(line);
  if (head) {
    currentNet = { name: head[1], nodes: [] };
    nets.push(currentNet);
    continue;
  }
  const node = /^ {6}\(node \(ref "([^"]+)"\) \(pin "([^"]+)"\)/.exec(line);
  if (node && currentNet) currentNet.nodes.push([node[1], node[2]]);
}
console.log('total nodes', nets.reduce((sum, net) => sum + net.nodes.length, 0)); // 584
console.log(
  'node order == plain ASCII',
  nets.every(
    (net) =>
      JSON.stringify([...net.nodes].sort((a, b) => plain(a[0], b[0]) || plain(a[1], b[1]))) ===
      JSON.stringify(net.nodes),
  ), // true
);

// (d) libpart：按 part 自然序递增
const parts = lines
  .filter((line) => /^ {4}\(libpart \(lib "/.test(line))
  .map((line) => /part "([^"]+)"/.exec(line)[1]);
console.log(
  'libparts natural-sorted',
  JSON.stringify(parts) === JSON.stringify([...parts].sort(naturalCompare)), // true
);

// 7) pintype / class 分布
const pintypes = new Map();
const classes = new Map();
for (const line of lines) {
  const node = /pintype "([^"]+)"\)\)/.exec(line);
  if (node) pintypes.set(node[1], (pintypes.get(node[1]) || 0) + 1);
  const net = /^ {4}\(net \(code "\d+"\) \(name "(?:[^"\\]|\\.)*"\) \(class "([^"]+)"\)/.exec(line);
  if (net) classes.set(net[1], (classes.get(net[1]) || 0) + 1);
}
console.log('pintypes', [...pintypes.entries()].sort((a, b) => b[1] - a[1]));
console.log('classes', [...classes.entries()].sort((a, b) => b[1] - a[1]));
```

实测输出（节选，与上文各表一一对应）：

```text
bytes/chars 254285 254283      lines 4680      BOM false      bare LF 0
endsWithNewline false          blank lines 0   paren-only lines 0
export 1   design 2   components 38   libparts 3352   libraries 3979   nets 3982
comp 150   net 114   node 584   libpart 28   sheet 2   library 1   libpart pin 287
pinfunction "" 0         pinfunction "~" 0      datasheet "~" 125     docs "~" 18
field with "" 0          property with value "" 158
{slash} lines 4          pinfunction with raw / 35   libpart pin name with raw / 35
comp groups [ [ '/', 125 ], [ '/RP2040/', 25 ] ]
each comp group is natural-sorted true   global comp natural order false
net codes 1..N true      net order == naturalCompare true      total nodes 584
node order == plain ASCII true           libparts natural-sorted true
```

> 说明：早期版本的本文用过 `grep -c '^    (comp (ref "'` 之类的命令，但 BRE 里 `(` 与 `\(` 语义不同、
> 且 Windows 下引号转义易出错，故改为上面的 Node 脚本——与仓库工具链一致、跨平台、结果可断言。

---

## 13. 已证伪 / 需修正的常见假设

| # | 常见假设 | 实测结论 |
| --- | --- | --- |
| 1 | 「网络名一律把 `/` 写成 `{slash}`」 | ❌ 只有**标签文本内**的 `/` 被编码；**层级路径前缀**的 `/` 原样保留。12 个网络名含裸 `/`、4 个含 `{slash}`、0 个混用（§5.2） |
| 2 | 「空 `pinfunction` 写成 `~`」 | ❌ KiCad 9 **整段省略**：`(pinfunction "~")` 与 `(pinfunction "")` 各出现 0 次；224/584 个 node 无该子节点（§3.6、§7.1 G16） |
| 3 | 「`pinfunction` 也要 `{slash}` 编码」 | ❌ 保留原始 `/`：35/360 含裸 `/`，含 `{slash}` 的 0 个（§5.4） |
| 4 | 「`~` 是通用空串哨兵」 | ❌ 只用于 `datasheet`/`docs` 表示「无」；空串另写 `(value "")`、空字段写自闭合 `(field (name "X"))`（§4.4） |
| 5 | 「`datasheet` 对每个 comp 都有」 | ❌ 140/150；**值为空时整段省略**（§3.3） |
| 6 | 「`components` 按位号全局自然排序」 | ❌ 先按图纸顺序、再按图纸内位号自然序（`C42` 出现在 `C29` 之前，§6.1） |
| 7 | 「`node` 也按自然排序」 | ❌ 纯 ASCII 字节序（`C10` 在 `C4` 之前，§6.4） |
| 8 | 「`net class` 缺省时不写」 | ❌ `Default` 也**显式写出**（114/114 个 net 都有 `class`，§3.6） |
| 9 | 「文件是 UTF-8 + LF」 | ❌ UTF-8 **无 BOM** + **CRLF** + **无结尾换行**（§2.1） |
| 10 | 「`design/source` 是工程名」 | ❌ 是**源 `.kicad_sch` 绝对路径**（§3.2） |
| 11 | 「`design/date` 只到日」 | ❌ 是带 UTC 偏移的完整时间戳；`title_block/date` 才是 `YYYY-MM-DD`（§3.2） |
| 12 | 「每个 `libpart` 都有 `pins`」 | ❌ 27/28；`Fiducial` 无 `pins` 块（§3.4） |
| 13 | 「`libpart/pin` 的 `type` 带 `+no_connect` 修饰符」 | ❌ 修饰符只出现在 `node@pintype`（§4.3） |
| 14 | 「`sheet@name` 是人工图纸名」 | ❌ 是 KiCad **sheet 路径**（`/`、`/RP2040/`）；人工名在 `property Sheetname`（§3.2.1） |
