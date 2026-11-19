// KiCad 网表导入测试：黄金样本重建计数、schema 校验、序列化往返、网络名/引脚集合重建与畸形输入。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProject } from '../../src/core/schema.js';
import { deserializeProject, serializeProject } from '../../src/io/project-io.js';
import { normalizeProject } from '../../src/model/project.js';
import { buildNetlist } from '../../src/netlist/index.js';
import { importKiCadNetlist } from '../../src/netlist/kicad-import.js';
import { readKiCadNetlist } from '../../src/netlist/kicad-reader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'examples/tinytapeout-demo.net');
const SAMPLE = fs.readFileSync(FIXTURE, 'utf8');

let cached = null;

/** 黄金样本只导入一次（导入含 150 元件 + 583 导线，重复构建没有意义）。 */
function imported() {
  if (cached === null) cached = importKiCadNetlist(SAMPLE);
  return cached;
}

function importedProject() {
  const result = imported();
  assert.equal(result.ok, true, '黄金样本应导入成功：' + (result.errors || []).join('；'));
  return result.project;
}

function sheetOf(project, designator) {
  return project.sheets.find((sheet) =>
    sheet.symbols.some((symbol) => symbol.designator === designator),
  );
}

function symbolOf(project, designator) {
  for (const sheet of project.sheets) {
    const found = sheet.symbols.find((symbol) => symbol.designator === designator);
    if (found) return found;
  }
  return null;
}

function symbolDefOf(project, symbolId) {
  return project.library.symbols.find((symbol) => symbol.id === symbolId) || null;
}

function labelsOf(project) {
  return project.sheets.flatMap((sheet) =>
    sheet.labels.map((label) => ({ text: label.text, kind: label.kind, sheet: sheet.kicad.name })),
  );
}

function pinPairsOf(net) {
  return net.pins.map((pin) => pin.designator + '-' + pin.pinNumber).sort();
}

function netsByName(netlist) {
  const map = new Map();
  for (const net of netlist.nets) {
    if (!map.has(net.name)) map.set(net.name, []);
    map.get(net.name).push(net);
  }
  return map;
}

function stripMeta(project) {
  const copy = JSON.parse(JSON.stringify(project));
  delete copy.meta;
  return copy;
}

test('黄金样本导入：返回 { ok:true, project, warnings, stats }，统计与实测一致', () => {
  const result = imported();
  assert.equal(result.ok, true);
  assert.ok(result.project && typeof result.project === 'object');
  assert.deepEqual(result.errors, undefined);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.stats, {
    sheets: 2,
    components: 150,
    libparts: 28,
    libraries: 1,
    nets: 114,
    nodes: 584,
    labels: 578,
    wires: 583,
    netsLabeled: 108,
    netsSkippedUnconnected: 6,
    classes: { pwr: 3, pwrhi: 2, Default: 69, config: 7, clk: 3, ioout: 12, ioin: 8, iobidir: 8, usbdiff: 2 },
  });
});

test('导入工程通过 validateProject，且 normalizeProject 幂等', () => {
  const project = importedProject();
  const validation = validateProject(project);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.ok, true);

  const normalized = normalizeProject(project);
  assert.deepEqual(validation, validateProject(normalized));
  assert.deepEqual(stripMeta(normalized), stripMeta(project));
});

test('序列化往返：serializeProject → deserializeProject 原样恢复（除 meta.modified 刷新）', () => {
  const project = importedProject();
  const text = serializeProject(project);
  const roundTrip = deserializeProject(text);
  assert.deepEqual(roundTrip.warnings, []);
  assert.ok(roundTrip.project);
  assert.deepEqual(stripMeta(roundTrip.project), stripMeta(project));

  // 二次序列化必须稳定（字段顺序与内容都不再变化）。
  assert.deepEqual(stripMeta(normalizeProject(roundTrip.project)), stripMeta(project));
});

