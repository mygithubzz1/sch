// 内置符号测试：数量、电气类型、引脚栅格对齐、电源标记与图形完整性。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIN_ELECTRICAL_TYPES,
  PIN_ORIENTATIONS,
  POWER_PIN_TYPES,
  validateSymbolDef,
} from '../../src/library/symbol-library.js';
import { GRAPHIC_TYPES } from '../../src/library/graphic.js';
import { builtinSymbols } from '../../src/library/builtin-symbols.js';

const REQUIRED_IDS = [
  'R',
  'C',
  'C_POL',
  'L',
  'D',
  'LED',
  'NPN',
  'PNP',
  'GND',
  'VCC',
  '+5V',
  'SW_PUSH',
  'XTAL',
  'OPAMP',
  'IC_8',
  'MCU_16',
  'CONN_2',
  'CONN_4',
];

const POWER_IDS = ['GND', 'VCC', '+5V'];

function byId(id) {
  return builtinSymbols().find((symbol) => symbol.id === id);
}

test('内置符号至少 18 个且 id 唯一、覆盖必需清单', () => {
  const symbols = builtinSymbols();
  assert.ok(symbols.length >= 18);
  const ids = symbols.map((symbol) => symbol.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of REQUIRED_IDS) assert.equal(ids.includes(id), true, '缺少内置符号 ' + id);
});

test('每个内置符号都通过 validateSymbolDef', () => {
  for (const symbol of builtinSymbols()) {
    const result = validateSymbolDef(symbol);
    assert.equal(result.ok, true, symbol.id + ' 校验失败：' + result.errors.join('; '));
    assert.equal(typeof symbol.name, 'string');
    assert.equal(symbol.name.length > 0, true);
    assert.equal(typeof symbol.refPrefix, 'string');
    assert.equal(symbol.refPrefix.length > 0, true);
    assert.equal(typeof symbol.description, 'string');
    assert.equal(symbol.description.length > 0, true);
  }
});

test('引脚字段齐全、编号唯一、电气类型与方向合法', () => {
  for (const symbol of builtinSymbols()) {
    assert.ok(symbol.pins.length >= 1, symbol.id + ' 至少需要一个引脚');
    const numbers = new Set();
    for (const pin of symbol.pins) {
      assert.equal(typeof pin.id, 'string');
      assert.equal(typeof pin.name, 'string');
      assert.equal(typeof pin.number, 'string');
      assert.equal(numbers.has(pin.number), false, symbol.id + ' 引脚编号重复：' + pin.number);
      numbers.add(pin.number);
      assert.equal(Number.isFinite(pin.length), true);
      assert.ok(pin.length >= 0);
      assert.equal(PIN_ORIENTATIONS.includes(pin.orientation), true, symbol.id + ' 引脚方向非法');
      assert.equal(PIN_ELECTRICAL_TYPES.includes(pin.electricalType), true, symbol.id + ' 电气类型非法');
    }
  }
});

test('引脚连接端点落在 2.54mm 栅格上', () => {
  const grid = 2.54;
  for (const symbol of builtinSymbols()) {
    for (const pin of symbol.pins) {
      for (const value of [pin.x, pin.y]) {
        const steps = value / grid;
        assert.equal(Math.abs(steps - Math.round(steps)) < 1e-9, true, symbol.id + ' 引脚坐标不在栅格：' + value);
      }
    }
  }
});

test('图形全部为合法类型且至少包含一个图形', () => {
  for (const symbol of builtinSymbols()) {
    assert.ok(symbol.graphics.length >= 1, symbol.id + ' 缺少图形');
    for (const graphic of symbol.graphics) {
      assert.equal(GRAPHIC_TYPES.includes(graphic.type), true, symbol.id + ' 图形类型非法：' + graphic.type);
      if (graphic.type === 'line' || graphic.type === 'polyline') {
        assert.ok(graphic.points.length >= 2);
        for (const point of graphic.points) {
          assert.equal(Number.isFinite(point.x), true);
          assert.equal(Number.isFinite(point.y), true);
        }
      }
      if (graphic.type !== 'text') {
        assert.equal(typeof graphic.width, 'number');
        assert.ok(graphic.width > 0);
      }
    }
  }
});

