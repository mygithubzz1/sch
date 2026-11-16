import test from 'node:test';
import assert from 'node:assert/strict';
import { transformPoint } from '../../src/core/geometry.js';
import { createTheme } from '../../src/render/theme.js';
import {
  DEFAULT_PIN_LENGTH,
  drawSymbol,
  drawSymbolPrimitives,
  measureTextWidth,
  primitivesBBox,
  symbolBBox,
  symbolTransform,
  textPrimitiveBounds,
} from '../../src/render/symbols.js';
import { createFakeContext } from './helpers/fake-canvas.mjs';

const symbolDef = {
  id: 'sym-R',
  name: 'Resistor',
  refPrefix: 'R',
  power: false,
  pins: [
    { id: 'p1', name: 'A', number: '1', x: -5, y: 0, length: 2.54, orientation: 'right', electricalType: 'passive' },
    { id: 'p2', name: 'B', number: '2', x: 5, y: 0, length: 2.54, orientation: 'left', electricalType: 'passive' },
  ],
  graphics: [
    { type: 'rect', x: -2.54, y: -1.27, w: 5.08, h: 2.54, width: 0.2 },
    { type: 'circle', cx: 0, cy: 0, r: 0.8, width: 0.15 },
    { type: 'arc', cx: 0, cy: 0, r: 1.5, start: 0, end: 90, width: 0.15 },
    { type: 'text', x: 0, y: 0, text: 'R', size: 1 },
  ],
};

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, 'expected ' + actual + ' ~= ' + expected);
};

test('symbolTransform 规范化角度与镜像标记', () => {
  assert.deepEqual(symbolTransform({ x: '12', y: 3, rotation: 450, mirror: 1 }), {
    x: 12,
    y: 3,
    rotation: 90,
    mirror: true,
  });
  assert.deepEqual(symbolTransform(), { x: 0, y: 0, rotation: 0, mirror: false });
});

test('drawSymbolPrimitives 生成矩形、圆、弧、文本与引脚图元', () => {
  const primitives = drawSymbolPrimitives(symbolDef, { x: 100, y: 50 });
  const pins = primitives.filter((primitive) => primitive.role === 'pin');
  assert.equal(pins.length, 2);
  closeTo(pins[0].points[0].x, 95);
  closeTo(pins[0].points[1].x, 95 + DEFAULT_PIN_LENGTH);
  assert.equal(primitives.filter((primitive) => primitive.role === 'pinNumber').length, 2);
  assert.equal(primitives.filter((primitive) => primitive.role === 'pinName').length, 2);
  assert.equal(primitives.filter((primitive) => primitive.kind === 'circle' && primitive.role === 'graphic').length, 1);
  assert.equal(primitives.filter((primitive) => primitive.kind === 'arc').length, 1);
  assert.equal(primitives.filter((primitive) => primitive.role === 'graphicText').length, 1);
});

test('矩形四角按 mirror -> rotate -> translate 精确变换', () => {
  const transform = { x: 30, y: -8, rotation: 90, mirror: true };
  const primitives = drawSymbolPrimitives(symbolDef, transform);
  const rect = primitives.find((primitive) => primitive.kind === 'polyline' && primitive.points.length === 4);
  assert.ok(rect);
  const expected = [
    { x: -2.54, y: -1.27 },
    { x: 2.54, y: -1.27 },
    { x: 2.54, y: 1.27 },
    { x: -2.54, y: 1.27 },
  ].map((point) => transformPoint(point, transform));
  for (let index = 0; index < expected.length; index += 1) {
    closeTo(rect.points[index].x, expected[index].x);
    closeTo(rect.points[index].y, expected[index].y);
  }
});

test('引脚端点随旋转与镜像正确落位', () => {
  const rotated = drawSymbolPrimitives(symbolDef, { x: 100, y: 50, rotation: 90 });
  const rotatedPin = rotated.find((primitive) => primitive.role === 'pin');
  closeTo(rotatedPin.points[0].x, 100);
  closeTo(rotatedPin.points[0].y, 45);
  const mirrored = drawSymbolPrimitives(symbolDef, { x: 100, y: 50, mirror: true });
  const mirroredPin = mirrored.find((primitive) => primitive.role === 'pin');
  closeTo(mirroredPin.points[0].x, 105);
  closeTo(mirroredPin.points[1].x, 102.46);
});

test('圆的半径不受旋转影响，镜像弧方向反转', () => {
  const primitives = drawSymbolPrimitives(symbolDef, { x: 10, y: 20, rotation: 90 });
  const circle = primitives.find((primitive) => primitive.kind === 'circle' && primitive.role === 'graphic');
  closeTo(circle.cx, 10);
  closeTo(circle.cy, 20);
  closeTo(circle.r, 0.8);
  const arc = primitives.find((primitive) => primitive.kind === 'arc');
  assert.equal(arc.start, 90);
  assert.equal(arc.end, 180);
  assert.equal(arc.anticlockwise, false);
  const mirroredArc = drawSymbolPrimitives(symbolDef, { mirror: true }).find((primitive) => primitive.kind === 'arc');
  assert.equal(mirroredArc.start, 180);
  assert.equal(mirroredArc.end, 90);
  assert.equal(mirroredArc.anticlockwise, true);
});

test('measureTextWidth 区分 CJK 与拉丁字符', () => {
  closeTo(measureTextWidth('ABC', 1), 1.8);
  closeTo(measureTextWidth('电阻', 1), 2);
  closeTo(measureTextWidth('', 1), 0);
});

test('textPrimitiveBounds 处理对齐与 90 度旋转', () => {
  const box = textPrimitiveBounds({ x: 10, y: 5, text: 'AB', size: 1, rotation: 0, align: 'center', baseline: 'middle' });
  closeTo(box.x, 9.4);
  closeTo(box.w, 1.2);
  closeTo(box.h, 1);
  const rotated = textPrimitiveBounds({ x: 10, y: 5, text: 'AB', size: 1, rotation: 90, align: 'left', baseline: 'middle' });
  assert.ok(rotated.w < rotated.h);
});

test('symbolBBox 覆盖引脚与文字范围', () => {
  const box = symbolBBox(symbolDef, { x: 0, y: 0 });
  assert.ok(box.w >= 9.99);
  assert.ok(box.x <= -4.99);
  assert.ok(box.y < 0);
  const empty = primitivesBBox([]);
  assert.deepEqual(empty, { x: 0, y: 0, w: 0, h: 0 });
});

test('drawSymbol 使用主题颜色并可用 opts 关闭引脚文字', () => {
  const theme = createTheme();
  const recorder = createFakeContext();
  drawSymbol(recorder.ctx, symbolDef, { x: 0, y: 0 }, theme);
  const texts = recorder.calls.filter((call) => call.op === 'fillText').map((call) => call.text);
  assert.ok(texts.includes('A'));
  assert.ok(texts.includes('B'));
  assert.ok(texts.includes('1'));
  assert.ok(texts.includes('2'));
  const strokes = recorder.calls.filter((call) => call.op === 'stroke');
  assert.ok(strokes.some((call) => call.strokeStyle === theme.pin));
  assert.ok(strokes.some((call) => call.strokeStyle === theme.symbol));

  const quiet = createFakeContext();
  drawSymbol(quiet.ctx, symbolDef, { x: 0, y: 0 }, theme, { showPinNames: false, showPinNumbers: false });
  const quietTexts = quiet.calls.filter((call) => call.op === 'fillText').map((call) => call.text);
  assert.ok(!quietTexts.includes('A'));
  assert.ok(!quietTexts.includes('1'));
  assert.ok(quietTexts.includes('R'));
});
