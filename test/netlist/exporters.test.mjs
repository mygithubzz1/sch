// 导出器测试：json / csv / kicad / protel 四种格式的结构、转义与空工程边界。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNetlist,
  EXPORTERS,
  EXPORTER_LIST,
  getExporter,
  generateCSV,
  generateJSON,
  generateKiCad,
  generateProtel,
} from '../../src/netlist/index.js';
import {
  dividerProject,
  ledProject,
  hierarchicalProject,
  specialCharsProject,
  emptyProject,
} from './fixtures.mjs';

function parenBalance(text) {
  let depth = 0;
  let minimum = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    minimum = Math.min(minimum, depth);
  }
  return { depth, minimum };
}

test('EXPORTERS 提供四种格式且每项满足 id/label/extension/mime/generate 契约', () => {
  assert.deepEqual(Object.keys(EXPORTERS), ['json', 'csv', 'kicad', 'protel']);
  assert.equal(EXPORTER_LIST.length, 4);
  for (const [key, exporter] of Object.entries(EXPORTERS)) {
    assert.equal(exporter.id, key);
    assert.equal(typeof exporter.label, 'string');
    assert.ok(exporter.label.length > 0);
    assert.equal(typeof exporter.extension, 'string');
    assert.ok(!exporter.extension.startsWith('.'));
    assert.match(exporter.mime, /^[a-z]+\/[a-z0-9.+-]+$/);
    assert.equal(typeof exporter.generate, 'function');
    assert.equal(getExporter(key), exporter);
  }
  assert.equal(getExporter('unknown'), null);
});

test('buildNetlist 返回 ok / nets / warnings / stats / components', () => {
  const netlist = buildNetlist(dividerProject());

  assert.equal(netlist.ok, true);
  assert.equal(netlist.nets.length, 3);
  assert.deepEqual(netlist.warnings, []);
  assert.equal(netlist.stats.nets, 3);
  assert.equal(netlist.stats.components, 4);
  assert.equal(netlist.stats.pins, 6);
  assert.deepEqual(
    netlist.components.map((component) => component.designator),
    ['#PWR01', '#PWR02', 'R1', 'R2'],
  );
  const resistor = netlist.components.find((component) => component.designator === 'R1');
  assert.equal(resistor.value, '10k');
  assert.equal(resistor.footprintId, 'R_0805');
  assert.deepEqual(resistor.pins.map((pin) => pin.number), ['1', '2']);
});

test('JSON 网表可 JSON.parse，含 components / nets / warnings / stats，无 BOM', () => {
  const project = dividerProject();
  const text = generateJSON(project);
  const document = JSON.parse(text);

  assert.equal(text.charCodeAt(0) === 0xfeff, false);
  assert.ok(text.endsWith('\n'));
  assert.equal(document.format, 'schematic-studio-netlist');
  assert.equal(document.version, 1);
  assert.equal(document.project.name, '分压网络');
  assert.equal(document.project.units, 'mm');
  assert.deepEqual(document.nets.map((net) => net.name), ['GND', 'MID', 'VCC']);
  assert.deepEqual(document.components.map((component) => component.designator), ['#PWR01', '#PWR02', 'R1', 'R2']);
  assert.deepEqual(
    document.nets.find((net) => net.name === 'VCC').pins.map((pin) => pin.designator + '-' + pin.pin),
    ['#PWR01-1', 'R1-1'],
  );
  const everyPinHasSheet = document.nets.every((net) =>
    net.pins.every((pin) => pin.sheetId === project.sheets[0].id),
  );
  assert.equal(everyPinHasSheet, true, '每个引脚都应带所属图纸 id');
  assert.ok(Array.isArray(document.warnings));
  assert.equal(document.stats.nets, 3);
});

test('JSON 网表包含 ERC 告警（LED 夹具）', () => {
  const document = JSON.parse(generateJSON(ledProject()));
  const codes = document.warnings.map((warning) => warning.code);

  assert.deepEqual(codes.sort(), ['POWER_OUT_CONFLICT', 'UNCONNECTED_WIRE']);
  assert.equal(document.warnings[0].ref !== null, true);
});

test('CSV 表头固定为 designator,pin,name,net，按位号自然排序并逐引脚成行', () => {
  const lines = generateCSV(dividerProject()).trim().split('\n');

  assert.equal(lines[0], 'designator,pin,name,net');
  assert.equal(lines.length, 7, '表头 + 6 个引脚行');
  assert.deepEqual(lines.slice(1), [
    '#PWR01,1,VCC,VCC',
    '#PWR02,1,GND,GND',
    'R1,1,~,VCC',
    'R1,2,~,MID',
    'R2,1,~,MID',
    'R2,2,~,GND',
  ]);
  assert.ok(generateCSV(dividerProject()).endsWith('\n'));
});

