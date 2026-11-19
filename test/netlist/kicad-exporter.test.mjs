// KiCad 9 导出器测试：六分节结构、排版与文件级格式、字段/属性语义、网络名编码、pintype 修饰、四类排序、
// unconnected 网络合成与字节稳定性。用测试内最小 S-表达式解析器断言结构，不依赖外部解析器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildNetlist, EXPORTERS, generateKiCad } from '../../src/netlist/index.js';
import {
  commentsAsSlots9,
  decodeLabelText,
  encodeNetName,
  pintypeOf,
  stableUuid,
} from '../../src/netlist/kicad-format.js';
import { createProject, createSheet, createWire, createSymbolInstance, createLabel } from '../../src/model/project.js';
import { dividerProject, emptyProject, richAttributesProject, specialCharsProject } from './fixtures.mjs';

const GOLDEN_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../examples/tinytapeout-demo.net');

// ---------------------------------------------------------------- 最小 S-表达式解析器

function parseSExpr(text) {
  let index = 0;

  function skipWhitespace() {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  }

  function readString() {
    index += 1; // 跳过起始引号
    let value = '';
    while (index < text.length) {
      const char = text[index];
      index += 1;
      if (char === '\\') {
        const next = text[index];
        index += 1;
        if (next === 'n') value += '\n';
        else if (next === 't') value += '\t';
        else if (next === '\\') value += '\\';
        else if (next === '"') value += '"';
        else value += next;
        continue;
      }
      if (char === '"') return value;
      value += char;
    }
    throw new Error('字符串未闭合（位置 ' + index + '）');
  }

  function readNode() {
    skipWhitespace();
    if (text[index] !== '(') throw new Error('缺少左括号（位置 ' + index + '）');
    index += 1;
    const node = [];
    for (;;) {
      skipWhitespace();
      if (index >= text.length) throw new Error('意外结束（位置 ' + index + '）');
      const char = text[index];
      if (char === ')') {
        index += 1;
        return node;
      }
      if (char === '(') {
        node.push(readNode());
        continue;
      }
      if (char === '"') {
        node.push(readString());
        continue;
      }
      const start = index;
      while (index < text.length && !/[\s()"]/.test(text[index])) index += 1;
      node.push({ atom: text.slice(start, index) });
    }
  }

  const root = readNode();
  skipWhitespace();
  if (index !== text.length) throw new Error('根节点之后还有内容（位置 ' + index + '）');
  return root;
}

const nameOf = (node) => (Array.isArray(node) && node[0] && node[0].atom ? node[0].atom : '');

function childrenNamed(node, name) {
  return (Array.isArray(node) ? node : []).filter((child) => Array.isArray(child) && nameOf(child) === name);
}

function childNamed(node, name) {
  return childrenNamed(node, name)[0] || null;
}

/** 叶列表的直接字符串子节点（如 (value "x") 的 "x"、(field (name "N") "v") 的 "v"）。 */
function directStrings(node) {
  return (Array.isArray(node) ? node : []).filter((child) => typeof child === 'string');
}

function valueOf(node) {
  const values = directStrings(node);
  return values.length > 0 ? values[0] : undefined;
}

function childValue(node, name) {
  const child = childNamed(node, name);
  return child ? valueOf(child) : undefined;
}

function childNames(node) {
  return (Array.isArray(node) ? node : []).filter(Array.isArray).map(nameOf);
}

function parseExport(text) {
  const root = parseSExpr(text);
  assert.equal(nameOf(root), 'export', '根节点必须是 export');
  return root;
}

function designOf(root) {
  const design = childNamed(root, 'design');
  assert.ok(design, '必须有 design 段');
  return design;
}

function compsOf(root) {
  const components = childNamed(root, 'components');
  assert.ok(components, '必须有 components 段');
  return childrenNamed(components, 'comp');
}

function compByRef(root, ref) {
  const component = compsOf(root).find((node) => childValue(node, 'ref') === ref);
  assert.ok(component, '缺少 comp ' + ref);
  return component;
}

function libpartsOf(root) {
  const libparts = childNamed(root, 'libparts');
  assert.ok(libparts, '必须有 libparts 段');
  return childrenNamed(libparts, 'libpart');
}

function netsOf(root) {
  const nets = childNamed(root, 'nets');
  assert.ok(nets, '必须有 nets 段');
  return childrenNamed(nets, 'net');
}

function netByName(root, name) {
  const net = netsOf(root).find((node) => childValue(node, 'name') === name);
  assert.ok(net, '缺少 net ' + name);
  return net;
}

function nodesOf(net) {
  return childrenNamed(net, 'node');
}

function fieldEntries(fieldsNode) {
  return childrenNamed(fieldsNode, 'field').map((field) => ({
    name: childValue(field, 'name'),
    value: valueOf(field),
  }));
}

/** 单行括号净增减（跳过字符串字面量，避免 "(C)" 之类文本干扰）。 */
function depthDelta(line) {
  let delta = 0;
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '(') delta += 1;
    else if (char === ')') delta -= 1;
  }
  return delta;
}

/** 按首行模式提取一个完整 list 块的原文（含 CRLF，不含行尾换行）。 */
function blockLinesOf(text, pattern) {
  const lines = text.split('\r\n');
  const start = lines.findIndex((line) => pattern.test(line));
  assert.notEqual(start, -1, '找不到块：' + pattern);
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    depth += depthDelta(lines[index]);
    // 末行可能同时带上层 list 的闭括号（如 nets 段最后一个 net），因此用 <= 0 判定结束。
    if (depth <= 0) return lines.slice(start, index + 1).join('\r\n');
  }
  throw new Error('块未闭合：' + pattern);
}

