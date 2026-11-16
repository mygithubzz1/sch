// 命中测试：把世界坐标点/框转换为图纸实体，供选择、擦除与悬浮高亮使用。
import { dist, pointInRect, rectFromPoints, rectsIntersect, segmentDistance } from '../core/geometry.js';
import { findEntityWithKind, ENTITY_COLLECTIONS } from '../model/project.js';
import { symbolBBox, textPrimitiveBounds } from '../render/symbols.js';

export const HIT_TOLERANCE = 0.5;
const LABEL_SIZE = 1.27;
const TEXT_SIZE = 1.27;
const JUNCTION_RADIUS = 0.6;
const LABEL_OFFSET = 0.6;
const MISSING_SYMBOL_HALF = 2.54;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function expandBox(box, padding) {
  const pad = Math.max(0, toNumber(padding, 0));
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

function textBox(x, y, text, size, rotation = 0) {
  return textPrimitiveBounds({ x, y, text, size, rotation, align: 'left', baseline: 'middle' });
}

/** 实体的世界坐标包围盒。 */
export function entityBounds(sheet, kind, entity, options = {}) {
  if (!entity) return { x: 0, y: 0, w: 0, h: 0 };
  if (kind === 'symbols') {
    const resolveSymbol = typeof options.resolveSymbol === 'function' ? options.resolveSymbol : () => null;
    const def = resolveSymbol(entity.symbolId);
    if (def) return symbolBBox(def, entity);
    return {
      x: toNumber(entity.x) - MISSING_SYMBOL_HALF,
      y: toNumber(entity.y) - MISSING_SYMBOL_HALF,
      w: MISSING_SYMBOL_HALF * 2,
      h: MISSING_SYMBOL_HALF * 2,
    };
  }
  if (kind === 'wires') {
    const points = asArray(entity.points).filter(Boolean);
    if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, toNumber(point.x));
      minY = Math.min(minY, toNumber(point.y));
      maxX = Math.max(maxX, toNumber(point.x));
      maxY = Math.max(maxY, toNumber(point.y));
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (kind === 'junctions') {
    return {
      x: toNumber(entity.x) - JUNCTION_RADIUS,
      y: toNumber(entity.y) - JUNCTION_RADIUS,
      w: JUNCTION_RADIUS * 2,
      h: JUNCTION_RADIUS * 2,
    };
  }
  if (kind === 'labels') {
    const rotation = toNumber(entity.rotation);
    const box = textBox(
      toNumber(entity.x) + LABEL_OFFSET,
      toNumber(entity.y),
      entity.text,
      LABEL_SIZE,
      rotation,
    );
    const left = Math.min(box.x, toNumber(entity.x));
    return { x: left, y: box.y, w: box.x + box.w - left, h: box.h };
  }
  if (kind === 'texts') {
    return textBox(
      toNumber(entity.x),
      toNumber(entity.y),
      entity.text,
      Math.max(0.2, toNumber(entity.size, TEXT_SIZE)),
      toNumber(entity.rotation),
    );
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function hitEntity(sheet, kind, entity, point, tolerance, options) {
  if (!entity) return false;
  if (kind === 'wires') {
    const points = asArray(entity.points).filter(Boolean);
    for (let index = 1; index < points.length; index += 1) {
      if (segmentDistance(point, points[index - 1], points[index]) <= tolerance) return true;
    }
    return false;
  }
  if (kind === 'labels') {
    if (dist(point, entity) <= Math.max(tolerance, JUNCTION_RADIUS)) return true;
  }
  if (kind === 'junctions') {
    return dist(point, entity) <= Math.max(tolerance, JUNCTION_RADIUS);
  }
  const box = expandBox(entityBounds(sheet, kind, entity, options), tolerance);
  return pointInRect(point, box);
}

/**
 * 点命中测试，按「结点 > 标签 > 文本 > 符号 > 导线」优先级返回最具体的实体。
 * @returns {{id:string, kind:string, entity:object}|null}
 */
export function hitTest(sheet, point, options = {}) {
  if (!sheet || !point) return null;
  const tolerance = toNumber(options.tolerance, HIT_TOLERANCE);
  const order = ['junctions', 'labels', 'texts', 'symbols', 'wires'];
  for (const kind of order) {
    for (const entity of asArray(sheet[kind])) {
      if (!entity) continue;
      if (hitEntity(sheet, kind, entity, point, tolerance, options)) {
        return { id: entity.id, kind, entity };
      }
    }
  }
  return null;
}

/** 矩形框选：返回包围盒与框相交的实体 id 列表。 */
export function hitTestBox(sheet, rect, options = {}) {
  if (!sheet || !rect) return [];
  const box = rectFromPoints(
    { x: toNumber(rect.x), y: toNumber(rect.y) },
    { x: toNumber(rect.x) + toNumber(rect.w), y: toNumber(rect.y) + toNumber(rect.h) },
  );
  const ids = [];
  for (const kind of ENTITY_COLLECTIONS) {
    for (const entity of asArray(sheet[kind])) {
      if (!entity) continue;
      const bounds = entityBounds(sheet, kind, entity, options);
      if (rectsIntersect(box, bounds)) {
        if (typeof entity.id === 'string' && !ids.includes(entity.id)) ids.push(entity.id);
      }
    }
  }
  return ids;
}

/** 按 id 查实体并返回 { id, kind, entity }。 */
export function describeEntity(sheet, id) {
  const found = findEntityWithKind(sheet, id);
  if (!found) return null;
  return { id: found.entity.id, kind: found.kind, entity: found.entity };
}

/** 计算一组实体的联合包围盒（拖动预览用）。 */
export function boundsOfIds(sheet, ids, options = {}) {
  const boxes = [];
  for (const id of asArray(ids)) {
    const described = describeEntity(sheet, id);
    if (!described) continue;
    boxes.push(entityBounds(sheet, described.kind, described.entity, options));
  }
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
