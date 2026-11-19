// 视图模型测试：符号分类/检索、选择集、状态栏、网表行与告警定位数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinFootprints } from '../../src/library/builtin-footprints.js';
import { builtinSymbols } from '../../src/library/builtin-symbols.js';
import { createSheet, createSymbolInstance, createWire } from '../../src/model/project.js';
import {
  formatCoordinate,
  formatNumber,
  formatStatus,
  footprintRows,
  filterFootprints,
  filterSymbols,
  groupSymbols,
  groupedSymbols,
  layerLabel,
  netRows,
  netlistSummary,
  nextSheetName,
  selectionInfo,
  selectionTitle,
  sheetLabel,
  statusSegments,
  symbolCategory,
  toolLabel,
  warningRows,
  warningTarget,
  zoomPercent,
} from '../../src/ui/view-model.js';

const symbols = builtinSymbols();
const footprints = builtinFootprints();

test('内置符号全部按分类分组且不重不漏', () => {
  const groups = groupSymbols(symbols);
  const ids = groups.flatMap((group) => group.items.map((item) => item.id));
  assert.equal(ids.length, symbols.length);
  assert.deepEqual(new Set(ids), new Set(symbols.map((symbol) => symbol.id)));
  assert.deepEqual(groups.map((group) => group.id), ['basic', 'semiconductor', 'power', 'connector']);
  assert.equal(symbolCategory({ id: 'NPN' }), 'semiconductor');
  assert.equal(symbolCategory({ id: 'GND' }), 'power');
  assert.equal(symbolCategory({ id: 'CUSTOM' }), 'other');
  assert.equal(symbolCategory(null), 'other');
  const custom = groupSymbols([{ id: 'CUSTOM', name: '自定义' }]);
  assert.deepEqual(custom.map((group) => group.id), ['other']);
});

test('符号与封装检索忽略大小写', () => {
  assert.deepEqual(filterSymbols(symbols, 'led').map((item) => item.id), ['LED']);
  assert.ok(filterSymbols(symbols, '电阻').some((item) => item.id === 'R'));
  assert.deepEqual(filterSymbols(symbols, 'zzz'), []);
  assert.equal(filterSymbols(symbols, '').length, symbols.length);
  assert.deepEqual(filterFootprints(footprints, 'sot').map((item) => item.id), ['SOT-23']);
  assert.equal(groupedSymbols(symbols, 'zzz').length, 0);
});

test('封装行数据包含焊盘数量', () => {
  const rows = footprintRows(footprints);
  assert.equal(rows.length, footprints.length);
  const qfp = rows.find((row) => row.id === 'QFP-32');
  assert.equal(qfp.padCount, 32);
  assert.equal(qfp.name, 'QFP-32');
  assert.equal(footprintRows(null).length, 0);
});

