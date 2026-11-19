// 符号库：SymbolDef 的规范化、校验与可检索容器（纯数据，禁止依赖 DOM）。
import {
  asArray,
  createLibrary,
  isPlainObject,
  toNonNegative,
  toNumber,
  toNumberText,
  toText,
} from './create-library.js';
import { normalizeGraphic, validateGraphic } from './graphic.js';

export const PIN_ORIENTATIONS = Object.freeze(['left', 'right', 'up', 'down']);
/** KiCad 9 引脚电气类型全集（§8.7 的 12 值词汇）。 */
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
/** 旧版非 KiCad 词汇：读取时迁移为 no_connect + noConnect，保留一个版本的可读别名。 */
export const LEGACY_PIN_ELECTRICAL_TYPES = Object.freeze(['not_connected']);
/** libpart 缺省字段的顺序（§8.5）。 */
export const DEFAULT_SYMBOL_FIELD_NAMES = Object.freeze([
  'Reference',
  'Value',
  'Footprint',
  'Datasheet',
  'Description',
]);
export const POWER_PIN_TYPES = Object.freeze(['power_in', 'power_out']);

/** 判断电气类型是否合法（含旧词汇别名）。 */
export function isPinElectricalType(value) {
  return PIN_ELECTRICAL_TYPES.includes(value) || LEGACY_PIN_ELECTRICAL_TYPES.includes(value);
}

/**
 * 规范化引脚：orientation 表示从连接端点 (x, y) 朝符号本体延伸的方向。
 * electricalType 使用 KiCad 词汇；旧值 not_connected 迁移为 no_connect + noConnect:true。
 * noConnect / free 是导出 pintype 修饰符的独立布尔标志。
 * @param {*} raw 原始引脚
 * @param {number} index 序号，用于生成缺省编号/id
 * @returns {object} 引脚对象
 */
export function normalizePin(raw, index = 0) {
  const source = isPlainObject(raw) ? raw : {};
  const number = toNumberText(source.number, String(index + 1));
  const rawType = typeof source.electricalType === 'string' ? source.electricalType : '';
  const legacyNoConnect = rawType === 'not_connected';
  const electricalType = legacyNoConnect
    ? 'no_connect'
    : PIN_ELECTRICAL_TYPES.includes(rawType)
      ? rawType
      : 'passive';
  return {
    id: toText(source.id, 'pin-' + number),
    name: toText(source.name, ''),
    number,
    x: toNumber(source.x),
    y: toNumber(source.y),
    length: toNonNegative(source.length, 0),
    orientation: PIN_ORIENTATIONS.includes(source.orientation) ? source.orientation : 'right',
    electricalType,
    noConnect: source.noConnect === true || legacyNoConnect,
    free: source.free === true,
  };
}

/** 规范化 libpart 字段数组：保序，value 缺失（自闭合）与空串严格区分。 */
export function normalizeSymbolFields(raw) {
  const entries = [];
  for (const item of asArray(raw)) {
    if (!isPlainObject(item)) continue;
    const entry = { name: toText(item.name, '') };
    if (typeof item.value === 'string') entry.value = item.value;
    entries.push(entry);
  }
  return entries;
}

/** 生成 §8.5 的 5 条缺省字段（Reference → Value → Footprint → Datasheet → Description）。 */
export function defaultSymbolFields(symbol) {
  const refPrefix = toText(symbol && symbol.refPrefix, '');
  const name = toText(symbol && symbol.name, '');
  const id = toText(symbol && symbol.id, '');
  const description = toText(symbol && symbol.description, '');
  return [
    { name: 'Reference', value: refPrefix },
    { name: 'Value', value: name !== '' ? name : id },
    { name: 'Footprint' },
    { name: 'Datasheet', value: '~' },
    { name: 'Description', value: description },
  ];
}

