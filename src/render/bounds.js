// 内容包围盒：为视图适配、导出画布与选中高亮提供统一的世界坐标范围（纯函数）。
import { bboxOfPoints } from '../core/geometry.js';
import { measureTextWidth, symbolBBox, textPrimitiveBounds } from './symbols.js';

export const DEFAULT_SHEET_BOUNDS = Object.freeze({ x: 0, y: 0, w: 297, h: 210 });
export const DEFAULT_CONTENT_PADDING = 2.54;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function textBox(x, y, text, size, rotation = 0) {
  return textPrimitiveBounds({ x, y, text, size, rotation, align: 'left', baseline: 'middle' });
}

function pushBox(points, box) {
  points.push({ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h });
}

/** 合并两个包围盒，任一为空时返回另一个。 */
export function mergeBounds(a, b) {
  const points = [];
  if (a) pushBox(points, a);
  if (b) pushBox(points, b);
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  return bboxOfPoints(points);
}

/** 为包围盒加一圈留白。 */
export function expandBounds(box, padding = 0) {
  const pad = toNumber(padding, 0);
  const source = box || { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: toNumber(source.x, 0) - pad,
    y: toNumber(source.y, 0) - pad,
    w: Math.max(0, toNumber(source.w, 0) + pad * 2),
    h: Math.max(0, toNumber(source.h, 0) + pad * 2),
  };
}

/**
 * 图纸内容的世界包围盒：符号（含引脚与位号/值）、导线、结点、标签与文本。
 * 空图纸返回 A4 横向默认范围，保证 fitToContent 仍有合理视野。
 */
export function contentBBox(sheet, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!sheet || typeof sheet !== 'object') return { ...DEFAULT_SHEET_BOUNDS };
  const resolveSymbol = typeof opts.resolveSymbol === 'function' ? opts.resolveSymbol : () => null;
  const points = [];

  const symbols = Array.isArray(sheet.symbols) ? sheet.symbols : [];
  for (const instance of symbols) {
    if (!instance) continue;
    const def = resolveSymbol(instance.symbolId);
    if (def) {
      const box = symbolBBox(def, instance);
      pushBox(points, box);
      const labelWidth = Math.max(
        measureTextWidth(instance.designator, 1.27),
        measureTextWidth(instance.value, 1.27),
      );
      points.push(
        { x: box.x + box.w / 2 - labelWidth / 2, y: box.y - 1.27 },
        { x: box.x + box.w / 2 + labelWidth / 2, y: box.y + box.h + 1.27 },
      );
    } else {
      const x = toNumber(instance.x, 0);
      const y = toNumber(instance.y, 0);
      points.push({ x: x - 2.54, y: y - 2.54 }, { x: x + 2.54, y: y + 2.54 });
    }
  }

  for (const wire of Array.isArray(sheet.wires) ? sheet.wires : []) {
    if (!wire || !Array.isArray(wire.points)) continue;
    for (const point of wire.points) {
      if (!point) continue;
      points.push({ x: toNumber(point.x, 0), y: toNumber(point.y, 0) });
    }
  }

  for (const junction of Array.isArray(sheet.junctions) ? sheet.junctions : []) {
    if (!junction) continue;
    points.push(
      { x: toNumber(junction.x, 0) - 0.6, y: toNumber(junction.y, 0) - 0.6 },
      { x: toNumber(junction.x, 0) + 0.6, y: toNumber(junction.y, 0) + 0.6 },
    );
  }

  for (const label of Array.isArray(sheet.labels) ? sheet.labels : []) {
    if (!label) continue;
    pushBox(points, textBox(label.x, label.y, label.text, 1.27, toNumber(label.rotation, 0)));
  }

  for (const text of Array.isArray(sheet.texts) ? sheet.texts : []) {
    if (!text) continue;
    pushBox(points, textBox(text.x, text.y, text.text, toNumber(text.size, 1.27), toNumber(text.rotation, 0)));
  }

  if (!points.length) return { ...DEFAULT_SHEET_BOUNDS };
  const box = bboxOfPoints(points);
  return expandBounds(box, toNumber(opts.padding, DEFAULT_CONTENT_PADDING));
}
