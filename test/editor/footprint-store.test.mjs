// 封装仓库与命令测试：id 补齐、编号递增、增删移动、属性修改与撤销。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_FOOTPRINT_ID,
  createFootprintStore,
  nextPadNumber,
  prepareFootprint,
} from '../../src/editor/footprint-store.js';
import {
  addGraphicCommand,
  addPadCommand,
  createFootprintCommandApi,
  executeFootprintCommand,
  moveFootprintEntitiesCommand,
  removeFootprintEntitiesCommand,
  updateGraphicCommand,
  updatePadCommand,
} from '../../src/editor/footprint-commands.js';
import { makeFootprint } from './fixtures.mjs';

test('prepareFootprint 补齐图形 id、保留焊盘 id 并处理重复 id', () => {
  const prepared = prepareFootprint({
    id: 'FP',
    name: '封装',
    pads: [
      { id: 'same', number: '1', x: 0, y: 0, w: 1, h: 1, shape: 'rect', layer: 'top', drill: 0 },
      { id: 'same', number: '2', x: 1, y: 0, w: 1, h: 1, shape: 'rect', layer: 'top', drill: 0 },
    ],
    graphics: [{ type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], layer: 'silkscreen', width: 0.15 }],
  });
  assert.equal(prepared.id, 'FP');
  assert.notEqual(prepared.pads[0].id, prepared.pads[1].id);
  assert.equal(typeof prepared.graphics[0].id, 'string');
  assert.ok(prepared.graphics[0].id.length > 0);
});

test('prepareFootprint 缺少 id 时使用 NEW_FOOTPRINT_ID', () => {
  assert.equal(prepareFootprint({}).id, NEW_FOOTPRINT_ID);
});

test('nextPadNumber 按最大数字递增', () => {
  assert.equal(nextPadNumber({ pads: [{ number: '1' }, { number: '4' }] }), '5');
  assert.equal(nextPadNumber({ pads: [] }), '1');
  assert.equal(nextPadNumber({ pads: [{ number: 'A' }] }), '2');
});

test('store update 可撤销/重做并广播 changed/selection', () => {
  const store = createFootprintStore(makeFootprint());
  const reasons = [];
  const selections = [];
  store.on('changed', (payload) => reasons.push(payload.reason));
  store.on('selection', (payload) => selections.push([...payload.ids]));

  store.update((footprint) => {
    footprint.pads.push({ id: 'pad-x', number: '9', x: 5, y: 5, w: 1, h: 1, shape: 'rect', layer: 'top', drill: 0 });
  }, { label: '追加焊盘' });
  assert.equal(store.getFootprint().pads.length, 3);
  assert.deepEqual(reasons, ['execute']);

  store.undo();
  assert.equal(store.getFootprint().pads.length, 2);
  store.redo();
  assert.equal(store.getFootprint().pads.length, 3);

  store.setSelection(['pad-1']);
  store.update((footprint) => {
    footprint.pads = footprint.pads.filter((pad) => pad.id !== 'pad-1');
  }, { label: '删除焊盘' });
  assert.deepEqual(store.getSelection(), []);
  assert.deepEqual(selections, [['pad-1'], []]);
});

test('setFootprint 默认清空历史，history=true 可撤销', () => {
  const store = createFootprintStore(makeFootprint());
  store.update((footprint) => {
    footprint.name = '改过';
  }, { label: '改名' });
  assert.equal(store.canUndo(), true);
  store.setFootprint({ id: 'OTHER', name: '新封装', pads: [], graphics: [] });
  assert.equal(store.getFootprint().id, 'OTHER');
  assert.equal(store.canUndo(), false);

  const replacement = makeFootprint();
  replacement.id = 'THIRD';
  replacement.name = '第三';
  store.setFootprint(replacement, { history: true });
  assert.equal(store.canUndo(), true);
  store.undo();
  assert.equal(store.getFootprint().id, 'OTHER');
  store.redo();
  assert.equal(store.getFootprint().id, 'THIRD');
});

test('addPadCommand 自动编号并支持撤销', () => {
  const store = createFootprintStore(makeFootprint());
  const command = executeFootprintCommand(store, addPadCommand({ id: 'new-pad', x: 5, y: 5, w: 2, h: 1 }));
  assert.equal(command.result, 'new-pad');
  const pad = store.getFootprint().pads.find((item) => item.id === 'new-pad');
  assert.ok(pad);
  assert.equal(pad.number, '3');
  assert.equal(pad.layer, 'top');
  store.undo();
  assert.equal(store.getFootprint().pads.length, 2);
});

