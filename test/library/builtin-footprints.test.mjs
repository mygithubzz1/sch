// 内置封装测试：数量、焊盘编号唯一、图层与钻孔合法、丝印/courtyard 完整。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAD_LAYERS,
  PAD_SHAPES,
  validateFootprintDef,
} from '../../src/library/footprint-library.js';
import { FOOTPRINT_LAYERS, GRAPHIC_TYPES } from '../../src/library/graphic.js';
import { builtinFootprints } from '../../src/library/builtin-footprints.js';

const REQUIRED_IDS = [
  'R_0402',
  'R_0603',
  'R_0805',
  'C_0603',
  'SOT-23',
  'SOIC-8',
  'DIP-8',
  'PIN_HDR_1x2',
  'PIN_HDR_1x4',
  'QFP-32',
];

function byId(id) {
  return builtinFootprints().find((footprint) => footprint.id === id);
}

test('内置封装至少 10 个且 id 唯一、覆盖必需清单', () => {
  const footprints = builtinFootprints();
  assert.ok(footprints.length >= 10);
  const ids = footprints.map((footprint) => footprint.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of REQUIRED_IDS) assert.equal(ids.includes(id), true, '缺少内置封装 ' + id);
});

test('每个内置封装都通过 validateFootprintDef', () => {
  for (const footprint of builtinFootprints()) {
    const result = validateFootprintDef(footprint);
    assert.equal(result.ok, true, footprint.id + ' 校验失败：' + result.errors.join('; '));
    assert.equal(typeof footprint.name, 'string');
    assert.equal(footprint.name.length > 0, true);
    assert.equal(footprint.description.length > 0, true);
  }
});

test('焊盘编号唯一、形状/图层合法、尺寸为正', () => {
  for (const footprint of builtinFootprints()) {
    assert.ok(footprint.pads.length >= 2, footprint.id + ' 至少需要两个焊盘');
    const numbers = new Set();
    for (const pad of footprint.pads) {
      assert.equal(numbers.has(pad.number), false, footprint.id + ' 焊盘编号重复：' + pad.number);
      numbers.add(pad.number);
      assert.equal(PAD_SHAPES.includes(pad.shape), true, footprint.id + ' 焊盘形状非法');
      assert.equal(PAD_LAYERS.includes(pad.layer), true, footprint.id + ' 焊盘图层非法');
      assert.ok(pad.w > 0 && pad.h > 0, footprint.id + ' 焊盘尺寸必须为正');
      assert.equal(Number.isFinite(pad.x) && Number.isFinite(pad.y), true);
      assert.ok(pad.drill >= 0);
    }
  }
});

test('通孔焊盘带正数钻孔，贴片焊盘无钻孔', () => {
  for (const footprint of builtinFootprints()) {
    for (const pad of footprint.pads) {
      if (pad.layer === 'tht') {
        assert.ok(pad.drill > 0, footprint.id + ' 通孔焊盘缺少钻孔');
      } else {
        assert.equal(pad.drill, 0, footprint.id + ' 贴片焊盘不应有钻孔');
      }
    }
  }
  assert.equal(byId('DIP-8').pads.every((pad) => pad.layer === 'tht' && pad.drill > 0), true);
  assert.equal(byId('QFP-32').pads.every((pad) => pad.layer === 'top' && pad.drill === 0), true);
});

test('每个封装都包含 silkscreen 与 courtyard 图形', () => {
  for (const footprint of builtinFootprints()) {
    const layers = new Set(footprint.graphics.map((graphic) => graphic.layer));
    assert.equal(layers.has('silkscreen'), true, footprint.id + ' 缺少丝印');
    assert.equal(layers.has('courtyard'), true, footprint.id + ' 缺少 courtyard');
    for (const graphic of footprint.graphics) {
      assert.equal(FOOTPRINT_LAYERS.includes(graphic.layer), true, footprint.id + ' 图形图层非法');
      assert.equal(GRAPHIC_TYPES.includes(graphic.type), true, footprint.id + ' 图形类型非法');
      if (graphic.type === 'line' || graphic.type === 'polyline') {
        assert.ok(graphic.points.length >= 2);
      }
    }
  }
});

test('焊盘数量符合封装定义', () => {
  const counts = {
    R_0402: 2,
    R_0603: 2,
    R_0805: 2,
    C_0603: 2,
    'SOT-23': 3,
    'SOIC-8': 8,
    'DIP-8': 8,
    PIN_HDR_1x2: 2,
    PIN_HDR_1x4: 4,
    'QFP-32': 32,
  };
  for (const [id, expected] of Object.entries(counts)) {
    assert.equal(byId(id).pads.length, expected, id + ' 焊盘数量错误');
  }
  const qfpNumbers = byId('QFP-32').pads.map((pad) => pad.number);
  assert.equal(new Set(qfpNumbers).size, 32);
  assert.equal(qfpNumbers.includes('32'), true);
});

test('builtinFootprints 每次返回独立副本', () => {
  const first = builtinFootprints();
  const second = builtinFootprints();
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.notEqual(first[0].pads[0], second[0].pads[0]);

  first[0].pads[0].w = 99;
  first[0].id = 'MUTATED';
  assert.equal(second[0].pads[0].w, 0.54);
  assert.equal(builtinFootprints()[0].id, 'R_0402');
});
