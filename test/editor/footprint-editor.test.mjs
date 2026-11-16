// 封装编辑器测试：焊盘放置/编号/通孔切换、移动、图形绘制与图层、选择与属性。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFootprintEditor } from '../../src/editor/footprint-editor.js';
import { createEventCanvas } from './fixtures.mjs';
import { createFootprintHarness } from './footprint-harness.mjs';

function approx(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, message + '：' + actual + ' != ' + expected);
}

test('封装编辑器暴露工具与初始数据', () => {
  const h = createFootprintHarness();
  assert.deepEqual(h.editor.listTools().sort(), ['graphic', 'move', 'pad', 'select']);
  assert.equal(h.editor.getTool(), 'select');
  assert.equal(h.editor.getActiveTool().id, 'select');
  assert.equal(typeof h.editor.getCommands().addPad, 'function');
  assert.equal(h.editor.getFootprint().pads.length, 2);
  assert.equal(h.renderer.getFootprint().pads.length, 2);
  assert.equal(h.editor.setTool('nope'), false);
  h.dispose();
});

test('pad 工具点击放置焊盘并自动编号递增、默认 SMD top', () => {
  const h = createFootprintHarness();
  h.editor.setTool('pad');
  h.pointer('pointermove', { x: 5, y: 5 });
  h.pointer('pointerdown', { x: 5, y: 5 });
  assert.equal(h.footprint().pads.length, 3);
  const pad = h.footprint().pads[2];
  assert.equal(pad.number, '3');
  assert.equal(pad.layer, 'top');
  assert.equal(pad.drill, 0);
  assert.deepEqual({ x: pad.x, y: pad.y }, { x: 5.08, y: 5.08 });
  assert.deepEqual(h.store.getSelection(), [pad.id]);
  h.store.undo();
  assert.equal(h.footprint().pads.length, 2);
  h.dispose();
});

test('pad 工具 H 切换通孔，数字键切换形状', () => {
  const h = createFootprintHarness();
  h.editor.setTool('pad');
  h.keyDown('h');
  h.pointer('pointermove', { x: 10, y: 10 });
  h.pointer('pointerdown', { x: 10, y: 10 });
  const through = h.footprint().pads[2];
  assert.equal(through.layer, 'tht');
  assert.equal(through.drill, 0.8);

  h.keyDown('3');
  h.pointer('pointermove', { x: 15, y: 10 });
  h.pointer('pointerdown', { x: 15, y: 10 });
  assert.equal(h.footprint().pads[3].shape, 'circle');
  h.dispose();
});

test('pad 工具 Esc 返回选择工具', () => {
  const h = createFootprintHarness();
  h.editor.setTool('pad');
  h.keyDown('Escape');
  assert.equal(h.editor.getTool(), 'select');
  h.dispose();
});

test('move 工具拖动焊盘按栅格吸附并提交可撤销命令', () => {
  const h = createFootprintHarness();
  h.editor.setTool('move');
  h.pointer('pointerdown', { x: 2.54, y: 0 });
  h.pointer('pointermove', { x: 5.08, y: 0 });
  h.pointer('pointerup', { x: 5.08, y: 0 });
  const pad = h.footprint().pads.find((item) => item.id === 'pad-2');
  assert.equal(pad.x, 5.08);
  assert.equal(h.store.canUndo(), true);
  h.store.undo();
  assert.equal(h.footprint().pads.find((item) => item.id === 'pad-2').x, 2.54);
  h.dispose();
});

