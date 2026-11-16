import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SCALE } from '../../src/render/view.js';
import { createTheme } from '../../src/render/theme.js';
import { SchematicRenderer } from '../../src/render/renderer.js';
import { createFakeCanvas, fillTexts } from './helpers/fake-canvas.mjs';

const symbolDef = {
  id: 'sym-R',
  name: 'Resistor',
  refPrefix: 'R',
  pins: [
    { id: 'p1', name: 'A', number: '1', x: -5, y: 0, length: 2.54, orientation: 'right', electricalType: 'passive' },
    { id: 'p2', name: 'B', number: '2', x: 5, y: 0, length: 2.54, orientation: 'left', electricalType: 'passive' },
  ],
  graphics: [{ type: 'rect', x: -2.54, y: -1.27, w: 5.08, h: 2.54, width: 0.2 }],
};

const project = {
  name: '测试工程',
  library: { symbols: [symbolDef], footprints: [] },
  sheets: [],
};

const sheet = {
  id: 'sheet-1',
  name: '主图',
  symbols: [{
    id: 'inst-1',
    symbolId: 'sym-R',
    designator: 'R1',
    value: '10k',
    x: 0,
    y: 0,
    rotation: 0,
    mirror: false,
    footprintId: null,
    fields: {},
  }],
  wires: [{ id: 'w1', points: [{ x: 0, y: 10 }, { x: 20, y: 10 }], width: 0.1524 }],
  junctions: [{ id: 'j1', x: 20, y: 10 }],
  labels: [{ id: 'l1', x: 0, y: 14, rotation: 0, text: 'VCC', kind: 'global' }],
  texts: [{ id: 't1', x: 4, y: 6, rotation: 0, text: 'note', size: 1.27 }],
  title: { title: '测试标题', company: '', rev: 'A', date: '2026-01-01', comments: '' },
};

function createRenderer(options = {}) {
  const { canvas, ctx, calls } = createFakeCanvas(800, 600);
  const renderer = new SchematicRenderer(canvas, {
    devicePixelRatio: 2,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    ...options,
  });
  return { renderer, canvas, ctx, calls };
}

test('SchematicRenderer 实现契约要求的全部方法', () => {
  const { renderer } = createRenderer();
  for (const method of ['setState', 'setView', 'getView', 'setSelection', 'setHover', 'resize', 'requestRender', 'render', 'worldToScreen', 'screenToWorld', 'fitToContent']) {
    assert.equal(typeof renderer[method], 'function', '缺少方法 ' + method);
  }
  assert.throws(() => new SchematicRenderer(null), TypeError);
});

test('构造函数按 devicePixelRatio 设置高清画布尺寸', () => {
  const { canvas, calls } = createRenderer();
  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 1200);
  assert.equal(calls.length, 0);
});

test('render 先画背景与网格，再画世界内容，最后画选中高亮', () => {
  const { renderer, calls } = createRenderer();
  renderer.setState({ project, sheet });
  assert.equal(renderer.render(true), true);
  const backgroundIndex = calls.findIndex((call) => call.op === 'fillRect' && call.fillStyle === createTheme().background);
  const gridIndex = calls.findIndex((call) => call.op === 'stroke' && call.strokeStyle === createTheme().grid);
  const worldIndex = calls.findIndex((call) => call.op === 'setTransform' && call.args[0] === 8);
  const symbolIndex = calls.findIndex((call) => call.op === 'stroke' && call.strokeStyle === createTheme().symbol);
  assert.ok(backgroundIndex >= 0, '缺少背景填充');
  assert.ok(gridIndex > backgroundIndex, '网格应晚于背景');
  assert.ok(worldIndex > gridIndex, '世界变换应晚于网格');
  assert.ok(symbolIndex > worldIndex, '符号应绘制在世界坐标中');
  const texts = fillTexts(calls);
  assert.ok(texts.includes('测试工程 / 主图'));
  assert.ok(texts.includes('测试标题'));
  assert.ok(texts.some((text) => text.includes('REV A')));
  assert.ok(texts.includes('R1'));
  assert.ok(texts.includes('10k'));
  assert.ok(texts.includes('VCC'));
  assert.ok(texts.includes('note'));
});

test('脏标记为 false 时不重复重绘', () => {
  const { renderer } = createRenderer();
  renderer.setState({ project, sheet });
  assert.equal(renderer.render(true), true);
  assert.equal(renderer.isDirty(), false);
  assert.equal(renderer.render(), false);
  renderer.setView({ scale: 2 });
  assert.equal(renderer.isDirty(), true);
  assert.equal(renderer.render(), true);
});

