// 文本绘制辅助测试：高分辨率排版、测量、旋转与空文本处理。
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEXT_LAYOUT_RESOLUTION, drawCanvasText, measureCanvasText } from '../../src/render/text.js';
import { measureTextWidth } from '../../src/render/symbols.js';
import { createFakeContext } from './helpers/fake-canvas.mjs';

test('高分辨率排版：字号放大后缩回，避免亚像素字宽被量化', () => {
  const { ctx, calls } = createFakeContext();
  const drawn = drawCanvasText(ctx, {
    text: '中文',
    x: 10,
    y: 20,
    size: 1.27,
    color: '#fff',
    fontFamily: 'sans-serif',
  });
  assert.equal(drawn, true);
  const fill = calls.find((call) => call.op === 'fillText');
  assert.equal(fill.text, '中文');
  assert.equal(Number.parseFloat(fill.font), 1.27 * TEXT_LAYOUT_RESOLUTION);
  assert.equal(fill.fillStyle, '#fff');
  assert.equal(fill.args[0], 0);
  assert.equal(fill.args[1], 0);

  const scales = calls.filter((call) => call.op === 'scale');
  assert.equal(scales.length, 1);
  assert.ok(Math.abs(scales[0].args[0] - 1 / TEXT_LAYOUT_RESOLUTION) < 1e-12);
  const translates = calls.filter((call) => call.op === 'translate');
  assert.deepEqual(translates[0].args, [10, 20]);
  assert.equal(calls.filter((call) => call.op === 'save').length, 1);
  assert.equal(calls.filter((call) => call.op === 'restore').length, 1);
});

test('空文本、空值与非字符串输入', () => {
  const { ctx, calls } = createFakeContext();
  assert.equal(drawCanvasText(ctx, { text: '' }), false);
  assert.equal(drawCanvasText(ctx, { text: null }), false);
  assert.equal(drawCanvasText(ctx, { text: undefined }), false);
  assert.equal(drawCanvasText(null, { text: 'x' }), false);
  assert.equal(drawCanvasText({}, { text: 'x' }), false);
  assert.equal(calls.filter((call) => call.op === 'fillText').length, 0);
  drawCanvasText(ctx, { text: 0 });
  assert.equal(calls.filter((call) => call.op === 'fillText').length, 1);
});

test('measureCanvasText 与估算函数一致且安全降级', () => {
  const { ctx } = createFakeContext();
  const width = measureCanvasText(ctx, 'ABC', 1);
  assert.ok(Math.abs(width - 1.8) < 1e-9);
  assert.equal(measureCanvasText(ctx, '', 1), 0);
  assert.equal(measureCanvasText(null, 'ABC', 1), null);
  assert.ok(Math.abs(measureCanvasText(ctx, 'ABC', 1) - measureTextWidth('ABC', 1)) < 1e-9);
  assert.ok(measureCanvasText(ctx, '电阻', 2) > 0);
});

test('旋转角度在缩放前应用，文本角度不受分辨率影响', () => {
  const { ctx, calls } = createFakeContext();
  drawCanvasText(ctx, { text: 'X', size: 2, rotation: 90 });
  const rotate = calls.find((call) => call.op === 'rotate');
  assert.ok(rotate);
  assert.ok(Math.abs(rotate.args[0] - Math.PI / 2) < 1e-12);
  const rotateIndex = calls.indexOf(rotate);
  const scaleIndex = calls.findIndex((call) => call.op === 'scale');
  assert.ok(rotateIndex < scaleIndex);
});
