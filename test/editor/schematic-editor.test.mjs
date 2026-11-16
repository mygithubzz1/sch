// 原理图编辑器测试：工具切换、缩放/平移、快捷键、事件同步与销毁。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createLabel } from '../../src/model/project.js';
import { createEditorHarness } from './schematic-harness.mjs';

function approx(actual, expected, message, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, message + '：' + actual + ' != ' + expected);
}

test('编辑器暴露工具注册表与当前工具', () => {
  const h = createEditorHarness();
  assert.deepEqual(h.editor.listTools().sort(), ['erase', 'label', 'place', 'select', 'text', 'wire']);
  assert.equal(h.editor.getTool(), 'select');
  assert.equal(h.editor.getActiveTool().id, 'select');
  assert.equal(h.editor.getToolName(), 'select');
  assert.equal(typeof h.editor.getCommands().addWire, 'function');
  assert.equal(h.editor.getSymbolResolver()('R').id, 'R');
  assert.equal(h.editor.setTool('wire'), true);
  assert.equal(h.editor.getTool(), 'wire');
  assert.equal(h.editor.setTool('unknown'), false);
  assert.equal(h.editor.getTool(), 'wire');
  h.dispose();
});

test('编辑器初始化把视图写回 store 并同步 store 视图变化', () => {
  const h = createEditorHarness();
  assert.deepEqual(h.store.getView(), { offsetX: 0, offsetY: 0, scale: 4 });
  h.store.setView({ offsetX: 12, offsetY: 34, scale: 2 });
  assert.deepEqual(h.renderer.getView(), { offsetX: 12, offsetY: 34, scale: 2 });
  h.dispose();
});

test('滚轮以光标为中心缩放，锚点世界坐标不漂移', () => {
  const h = createEditorHarness();
  const local = { x: 400, y: 300 };
  const before = h.renderer.screenToWorld(local);
  h.fake.fire('wheel', { clientX: local.x, clientY: local.y, deltaY: -120 });
  const after = h.renderer.screenToWorld(local);
  approx(after.x, before.x, '缩放后锚点 x 不变');
  approx(after.y, before.y, '缩放后锚点 y 不变');
  assert.ok(h.store.getView().scale > 4);
  assert.deepEqual(h.store.getView(), h.renderer.getView());
  h.dispose();
});

test('中键拖动平移并写回 store 视图', () => {
  const h = createEditorHarness();
  h.fake.fire('pointerdown', { clientX: 100, clientY: 100, button: 1 });
  h.fake.fire('pointermove', { clientX: 150, clientY: 130 });
  h.fake.fire('pointerup', { clientX: 150, clientY: 130, button: 1 });
  const view = h.store.getView();
  approx(view.offsetX, 50, 'offsetX');
  approx(view.offsetY, 30, 'offsetY');
  h.dispose();
});

test('空格 + 左键拖动平移，空格松开后恢复工具交互', () => {
  const h = createEditorHarness();
  h.keyDown(' ');
  h.fake.fire('pointerdown', { clientX: 100, clientY: 100, button: 0 });
  h.fake.fire('pointermove', { clientX: 140, clientY: 120 });
  h.fake.fire('pointerup', { clientX: 140, clientY: 120, button: 0 });
  h.keyUp(' ');
  const view = h.store.getView();
  approx(view.offsetX, 40, 'offsetX');
  approx(view.offsetY, 20, 'offsetY');
  h.editor.setTool('select');
  h.pointer('pointerdown', { x: 20.32, y: 20.32 });
  h.pointer('pointerup', { x: 20.32, y: 20.32 });
  assert.deepEqual(h.store.getSelection(), ['sym-r1']);
  h.dispose();
});

test('Delete 删除选择集，Ctrl+Z / Ctrl+Y 撤销重做', () => {
  const h = createEditorHarness();
  h.store.setSelection(['sym-r1']);
  h.keyDown('Delete');
  assert.equal(h.sheet().symbols.length, 1);
  h.keyDown('z', { ctrlKey: true });
  assert.equal(h.sheet().symbols.length, 2);
  h.keyDown('y', { ctrlKey: true });
  assert.equal(h.sheet().symbols.length, 1);
  h.dispose();
});

test('Ctrl+A 全选当前图纸实体', () => {
  const h = createEditorHarness();
  h.keyDown('a', { ctrlKey: true });
  const selection = h.store.getSelection();
  // 2 符号 + 1 导线 + 1 结点 + 1 标签 + 1 文本
  assert.equal(selection.length, 6);
  for (const id of ['sym-r1', 'sym-r2', 'wire-1', 'jct-1', 'lbl-1', 'txt-1']) {
    assert.ok(selection.includes(id), '应包含 ' + id);
  }
  h.dispose();
});