test('选择集信息与标题', () => {
  const sheet = createSheet('测试图纸');
  const symbol = createSymbolInstance({ symbolId: 'R', designator: 'R1', x: 1, y: 2 });
  const wire = createWire([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  sheet.symbols.push(symbol);
  sheet.wires.push(wire);

  const none = selectionInfo(sheet, []);
  assert.equal(none.kind, 'none');
  assert.equal(selectionTitle(none), '未选择对象');

  const single = selectionInfo(sheet, [symbol.id]);
  assert.equal(single.kind, 'symbols');
  assert.equal(single.entity, symbol);
  assert.equal(selectionTitle(single), '符号 · R1');

  const wireInfo = selectionInfo(sheet, [wire.id]);
  assert.equal(wireInfo.kind, 'wires');
  assert.equal(selectionTitle(wireInfo), '导线 · 2 点');

  const multi = selectionInfo(sheet, [symbol.id, wire.id, 'unknown']);
  assert.equal(multi.kind, 'multi');
  assert.equal(multi.count, 2);
  assert.equal(selectionTitle(multi), '已选择 2 个对象');
  assert.equal(selectionInfo(null, ['a']).kind, 'none');
});

test('状态栏分段与文本', () => {
  const state = {
    pointer: { x: 12.7, y: -3.81 },
    grid: 2.54,
    scale: 4,
    tool: 'select',
    netCount: 3,
    snap: true,
    mode: 'schematic',
    selectionCount: 1,
    sheetName: '图纸 1',
  };
  const segments = statusSegments(state);
  assert.equal(segments.find((segment) => segment.key === 'coordinate').value, '12.7, -3.81');
  assert.equal(segments.find((segment) => segment.key === 'grid').value, '2.54 mm');
  assert.equal(segments.find((segment) => segment.key === 'zoom').value, '400%');
  assert.equal(segments.find((segment) => segment.key === 'tool').value, '选择');
  assert.equal(segments.find((segment) => segment.key === 'nets').value, '3');
  assert.equal(segments.find((segment) => segment.key === 'snap').value, '开');
  assert.ok(formatStatus(state).includes('缩放 400%'));
  assert.ok(formatStatus({ ...state, mode: 'footprint', tool: 'pad' }).includes('封装编辑'));
  assert.equal(statusSegments({}).find((segment) => segment.key === 'coordinate').value, '—');
  assert.equal(zoomPercent(0.5), '50%');
  assert.equal(zoomPercent('x'), '100%');
  assert.equal(formatNumber(2.5), '2.5');
  assert.equal(formatNumber('bad'), '—');
  assert.equal(formatCoordinate({ x: 1.234, y: -5 }), '1.23, -5');
  assert.equal(formatCoordinate(null), '—');
  assert.equal(toolLabel('wire'), '导线');
  assert.equal(toolLabel('unknown'), 'unknown');
  assert.equal(layerLabel('courtyard'), 'Courtyard');
  assert.equal(sheetLabel({ name: '  ' }, 2), '图纸 3');
  assert.equal(nextSheetName([{ name: '图纸 1' }, { name: '图纸 3' }]), '图纸 2');
});

test('网表摘要/网络行/告警行可驱动面板渲染', () => {
  const result = {
    ok: true,
    nets: [
      {
        name: 'VCC',
        class: 'Power',
        pins: [
          { designator: 'R1', pinNumber: '1', pinName: 'A', instanceId: 'sym-1', sheetId: 'sheet-1' },
          { designator: 'C1', pinNumber: '2', pinName: 'B', instanceId: 'sym-2', sheetId: 'sheet-1' },
        ],
      },
      { name: '', pins: [] },
    ],
    components: [{ designator: 'R1' }],
    warnings: [
      { code: 'FLOATING_PIN', message: 'R1.2 悬空', ref: { sheetId: 'sheet-1', instanceId: 'sym-1', pinNumber: '2' } },
      { code: 'CUSTOM_CODE', message: '自定义' },
    ],
  };
  const summary = netlistSummary(result);
  assert.equal(summary.ok, true);
  assert.equal(summary.netCount, 2);
  assert.equal(summary.pinCount, 2);
  assert.equal(summary.componentCount, 1);
  assert.equal(summary.warningCount, 2);

  const rows = netRows(result);
  assert.equal(rows[0].name, 'VCC');
  assert.equal(rows[0].class, 'Power');
  assert.equal(rows[0].pins[0].label, 'R1.1');
  assert.equal(rows[0].pins[0].instanceId, 'sym-1');
  assert.equal(rows[1].name, '未命名网络');
  assert.equal(rows[1].class, 'Default');

  const warnings = warningRows(result.warnings);
  assert.equal(warnings[0].label, '悬空引脚');
  assert.equal(warnings[1].label, 'CUSTOM_CODE');
  assert.equal(warnings[0].instanceId, 'sym-1');
  assert.equal(warningTarget(result.warnings[0]).instanceId, 'sym-1');
  assert.equal(warningTarget({ wireId: 'w1' }).wireId, 'w1');

  assert.equal(netlistSummary(null).netCount, 0);
  assert.equal(netRows(null).length, 0);
  assert.equal(warningRows(null).length, 0);
});
