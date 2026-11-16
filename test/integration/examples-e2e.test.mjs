// 示例工程端到端：严格反序列化 examples/*.json -> buildNetlist -> 四种网表导出，
// 断言网络集合、引脚归属与各格式的格式特征。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { deserializeProject } from '../../src/io/project-io.js';
import { EXPORTERS, EXPORTER_LIST, buildNetlist } from '../../src/netlist/index.js';
import { ROOT } from './helpers.mjs';

const DEMO_LED = path.join(ROOT, 'examples/demo-led.json');
const DEMO_MCU = path.join(ROOT, 'examples/demo-mcu.json');

function loadStrict(file) {
  const result = deserializeProject(fs.readFileSync(file, 'utf8'));
  const name = path.basename(file);
  assert.deepEqual(result.warnings, [], name + ' 应无解析告警：' + result.warnings.join('；'));
  assert.ok(result.project, name + ' 应通过严格 schema 校验（不自动补 meta）');
  return result.project;
}

/** 网络 -> [位号.引脚号] 的映射，便于断言引脚归属。 */
function netPinMap(netlist) {
  const map = {};
  for (const net of netlist.nets) {
    map[net.name] = net.pins.map((pin) => pin.designator + '.' + pin.pinNumber).sort();
  }
  return map;
}

/** KiCad S-表达式括号配平检查（跳过字符串字面量与转义）。 */
function parenDepth(text) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth < 0) return -1;
    }
  }
  return depth;
}

test('demo-led.json 通过严格 schema 校验', () => {
  const project = loadStrict(DEMO_LED);
  const sheet = project.sheets[0];
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.name, 'LED 指示灯');
  assert.equal(project.units, 'mm');
  assert.equal(project.grid, 2.54);
  assert.equal(project.sheets.length, 1);
  assert.equal(sheet.symbols.length, 4);
  assert.equal(sheet.wires.length, 3);
  assert.equal(sheet.junctions.length, 0);
  assert.equal(typeof project.meta.created, 'string');
  assert.equal(typeof project.meta.modified, 'string');
});

test('demo-led 网表网络集合与引脚归属正确', () => {
  const project = loadStrict(DEMO_LED);
  const netlist = buildNetlist(project);
  assert.equal(netlist.ok, true);
  assert.deepEqual(netlist.warnings, [], '示例电路应无 ERC 告警');
  assert.deepEqual(netPinMap(netlist), {
    GND: ['#PWR02.1', 'D1.2'],
    'N$1': ['D1.1', 'R1.2'],
    VCC: ['#PWR01.1', 'R1.1'],
  });
  assert.equal(netlist.stats.components, 4);
  assert.equal(netlist.stats.pins, 6);
  assert.equal(netlist.stats.nets, 3);
  assert.equal(netlist.stats.warnings, 0);
  assert.deepEqual(
    netlist.components.map((component) => component.designator),
    ['#PWR01', '#PWR02', 'D1', 'R1'],
  );
  const byDesignator = Object.fromEntries(netlist.components.map((component) => [component.designator, component]));
  assert.equal(byDesignator['#PWR01'].power, true);
  assert.equal(byDesignator.D1.footprintId, 'R_0805');
  assert.equal(byDesignator.R1.value, '220R');
  assert.equal(byDesignator.R1.pins.length, 2);
});

test('四种导出器都能生成 demo-led 网表，且为纯函数', () => {
  const project = loadStrict(DEMO_LED);
  assert.deepEqual(
    EXPORTER_LIST.map((exporter) => exporter.id),
    ['json', 'csv', 'kicad', 'protel'],
  );
  for (const exporter of EXPORTER_LIST) {
    assert.equal(EXPORTERS[exporter.id], exporter, '导出器注册表应一致');
    assert.equal(typeof exporter.label, 'string');
    assert.equal(typeof exporter.extension, 'string');
    assert.equal(typeof exporter.mime, 'string');
    assert.equal(typeof exporter.generate, 'function');
    const first = exporter.generate(project);
    const second = exporter.generate(project);
    assert.equal(typeof first, 'string', exporter.id + ' 应返回字符串');
    assert.ok(first.length > 0, exporter.id + ' 不应为空');
    assert.equal(first, second, exporter.id + ' 的 generate 应为纯函数');
    assert.equal(first.charCodeAt(0) === 0xfeff, false, exporter.id + ' 不应带 BOM');
  }
});

