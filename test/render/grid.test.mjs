import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_GRID_PIXELS, computeGridStep, drawGrid, gridLines, normalizeSize } from '../../src/render/grid.js';
import { createTheme } from '../../src/render/theme.js';
import { createFakeContext } from './helpers/fake-canvas.mjs';

test('computeGridStep 在缩放过小时按 5 倍抽稀', () => {
  const dense = computeGridStep(2.54, 10);
  assert.equal(dense.minor, 2.54);
  assert.equal(dense.major, 12.7);
  const sparse = computeGridStep(2.54, 0.5);
  assert.ok(sparse.minor * 0.5 >= MIN_GRID_PIXELS);
  assert.equal(sparse.minor, 63.5);
  assert.equal(sparse.major, 317.5);
  const fallback = computeGridStep(0, 4);
  assert.equal(fallback.minor, 2.54);
});

test('gridLines 覆盖视口且主栅格每 5 条一根', () => {
  const view = { offsetX: 0, offsetY: 0, scale: 10 };
  const data = gridLines(view, { width: 800, height: 600 }, 2.54);
  assert.equal(data.minor, 2.54);
  const verticals = data.lines.filter((line) => line.x1 === line.x2 && line.y1 !== line.y2);
  const horizontals = data.lines.filter((line) => line.y1 === line.y2 && line.x1 !== line.x2);
  assert.equal(verticals.length, 32);
  assert.equal(horizontals.length, 24);
  assert.equal(data.lines.filter((line) => line.major).length, 12);
  assert.ok(verticals[0].x1 >= 0);
  assert.ok(verticals[verticals.length - 1].x1 <= 800);
  assert.ok(horizontals[horizontals.length - 1].y1 <= 600);
});

test('gridLines 支持数字尺寸并避开视口外线条', () => {
  assert.deepEqual(normalizeSize(500), { width: 500, height: 500 });
  const data = gridLines({ offsetX: 100, offsetY: 100, scale: 1 }, 200, 10);
  assert.ok(data.lines.length > 0);
  for (const line of data.lines) {
    assert.ok(line.x1 >= 0 && line.x1 <= 200);
    assert.ok(line.y1 >= 0 && line.y1 <= 200);
  }
});

test('drawGrid 分别绘制次级与主栅格并返回统计', () => {
  const { ctx, calls } = createFakeContext();
  const theme = createTheme();
  const data = drawGrid(ctx, { offsetX: 0, offsetY: 0, scale: 10 }, { width: 400, height: 300 }, 2.54, theme);
  const strokes = calls.filter((call) => call.op === 'stroke');
  assert.equal(strokes.length, 2);
  assert.equal(strokes[0].strokeStyle, theme.grid);
  assert.equal(strokes[1].strokeStyle, theme.gridMajor);
  assert.ok(data.lines.length > 0);
  const empty = drawGrid(null, { offsetX: 0, offsetY: 0, scale: 1 }, 100, 10);
  assert.ok(empty);
});
