// 工程 schema 校验与版本迁移：返回显式错误清单（路径 + 原因），供 IO 与 UI 使用。
export const SCHEMA_VERSION = 1;

const ROTATIONS = [0, 90, 180, 270];
const LABEL_KINDS = ['local', 'global'];

/** 判断是否为普通对象（排除数组与 null）。 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function describe(value) {
  if (value === undefined) return '缺失';
  if (value === null) return 'null';
  if (Array.isArray(value)) return '数组';
  if (typeof value === 'string') return "字符串 '" + value + "'";
  return typeof value;
}

function push(errors, path, message) {
  errors.push(path + ': ' + message);
}

function requireObject(errors, value, path) {
  if (!isPlainObject(value)) {
    push(errors, path, '期望对象，实际为' + describe(value));
    return false;
  }
  return true;
}

function requireArray(errors, value, path) {
  if (!Array.isArray(value)) {
    push(errors, path, '期望数组，实际为' + describe(value));
    return false;
  }
  return true;
}

function requireString(errors, value, path, options = {}) {
  if (typeof value !== 'string') {
    push(errors, path, '期望字符串，实际为' + describe(value));
    return false;
  }
  if (options.nonEmpty && value.trim() === '') {
    push(errors, path, '不能为空字符串');
    return false;
  }
  return true;
}

function requireNumber(errors, value, path, options = {}) {
  if (!isFiniteNumber(value)) {
    push(errors, path, '期望有限数字，实际为' + describe(value));
    return false;
  }
  if (options.positive && !(value > 0)) {
    push(errors, path, '期望正数，实际为 ' + value);
    return false;
  }
  return true;
}

function requireBoolean(errors, value, path) {
  if (typeof value !== 'boolean') {
    push(errors, path, '期望布尔值，实际为' + describe(value));
    return false;
  }
  return true;
}

function requireEnum(errors, value, path, allowed) {
  const matched = allowed.some((item) => item === value);
  if (!matched) {
    push(errors, path, '期望 ' + allowed.join(' | ') + '，实际为 ' + describe(value));
  }
  return matched;
}

function requirePoint(errors, value, path) {
  if (!requireObject(errors, value, path)) return;
  requireNumber(errors, value.x, path + '.x');
  requireNumber(errors, value.y, path + '.y');
}

function validateTitle(errors, title, path) {
  if (!requireObject(errors, title, path)) return;
  requireString(errors, title.title, path + '.title');
  requireString(errors, title.company, path + '.company');
  requireString(errors, title.rev, path + '.rev');
  requireString(errors, title.date, path + '.date');
  if (title.source !== undefined) requireString(errors, title.source, path + '.source');
  const comments = title.comments;
  if (typeof comments === 'string') return;
  if (Array.isArray(comments) && comments.every((item) => typeof item === 'string')) return;
  push(errors, path + '.comments', '期望字符串或字符串数组，实际为' + describe(comments));
}

/** 可选字符串字段：缺失（undefined）时放行，出现即校验类型。 */
function optionalString(errors, value, path) {
  if (value === undefined) return;
  requireString(errors, value, path);
}

/** 校验 project.kicad（§8.1）：字段缺失合法，出现即校验形状。 */
function validateProjectKicad(errors, kicad, path) {
  if (kicad === undefined) return;
  if (!requireObject(errors, kicad, path)) return;
  optionalString(errors, kicad.source, path + '.source');
  optionalString(errors, kicad.tool, path + '.tool');
  optionalString(errors, kicad.date, path + '.date');
  optionalString(errors, kicad.version, path + '.version');
  if (kicad.libraries === undefined) return;
  if (!requireArray(errors, kicad.libraries, path + '.libraries')) return;
  kicad.libraries.forEach((library, index) => {
    const itemPath = path + '.libraries[' + index + ']';
    if (!requireObject(errors, library, itemPath)) return;
    requireString(errors, library.logical, itemPath + '.logical');
    requireString(errors, library.uri, itemPath + '.uri');
  });
}

/** 校验 project.netClassAssignments（§8.2）：值必须是非空字符串。 */
function validateNetClassAssignments(errors, assignments, path) {
  if (assignments === undefined) return;
  if (!requireObject(errors, assignments, path)) return;
  for (const [netName, className] of Object.entries(assignments)) {
    if (netName === '') {
      push(errors, path, '网络名不能为空字符串');
      continue;
    }
    if (typeof className !== 'string' || className.trim() === '') {
      push(errors, path + '.' + netName, '期望非空字符串，实际为' + describe(className));
    }
  }
}

