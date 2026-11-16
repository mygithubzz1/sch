// 封装库测试：增删查、检索、序列化往返与焊盘校验。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAD_LAYERS,
  PAD_SHAPES,
  createFootprintLibrary,
  normalizeFootprintDef,
  normalizePad,
  validateFootprintDef,
} from '../../src/library/footprint-library.js';
import { builtinFootprints } from '../../src/library/builtin-footprints.js';

function customFootprint(overrides = {}) {
  return {
    id: 'FP1',
    name: '测试封装',
    description: 'Test Footprint',
    pads: [{ number: '1', x: 0, y: 0, w: 1, h: 1, shape: 'roundrect', layer: 'top', drill: 0 }],
    graphics: [{ type: 'rect', layer: 'silkscreen', x: -1, y: -1, w: 2, h: 2 }],
    ...overrides,
  };
}

test('createFootprintLibrary 支持增删查与尺寸统计', () => {
  const library = createFootprintLibrary();
  assert.deepEqual(library.list(), []);
  assert.equal(library.size(), 0);
  assert.equal(library.get('FP1'), null);
  assert.equal(library.get(null), null);

  library.add(customFootprint());
  assert.equal(library.size(), 1);
  assert.equal(library.has('FP1'), true);
  assert.deepEqual(library.ids(), ['FP1']);
  assert.equal(library.remove('FP1'), true);
  assert.equal(library.remove('FP1'), false);
});

test('search 忽略大小写并匹配 id/name/description', () => {
  const library = createFootprintLibrary([
    { id: 'R_0805', name: 'R 0805', description: '0805 贴片电阻', pads: [], graphics: [] },
    { id: 'C_0603', name: 'C 0603', description: '0603 贴片电容', pads: [], graphics: [] },
  ]);
  assert.equal(library.search('').length, 2);
  assert.deepEqual(library.search('0805').map((item) => item.id), ['R_0805']);
  assert.deepEqual(library.search('电容').map((item) => item.id), ['C_0603']);
  assert.deepEqual(library.search('r_08').map((item) => item.id), ['R_0805']);
  assert.deepEqual(library.search('missing'), []);
});

test('toJSON / fromJSON 往返保持一致', () => {
  const library = createFootprintLibrary(builtinFootprints());
  const json = library.toJSON();
  assert.equal(json.version, 1);
  assert.equal(json.footprints.length, 10);

  const restored = createFootprintLibrary();
  restored.fromJSON(json);
  assert.deepEqual(restored.list(), library.list());
  assert.equal(JSON.stringify(restored.toJSON()), JSON.stringify(library.toJSON()));
  assert.throws(() => restored.fromJSON(null), TypeError);
});

test('normalizeFootprintDef 补齐缺省字段并规范化焊盘', () => {
  const footprint = normalizeFootprintDef({ id: 'FP2' });
  assert.equal(footprint.name, 'FP2');
  assert.equal(footprint.description, '');
  assert.deepEqual(footprint.pads, []);
  assert.deepEqual(footprint.graphics, []);

  const pad = normalizePad({});
  assert.equal(pad.number, '1');
  assert.equal(pad.id, 'pad-1');
  assert.equal(pad.shape, 'rect');
  assert.equal(pad.layer, 'top');
  assert.equal(pad.drill, 0);
  assert.deepEqual({ w: pad.w, h: pad.h }, { w: 1, h: 1 });

  const normalized = normalizeFootprintDef({
    id: 'FP3',
    pads: [{ number: 2, w: '-2', h: 0, shape: 'bogus', layer: 'bogus', drill: '-1' }],
    graphics: [{ type: 'rect', layer: 'bogus', x: 0, y: 0, w: 1, h: 1 }],
  });
  assert.equal(normalized.pads[0].number, '2');
  assert.deepEqual({ w: normalized.pads[0].w, h: normalized.pads[0].h }, { w: 1, h: 1 });
  assert.equal(normalized.pads[0].shape, 'rect');
  assert.equal(normalized.pads[0].layer, 'top');
  assert.equal(normalized.pads[0].drill, 0);
  assert.equal(normalized.graphics[0].layer, 'silkscreen');
});

test('validateFootprintDef 捕获重复编号、非法图层与通孔缺钻孔', () => {
  assert.equal(validateFootprintDef(normalizeFootprintDef(customFootprint())).ok, true);

  const bad = validateFootprintDef({
    id: '',
    name: '',
    pads: [
      { id: 'a', number: '1', x: 0, y: 0, w: 1, h: 1, shape: 'rect', layer: 'tht', drill: 0 },
      { id: 'a', number: '1', x: 0, y: 0, w: -1, h: 1, shape: 'bogus', layer: 'bogus', drill: -1 },
    ],
    graphics: [{ type: 'rect', layer: 'bogus', x: 0, y: 0, w: 1, h: 1 }],
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.some((message) => message.includes('footprint.id')), true);
  assert.equal(bad.errors.some((message) => message.includes('重复')), true);
  assert.equal(bad.errors.some((message) => message.includes('drill')), true);
  assert.equal(bad.errors.some((message) => message.includes('layer')), true);
  assert.equal(validateFootprintDef(null).ok, false);
});

test('枚举常量覆盖契约取值', () => {
  assert.deepEqual([...PAD_SHAPES], ['rect', 'roundrect', 'circle', 'oval']);
  assert.deepEqual([...PAD_LAYERS], ['top', 'bottom', 'tht']);
});