test('graphic 工具拖拽画丝印线，L 循环图层，R/Shift 切换矩形', () => {
  const h = createFootprintHarness();
  h.editor.setTool('graphic');
  h.pointer('pointerdown', { x: 10, y: 10 });
  h.pointer('pointermove', { x: 20, y: 10 });
  h.pointer('pointerup', { x: 20, y: 10 });
  const line = h.footprint().graphics[1];
  assert.equal(line.type, 'line');
  assert.equal(line.layer, 'silkscreen');
  assert.equal(h.editor.getLayer(), 'silkscreen');

  h.keyDown('l');
  assert.equal(h.editor.getLayer(), 'courtyard');
  h.pointer('pointerdown', { x: 10, y: 15 });
  h.pointer('pointermove', { x: 20, y: 15 });
  h.pointer('pointerup', { x: 20, y: 15 });
  assert.equal(h.footprint().graphics[2].layer, 'courtyard');

  h.keyDown('r');
  assert.equal(h.editor.getGraphicShape(), 'rect');
  h.pointer('pointerdown', { x: 0, y: 20 });
  h.pointer('pointermove', { x: 5, y: 25 });
  h.pointer('pointerup', { x: 5, y: 25 });
  const rect = h.footprint().graphics[3];
  assert.equal(rect.type, 'rect');
  assert.equal(rect.w, 5.08);
  assert.equal(rect.h, 5.08);

  h.pointer('pointerdown', { x: 0, y: 30 }, { shiftKey: true });
  h.pointer('pointermove', { x: 2, y: 32 });
  h.pointer('pointerup', { x: 2, y: 32 });
  assert.equal(h.footprint().graphics[4].type, 'rect');
  h.store.undo();
  assert.equal(h.footprint().graphics.length, 4);
  h.dispose();
});

test('select 工具点选、Shift 加选、框选与 Esc 清空', () => {
  const h = createFootprintHarness();
  h.editor.setTool('select');
  h.pointer('pointerdown', { x: 0, y: 0 });
  h.pointer('pointerup', { x: 0, y: 0 });
  assert.deepEqual(h.store.getSelection(), ['pad-1']);

  h.pointer('pointerdown', { x: -2.5, y: -2 }, { shiftKey: true });
  h.pointer('pointerup', { x: -2.5, y: -2 }, { shiftKey: true });
  assert.deepEqual(h.store.getSelection().sort(), ['gfx-1', 'pad-1']);

  h.keyDown('Escape');
  assert.deepEqual(h.store.getSelection(), []);

  h.pointer('pointerdown', { x: -5, y: -5 });
  h.pointer('pointermove', { x: 5, y: 5 });
  h.pointer('pointerup', { x: 5, y: 5 });
  const selection = h.store.getSelection();
  assert.ok(selection.includes('pad-1'));
  assert.ok(selection.includes('gfx-1'));
  h.dispose();
});

test('Delete 删除选中焊盘/图形，Ctrl+Z 撤销，Ctrl+A 全选', () => {
  const h = createFootprintHarness();
  h.editor.setTool('select');
  h.store.setSelection(['pad-1', 'gfx-1']);
  h.keyDown('Delete');
  assert.equal(h.footprint().pads.length, 1);
  assert.equal(h.footprint().graphics.length, 0);
  h.keyDown('z', { ctrlKey: true });
  assert.equal(h.footprint().pads.length, 2);
  assert.equal(h.footprint().graphics.length, 1);

  h.keyDown('a', { ctrlKey: true });
  assert.equal(h.store.getSelection().length, 3);
  h.dispose();
});

test('双击焊盘广播 edit-pad，双击图形广播 edit-graphic', () => {
  const h = createFootprintHarness();
  const padScreen = h.screenOf({ x: 0, y: 0 });
  h.fake.fire('dblclick', { clientX: padScreen.x, clientY: padScreen.y });
  const padEvent = h.events.find((event) => event.type === 'edit-pad');
  assert.ok(padEvent);
  assert.equal(padEvent.id, 'pad-1');
  assert.deepEqual(h.store.getSelection(), ['pad-1']);

  const graphicScreen = h.screenOf({ x: -2.5, y: -2 });
  h.fake.fire('dblclick', { clientX: graphicScreen.x, clientY: graphicScreen.y });
  const graphicEvent = h.events.find((event) => event.type === 'edit-graphic');
  assert.ok(graphicEvent);
  assert.equal(graphicEvent.id, 'gfx-1');
  h.dispose();
});

