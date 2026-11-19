// KiCad 9 网表格式化原语：S-表达式转义与排版、网络名编码、pintype 拼接、四类排序与稳定 UUID（纯函数）。
import { naturalCompare } from './connectivity.js';

/** 本规范固定的网表版本标识（KiCad 9）。 */
export const KICAD_VERSION = 'E';

/** 黄金样本实测行尾：CRLF；文件末尾不带换行。 */
export const KICAD_NEWLINE = '\r\n';

/** net@class 的缺省值（规范 §4.1 / §8.6）。 */
export const DEFAULT_NET_CLASS = 'Default';

/** datasheet / docs 的「无」哨兵（规范 §4.4）。 */
export const EMPTY_VALUE_SENTINEL = '~';

/**
 * KiCad 9 引脚电气类型全集（规范 §8.7）。
 * 与 src/library/symbol-library.js 的 PIN_ELECTRICAL_TYPES 保持同步；导出层保持自带常量，
 * 避免网表层对 library 层产生硬依赖（内置库缺失时仍可导出）。
 */
export const PIN_ELECTRICAL_TYPES = Object.freeze([
  'input',
  'output',
  'bidirectional',
  'tri_state',
  'passive',
  'free',
  'unspecified',
  'power_in',
  'power_out',
  'open_collector',
  'open_emitter',
  'no_connect',
]);

/**
 * S-表达式字符串转义（规范 §2.2）：反斜杠、双引号、换行、制表符。
 * 顺序不可颠倒，否则反斜杠会被二次转义。
 * @param {*} value 任意值，null / undefined 视为空串
 * @returns {string} 可放入双引号内的文本
 */
