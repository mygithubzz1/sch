// 工具测试：选择/框选/拖动、连续导线、放置、标签、文本与擦除。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorHarness } from './schematic-harness.mjs';

function last(array) {
  return array[array.length - 1];
}

test('select 工具点选、Shift 加选、点击空白清空', () => {
  const h = createEditorHarness();
  h.editor.setTool('select');
  h.pointer('pointerdown', { x: 20.32, y: 20.32 });
  h.pointer('pointerup', { x: 20.32, y: 20.32 });
  assert.deepEqual(h.store.getSelection(), ['sym-r1']);

  h.pointer('pointerdown', { x: 40.64, y: 20.32 }, { shiftKey: true });
  h.pointer('pointerup', { x: 40.64, y: 20.32 }, { shiftKey: true });
  assert.deepEqual(h.store.getSelection().sort(), ['sym-r1', 'sym-r2']);

  h.pointer('pointerdown', { x: 200, y: 200 });
  h.pointer('pointerup', { x: 200, y: 200 });
  assert.deepEqual(h.store.getSelection(), []);
  h.dispose();
});

test('select 工具空白框选选中包围盒相交实体', () => {
  const h = createEditorHarness();
  h.editor.setTool('select');
  h.pointer('pointerdown', { x: 10, y: 10 });
  h.pointer('pointermove', { x: 30, y: 30 });
  h.pointer('pointerup', { x: 30, y: 30 });
  assert.deepEqual(h.store.getSelection(), ['sym-r1']);
  h.dispose();
});

test('select 工具拖动移动实体并在松手时提交一条可撤销命令', () => {
  const h = createEditorHarness();
  h.editor.setTool('select');
  h.pointer('pointerdown', { x: 20.32, y: 20.32 });
  h.pointer('pointermove', { x: 22.86, y: 22.86 });
  h.pointer('pointerup', { x: 22.86, y: 22.86 });
  const symbol = h.sheet().symbols.find((item) => item.id === 'sym-r1');
  assert.deepEqual({ x: symbol.x, y: symbol.y }, { x: 22.86, y: 22.86 });
  assert.equal(h.store.canUndo(), true);
  h.store.undo();
  const restored = h.sheet().symbols.find((item) => item.id === 'sym-r1');
  assert.deepEqual({ x: restored.x, y: restored.y }, { x: 20.32, y: 20.32 });
  h.dispose();
});

test('select 工具 Esc 清空选择', () => {
  const h = createEditorHarness();
  h.store.setSelection(['sym-r1']);
  h.editor.setTool('select');
  h.keyDown('Escape');
  assert.deepEqual(h.store.getSelection(), []);
  h.dispose();
});

test('wire 工具连续画线、回车结束并生成树形折线', () => {
  const h = createEditorHarness();
  h.editor.setTool('wire');
  h.pointer('pointerdown', { x: 30, y: 30 });
  h.pointer('pointermove', { x: 40, y: 30 });
  h.pointer('pointerdown', { x: 40, y: 30 });
  h.pointer('pointermove', { x: 40, y: 40 });
  h.pointer('pointerdown', { x: 40, y: 40 });
  h.keyDown('Enter');
  const wire = last(h.sheet().wires);
  assert.equal(wire.points.length, 3);
  assert.deepEqual(wire.points[0], { x: 30.48, y: 30.48 });
  assert.equal(h.store.canUndo(), true);
  h.store.undo();
  assert.equal(h.sheet().wires.length, 1);
  h.dispose();
});

test('wire 工具 Backspace 回退、无点时 Esc 交回选择工具', () => {
  const h = createEditorHarness();
  h.editor.setTool('wire');
  h.pointer('pointerdown', { x: 30, y: 30 });
  h.pointer('pointerdown', { x: 40, y: 30 });
  assert.equal(h.editor.getActiveTool().getState().points.length, 2);
  h.keyDown('Backspace');
  assert.equal(h.editor.getActiveTool().getState().points.length, 1);
  h.keyDown('Backspace');
  assert.equal(h.editor.getActiveTool().getState().points.length, 0);
  h.keyDown('Escape');
  assert.equal(h.editor.getTool(), 'select');
  h.dispose();
});

test('wire 工具双击结束当前折线', () => {
  const h = createEditorHarness();
  h.editor.setTool('wire');
  h.pointer('pointerdown', { x: 50, y: 50 });
  h.pointer('pointerdown', { x: 60, y: 50 });
  h.fake.fire('dblclick', { clientX: h.screenOf({ x: 60, y: 50 }).x, clientY: h.screenOf({ x: 60, y: 50 }).y });
  assert.equal(h.sheet().wires.length, 2);
  assert.deepEqual(h.editor.getActiveTool().getState().points, []);
  h.dispose();
});

