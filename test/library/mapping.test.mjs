// 映射测试：符号到封装的缺省匹配、未知符号回落与按引脚数推荐。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYMBOL_FOOTPRINT_MAP,
  defaultFootprintFor,
  suggestFootprints,
} from '../../src/library/mapping.js';
import { builtinSymbols } from '../../src/library/builtin-symbols.js';
import { builtinFootprints } from '../../src/library/builtin-footprints.js';
import { createDefaultLibraries } from '../../src/library/index.js';

test('defaultFootprintFor 返回约定的缺省封装', () => {
  assert.equal(defaultFootprintFor('R'), 'R_0805');
  assert.equal(defaultFootprintFor('C'), 'C_0603');
  assert.equal(defaultFootprintFor('IC_8'), 'DIP-8');
  assert.equal(defaultFootprintFor('CONN_2'), 'PIN_HDR_1x2');
  assert.equal(defaultFootprintFor('NPN'), 'SOT-23');
  assert.equal(defaultFootprintFor('OPAMP'), 'SOIC-8');
  assert.equal(defaultFootprintFor(' R '), 'R_0805');
});

test('未知符号与空值返回 null 且不抛异常', () => {
  for (const value of ['UNKNOWN', '', '   ', null, undefined, 42, {}, []]) {
    assert.equal(defaultFootprintFor(value), null);
  }
  assert.equal(defaultFootprintFor('GND'), null);
  assert.equal(defaultFootprintFor('MCU_16'), null);
});

test('映射中的封装与符号都真实存在', () => {
  const symbols = new Set(builtinSymbols().map((symbol) => symbol.id));
  const footprints = new Set(builtinFootprints().map((footprint) => footprint.id));
  for (const [symbolId, footprintId] of Object.entries(SYMBOL_FOOTPRINT_MAP)) {
    assert.equal(symbols.has(symbolId), true, '映射引用了不存在的符号 ' + symbolId);
    assert.equal(footprints.has(footprintId), true, '映射引用了不存在的封装 ' + footprintId);
    assert.equal(defaultFootprintFor(symbolId), footprintId);
  }
  assert.equal(Object.isFrozen(SYMBOL_FOOTPRINT_MAP), true);
});

test('suggestFootprints 按引脚数推荐同焊盘数的封装', () => {
  const footprints = builtinFootprints();
  const ic8 = builtinSymbols().find((symbol) => symbol.id === 'IC_8');
  const suggestions = suggestFootprints(ic8, footprints).map((footprint) => footprint.id);
  assert.deepEqual(suggestions, ['SOIC-8', 'DIP-8']);

  const resistor = builtinSymbols().find((symbol) => symbol.id === 'R');
  const twoPad = suggestFootprints(resistor, footprints).map((footprint) => footprint.id);
  assert.deepEqual(twoPad, ['R_0402', 'R_0603', 'R_0805', 'C_0603', 'PIN_HDR_1x2']);

  assert.deepEqual(suggestFootprints({ pins: [] }, footprints), []);
  assert.deepEqual(suggestFootprints(null, footprints), []);
  assert.deepEqual(suggestFootprints(ic8, null), []);
  assert.deepEqual(suggestFootprints({ pins: [] }), []);
});

test('createDefaultLibraries 组装内置符号库与封装库', () => {
  const libraries = createDefaultLibraries();
  assert.equal(libraries.symbols.size(), builtinSymbols().length);
  assert.equal(libraries.footprints.size(), builtinFootprints().length);
  assert.equal(libraries.symbols.get('R').name, '电阻');
  assert.equal(libraries.footprints.get('DIP-8').pads.length, 8);
  assert.deepEqual(libraries.symbols.search('运放').map((symbol) => symbol.id), ['OPAMP']);
});
