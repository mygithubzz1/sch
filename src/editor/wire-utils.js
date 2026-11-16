// 导线几何与接点判定：点是否落在导线上、T 形接点自动生成、孤立 junction 清理。
import { dist, round, segmentDistance } from '../core/geometry.js';
import { collectPinAnchors, collectLabelAnchors } from './snapping.js';

export const CONNECT_TOLERANCE = 1e-3;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointsOf(wire) {
  if (!wire || !Array.isArray(wire.points)) return [];
  return wire.points.filter(
    (point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)),
  );
}

function pointKey(point) {
  return round(toNumber(point.x), 6) + ',' + round(toNumber(point.y), 6);
}

/** 两点在容差内是否重合。 */
export function pointsEqual(a, b, tolerance = CONNECT_TOLERANCE) {
  if (!a || !b) return false;
  return dist(a, b) <= tolerance;
}

/** 点是否在线段上（含端点）。 */
export function pointOnSegment(point, a, b, tolerance = CONNECT_TOLERANCE) {
  if (!point || !a || !b) return false;
  return segmentDistance(point, a, b) <= tolerance;
}

/** 点是否严格落在线段内部（排除两端容差范围）。 */
export function pointInsideSegment(point, a, b, tolerance = CONNECT_TOLERANCE) {
  if (!pointOnSegment(point, a, b, tolerance)) return false;
  return !pointsEqual(point, a, tolerance) && !pointsEqual(point, b, tolerance);
}

/** 点是否落在导线（折线）上。 */
export function pointOnWire(point, wire, tolerance = CONNECT_TOLERANCE) {
  const points = pointsOf(wire);
  for (let index = 1; index < points.length; index += 1) {
    if (pointOnSegment(point, points[index - 1], points[index], tolerance)) return true;
  }
  return false;
}

/** 点是否落在导线内部（不属于任何一个折点）。 */
export function pointInsideWire(point, wire, tolerance = CONNECT_TOLERANCE) {
  const points = pointsOf(wire);
  for (let index = 1; index < points.length; index += 1) {
    if (pointInsideSegment(point, points[index - 1], points[index], tolerance)) return true;
  }
  return false;
}

/** 图纸中已经存在同位置 junction 时返回该 junction，否则 null。 */
export function findJunctionAt(sheet, point, tolerance = CONNECT_TOLERANCE) {
  const junctions = sheet && Array.isArray(sheet.junctions) ? sheet.junctions : [];
  return junctions.find((junction) => pointsEqual(junction, point, tolerance)) || null;
}

function pushUnique(list, point) {
  const key = pointKey(point);
  if (list.some((item) => pointKey(item) === key)) return;
  list.push({ x: round(toNumber(point.x), 6), y: round(toNumber(point.y), 6) });
}

/**
 * 计算新导线需要补的 junction：导线端点落在其它导线内部（T 形），
 * 或接点处至少汇聚 3 条导线分支，或两条导线端点落在同一个引脚/标签上。
 * @param {object} project 工程数据
 * @param {object} sheet 图纸（应已包含新导线）
 * @param {object} wire 新导线
 * @param {object} [options] tolerance / resolveSymbol / pinAnchors
 * @returns {{x:number,y:number}[]} 需要创建的 junction 坐标
 */
export function findWireJunctions(project, sheet, wire, options = {}) {
  const tolerance = toNumber(options.tolerance, CONNECT_TOLERANCE);
  const target = wire || {};
  const targetId = typeof target.id === 'string' ? target.id : '';
  const wires = sheet && Array.isArray(sheet.wires) ? sheet.wires.filter(Boolean) : [];
  const others = wires.filter((item) => item !== target && !(targetId && item.id === targetId));
  const vertices = pointsOf(target);
  const pins = options.pinAnchors || collectPinAnchors(project, sheet, options);
  const labels = options.labelAnchors || collectLabelAnchors(sheet);
  const result = [];

  const touchingPinOrLabel = (point) =>
    pins.some((anchor) => pointsEqual(anchor, point, tolerance)) ||
    labels.some((anchor) => pointsEqual(anchor, point, tolerance));

  for (const vertex of vertices) {
    let branchEnds = 0;
    for (const candidate of wires) {
      const points = pointsOf(candidate);
      for (let index = 1; index < points.length; index += 1) {
        if (pointsEqual(points[index - 1], vertex, tolerance)) branchEnds += 1;
        if (pointsEqual(points[index], vertex, tolerance)) branchEnds += 1;
      }
    }
    const interiorTouch = others.some((candidate) => pointInsideWire(vertex, candidate, tolerance));
    if (interiorTouch || branchEnds >= 3 || (branchEnds >= 2 && touchingPinOrLabel(vertex))) {
      pushUnique(result, vertex);
    }
  }

  // 已有导线的端点落在新导线内部：同样构成 T 形接点。
  for (const candidate of others) {
    for (const vertex of pointsOf(candidate)) {
      if (pointInsideWire(vertex, target, tolerance)) pushUnique(result, vertex);
    }
  }

  return result;
}

/** 统计某个位置接触的导体数量（每条导线计 1，每个引脚/标签计 1）。 */
export function countConductorsAt(sheet, point, project, options = {}) {
  const tolerance = toNumber(options.tolerance, CONNECT_TOLERANCE);
  const wires = sheet && Array.isArray(sheet.wires) ? sheet.wires : [];
  let count = 0;
  for (const wire of wires) {
    if (pointOnWire(point, wire, tolerance)) count += 1;
  }
  const pins = options.pinAnchors || collectPinAnchors(project, sheet, options);
  const labels = options.labelAnchors || collectLabelAnchors(sheet);
  for (const anchor of pins) if (pointsEqual(anchor, point, tolerance)) count += 1;
  for (const anchor of labels) if (pointsEqual(anchor, point, tolerance)) count += 1;
  return count;
}

/**
 * 清理孤立 junction：只保留至少连接 2 个导体的结点（原地修改 sheet）。
 * @returns {number} 被移除的 junction 数量
 */
export function pruneJunctions(sheet, project, options = {}) {
  if (!sheet || !Array.isArray(sheet.junctions)) return 0;
  const tolerance = toNumber(options.tolerance, CONNECT_TOLERANCE);
  const pinAnchors = options.pinAnchors || collectPinAnchors(project, sheet, options);
  const labelAnchors = options.labelAnchors || collectLabelAnchors(sheet);
  const keep = sheet.junctions.filter(
    (junction) => countConductorsAt(sheet, junction, project, { ...options, tolerance, pinAnchors, labelAnchors }) >= 2,
  );
  const removed = sheet.junctions.length - keep.length;
  sheet.junctions = keep;
  return removed;
}

/** 依次返回导线线段数组，便于命中与接点计算。 */
export function wireSegments(wire) {
  const points = pointsOf(wire);
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    segments.push({ a: points[index - 1], b: points[index] });
  }
  return segments;
}
