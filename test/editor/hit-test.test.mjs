// 命中测试：符号/导线/结点/标签/文本框选与包围盒。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsOfIds,
  describeEntity,
  entityBounds,
  hitTest,
  hitTestBox,
} from '../../src/editor/hit-test.js';
import { createProject, createSymbolInstance } from '../../src/model/project.js';
import { makeProject } from './fixtures.mjs';

test('点选符号本体返回符号实体', () => {
  const project = makeProject();
  const sheet = project.sheets[0];
  const hit = hitTest(sheet, { x: 20.32, y: 20.32 }, { tolerance: 0.4 });
  assert.ok(hit);
  assert.equal(hit.id, 'sym-r1');
  assert.equal(hit.kind, 'symbols');
});

test('点选导线端点附近与线段中部都能命中', () => {
  const sheet = makeProject().sheets[0];
  const middle = hitTest(sheet, { x: 5, y: 0.3 }, { tolerance: 0.5 });
  assert.equal(middle && middle.kind, 'wires');
  assert.equal(middle && middle.id, 'wire-1');
  const endpoint = hitTest(sheet, { x: 0.1, y: 0.1 }, { tolerance: 0.5 });
  assert.equal(endpoint && endpoint.id, 'wire-1');
  assert.equal(hitTest(sheet, { x: 5, y: 5 }, { tolerance: 0.2 }), null);
});

test('结点优先于标签/文本/符号/导线', () => {
  const sheet = makeProject().sheets[0];
  const hit = hitTest(sheet, { x: 10, y: 0 }, { tolerance: 0.2 });
  assert.equal(hit && hit.kind, 'junctions');
  assert.equal(hit && hit.id, 'jct-1');
});

test('标签锚点与文本注释可被选中', () => {
  const sheet = makeProject().sheets[0];
  const label = hitTest(sheet, { x: 0, y: 10 }, { tolerance: 0.3 });
  assert.equal(label && label.kind, 'labels');
  assert.equal(label && label.id, 'lbl-1');
  const text = hitTest(sheet, { x: 0, y: 20 }, { tolerance: 0.3 });
  assert.equal(text && text.kind, 'texts');
  assert.equal(text && text.id, 'txt-1');
});

test('缺失符号定义使用占位包围盒', () => {
  const project = createProject('占位');
  const sheet = project.sheets[0];
  sheet.symbols.push(createSymbolInstance({ id: 'missing', symbolId: 'NOPE', x: 50, y: 50 }));
  const hit = hitTest(sheet, { x: 51, y: 51 }, { tolerance: 0 });
  assert.equal(hit && hit.id, 'missing');
});

test('框选返回包围盒相交的实体 id', () => {
  const sheet = makeProject().sheets[0];
  const wireIds = hitTestBox(sheet, { x: -2, y: -2, w: 14, h: 4 });
  assert.deepEqual(wireIds, ['wire-1', 'jct-1']);

  const symbolIds = hitTestBox(sheet, { x: 14, y: 14, w: 12, h: 12 });
  assert.deepEqual(symbolIds, ['sym-r1']);

  const labelIds = hitTestBox(sheet, { x: -2, y: 8, w: 10, h: 4 });
  assert.deepEqual(labelIds, ['lbl-1']);
});

test('entityBounds 覆盖导线/结点/标签/文本/符号', () => {
  const sheet = makeProject().sheets[0];
  const wire = entityBounds(sheet, 'wires', sheet.wires[0]);
  assert.deepEqual(wire, { x: 0, y: 0, w: 10, h: 0 });
  const junction = entityBounds(sheet, 'junctions', sheet.junctions[0]);
  assert.equal(junction.w, 1.2);
  const label = entityBounds(sheet, 'labels', sheet.labels[0]);
  assert.ok(label.w > 1);
  assert.ok(label.x <= 0);
  const text = entityBounds(sheet, 'texts', sheet.texts[0]);
  assert.ok(text.w > 1);
  const symbol = entityBounds(sheet, 'symbols', sheet.symbols[0], {
    resolveSymbol: () => null,
  });
  assert.deepEqual(symbol, { x: 17.78, y: 17.78, w: 5.08, h: 5.08 });
});

test('describeEntity 返回类型与实体，未知 id 返回 null', () => {
  const sheet = makeProject().sheets[0];
  assert.equal(describeEntity(sheet, 'lbl-1').kind, 'labels');
  assert.equal(describeEntity(sheet, 'missing'), null);
  assert.equal(describeEntity(null, 'x'), null);
});

test('boundsOfIds 计算多实体联合包围盒并忽略未知 id', () => {
  const sheet = makeProject().sheets[0];
  const box = boundsOfIds(sheet, ['sym-r1', 'sym-r2', 'missing']);
  assert.ok(box.x <= 20.32 - 2.5);
  assert.ok(box.w > 20);
  assert.deepEqual(boundsOfIds(sheet, ['missing']), { x: 0, y: 0, w: 0, h: 0 });
});
