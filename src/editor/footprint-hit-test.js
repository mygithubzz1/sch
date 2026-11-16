// 封装命中测试：焊盘（考虑旋转）与丝印/courtyard/assembly/fab 图形的点选与框选。
import { dist, normalizeDeg, pointInRect, rectFromPoints, rectsIntersect, rotatePoint, segmentDistance } from '../core/geometry.js';
import { textPrimitiveBounds } from '../render/symbols.js';

export const FOOTPRINT_HIT_TOLERANCE = 0.3;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function expand(box, padding) {
  const pad = Math.max(0, toNumber(padding));
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

/** 焊盘（含旋转）的世界包围盒。 */
export function padBounds(pad) {
  if (!pad) return { x: 0, y: 0, w: 0, h: 0 };
  const w = Math.max(0.01, toNumber(pad.w, 1));
  const h = Math.max(0.01, toNumber(pad.h, 1));
  const center = { x: toNumber(pad.x), y: toNumber(pad.y) };
  const corners = [
    { x: center.x - w / 2, y: center.y - h / 2 },
    { x: center.x + w / 2, y: center.y - h / 2 },
    { x: center.x + w / 2, y: center.y + h / 2 },
    { x: center.x - w / 2, y: center.y + h / 2 },
  ].map((point) => rotatePoint(point, toNumber(pad.rotation), center));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of corners) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function pointInPad(pad, point, tolerance) {
  const center = { x: toNumber(pad.x), y: toNumber(pad.y) };
  const local = rotatePoint(point, -toNumber(pad.rotation), center);
  const halfW = Math.max(0.01, toNumber(pad.w, 1)) / 2 + tolerance;
  const halfH = Math.max(0.01, toNumber(pad.h, 1)) / 2 + tolerance;
  const dx = local.x - center.x;
  const dy = local.y - center.y;
  if (pad.shape === 'circle') {
    const radius = Math.min(halfW, halfH);
    return Math.hypot(dx, dy) <= radius;
  }
  if (pad.shape === 'oval') {
    return (dx * dx) / (halfW * halfW) + (dy * dy) / (halfH * halfH) <= 1;
  }
  return Math.abs(dx) <= halfW && Math.abs(dy) <= halfH;
}

/** 点是否命中焊盘（从后往前，后绘制者优先）。 */
export function hitTestPad(footprint, point, options = {}) {
  const tolerance = toNumber(options.tolerance, FOOTPRINT_HIT_TOLERANCE);
  const pads = asArray(footprint && footprint.pads);
  for (let index = pads.length - 1; index >= 0; index -= 1) {
    const pad = pads[index];
    if (!pad) continue;
    if (pointInPad(pad, point, tolerance)) return { id: pad.id, kind: 'pad', entity: pad };
  }
  return null;
}

/** 图形（线/矩形/圆/弧/文字）的世界包围盒。 */
export function graphicBounds(graphic) {
  if (!graphic) return { x: 0, y: 0, w: 0, h: 0 };
  if (graphic.type === 'line' || graphic.type === 'polyline') {
    const points = asArray(graphic.points);
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
  if (graphic.type === 'rect') {
    const x = toNumber(graphic.x);
    const y = toNumber(graphic.y);
    const w = toNumber(graphic.w);
    const h = toNumber(graphic.h);
    return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
  }
  if (graphic.type === 'circle' || graphic.type === 'arc') {
    const r = Math.max(0, toNumber(graphic.r));
    return { x: toNumber(graphic.cx) - r, y: toNumber(graphic.cy) - r, w: r * 2, h: r * 2 };
  }
  if (graphic.type === 'text') {
    return textPrimitiveBounds({
      x: toNumber(graphic.x),
      y: toNumber(graphic.y),
      text: graphic.text,
      size: toNumber(graphic.size, 1.27),
      rotation: toNumber(graphic.rotation),
      align: 'center',
      baseline: 'middle',
    });
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function angleWithin(angle, start, end) {
  const a = normalizeDeg(angle);
  const s = normalizeDeg(start);
  const e = normalizeDeg(end);
  if (s <= e) return a >= s && a <= e;
  return a >= s || a <= e;
}

function pointNearGraphic(graphic, point, tolerance) {
  if (!graphic) return false;
  if (graphic.type === 'line' || graphic.type === 'polyline') {
    const points = asArray(graphic.points);
    for (let index = 1; index < points.length; index += 1) {
      if (segmentDistance(point, points[index - 1], points[index]) <= tolerance) return true;
    }
    return false;
  }
  if (graphic.type === 'rect') {
    const x = toNumber(graphic.x);
    const y = toNumber(graphic.y);
    const w = toNumber(graphic.w);
    const h = toNumber(graphic.h);
    const corners = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    for (let index = 0; index < 4; index += 1) {
      if (segmentDistance(point, corners[index], corners[(index + 1) % 4]) <= tolerance) return true;
    }
    return Boolean(graphic.fill) && pointInRect(point, rectFromPoints(corners[0], corners[2]));
  }
  if (graphic.type === 'circle') {
    const center = { x: toNumber(graphic.cx), y: toNumber(graphic.cy) };
    const r = Math.max(0, toNumber(graphic.r));
    const distance = dist(point, center);
    if (graphic.fill && distance <= r + tolerance) return true;
    return Math.abs(distance - r) <= tolerance;
  }
  if (graphic.type === 'arc') {
    const center = { x: toNumber(graphic.cx), y: toNumber(graphic.cy) };
    const distance = dist(point, center);
    const r = Math.max(0, toNumber(graphic.r));
    if (Math.abs(distance - r) > tolerance) return false;
    const angle = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
    return angleWithin(angle, toNumber(graphic.start), toNumber(graphic.end, 360));
  }
  if (graphic.type === 'text') {
    return pointInRect(point, expand(graphicBounds(graphic), tolerance));
  }
  return false;
}

/** 点是否命中封装图形（从后往前）。 */
export function hitTestGraphic(footprint, point, options = {}) {
  const tolerance = toNumber(options.tolerance, FOOTPRINT_HIT_TOLERANCE);
  const graphics = asArray(footprint && footprint.graphics);
  for (let index = graphics.length - 1; index >= 0; index -= 1) {
    const graphic = graphics[index];
    if (!graphic) continue;
    if (pointNearGraphic(graphic, point, tolerance)) return { id: graphic.id, kind: 'graphic', entity: graphic };
  }
  return null;
}

/** 点命中封装：焊盘优先于图形。 */
export function hitTestFootprint(footprint, point, options = {}) {
  return hitTestPad(footprint, point, options) || hitTestGraphic(footprint, point, options);
}

/** 矩形框选：返回与框相交的焊盘/图形 id。 */
export function hitTestFootprintBox(footprint, rect) {
  if (!footprint || !rect) return [];
  const box = rectFromPoints(
    { x: toNumber(rect.x), y: toNumber(rect.y) },
    { x: toNumber(rect.x) + toNumber(rect.w), y: toNumber(rect.y) + toNumber(rect.h) },
  );
  const ids = [];
  for (const pad of asArray(footprint.pads)) {
    if (pad && pad.id && rectsIntersect(box, padBounds(pad))) ids.push(pad.id);
  }
  for (const graphic of asArray(footprint.graphics)) {
    if (graphic && graphic.id && rectsIntersect(box, graphicBounds(graphic))) ids.push(graphic.id);
  }
  return ids;
}

/** 按 id 查焊盘或图形。 */
export function describeFootprintEntity(footprint, id) {
  if (!footprint || typeof id !== 'string' || id === '') return null;
  const pad = asArray(footprint.pads).find((item) => item && item.id === id);
  if (pad) return { id, kind: 'pad', entity: pad };
  const graphic = asArray(footprint.graphics).find((item) => item && item.id === id);
  if (graphic) return { id, kind: 'graphic', entity: graphic };
  return null;
}

/** 一组焊盘/图形的联合包围盒。 */
export function footprintBoundsOfIds(footprint, ids) {
  const boxes = [];
  for (const id of asArray(ids)) {
    const described = describeFootprintEntity(footprint, id);
    if (!described) continue;
    boxes.push(described.kind === 'pad' ? padBounds(described.entity) : graphicBounds(described.entity));
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
