// 封装库：FootprintDef 的规范化、校验与可检索容器（纯数据，禁止依赖 DOM）。
import {
  asArray,
  createLibrary,
  isPlainObject,
  toNonNegative,
  toNumber,
  toNumberText,
  toPositive,
  toText,
} from './create-library.js';
import { FOOTPRINT_LAYERS, normalizeGraphic, validateGraphic } from './graphic.js';

export const PAD_SHAPES = Object.freeze(['rect', 'roundrect', 'circle', 'oval']);
export const PAD_LAYERS = Object.freeze(['top', 'bottom', 'tht']);

/**
 * 规范化焊盘。
 * @param {*} raw 原始焊盘
 * @param {number} index 序号，用于生成缺省编号/id
 * @returns {object} Pad
 */
export function normalizePad(raw, index = 0) {
  const source = isPlainObject(raw) ? raw : {};
  const number = toNumberText(source.number, String(index + 1));
  return {
    id: toText(source.id, 'pad-' + number),
    number,
    x: toNumber(source.x),
    y: toNumber(source.y),
    w: toPositive(source.w, 1),
    h: toPositive(source.h, 1),
    shape: PAD_SHAPES.includes(source.shape) ? source.shape : 'rect',
    rotation: toNumber(source.rotation),
    layer: PAD_LAYERS.includes(source.layer) ? source.layer : 'top',
    drill: toNonNegative(source.drill, 0),
  };
}

/**
 * 规范化封装定义；缺少非空 id 时抛 TypeError。
 * @param {*} raw 原始封装
 * @returns {object} FootprintDef
 */
export function normalizeFootprintDef(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  if (id === '') throw new TypeError('封装定义缺少非空 id');
  return {
    id,
    name: toText(source.name, id),
    description: toText(source.description, ''),
    pads: asArray(source.pads).map(normalizePad),
    graphics: asArray(source.graphics)
      .map((graphic) => normalizeGraphic(graphic, { layers: FOOTPRINT_LAYERS, defaultLayer: 'silkscreen' }))
      .filter(Boolean),
  };
}

/** 返回封装定义的错误列表，空数组表示合法。 */
export function validateFootprintDef(def) {
  const footprint = isPlainObject(def) ? def : {};
  const errors = [];
  if (typeof footprint.id !== 'string' || footprint.id.trim() === '') errors.push('footprint.id 必须是非空字符串');
  if (typeof footprint.name !== 'string' || footprint.name.trim() === '') errors.push('footprint.name 必须是非空字符串');

  const pads = asArray(footprint.pads);
  if (pads.length === 0) errors.push('footprint.pads 至少需要一个焊盘');
  const padNumbers = new Set();
  const padIds = new Set();
  pads.forEach((pad, index) => {
    const where = 'pads[' + index + ']';
    if (!isPlainObject(pad)) {
      errors.push(where + ' 必须是对象');
      return;
    }
    if (typeof pad.number !== 'string' || pad.number === '') {
      errors.push(where + '.number 必须是非空字符串');
    } else if (padNumbers.has(pad.number)) {
      errors.push(where + '.number 重复：' + pad.number);
    } else {
      padNumbers.add(pad.number);
    }
    if (typeof pad.id !== 'string' || pad.id === '') {
      errors.push(where + '.id 必须是非空字符串');
    } else if (padIds.has(pad.id)) {
      errors.push(where + '.id 重复：' + pad.id);
    } else {
      padIds.add(pad.id);
    }
    if (!Number.isFinite(Number(pad.x)) || !Number.isFinite(Number(pad.y))) {
      errors.push(where + ' 坐标必须是有限数字');
    }
    if (!(Number(pad.w) > 0) || !(Number(pad.h) > 0)) errors.push(where + ' 尺寸必须为正数');
    if (!PAD_SHAPES.includes(pad.shape)) errors.push(where + '.shape 非法：' + String(pad.shape));
    if (!PAD_LAYERS.includes(pad.layer)) errors.push(where + '.layer 非法：' + String(pad.layer));
    if (!(Number(pad.drill) >= 0)) errors.push(where + '.drill 必须是非负数字');
    if (pad.layer === 'tht' && !(Number(pad.drill) > 0)) errors.push(where + ' 通孔焊盘需要正数 drill');
  });

  asArray(footprint.graphics).forEach((graphic, index) => {
    if (!isPlainObject(graphic) || !FOOTPRINT_LAYERS.includes(graphic.layer)) {
      errors.push('graphics[' + index + '].layer 非法：' + String(isPlainObject(graphic) ? graphic.layer : graphic));
    }
    for (const message of validateGraphic(graphic)) errors.push('graphics[' + index + '] ' + message);
  });
  return { ok: errors.length === 0, errors };
}

/**
 * 创建封装库（与符号库同构）。
 * @param {Array} [footprints] 初始封装定义
 * @returns {object} { add, addMany, remove, clear, get, has, list, search, toJSON, fromJSON, size, ids }
 */
export function createFootprintLibrary(footprints = []) {
  return createLibrary({
    items: footprints,
    normalize: normalizeFootprintDef,
    collection: 'footprints',
    searchFields: ['id', 'name', 'description'],
  });
}
