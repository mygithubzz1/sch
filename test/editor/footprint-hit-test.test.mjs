// 封装命中测试：旋转焊盘、图形（线/矩形/圆/弧/文本）、框选与联合包围盒。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeFootprintEntity,
  footprintBoundsOfIds,
  graphicBounds,
  hitTestFootprint,
  hitTestFootprintBox,
  hitTestGraphic,
  hitTestPad,
  padBounds,
} from '../../src/editor/footprint-hit-test.js';

function makeFootprint() {
  return {
    id: 'FP',
    name: '命中测试',
    pads: [
      { id: 'p1', number: '1', x: 0, y: 0, w: 2, h: 1, shape: 'rect', rotation: 0, layer: 'top', drill: 0 },
      { id: 'p2', number: '2', x: 10, y: 0, w: 1, h: 1, shape: 'circle', rotation: 0, layer: 'top', drill: 0 },
      { id: 'p3', number: '3', x: 20, y: 0, w: 4, h: 1, shape: 'rect', rotation: 90, layer: 'bottom', drill: 0 },
    ],
    graphics: [
      { id: 'g1', type: 'line', points: [{ x: 0, y: 5 }, { x: 10, y: 5 }], width: 0.15, layer: 'silkscreen' },
      { id: 'g2', type: 'rect', x: -1, y: -1, w: 2, h: 2, width: 0.15, layer: 'courtyard', fill: false },
      { id: 'g3', type: 'circle', cx: 30, cy: 0, r: 2, width: 0.15, layer: 'assembly' },
      { id: 'g4', type: 'text', x: 40, y: 0, text: 'REF', size: 1, rotation: 0, layer: 'fab' },
    ],
  };
}

test('hitTestPad 命中矩形/圆形焊盘中心与边缘', () => {
  const footprint = makeFootprint();
  assert.equal(hitTestPad(footprint, { x: 0, y: 0 }).id, 'p1');
  assert.equal(hitTestPad(footprint, { x: 0.9, y: 0.4 }).id, 'p1');
  assert.equal(hitTestPad(footprint, { x: 1.3, y: 0 }, { tolerance: 0.2 }), null);
  assert.equal(hitTestPad(footprint, { x: 10, y: 0 }).id, 'p2');
  assert.equal(hitTestPad(footprint, { x: 10.45, y: 0 }, { tolerance: 0.1 }).id, 'p2');
});

test('hitTestPad 考虑焊盘旋转（旋转 90 度后宽高互换）', () => {
  const footprint = makeFootprint();
  // p3 原始 4x1，旋转 90 度后覆盖 x ±0.5、y ±2。
  assert.equal(hitTestPad(footprint, { x: 20, y: 1.8 }).id, 'p3');
  assert.equal(hitTestPad(footprint, { x: 21.8, y: 0 }), null);
});

test('padBounds 返回旋转后包围盒', () => {
  const footprint = makeFootprint();
  const box = padBounds(footprint.pads[2]);
  assert.ok(Math.abs(box.w - 1) < 1e-9);
  assert.ok(Math.abs(box.h - 4) < 1e-9);
});

test('hitTestGraphic 命中线/矩形边/圆环/文本', () => {
  const footprint = makeFootprint();
  assert.equal(hitTestGraphic(footprint, { x: 5, y: 5.1 }).id, 'g1');
  assert.equal(hitTestGraphic(footprint, { x: 0, y: -1 }).id, 'g2');
  assert.equal(hitTestGraphic(footprint, { x: 0, y: 0 }), null); // 矩形内部未填充不选中
  assert.equal(hitTestGraphic(footprint, { x: 30, y: 2.1 }).id, 'g3');
  assert.equal(hitTestGraphic(footprint, { x: 40, y: 0 }).id, 'g4');
});

test('hitTestFootprint 焊盘优先于图形', () => {
  const footprint = makeFootprint();
  const hit = hitTestFootprint(footprint, { x: 0, y: 0 });
  assert.equal(hit.kind, 'pad');
  assert.equal(hit.id, 'p1');
});

test('graphicBounds 覆盖各类图形', () => {
  const footprint = makeFootprint();
  assert.deepEqual(graphicBounds(footprint.graphics[0]), { x: 0, y: 5, w: 10, h: 0 });
  assert.deepEqual(graphicBounds(footprint.graphics[1]), { x: -1, y: -1, w: 2, h: 2 });
  assert.deepEqual(graphicBounds(footprint.graphics[2]), { x: 28, y: -2, w: 4, h: 4 });
});

test('hitTestFootprintBox 返回相交焊盘与图形', () => {
  const footprint = makeFootprint();
  const ids = hitTestFootprintBox(footprint, { x: -2, y: -2, w: 8, h: 8 });
  assert.ok(ids.includes('p1'));
  assert.ok(ids.includes('g1'));
  assert.ok(ids.includes('g2'));
  assert.ok(!ids.includes('p2'));
});

test('describeFootprintEntity 与 footprintBoundsOfIds', () => {
  const footprint = makeFootprint();
  assert.equal(describeFootprintEntity(footprint, 'p1').kind, 'pad');
  assert.equal(describeFootprintEntity(footprint, 'g1').kind, 'graphic');
  assert.equal(describeFootprintEntity(footprint, 'missing'), null);
  const box = footprintBoundsOfIds(footprint, ['p1', 'g1', 'missing']);
  assert.equal(box.x, -1);
  assert.ok(box.w >= 11);
  assert.deepEqual(footprintBoundsOfIds(footprint, []), { x: 0, y: 0, w: 0, h: 0 });
});
