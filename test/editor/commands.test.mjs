// 可撤销命令测试：导线/junction、删除清理、移动、旋转镜像、字段与批量删除。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/model/store.js';
import {
  createJunction,
  createLabel,
  createProject,
  createSymbolInstance,
  createText,
  createWire,
} from '../../src/model/project.js';
import {
  addJunctionCommand,
  addLabelCommand,
  addSymbolCommand,
  addTextCommand,
  addWireCommand,
  createCommandApi,
  executeCommand,
  mirrorSymbolsCommand,
  moveEntitiesCommand,
  removeEntitiesCommand,
  rotateSymbolsCommand,
  setEntityFieldCommand,
  setEntityPropsCommand,
  setSymbolFieldCommand,
} from '../../src/editor/commands.js';

function makeStore() {
  const project = createProject('命令测试');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ id: 'sym-r1', symbolId: 'R', designator: 'R1', value: '10k', x: 20, y: 20 }),
  );
  sheet.wires.push(createWire([{ x: 0, y: 0 }, { x: 10, y: 0 }]));
  sheet.wires[0].id = 'wire-1';
  sheet.labels.push(createLabel({ id: 'lbl-1', x: 0, y: 10, text: 'A', kind: 'local' }));
  return createStore(project);
}

test('addWireCommand 执行后可撤销/重做，id 稳定', () => {
  const store = makeStore();
  const sheetId = store.getSheetId();
  const command = executeCommand(store, addWireCommand(sheetId, [{ x: 0, y: 0 }, { x: 10, y: 0 }]));
  assert.equal(store.getSheet().wires.length, 2);
  assert.equal(command.label, '添加导线');
  assert.equal(typeof command.result, 'string');
  const wireId = command.result;
  assert.equal(store.canUndo(), true);

  store.undo();
  assert.equal(store.getSheet().wires.length, 1);
  store.redo();
  assert.equal(store.getSheet().wires.length, 2);
  assert.ok(store.getSheet().wires.some((wire) => wire.id === wireId));
});

test('addWireCommand 自动在 T 形接点生成 junction 并与导线同一条命令', () => {
  const store = makeStore();
  const command = executeCommand(store, addWireCommand(store.getSheetId(), [{ x: 5, y: 0 }, { x: 5, y: 5 }]));
  assert.equal(command.label, '添加导线');
  const junctions = store.getSheet().junctions;
  assert.equal(junctions.length, 1);
  assert.deepEqual({ x: junctions[0].x, y: junctions[0].y }, { x: 5, y: 0 });
  store.undo();
  assert.equal(store.getSheet().wires.length, 1);
  assert.equal(store.getSheet().junctions.length, 0);
});

test('端点对端点连接不产生 junction，交叉导线不自动连接', () => {
  const store = makeStore();
  executeCommand(store, addWireCommand(store.getSheetId(), [{ x: 10, y: 0 }, { x: 10, y: 10 }]));
  assert.equal(store.getSheet().junctions.length, 0);

  const store2 = makeStore();
  executeCommand(store2, addWireCommand(store2.getSheetId(), [{ x: 5, y: -5 }, { x: 5, y: 5 }]));
  assert.equal(store2.getSheet().junctions.length, 0);
});