/** 校验 sheet.kicad（§8.3）：number/name/tstamps 为可选字符串。 */
function validateSheetKicad(errors, kicad, path) {
  if (kicad === undefined) return;
  if (!requireObject(errors, kicad, path)) return;
  optionalString(errors, kicad.number, path + '.number');
  optionalString(errors, kicad.name, path + '.name');
  optionalString(errors, kicad.tstamps, path + '.tstamps');
}

/** 校验 symbol.kicad 的 properties / fields：保序数组，name 必填，value 可选字符串。 */
function validateKicadEntries(errors, entries, path) {
  if (entries === undefined) return;
  if (!requireArray(errors, entries, path)) return;
  entries.forEach((entry, index) => {
    const itemPath = path + '[' + index + ']';
    if (!requireObject(errors, entry, itemPath)) return;
    requireString(errors, entry.name, itemPath + '.name', { nonEmpty: true });
    optionalString(errors, entry.value, itemPath + '.value');
  });
}

/** 校验 symbol.kicad（§8.4）。 */
function validateSymbolKicad(errors, kicad, path) {
  if (kicad === undefined) return;
  if (!requireObject(errors, kicad, path)) return;
  optionalString(errors, kicad.datasheet, path + '.datasheet');
  optionalString(errors, kicad.description, path + '.description');
  optionalString(errors, kicad.tstamps, path + '.tstamps');
  if (kicad.libsource !== undefined) {
    const libsourcePath = path + '.libsource';
    if (requireObject(errors, kicad.libsource, libsourcePath)) {
      optionalString(errors, kicad.libsource.lib, libsourcePath + '.lib');
      optionalString(errors, kicad.libsource.part, libsourcePath + '.part');
      optionalString(errors, kicad.libsource.description, libsourcePath + '.description');
    }
  }
  validateKicadEntries(errors, kicad.properties, path + '.properties');
  validateKicadEntries(errors, kicad.fields, path + '.fields');
  if (kicad.sheetpath !== undefined) {
    const sheetpathPath = path + '.sheetpath';
    if (requireObject(errors, kicad.sheetpath, sheetpathPath)) {
      optionalString(errors, kicad.sheetpath.names, sheetpathPath + '.names');
      optionalString(errors, kicad.sheetpath.tstamps, sheetpathPath + '.tstamps');
    }
  }
}

function validateSymbol(errors, symbol, path) {
  if (!requireObject(errors, symbol, path)) return;
  requireString(errors, symbol.id, path + '.id', { nonEmpty: true });
  requireString(errors, symbol.symbolId, path + '.symbolId', { nonEmpty: true });
  requireString(errors, symbol.designator, path + '.designator');
  requireString(errors, symbol.value, path + '.value');
  requireNumber(errors, symbol.x, path + '.x');
  requireNumber(errors, symbol.y, path + '.y');
  requireEnum(errors, symbol.rotation, path + '.rotation', ROTATIONS);
  requireBoolean(errors, symbol.mirror, path + '.mirror');
  if (symbol.footprintId !== null && typeof symbol.footprintId !== 'string') {
    push(errors, path + '.footprintId', '期望字符串或 null，实际为' + describe(symbol.footprintId));
  }
  requireObject(errors, symbol.fields, path + '.fields');
  validateSymbolKicad(errors, symbol.kicad, path + '.kicad');
}

function validateWire(errors, wire, path) {
  if (!requireObject(errors, wire, path)) return;
  requireString(errors, wire.id, path + '.id', { nonEmpty: true });
  requireNumber(errors, wire.width, path + '.width', { positive: true });
  if (!requireArray(errors, wire.points, path + '.points')) return;
  if (wire.points.length < 2) {
    push(errors, path + '.points', '至少需要两个点，实际为 ' + wire.points.length);
  }
  wire.points.forEach((point, index) => requirePoint(errors, point, path + '.points[' + index + ']'));
}

function validateJunction(errors, junction, path) {
  if (!requireObject(errors, junction, path)) return;
  requireString(errors, junction.id, path + '.id', { nonEmpty: true });
  requireNumber(errors, junction.x, path + '.x');
  requireNumber(errors, junction.y, path + '.y');
}