/** libpart 节点 → 库符号定义（供导出器补全 libparts 段）。 */
function defFromLibpart(node) {
  return {
    id: childValue(node, 'part'),
    name: childValue(node, 'part'),
    refPrefix: 'U',
    description: childValue(node, 'description'),
    docs: childValue(node, 'docs'),
    footprints: childrenNamed(childNamed(node, 'footprints'), 'fp').map(valueOf),
    fields: fieldEntries(childNamed(node, 'fields')),
    pins: childrenNamed(childNamed(node, 'pins'), 'pin').map((pin) => ({
      number: childValue(pin, 'num'),
      name: childValue(pin, 'name'),
      electricalType: childValue(pin, 'type'),
    })),
  };
}

// ---------------------------------------------------------------- 夹具：golden 同款 6 个 unconnected 引脚

const DRAWN_SYMBOLS = [
  {
    id: 'TP',
    name: 'TP',
    refPrefix: 'TP',
    power: false,
    pins: [{ id: 'TP.1', name: 'P', number: '1', x: 0, y: 0, length: 0, orientation: 'up', electricalType: 'passive' }],
  },
  {
    id: 'J15',
    name: 'J15',
    refPrefix: 'J',
    power: false,
    pins: [
      { id: 'J15.A8', name: 'SBU1', number: 'A8', x: 0, y: 0, electricalType: 'bidirectional', noConnect: true },
      { id: 'J15.B8', name: 'SBU2', number: 'B8', x: 0, y: 2.54, electricalType: 'bidirectional', noConnect: true },
    ],
  },
  {
    id: 'J16',
    name: 'J16',
    refPrefix: 'J',
    power: false,
    pins: [{ id: 'J16.1', name: '1', number: '1', x: 0, y: 0, electricalType: 'passive' }],
  },
  {
    id: 'J18',
    name: 'J18',
    refPrefix: 'J',
    power: false,
    pins: [{ id: 'J18.1', name: '', number: '1', x: 0, y: 0, electricalType: 'passive' }],
  },
  {
    id: 'U3',
    name: 'U3',
    refPrefix: 'U',
    power: false,
    pins: [{ id: 'U3.4', name: 'NC', number: '4', x: 0, y: 0, electricalType: 'no_connect' }],
  },
  {
    id: 'X1',
    name: 'X1',
    refPrefix: 'X',
    power: false,
    pins: [{ id: 'X1.1', name: 'Tri-State', number: '1', x: 0, y: 0, electricalType: 'input', noConnect: true }],
  },
];

/** gold 夹具：2 个已连接网络（uio7 / usb_d+）夹住 6 个未连接引脚，用于排序与 unconnected 合成断言。 */
function unconnectedProject() {
  const project = createProject('unconnected 合成');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ symbolId: 'TP', designator: 'TP1', value: 'TP', x: 0, y: 0 }),
    createSymbolInstance({ symbolId: 'TP', designator: 'TP2', value: 'TP', x: 50, y: 0 }),
    createSymbolInstance({ symbolId: 'J15', designator: 'J15', value: 'USB', x: 1000, y: 0 }),
    createSymbolInstance({ symbolId: 'J16', designator: 'J16', value: 'HDR', x: 1010, y: 0 }),
    createSymbolInstance({ symbolId: 'J18', designator: 'J18', value: 'HDR', x: 1020, y: 0 }),
    createSymbolInstance({ symbolId: 'U3', designator: 'U3', value: 'IC', x: 1030, y: 0 }),
    createSymbolInstance({ symbolId: 'X1', designator: 'X1', value: 'XTAL', x: 1040, y: 0 }),
  );
  sheet.labels.push(
    createLabel({ x: 0, y: 0, text: 'uio7', kind: 'local' }),
    createLabel({ x: 50, y: 0, text: 'usb_d+', kind: 'local' }),
  );
  project.library.symbols = DRAWN_SYMBOLS.map((def) => JSON.parse(JSON.stringify(def)));
  return project;
}

// ---------------------------------------------------------------- 测试

test('六个分节齐全且段序与 KiCad 9 一致，version 为 "E"', () => {
  const text = generateKiCad(richAttributesProject());
  const root = parseExport(text);

  assert.deepEqual(childNames(root), ['version', 'design', 'components', 'libparts', 'libraries', 'nets']);
  assert.equal(childValue(root, 'version'), 'E');
  assert.deepEqual(childNames(designOf(root)), ['source', 'date', 'tool', 'sheet', 'sheet']);
});

