// 可撤销编辑命令：所有修改经 store.commands 执行，do/undo 通过 this.state 读写 store。
import { normalizeDeg, round } from '../core/geometry.js';
import {
  ENTITY_COLLECTIONS,
  clone,
  createJunction,
  createLabel,
  createSymbolInstance,
  createText,
  createWire,
  findEntityWithKind,
  findSheetById,
  nowIso,
} from '../model/project.js';
import { findJunctionAt, findWireJunctions, pruneJunctions } from './wire-utils.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asIdList(ids) {
  if (typeof ids === 'string') return [ids];
  return asArray(ids).filter((id) => typeof id === 'string' && id !== '');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toPoint(raw) {
  if (!raw) return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: round(x, 6), y: round(y, 6) };
}

function requireStore(command) {
  const store = command && command.state;
  if (!store || typeof store.getProject !== 'function' || !store.commands) {
    throw new TypeError('命令未绑定 store：请使用 executeCommand / createCommandApi 执行');
  }
  return store;
}

/**
 * 通用可撤销命令：首次 do 时快照工程、在草稿副本上执行 mutator，redo 复用结果。
 * undo 恢复快照；changed 事件由 store.commands 统一广播。
 */
function createEditCommand(label, sheetId, mutator, options = {}) {
  let before = null;
  let after = null;
  const command = {
    label: label || '编辑',
    state: options.state || null,
    result: null,
    do() {
      const store = requireStore(this);
      if (!after) {
        before = clone(store.getProject());
        const draft = clone(before);
        const targetId = sheetId || store.getSheetId();
        const sheet = findSheetById(draft, targetId) || draft.sheets[0] || null;
        if (!sheet) throw new Error('工程中没有可编辑的图纸');
        const result = mutator(sheet, draft, store);
        draft.meta = { ...draft.meta, modified: nowIso() };
        after = draft;
        this.result = result === undefined ? null : result;
      }
      store.project = clone(after);
      return this.result;
    },
    undo() {
      const store = requireStore(this);
      if (!before) return null;
      store.project = clone(before);
      return before;
    },
  };
  return command;
}

/** 把 store 绑定到命令（等价于设置命令的 this.state）。 */
export function bindCommand(command, store) {
  if (!command || typeof command.do !== 'function' || typeof command.undo !== 'function') {
    throw new TypeError('命令必须是 { label, do(), undo() } 对象');
  }
  command.state = store;
  return command;
}

/** 通过 store.commands 执行并绑定 store；返回命令对象（命令产物见 command.result）。 */
export function executeCommand(store, command) {
  if (!store || !store.commands || typeof store.commands.execute !== 'function') {
    throw new TypeError('executeCommand 需要带 commands 的 store');
  }
  bindCommand(command, store);
  store.commands.execute(command);
  return command;
}

/** 添加导线（可自动补齐 T 形 junction）。 */
export function addWireCommand(sheetId, points, options = {}) {
  const normalized = asArray(points).map(toPoint).filter(Boolean);
  const wire = createWire(normalized);
  if (Number.isFinite(Number(options.width)) && Number(options.width) > 0) {
    wire.width = Number(options.width);
  }
  return createEditCommand(options.label || '添加导线', sheetId, (sheet, draft) => {
    if (!wire || wire.points.length < 2) return null;
    sheet.wires.push(clone(wire));
    if (options.autoJunction !== false) {
      const junctions = findWireJunctions(draft, sheet, wire, {
        resolveSymbol: options.resolveSymbol,
        symbolResolver: options.symbolResolver,
        pinAnchors: options.pinAnchors,
        tolerance: options.tolerance,
      });
      for (const point of junctions) {
        if (findJunctionAt(sheet, point)) continue;
        sheet.junctions.push(createJunction(point.x, point.y));
      }
    }
    return wire.id;
  }, options);
}

/** 删除实体（支持多选），并清理孤立 junction。 */
export function removeEntitiesCommand(sheetId, ids, options = {}) {
  const idSet = new Set(asIdList(ids));
  const label = idSet.size > 1 ? '批量删除' : options.label || '删除';
  return createEditCommand(label, sheetId, (sheet, draft) => {
    if (idSet.size === 0) return 0;
    for (const kind of ENTITY_COLLECTIONS) {
      if (!Array.isArray(sheet[kind])) continue;
      sheet[kind] = sheet[kind].filter((entity) => !entity || !idSet.has(entity.id));
    }
    pruneJunctions(sheet, draft, {
      resolveSymbol: options.resolveSymbol,
      symbolResolver: options.symbolResolver,
      tolerance: options.tolerance,
    });
    return idSet.size;
  }, options);
}