function normalizeStringList(raw) {
  return asArray(raw)
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * 规范化符号定义；缺少非空 id 时抛 TypeError。
 * @param {*} raw 原始符号
 * @returns {object} SymbolDef
 */
export function normalizeSymbolDef(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  if (id === '') throw new TypeError('符号定义缺少非空 id');
  const description = toText(source.description, '');
  const refPrefix = toText(source.refPrefix, 'U');
  const name = toText(source.name, id);
  return {
    id,
    name,
    refPrefix,
    description,
    docs: toText(source.docs, ''),
    footprints: normalizeStringList(source.footprints),
    keywords: toText(source.keywords, ''),
    fpFilters: normalizeStringList(source.fpFilters),
    fields:
      source.fields === undefined
        ? defaultSymbolFields({ id, name, refPrefix, description })
        : normalizeSymbolFields(source.fields),
    power: source.power === true,
    pins: asArray(source.pins).map(normalizePin),
    graphics: asArray(source.graphics).map((graphic) => normalizeGraphic(graphic)).filter(Boolean),
  };
}

/** 返回符号定义的错误列表，空数组表示合法。 */
export function validateSymbolDef(def) {
  const symbol = isPlainObject(def) ? def : {};
  const errors = [];
  if (typeof symbol.id !== 'string' || symbol.id.trim() === '') errors.push('symbol.id 必须是非空字符串');
  if (typeof symbol.name !== 'string' || symbol.name.trim() === '') errors.push('symbol.name 必须是非空字符串');
  if (typeof symbol.refPrefix !== 'string' || symbol.refPrefix.trim() === '') {
    errors.push('symbol.refPrefix 必须是非空字符串');
  }

  const pins = asArray(symbol.pins);
  if (pins.length === 0) errors.push('symbol.pins 至少需要一个引脚');
  const pinNumbers = new Set();
  const pinIds = new Set();
  pins.forEach((pin, index) => {
    const where = 'pins[' + index + ']';
    if (!isPlainObject(pin)) {
      errors.push(where + ' 必须是对象');
      return;
    }
    if (typeof pin.number !== 'string' || pin.number === '') {
      errors.push(where + '.number 必须是非空字符串');
    } else if (pinNumbers.has(pin.number)) {
      errors.push(where + '.number 重复：' + pin.number);
    } else {
      pinNumbers.add(pin.number);
    }
    if (typeof pin.id !== 'string' || pin.id === '') {
      errors.push(where + '.id 必须是非空字符串');
    } else if (pinIds.has(pin.id)) {
      errors.push(where + '.id 重复：' + pin.id);
    } else {
      pinIds.add(pin.id);
    }
    if (!Number.isFinite(Number(pin.x)) || !Number.isFinite(Number(pin.y))) {
      errors.push(where + ' 坐标必须是有限数字');
    }
    if (!Number.isFinite(Number(pin.length)) || Number(pin.length) < 0) {
      errors.push(where + '.length 必须是非负数字');
    }
    if (!PIN_ORIENTATIONS.includes(pin.orientation)) {
      errors.push(where + '.orientation 非法：' + String(pin.orientation));
    }
    if (!isPinElectricalType(pin.electricalType)) {
      errors.push(where + '.electricalType 非法：' + String(pin.electricalType));
    }
    for (const flag of ['noConnect', 'free']) {
      if (pin[flag] !== undefined && typeof pin[flag] !== 'boolean') {
        errors.push(where + '.' + flag + ' 必须是布尔值');
      }
    }
  });

  for (const key of ['docs', 'keywords']) {
    if (symbol[key] !== undefined && typeof symbol[key] !== 'string') {
      errors.push('symbol.' + key + ' 必须是字符串');
    }
  }
  for (const key of ['footprints', 'fpFilters']) {
    if (symbol[key] === undefined) continue;
    if (!Array.isArray(symbol[key])) {
      errors.push('symbol.' + key + ' 必须是字符串数组');
      continue;
    }
    symbol[key].forEach((item, index) => {
      if (typeof item !== 'string') errors.push('symbol.' + key + '[' + index + '] 必须是字符串');
    });
  }
  if (symbol.fields !== undefined) {
    if (!Array.isArray(symbol.fields)) {
      errors.push('symbol.fields 必须是数组');
    } else {
      symbol.fields.forEach((field, index) => {
        const where = 'fields[' + index + ']';
        if (!isPlainObject(field)) {
          errors.push(where + ' 必须是对象');
          return;
        }
        if (typeof field.name !== 'string' || field.name.trim() === '') {
          errors.push(where + '.name 必须是非空字符串');
        }
        if (field.value !== undefined && typeof field.value !== 'string') {
          errors.push(where + '.value 必须是字符串');
        }
      });
    }
  }

  const graphics = asArray(symbol.graphics);
  if (graphics.length === 0) errors.push('symbol.graphics 至少需要一个图形');
  graphics.forEach((graphic, index) => {
    for (const message of validateGraphic(graphic)) errors.push('graphics[' + index + '] ' + message);
  });

  if (symbol.power === true && !pins.some((pin) => isPlainObject(pin) && POWER_PIN_TYPES.includes(pin.electricalType))) {
    errors.push('power 符号至少需要一个 power_in/power_out 引脚');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 创建符号库。
 * @param {Array} [symbols] 初始符号定义
 * @returns {object} { add, addMany, remove, clear, get, has, list, search, toJSON, fromJSON, size, ids }
 */
export function createSymbolLibrary(symbols = []) {
  return createLibrary({
    items: symbols,
    normalize: normalizeSymbolDef,
    collection: 'symbols',
    searchFields: ['id', 'name', 'refPrefix', 'description'],
  });
}
