// 工程数据模型：纯数据工厂、深度克隆与规范化，禁止依赖 DOM。
import { uid } from '../core/id.js';
import { SCHEMA_VERSION } from '../core/schema.js';

export const DEFAULT_GRID = 2.54;
export const DEFAULT_WIRE_WIDTH = 0.1524;
export const DEFAULT_TEXT_SIZE = 1.27;

export const ENTITY_COLLECTIONS = Object.freeze(['symbols', 'wires', 'junctions', 'labels', 'texts']);

/** 当前时间的 ISO 字符串，用于 meta 字段。 */
export function nowIso() {
  return new Date().toISOString();
}

function todayIsoDate() {
  return nowIso().slice(0, 10);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toText(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function idOrUid(value, prefix) {
  return typeof value === 'string' && value.trim() !== '' ? value : uid(prefix);
}

function normalizeRotation(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const wrapped = ((Math.round(number / 90) * 90) % 360 + 360) % 360;
  return wrapped;
}

function toPoint(raw) {
  if (!isPlainObject(raw)) return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** 深拷贝可序列化数据。 */
export function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // 含不可克隆值时退化为 JSON 往返。
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/** 创建一份完整工程；options 可带 KiCad 元数据（缺失时保持旧工程形状）。 */
export function createProject(name = '未命名工程', options = {}) {
  const projectName = toText(name, '未命名工程').trim() || '未命名工程';
  const source = isPlainObject(options) ? options : {};
  const timestamp = nowIso();
  const project = {
    schemaVersion: SCHEMA_VERSION,
    name: projectName,
    units: 'mm',
    grid: DEFAULT_GRID,
    sheets: [createSheet('图纸 1', isPlainObject(source.sheet) ? source.sheet : {})],
    library: { symbols: [], footprints: [] },
    meta: { created: timestamp, modified: timestamp },
  };
  const kicad = normalizeProjectKicad(source.kicad);
  if (kicad !== undefined) project.kicad = kicad;
  const assignments = normalizeNetClassAssignments(source.netClassAssignments);
  if (assignments !== undefined) project.netClassAssignments = assignments;
  return project;
}

/** 创建一张空图纸；options 可带 KiCad 元数据与标题栏（缺失时保持旧工程形状）。 */
export function createSheet(name = '图纸 1', options = {}) {
  const sheetName = toText(name, '图纸 1').trim() || '图纸 1';
  const source = isPlainObject(options) ? options : {};
  const raw = {
    id: typeof source.id === 'string' && source.id.trim() !== '' ? source.id : uid('sheet'),
    name: sheetName,
    symbols: [],
    wires: [],
    junctions: [],
    labels: [],
    texts: [],
    title: isPlainObject(source.title)
      ? { title: sheetName, company: '', rev: '', date: todayIsoDate(), comments: '', ...source.title }
      : { title: sheetName, company: '', rev: '', date: todayIsoDate(), comments: '' },
  };
  if (source.kicad !== undefined) raw.kicad = source.kicad;
  return normalizeSheet(raw, Number.isInteger(source.index) ? source.index : 0);
}

/** 创建符号实例（未放置时坐标默认为 0）。 */
export function createSymbolInstance(partial = {}) {
  const source = isPlainObject(partial) ? partial : {};
  return normalizeSymbolInstance({ ...source, id: idOrUid(source.id, 'sym') });
}

/** 创建导线，points 为至少两个点。 */
export function createWire(points = []) {
  return normalizeWire({ id: uid('wire'), points });
}

/** 创建结点。 */
export function createJunction(x = 0, y = 0) {
  return { id: uid('jct'), x: toNumber(x), y: toNumber(y) };
}

/** 创建网络标签。 */
export function createLabel(partial = {}) {
  const source = isPlainObject(partial) ? partial : {};
  return normalizeLabel({ ...source, id: idOrUid(source.id, 'lbl') });
}

/** 创建文本注释。 */
export function createText(partial = {}) {
  const source = isPlainObject(partial) ? partial : {};
  return normalizeText({ ...source, id: idOrUid(source.id, 'txt') });
}

/**
 * 标题栏规范化：comments 双形态（string | string[]）原样保留，数组只做「不超过 9 槽 + 逐项字符串化」。
 * 数组不自动补齐（补 9 槽是导出器的职责）；source 仅在提供时保留，避免改变旧工程形状。
 */
function normalizeTitle(raw, sheetName) {
  const source = isPlainObject(raw) ? raw : {};
  const comments = Array.isArray(source.comments)
    ? source.comments
        .slice(0, 9)
        .map((item) => (item === undefined || item === null ? '' : String(item)))
    : toText(source.comments, '');
  const title = {
    title: toText(source.title, sheetName),
    company: toText(source.company, ''),
    rev: toText(source.rev, ''),
    date: toText(source.date, ''),
    comments,
  };
  if (typeof source.source === 'string') title.source = source.source;
  return title;
}

/** 规范化 project.kicad（§8.1）；非对象返回 undefined（保持旧工程形状）。 */
function normalizeProjectKicad(raw) {
  if (!isPlainObject(raw)) return undefined;
  return {
    source: toText(raw.source, ''),
    tool: toText(raw.tool, 'schematic-studio'),
    date: toText(raw.date, ''),
    version: toText(raw.version, 'E'),
    libraries: asArray(raw.libraries)
      .filter(isPlainObject)
      .map((library) => ({ logical: toText(library.logical, ''), uri: toText(library.uri, '') })),
  };
}

/** 规范化 project.netClassAssignments（§8.2）：丢弃空网络名与非法 class 值。 */
function normalizeNetClassAssignments(raw) {
  if (!isPlainObject(raw)) return undefined;
  const assignments = {};
  for (const [netName, className] of Object.entries(raw)) {
    if (netName === '' || typeof className !== 'string' || className.trim() === '') continue;
    assignments[netName] = className;
  }
  return assignments;
}

/** 规范化 sheet.kicad（§8.3）；非对象返回 undefined。 */
function normalizeSheetKicad(raw, index) {
  if (!isPlainObject(raw)) return undefined;
  return {
    number: toText(raw.number, String(index + 1)),
    name: toText(raw.name, '/'),
    tstamps: toText(raw.tstamps, '/'),
  };
}

/** 规范化 symbol.kicad 的 properties / fields 数组：保序，value 缺失与空串严格区分。 */
function normalizeKicadEntries(raw) {
  if (!Array.isArray(raw)) return undefined;
  const entries = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const entry = { name: toText(item.name, '') };
    if (typeof item.value === 'string') entry.value = item.value;
    entries.push(entry);
  }
  return entries;
}

/**
 * 规范化 symbol.kicad.tstamps（§8.4 兼容扩展）：string | string[] 双形态。
 * 数组保持数组（保序、逐项字符串化），绝不压平；旧工程的字符串或缺失行为不变。
 */
function normalizeKicadTstamps(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => (item === undefined || item === null ? '' : String(item)));
  }
  return toText(raw, '');
}