test('CSV 对逗号/引号/换行字段加引号转义，未连接引脚留空网络名', () => {
  const csv = generateCSV(specialCharsProject());
  assert.ok(csv.includes('"A,B"'), '含逗号的网络名必须加引号');
  assert.equal(csv.trim().split('\n')[0], 'designator,pin,name,net');

  const netlist = buildNetlist(specialCharsProject());
  const r1 = netlist.components.find((component) => component.designator === 'R1');
  assert.equal(r1.pins.length, 2);
  assert.ok(csv.includes('R1,1,~,N$1'));
});

test('KiCad 网表为 KiCad 6+ S-表达式，括号平衡、net code 连续', () => {
  const text = generateKiCad(dividerProject());

  assert.ok(text.startsWith('(export (version "E")'));
  assert.ok(text.includes('(design'));
  assert.ok(text.includes('(components'));
  assert.ok(text.includes('(comp (ref "R1") (value "10k") (footprint "R_0805")'));
  assert.ok(text.includes('(nets'));
  assert.ok(text.includes('(net (code 1) (name "GND")'));
  assert.ok(text.includes('(node (ref "R2") (pin "2") (pinfunction "~") (pintype "passive"))'));
  assert.ok(text.includes('(pintype "power_in")'));
  assert.equal(text.trim().endsWith(')'), true);

  const balance = parenBalance(text);
  assert.equal(balance.depth, 0, '括号必须平衡');
  assert.equal(balance.minimum, 0, '不能出现多余的右括号');

  const codes = [...text.matchAll(/\(net \(code (\d+)\)/g)].map((match) => Number(match[1]));
  assert.deepEqual(codes, [1, 2, 3]);
});

test('KiCad 网表转义引号、反斜杠与工程名', () => {
  const text = generateKiCad(specialCharsProject());

  assert.ok(text.includes('(source "特殊\\"字符\\"工程")'), '工程名中的引号必须转义');
  assert.ok(text.includes('10\\"k\\\\x'), '元件值中的引号与反斜杠必须转义');
  assert.equal(parenBalance(text).depth, 0);
  assert.equal(text.includes('\\n'), false, '值内没有换行时不应出现转义换行');
});

test('Protel 网表含 [Design]/[Components]/[NETLIST] 段、CRLF 行尾，电源符号不作为 PCB 元件', () => {
  const text = generateProtel(ledProject());
  const lines = text.split('\r\n');

  assert.ok(text.startsWith('[Design]\r\nVersion=PCB4.0'));
  assert.ok(text.includes('[Components]'));
  assert.ok(text.includes('[NETLIST]'));
  assert.ok(text.includes('R1\tR_0805\t330'));
  assert.ok(text.includes('D1\tLED_0805\t红色'));
  assert.equal(text.includes('#PWR'), false, '电源符号不应出现在 Protel 网表中');
  assert.ok(lines.includes('GND\tD1-2'));
  assert.ok(lines.includes('VCC\tR1-1'));
  assert.equal(/(^|[^\r])\n/.test(text), false, '所有行必须以 CRLF 结尾');
});

test('空工程四种格式都可导出且结构合法', () => {
  const project = emptyProject();
  const json = JSON.parse(generateJSON(project));
  assert.deepEqual(json.nets, []);
  assert.deepEqual(json.components, []);
  assert.equal(json.stats.nets, 0);

  assert.equal(generateCSV(project), 'designator,pin,name,net\n');
  assert.equal(parenBalance(generateKiCad(project)).depth, 0);
  assert.ok(generateKiCad(project).includes('(nets'));

  const protel = generateProtel(project);
  assert.ok(protel.startsWith('[Design]'));
  assert.ok(protel.includes('[NETLIST]'));
});

test('导出器是纯函数：连续两次调用结果一致且不修改工程', () => {
  const project = hierarchicalProject();
  const snapshot = JSON.stringify(project);
  const first = EXPORTERS.json.generate(project);
  const second = EXPORTERS.json.generate(project);

  assert.equal(first, second);
  assert.equal(JSON.stringify(project), snapshot, '导出不得改动工程数据');
  assert.equal(generateCSV(project), generateCSV(project));
  assert.equal(generateKiCad(project), generateKiCad(project));
  assert.equal(generateProtel(project), generateProtel(project));
});
