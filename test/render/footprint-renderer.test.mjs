import test from 'node:test';
import assert from 'node:assert/strict';
import { FootprintRenderer } from '../../src/render/footprint-renderer.js';
import { createTheme } from '../../src/render/theme.js';
import { createFakeCanvas, fillTexts } from './helpers/fake-canvas.mjs';

const footprint = {
  id: 'fp-soic8',
  name: 'SOIC-8',
  description: '8 引脚贴片封装',
  pads: [
    { id: 'pad-1', number: '1', x: 0, y: 0, w: 1.5, h: 0.6, shape: 'rect', rotation: 0, layer: 'top', drill: 0 },
    { id: 'pad-2', number: '2', x: 0, y: 2.54, w: 1.5, h: 0.6, shape: 'roundrect', rotation: 0, layer: 'bottom', drill: 0 },
    { id: 'pad-3', number: '3', x: 0, y: 5.08, w: 1.6, h: 1.6, shape: 'circle', rotation: 0, layer: 'tht', drill: 0.8 },
  ],
  graphics: [
    { type: 'line', points: [{ x: -2, y: -1 }, { x: 2, y: -1 }], width: 0.12, layer: 'silkscreen' },
    { type: 'rect', x: -3, y: -2, w: 6, h: 10, width: 0.1, layer: 'courtyard' },
    { type: 'circle', cx: 2, cy: 8, r: 0.4, width: 0.1, layer: 'silkscreen' },
  ],
};

function createRenderer(options = {}) {
  const { canvas, ctx, calls } = createFakeCanvas(800, 600);
  const renderer = new FootprintRenderer(canvas, {
    devicePixelRatio: 2,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    ...options,
  });
  return { renderer, canvas, ctx, calls };
}

test('FootprintRenderer 实现契约要求的同构方法', () => {
  const { renderer } = createRenderer();
  for (const method of ['setState', 'setView', 'getView', 'setSelection', 'setHover', 'resize', 'requestRender', 'render', 'worldToScreen', 'screenToWorld', 'fitToContent']) {
    assert.equal(typeof renderer[method], 'function', '缺少方法 ' + method);
  }
  assert.throws(() => new FootprintRenderer(null), TypeError);
});

test('焊盘按 top/bottom/tht 图层使用主题颜色并绘制钻孔', () => {
  const theme = createTheme();
  const { renderer, calls } = createRenderer();
  renderer.setState({ footprint });
  assert.equal(renderer.render(true), true);
  const fills = calls.filter((call) => call.op === 'fill').map((call) => call.fillStyle);
  assert.ok(fills.includes(theme.padTop));
  assert.ok(fills.includes(theme.padBottom));
  assert.ok(fills.includes(theme.padThru));
  assert.ok(fills.includes(theme.padDrill));
  assert.ok(calls.some((call) => (call.op === 'stroke' || call.op === 'strokeRect') && call.strokeStyle === theme.silk));
  assert.ok(calls.some((call) => (call.op === 'stroke' || call.op === 'strokeRect') && call.strokeStyle === theme.courtyard));
  assert.ok(calls.some((call) => call.op === 'setLineDash' && call.args[0].length > 0));
});

test('绘制焊盘编号与封装标题', () => {
  const { renderer, calls } = createRenderer();
  renderer.setState({ footprint });
  renderer.render(true);
  const texts = fillTexts(calls);
  assert.ok(texts.includes('1'));
  assert.ok(texts.includes('2'));
  assert.ok(texts.includes('3'));
  assert.ok(texts.includes('封装：SOIC-8'));
  assert.ok(texts.includes('3 个焊盘'));
});

test('支持 padId 选中与 hover 高亮', () => {
  const theme = createTheme();
  const { renderer, calls } = createRenderer();
  renderer.setState({ footprint });
  renderer.render(true);
  calls.length = 0;
  renderer.setSelection(['pad-1']);
  assert.equal(renderer.render(), true);
  assert.ok(calls.some((call) => call.op === 'stroke' && call.strokeStyle === theme.selection));
  calls.length = 0;
  renderer.setSelection([]);
  renderer.setHover('pad-3');
  assert.equal(renderer.render(), true);
  assert.ok(calls.some((call) => call.op === 'stroke' && call.strokeStyle === theme.hover));
});

test('空封装仍显示网格与占位标题', () => {
  const { renderer, calls } = createRenderer();
  renderer.setState({});
  assert.equal(renderer.render(true), true);
  assert.ok(calls.some((call) => call.op === 'stroke' && call.strokeStyle === createTheme().grid));
  assert.ok(fillTexts(calls).includes('封装：未选择封装'));
});

test('fitToContent 居中封装内容', () => {
  const { renderer } = createRenderer();
  renderer.setState({ footprint });
  renderer.fitToContent();
  const bounds = renderer.getContentBounds();
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const screen = renderer.worldToScreen(center);
  assert.ok(Math.abs(screen.x - 400) < 1e-6);
  assert.ok(Math.abs(screen.y - 300) < 1e-6);
});