test('design 段：source/date/tool 取 project.kicad，sheet 带 number/name/tstamps 与 9 槽 title_block', () => {
  const project = richAttributesProject();
  const root = parseExport(generateKiCad(project));
  const design = designOf(root);

  assert.equal(childValue(design, 'source'), project.kicad.source);
  assert.equal(childValue(design, 'date'), project.kicad.date);
  assert.equal(childValue(design, 'tool'), project.kicad.tool);

  const sheets = childrenNamed(design, 'sheet');
  assert.equal(sheets.length, 2);
  assert.deepEqual(
    sheets.map((sheet) => [childValue(sheet, 'number'), childValue(sheet, 'name'), childValue(sheet, 'tstamps')]),
    [
      ['1', '/', '/'],
      ['2', '/RP2040/', '/5384e408-8f0c-411c-b558-df35c2e889ec/'],
    ],
  );

  const subTitle = childNamed(sheets[1], 'title_block');
  assert.equal(childValue(subTitle, 'title'), 'RP2040 Basic Support');
  assert.equal(childValue(subTitle, 'company'), 'Psychogenic Technologies');
  assert.equal(childValue(subTitle, 'rev'), '1.0.3');
  assert.equal(childValue(subTitle, 'date'), '2023-11-22');
  assert.equal(childValue(subTitle, 'source'), 'rp2040.kicad_sch');
  const comments = childrenNamed(subTitle, 'comment');
  assert.equal(comments.length, 9);
  assert.deepEqual(
    comments.map((comment) => [childValue(comment, 'number'), childValue(comment, 'value')]),
    [
      ['1', 'See LICENSE.txt for details'],
      ['2', 'Licensed under Apache 2.0'],
      ['3', '(C) 2023 Pat Deegan'],
      ['4', ''],
      ['5', ''],
      ['6', ''],
      ['7', ''],
      ['8', ''],
      ['9', ''],
    ],
  );
});

test('文件级格式：UTF-8 无 BOM、CRLF、末尾无换行、无空行、无独立闭括号行、缩进为偶数空格', () => {
  const text = generateKiCad(richAttributesProject());

  assert.notEqual(text.charCodeAt(0), 0xfeff, '不得带 BOM');
  assert.equal(text.charCodeAt(0), 0x28, '首字符必须是左括号');
  assert.equal(/(?<!\r)\n/.test(text), false, '不得出现裸 LF');
  assert.equal(text.includes('\r\n'), true);
  assert.equal(text.endsWith('\n'), false, '文件末尾不得有换行');
  assert.equal(text.endsWith(')'), true);

  const lines = text.split('\r\n');
  assert.ok(lines.length > 100);
  assert.equal(lines.filter((line) => line.trim() === '').length, 0, '不得有空行');
  assert.equal(lines.filter((line) => /^\s*\)+\s*$/.test(line)).length, 0, '闭括号必须并入最后一行');
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    assert.equal(indent % 2, 0, '缩进必须是偶数空格：' + line);
    assert.equal(line.includes('\t'), false, '不得使用制表符缩进');
  }

  let depth = 0;
  let minimum = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    minimum = Math.min(minimum, depth);
  }
  assert.equal(depth, 0, '括号必须平衡');
  assert.equal(minimum, 0, '不得出现多余右括号');
});

test('comp 段按固定顺序输出字段，libsource 带 description，property 区分无值与空串', () => {
  const project = richAttributesProject();
  const root = parseExport(generateKiCad(project));
  const component = compByRef(root, 'R1');

  assert.deepEqual(childNames(component), [
    'ref',
    'value',
    'footprint',
    'datasheet',
    'description',
    'fields',
    'libsource',
    'property',
    'property',
    'property',
    'sheetpath',
    'tstamps',
  ]);
  assert.equal(childValue(component, 'value'), '10k');
  assert.equal(childValue(component, 'footprint'), 'R_0805');
  assert.equal(childValue(component, 'datasheet'), '~');
  assert.equal(childValue(component, 'description'), 'Resistor, small symbol');

  const fields = childNamed(component, 'fields');
  assert.deepEqual(fieldEntries(fields), [
    { name: 'Footprint', value: 'R_0805' },
    { name: 'Datasheet', value: '~' },
    { name: 'Description', value: 'Resistor, small symbol' },
  ]);

  const libsource = childNamed(component, 'libsource');
  assert.equal(childValue(libsource, 'lib'), 'TinyTapeout');
  assert.equal(childValue(libsource, 'part'), 'R_Small');
  assert.equal(childValue(libsource, 'description'), 'Resistor, small symbol');

  const properties = childrenNamed(component, 'property');
  assert.deepEqual(
    properties.map((property) => ({ name: childValue(property, 'name'), value: childValue(property, 'value') })),
    [
      { name: 'MPN', value: 'RC0603FR-0710KL' },
      { name: 'dnp', value: undefined },
      { name: 'JLC', value: '' },
    ],
  );

  const sheetpath = childNamed(component, 'sheetpath');
  assert.equal(childValue(sheetpath, 'names'), '/');
  assert.equal(childValue(sheetpath, 'tstamps'), '/');
  assert.equal(childValue(component, 'tstamps'), '00db537f-1037-4fb6-9d9b-01d9f1f6a64d');
});

test('datasheet 缺省为 "~"，kicad 元数据存在但为空时整段省略；空 fields 整段省略', () => {
  const legacy = parseExport(generateKiCad(dividerProject()));
  const r1 = compByRef(legacy, 'R1');
  assert.equal(childValue(r1, 'datasheet'), '~', '旧工程无 kicad 时 datasheet 缺省为 ~');
  assert.equal(childNamed(r1, 'description'), null, '空 description 整段省略');

  const project = createProject('空字段');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({
      symbolId: 'X',
      designator: 'U1',
      value: 'X',
      footprintId: 'SOT-23',
      kicad: { datasheet: '', description: '', fields: [], properties: [] },
    }),
  );
  project.library.symbols = [
    {
      id: 'X',
      name: 'X',
      refPrefix: 'U',
      power: false,
      pins: [{ id: 'X.1', name: 'A', number: '1', x: 0, y: 0, electricalType: 'passive' }],
    },
  ];

  const root = parseExport(generateKiCad(project));
  const component = compByRef(root, 'U1');
  assert.equal(childNamed(component, 'datasheet'), null, 'kicad.datasheet 为空串时省略 datasheet');
  assert.equal(childNamed(component, 'description'), null);
  assert.equal(childNamed(component, 'fields'), null, '空 fields 整段省略');
  assert.equal(childNamed(component, 'property'), null, '空 properties 整段省略');
});

