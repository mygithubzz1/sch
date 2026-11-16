// 连通性分析测试：分压/LED 夹具、junction 合并、跨图纸 global label、容差与命名优先级。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConnectivity,
  buildProjectConnectivity,
  analyzeSheet,
  analyzeProject,
  netToContract,
  naturalCompare,
  CONNECTIVITY_TOLERANCE,
} from '../../src/netlist/connectivity.js';
import { createProject, createSymbolInstance, createWire, createLabel } from '../../src/model/project.js';
import {
  dividerProject,
  ledProject,
  hierarchicalProject,
  junctionProject,
  powerNameProject,
  ercProject,
  emptyProject,
  symbolDefs,
} from './fixtures.mjs';

function netByName(nets, name) {
  return nets.find((net) => net.name === name) || null;
}

function pinLabels(net) {
  return net.pins.map((pin) => pin.designator + '-' + pin.pinNumber).sort();
}

function pinLabelSets(nets) {
  return nets.map((net) => pinLabels(net).join('+'));
}

test('分压网络：引脚端点重合即相连，得到 GND / MID / VCC 三个网络', () => {
  const project = dividerProject();
  const { nets, warnings } = buildConnectivity(project, project.sheets[0]);

  assert.equal(nets.length, 3);
  assert.deepEqual(nets.map((net) => net.name), ['GND', 'MID', 'VCC']);
  assert.deepEqual(pinLabels(netByName(nets, 'VCC')), ['#PWR01-1', 'R1-1']);
  assert.deepEqual(pinLabels(netByName(nets, 'MID')), ['R1-2', 'R2-1']);
  assert.deepEqual(pinLabels(netByName(nets, 'GND')), ['#PWR02-1', 'R2-2']);
  assert.deepEqual(warnings, []);
});

test('分压网络：网络命名来自电源名与局部标签，不出现自动名', () => {
  const project = dividerProject();
  const analysis = analyzeSheet(project, project.sheets[0], { symbols: symbolDefs() });

  const mid = analysis.nets.find((net) => net.name === 'MID');
  assert.equal(mid.nameSource, 'local');
  assert.equal(mid.wires.length, 0, 'MID 由引脚端点与标签锚点直接相连，不依赖导线');
  assert.ok(!analysis.nets.some((net) => /^N\$/.test(net.name)));
  assert.equal(analysis.stats.nets, 3);
  assert.equal(analysis.stats.pins, 6, '四个符号共 6 个引脚：电源 1 + 电阻 2 + 电阻 2 + 地 1');
});

test('分压网络：成员引脚带 sheetId / symbolId / instanceId 等契约字段', () => {
  const project = dividerProject();
  const { nets } = buildConnectivity(project, project.sheets[0]);
  const pin = netByName(nets, 'VCC').pins.find((item) => item.designator === 'R1');

  assert.equal(pin.pinNumber, '1');
  assert.equal(pin.pinName, '~');
  assert.equal(pin.symbolId, 'R');
  assert.equal(pin.sheetId, project.sheets[0].id);
  assert.equal(typeof pin.instanceId, 'string');
  assert.ok(pin.instanceId.length > 0);
  assert.deepEqual(Object.keys(pin), ['designator', 'pinNumber', 'pinName', 'symbolId', 'instanceId', 'sheetId']);
});

test('LED 指示电路：VCC 网络含两个电源符号与限流电阻，中间网络自动命名 N$1', () => {
  const project = ledProject();
  const { nets } = buildConnectivity(project, project.sheets[0]);

  assert.equal(nets.length, 3);
  assert.deepEqual(pinLabels(netByName(nets, 'VCC')), ['#PWR01-1', '#PWR03-1', 'R1-1']);
  assert.deepEqual(pinLabels(netByName(nets, 'GND')), ['#PWR02-1', 'D1-2']);
  const middle = nets.find((net) => /^N\$\d+$/.test(net.name));
  assert.ok(middle, '中间节点应得到自动网络名');
  assert.deepEqual(pinLabels(middle), ['D1-1', 'R1-2']);
});

test('电源名优先于局部标签：+5V 网络上的 LOCAL_V 标签不改变网络名', () => {
  const project = powerNameProject();
  const { nets } = buildConnectivity(project, project.sheets[0]);

  assert.deepEqual(nets.map((net) => net.name), ['+5V', 'GND']);
  assert.deepEqual(pinLabels(netByName(nets, '+5V')), ['#PWR10-1', 'R9-1']);
  assert.equal(netByName(nets, 'LOCAL_V'), null);
});

test('junction 合并十字交叉的两根导线（无 junction 时十字交叉不连通）', () => {
  const without = junctionProject({ withJunction: false });
  const plain = buildConnectivity(without, without.sheets[0]);
  const plainSets = pinLabelSets(plain.nets);
  assert.equal(plain.nets.length, 4);
  assert.ok(!plainSets.includes('R1-1+R2-1'), '没有 junction 时中段交叉不应相连');

  const withJunction = junctionProject({ withJunction: true });
  const merged = buildConnectivity(withJunction, withJunction.sheets[0]);
  const mergedSets = pinLabelSets(merged.nets);
  assert.ok(mergedSets.includes('R1-1+R2-1'), 'junction 应把两根导线合并成同一网络');
  assert.equal(merged.nets.length, 3);

  const detail = analyzeSheet(withJunction, withJunction.sheets[0], { symbols: symbolDefs() });
  const junctionNet = detail.nets.find((net) => net.junctions.length > 0);
  assert.ok(junctionNet, 'junction 应归属到它合并出的网络');
  assert.equal(junctionNet.junctions[0].x, 10);
  assert.equal(junctionNet.junctions[0].y, 0);
  assert.equal(junctionNet.wires.length, 2);
});

