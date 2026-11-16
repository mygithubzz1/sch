// ERC 测试：六类告警的触发条件、数量、定位信息与无告警场景。
import test from 'node:test';
import assert from 'node:assert/strict';

import { runERC, ercWarnings, ERC_CODES } from '../../src/netlist/erc.js';
import { analyzeProject } from '../../src/netlist/connectivity.js';
import {
  dividerProject,
  ledProject,
  hierarchicalProject,
  ercProject,
  powerNameProject,
  emptyProject,
  junctionProject,
  virtualProject,
} from './fixtures.mjs';

function byCode(warnings, code) {
  return warnings.filter((warning) => warning.code === code);
}

test('ERC_CODES 覆盖契约要求的六类检查', () => {
  assert.deepEqual(
    [...ERC_CODES].sort(),
    [
      'DUPLICATE_DESIGNATOR',
      'FLOATING_PIN',
      'MISSING_FOOTPRINT',
      'POWER_OUT_CONFLICT',
      'SINGLE_PIN_NET',
      'UNCONNECTED_WIRE',
    ],
  );
});

test('干净的分压电路没有任何 ERC 告警', () => {
  const result = runERC(dividerProject());
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(ercWarnings(dividerProject()), []);
});

test('LED 电路：同一网络两个 power_out 引脚 → POWER_OUT_CONFLICT，悬空导线 → UNCONNECTED_WIRE', () => {
  const project = ledProject();
  const { ok, warnings } = runERC(project);
  const conflict = byCode(warnings, 'POWER_OUT_CONFLICT');
  const unconnected = byCode(warnings, 'UNCONNECTED_WIRE');

  assert.equal(ok, false);
  assert.equal(conflict.length, 1);
  assert.equal(conflict[0].ref.netName, 'VCC');
  assert.deepEqual(conflict[0].ref.designators.sort(), ['#PWR01', '#PWR03']);
  assert.match(conflict[0].message, /power_out/);

  assert.equal(unconnected.length, 1);
  assert.equal(unconnected[0].ref.sheetId, project.sheets[0].id);
  assert.equal(typeof unconnected[0].ref.wireId, 'string');
  assert.equal(unconnected[0].ref.x, 0);
  assert.equal(unconnected[0].ref.y, 10.16);
  assert.equal(warnings.length, 2);
});

test('ERC 夹具：六类告警数量与定位信息全部正确', () => {
  const project = ercProject();
  const { warnings } = runERC(project);
  const counts = warnings.reduce((acc, warning) => {
    acc[warning.code] = (acc[warning.code] || 0) + 1;
    return acc;
  }, {});

  assert.equal(counts.FLOATING_PIN, 5);
  assert.equal(counts.SINGLE_PIN_NET, 1);
  assert.equal(counts.DUPLICATE_DESIGNATOR, 2);
  assert.equal(counts.MISSING_FOOTPRINT, 1);
  assert.equal(counts.UNCONNECTED_WIRE, 1);
  assert.equal(warnings.length, 10);

  for (const warning of warnings) {
    assert.ok(ERC_CODES.includes(warning.code), '未知告警码 ' + warning.code);
    assert.equal(typeof warning.message, 'string');
    assert.ok(warning.message.length > 0);
    assert.equal(typeof warning.ref, 'object');
    assert.equal(warning.ref.sheetId, project.sheets[0].id);
  }
});

test('浮空引脚定位到具体位号与引脚号', () => {
  const { warnings } = runERC(ercProject());
  const floating = byCode(warnings, 'FLOATING_PIN');
  const refs = floating.map((warning) => warning.ref.designator + '-' + warning.ref.pinNumber).sort();

  assert.deepEqual(refs, ['R1-1', 'R1-2', 'R2-1', 'R2-2', 'R3-1']);
  assert.ok(floating.every((warning) => typeof warning.ref.x === 'number'));
  assert.ok(floating.some((warning) => warning.ref.designator === 'R2'));
});