/** 移动实体（符号/导线/结点/标签/文本），delta 单位为 mm。 */
export function moveEntitiesCommand(sheetId, ids, delta, options = {}) {
  const idSet = new Set(asIdList(ids));
  const dx = round(toNumber(delta && delta.x), 6);
  const dy = round(toNumber(delta && delta.y), 6);
  return createEditCommand(options.label || '移动', sheetId, (sheet) => {
    for (const kind of ENTITY_COLLECTIONS) {
      for (const entity of asArray(sheet[kind])) {
        if (!entity || !idSet.has(entity.id)) continue;
        if (kind === 'wires') {
          entity.points = asArray(entity.points).map((point) => ({
            x: round(toNumber(point.x) + dx, 6),
            y: round(toNumber(point.y) + dy, 6),
          }));
        } else {
          entity.x = round(toNumber(entity.x) + dx, 6);
          entity.y = round(toNumber(entity.y) + dy, 6);
        }
      }
    }
    return { dx, dy };
  }, options);
}

/** 旋转符号实例（默认 +90°，只作用于所选符号）。 */
export function rotateSymbolsCommand(sheetId, ids, deltaDeg = 90, options = {}) {
  const idSet = new Set(asIdList(ids));
  const delta = toNumber(deltaDeg, 90);
  return createEditCommand(options.label || '旋转符号', sheetId, (sheet) => {
    for (const symbol of asArray(sheet.symbols)) {
      if (!symbol || !idSet.has(symbol.id)) continue;
      symbol.rotation = normalizeDeg(round(toNumber(symbol.rotation) + delta, 6));
    }
  }, options);
}

/** 镜像符号：mirror 为布尔时设定，缺省时切换。 */
export function mirrorSymbolsCommand(sheetId, ids, mirror, options = {}) {
  const idSet = new Set(asIdList(ids));
  const explicit = typeof mirror === 'boolean' ? mirror : null;
  return createEditCommand(options.label || '镜像符号', sheetId, (sheet) => {
    for (const symbol of asArray(sheet.symbols)) {
      if (!symbol || !idSet.has(symbol.id)) continue;
      symbol.mirror = explicit === null ? symbol.mirror !== true : explicit;
    }
  }, options);
}

/** 添加符号实例。 */
export function addSymbolCommand(sheetId, instance, options = {}) {
  const symbol = createSymbolInstance(instance || {});
  return createEditCommand(options.label || '放置符号', sheetId, (sheet) => {
    sheet.symbols.push(symbol);
    return symbol.id;
  }, options);
}

/** 添加网络标签。 */
export function addLabelCommand(sheetId, label, options = {}) {
  const entity = createLabel(label || {});
  return createEditCommand(options.label || '添加标签', sheetId, (sheet) => {
    sheet.labels.push(entity);
    return entity.id;
  }, options);
}

/** 添加文本注释。 */
export function addTextCommand(sheetId, text, options = {}) {
  const entity = createText(text || {});
  return createEditCommand(options.label || '添加文本', sheetId, (sheet) => {
    sheet.texts.push(entity);
    return entity.id;
  }, options);
}

/** 添加结点；unique 缺省为 true，同位置已有结点时不再重复添加。 */
export function addJunctionCommand(sheetId, x, y, options = {}) {
  const junction = createJunction(x, y);
  return createEditCommand(options.label || '添加结点', sheetId, (sheet) => {
    if (options.unique !== false && findJunctionAt(sheet, junction, options.tolerance)) return null;
    sheet.junctions.push(junction);
    return junction.id;
  }, options);
}

/** 把字段写入符号实例；fields.* 写入自定义字段。 */
export function applySymbolField(symbol, key, value) {
  if (!symbol) return;
  const field = String(key || '');
  if (!symbol.fields || typeof symbol.fields !== 'object') symbol.fields = {};
  if (field === 'designator' || field === 'value') {
    symbol[field] = value === undefined || value === null ? '' : String(value);
    return;
  }
  if (field === 'footprintId') {
    symbol.footprintId = value === undefined || value === null || value === '' ? null : String(value);
    return;
  }
  if (field === 'fields') {
    symbol.fields = value && typeof value === 'object' ? clone(value) : {};
    return;
  }
  if (field.indexOf('fields.') === 0) {
    const name = field.slice('fields.'.length);
    if (name) symbol.fields[name] = value;
    return;
  }
  if (field === 'rotation') {
    symbol.rotation = normalizeDeg(toNumber(value));
    return;
  }
  if (field === 'mirror') {
    symbol.mirror = value === true;
    return;
  }
  if (field === 'x' || field === 'y') {
    symbol[field] = round(toNumber(value), 6);
    return;
  }
  if (field === 'symbolId') {
    symbol.symbolId = value === undefined || value === null ? '' : String(value);
    return;
  }
  if (field) symbol.fields[field] = value;
}