test('跨图纸 global label 合并：单图纸只看到本图纸引脚，工程级合并两片', () => {
  const project = hierarchicalProject();
  const [first, second] = project.sheets;
  const local = buildConnectivity(project, first);
  const localSig = netByName(local.nets, 'SIG');

  assert.ok(localSig);
  assert.equal(localSig.pins.length, 1);
  assert.equal(localSig.pins[0].sheetId, first.id);

  const projectNets = buildProjectConnectivity(project);
  const sig = netByName(projectNets.nets, 'SIG');
  assert.equal(sig.pins.length, 2);
  assert.deepEqual([...new Set(sig.pins.map((pin) => pin.sheetId))].sort(), [first.id, second.id].sort());
  assert.equal(projectNets.nets.length, 3);
});

test('local label 不跨图纸合并：同名局部标签得到 LOCAL1 与 LOCAL1_2', () => {
  const project = hierarchicalProject();
  const analysis = analyzeProject(project);
  const locals = analysis.nets.filter((net) => net.name.startsWith('LOCAL1'));

  assert.equal(locals.length, 2);
  assert.deepEqual(locals.map((net) => net.name).sort(), ['LOCAL1', 'LOCAL1_2']);
  assert.notEqual(locals[0].sheetIds[0], locals[1].sheetIds[0]);
  assert.equal(locals[0].pins.length, 1);
  assert.equal(locals[1].pins.length, 1);
});

test('连接容差为 1e-6：亚微米级偏差视为重合，明显偏差不连通', () => {
  const base = symbolDefs();
  function projectWithOffset(offset) {
    const project = createProject('容差');
    const sheet = project.sheets[0];
    sheet.symbols.push(
      createSymbolInstance({ symbolId: 'R', designator: 'R1', x: 0, y: 0, footprintId: 'R_0805' }),
      createSymbolInstance({ symbolId: 'R', designator: 'R2', x: 10.16 + offset, y: 0, footprintId: 'R_0805' }),
    );
    project.library.symbols = base;
    return project;
  }

  assert.equal(CONNECTIVITY_TOLERANCE, 1e-6);

  const tightProject = projectWithOffset(4e-7);
  const tightNets = buildConnectivity(tightProject, tightProject.sheets[0]).nets;
  const joined = tightNets.filter((net) => net.pins.length === 2);
  assert.equal(joined.length, 1, '4e-7 的偏差应视为重合');
  assert.deepEqual(pinLabels(joined[0]), ['R1-2', 'R2-1']);
  assert.equal(tightNets.length, 3, '其余两个引脚各自成网');

  const looseProject = projectWithOffset(1e-2);
  const looseNets = buildConnectivity(looseProject, looseProject.sheets[0]).nets;
  assert.equal(looseNets.length, 4, '1e-2 的偏差不应连通');
  assert.deepEqual(looseNets.map((net) => net.pins.length), [1, 1, 1, 1]);
});

test('未知符号：报告 UNKNOWN_SYMBOL 并跳过其引脚', () => {
  const project = ercProject();
  const { nets, warnings } = buildConnectivity(project, project.sheets[0]);
  const unknown = warnings.filter((warning) => warning.code === 'UNKNOWN_SYMBOL');

  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].ref.designator, 'U1');
  assert.equal(unknown[0].ref.symbolId, 'NOPE');
  assert.ok(!nets.some((net) => net.pins.some((pin) => pin.designator === 'U1')));
});

test('同一网络出现多个不同局部标签时报告 NET_NAME_CONFLICT', () => {
  const project = createProject('命名冲突');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ symbolId: 'R', designator: 'R1', x: 0, y: 0, footprintId: 'R_0805' }),
  );
  sheet.wires.push(createWire([{ x: -5.08, y: 0 }, { x: 5.08, y: 0 }]));
  sheet.labels.push(createLabel({ x: -5.08, y: 0, text: 'B' }));
  sheet.labels.push(createLabel({ x: 5.08, y: 0, text: 'A' }));
  project.library.symbols = symbolDefs();

  const { nets, warnings } = buildConnectivity(project, sheet);
  const conflict = warnings.filter((warning) => warning.code === 'NET_NAME_CONFLICT');

  assert.equal(nets.length, 1);
  assert.equal(conflict.length, 1);
  assert.deepEqual(conflict[0].ref.names.sort(), ['A', 'B']);
  assert.equal(nets[0].name, 'B', '取发现顺序中的第一个标签名');
});

test('自动网络名 N$n 稳定递增，两次构建结果一致', () => {
  const project = ercProject();
  const runA = buildConnectivity(project, project.sheets[0]);
  const runB = buildConnectivity(project, project.sheets[0]);
  const names = runA.nets.map((net) => net.name);

  assert.deepEqual(names, runB.nets.map((net) => net.name));
  assert.deepEqual(names, ['N$1', 'N$2', 'N$3', 'N$4', 'N$5', 'N$6', 'N$7']);
});

test('空工程与 netToContract、naturalCompare 边界', () => {
  const project = emptyProject();
  assert.deepEqual(buildConnectivity(project, project.sheets[0]).nets, []);
  assert.deepEqual(buildProjectConnectivity(project).nets, []);
  assert.deepEqual(netToContract({ name: 'X', pins: [] }), { name: 'X', pins: [] });
  assert.ok(naturalCompare('R2', 'R10') < 0);
  assert.ok(naturalCompare('R10', 'R2') > 0);
  assert.equal(naturalCompare('R1', 'R1'), 0);
});
