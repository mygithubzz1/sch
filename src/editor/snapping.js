// 吸附纯函数：收集引脚/导线/junction/标签锚点，查找最近吸附点并按栅格取整。
import { dist, round, snapV, transformPoint } from '../core/geometry.js';
import { createSymbolResolver } from './symbol-resolver.js';

export const DEFAULT_GRID = 2.54;
export const SNAP_TOLERANCE_PX = 10;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointKey(point) {
  return round(toNumber(point.x), 6) + ',' + round(toNumber(point.y), 6);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolverFor(project, options) {
  if (typeof options.resolveSymbol === 'function') return options.resolveSymbol;
  if (typeof options.symbolResolver === 'function') return options.symbolResolver;
  return createSymbolResolver(project, options);
}

function excludeSet(options) {
  const ids = options.excludeIds;
  if (ids instanceof Set) return ids;
  if (Array.isArray(ids)) return new Set(ids);
  return new Set();
}

/**
 * 收集所有符号实例的引脚连接端点（世界坐标）。
 * @param {object} project 工程数据
 * @param {object} sheet 图纸
 * @param {object} [options] resolveSymbol / excludeIds / tolerance
 * @returns {{x:number,y:number}[]} 去重后的锚点
 */
export function collectPinAnchors(project, sheet, options = {}) {
  if (!sheet) return [];
  const resolveSymbol = resolverFor(project, options);
  const excluded = excludeSet(options);
  const anchors = [];
  for (const instance of asArray(sheet.symbols)) {
    if (!instance || excluded.has(instance.id)) continue;
    const def = instance.symbolId ? resolveSymbol(instance.symbolId) : null;
    if (!def || !Array.isArray(def.pins)) continue;
    for (const pin of def.pins) {
      if (!pin) continue;
      const point = transformPoint(
        { x: toNumber(pin.x), y: toNumber(pin.y) },
        {
          x: toNumber(instance.x),
          y: toNumber(instance.y),
          rotation: toNumber(instance.rotation),
          mirror: instance.mirror === true,
        },
      );
      anchors.push(point);
    }
  }
  return dedupePoints(anchors);
}

/** 收集导线端点与折点。 */
export function collectWireAnchors(sheet, options = {}) {
  if (!sheet) return [];
  const excluded = excludeSet(options);
  const anchors = [];
  for (const wire of asArray(sheet.wires)) {
    if (!wire || excluded.has(wire.id)) continue;
    for (const point of asArray(wire.points)) {
      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) continue;
      anchors.push({ x: toNumber(point.x), y: toNumber(point.y) });
    }
  }
  return dedupePoints(anchors);
}

/** 收集 junction 锚点。 */
export function collectJunctionAnchors(sheet, options = {}) {
  if (!sheet) return [];
  const excluded = excludeSet(options);
  const anchors = [];
  for (const junction of asArray(sheet.junctions)) {
    if (!junction || excluded.has(junction.id)) continue;
    anchors.push({ x: toNumber(junction.x), y: toNumber(junction.y) });
  }
  return dedupePoints(anchors);
}

/** 收集标签锚点。 */
export function collectLabelAnchors(sheet, options = {}) {
  if (!sheet) return [];
  const excluded = excludeSet(options);
  const anchors = [];
  for (const label of asArray(sheet.labels)) {
    if (!label || excluded.has(label.id)) continue;
    anchors.push({ x: toNumber(label.x), y: toNumber(label.y) });
  }
  return dedupePoints(anchors);
}

/**
 * 收集全部可吸附锚点：引脚端点、导线端点与折点、junction、标签锚点。
 * @param {object} project 工程数据
 * @param {object} sheet 图纸
 * @param {object} [options] resolveSymbol / excludeIds
 * @returns {{x:number,y:number}[]} 去重后的锚点
 */
export function collectAnchors(project, sheet, options = {}) {
  if (!sheet) return [];
  return dedupePoints([
    ...collectPinAnchors(project, sheet, options),
    ...collectWireAnchors(sheet, options),
    ...collectJunctionAnchors(sheet, options),
    ...collectLabelAnchors(sheet, options),
  ]);
}

/**
 * 在锚点中查找距离 p 最近且不超过 worldTol 的点。
 * @returns {{x:number,y:number}|null} 命中的锚点（副本），未命中返回 null
 */
export function findSnapPoint(anchors, p, worldTol) {
  if (!Array.isArray(anchors) || anchors.length === 0) return null;
  if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) return null;
  const tolerance = toNumber(worldTol, 0);
  if (tolerance < 0) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const anchor of anchors) {
    if (!anchor || !Number.isFinite(Number(anchor.x)) || !Number.isFinite(Number(anchor.y))) continue;
    const distance = dist(p, anchor);
    if (distance <= tolerance && distance < bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }
  return best ? { x: Number(best.x), y: Number(best.y) } : null;
}

/** 按栅格取整；grid 非正时原样返回（仍转为数字）。 */
export function snapToGrid(p, grid = DEFAULT_GRID) {
  const source = p && typeof p === 'object' ? p : {};
  const step = Number(grid);
  if (!Number.isFinite(step) || step <= 0) {
    return { x: toNumber(source.x), y: toNumber(source.y) };
  }
  return { x: snapV(source.x, step), y: snapV(source.y, step) };
}

/** 按容差去重并规范化坐标。 */
export function dedupePoints(points, tolerance = 1e-6) {
  const seen = new Set();
  const result = [];
  for (const point of asArray(points)) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) continue;
    const normalized = { x: round(Number(point.x), 6), y: round(Number(point.y), 6) };
    const key = pointKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

/** 组合吸附：优先命中锚点，否则落到栅格。 */
export function resolveSnapPoint(p, anchors, grid = DEFAULT_GRID, worldTol = 0) {
  const hit = findSnapPoint(anchors, p, worldTol);
  if (hit) return hit;
  return snapToGrid(p, grid);
}
