// 几何纯函数单元测试：点变换顺序、距离、吸附、矩形与包围盒。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pt,
  add,
  sub,
  scale,
  dist,
  len,
  snapV,
  snapPt,
  rotatePoint,
  mirrorPoint,
  segmentDistance,
  pointInRect,
  rectFromPoints,
  rectsIntersect,
  bboxOfPoints,
  transformPoint,
  normalizeDeg,
  clamp,
} from '../../src/core/geometry.js';

test('点与向量基本运算', () => {
  assert.deepEqual(pt(1, 2), { x: 1, y: 2 });
  assert.deepEqual(pt(), { x: 0, y: 0 });
  assert.deepEqual(add({ x: 1, y: 2 }, { x: 3, y: -1 }), { x: 4, y: 1 });
  assert.deepEqual(sub({ x: 1, y: 2 }, { x: 3, y: 5 }), { x: -2, y: -3 });
  assert.deepEqual(scale({ x: 2, y: -3 }, 2), { x: 4, y: -6 });
  assert.equal(dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(len({ x: 3, y: 4 }), 5);
});

test('snapV / snapPt 按栅格吸附并消除负零', () => {
  assert.equal(snapV(2.6, 2.54), 2.54);
  assert.equal(snapV(5.1, 2.54), 5.08);
  assert.equal(snapV(-0.0000001, 2.54), 0);
  assert.ok(Object.is(snapV(0, 2.54), 0));
  assert.equal(snapV(3.3, 0), 3.3);
  assert.deepEqual(snapPt({ x: 2.6, y: 5.1 }, 2.54), { x: 2.54, y: 5.08 });
});

test('rotatePoint 对 90 的倍数给出精确结果', () => {
  assert.deepEqual(rotatePoint({ x: 1, y: 0 }, 90), { x: 0, y: 1 });
  assert.deepEqual(rotatePoint({ x: 1, y: 0 }, 180), { x: -1, y: 0 });
  assert.deepEqual(rotatePoint({ x: 1, y: 0 }, 270), { x: 0, y: -1 });
  assert.deepEqual(rotatePoint({ x: 2, y: 3 }, 180, { x: 1, y: 1 }), { x: 0, y: -1 });
  const diagonal = rotatePoint({ x: 1, y: 0 }, 45);
  assert.ok(Math.abs(diagonal.x - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(diagonal.y - Math.SQRT1_2) < 1e-12);
});

test('mirrorPoint 沿垂直轴镜像', () => {
  assert.deepEqual(mirrorPoint({ x: 3, y: 4 }), { x: -3, y: 4 });
  assert.deepEqual(mirrorPoint({ x: 3, y: 4 }, { x: 10, y: 0 }), { x: 17, y: 4 });
});

test('transformPoint 顺序为 mirror -> rotate -> translate', () => {
  const withMirror = transformPoint({ x: 1, y: 0 }, { x: 10, y: 20, rotation: 90, mirror: true });
  assert.deepEqual(withMirror, { x: 10, y: 19 });

  const rotated = transformPoint({ x: 1, y: 2 }, { x: 5, y: 5, rotation: 180, mirror: false });
  assert.deepEqual(rotated, { x: 4, y: 3 });

  const identity = transformPoint({ x: 7, y: 8 }, {});
  assert.deepEqual(identity, { x: 7, y: 8 });
});

test('segmentDistance 覆盖投影、端外与退化线段', () => {
  assert.equal(segmentDistance({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
  assert.equal(segmentDistance({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 5);
  assert.equal(segmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
  assert.equal(segmentDistance({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 0);
});

test('矩形工具：构造、包含、相交', () => {
  assert.deepEqual(rectFromPoints({ x: 10, y: 10 }, { x: 0, y: 0 }), { x: 0, y: 0, w: 10, h: 10 });
  const rect = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(pointInRect({ x: 0, y: 0 }, rect), true);
  assert.equal(pointInRect({ x: 10, y: 10 }, rect), true);
  assert.equal(pointInRect({ x: 11, y: 5 }, rect), false);
  assert.equal(pointInRect({ x: 5, y: 5 }, { x: 10, y: 10, w: -10, h: -10 }), true);
  assert.equal(rectsIntersect(rect, { x: 10, y: 10, w: 5, h: 5 }), true);
  assert.equal(rectsIntersect(rect, { x: 11, y: 11, w: 5, h: 5 }), false);
  assert.equal(rectsIntersect(rect, { x: 5, y: 5, w: -2, h: -2 }), true);
});

test('bboxOfPoints 计算包围盒并处理空集', () => {
  assert.deepEqual(bboxOfPoints([{ x: 0, y: 0 }, { x: 10, y: 5 }]), { x: 0, y: 0, w: 10, h: 5 });
  assert.deepEqual(bboxOfPoints([{ x: 4, y: -2 }]), { x: 4, y: -2, w: 0, h: 0 });
  assert.deepEqual(bboxOfPoints([]), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepEqual(bboxOfPoints([{ x: NaN, y: 1 }]), { x: 0, y: 0, w: 0, h: 0 });
});

test('角度规范化与夹取', () => {
  assert.equal(normalizeDeg(-90), 270);
  assert.equal(normalizeDeg(450), 90);
  assert.equal(normalizeDeg(360), 0);
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(-2, 0, 10), 0);
});
