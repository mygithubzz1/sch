// 符号库测试：增删查、检索、序列化往返与定义校验。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIN_ELECTRICAL_TYPES,
  PIN_ORIENTATIONS,
  createSymbolLibrary,
  normalizePin,
  normalizeSymbolDef,
  validateSymbolDef,
} from '../../src/library/symbol-library.js';
import { builtinSymbols } from '../../src/library/builtin-symbols.js';

function customSymbol(overrides = {}) {
  return {
    id: 'X1',
    name: '测试符号',
    refPrefix: 'X',
    description: 'Test Widget',
    power: false,
    pins: [
      { number: '1', name: 'A', x: 0, y: -2.54, length: 2.54, orientation: 'down', electricalType: 'passive' },
    ],
    graphics: [{ type: 'rect', x: -1, y: -1, w: 2, h: 2 }],
    ...overrides,
  };
}

test('createSymbolLibrary 支持增删查与尺寸统计', () => {
  const library = createSymbolLibrary();
  assert.deepEqual(library.list(), []);
  assert.equal(library.size(), 0);
  assert.equal(library.get('X1'), null);
  assert.equal(library.get(42), null);
  assert.equal(library.get(null), null);

  const added = library.add(customSymbol());
  assert.equal(added.id, 'X1');
  assert.equal(library.size(), 1);
  assert.equal(library.has('X1'), true);
  assert.equal(library.has('x1'), false);
  assert.equal(library.get('X1').name, '测试符号');
  assert.deepEqual(library.ids(), ['X1']);

  assert.equal(library.remove('X1'), true);
  assert.equal(library.remove('X1'), false);
  assert.equal(library.remove(null), false);
  assert.equal(library.size(), 0);
});

test('add 覆盖同 id 定义并返回规范化结果', () => {
  const library = createSymbolLibrary();
  library.add(customSymbol());
  library.add(customSymbol({ name: '新名字' }));
  assert.equal(library.size(), 1);
  assert.equal(library.get('X1').name, '新名字');
  assert.equal(library.get('X1').power, false);
});

test('add 缺少非空 id 时抛 TypeError', () => {
  const library = createSymbolLibrary();
  assert.throws(() => library.add({ name: '没有 id' }), TypeError);
  assert.throws(() => library.add({ id: '   ' }), TypeError);
  assert.throws(() => library.add(null), TypeError);
  assert.equal(library.size(), 0);
});

test('search 忽略大小写并匹配 id/name/refPrefix/description', () => {
  const library = createSymbolLibrary([
    { id: 'R', name: '电阻', refPrefix: 'R', description: 'Resistor', pins: [], graphics: [] },
    { id: 'C', name: '电容', refPrefix: 'C', description: 'Capacitor', pins: [], graphics: [] },
    { id: 'GND', name: 'GND', refPrefix: '#PWR', description: '地（电源符号）', pins: [], graphics: [] },
  ]);

  assert.equal(library.search('').length, 3);
  assert.deepEqual(library.search('rEsIs').map((item) => item.id), ['R']);
  assert.deepEqual(library.search('电容').map((item) => item.id), ['C']);
  assert.deepEqual(library.search('pwr').map((item) => item.id), ['GND']);
  assert.deepEqual(library.search('  c  ').map((item) => item.id), ['C']);
  assert.deepEqual(library.search('不存在的关键字'), []);
});

test('toJSON / fromJSON 往返保持一致且接受数组或包装对象', () => {
  const library = createSymbolLibrary(builtinSymbols());
  const json = library.toJSON();
  assert.equal(json.version, 1);
  assert.equal(json.symbols.length, 18);

  const restored = createSymbolLibrary();
  restored.fromJSON(json);
  assert.deepEqual(restored.list(), library.list());

  const fromArray = createSymbolLibrary();
  fromArray.fromJSON(json.symbols);
  assert.equal(fromArray.size(), 18);

  assert.equal(JSON.stringify(restored.toJSON()), JSON.stringify(library.toJSON()));
});

