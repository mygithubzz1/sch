// 吸附纯函数测试：锚点收集、最近点命中、栅格取整与去重。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectAnchors,
  collectJunctionAnchors,
  collectLabelAnchors,
  collectPinAnchors,
  collectWireAnchors,
  dedupePoints,
  findSnapPoint,
  resolveSnapPoint,
  snapToGrid,
} from '../../src/editor/snapping.js';
import {
  createJunction,
  createLabel,
  createProject,
  createSymbolInstance,
  createWire,
} from '../../src/model/project.js';

function approx(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, message + '：' + actual + ' != ' + expected);
}

function makeSheet() {
  const project = createProject('吸附');
  const sheet = project.sheets[0];
  sheet.symbols.push(createSymbolInstance({ id: 'sym-r', symbolId: 'R', designator: 'R1', x: 10, y: 10 }));
  const wire = createWire([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]);
  sheet.wires.push(wire);
  sheet.junctions.push(createJunction(5, 0));
  sheet.labels.push(createLabel({ id: 'lbl-a', x: 2.54, y: 2.54, text: 'A' }));
  return { project, sheet, wire };
}

test('collectPinAnchors 收集符号引脚端点并在世界坐标下变换', () => {
  const { project, sheet } = makeSheet();
  const pins = collectPinAnchors(project, sheet);
  assert.equal(pins.length, 2);
  approx(pins[0].x, 10, 'pin1.x');
  approx(pins[0].y, 4.92, 'pin1.y');
  approx(pins[1].x, 10, 'pin2.x');
  approx(pins[1].y, 15.08, 'pin2.y');
});

test('collectPinAnchors 支持旋转与镜像变换', () => {
  const project = createProject('变换');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ id: 'rot', symbolId: 'R', rotation: 90, x: 10, y: 10 }),
    createSymbolInstance({ id: 'mir', symbolId: 'R', mirror: true, x: 20, y: 10 }),
  );
  const pins = collectPinAnchors(project, sheet);
  const rotated = pins.find((point) => Math.abs(point.x - 15.08) < 1e-9 && Math.abs(point.y - 10) < 1e-9);
  assert.ok(rotated, '旋转 90° 后引脚应到 (15.08,10)');
  const mirrored = pins.find((point) => Math.abs(point.x - 20) < 1e-9 && Math.abs(point.y - 4.92) < 1e-9);
  assert.ok(mirrored, '沿 Y 轴镜像后 x 不变');
});

test('collectAnchors 合并引脚/导线/结点/标签并去重', () => {
  const { project, sheet } = makeSheet();
  const anchors = collectAnchors(project, sheet);
  // 2 引脚 + 导线 3 点（junction 与 (5,0) 重合）+ 标签 1 点。
  assert.equal(anchors.length, 6);
  const has = (x, y) => anchors.some((point) => Math.abs(point.x - x) < 1e-9 && Math.abs(point.y - y) < 1e-9);
  assert.ok(has(10, 4.92));
  assert.ok(has(0, 0));
  assert.ok(has(5, 5));
  assert.ok(has(2.54, 2.54));
});

test('collectWireAnchors / collectJunctionAnchors / collectLabelAnchors 各自覆盖来源', () => {
  const { sheet } = makeSheet();
  assert.equal(collectWireAnchors(sheet).length, 3);
  assert.equal(collectJunctionAnchors(sheet).length, 1);
  assert.equal(collectLabelAnchors(sheet).length, 1);
});

test('excludeIds 可排除选中实体自身的锚点', () => {
  const { project, sheet, wire } = makeSheet();
  const anchors = collectAnchors(project, sheet, { excludeIds: ['sym-r', wire.id] });
  const hasPin = anchors.some((point) => Math.abs(point.y - 4.92) < 1e-9);
  const hasWire = anchors.some((point) => Math.abs(point.x - 5) < 1e-9 && Math.abs(point.y - 5) < 1e-9);
  assert.equal(hasPin, false);
  assert.equal(hasWire, false);
  assert.equal(anchors.length, 2); // junction + label
});