/** 修改符号字段（designator / value / footprintId / fields.* 等）。 */
export function setSymbolFieldCommand(sheetId, id, key, value, options = {}) {
  return createEditCommand(options.label || '修改符号字段', sheetId, (sheet) => {
    const symbol = asArray(sheet.symbols).find((item) => item && item.id === id);
    if (!symbol) return false;
    applySymbolField(symbol, key, value);
    return true;
  }, options);
}

const ENTITY_FIELD_KEYS = Object.freeze({
  symbols: ['symbolId', 'designator', 'value', 'footprintId', 'x', 'y', 'rotation', 'mirror'],
  wires: ['width'],
  junctions: ['x', 'y'],
  labels: ['x', 'y', 'rotation', 'text', 'kind'],
  texts: ['x', 'y', 'rotation', 'text', 'size'],
});

/** 把单个字段写入非符号实体；不在白名单内返回 false。 */
export function applyEntityField(entity, kind, key, value) {
  if (!entity) return false;
  if (kind === 'symbols') {
    applySymbolField(entity, key, value);
    return true;
  }
  const allowed = ENTITY_FIELD_KEYS[kind] || [];
  if (!allowed.includes(key)) return false;
  if (key === 'x' || key === 'y') {
    entity[key] = round(toNumber(value), 6);
  } else if (key === 'rotation') {
    entity.rotation = normalizeDeg(toNumber(value));
  } else if (key === 'width' || key === 'size') {
    entity[key] = Math.max(0.01, toNumber(value, entity[key]));
  } else if (key === 'mirror') {
    entity.mirror = value === true;
  } else if (key === 'kind') {
    entity.kind = value === 'global' ? 'global' : 'local';
  } else if (key === 'text') {
    entity.text = value === undefined || value === null ? '' : String(value);
  }
  return true;
}

/** 修改任意实体字段（供属性面板使用）。 */
export function setEntityFieldCommand(sheetId, id, key, value, options = {}) {
  return createEditCommand(options.label || '修改属性', sheetId, (sheet) => {
    const found = findEntityWithKind(sheet, id);
    if (!found) return false;
    return applyEntityField(found.entity, found.kind, key, value);
  }, options);
}

/** 批量修改实体字段，patch 为 { key: value }。 */
export function setEntityPropsCommand(sheetId, id, patch, options = {}) {
  const entries = patch && typeof patch === 'object' ? Object.entries(patch) : [];
  return createEditCommand(options.label || '修改属性', sheetId, (sheet) => {
    const found = findEntityWithKind(sheet, id);
    if (!found) return false;
    for (const [key, value] of entries) applyEntityField(found.entity, found.kind, key, value);
    return true;
  }, options);
}

/**
 * 创建命令门面：所有方法自动绑定 store 并通过 store.commands 执行。
 * @param {object} store 应用状态仓库
 * @returns {object} 命令 API
 */
export function createCommandApi(store) {
  if (!store || !store.commands) throw new TypeError('createCommandApi 需要 store');
  const run = (command) => executeCommand(store, command);
  return {
    store,
    execute: run,
    addWire: (sheetId, points, options) => run(addWireCommand(sheetId, points, options)),
    removeEntities: (sheetId, ids, options) => run(removeEntitiesCommand(sheetId, ids, options)),
    moveEntities: (sheetId, ids, delta, options) => run(moveEntitiesCommand(sheetId, ids, delta, options)),
    addSymbol: (sheetId, instance, options) => run(addSymbolCommand(sheetId, instance, options)),
    rotateSymbols: (sheetId, ids, deltaDeg, options) => run(rotateSymbolsCommand(sheetId, ids, deltaDeg, options)),
    mirrorSymbols: (sheetId, ids, mirror, options) => run(mirrorSymbolsCommand(sheetId, ids, mirror, options)),
    setSymbolField: (sheetId, id, key, value, options) => run(setSymbolFieldCommand(sheetId, id, key, value, options)),
    setEntityField: (sheetId, id, key, value, options) => run(setEntityFieldCommand(sheetId, id, key, value, options)),
    setEntityProps: (sheetId, id, patch, options) => run(setEntityPropsCommand(sheetId, id, patch, options)),
    addLabel: (sheetId, label, options) => run(addLabelCommand(sheetId, label, options)),
    addText: (sheetId, text, options) => run(addTextCommand(sheetId, text, options)),
    addJunction: (sheetId, x, y, options) => run(addJunctionCommand(sheetId, x, y, options)),
  };
}