/** 规范化 symbol.kicad（§8.4）；非对象返回 undefined。 */
function normalizeSymbolKicad(raw) {
  if (!isPlainObject(raw)) return undefined;
  const kicad = {
    datasheet: toText(raw.datasheet, ''),
    description: toText(raw.description, ''),
    tstamps: normalizeKicadTstamps(raw.tstamps),
  };
  if (isPlainObject(raw.libsource)) {
    kicad.libsource = {
      lib: toText(raw.libsource.lib, ''),
      part: toText(raw.libsource.part, ''),
      description: toText(raw.libsource.description, ''),
    };
  }
  const properties = normalizeKicadEntries(raw.properties);
  if (properties !== undefined) kicad.properties = properties;
  const fields = normalizeKicadEntries(raw.fields);
  if (fields !== undefined) kicad.fields = fields;
  if (isPlainObject(raw.sheetpath)) {
    kicad.sheetpath = {
      names: toText(raw.sheetpath.names, ''),
      tstamps: toText(raw.sheetpath.tstamps, ''),
    };
  }
  return kicad;
}

function normalizeSymbolInstance(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const symbol = {
    id: idOrUid(source.id, 'sym'),
    symbolId: toText(source.symbolId, ''),
    designator: toText(source.designator, 'U?'),
    value: toText(source.value, ''),
    x: toNumber(source.x),
    y: toNumber(source.y),
    rotation: normalizeRotation(source.rotation),
    mirror: source.mirror === true,
    footprintId: typeof source.footprintId === 'string' ? source.footprintId : null,
    fields: isPlainObject(source.fields) ? clone(source.fields) : {},
  };
  const kicad = normalizeSymbolKicad(source.kicad);
  if (kicad !== undefined) symbol.kicad = kicad;
  return symbol;
}