test('多图纸：Root / RP2040、sheet.kicad、title_block 与 9 槽 comment 全部保留', () => {
  const project = importedProject();
  assert.equal(project.sheets.length, 2);
  const [root, rp2040] = project.sheets;

  assert.equal(root.name, 'Root');
  assert.deepEqual(root.kicad, { number: '1', name: '/', tstamps: '/' });
  assert.equal(root.title.title, 'TinyTapeout 4/5 Demo Board PRELIM');
  assert.equal(root.title.company, 'Psychogenic Technologies');
  assert.equal(root.title.rev, '1.0.4');
  assert.equal(root.title.date, '2023-11-22');
  assert.equal(root.title.source, 'tinytapeout-demo.kicad_sch');
  assert.deepEqual(root.title.comments, [
    'See LICENSE.txt for details',
    'Licensed under Apache 2.0',
    '(C) 2023 Pat Deegan',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  assert.equal(root.symbols.length, 125);
  assert.equal(root.wires.length, 466);
  assert.equal(root.labels.length, 461);

  assert.equal(rp2040.name, 'RP2040');
  assert.deepEqual(rp2040.kicad, {
    number: '2',
    name: '/RP2040/',
    tstamps: '/5384e408-8f0c-411c-b558-df35c2e889ec/',
  });
  assert.equal(rp2040.title.title, 'RP2040 Basic Support');
  assert.equal(rp2040.title.rev, '1.0.3');
  assert.equal(rp2040.title.source, 'rp2040.kicad_sch');
  assert.equal(rp2040.title.comments.length, 9);
  assert.equal(rp2040.symbols.length, 25);
  assert.equal(rp2040.wires.length, 117);
  assert.equal(rp2040.labels.length, 117);
});

test('库符号：libpart → SymbolDef（引脚几何/名称/类型、0 引脚符号、docs/footprints/fields）', () => {
  const project = importedProject();
  assert.equal(project.library.symbols.length, 28);
  assert.deepEqual(project.library.footprints, []);

  const smallC = symbolDefOf(project, 'TinyTapeout:C_Small');
  assert.equal(smallC.name, 'C_Small');
  assert.equal(smallC.refPrefix, 'C');
  assert.deepEqual(smallC.libsource, { lib: 'TinyTapeout', part: 'C_Small' });
  assert.equal(smallC.description, 'Unpolarized capacitor, small symbol');
  assert.equal(smallC.pins.length, 2);
  assert.deepEqual(
    smallC.pins.map((pin) => [pin.number, pin.name, pin.electricalType]),
    [
      ['1', '', 'passive'],
      ['2', '', 'passive'],
    ],
  );
  for (const pin of smallC.pins) {
    assert.equal(pin.orientation, 'right');
    assert.equal(pin.x, -2.54);
    assert.equal(pin.length, 2.54);
    assert.equal(Number.isFinite(pin.y), true);
  }
  assert.equal(smallC.graphics.length, 1);
  assert.equal(smallC.graphics[0].type, 'rect');

  const fiducial = symbolDefOf(project, 'TinyTapeout:Fiducial');
  assert.equal(fiducial.pins.length, 0, '0 引脚符号应保留为空 pins 数组');
  assert.equal(fiducial.refPrefix, 'FID');
  assert.equal(fiducial.docs, '~');
  assert.deepEqual(fiducial.footprints, ['Fiducial*']);
  assert.deepEqual(
    fiducial.fields.map((field) => [field.name, field.value]),
    [
      ['Reference', 'FID'],
      ['Value', 'Fiducial'],
      ['Footprint', undefined],
      ['Datasheet', '~'],
      ['Description', 'Fiducial Marker'],
    ],
  );

  const usb = symbolDefOf(project, 'TinyTapeout:USB4500-03-0-A_REVA');
  // normalizeSymbolDef 把缺失的 docs 规范化为 ''（契约：'' 或 undefined ⇒ 导出时省略 docs 段）。
  assert.equal(usb.docs, '');
  assert.equal(usb.fields.length, 8);
  assert.equal(Object.prototype.hasOwnProperty.call(usb.fields[3], 'value'), false, '自闭合 field 无 value 键');
  assert.deepEqual(usb.fields[5], { name: 'MAXIMUM_PACKAGE_HEIGHT', value: '2.46mm' });

  // 每个符号定义都带非空 refPrefix 与合法电气类型。
  for (const symbol of project.library.symbols) {
    assert.ok(symbol.refPrefix.length > 0, symbol.id + ' 缺 refPrefix');
    for (const pin of symbol.pins) {
      assert.equal(typeof pin.number, 'string');
      assert.ok(pin.number.length > 0);
      assert.equal(Number.isFinite(pin.x) && Number.isFinite(pin.y), true);
    }
  }
});

test('元件元数据：symbol.kicad 的 libsource / property / field / sheetpath / tstamps 保序保留', () => {
  const project = importedProject();
  const c1 = symbolOf(project, 'C1');
  assert.equal(c1.symbolId, 'TinyTapeout:C_Small');
  assert.equal(c1.value, '1uF');
  assert.equal(c1.footprintId, 'Capacitor_SMD:C_0603_1608Metric');
  assert.deepEqual(c1.fields, {
    MPN: 'CL10A105KA8NNNC',
    MPN_ALT: 'C0603C105K4RAC7411',
    Characteristics: '1u 10V XR 0603',
    Footprint: 'Capacitor_SMD:C_0603_1608Metric',
    Datasheet: '~',
    Description: '',
  });
  assert.deepEqual(c1.kicad, {
    datasheet: '~',
    description: '',
    tstamps: '00db537f-1037-4fb6-9d9b-01d9f1f6a64d',
    libsource: {
      lib: 'TinyTapeout',
      part: 'C_Small',
      description: 'Unpolarized capacitor, small symbol',
    },
    properties: [
      { name: 'MPN', value: 'CL10A105KA8NNNC' },
      { name: 'MPN_ALT', value: 'C0603C105K4RAC7411' },
      { name: 'Characteristics', value: '1u 10V XR 0603' },
      { name: 'Sheetname', value: 'Root' },
      { name: 'Sheetfile', value: 'tinytapeout-demo.kicad_sch' },
      { name: 'ki_keywords', value: 'capacitor cap' },
      { name: 'ki_fp_filters', value: 'C_*' },
    ],
    fields: [
      { name: 'MPN', value: 'CL10A105KA8NNNC' },
      { name: 'MPN_ALT', value: 'C0603C105K4RAC7411' },
      { name: 'Characteristics', value: '1u 10V XR 0603' },
      { name: 'Footprint', value: 'Capacitor_SMD:C_0603_1608Metric' },
      { name: 'Datasheet', value: '~' },
      { name: 'Description' },
    ],
    sheetpath: { names: '/', tstamps: '/' },
  });

  // 子图元件的 sheetpath 与图纸一致。
  const u6 = symbolOf(project, 'U6');
  assert.equal(sheetOf(project, 'U6').kicad.name, '/RP2040/');
  assert.deepEqual(u6.kicad.sheetpath, {
    names: '/RP2040/',
    tstamps: '/5384e408-8f0c-411c-b558-df35c2e889ec/',
  });
  assert.equal(u6.kicad.properties.find((item) => item.name === 'Sheetname').value, 'RP2040');

  // 自闭合 property（dnp）不产生 value 键；空串 property 保留 ''。
  const dnp = project.sheets
    .flatMap((sheet) => sheet.symbols)
    .flatMap((symbol) => symbol.kicad.properties)
    .find((property) => property.name === 'dnp');
  assert.ok(dnp);
  assert.equal(Object.prototype.hasOwnProperty.call(dnp, 'value'), false);
  const jlc = project.sheets
    .flatMap((sheet) => sheet.symbols)
    .flatMap((symbol) => symbol.kicad.properties)
    .find((property) => property.name === 'JLC' && property.value === '');
  assert.ok(jlc, '(property (name "JLC") (value "")) 必须保留空串');
});

test('net class：写入 project.netClassAssignments（含 Default），键为可读网络名', () => {
  const project = importedProject();
  const assignments = project.netClassAssignments;
  assert.ok(assignments);
  const distribution = {};
  for (const value of Object.values(assignments)) distribution[value] = (distribution[value] || 0) + 1;
  assert.deepEqual(distribution, {
    pwr: 3,
    pwrhi: 2,
    Default: 63,
    config: 7,
    clk: 3,
    ioout: 12,
    ioin: 8,
    iobidir: 8,
    usbdiff: 2,
  });
  assert.equal(Object.keys(assignments).length, 108, '6 个 unconnected 网络不建标签，也不写 class');
  assert.equal(assignments.GND, 'pwr');
  assert.equal(assignments['+3V3'], 'pwr');
  assert.equal(assignments['SDI/out0'], 'ioout');
  assert.equal(assignments['usb_d+'], 'usbdiff');
  assert.equal(assignments.DVDD, 'Default');
  assert.equal(assignments['/RP2040/SWCLK'], 'Default');
  for (const key of Object.keys(assignments)) {
    assert.equal(key.includes('{slash}'), false, 'net class 键不得保留 {slash} 形式');
    assert.equal(typeof assignments[key], 'string');
    assert.ok(assignments[key].length > 0);
  }

  // buildNetlist 的 class 来自同一映射。
  const netlist = buildNetlist(project);
  assert.equal(netlist.nets.find((net) => net.name === 'GND').class, 'pwr');
  assert.equal(netlist.nets.find((net) => net.name === 'SDI/out0').class, 'ioout');
  assert.equal(netlist.nets.find((net) => net.name === 'DVDD').class, 'Default');
});

test('网络名解码：工程内不含 {slash}，层级前缀按图纸判定 local/global', () => {
  const project = importedProject();
  assert.equal(JSON.stringify(project).includes('{slash}'), false, '工程内不得保存 {slash} 形式');
  const labels = labelsOf(project);

  // 根级局部标签在 KiCad 里带 "/" 前缀 → 模型按规则存全局标签 "/CC1"。
  assert.ok(labels.some((label) => label.text === '/CC1' && label.kind === 'global'));
  assert.ok(labels.some((label) => label.text === '/~{CRVRST}' && label.kind === 'global'));
  // 子图局部标签：去掉 "/RP2040/" 前缀，kind=local，只出现在 RP2040 图纸。
  const dvdd = labels.filter((label) => label.text === 'DVDD');
  assert.ok(dvdd.length > 0);
  assert.ok(dvdd.every((label) => label.kind === 'local' && label.sheet === '/RP2040/'));
  assert.equal(labels.some((label) => label.text === '/RP2040/DVDD'), false);
  // 全局标签：{slash} 解码为 /，kind=global。
  assert.ok(labels.some((label) => label.text === 'SDI/out0' && label.kind === 'global'));
  assert.ok(labels.some((label) => label.text === 'cinc/out3' && label.kind === 'global'));
  assert.ok(labels.some((label) => label.text === '~{crst}/out2' && label.kind === 'global'));
  // 上划线标记逐字保留。
  assert.ok(labels.some((label) => label.text === '~{ctrl_sel_rst}'));

  // 跨图纸网络（如 /RP2040/SWCLK、SDI/out0）必须用全局标签才能跨图合并。
  const multiSheet = readKiCadNetlist(SAMPLE).nets.find((net) => net.name === '/RP2040/SWCLK');
  const prefixes = new Set(multiSheet.nodes.map((node) => symbolOf(project, node.ref).kicad.sheetpath.names));
  assert.equal(prefixes.size, 2);
  const swclkLabels = labels.filter((label) => label.text === '/RP2040/SWCLK');
  assert.equal(new Set(swclkLabels.map((label) => label.sheet)).size, 2);
  assert.ok(swclkLabels.every((label) => label.kind === 'global'));
});

test('buildNetlist：108 个标注网络名与 net→[ref,pin] 集合与源网表逐项一致（0 差异）', () => {
  const project = importedProject();
  const document = readKiCadNetlist(SAMPLE);
  const sheetPathByRef = new Map(
    document.components.map((component) => [component.ref, component.sheetpath.names]),
  );
  const netlist = buildNetlist(project);
  const byName = netsByName(netlist);

  let compared = 0;
  for (const net of document.nets) {
    if (net.name.startsWith('unconnected-(')) continue;
    compared += 1;
    const decoded = net.name.split('{slash}').join('/');
    const prefixes = [...new Set(net.nodes.map((node) => sheetPathByRef.get(node.ref)))];
    let expected = decoded;
    if (prefixes.length === 1 && prefixes[0] !== '/' && decoded.startsWith(prefixes[0])) {
      expected = decoded.slice(prefixes[0].length);
      // 子图局部标签：导出名 = sheet.kicad.name 前缀 + 标签文本。
      assert.equal(prefixes[0] + expected, decoded, net.name + ' 的局部名重建失败');
    }
    const candidates = byName.get(expected) || [];
    assert.equal(candidates.length, 1, '网络 ' + net.name + ' → ' + expected + ' 应唯一命中，实际 ' + candidates.length);
    assert.deepEqual(
      pinPairsOf(candidates[0]),
      net.nodes.map((node) => node.ref + '-' + node.pin).sort(),
      '网络 ' + net.name + ' 的引脚集合不一致',
    );
  }
  assert.equal(compared, 108);
  assert.equal(netlist.nets.length, 113, '108 个标注网络 + 5 个悬空引脚自动网络');
  assert.equal(netlist.stats.nets, 113);
  assert.equal(netlist.stats.pins, 583, '584 个 node 减去 1 个 no_connect 基础类型引脚');
});

test('unconnected 网络：6 个按契约跳过标签，5 个悬空引脚成自动网络，U3 pin4 留在元件引脚表', () => {
  const project = importedProject();
  const document = readKiCadNetlist(SAMPLE);
  const unconnected = document.nets.filter((net) => net.name.startsWith('unconnected-('));
  assert.equal(unconnected.length, 6);
  const sourcePins = unconnected.map((net) => net.nodes.map((node) => node.ref + '-' + node.pin)[0]).sort();
  assert.deepEqual(sourcePins, ['J15-A8', 'J15-B8', 'J16-1', 'J18-1', 'U3-4', 'X1-1']);

  const labels = labelsOf(project);
  assert.equal(labels.some((label) => label.text.startsWith('unconnected-(')), false);
  assert.equal(labels.some((label) => label.text.includes('unconnected')), false);

  const netlist = buildNetlist(project);
  const auto = netlist.nets.filter((net) => /^N\$/.test(net.name));
  assert.equal(auto.length, 5);
  for (const net of auto) assert.equal(net.pins.length, 1);
  assert.deepEqual(
    auto.flatMap((net) => pinPairsOf(net)).sort(),
    ['J15-A8', 'J15-B8', 'J16-1', 'J18-1', 'X1-1'],
  );
  // U3 pin4 是 no_connect 基础类型：connectivity 不把它放进任何网络，但元件引脚表仍完整。
  assert.equal(netlist.nets.some((net) => pinPairsOf(net).includes('U3-4')), false);
  const u3 = netlist.components.find((component) => component.designator === 'U3');
  const u3Pin4 = u3.pins.find((pin) => pin.number === '4');
  assert.deepEqual(u3Pin4, {
    number: '4',
    name: 'NC',
    electricalType: 'no_connect',
    noConnect: false,
    free: false,
  });
  // pintype 修饰符来自 node@pintype：J15 两个 +no_connect、X1 一个 input+no_connect。
  const j15 = symbolDefOf(project, 'TinyTapeout:USB4500-03-0-A_REVA');
  assert.ok(j15);
  assert.deepEqual(
    j15.pins
      .filter((pin) => pin.number === 'A8' || pin.number === 'B8')
      .map((pin) => [pin.number, pin.name, pin.electricalType, pin.noConnect]),
    [
      ['A8', 'SBU1', 'bidirectional', true],
      ['B8', 'SBU2', 'bidirectional', true],
    ],
  );
  for (const net of auto) {
    const pin = net.pins[0];
    if (pin.designator === 'J15') {
      assert.equal(pin.pintype, pin.electricalType, 'pintype 是基础类型，修饰由 noConnect 表达');
      assert.equal(pin.noConnect, true);
      assert.equal(pin.electricalType, 'bidirectional');
      assert.equal(typeof pin.pinfunction, 'string');
    }
    if (pin.designator === 'X1') {
      assert.equal(pin.noConnect, true);
      assert.equal(pin.electricalType, 'input');
      assert.equal(pin.pinfunction, 'Tri-State');
    }
  }
});

test('pinfunction 与 pintype 契约：引脚名原样保留，pintype 为基础类型 + noConnect/free 标志', () => {
  const project = importedProject();
  const netlist = buildNetlist(project);
  const gnd = netlist.nets.find((net) => net.name === 'GND');
  const j4 = gnd.pins.find((pin) => pin.designator === 'J4' && pin.pinNumber === 'A2');
  assert.equal(j4.pinfunction, 'GND');
  assert.equal(j4.pinName, 'GND');
  assert.equal(j4.electricalType, 'power_in');
  assert.equal(j4.pintype, 'power_in');
  assert.equal(j4.noConnect, false);
  assert.equal(j4.free, false);

  // 含 "/" 的引脚名不做 {slash} 编码。
  const labelled = netlist.nets.find((net) => net.name === '~{ctrl_sel_rst}');
  const j4a8 = labelled.pins.find((pin) => pin.designator === 'J4' && pin.pinNumber === 'A8');
  assert.equal(j4a8.pinfunction, 'mio[36]/~{ctrl_sel_rst}');

  // 库符号引脚 flags 与网表 node@pintype 一致（X1 的 pin1 为 input+no_connect）。
  const x1 = symbolDefOf(project, 'TinyTapeout:ECS-2520MV-xxx-xx');
  assert.ok(x1);
  const x1Pin1 = x1.pins.find((pin) => pin.number === '1');
  assert.deepEqual(
    { name: x1Pin1.name, electricalType: x1Pin1.electricalType, noConnect: x1Pin1.noConnect, free: x1Pin1.free },
    { name: 'Tri-State', electricalType: 'input', noConnect: true, free: false },
  );
});

test('畸形输入：空文本 / 括号不平衡 / 缺 export / 非字符串 → ok:false 且不抛异常', () => {
  const inputs = ['', '   ', '(export (version "E")', '(foo)', '(export (version "E")) (x)', null, undefined, 42, {}];
  for (const input of inputs) {
    const result = importKiCadNetlist(input);
    assert.equal(result.ok, false, JSON.stringify(input) + ' 应导入失败');
    assert.equal(result.project, undefined, '失败时不得产出半套工程');
    assert.ok(Array.isArray(result.errors));
    assert.ok(result.errors.length > 0);
    assert.equal(typeof result.errors[0], 'string');
    assert.match(result.errors[0], /^第 \d+ 行 \[[A-Z_]+\] /);
    assert.ok(Array.isArray(result.diagnostics));
    assert.equal(result.diagnostics.length, result.errors.length);
    assert.equal(Number.isInteger(result.diagnostics[0].line), true);
  }

  // 缺少 design / components / nets 段同样失败。
  const missing = importKiCadNetlist('(export (version "E"))');
  assert.equal(missing.ok, false);
  assert.ok(missing.diagnostics.some((item) => item.code === 'MISSING_SECTION'));
  assert.ok(missing.errors.length >= 3);
});

test('降级导入：缺少 libparts/libraries 段仍产出可校验工程，并以 warning 说明缺口', () => {
  const text = [
    '(export (version "E")',
    '  (design (source "mini.kicad_sch") (date "2026-01-01") (tool "t")',
    '    (sheet (number "1") (name "/") (tstamps "/") (title_block (title "T"))))',
    '  (components (comp (ref "R1") (value "1k") (footprint "")',
    '    (fields (field (name "Value") "1k")) (libsource (lib "L") (part "R") (description "res"))',
    '    (sheetpath (names "/") (tstamps "/")) (tstamps "t1")))',
    '  (nets (net (code "1") (name "N") (class "pwr")',
    '    (node (ref "R1") (pin "1") (pintype "passive")))))',
  ].join('\n');
  const result = importKiCadNetlist(text);
  assert.equal(result.ok, true);
  assert.equal(result.project.name, 'mini');
  assert.equal(result.project.library.symbols.length, 0);
  assert.deepEqual(result.project.netClassAssignments, {});
  const codes = result.warnings.map((warning) => warning.code);
  assert.ok(codes.includes('MISSING_LIBPARTS'));
  assert.ok(codes.includes('MISSING_LIBRARIES'));
  assert.ok(codes.includes('UNKNOWN_LIBPART'));
  assert.ok(codes.includes('MISSING_PIN_POINT'));
  assert.deepEqual(validateProject(result.project).errors, []);
});

test('空网表段（无 components / nets）也能导入为 1 张空图纸工程', () => {
  const result = importKiCadNetlist(
    [
      '(export (version "E")',
      '  (design (sheet (number "1") (name "/") (tstamps "/")))',
      '  (components)',
      '  (nets))',
    ].join('\n'),
  );
  assert.equal(result.ok, true);
  assert.equal(result.project.sheets.length, 1);
  assert.equal(result.project.sheets[0].symbols.length, 0);
  assert.equal(result.project.sheets[0].kicad.name, '/');
});

test('comp 多值 tstamps：导入保留完整数组，实例 id 取首值，buildNetlist 透传', () => {
  const project = importedProject();
  const j4 = symbolOf(project, 'J4');
  assert.deepEqual(j4.kicad.tstamps, [
    '4c9d5f26-ed78-4f01-a96d-6cb9799c635a',
    'd330ac86-79a4-43c5-9c0a-69cac1356867',
    '342c76f3-b2b8-40b2-a0b0-d83e480188cc',
  ]);
  assert.equal(j4.id, 'sym-4c9d5f26-ed78-4f01-a96d-6cb9799c635a', '实例 id 用首个 tstamps 派生并保持稳定');

  const u4 = symbolOf(project, 'U4');
  assert.equal(u4.kicad.tstamps.length, 5);
  assert.equal(u4.id, 'sym-71933cd7-333f-4442-aab4-3820c85802bb');

  const netlist = buildNetlist(project);
  assert.deepEqual(netlist.components.find((component) => component.designator === 'J4').kicad.tstamps, j4.kicad.tstamps);
  assert.deepEqual(netlist.components.find((component) => component.designator === 'U4').kicad.tstamps, u4.kicad.tstamps);
  assert.equal(symbolOf(project, 'C1').kicad.tstamps, '00db537f-1037-4fb6-9d9b-01d9f1f6a64d', '单值元件保持字符串');
});
