// 状态仓库测试：可撤销 update、事件广播、多图纸切换、选择集与工程替换。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/model/store.js';
import { CommandStack } from '../../src/core/command.js';
import {
  createProject,
  createSheet,
  createWire,
  createLabel,
  clone,
} from '../../src/model/project.js';

function makeProject() {
  const project = createProject('演示工程');
  project.sheets.push(createSheet('第二张'));
  return project;
}

test('createStore 规范化工程并定位首个图纸', () => {
  const store = createStore(makeProject());
  const project = store.getProject();
  assert.equal(project.name, '演示工程');
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.sheets.length, 2);
  assert.equal(store.getSheet().id, project.sheets[0].id);
  assert.equal(store.getSheetId(), project.sheets[0].id);
  assert.deepEqual(store.getSelection(), []);
  assert.equal(store.getHover(), null);
  assert.equal(store.canUndo(), false);
  assert.ok(store.commands instanceof CommandStack);
});

test('update 通过命令栈修改并支持 undo / redo', () => {
  const store = createStore(makeProject());
  const wire = createWire([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  const returned = store.update((sheet) => {
    sheet.wires.push(wire);
  }, { label: '添加导线' });

  assert.equal(store.getSheet().wires.length, 1);
  assert.equal(store.getSheet().wires[0].id, wire.id);
  assert.equal(store.getSheetId(), returned.id);
  assert.equal(store.canUndo(), true);
  assert.equal(store.commands.peekUndo().label, '添加导线');
  assert.equal(typeof store.getProject().meta.modified, 'string');

  store.undo();
  assert.equal(store.getSheet().wires.length, 0);
  assert.equal(store.canRedo(), true);
  store.redo();
  assert.equal(store.getSheet().wires.length, 1);
  assert.equal(store.canRedo(), false);
});

test('update 的 mutator 同时接收 sheet 与 project 且不污染入参', () => {
  const source = makeProject();
  const store = createStore(source);
  let received = null;
  store.update((sheet, project) => {
    received = { sheetId: sheet.id, sheetCount: project.sheets.length };
    sheet.labels.push(createLabel({ text: 'NET', kind: 'local' }));
  }, { label: '添加标签' });

  assert.deepEqual(received, { sheetId: store.getSheetId(), sheetCount: 2 });
  assert.equal(store.getSheet().labels.length, 1);
  assert.equal(source.sheets[0].labels.length, 0);
});

test('update 的 mutator 抛错时不入栈、不改状态', () => {
  const store = createStore(makeProject());
  assert.throws(() => store.update(() => {
    throw new Error('mutator failed');
  }), /mutator failed/);
  assert.equal(store.getSheet().labels.length, 0);
  assert.equal(store.canUndo(), false);
  assert.throws(() => store.update(null), TypeError);
});

test('changed 事件在每次栈变化后广播一次', () => {
  const store = createStore(makeProject());
  const events = [];
  const off = store.on('changed', (payload) => events.push(payload.reason));
  store.update((sheet) => {
    sheet.texts.push({ id: 'txt-x', x: 0, y: 0, rotation: 0, text: 'x', size: 1.27 });
  }, { label: '添加文本' });
  store.undo();
  store.redo();
  assert.deepEqual(events, ['execute', 'undo', 'redo']);
  assert.equal(events.length, 3);
  off();
  store.undo();
  assert.equal(events.length, 3);
});

test('selection / hover / view 事件与去重', () => {
  const store = createStore(makeProject());
  const selections = [];
  const hovers = [];
  const views = [];
  store.on('selection', (payload) => selections.push([...payload.ids]));
  store.on('hover', (payload) => hovers.push(payload.id));
  store.on('view', (payload) => views.push(payload.scale));

  store.setSelection(['a', 'b', 'a']);
  assert.deepEqual(store.getSelection(), ['a', 'b']);
  store.setSelection(['a', 'b']);
  assert.equal(selections.length, 1);

  store.setHover('a');
  store.setHover('a');
  store.setHover(null);
  assert.deepEqual(hovers, ['a', null]);

  store.setView({ offsetX: 0, offsetY: 0, scale: 2 });
  assert.equal(store.getView().scale, 2);
  assert.deepEqual(views, [2]);
});

test('多图纸切换与按图纸隔离的修改', () => {
  const store = createStore(makeProject());
  const firstId = store.getSheetId();
  const secondId = store.getProject().sheets[1].id;
  const sheetEvents = [];
  store.on('sheet', (payload) => sheetEvents.push(payload.sheetId));

  assert.equal(store.setSheetId('missing'), false);
  assert.equal(store.setSheetId(secondId), true);
  assert.equal(store.getSheet().name, '第二张');
  assert.equal(store.getSheetId(), secondId);
  assert.deepEqual(sheetEvents, [secondId]);
  assert.equal(store.setSheetId(secondId), true);
  assert.equal(sheetEvents.length, 1);

  store.setSelection([secondId]);
  store.update((sheet) => {
    sheet.wires.push(createWire([{ x: 0, y: 0 }, { x: 5, y: 0 }]));
  }, { label: '第二张加线' });
  assert.equal(store.getProject().sheets[1].wires.length, 1);
  assert.equal(store.getProject().sheets[0].wires.length, 0);

  store.setSheetId(firstId);
  assert.deepEqual(store.getSelection(), []);
  assert.equal(sheetEvents.length, 2);
});

test('删除实体后选择集自动清理', () => {
  const store = createStore(makeProject());
  const wire = createWire([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  store.update((sheet) => {
    sheet.wires.push(wire);
  }, { label: '添加导线' });
  store.setSelection([wire.id]);
  const selections = [];
  store.on('selection', (payload) => selections.push([...payload.ids]));

  store.update((sheet) => {
    sheet.wires = sheet.wires.filter((item) => item.id !== wire.id);
  }, { label: '删除导线' });
  assert.deepEqual(store.getSelection(), []);
  assert.deepEqual(selections, [[]]);
});

test('setProject 默认清空历史与选择，history=true 时可撤销', () => {
  const store = createStore(makeProject());
  store.update((sheet) => {
    sheet.labels.push(createLabel({ text: 'A' }));
  }, { label: '添加标签' });
  store.setSelection(['x']);
  assert.equal(store.canUndo(), true);

  const replacement = createProject('替换工程');
  store.setProject(replacement, { history: false });
  assert.equal(store.getProject().name, '替换工程');
  assert.equal(store.canUndo(), false);
  assert.deepEqual(store.getSelection(), []);
  assert.equal(store.getSheetId(), store.getProject().sheets[0].id);

  const second = createProject('第二工程');
  store.setProject(second, { history: true });
  assert.equal(store.getProject().name, '第二工程');
  assert.equal(store.canUndo(), true);
  store.undo();
  assert.equal(store.getProject().name, '替换工程');
  store.redo();
  assert.equal(store.getProject().name, '第二工程');
});

test('setProject 尽量保留当前图纸 id，缺失时回落到首张', () => {
  const store = createStore(makeProject());
  const secondId = store.getProject().sheets[1].id;
  store.setSheetId(secondId);
  store.setProject(clone(store.getProject()), { history: false });
  assert.equal(store.getSheetId(), secondId);

  store.setProject(createProject('新工程'), { history: false });
  assert.equal(store.getSheetId(), store.getProject().sheets[0].id);
});

test('历史条目保存工程快照，多次撤销逐级回退', () => {
  const store = createStore(makeProject());
  const snapshot = clone(store.getProject());
  store.update((sheet) => {
    sheet.wires.push(createWire([{ x: 0, y: 0 }, { x: 1, y: 0 }]));
  }, { label: '一' });
  store.update((sheet) => {
    sheet.wires.push(createWire([{ x: 0, y: 0 }, { x: 2, y: 0 }]));
  }, { label: '二' });
  assert.equal(store.getSheet().wires.length, 2);
  store.undo();
  store.undo();
  assert.equal(store.getSheet().wires.length, 0);
  assert.deepEqual(store.getProject().sheets[0].symbols, snapshot.sheets[0].symbols);
  assert.equal(store.canUndo(), false);
});