test('net 段显式输出 class（缺省 Default），node 的 pinfunction 为空整段省略、非空保留原文', () => {
  const root = parseExport(generateKiCad(dividerProject()));
  const nets = netsOf(root);

  assert.deepEqual(nets.map((net) => [childValue(net, 'code'), childValue(net, 'name'), childValue(net, 'class')]), [
    ['1', 'GND', 'Default'],
    ['2', 'MID', 'Default'],
    ['3', 'VCC', 'Default'],
  ]);

  // 夹具里的电阻引脚名是 "~"（KiCad 的无名引脚写法）：不得写成 pinfunction "~" 或 ""。
  const r2 = nodesOf(netByName(root, 'GND')).find((node) => childValue(node, 'ref') === 'R2');
  assert.deepEqual(childNames(r2), ['ref', 'pin', 'pintype']);
  assert.equal(childValue(r2, 'pinfunction'), undefined);
  const text = generateKiCad(dividerProject());
  assert.equal(text.includes('(pinfunction "~")'), false);
  assert.equal(text.includes('(pinfunction "")'), false);

  // 电源符号引脚名非空 → 照常输出 pinfunction。
  const gndPin = nodesOf(netByName(root, 'GND')).find((node) => childValue(node, 'ref') === '#PWR02');
  assert.equal(childValue(gndPin, 'pinfunction'), 'GND');
});

test('pintype 按「基础类型+修饰」拼接：bidirectional+no_connect / input+free / 裸 no_connect', () => {
  const root = parseExport(generateKiCad(richAttributesProject()));
  const sbu1 = nodesOf(netByName(root, '/RP2040/SBU1'))[0];
  const mio = nodesOf(netByName(root, '/RP2040/mio[36]{slash}ctrl'))[0];
  const unconnected = nodesOf(netByName(root, 'unconnected-(U1-NC-Pad3)'))[0];

  assert.equal(childValue(sbu1, 'pintype'), 'bidirectional+no_connect');
  assert.equal(childValue(mio, 'pintype'), 'input+free');
  assert.equal(childValue(unconnected, 'pintype'), 'no_connect');
  assert.equal(childValue(unconnected, 'pinfunction'), 'NC');
  // pinfunction 保留原始 "/"，不做 {slash} 编码。
  assert.equal(childValue(mio, 'pinfunction'), 'mio[36]/ctrl');

  assert.equal(pintypeOf({ electricalType: 'bidirectional', noConnect: true }), 'bidirectional+no_connect');
  assert.equal(pintypeOf({ electricalType: 'no_connect', noConnect: true }), 'no_connect');
  assert.equal(pintypeOf({ electricalType: 'not_connected' }), 'no_connect');
  assert.equal(pintypeOf({ electricalType: 'input', free: true }), 'input+free');
  assert.equal(pintypeOf({ electricalType: '不是合法类型' }), 'passive');
  assert.equal(pintypeOf({ electricalType: 'passive', noConnect: true, free: true }), 'passive+no_connect+free');
});

test('网络名编码：只对标签文本编码 /，层级路径前缀与已编码原文逐字保留', () => {
  assert.equal(encodeNetName('SDI/out0', { sheetPath: '/', nameSource: 'local' }), 'SDI{slash}out0');
  assert.equal(encodeNetName('~{crst}/out2', { sheetPath: '/', nameSource: 'local' }), '~{crst}{slash}out2');
  assert.equal(encodeNetName('out0', { sheetPath: '/RP2040/', nameSource: 'local' }), '/RP2040/out0');
  assert.equal(
    encodeNetName('mio[36]/ctrl', { sheetPath: '/RP2040/', nameSource: 'local' }),
    '/RP2040/mio[36]{slash}ctrl',
  );
  // 已编码原文（层级前缀 / {slash}）逐字保留，不二次编码。
  assert.equal(encodeNetName('/CC1', { sheetPath: '/', nameSource: 'local' }), '/CC1');
  assert.equal(encodeNetName('/RP2040/DVDD', { sheetPath: '/RP2040/', nameSource: 'local' }), '/RP2040/DVDD');
  assert.equal(encodeNetName('SDI{slash}out0', { sheetPath: '/', nameSource: 'auto' }), 'SDI{slash}out0');
  // 电源名 / 全局标签 / 自动名是全局命名，不加图纸路径前缀。
  assert.equal(encodeNetName('GND', { sheetPath: '/RP2040/', nameSource: 'power' }), 'GND');
  assert.equal(encodeNetName('Net-(R1-Pad2)', { sheetPath: '/RP2040/', nameSource: 'auto' }), 'Net-(R1-Pad2)');
  assert.equal(decodeLabelText('SDI{slash}out0'), 'SDI/out0');
});