export function escapeSExpr(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function quote(value) {
  return '"' + escapeSExpr(value) + '"';
}

/**
 * 构造 S-表达式节点（排版模型的唯一入口）。
 * 节点形如 { name, inline: [[key, value]...], value, values, children: [...] }：
 * - inline：与结构名同处头行的叶列表，如 (comp (ref "C1")、(net (code "1") (name "x") (class "pwr")
 * - value：紧跟结构名的单个裸字符串，如 (field (name "MPN") "…)；undefined 表示省略该 token
 * - values：紧跟结构名的多个裸字符串（如 (tstamps "a" "b" "c")）；非空时优先于 value
 * - children：各占一行的结构子元素
 * @param {string} name 结构名（atom）
 * @param {{ inline?: Array<[string, *]>, value?: *, values?: Array<*>, children?: object[] }} options 选项
 * @returns {{ name: string, inline: Array<[string, string]>, value: (string|undefined),
 *             values: string[], children: object[] }}
 */
export function sexpr(name, options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const inline = Array.isArray(source.inline)
    ? source.inline.map((entry) => [String(entry[0]), entry[1] === undefined || entry[1] === null ? '' : String(entry[1])])
    : [];
  const children = Array.isArray(source.children) ? source.children.filter(Boolean) : [];
  const value = source.value === undefined || source.value === null ? undefined : String(source.value);
  const values = Array.isArray(source.values)
    ? source.values.map((item) => (item === undefined || item === null ? '' : String(item)))
    : [];
  return { name: String(name), inline, value, values, children };
}

function renderNode(node, depth, lines) {
  const indent = '  '.repeat(depth);
  let head = indent + '(' + node.name;
  for (const [key, value] of node.inline) head += ' (' + key + ' ' + quote(value) + ')';
  if (Array.isArray(node.values) && node.values.length > 0) {
    for (const value of node.values) head += ' ' + quote(value);
  } else if (node.value !== undefined) {
    head += ' ' + quote(node.value);
  }
  if (node.children.length === 0) {
    lines.push(head + ')');
    return;
  }
  lines.push(head);
  for (const child of node.children) renderNode(child, depth + 1, lines);
  // 规范 §2.3 R4：闭括号并入最后一行，绝不单独成行。
  lines[lines.length - 1] += ')';
}

/**
 * 渲染整份 S-表达式文档（规范 §2.3 R1–R6）：
 * 2 空格/层缩进、结构子元素各占一行、闭括号并入最后一行、CRLF 行尾、末尾无换行。
 * @param {object} node 根节点（通常为 (export ...)）
 * @returns {string} 网表文本（UTF-8 无 BOM 由调用方负责编码）
 */
export function renderSExpr(node) {
  const lines = [];
  renderNode(node, 0, lines);
  return lines.join(KICAD_NEWLINE);
}

/**
 * 网络名编码：只把「标签文本里作为普通字符的 `/`」写成 `{slash}`（规范 §5.2）。
 * 层级路径前缀（以 `/` 开头，如 `/CC1`、`/RP2040/DVDD`）与已编码原文（含 `{slash}`）一律逐字保留；
 * 自动命名（`Net-(…)` / `unconnected-(…)`）是全局名，不加图纸前缀也不编码。
 * @param {*} value 网络名
 * @returns {string} 编码后的标签文本
 */
export function encodeLabelText(value) {
  return (value === undefined || value === null ? '' : String(value)).replace(/\//g, '{slash}');
}

/**
 * 网络名解码：`{slash}` → `/`（导入 / UI 展示用；导出不做反向操作）。
 * @param {*} value 网络名
 * @returns {string} 可读文本
 */
export function decodeLabelText(value) {
  return (value === undefined || value === null ? '' : String(value)).replace(/\{slash\}/g, '/');
}

const AUTO_NET_NAME = /^(?:Net-\(|unconnected-\()/;

/**
 * 由模型网络名推导网表网络名（规范 §5.2 + 任务口径）：
 * 1. 自动名（`Net-(…)` / `unconnected-(…)`）逐字写出；
 * 2. 图纸路径前缀取 `sheet.kicad.name`：`/` 视为空串，其余原样前置；
 * 3. 前缀只在「局部标签网络」上生效（电源名 / 全局标签 / 自动名是全局命名，KiCad 不加路径前缀）；
 * 4. 名字以 `/` 开头（层级路径）或已含 `{slash}` 时视为已编码原文，逐字写出；
 * 5. 其余视为标签文本，只把其中的 `/` 编码为 `{slash}`。
 * @param {*} name 模型网络名
 * @param {{ sheetPath?: string, nameSource?: string }} options 归属图纸路径与命名来源
 * @returns {string} 网表网络名
 */
export function encodeNetName(name, options = {}) {
  const raw = name === undefined || name === null ? '' : String(name);
  if (raw === '') return raw;
  if (AUTO_NET_NAME.test(raw)) return raw;
  const source = options && typeof options === 'object' ? options : {};
  const sheetPath = typeof source.sheetPath === 'string' ? source.sheetPath : '/';
  const prefix = source.nameSource === 'local' && sheetPath !== '' && sheetPath !== '/' ? sheetPath : '';
  if (prefix !== '' && raw.startsWith(prefix)) {
    return prefix + encodeLabelText(raw.slice(prefix.length));
  }
  if (raw.startsWith('/') || raw.includes('{slash}')) return raw;
  return prefix + encodeLabelText(raw);
}

/**
 * 引脚基础电气类型（规范 §8.7）：旧词汇 `not_connected` 迁移为 `no_connect`，未知值回退 `passive`。
 * @param {object} pin 引脚
 * @returns {string} 12 值之一
 */
export function baseElectricalTypeOf(pin) {
  const raw = pin && typeof pin.electricalType === 'string' ? pin.electricalType : '';
  if (raw === 'not_connected') return 'no_connect';
  return PIN_ELECTRICAL_TYPES.includes(raw) ? raw : 'passive';
}

/**
 * 拼接 node@pintype：基础类型 + `+no_connect` / `+free` 修饰（规范 §4.2 / §8.7）。
 * 基础类型本身为 `no_connect` 时不再追加 `+no_connect`。
 * @param {object} pin 引脚
 * @returns {string} 例如 "bidirectional+no_connect" / "no_connect" / "passive"
 */
export function pintypeOf(pin) {
  const base = baseElectricalTypeOf(pin);
  const noConnect = Boolean(pin && (pin.noConnect === true || pin.electricalType === 'not_connected'));
  const free = Boolean(pin && pin.free === true);
  let type = base;
  if (noConnect && base !== 'no_connect') type += '+no_connect';
  if (free) type += '+free';
  return type;
}

/**
 * title_block 的 9 槽 comment（规范 §8.3）：数组保序取前 9 项、字符串按换行切槽、缺失全空。
 * @param {string|string[]|undefined} comments 标题栏注释
 * @returns {string[]} 长度恰为 9 的字符串数组
 */
export function commentsAsSlots9(comments) {
  const slots = [];
  let values = [];
  if (Array.isArray(comments)) {
    values = comments.slice(0, 9);
  } else if (typeof comments === 'string' && comments !== '') {
    values = comments.split(/\r?\n/).slice(0, 9);
  }
  for (let index = 0; index < 9; index += 1) {
    const value = values[index];
    slots.push(value === undefined || value === null ? '' : String(value));
  }
  return slots;
}

/** 纯 ASCII 字节序比较（规范 §6.4：node 排序不能用自然序）。 */
export function compareAscii(left, right) {
  const a = left === undefined || left === null ? '' : String(left);
  const b = right === undefined || right === null ? '' : String(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * components 排序键比较（规范 §6.1）：先图纸顺序，再图纸内位号自然序。
 * @param {{ sheetOrder: number, designator: string }} left 左键
 * @param {{ sheetOrder: number, designator: string }} right 右键
 * @returns {number} 比较结果
 */
export function compareComponentKeys(left, right) {
  const first = Number(left && left.sheetOrder) || 0;
  const second = Number(right && right.sheetOrder) || 0;
  if (first !== second) return first < second ? -1 : 1;
  return naturalCompare(left && left.designator, right && right.designator);
}

/**
 * nets 排序比较（规范 §6.3）：网络名自然序。
 * @param {string} left 左网络名
 * @param {string} right 右网络名
 * @returns {number} 比较结果
 */
export function compareNetNames(left, right) {
  return naturalCompare(left, right) || compareAscii(left, right);
}

/**
 * libparts 排序比较（规范 §6.2）：part 自然序，part 相同再比 lib。
 * @param {{ part: string, lib: string }} left 左键
 * @param {{ part: string, lib: string }} right 右键
 * @returns {number} 比较结果
 */
export function compareLibparts(left, right) {
  return naturalCompare(left && left.part, right && right.part) || compareAscii(left && left.lib, right && right.lib);
}

/**
 * node 排序（规范 §6.4）：(ref, pin) 纯 ASCII 字节序。
 * @param {object[]} pins 引脚数组
 * @returns {object[]} 新数组
 */
export function sortPinsAscii(pins) {
  return [...(Array.isArray(pins) ? pins : [])].sort(
    (left, right) => compareAscii(left.designator, right.designator) || compareAscii(left.pinNumber, right.pinNumber),
  );
}

function hash32(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 由任意种子派生稳定 UUID（v4 形状，8-4-4-4-12）：缺少 symbol.kicad.tstamps 时给 comp 兜底。
 * 同一工程重复导出字节稳定（不依赖随机数或时间）。
 * @param {*} seed 种子（通常为 instanceId / designator）
 * @returns {string} UUID 文本
 */
export function stableUuid(seed) {
  const text = seed === undefined || seed === null ? '' : String(seed);
  let hex = '';
  for (const salt of [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]) {
    hex += hash32(text, salt).toString(16).padStart(8, '0');
  }
  hex = hex.slice(0, 12) + '4' + hex.slice(13, 16) + '8' + hex.slice(17, 32);
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20, 32);
}