function validateLabel(errors, label, path) {
  if (!requireObject(errors, label, path)) return;
  requireString(errors, label.id, path + '.id', { nonEmpty: true });
  requireNumber(errors, label.x, path + '.x');
  requireNumber(errors, label.y, path + '.y');
  requireNumber(errors, label.rotation, path + '.rotation');
  requireString(errors, label.text, path + '.text');
  requireEnum(errors, label.kind, path + '.kind', LABEL_KINDS);
}

function validateTextEntity(errors, text, path) {
  if (!requireObject(errors, text, path)) return;
  requireString(errors, text.id, path + '.id', { nonEmpty: true });
  requireNumber(errors, text.x, path + '.x');
  requireNumber(errors, text.y, path + '.y');
  requireNumber(errors, text.rotation, path + '.rotation');
  requireString(errors, text.text, path + '.text');
  requireNumber(errors, text.size, path + '.size', { positive: true });
}

function validateCollection(errors, collection, key, path, validator) {
  if (!requireArray(errors, collection[key], path + '.' + key)) return;
  collection[key].forEach((item, index) => validator(errors, item, path + '.' + key + '[' + index + ']'));
}

function validateSheet(errors, sheet, index) {
  const path = 'sheets[' + index + ']';
  if (!requireObject(errors, sheet, path)) return;
  requireString(errors, sheet.id, path + '.id', { nonEmpty: true });
  requireString(errors, sheet.name, path + '.name');
  validateCollection(errors, sheet, 'symbols', path, validateSymbol);
  validateCollection(errors, sheet, 'wires', path, validateWire);
  validateCollection(errors, sheet, 'junctions', path, validateJunction);
  validateCollection(errors, sheet, 'labels', path, validateLabel);
  validateCollection(errors, sheet, 'texts', path, validateTextEntity);
  validateTitle(errors, sheet.title, path + '.title');
  validateSheetKicad(errors, sheet.kicad, path + '.kicad');
}

function validateLibrary(errors, library) {
  if (!requireObject(errors, library, 'library')) return;
  requireArray(errors, library.symbols, 'library.symbols');
  requireArray(errors, library.footprints, 'library.footprints');
}

function validateMeta(errors, meta) {
  if (!requireObject(errors, meta, 'meta')) return;
  requireString(errors, meta.created, 'meta.created');
  requireString(errors, meta.modified, 'meta.modified');
}

/**
 * 校验工程 JSON 结构。
 * @param {*} json 待校验数据
 * @returns {{ ok: boolean, errors: string[] }} 校验结果
 */
export function validateProject(json) {
  const errors = [];
  if (!isPlainObject(json)) {
    errors.push('project: 期望对象，实际为' + describe(json));
    return { ok: false, errors };
  }

  if (!isFiniteNumber(json.schemaVersion)) {
    push(errors, 'schemaVersion', '期望数字 ' + SCHEMA_VERSION + '，实际为' + describe(json.schemaVersion));
  } else if (json.schemaVersion !== SCHEMA_VERSION) {
    push(errors, 'schemaVersion', '不支持的版本 ' + json.schemaVersion + '（当前 ' + SCHEMA_VERSION + '）');
  }
  requireString(errors, json.name, 'name');
  if (json.units !== 'mm') {
    push(errors, 'units', "期望 'mm'，实际为" + describe(json.units));
  }
  requireNumber(errors, json.grid, 'grid', { positive: true });

  if (requireArray(errors, json.sheets, 'sheets')) {
    if (json.sheets.length === 0) {
      push(errors, 'sheets', '至少需要一张图纸');
    }
    json.sheets.forEach((sheet, index) => validateSheet(errors, sheet, index));
  }

  validateLibrary(errors, json.library);
  validateMeta(errors, json.meta);
  validateProjectKicad(errors, json.kicad, 'kicad');
  validateNetClassAssignments(errors, json.netClassAssignments, 'netClassAssignments');
  return { ok: errors.length === 0, errors };
}

/**
 * 迁移工程到当前 schema 版本；v1 原样返回。
 * @param {*} json 工程数据
 * @returns {*} 迁移后的工程数据
 */
export function migrateProject(json) {
  if (!isPlainObject(json)) return json;
  // 当前只有 v1，未来版本在此按顺序升级后返回。
  return json;
}