test('unconnected 网络合成：golden 同款 6 个名字、排序落在 uio7 与 usb_d+ 之间、class 缺省 Default', () => {
  const text = generateKiCad(unconnectedProject());
  const root = parseExport(text);
  const rows = netsOf(root).map((net) => [
    childValue(net, 'code'),
    childValue(net, 'name'),
    childValue(net, 'class'),
  ]);

  assert.deepEqual(rows, [
    ['1', 'uio7', 'Default'],
    ['2', 'unconnected-(J15-SBU1-PadA8)', 'Default'],
    ['3', 'unconnected-(J15-SBU2-PadB8)', 'Default'],
    ['4', 'unconnected-(J16-Pad1)', 'Default'],
    ['5', 'unconnected-(J18-Pad1)', 'Default'],
    ['6', 'unconnected-(U3-NC-Pad4)', 'Default'],
    ['7', 'unconnected-(X1-Tri-State-Pad1)', 'Default'],
    ['8', 'usb_d+', 'Default'],
  ]);

  const pintypes = Object.fromEntries(
    netsOf(root).map((net) => [
      childValue(net, 'name'),
      nodesOf(net).map((node) => [childValue(node, 'ref'), childValue(node, 'pin'), childValue(node, 'pinfunction'), childValue(node, 'pintype')]),
    ]),
  );
  assert.deepEqual(pintypes['unconnected-(J15-SBU1-PadA8)'], [['J15', 'A8', 'SBU1', 'bidirectional+no_connect']]);
  assert.deepEqual(pintypes['unconnected-(J15-SBU2-PadB8)'], [['J15', 'B8', 'SBU2', 'bidirectional+no_connect']]);
  // J16 只是悬空（无 noConnect 标记）：pintype 为 passive，pinfunction 仍输出 "1"。
  assert.deepEqual(pintypes['unconnected-(J16-Pad1)'], [['J16', '1', '1', 'passive']]);
  assert.deepEqual(pintypes['unconnected-(J18-Pad1)'], [['J18', '1', undefined, 'passive']]);
  assert.deepEqual(pintypes['unconnected-(U3-NC-Pad4)'], [['U3', '4', 'NC', 'no_connect']]);
  assert.deepEqual(pintypes['unconnected-(X1-Tri-State-Pad1)'], [['X1', '1', 'Tri-State', 'input+no_connect']]);
});

test('components 排序：先图纸顺序，再图纸内位号自然序（C42 在 C29 之前）', () => {
  const project = createProject('多图纸排序');
  const root = project.sheets[0];
  const sub = createSheet('子图', { index: 1, kicad: { number: '2', name: '/SUB/', tstamps: '/sub/' } });
  project.sheets.push(sub);

  for (const [designator, sheet] of [
    ['C42', root],
    ['C10', root],
    ['C2', root],
    ['R1', root],
    ['C29', sub],
    ['C1', sub],
    ['C4', sub],
  ]) {
    sheet.symbols.push(createSymbolInstance({ symbolId: 'R', designator, value: '1k', x: 0, y: 0 }));
  }
  project.library.symbols = [
    {
      id: 'R',
      name: 'R',
      refPrefix: 'R',
      power: false,
      pins: [
        { id: 'R.1', name: '', number: '1', x: 0, y: 0, electricalType: 'passive' },
        { id: 'R.2', name: '', number: '2', x: 5.08, y: 0, electricalType: 'passive' },
      ],
    },
  ];

  const refs = compsOf(parseExport(generateKiCad(project))).map((comp) => childValue(comp, 'ref'));
  assert.deepEqual(refs, ['C2', 'C10', 'C42', 'R1', 'C1', 'C4', 'C29']);
});

test('node 排序：按 (ref, pin) 纯 ASCII 字节序（C10 在 C4 之前、pin "12" 在 pin "6" 之前）', () => {
  const project = createProject('ASCII 排序');
  const sheet = project.sheets[0];
  const refs = ['C4', 'C10', 'C1', 'R2'];
  refs.forEach((designator, index) => {
    sheet.symbols.push(
      createSymbolInstance({
        symbolId: 'BUS',
        designator,
        value: 'BUS',
        x: 100 + index * 40,
        y: 0,
      }),
    );
  });
  project.library.symbols = [
    {
      id: 'BUS',
      name: 'BUS',
      refPrefix: 'J',
      power: false,
      pins: [
        { id: 'BUS.6', name: '', number: '6', x: 0, y: 0, electricalType: 'passive' },
        { id: 'BUS.12', name: '', number: '12', x: 0, y: 2.54, electricalType: 'passive' },
      ],
    },
  ];
  // 把所有实例的 pin1 用同一根长导线连起来（y=0 行），pin "6" 都落在导线上。
  sheet.wires.push({
    id: 'wire-bus',
    points: [
      { x: 100, y: 0 },
      { x: 220, y: 0 },
    ],
    width: 0.15,
  });

  const root = parseExport(generateKiCad(project));
  const nets = netsOf(root);
  const busNet = nets.find((net) => nodesOf(net).length >= 4);
  assert.ok(busNet, '应存在含 4 个节点以上的总线网络');
  const nodes = nodesOf(busNet).map((node) => [childValue(node, 'ref'), childValue(node, 'pin')]);
  assert.deepEqual(nodes, [
    ['C1', '6'],
    ['C10', '6'],
    ['C4', '6'],
    ['R2', '6'],
  ]);
});

test('nets 排序：网络名自然序并连续编号 1..N（N10 排在 N2 之后）', () => {
  const project = createProject('网络排序');
  const sheet = project.sheets[0];
  ['N10', 'N2', 'N1'].forEach((name, index) => {
    sheet.symbols.push(
      createSymbolInstance({ symbolId: 'TP', designator: 'TP' + (index + 1), value: 'TP', x: index * 20, y: 0 }),
    );
    sheet.labels.push(createLabel({ x: index * 20, y: 0, text: name, kind: 'local' }));
  });
  project.library.symbols = [
    {
      id: 'TP',
      name: 'TP',
      refPrefix: 'TP',
      power: false,
      pins: [{ id: 'TP.1', name: '', number: '1', x: 0, y: 0, electricalType: 'passive' }],
    },
  ];

  const nets = netsOf(parseExport(generateKiCad(project)));
  assert.deepEqual(
    nets.map((net) => [childValue(net, 'code'), childValue(net, 'name')]),
    [
      ['1', 'N1'],
      ['2', 'N2'],
      ['3', 'N10'],
    ],
  );
});

