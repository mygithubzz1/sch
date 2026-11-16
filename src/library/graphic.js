// 图形元素（Graphic / FGraphic）规范化与校验：符号库与封装库共用同一份数据形状。
import { asArray, isPlainObject, toNonNegative, toNumber, toPositive, toText } from './create-library.js';

export const GRAPHIC_TYPES = Object.freeze(['line', 'polyline', 'rect', 'circle', 'arc', 'text']);
export const FOOTPRINT_LAYERS = Object.freeze(['silkscreen', 'courtyard', 'assembly', 'fab']);
export const DEFAULT_STROKE_WIDTH = 0.254;
export const DEFAULT_TEXT_SIZE = 1.27;

/** 归一化单个点，非法返回 null。 */
export function normalizePoint(raw) {
  if (!isPlainObject(raw)) return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** 归一化点数组，数量不足返回 null。 */
export function normalizePoints(raw, minimum = 2) {
  const points = asArray(raw).map(normalizePoint).filter(Boolean);
  return points.length >= minimum ? points : null;
}

/** 填充语义：true 表示用主题的符号填充色填充，false/缺省表示不填充。 */
export function normalizeFill(raw) {
  return raw === true;
}

function normalizeLayer(raw, options) {
  const layers = Array.isArray(options.layers) ? options.layers : null;
  if (!layers) return null;
  if (layers.includes(raw)) return raw;
  const fallback = options.defaultLayer;
  return layers.includes(fallback) ? fallback : layers[0];
}

/**
 * 规范化一个图形元素；未知类型返回 null。
 * @param {*} raw 原始图形
 * @param {{layers?: string[], defaultLayer?: string}} [options] 封装图形需要图层约束
 * @returns {object|null} 规范化后的图形
 */
export function normalizeGraphic(raw, options = {}) {
  const source = isPlainObject(raw) ? raw : {};
  if (!GRAPHIC_TYPES.includes(source.type)) return null;
  const layer = normalizeLayer(source.layer, options);
  const filled = normalizeFill(source.fill);
  const base = layer ? { type: source.type, layer } : { type: source.type };

  if (source.type === 'line' || source.type === 'polyline') {
    const points = normalizePoints(source.points, 2);
    if (!points) return null;
    return { ...base, points, width: toPositive(source.width, DEFAULT_STROKE_WIDTH), fill: filled };
  }

  if (source.type === 'rect') {
    const result = {
      ...base,
      x: toNumber(source.x),
      y: toNumber(source.y),
      w: toNonNegative(source.w),
      h: toNonNegative(source.h),
      width: toPositive(source.width, DEFAULT_STROKE_WIDTH),
      fill: filled,
    };
    return result;
  }

  if (source.type === 'circle') {
    const radius = Number(source.r);
    if (!Number.isFinite(radius) || radius <= 0) return null;
    return {
      ...base,
      cx: toNumber(source.cx),
      cy: toNumber(source.cy),
      r: radius,
      width: toPositive(source.width, DEFAULT_STROKE_WIDTH),
      fill: filled,
    };
  }

  if (source.type === 'arc') {
    const radius = Number(source.r);
    if (!Number.isFinite(radius) || radius <= 0) return null;
    return {
      ...base,
      cx: toNumber(source.cx),
      cy: toNumber(source.cy),
      r: radius,
      start: toNumber(source.start),
      end: toNumber(source.end, 360),
      width: toPositive(source.width, DEFAULT_STROKE_WIDTH),
    };
  }

  // text
  return {
    ...base,
    x: toNumber(source.x),
    y: toNumber(source.y),
    text: toText(source.text, ''),
    size: toPositive(source.size, DEFAULT_TEXT_SIZE),
    rotation: toNumber(source.rotation),
  };
}

/** 返回图形元素的错误列表，空数组表示合法。 */
export function validateGraphic(graphic) {
  if (!isPlainObject(graphic)) return ['图形必须是对象'];
  if (!GRAPHIC_TYPES.includes(graphic.type)) return ['图形 type 非法：' + String(graphic.type)];
  const errors = [];

  if (graphic.type === 'line' || graphic.type === 'polyline') {
    if (!Array.isArray(graphic.points) || graphic.points.length < 2) {
      errors.push(graphic.type + ' 至少需要两个点');
    } else if (graphic.points.some((point) => normalizePoint(point) === null)) {
      errors.push(graphic.type + ' 的点坐标必须是有限数字');
    }
  } else if (graphic.type === 'rect') {
    for (const key of ['x', 'y', 'w', 'h']) {
      if (!Number.isFinite(Number(graphic[key]))) errors.push('rect.' + key + ' 必须是有限数字');
    }
    if (Number(graphic.w) < 0 || Number(graphic.h) < 0) errors.push('rect.w/h 不能为负');
  } else if (graphic.type === 'circle' || graphic.type === 'arc') {
    for (const key of ['cx', 'cy', 'r']) {
      if (!Number.isFinite(Number(graphic[key]))) errors.push(graphic.type + '.' + key + ' 必须是有限数字');
    }
    if (!(Number(graphic.r) > 0)) errors.push(graphic.type + '.r 必须为正数');
    if (graphic.type === 'arc') {
      for (const key of ['start', 'end']) {
        if (!Number.isFinite(Number(graphic[key]))) errors.push('arc.' + key + ' 必须是有限数字');
      }
    }
  } else if (graphic.type === 'text') {
    for (const key of ['x', 'y']) {
      if (!Number.isFinite(Number(graphic[key]))) errors.push('text.' + key + ' 必须是有限数字');
    }
    if (typeof graphic.text !== 'string' || graphic.text === '') errors.push('text.text 必须是非空字符串');
  }

  if (graphic.width !== undefined && !(Number(graphic.width) > 0)) errors.push('图形 width 必须为正数');
  if (graphic.fill !== undefined && typeof graphic.fill !== 'boolean') errors.push('图形 fill 必须是布尔值');
  return errors;
}