test('wire 工具吸附到已有引脚端点并在 T 形接点自动生成 junction', () => {
  const h = createEditorHarness();
  h.editor.setTool('wire');
  h.pointer('pointerdown', { x: 20.5, y: 15.5 });
  h.pointer('pointermove', { x: 30, y: 15.24 });
  h.pointer('pointerdown', { x: 30, y: 15.24 });
  h.keyDown('Enter');
  const wire = last(h.sheet().wires);
  assert.deepEqual(wire.points[0], { x: 20.32, y: 15.24 });

  h.pointer('pointerdown', { x: 5, y: 0 });
  h.pointer('pointerdown', { x: 5, y: 10 });
  h.keyDown('Enter');
  assert.ok(h.sheet().junctions.some((junction) => junction.x === 5.08 && junction.y === 0));
  h.dispose();
});

test('place 工具放置符号、自动位号、R 旋转、X 镜像与 Shift 结束', () => {
  const h = createEditorHarness();
  h.editor.setTool('place', { symbolId: 'R' });
  h.pointer('pointermove', { x: 60, y: 60 });
  h.pointer('pointerdown', { x: 60, y: 60 });
  const first = last(h.sheet().symbols);
  assert.equal(first.designator, 'R3');
  assert.equal(first.value, '电阻');
  assert.equal(first.footprintId, 'R_0805');
  assert.equal(h.store.getSelection()[0], first.id);

  h.keyDown('r');
  h.pointer('pointermove', { x: 70, y: 60 });
  h.pointer('pointerdown', { x: 70, y: 60 });
  assert.equal(last(h.sheet().symbols).rotation, 90);
  assert.equal(last(h.sheet().symbols).designator, 'R4');

  h.keyDown('x');
  h.pointer('pointermove', { x: 80, y: 60 });
  h.pointer('pointerdown', { x: 80, y: 60 });
  assert.equal(last(h.sheet().symbols).mirror, true);

  h.pointer('pointermove', { x: 90, y: 60 });
  h.pointer('pointerdown', { x: 90, y: 60 }, { shiftKey: true });
  assert.equal(h.editor.getTool(), 'select');
  assert.equal(h.sheet().symbols.length, 6);
  h.dispose();
});

test('place 工具 Esc 取消并返回选择工具', () => {
  const h = createEditorHarness();
  h.editor.setTool('place', { symbolId: 'C' });
  h.keyDown('Escape');
  assert.equal(h.editor.getTool(), 'select');
  h.dispose();
});

test('label 工具放置标签，G 切换全局/局部', () => {
  const h = createEditorHarness();
  h.editor.setTool('label', { text: 'DATA' });
  h.pointer('pointermove', { x: 70, y: 70 });
  h.pointer('pointerdown', { x: 70, y: 70 });
  const local = last(h.sheet().labels);
  assert.equal(local.text, 'DATA');
  assert.equal(local.kind, 'local');

  h.keyDown('g');
  h.pointer('pointermove', { x: 80, y: 70 });
  h.pointer('pointerdown', { x: 80, y: 70 });
  assert.equal(last(h.sheet().labels).kind, 'global');
  h.dispose();
});

test('text 工具按激活参数放置文本并选中', () => {
  const h = createEditorHarness();
  h.editor.setTool('text', { text: '备注文字', size: 2 });
  h.pointer('pointermove', { x: 80, y: 20 });
  h.pointer('pointerdown', { x: 80, y: 20 });
  const text = last(h.sheet().texts);
  assert.equal(text.text, '备注文字');
  assert.equal(text.size, 2);
  assert.deepEqual(h.store.getSelection(), [text.id]);
  h.dispose();
});

test('erase 工具点击删除实体并可撤销', () => {
  const h = createEditorHarness();
  h.editor.setTool('erase');
  h.pointer('pointerdown', { x: 20.32, y: 20.32 });
  assert.equal(h.sheet().symbols.length, 1);
  h.store.undo();
  assert.equal(h.sheet().symbols.length, 2);
  h.dispose();
});

test('工具未命中时的点击不会产生命令', () => {
  const h = createEditorHarness();
  h.editor.setTool('erase');
  h.pointer('pointerdown', { x: 200, y: 200 });
  assert.equal(h.store.canUndo(), false);
  h.dispose();
});