function normalizeWire(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const points = asArray(source.points).map(toPoint).filter(Boolean);
  return {
    id: idOrUid(source.id, 'wire'),
    points,
    width: toPositive(source.width, DEFAULT_WIRE_WIDTH),
  };
}

function normalizeJunction(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    id: idOrUid(source.id, 'jct'),
    x: toNumber(source.x),
    y: toNumber(source.y),
  };
}

function normalizeLabel(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    id: idOrUid(source.id, 'lbl'),
    x: toNumber(source.x),
    y: toNumber(source.y),
    rotation: toNumber(source.rotation),
    text: toText(source.text, ''),
    kind: source.kind === 'global' ? 'global' : 'local',
  };
}

function normalizeText(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    id: idOrUid(source.id, 'txt'),
    x: toNumber(source.x),
    y: toNumber(source.y),
    rotation: toNumber(source.rotation),
    text: toText(source.text, ''),
    size: toPositive(source.size, DEFAULT_TEXT_SIZE),
  };
}

function normalizeSheet(raw, index) {
  const source = isPlainObject(raw) ? raw : {};
  const fallbackName = '图纸 ' + (index + 1);
  const name = toText(source.name, fallbackName).trim() || fallbackName;
  const sheet = {
    id: idOrUid(source.id, 'sheet'),
    name,
    symbols: asArray(source.symbols).filter(isPlainObject).map(normalizeSymbolInstance),
    wires: asArray(source.wires).filter(isPlainObject).map(normalizeWire),
    junctions: asArray(source.junctions).filter(isPlainObject).map(normalizeJunction),
    labels: asArray(source.labels).filter(isPlainObject).map(normalizeLabel),
    texts: asArray(source.texts).filter(isPlainObject).map(normalizeText),
    title: normalizeTitle(source.title, name),
  };
  const kicad = normalizeSheetKicad(source.kicad, index);
  if (kicad !== undefined) sheet.kicad = kicad;
  return sheet;
}

function normalizeLibrary(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    symbols: asArray(source.symbols).filter(isPlainObject).map(clone),
    footprints: asArray(source.footprints).filter(isPlainObject).map(clone),
  };
}

function normalizeMeta(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const created = toText(source.created, '');
  const modified = toText(source.modified, '');
  const fallback = nowIso();
  return {
    created: created || fallback,
    modified: modified || created || fallback,
  };
}

/**
 * 补齐工程缺省字段并清洗类型：不修改入参，返回全新对象。
 * @param {*} json 任意工程数据
 * @returns {object} 规范化后的工程
 */
export function normalizeProject(json) {
  const source = isPlainObject(json) ? clone(json) : {};
  const sheets = asArray(source.sheets);
  const project = {
    schemaVersion: SCHEMA_VERSION,
    name: toText(source.name, '未命名工程').trim() || '未命名工程',
    units: 'mm',
    grid: toPositive(source.grid, DEFAULT_GRID),
    sheets: sheets.map((sheet, index) => normalizeSheet(sheet, index)),
    library: normalizeLibrary(source.library),
    meta: normalizeMeta(source.meta),
  };
  const kicad = normalizeProjectKicad(source.kicad);
  if (kicad !== undefined) project.kicad = kicad;
  const assignments = normalizeNetClassAssignments(source.netClassAssignments);
  if (assignments !== undefined) project.netClassAssignments = assignments;
  if (project.sheets.length === 0) {
    project.sheets.push(createSheet('图纸 1'));
  }
  return project;
}

/** 按 id 查找图纸，找不到返回 null。 */
export function findSheetById(project, sheetId) {
  if (!project || !Array.isArray(project.sheets)) return null;
  return project.sheets.find((sheet) => sheet && sheet.id === sheetId) || null;
}

/** 在图纸中查找实体（不论类型），返回实体或 null。 */
export function findEntityById(sheet, id) {
  const found = findEntityWithKind(sheet, id);
  return found ? found.entity : null;
}

/** 在图纸中查找实体并返回 { kind, entity }，找不到返回 null。 */
export function findEntityWithKind(sheet, id) {
  if (!sheet || typeof id !== 'string' || id === '') return null;
  for (const kind of ENTITY_COLLECTIONS) {
    const collection = sheet[kind];
    if (!Array.isArray(collection)) continue;
    const entity = collection.find((item) => item && item.id === id);
    if (entity) return { kind, entity };
  }
  return null;
}