test('libparts：按实际使用的库符号去重，part 自然序，docs/footprints/fields/pins 按规范输出', () => {
  const root = parseExport(generateKiCad(richAttributesProject()));
  const libparts = libpartsOf(root);
  const keys = libparts.map((libpart) => [childValue(libpart, 'lib'), childValue(libpart, 'part')]);

  assert.deepEqual(keys, [
    ['TinyTapeout', 'GND'],
    ['TinyTapeout', 'RICH'],
    ['TinyTapeout', 'R_Small'],
    ['TinyTapeout', 'VCC'],
  ]);

  // R 被 R1/R2 两个实例使用，只能出现一次。
  assert.equal(keys.filter(([, part]) => part === 'R_Small').length, 1);

  const rich = libparts.find((libpart) => childValue(libpart, 'part') === 'RICH');
  assert.equal(childValue(rich, 'description'), 'Rich attribute test symbol');
  assert.equal(childValue(rich, 'docs'), 'https://example.com/docs');
  const footprints = childrenNamed(childNamed(rich, 'footprints'), 'fp').map(valueOf);
  assert.deepEqual(footprints, ['Package_SO:SOT-23', 'SOT-*'], 'footprints 与 fpFilters 取并集，footprints 优先');
  const pins = childrenNamed(childNamed(rich, 'pins'), 'pin').map((pin) => [
    childValue(pin, 'num'),
    childValue(pin, 'name'),
    childValue(pin, 'type'),
  ]);
  assert.deepEqual(pins, [
    ['1', 'SBU1', 'bidirectional'],
    ['2', 'mio[36]/ctrl', 'input'],
    ['3', 'NC', 'no_connect'],
  ]);

  // 0 引脚符号不输出 pins 块（规范 §3.4）。
  const project = createProject('零引脚');
  project.library.symbols = [
    { id: 'FID', name: 'Fiducial', refPrefix: 'FID', description: 'Fiducial Marker', power: false, pins: [] },
  ];
  project.sheets[0].symbols.push(createSymbolInstance({ symbolId: 'FID', designator: 'FID1', value: 'Fiducial' }));
  const zero = libpartsOf(parseExport(generateKiCad(project)))[0];
  assert.equal(childNamed(zero, 'pins'), null);
  assert.deepEqual(fieldEntries(childNamed(zero, 'fields')), [
    { name: 'Reference', value: 'FID' },
    { name: 'Value', value: 'Fiducial' },
    { name: 'Footprint', value: undefined },
    { name: 'Datasheet', value: '~' },
    { name: 'Description', value: 'Fiducial Marker' },
  ]);
});

test('libraries 段：logical 与 uri 取自 project.kicad.libraries，缺省输出空段', () => {
  const root = parseExport(generateKiCad(richAttributesProject()));
  const libraries = childNamed(root, 'libraries');
  const entries = childrenNamed(libraries, 'library');
  assert.equal(entries.length, 1);
  assert.equal(childValue(entries[0], 'logical'), 'TinyTapeout');
  assert.equal(
    valueOf(childNamed(entries[0], 'uri')),
    'C:\\workspace\\kicad\\tinytapeout-kicad-libs\\symbols\\TinyTapeout.kicad_sym',
  );

  const legacy = parseExport(generateKiCad(emptyProject()));
  assert.deepEqual(childNames(childNamed(legacy, 'libraries')), []);
  assert.deepEqual(childNames(childNamed(legacy, 'components')), []);
  assert.deepEqual(childNames(childNamed(legacy, 'nets')), []);

  // 重复 logical 只保留首个。
  const project = createProject('重复库');
  project.kicad = {
    source: '',
    tool: 'schematic-studio',
    date: '',
    version: 'E',
    libraries: [
      { logical: 'A', uri: 'a.kicad_sym' },
      { logical: 'A', uri: 'ignored.kicad_sym' },
    ],
  };
  const librariesNode = childNamed(parseExport(generateKiCad(project)), 'libraries');
  const unique = childrenNamed(librariesNode, 'library');
  assert.equal(unique.length, 1);
  assert.equal(valueOf(childNamed(unique[0], 'uri')), 'a.kicad_sym');
});

test('字符串转义：反斜杠、双引号、换行与制表符按 S-表达式规则转义', () => {
  const project = specialCharsProject();
  project.sheets[0].symbols[0].value = '10"k\\x\n\tend';
  const text = generateKiCad(project);

  assert.ok(text.includes('(value "10\\"k\\\\x\\n\\tend")'), '值中的引号/反斜杠/换行/制表符必须转义');
  assert.ok(text.includes('(source "特殊\\"字符\\"工程")'), 'design/source 中的引号必须转义');
  assert.equal(parseSExpr(text) !== null, true);
});

