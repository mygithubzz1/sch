import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  createView,
  fitView,
  normalizeView,
  panView,
  screenToWorld,
  viewBounds,
  worldToScreen,
  zoomAt,
} from '../../src/render/view.js';

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, 'expected ' + actual + ' ~= ' + expected);
};

test('createView 使用默认值并限制缩放区间', () => {
  const view = createView();
  assert.equal(view.offsetX, 0);
  assert.equal(view.offsetY, 0);
  assert.equal(view.scale, 4);
  assert.equal(createView({ scale: 1000 }).scale, MAX_SCALE);
  assert.equal(createView({ scale: 0.0001 }).scale, MIN_SCALE);
  assert.equal(clampScale(Number.NaN), 4);
});

test('worldToScreen 按 mm 与偏移线性映射', () => {
  const view = { offsetX: 40, offsetY: -10, scale: 8 };
  assert.deepEqual(worldToScreen(view, { x: 0, y: 0 }), { x: 40, y: -10 });
  assert.deepEqual(worldToScreen(view, { x: 10, y: 2.5 }), { x: 120, y: 10 });
});

test('screenToWorld 与 worldToScreen 严格互逆', () => {
  const view = { offsetX: 37.5, offsetY: -19.25, scale: 6.25 };
  const points = [
    { x: 0, y: 0 },
    { x: 12.7, y: -5.08 },
    { x: -123.45, y: 67.89 },
  ];
  for (const point of points) {
    const roundTrip = screenToWorld(view, worldToScreen(view, point));
    closeTo(roundTrip.x, point.x, 1e-9);
    closeTo(roundTrip.y, point.y, 1e-9);
  }
});

test('zoomAt 保持光标下的世界坐标不动', () => {
  const view = { offsetX: 100, offsetY: 60, scale: 4 };
  const cursor = { x: 320, y: 210 };
  const before = screenToWorld(view, cursor);
  const zoomed = zoomAt(view, cursor, 1.75);
  const after = screenToWorld(zoomed, cursor);
  closeTo(zoomed.scale, 7, 1e-9);
  closeTo(after.x, before.x, 1e-9);
  closeTo(after.y, before.y, 1e-9);
});

test('zoomAt 遵守 0.05~20 的缩放边界', () => {
  const view = createView({ scale: 1 });
  assert.equal(zoomAt(view, { x: 0, y: 0 }, 1000).scale, MAX_SCALE);
  assert.equal(zoomAt(view, { x: 0, y: 0 }, 0.00001).scale, MIN_SCALE);
  const invalid = zoomAt(view, { x: 0, y: 0 }, Number.NaN);
  assert.equal(invalid.scale, 1);
  assert.equal(view.scale, 1);
});

test('fitView 让包围盒落在留白之内并居中', () => {
  const box = { x: -50, y: -30, w: 100, h: 60 };
  const view = fitView(box, 800, 600, 40);
  closeTo(view.scale, Math.min(720 / 100, 520 / 60), 1e-9);
  closeTo(worldToScreen(view, { x: 0, y: 0 }).x, 400, 1e-9);
  closeTo(worldToScreen(view, { x: 0, y: 0 }).y, 300, 1e-9);
  const topLeft = worldToScreen(view, { x: box.x, y: box.y });
  const bottomRight = worldToScreen(view, { x: box.x + box.w, y: box.y + box.h });
  assert.ok(topLeft.x >= 39.999 && topLeft.y >= 39.999);
  assert.ok(bottomRight.x <= 760.001 && bottomRight.y <= 560.001);
});

test('fitView 处理退化包围盒与非法视口', () => {
  const view = fitView({ x: 5, y: 7, w: 0, h: 0 }, 800, 600, 40);
  assert.ok(view.scale > 0);
  closeTo(worldToScreen(view, { x: 5, y: 7 }).x, 400, 1e-9);
  closeTo(worldToScreen(view, { x: 5, y: 7 }).y, 300, 1e-9);
  const fallback = fitView(null, 0, 0, 40);
  assert.ok(Number.isFinite(fallback.offsetX));
  assert.ok(Number.isFinite(fallback.offsetY));
  assert.ok(fallback.scale >= MIN_SCALE && fallback.scale <= MAX_SCALE);
});

test('panView 只改变偏移，不改变缩放', () => {
  const view = { offsetX: 10, offsetY: 20, scale: 3 };
  const moved = panView(view, -15, 5);
  assert.deepEqual(moved, { offsetX: -5, offsetY: 25, scale: 3 });
  assert.deepEqual(view, { offsetX: 10, offsetY: 20, scale: 3 });
});

test('viewBounds 返回视口覆盖的世界矩形', () => {
  const view = { offsetX: 100, offsetY: 50, scale: 4 };
  const bounds = viewBounds(view, 800, 600);
  closeTo(bounds.x, -25, 1e-9);
  closeTo(bounds.y, -12.5, 1e-9);
  closeTo(bounds.w, 200, 1e-9);
  closeTo(bounds.h, 150, 1e-9);
});

test('normalizeView 仅覆盖显式字段', () => {
  const base = { offsetX: 12, offsetY: 34, scale: 5 };
  const merged = normalizeView({ scale: 8 }, base);
  assert.deepEqual(merged, { offsetX: 12, offsetY: 34, scale: 8 });
  const clamped = normalizeView({ scale: -1 }, base);
  assert.equal(clamped.scale, 4);
});