test('双击实体选中并广播 edit-entity 事件', () => {
  const h = createEditorHarness();
  const screen = h.screenOf({ x: 20.32, y: 20.32 });
  h.fake.fire('dblclick', { clientX: screen.x, clientY: screen.y });
  assert.deepEqual(h.store.getSelection(), ['sym-r1']);
  const editEvent = h.events.find((event) => event.type === 'edit-entity');
  assert.ok(editEvent);
  assert.equal(editEvent.id, 'sym-r1');
  assert.equal(editEvent.kind, 'symbols');
  h.dispose();
});

test('store changed 事件同步渲染器数据，外部载入工程也刷新', () => {
  const h = createEditorHarness();
  h.store.update((sheet) => {
    sheet.labels.push(createLabel({ text: 'NEW', x: 5, y: 5 }));
  }, { label: '追加标签' });
  assert.equal(h.renderer.getSheet().labels.length, 2);

  const replacement = createProject('新工程');
  h.store.setProject(replacement);
  assert.equal(h.renderer.getProject().name, '新工程');
  assert.equal(h.renderer.getSheet().id, h.store.getSheetId());
  h.dispose();
});

test('指针移动更新悬浮高亮，移出实体后清空', () => {
  const h = createEditorHarness();
  h.pointer('pointermove', { x: 20.32, y: 20.32 });
  assert.equal(h.store.getHover(), 'sym-r1');
  assert.equal(h.renderer.getHover(), 'sym-r1');
  h.pointer('pointermove', { x: 200, y: 200 });
  assert.equal(h.store.getHover(), null);
  h.dispose();
});

test('栅格覆盖：默认取工程 grid，可 setGrid 后用于吸附', () => {
  const h = createEditorHarness();
  assert.equal(h.editor.getGrid(), 2.54);
  assert.equal(h.editor.setGrid(0.635), 0.635);
  assert.equal(h.editor.getContext().grid, 0.635);
  // 锚点优先：靠近导线端点 (0,0)。
  assert.deepEqual(h.editor.getContext().snapPoint({ x: 1, y: 1 }), { x: 0, y: 0 });
  assert.deepEqual(h.editor.getContext().snapPoint({ x: 1, y: 1 }, { useAnchors: false }), { x: 1.27, y: 1.27 });
  h.dispose();
});

test('自定义工具抛错时广播 error 而不会中断编辑器', () => {
  const h = createEditorHarness({
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
  h.pointer('pointerdown', { x: 10, y: 10 });
  const errorEvent = h.events.find((event) => event.type === 'error');
  assert.ok(errorEvent);
  assert.match(String(errorEvent.error && errorEvent.error.message), /boom/);
  assert.equal(h.editor.setTool('select'), true);
  h.dispose();
});

test('输入框目标上的快捷键被忽略', () => {
  const h = createEditorHarness();
  h.store.setSelection(['sym-r1']);
  h.fake.fire('keydown', { key: 'Delete', target: { tagName: 'INPUT' } });
  assert.equal(h.sheet().symbols.length, 2);
  h.dispose();
});

test('fitToContent 写回 store 视图，refresh 同步选择/hover', () => {
  const h = createEditorHarness();
  h.store.setSelection(['sym-r1']);
  h.store.setHover('sym-r2');
  h.editor.refresh();
  assert.deepEqual(h.renderer.getSelection(), ['sym-r1']);
  assert.equal(h.renderer.getHover(), 'sym-r2');
  const view = h.editor.fitToContent();
  assert.deepEqual(h.store.getView(), view);
  h.dispose();
});

test('destroy 后移除画布监听且重复销毁安全', () => {
  const h = createEditorHarness();
  h.editor.destroy();
  const pointerHandlers = h.fake.listeners.get('pointerdown') || [];
  assert.equal(pointerHandlers.length, 0);
  assert.doesNotThrow(() => h.fake.fire('pointerdown', { clientX: 1, clientY: 1, button: 0 }));
  assert.doesNotThrow(() => h.editor.destroy());
});

test('编辑器 API 暴露 undo/redo/canUndo/canRedo 与选择工具', () => {
  const h = createEditorHarness();
  h.store.update((sheet) => {
    sheet.labels.push(createLabel({ text: 'X' }));
  }, { label: '加标签' });
  assert.equal(h.editor.canUndo(), true);
  assert.equal(h.editor.undo(), true);
  assert.equal(h.editor.canRedo(), true);
  assert.equal(h.editor.redo(), true);
  assert.equal(h.editor.canUndo(), true);
  h.editor.selectAll();
  // redo 后多出一个标签：2 符号 + 1 导线 + 1 结点 + 2 标签 + 1 文本
  assert.equal(h.store.getSelection().length, 7);
  h.dispose();
});
