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
export const PIN_ELECTRICAL_TYPES = Object.freeze([
  'input',
  'output',
  'bidirectional',
  'passive',
  'power_in',
  'power_out',
  'open_collector',
  'not_connected',
]);
export const POWER_PIN_TYPES = Object.freeze(['power_in', 'power_out']);

/**
 * 规范化引脚：orientation 表示从连接端点 (x, y) 朝符号本体延伸的方向。
 * @param {*} raw 原始引脚
 * @param {number} index 序号，用于生成缺省编号/id
 * @returns {object} 引脚对象
 */
export function normalizePin(raw, index = 0) {
  const source = isPlainObject(raw) ? raw : {};
  const number = toNumberText(source.number, String(index + 1));
  return {
    id: toText(source.id, 'pin-' + number),
    name: toText(source.name, ''),
    number,
    x: toNumber(source.x),
    y: toNumber(source.y),
    length: toNonNegative(source.length, 0),
    orientation: PIN_ORIENTATIONS.includes(source.orientation) ? source.orientation : 'right',
    electricalType: PIN_ELECTRICAL_TYPES.includes(source.electricalType) ? source.electricalType : 'passive',
  };
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
  return {
    id,
    name: toText(source.name, id),
    refPrefix: toText(source.refPrefix, 'U'),
    description: toText(source.description, ''),
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
    if (!PIN_ELECTRICAL_TYPES.includes(pin.electricalType)) {
      errors.push(where + '.electricalType 非法：' + String(pin.electricalType));
    }
  });

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