test('JSON 网表可解析且包含网络/元件/统计', () => {
  const project = loadStrict(DEMO_LED);
  const text = EXPORTERS.json.generate(project);
  const document = JSON.parse(text);
  assert.equal(document.format, 'schematic-studio-netlist');
  assert.equal(document.version, 1);
  assert.equal(document.project.name, 'LED 指示灯');
  assert.equal(document.nets.length, 3);
  assert.equal(document.components.length, 4);
  assert.ok(document.stats);
  const vcc = document.nets.find((net) => net.name === 'VCC');
  assert.deepEqual(
    vcc.pins.map((pin) => pin.designator + '.' + pin.pin),
    ['#PWR01.1', 'R1.1'],
  );
  assert.equal(vcc.pins[0].pinName, 'VCC');
});

test('CSV 网表表头与行内容符合契约', () => {
  const project = loadStrict(DEMO_LED);
  const text = EXPORTERS.csv.generate(project);
  const lines = text.replace(/\n$/, '').split('\n');
  assert.equal(lines[0], 'designator,pin,name,net');
  assert.equal(lines.length, 7, '表头 + 6 个引脚');
  assert.ok(lines.includes('D1,1,A,N$1'));
  assert.ok(lines.includes('D1,2,K,GND'));
  assert.ok(lines.includes('R1,1,,VCC'));
  assert.ok(lines.includes('#PWR02,1,GND,GND'));
  assert.equal(text.endsWith('\n'), true);
});

test('KiCad 网表为配平的 S-表达式并含 export/nets 段', () => {
  const project = loadStrict(DEMO_LED);
  const text = EXPORTERS.kicad.generate(project);
  assert.ok(text.startsWith('(export'), 'KiCad 网表应以 (export 开头');
  assert.ok(text.includes('(nets'));
  assert.ok(text.includes('(net (code 1) (name "GND")'));
  assert.ok(text.includes('(comp (ref "R1") (value "220R")'));
  assert.ok(text.includes('(source "LED 指示灯")'));
  assert.equal(parenDepth(text), 0, 'S-表达式括号必须配平');
});

test('Protel 网表包含 [Components]/[NETLIST] 段且排除电源符号', () => {
  const project = loadStrict(DEMO_LED);
  const text = EXPORTERS.protel.generate(project);
  assert.ok(text.startsWith('[Design]'));
  assert.ok(text.includes('[Components]'));
  assert.ok(text.includes('[NETLIST]'));
  assert.ok(text.includes('\r\n'), 'Protel 网表应使用 CRLF 行尾');
  const [components, nets] = text.split('[NETLIST]');
  assert.ok(components.includes('D1\tR_0805\tLED'));
  assert.ok(components.includes('R1\tR_0805\t220R'));
  assert.equal(components.includes('#PWR01'), false, '电源符号不进入 PCB 元件表');
  assert.ok(nets.includes('VCC\tR1-1'));
  assert.ok(nets.includes('GND\tD1-2'));
});

test('demo-mcu.json 可作为多网络示例并触发 ERC 告警', () => {
  const project = loadStrict(DEMO_MCU);
  const netlist = buildNetlist(project);
  assert.equal(netlist.ok, true);
  const names = netlist.nets.map((net) => net.name);
  assert.ok(names.includes('GND'), '应包含 GND 网络');
  assert.ok(names.includes('+5V'), '应包含 +5V 网络');
  assert.ok(names.includes('XTAL_IN') && names.includes('XTAL_OUT'), '应包含晶振全局标签网络');
  assert.equal(netlist.nets.length, 16);
  assert.equal(netlist.stats.components, 8);
  assert.ok(netlist.warnings.length > 0, '未用引脚应触发 ERC 告警');
  assert.ok(netlist.warnings.some((warning) => warning.code === 'FLOATING_PIN'));
  for (const exporter of EXPORTER_LIST) {
    assert.ok(exporter.generate(project).length > 0, exporter.id + ' 应能导出 MCU 示例');
  }
});