test('setPadProperties / setGraphicProperties 修改属性并可撤销', () => {
  const h = createFootprintHarness();
  h.editor.setPadProperties('pad-1', { w: 3, h: 2, shape: 'oval', layer: 'bottom', drill: 0.4, rotation: 90 });
  const pad = h.footprint().pads[0];
  assert.equal(pad.w, 3);
  assert.equal(pad.h, 2);
  assert.equal(pad.shape, 'oval');
  assert.equal(pad.layer, 'bottom');
  assert.equal(pad.drill, 0.4);
  assert.equal(pad.rotation, 90);
  const missing = h.editor.setPadProperties('missing', { w: 1 });
  assert.equal(missing.result, false);

  h.editor.setGraphicProperties('gfx-1', { layer: 'fab', width: 0.4 });
  assert.equal(h.footprint().graphics[0].layer, 'fab');
  assert.equal(h.footprint().graphics[0].width, 0.4);
  h.store.undo();
  assert.equal(h.footprint().graphics[0].layer, 'silkscreen');
  h.dispose();
});

test('setLayer / setGrid / 缩放视图与栅格吸附', () => {
  const h = createFootprintHarness();
  assert.equal(h.editor.getGrid(), 0.635);
  assert.equal(h.editor.setGrid(0.254), 0.254);
  assert.deepEqual(h.editor.getContext().snapPoint({ x: 0.3, y: 0.3 }), { x: 0.254, y: 0.254 });

  h.editor.setTool('graphic');
  assert.equal(h.editor.getLayer(), 'silkscreen');
  assert.equal(h.editor.setLayer('fab'), true);
  assert.equal(h.editor.getLayer(), 'fab');
  assert.equal(h.editor.setLayer('bad'), false);

  const views = [];
  h.editor.on('view', (view) => views.push(view));
  const local = { x: 400, y: 300 };
  const before = h.renderer.screenToWorld(local);
  h.fake.fire('wheel', { clientX: local.x, clientY: local.y, deltaY: -120 });
  const after = h.renderer.screenToWorld(local);
  approx(after.x, before.x, '缩放锚点 x');
  approx(after.y, before.y, '缩放锚点 y');
  assert.ok(h.renderer.getView().scale > 4);
  assert.ok(views.length > 0);
  h.dispose();
});

test('store changed 事件同步封装数据到渲染器', () => {
  const h = createFootprintHarness();
  h.store.update((footprint) => {
    footprint.name = '改过的封装';
  }, { label: '改名' });
  assert.equal(h.renderer.getFootprint().name, '改过的封装');
  assert.equal(h.editor.getFootprint().name, '改过的封装');
  h.dispose();
});

test('未提供 store 时自动创建内部封装仓库', () => {
  const fake = createEventCanvas();
  const editor = createFootprintEditor({ canvas: fake.canvas, options: { keyTarget: fake.canvas } });
  assert.equal(editor.getStore().getFootprint().id, 'NEW_FOOTPRINT');
  assert.equal(editor.getFootprint().pads.length, 0);
  editor.destroy();
});

test('自定义工具抛错广播 error，destroy 移除监听', () => {
  const h = createFootprintHarness({
    editorOptions: {
      tools: {
        boom: () => ({
          id: 'boom',
          cursor: 'crosshair',
          onActivate() {},
          onPointerDown() {
            throw new Error('boom');
          },
        }),
      },
    },
  });
  h.editor.setTool('boom');
  h.pointer('pointerdown', { x: 1, y: 1 });
  const errorEvent = h.events.find((event) => event.type === 'error');
  assert.ok(errorEvent);
  assert.match(String(errorEvent.error && errorEvent.error.message), /boom/);
  h.editor.destroy();
  assert.equal((h.fake.listeners.get('pointerdown') || []).length, 0);
  assert.doesNotThrow(() => h.editor.destroy());
});