test('fromJSON 非法输入抛错且不破坏原有内容', () => {
  const library = createSymbolLibrary([customSymbol()]);
  assert.throws(() => library.fromJSON(null), TypeError);
  assert.throws(() => library.fromJSON({ nope: [] }), TypeError);
  assert.throws(() => library.fromJSON([{ id: '' }]), TypeError);
  assert.equal(library.size(), 1);
  assert.equal(library.has('X1'), true);
});

test('normalizeSymbolDef 补齐缺省字段', () => {
  const symbol = normalizeSymbolDef({ id: 'Y' });
  assert.equal(symbol.name, 'Y');
  assert.equal(symbol.refPrefix, 'U');
  assert.equal(symbol.description, '');
  assert.equal(symbol.power, false);
  assert.deepEqual(symbol.pins, []);
  assert.deepEqual(symbol.graphics, []);

  const pin = normalizePin({});
  assert.equal(pin.number, '1');
  assert.equal(pin.id, 'pin-1');
  assert.equal(pin.orientation, 'right');
  assert.equal(pin.electricalType, 'passive');
  assert.equal(pin.length, 0);
  assert.deepEqual({ x: pin.x, y: pin.y }, { x: 0, y: 0 });

  const normalized = normalizeSymbolDef({ id: 'Z', pins: [{ number: 2, x: '1', y: '2', length: '-1', orientation: '斜', electricalType: 'unknown' }] });
  assert.equal(normalized.pins[0].number, '2');
  assert.equal(normalized.pins[0].length, 0);
  assert.equal(normalized.pins[0].orientation, 'right');
  assert.equal(normalized.pins[0].electricalType, 'passive');
});

test('validateSymbolDef 捕获非法引脚、重复编号与缺失电源引脚', () => {
  assert.equal(validateSymbolDef(normalizeSymbolDef(customSymbol())).ok, true);

  const bad = validateSymbolDef({
    id: '',
    name: '',
    refPrefix: '',
    pins: [
      { id: 'a', number: '1', x: 0, y: 0, length: 1, orientation: 'up', electricalType: 'input' },
      { id: 'a', number: '1', x: 0, y: 0, length: 1, orientation: 'up', electricalType: 'bogus' },
      { id: 'b', number: '2', x: 'x', y: 0, length: -1, orientation: 'bogus', electricalType: 'passive' },
    ],
    graphics: [{ type: 'polyline', points: [{ x: 0, y: 0 }] }],
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.some((message) => message.includes('symbol.id')), true);
  assert.equal(bad.errors.some((message) => message.includes('重复')), true);
  assert.equal(bad.errors.some((message) => message.includes('orientation')), true);
  assert.equal(bad.errors.some((message) => message.includes('polyline')), true);

  const powerWithoutPowerPin = validateSymbolDef({
    id: 'PWR',
    name: 'PWR',
    refPrefix: '#PWR',
    power: true,
    pins: [{ id: 'p1', number: '1', x: 0, y: 0, length: 0, orientation: 'down', electricalType: 'passive' }],
    graphics: [{ type: 'line', points: [{ x: 0, y: 0 }, { x: 0, y: 1 }] }],
  });
  assert.equal(powerWithoutPowerPin.ok, false);
  assert.equal(powerWithoutPowerPin.errors.some((message) => message.includes('power')), true);

  assert.equal(validateSymbolDef(null).ok, false);
});

test('枚举常量覆盖契约取值', () => {
  assert.deepEqual([...PIN_ORIENTATIONS], ['left', 'right', 'up', 'down']);
  assert.deepEqual([...PIN_ELECTRICAL_TYPES], [
    'input',
    'output',
    'bidirectional',
    'passive',
    'power_in',
    'power_out',
    'open_collector',
    'not_connected',
  ]);
});