test('空文档也绘制网格与默认标题栏', () => {
  const { renderer, calls } = createRenderer();
  renderer.setState({});
  assert.equal(renderer.render(true), true);
  const theme = createTheme();
  assert.ok(calls.some((call) => call.op === 'stroke' && call.strokeStyle === theme.grid));
  const texts = fillTexts(calls);
  assert.ok(texts.some((text) => text.includes('未命名工程')));
  assert.ok(calls.some((call) => call.op === 'fillRect' && call.fillStyle === theme.background));
});

test('setState 接受 project 时自动选择首张图纸', () => {
  const { renderer } = createRenderer();
  renderer.setState({ project: { ...project, sheets: [sheet] } });
  assert.equal(renderer.getSheet(), sheet);
  renderer.setState({ sheet: null });
  assert.equal(renderer.getSheet(), null);
});

test('worldToScreen 与 screenToWorld 与视图一致且互逆', () => {
  const { renderer } = createRenderer();
  renderer.setView({ offsetX: 100, offsetY: 80, scale: 5 });
  assert.deepEqual(renderer.worldToScreen({ x: 2, y: 4 }), { x: 110, y: 100 });
  const world = renderer.screenToWorld({ x: 110, y: 100 });
  assert.equal(world.x, 2);
  assert.equal(world.y, 4);
  renderer.setView({ scale: 1000 });
  assert.equal(renderer.getView().scale, MAX_SCALE);
});

test('fitToContent 让内容中心落在视口中心', () => {
  const { renderer } = createRenderer();
  renderer.setState({ project, sheet });
  const view = renderer.fitToContent();
  const bounds = renderer.getContentBounds();
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const screen = renderer.worldToScreen(center);
  assert.ok(Math.abs(screen.x - 400) < 1e-6);
  assert.ok(Math.abs(screen.y - 300) < 1e-6);
  assert.ok(view.scale > 0);
});

test('选中与 hover 使用主题高亮色', () => {
  const theme = createTheme();
  const { renderer, calls } = createRenderer();
  renderer.setState({ project, sheet });
  renderer.render(true);
  calls.length = 0;
  renderer.setSelection(['inst-1']);
  assert.equal(renderer.render(), true);
  assert.ok(calls.some((call) => (call.op === 'stroke' || call.op === 'strokeRect') && call.strokeStyle === theme.selection));
  calls.length = 0;
  renderer.setSelection([]);
  renderer.setHover('w1');
  assert.equal(renderer.render(), true);
  assert.ok(calls.some((call) => call.op === 'stroke' && call.strokeStyle === theme.hover));
  assert.deepEqual(renderer.getSelection(), []);
});

test('缺少符号定义时绘制占位框而不抛错', () => {
  const { renderer, calls } = createRenderer();
  const brokenSheet = { ...sheet, symbols: [{ ...sheet.symbols[0], symbolId: 'missing' }] };
  renderer.setState({ project, sheet: brokenSheet });
  assert.equal(renderer.render(true), true);
  assert.ok(calls.some((call) => call.op === 'strokeRect' && call.strokeStyle === createTheme().hover));
  assert.ok(fillTexts(calls).includes('R1'));
});

test('titleBar:false 时不绘制标题栏，resize 更新画布尺寸', () => {
  const { renderer, canvas, calls } = createRenderer({ titleBar: false });
  renderer.setState({ project, sheet });
  renderer.render(true);
  assert.ok(!fillTexts(calls).includes('测试工程 / 主图'));
  canvas.clientWidth = 400;
  canvas.clientHeight = 300;
  assert.deepEqual(renderer.resize(), { width: 400, height: 300, dpr: 2 });
  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 600);
  assert.equal(renderer.isDirty(), true);
});

test('symbolResolver 选项优先于 project.library', () => {
  const custom = {
    id: 'custom',
    name: 'Custom',
    pins: [{ id: 'p', name: 'X', number: '1', x: -1, y: 0, length: 1, orientation: 'right' }],
    graphics: [{ type: 'line', points: [{ x: -1, y: 0 }, { x: 1, y: 0 }] }],
  };
  const { renderer, calls } = createRenderer({ symbolResolver: (id) => (id === 'custom' ? custom : null) });
  renderer.setState({ project, sheet: { ...sheet, symbols: [{ ...sheet.symbols[0], symbolId: 'custom', designator: 'U9' }] } });
  renderer.render(true);
  assert.ok(fillTexts(calls).includes('U9'));
});

test('requestRender 通过注入的调度器延迟重绘', () => {
  const { canvas } = createFakeCanvas(640, 480);
  let scheduled = null;
  const renderer = new SchematicRenderer(canvas, {
    devicePixelRatio: 1,
    requestAnimationFrame: (callback) => {
      scheduled = callback;
      return 7;
    },
    cancelAnimationFrame: () => {},
  });
  renderer.setState({ project, sheet });
  assert.equal(renderer.isDirty(), true);
  assert.equal(typeof scheduled, 'function');
  scheduled();
  assert.equal(renderer.isDirty(), false);
  renderer.destroy();
});