test('旧工程向后兼容：无 kicad 元数据仍导出合法网表，电源符号列入 components', () => {
  const project = dividerProject();
  const text = generateKiCad(project);
  const root = parseExport(text);

  const refs = compsOf(root).map((comp) => childValue(comp, 'ref'));
  assert.deepEqual(refs, ['#PWR01', '#PWR02', 'R1', 'R2'], '电源符号必须列入 components');
  assert.deepEqual(childNames(designOf(root)), ['source', 'date', 'tool', 'sheet']);
  assert.equal(childValue(designOf(root), 'tool'), 'schematic-studio');
  assert.equal(childValue(designOf(root), 'date'), project.meta.modified, '缺省 date 使用 meta.modified');
  assert.equal(childValue(designOf(root), 'source'), project.name);
  assert.equal(childValue(root, 'version'), 'E');

  const components = childNamed(root, 'components');
  for (const comp of childrenNamed(components, 'comp')) {
    for (const name of ['value', 'footprint', 'fields', 'libsource', 'sheetpath', 'tstamps']) {
      assert.ok(childNamed(comp, name), 'comp 缺少 ' + name + '：' + childValue(comp, 'ref'));
    }
  }
});

test('buildNetlist 透传 component.kicad（datasheet/libsource/properties/fields/sheetpath/tstamps）', () => {
  const project = richAttributesProject();
  const netlist = buildNetlist(project);
  const r1 = netlist.components.find((component) => component.designator === 'R1');
  const instance = project.sheets[0].symbols.find((symbol) => symbol.designator === 'R1');

  assert.ok(r1.kicad, 'buildNetlist 必须透传 component.kicad');
  assert.deepEqual(r1.kicad, instance.kicad);
  assert.equal(r1.kicad.libsource.part, 'R_Small');
  assert.equal(r1.kicad.tstamps, '00db537f-1037-4fb6-9d9b-01d9f1f6a64d');
  assert.equal(netlist.components.find((component) => component.designator === '#PWR01').kicad, undefined);
});

test('导出器契约不变：四个 id、label 更新为 KiCad 9、kicad 扩展名仍为 net', () => {
  assert.deepEqual(Object.keys(EXPORTERS), ['json', 'csv', 'kicad', 'protel']);
  assert.equal(EXPORTERS.kicad.label, 'KiCad 9 网表');
  assert.equal(EXPORTERS.kicad.extension, 'net');
  assert.equal(EXPORTERS.kicad.generate, generateKiCad);
  assert.equal(typeof EXPORTERS.json.generate, 'function');
  assert.equal(typeof EXPORTERS.csv.generate, 'function');
  assert.equal(typeof EXPORTERS.protel.generate, 'function');
});