test('removeFootprintEntitiesCommand 同时删除焊盘与图形', () => {
  const store = createFootprintStore(makeFootprint());
  executeFootprintCommand(store, removeFootprintEntitiesCommand(['pad-1', 'gfx-1']));
  assert.equal(store.getFootprint().pads.length, 1);
  assert.equal(store.getFootprint().graphics.length, 0);
  store.undo();
  assert.equal(store.getFootprint().pads.length, 2);
  assert.equal(store.getFootprint().graphics.length, 1);
});

test('moveFootprintEntitiesCommand 移动焊盘与折线图形', () => {
  const store = createFootprintStore(makeFootprint());
  executeFootprintCommand(store, moveFootprintEntitiesCommand(['pad-2', 'gfx-1'], { x: 1.27, y: -0.5 }));
  assert.deepEqual(
    { x: store.getFootprint().pads[1].x, y: store.getFootprint().pads[1].y },
    { x: 3.81, y: -0.5 },
  );
  assert.deepEqual(store.getFootprint().graphics[0].points[0], { x: -0.73, y: -2.5 });
  store.undo();
  assert.deepEqual(store.getFootprint().graphics[0].points[0], { x: -2, y: -2 });
});

test('updatePadCommand 修改尺寸/形状/层/钻孔/旋转并忽略非法枚举', () => {
  const store = createFootprintStore(makeFootprint());
  executeFootprintCommand(store, updatePadCommand('pad-1', {
    w: 3,
    h: 2,
    shape: 'circle',
    layer: 'tht',
    drill: 0.8,
    rotation: 45,
    number: 7,
  }));
  const pad = store.getFootprint().pads[0];
  assert.equal(pad.w, 3);
  assert.equal(pad.h, 2);
  assert.equal(pad.shape, 'circle');
  assert.equal(pad.layer, 'tht');
  assert.equal(pad.drill, 0.8);
  assert.equal(pad.rotation, 45);
  assert.equal(pad.number, '7');

  executeFootprintCommand(store, updatePadCommand('pad-1', { shape: 'bad', layer: 'bad', w: -5 }));
  const unchanged = store.getFootprint().pads[0];
  assert.equal(unchanged.shape, 'circle');
  assert.equal(unchanged.layer, 'tht');
  assert.equal(unchanged.w, 3);
  store.undo();
  assert.equal(store.getFootprint().pads[0].w, 3);
});

test('addGraphicCommand 默认 silkscreen、生成 id；updateGraphicCommand 修改属性', () => {
  const store = createFootprintStore(makeFootprint());
  const command = executeFootprintCommand(store, addGraphicCommand({
    id: 'gfx-new',
    type: 'rect',
    x: 0,
    y: 0,
    w: 2,
    h: 2,
  }));
  assert.equal(command.result, 'gfx-new');
  const graphic = store.getFootprint().graphics.find((item) => item.id === 'gfx-new');
  assert.equal(graphic.layer, 'silkscreen');
  assert.equal(graphic.type, 'rect');

  executeFootprintCommand(store, updateGraphicCommand('gfx-new', { layer: 'courtyard', width: 0.3, fill: true }));
  const updated = store.getFootprint().graphics.find((item) => item.id === 'gfx-new');
  assert.equal(updated.layer, 'courtyard');
  assert.equal(updated.width, 0.3);
  assert.equal(updated.fill, true);
  store.undo();
  assert.equal(store.getFootprint().graphics.find((item) => item.id === 'gfx-new').layer, 'silkscreen');
});

test('createFootprintCommandApi 门面与未绑定命令报错', () => {
  const store = createFootprintStore(makeFootprint());
  const api = createFootprintCommandApi(store);
  const command = api.addPad({ id: 'api-pad', x: 1, y: 1, w: 1, h: 1 });
  assert.equal(command.result, 'api-pad');
  api.removeEntities(['api-pad']);
  assert.equal(store.getFootprint().pads.length, 2);
  store.undo();
  assert.equal(store.getFootprint().pads.length, 3);
  assert.throws(() => addPadCommand({ x: 0, y: 0 }).do(), /未绑定 store/);
  assert.throws(() => createFootprintCommandApi(null), TypeError);
});
