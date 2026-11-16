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

/** 创建一份完整工程。 */
export function createProject(name = '未命名工程') {
  const projectName = toText(name, '未命名工程').trim() || '未命名工程';
  const timestamp = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    name: projectName,
    units: 'mm',
    grid: DEFAULT_GRID,
    sheets: [createSheet('图纸 1')],
    library: { symbols: [], footprints: [] },
    meta: { created: timestamp, modified: timestamp },
  };
}

/** 创建一张空图纸。 */
export function createSheet(name = '图纸 1') {
  const sheetName = toText(name, '图纸 1').trim() || '图纸 1';
  return {
    id: uid('sheet'),
    name: sheetName,
    symbols: [],
    wires: [],
    junctions: [],
    labels: [],
    texts: [],
    title: { title: sheetName, company: '', rev: '', date: todayIsoDate(), comments: '' },
  };
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

function normalizeTitle(raw, sheetName) {
  const source = isPlainObject(raw) ? raw : {};
  const comments = Array.isArray(source.comments)
    ? source.comments.map((item) => toText(item, '')).join('\n')
    : toText(source.comments, '');
  return {
    title: toText(source.title, sheetName),
    company: toText(source.company, ''),
    rev: toText(source.rev, ''),
    date: toText(source.date, ''),
    comments,
  };
}

function normalizeSymbolInstance(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
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
  return {
    id: idOrUid(source.id, 'sheet'),
    name,
    symbols: asArray(source.symbols).filter(isPlainObject).map(normalizeSymbolInstance),
    wires: asArray(source.wires).filter(isPlainObject).map(normalizeWire),
    junctions: asArray(source.junctions).filter(isPlainObject).map(normalizeJunction),
    labels: asArray(source.labels).filter(isPlainObject).map(normalizeLabel),
    texts: asArray(source.texts).filter(isPlainObject).map(normalizeText),
    title: normalizeTitle(source.title, name),
  };
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