test('字节稳定且不修改工程：同一工程重复导出逐字节相等', () => {
  const project = richAttributesProject();
  const snapshot = JSON.stringify(project);
  const first = generateKiCad(project);
  const second = generateKiCad(project);

  assert.equal(first, second);
  assert.equal(JSON.stringify(project), snapshot, '导出不得修改工程数据');
  assert.equal(stableUuid('same-seed'), stableUuid('same-seed'));
  assert.match(stableUuid('same-seed'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(stableUuid('a'), stableUuid('b'));
});

test('commentsAsSlots9 支持数组 / 字符串 / 缺失三种形态', () => {
  assert.deepEqual(commentsAsSlots9(['a', 'b']), ['a', 'b', '', '', '', '', '', '', '']);
  assert.deepEqual(commentsAsSlots9('a\nb'), ['a', 'b', '', '', '', '', '', '', '']);
  assert.deepEqual(commentsAsSlots9(''), ['', '', '', '', '', '', '', '', '']);
  assert.deepEqual(commentsAsSlots9(undefined), ['', '', '', '', '', '', '', '', '']);
  assert.deepEqual(commentsAsSlots9(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']), [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
  ]);
});

test('黄金样本同构：design / comp / libpart / libraries 块与 net 节点逐字节一致', (t) => {
  if (!fs.existsSync(GOLDEN_PATH)) {
    t.skip('黄金样本尚未合入当前分支（由 T1 提交 examples/tinytapeout-demo.net）');
    return;
  }

  const goldenText = fs.readFileSync(GOLDEN_PATH, 'utf8');
  const goldenRoot = parseExport(goldenText);
  const goldenDesign = designOf(goldenRoot);

  // 1) 工程级元数据：design + libraries 完全取黄金样本。
  const project = createProject('黄金样本重建');
  project.kicad = {
    source: childValue(goldenDesign, 'source'),
    tool: childValue(goldenDesign, 'tool'),
    date: childValue(goldenDesign, 'date'),
    version: childValue(goldenRoot, 'version'),
    libraries: childrenNamed(childNamed(goldenRoot, 'libraries'), 'library').map((library) => ({
      logical: childValue(library, 'logical'),
      uri: valueOf(childNamed(library, 'uri')),
    })),
  };
  project.sheets.length = 0;
  for (const sheetNode of childrenNamed(goldenDesign, 'sheet')) {
    const sheet = createSheet('sheet', { index: project.sheets.length });
    sheet.kicad = {
      number: childValue(sheetNode, 'number'),
      name: childValue(sheetNode, 'name'),
      tstamps: childValue(sheetNode, 'tstamps'),
    };
    const titleBlock = childNamed(sheetNode, 'title_block');
    sheet.title = {
      title: childValue(titleBlock, 'title'),
      company: childValue(titleBlock, 'company'),
      rev: childValue(titleBlock, 'rev'),
      date: childValue(titleBlock, 'date'),
      source: childValue(titleBlock, 'source'),
      comments: childrenNamed(titleBlock, 'comment').map((comment) => childValue(comment, 'value')),
    };
    project.sheets.push(sheet);
  }

  // 2) comp C1 + libpart C_Small：逐字段照抄黄金样本。
  const goldenComp = compByRef(goldenRoot, 'C1');
  const goldenLibpart = libpartsOf(goldenRoot).find((libpart) => childValue(libpart, 'part') === 'C_Small');
  assert.ok(goldenLibpart, '黄金样本应含 C_Small libpart');
  const goldenLibsource = childNamed(goldenComp, 'libsource');
  project.sheets[0].symbols.push(
    createSymbolInstance({
      symbolId: 'C_Small',
      designator: childValue(goldenComp, 'ref'),
      value: childValue(goldenComp, 'value'),
      footprintId: childValue(goldenComp, 'footprint'),
      x: 1000,
      y: 0,
      kicad: {
        datasheet: childValue(goldenComp, 'datasheet') || '',
        description: childValue(goldenComp, 'description') || '',
        tstamps: childValue(goldenComp, 'tstamps'),
        libsource: {
          lib: childValue(goldenLibsource, 'lib'),
          part: childValue(goldenLibsource, 'part'),
          description: childValue(goldenLibsource, 'description'),
        },
        properties: childrenNamed(goldenComp, 'property').map((property) =>
          childValue(property, 'value') === undefined
            ? { name: childValue(property, 'name') }
            : { name: childValue(property, 'name'), value: childValue(property, 'value') },
        ),
        fields: childrenNamed(childNamed(goldenComp, 'fields'), 'field').map((field) =>
          valueOf(field) === undefined
            ? { name: childValue(field, 'name') }
            : { name: childValue(field, 'name'), value: valueOf(field) },
        ),
        sheetpath: {
          names: childValue(childNamed(goldenComp, 'sheetpath'), 'names'),
          tstamps: childValue(childNamed(goldenComp, 'sheetpath'), 'tstamps'),
        },
      },
    }),
  );

  // 3) net SDI{slash}out0（code 65）：U4 pin7（无引脚名）+ U6 pin5（GPIO3）。
  const goldenNet = netByName(goldenRoot, 'SDI{slash}out0');
  const goldenNodes = nodesOf(goldenNet);
  const pinFromNode = (id, node) => ({
    id,
    number: childValue(node, 'pin'),
    name: childValue(node, 'pinfunction') || '',
    x: 0,
    y: 0,
    electricalType: (childValue(node, 'pintype') || 'passive').split('+')[0],
  });
  const u4Node = goldenNodes.find((node) => childValue(node, 'ref') === 'U4');
  const u6Node = goldenNodes.find((node) => childValue(node, 'ref') === 'U6');
  assert.ok(u4Node && u6Node, '黄金样本 SDI 网络应含 U4 / U6 节点');

  project.sheets[0].symbols.push(
    createSymbolInstance({ symbolId: 'U4', designator: 'U4', value: 'U4', x: 0, y: 0 }),
    createSymbolInstance({ symbolId: 'U6', designator: 'U6', value: 'U6', x: 10, y: 0 }),
  );
  project.sheets[0].wires.push(createWire([{ x: 0, y: 0 }, { x: 10, y: 0 }]));
  project.sheets[0].labels.push(createLabel({ x: 0, y: 0, text: 'SDI/out0', kind: 'global' }));
  project.netClassAssignments = { 'SDI/out0': 'ioout' };
  project.library.symbols = [
    defFromLibpart(goldenLibpart),
    { id: 'U4', name: 'U4', refPrefix: 'U', power: false, pins: [pinFromNode('U4.7', u4Node)] },
    { id: 'U6', name: 'U6', refPrefix: 'U', power: false, pins: [pinFromNode('U6.5', u6Node)] },
  ];

  const generated = generateKiCad(project);
  const block = (source, pattern) => blockLinesOf(source, pattern);

  assert.equal(block(generated, /^ {2}\(design$/), block(goldenText, /^ {2}\(design$/), 'design 段必须逐字节一致');
  assert.equal(
    block(generated, /^ {4}\(comp \(ref "C1"\)$/),
    block(goldenText, /^ {4}\(comp \(ref "C1"\)$/),
    'C1 comp 块必须逐字节一致',
  );
  assert.equal(
    block(generated, /^ {4}\(libpart \(lib "TinyTapeout"\) \(part "C_Small"\)$/),
    block(goldenText, /^ {4}\(libpart \(lib "TinyTapeout"\) \(part "C_Small"\)$/),
    'C_Small libpart 块必须逐字节一致',
  );
  assert.equal(block(generated, /^ {2}\(libraries$/), block(goldenText, /^ {2}\(libraries$/), 'libraries 段必须逐字节一致');

  // node 行可能同时带上层 list（nets / export）的闭括号：截到 node 自身闭合处再比较。
  const nodeText = (line) => {
    let depth = 0;
    let inString = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (inString) {
        if (char === '\\') index += 1;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) return line.slice(0, index + 1);
      }
    }
    return line;
  };
  const nodeLines = (source) =>
    source
      .split('\r\n')
      .filter((line) => /^ {6}\(node \(ref "/.test(line))
      .map(nodeText);
  const generatedNet = block(generated, /^ {4}\(net \(code "\d+"\) \(name "SDI\{slash\}out0"\)/);
  const goldenNetBlock = block(goldenText, /^ {4}\(net \(code "65"\) \(name "SDI\{slash\}out0"\)/);
  assert.deepEqual(nodeLines(generatedNet), nodeLines(goldenNetBlock), 'net 节点行必须逐字节一致');
});