test('未知符号被跳过且不抛异常', () => {
  const project = createProject('未知');
  const sheet = project.sheets[0];
  sheet.symbols.push(createSymbolInstance({ id: 'missing', symbolId: 'NOT_A_SYMBOL', x: 3, y: 3 }));
  assert.deepEqual(collectPinAnchors(project, sheet), []);
  assert.deepEqual(collectAnchors(project, sheet), []);
});

test('findSnapPoint 命中、多候选取最近、超容差返回 null', () => {
  const anchors = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  assert.deepEqual(findSnapPoint(anchors, { x: 0.4, y: 0 }, 1), { x: 0, y: 0 });
  assert.deepEqual(findSnapPoint(anchors, { x: 0.6, y: 0 }, 1), { x: 1, y: 0 });
  assert.equal(findSnapPoint(anchors, { x: 5, y: 5 }, 1), null);
  assert.deepEqual(findSnapPoint(anchors, { x: 1, y: 0 }, 0), { x: 1, y: 0 });
});

test('findSnapPoint 容差为负或输入非法时安全返回 null', () => {
  assert.equal(findSnapPoint([{ x: 0, y: 0 }], { x: 0, y: 0 }, -1), null);
  assert.equal(findSnapPoint(null, { x: 0, y: 0 }, 1), null);
  assert.equal(findSnapPoint([{ x: 0, y: 0 }], null, 1), null);
  // 非有限容差按 0 处理，仅精确命中。
  assert.deepEqual(findSnapPoint([{ x: 0, y: 0 }], { x: 0, y: 0 }, NaN), { x: 0, y: 0 });
});

test('findSnapPoint 返回锚点副本而不是原对象', () => {
  const anchor = { x: 2, y: 3 };
  const hit = findSnapPoint([anchor], { x: 2.1, y: 3.1 }, 1);
  assert.deepEqual(hit, { x: 2, y: 3 });
  hit.x = 99;
  assert.equal(anchor.x, 2);
});

test('snapToGrid 默认 2.54 与 0.635 栅格取整', () => {
  assert.deepEqual(snapToGrid({ x: 2.5, y: 5.1 }), { x: 2.54, y: 5.08 });
  assert.deepEqual(snapToGrid({ x: 2.5, y: 5.1 }, 0.635), { x: 2.54, y: 5.08 });
  assert.deepEqual(snapToGrid({ x: 0.3, y: -0.3 }, 0), { x: 0.3, y: -0.3 });
  assert.deepEqual(snapToGrid(null, 2.54), { x: 0, y: 0 });
  assert.deepEqual(snapToGrid({ x: '1.27', y: '2.54' }, 1.27), { x: 1.27, y: 2.54 });
});

test('resolveSnapPoint 优先锚点，否则回落到栅格', () => {
  assert.deepEqual(resolveSnapPoint({ x: 9.9, y: 10.1 }, [{ x: 10, y: 10 }], 2.54, 0.5), { x: 10, y: 10 });
  assert.deepEqual(resolveSnapPoint({ x: 9.9, y: 10.1 }, [], 2.54, 0.1), { x: 10.16, y: 10.16 });
});

test('dedupePoints 去重并清理非法点', () => {
  const points = dedupePoints([
    { x: 1, y: 2 },
    { x: 1.0000001, y: 2 },
    { x: NaN, y: 2 },
    { x: 3, y: 4 },
    null,
  ]);
  assert.equal(points.length, 2);
  assert.deepEqual(points[1], { x: 3, y: 4 });
});

test('sheet 缺失时所有收集函数返回空数组', () => {
  const project = createProject('空');
  assert.deepEqual(collectAnchors(project, null), []);
  assert.deepEqual(collectWireAnchors(null), []);
  assert.deepEqual(collectJunctionAnchors(null), []);
  assert.deepEqual(collectLabelAnchors(null), []);
});