test('典型图形的语义正确（电阻矩形、二极管多边形、GND 递减横线、VCC 箭头、电感弧线）', () => {
  const resistor = byId('R');
  assert.equal(resistor.graphics.some((graphic) => graphic.type === 'rect'), true);
  assert.equal(resistor.pins.length, 2);

  const diode = byId('D');
  assert.equal(diode.graphics.some((graphic) => graphic.type === 'polyline' && graphic.points.length >= 4), true);
  assert.equal(diode.graphics.some((graphic) => graphic.type === 'line'), true);

  const ground = byId('GND');
  const groundLines = ground.graphics.filter((graphic) => graphic.type === 'line');
  assert.ok(groundLines.length >= 3);
  const groundWidths = groundLines.map((graphic) => Math.abs(graphic.points[1].x - graphic.points[0].x));
  assert.ok(Math.max(...groundWidths) > Math.min(...groundWidths));

  const vcc = byId('VCC');
  assert.equal(vcc.graphics.some((graphic) => graphic.type === 'polyline' && graphic.points.length === 3), true);

  const inductor = byId('L');
  assert.equal(inductor.graphics.filter((graphic) => graphic.type === 'arc').length, 4);

  const polarized = byId('C_POL');
  assert.equal(polarized.graphics.some((graphic) => graphic.type === 'text' && graphic.text === '+'), true);

  const opamp = byId('OPAMP');
  assert.equal(opamp.graphics.filter((graphic) => graphic.type === 'text').length, 2);
});

test('电源符号 power:true 且引脚为 power_in/power_out，其它符号不标电源', () => {
  for (const symbol of builtinSymbols()) {
    if (POWER_IDS.includes(symbol.id)) {
      assert.equal(symbol.power, true, symbol.id + ' 应标记 power');
      assert.equal(symbol.pins.length, 1);
      assert.equal(POWER_PIN_TYPES.includes(symbol.pins[0].electricalType), true);
      assert.equal(symbol.pins[0].length, 0, '电源符号引脚长度应为 0');
      assert.equal(['GND', 'VCC', '+5V'].includes(symbol.pins[0].name), true);
    } else {
      assert.equal(symbol.power, false, symbol.id + ' 不应标记 power');
      for (const pin of symbol.pins) {
        assert.ok(pin.length > 0, symbol.id + ' 引脚长度应为正');
      }
    }
  }
  const opampSupply = byId('OPAMP')
    .pins.filter((pin) => POWER_PIN_TYPES.includes(pin.electricalType))
    .map((pin) => pin.name);
  assert.deepEqual(opampSupply, ['V+', 'V-']);
  assert.deepEqual(
    ['GND', 'VCC', '+5V'].map((id) => byId(id).pins[0].electricalType),
    ['power_in', 'power_out', 'power_out'],
  );
});

test('引脚数量符合器件定义', () => {
  const counts = { R: 2, C: 2, C_POL: 2, L: 2, D: 2, LED: 2, SW_PUSH: 2, XTAL: 2, CONN_2: 2, NPN: 3, PNP: 3, CONN_4: 4, OPAMP: 5, IC_8: 8, MCU_16: 16 };
  for (const [id, expected] of Object.entries(counts)) {
    assert.equal(byId(id).pins.length, expected, id + ' 引脚数量错误');
  }
  const icNumbers = byId('IC_8').pins.map((pin) => pin.number);
  assert.deepEqual(icNumbers, ['1', '2', '3', '4', '5', '6', '7', '8']);
});

test('builtinSymbols 每次返回独立副本', () => {
  const first = builtinSymbols();
  const second = builtinSymbols();
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.notEqual(first[0].graphics[0], second[0].graphics[0]);

  first[0].name = '被修改';
  first[0].pins[0].x = 999;
  assert.equal(second[0].name, '电阻');
  assert.equal(builtinSymbols()[0].pins[0].x, 0);
});