test('removeEntitiesCommand 删除导线并清理孤立 junction', () => {
  const project = createProject('删除');
  const sheet = project.sheets[0];
  const first = createWire([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  const second = createWire([{ x: 10, y: 0 }, { x: 10, y: 10 }]);
  first.id = 'w-a';
  second.id = 'w-b';
  sheet.wires.push(first, second);
  sheet.junctions.push({ id: 'jct-a', x: 10, y: 0 }, { id: 'jct-orphan', x: 99, y: 99 });
  const store = createStore(project);

  executeCommand(store, removeEntitiesCommand(store.getSheetId(), ['w-b']));
  assert.equal(store.getSheet().wires.length, 1);
  assert.equal(store.getSheet().junctions.length, 0);
  store.undo();
  assert.equal(store.getSheet().wires.length, 2);
  assert.equal(store.getSheet().junctions.length, 2);
});

test('removeEntitiesCommand 支持多选批量删除并标记为批量删除', () => {
  const store = makeStore();
  const command = executeCommand(store, removeEntitiesCommand(store.getSheetId(), ['wire-1', 'lbl-1']));
  assert.equal(command.label, '批量删除');
  assert.equal(store.getSheet().wires.length, 0);
  assert.equal(store.getSheet().labels.length, 0);
  store.undo();
  assert.equal(store.getSheet().wires.length, 1);
  assert.equal(store.getSheet().labels.length, 1);
});

test('moveEntitiesCommand 同时移动符号/导线折点/标签/文本', () => {
  const project = createProject('移动');
  const sheet = project.sheets[0];
  sheet.symbols.push(createSymbolInstance({ id: 'sym', symbolId: 'R', x: 10, y: 10 }));
  const wire = createWire([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  wire.id = 'wire';
  sheet.wires.push(wire);
  sheet.labels.push(createLabel({ id: 'lbl', x: 1, y: 2 }));
  sheet.texts.push(createText({ id: 'txt', x: 3, y: 4 }));
  const store = createStore(project);

  executeCommand(store, moveEntitiesCommand(store.getSheetId(), ['sym', 'wire', 'lbl', 'txt'], { x: 2.54, y: -1.27 }));
  const moved = store.getSheet();
  assert.deepEqual({ x: moved.symbols[0].x, y: moved.symbols[0].y }, { x: 12.54, y: 8.73 });
  assert.deepEqual(moved.wires[0].points[1], { x: 12.54, y: -1.27 });
  assert.deepEqual({ x: moved.labels[0].x, y: moved.labels[0].y }, { x: 3.54, y: 0.73 });
  assert.deepEqual({ x: moved.texts[0].x, y: moved.texts[0].y }, { x: 5.54, y: 2.73 });
  store.undo();
  assert.deepEqual({ x: store.getSheet().symbols[0].x, y: store.getSheet().symbols[0].y }, { x: 10, y: 10 });
});

test('rotateSymbolsCommand 与 mirrorSymbolsCommand 可撤销', () => {
  const store = makeStore();
  executeCommand(store, rotateSymbolsCommand(store.getSheetId(), ['sym-r1'], 90));
  assert.equal(store.getSheet().symbols[0].rotation, 90);
  executeCommand(store, rotateSymbolsCommand(store.getSheetId(), ['sym-r1'], 270));
  assert.equal(store.getSheet().symbols[0].rotation, 0);
  executeCommand(store, mirrorSymbolsCommand(store.getSheetId(), ['sym-r1']));
  assert.equal(store.getSheet().symbols[0].mirror, true);
  executeCommand(store, mirrorSymbolsCommand(store.getSheetId(), ['sym-r1'], false));
  assert.equal(store.getSheet().symbols[0].mirror, false);
  store.undo();
  assert.equal(store.getSheet().symbols[0].mirror, true);
});

test('setSymbolFieldCommand 修改 designator/value/footprintId/自定义字段', () => {
  const store = makeStore();
  const sheetId = store.getSheetId();
  executeCommand(store, setSymbolFieldCommand(sheetId, 'sym-r1', 'designator', 'R9'));
  executeCommand(store, setSymbolFieldCommand(sheetId, 'sym-r1', 'value', '4k7'));
  executeCommand(store, setSymbolFieldCommand(sheetId, 'sym-r1', 'footprintId', 'R_0603'));
  executeCommand(store, setSymbolFieldCommand(sheetId, 'sym-r1', 'fields.mpn', 'ABC-123'));
  const symbol = store.getSheet().symbols[0];
  assert.equal(symbol.designator, 'R9');
  assert.equal(symbol.value, '4k7');
  assert.equal(symbol.footprintId, 'R_0603');
  assert.equal(symbol.fields.mpn, 'ABC-123');
  executeCommand(store, setSymbolFieldCommand(sheetId, 'sym-r1', 'footprintId', ''));
  assert.equal(store.getSheet().symbols[0].footprintId, null);
});

test('setEntityFieldCommand / setEntityPropsCommand 修改标签与文本', () => {
  const store = makeStore();
  const sheetId = store.getSheetId();
  executeCommand(store, setEntityFieldCommand(sheetId, 'lbl-1', 'text', 'VCC'));
  executeCommand(store, setEntityFieldCommand(sheetId, 'lbl-1', 'kind', 'global'));
  assert.equal(store.getSheet().labels[0].text, 'VCC');
  assert.equal(store.getSheet().labels[0].kind, 'global');

  executeCommand(store, addTextCommand(sheetId, { text: '说明', x: 0, y: 0 }));
  const textId = store.getSheet().texts[0].id;
  executeCommand(store, setEntityPropsCommand(sheetId, textId, { text: '新说明', size: 2.54, x: 5 }));
  assert.equal(store.getSheet().texts[0].text, '新说明');
  assert.equal(store.getSheet().texts[0].size, 2.54);
  assert.equal(store.getSheet().texts[0].x, 5);
});

test('addSymbol/addLabel/addText/addJunction 均产生可撤销实体', () => {
  const store = makeStore();
  const sheetId = store.getSheetId();
  executeCommand(store, addSymbolCommand(sheetId, { symbolId: 'C', designator: 'C1', x: 5, y: 5 }));
  executeCommand(store, addLabelCommand(sheetId, { text: 'IN', x: 1, y: 1 }));
  executeCommand(store, addTextCommand(sheetId, { text: '备注', x: 2, y: 2 }));
  executeCommand(store, addJunctionCommand(sheetId, 7, 7));
  assert.equal(store.getSheet().symbols.length, 2);
  assert.equal(store.getSheet().labels.length, 2);
  assert.equal(store.getSheet().texts.length, 1);
  assert.equal(store.getSheet().junctions.length, 1);
  assert.equal(store.canUndo(), true);
  store.undo();
  assert.equal(store.getSheet().junctions.length, 0);
});

test('addJunctionCommand 同位置不重复添加', () => {
  const store = makeStore();
  const sheetId = store.getSheetId();
  executeCommand(store, addJunctionCommand(sheetId, 3, 3));
  executeCommand(store, addJunctionCommand(sheetId, 3, 3));
  assert.equal(store.getSheet().junctions.length, 1);
});

test('未绑定 store 的命令直接 do 会明确报错，绑定后可执行', () => {
  const store = makeStore();
  const command = addWireCommand(store.getSheetId(), [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  assert.throws(() => command.do(), /未绑定 store/);
  assert.equal(store.getSheet().wires.length, 1);
  executeCommand(store, command);
  assert.equal(store.getSheet().wires.length, 2);
});

test('createCommandApi 门面自动绑定 store 并支持链式调用', () => {
  const store = makeStore();
  const api = createCommandApi(store);
  const sheetId = store.getSheetId();
  const add = api.addWire(sheetId, [{ x: 0, y: 0 }, { x: 0, y: 5 }]);
  assert.equal(add.label, '添加导线');
  api.removeEntities(sheetId, [add.result]);
  assert.equal(store.getSheet().wires.length, 1);
  store.undo();
  assert.equal(store.getSheet().wires.length, 2);
  assert.throws(() => createCommandApi(null), TypeError);
});

test('命令修改 meta.modified 但值仍可序列化', () => {
  const store = makeStore();
  const before = store.getProject().meta.modified;
  executeCommand(store, addLabelCommand(store.getSheetId(), { text: 'X', x: 0, y: 0 }));
  const after = store.getProject().meta.modified;
  assert.equal(typeof after, 'string');
  assert.ok(after >= before);
  assert.doesNotThrow(() => JSON.stringify(store.getProject()));
});