test('单脚网络与悬空导线区分正确', () => {
  const { warnings } = runERC(ercProject());
  const single = byCode(warnings, 'SINGLE_PIN_NET');

  assert.equal(single.length, 1);
  assert.equal(single[0].ref.designator, 'R3');
  assert.equal(single[0].ref.pinNumber, '2');
  assert.match(single[0].message, /只有 1 个引脚/);
});

test('重复位号逐实例告警，缺封装告警指向 R2', () => {
  const { warnings } = runERC(ercProject());
  const duplicates = byCode(warnings, 'DUPLICATE_DESIGNATOR');
  const missing = byCode(warnings, 'MISSING_FOOTPRINT');

  assert.deepEqual(duplicates.map((warning) => warning.ref.designator), ['R1', 'R1']);
  assert.notEqual(duplicates[0].ref.instanceId, duplicates[1].ref.instanceId);
  assert.match(duplicates[0].message, /位号 R1 重复出现 2 次/);

  assert.equal(missing.length, 1);
  assert.equal(missing[0].ref.designator, 'R2');
  assert.match(missing[0].message, /未指定封装/);
});

test('电源符号不参与缺封装检查；重复位号告警覆盖跨图纸', () => {
  const power = runERC(powerNameProject());
  assert.deepEqual(byCode(power.warnings, 'MISSING_FOOTPRINT'), []);

  const hierarchicalProjectData = hierarchicalProject();
  const hierarchical = runERC(hierarchicalProjectData);
  const duplicates = byCode(hierarchical.warnings, 'DUPLICATE_DESIGNATOR');
  assert.equal(duplicates.length, 2);
  assert.deepEqual(
    duplicates.map((warning) => warning.ref.sheetId).sort(),
    hierarchicalProjectData.sheets.map((sheet) => sheet.id).sort(),
  );
  assert.equal(byCode(hierarchical.warnings, 'SINGLE_PIN_NET').length, 2);
  assert.equal(hierarchical.warnings.length, 4);
});

test('电源与虚拟器件豁免：电源引脚不报悬空/单脚，测试点与 IC 插座不要求封装', () => {
  const { warnings } = runERC(virtualProject());
  const floating = byCode(warnings, 'FLOATING_PIN');
  const missing = byCode(warnings, 'MISSING_FOOTPRINT');

  assert.deepEqual([...new Set(floating.map((warning) => warning.ref.designator))].sort(), ['R1', 'TP1', 'X1']);
  assert.equal(floating.length, 5);
  assert.equal(warnings.some((warning) => warning.ref && warning.ref.designator === '#PWR01'), false);
  assert.equal(warnings.some((warning) => warning.ref && warning.ref.designator === '#PWR02'), false);

  assert.deepEqual(missing.map((warning) => warning.ref.designator), ['R1'], '只有实体器件要求封装');
  assert.equal(byCode(warnings, 'SINGLE_PIN_NET').length, 0, '电源网络不报单脚网络');
  assert.equal(byCode(warnings, 'UNCONNECTED_WIRE').length, 0);
});

test('junction 合并后原来的两个单脚网络变成一个正常网络', () => {
  const without = junctionProject({ withJunction: false });
  const before = runERC(without).warnings.filter((warning) => warning.code === 'SINGLE_PIN_NET');
  assert.equal(before.length, 2);

  const withJunction = junctionProject({ withJunction: true });
  const after = runERC(withJunction).warnings.filter((warning) => warning.code === 'SINGLE_PIN_NET');
  assert.equal(after.length, 0);
});

test('空工程无告警；复用 analysis 结果与重新计算一致', () => {
  const project = ercProject();
  assert.deepEqual(runERC(emptyProject()).warnings, []);

  const analysis = analyzeProject(project);
  const reused = runERC(project, { analysis });
  const fresh = runERC(project);
  assert.deepEqual(reused.warnings, fresh.warnings);
});
