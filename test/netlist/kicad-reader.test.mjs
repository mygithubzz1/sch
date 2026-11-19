// KiCad 网表读取器测试：S-表达式词法/转义、嵌套结构、空值区分、黄金样本统计与畸形输入的行号诊断。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSExpression, readKiCadNetlist, tokenizeSExpression } from '../../src/netlist/kicad-reader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'examples/tinytapeout-demo.net');
const SAMPLE = fs.readFileSync(FIXTURE, 'utf8');

/** 黄金样本的最小可用子集：1 图纸 + 1 元件 + 1 网络，用于空值/转义/结构断言。 */
function miniNetlist(extra = '') {
  return [
    '(export (version "E")',
    '  (design (source "C:\\\\demo\\\\mini.kicad_sch") (date "2026-01-01T00:00:00+0000") (tool "Eeschema 9.0.8")',
    '    (sheet (number "1") (name "/") (tstamps "/")',
    '      (title_block (title "T") (company "C") (rev "R") (date "D") (source "mini.kicad_sch")',
    '        (comment (number "1") (value "c1")) (comment (number "2") (value "")))))',
    '  (components',
    '    (comp (ref "R1") (value "1k") (footprint "F") (datasheet "~")',
    '      (fields (field (name "MPN") "X") (field (name "Empty")))',
    '      (libsource (lib "L") (part "R") (description "res"))',
    '      (property (name "dnp")) (property (name "JLC") (value ""))',
    '      (sheetpath (names "/") (tstamps "/")) (tstamps "t1")))',
    '  (libparts',
    '    (libpart (lib "L") (part "R") (description "res") (docs "~")',
    '      (footprints (fp "R_*") (fp "R_0603*"))',
    '      (fields (field (name "Reference") "R") (field (name "Datasheet") "~"))',
    '      (pins (pin (num "1") (name "A/B") (type "passive")))))',
    '  (libraries (library (logical "L") (uri "C:\\\\lib\\\\L.kicad_sym")))',
    '  (nets',
    '    (net (code "1") (name "N") (class "pwr")',
    '      (node (ref "R1") (pin "1") (pinfunction "A/B") (pintype "passive"))',
    '      (node (ref "R1") (pin "2") (pintype "bidirectional+no_connect")))))',
    extra,
  ].join('\r\n');
}

test('词法：字符串转义 \\ \\" \\n \\t，未知转义保守保留为字符本身', () => {
  const parsed = parseSExpression(String.raw`(a "x\\y\"z\n\tq\r")`);
  assert.equal(parsed.ok, true);
  // \\ → \，\" → "，\n → 换行，\t → 制表符；\r 不在规范内 → 保留为 'r'。
  assert.equal(parsed.tree[1], 'x\\y"z\n\tqr');
});

test('词法：原子/列表/字符串混合，token 与列表都带 1-based 行号', () => {
  const lexed = tokenizeSExpression('(a 1\n  (b "c"))');
  assert.equal(lexed.ok, true);
  assert.deepEqual(
    lexed.tokens.map((token) => token.type),
    ['list-start', 'atom', 'atom', 'list-start', 'atom', 'string', 'list-end', 'list-end'],
  );
  assert.deepEqual(
    lexed.tokens.map((token) => token.line),
    [1, 1, 1, 2, 2, 2, 2, 2],
  );

  const parsed = parseSExpression('(a 1\n  (b "c"))');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.tree.line, 1);
  assert.equal(parsed.tree[2].line, 2);
  assert.deepEqual([parsed.tree[2][0], parsed.tree[2][1]], ['b', 'c']);
});

test('黄金样本：顶层计数与分节投影与实测统计一致（150/114/584/28/2/1）', () => {
  const doc = readKiCadNetlist(SAMPLE);
  assert.equal(doc.ok, true);
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(doc.warnings, []);
  assert.equal(doc.version, 'E');
  assert.equal(doc.design.source, 'C:\\workspace\\kicad\\demos\\tiny_tapeout\\tinytapeout-demo.kicad_sch');
  assert.equal(doc.design.date, '2026-11-19T10:25:58+0800');
  assert.equal(doc.design.tool, 'Eeschema 9.0.8-6-gca86c82f9b4-dirty');
  assert.equal(doc.design.sheets.length, 2);
  assert.equal(doc.components.length, 150);
  assert.equal(doc.libparts.length, 28);
  assert.equal(doc.libraries.length, 1);
  assert.equal(doc.nets.length, 114);
  assert.equal(
    doc.nets.reduce((total, net) => total + net.nodes.length, 0),
    584,
  );
  assert.deepEqual(
    doc.nets.map((net) => net.code),
    Array.from({ length: 114 }, (unused, index) => String(index + 1)),
  );
  assert.deepEqual(doc.libraries[0], {
    logical: 'TinyTapeout',
    uri: 'C:\\workspace\\kicad\\demos\\tiny_tapeout/tinytapeout-kicad-libs/symbols/TinyTapeout.kicad_sym',
  });
});

test('黄金样本：sheet 与 title_block（9 槽 comment、source、与 design/date 区分）', () => {
  const doc = readKiCadNetlist(SAMPLE);
  const [root, child] = doc.design.sheets;
  assert.deepEqual(
    { number: root.number, name: root.name, tstamps: root.tstamps },
    { number: '1', name: '/', tstamps: '/' },
  );
  assert.equal(child.number, '2');
  assert.equal(child.name, '/RP2040/');
  assert.equal(child.tstamps, '/5384e408-8f0c-411c-b558-df35c2e889ec/');

  assert.equal(root.titleBlock.title, 'TinyTapeout 4/5 Demo Board PRELIM');
  assert.equal(root.titleBlock.company, 'Psychogenic Technologies');
  assert.equal(root.titleBlock.rev, '1.0.4');
  assert.equal(root.titleBlock.date, '2023-11-22');
  assert.equal(root.titleBlock.source, 'tinytapeout-demo.kicad_sch');
  assert.deepEqual(root.titleBlock.comments, [
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
  assert.equal(child.titleBlock.rev, '1.0.3');
  assert.equal(child.titleBlock.source, 'rp2040.kicad_sch');
  assert.equal(child.titleBlock.comments.length, 9);
});

test('黄金样本：comp 的 fields/property 保序，且区分「无 value」与空串', () => {
  const doc = readKiCadNetlist(SAMPLE);
  const c1 = doc.components.find((component) => component.ref === 'C1');
  assert.equal(c1.value, '1uF');
  assert.equal(c1.footprint, 'Capacitor_SMD:C_0603_1608Metric');
  assert.equal(c1.datasheet, '~');
  assert.deepEqual(c1.libsource, {
    lib: 'TinyTapeout',
    part: 'C_Small',
    description: 'Unpolarized capacitor, small symbol',
  });
  assert.equal(c1.tstamps, '00db537f-1037-4fb6-9d9b-01d9f1f6a64d');
  assert.deepEqual(c1.sheetpath, { names: '/', tstamps: '/' });
  assert.deepEqual(
    c1.fields.map((field) => field.name),
    ['MPN', 'MPN_ALT', 'Characteristics', 'Footprint', 'Datasheet', 'Description'],
  );
  // 最后一个 Description 是自闭合 (field (name "Description"))：没有 value 键。
  assert.equal(Object.prototype.hasOwnProperty.call(c1.fields[5], 'value'), false);
  assert.deepEqual(c1.properties.map((property) => property.name), [
    'MPN',
    'MPN_ALT',
    'Characteristics',
    'Sheetname',
    'Sheetfile',
    'ki_keywords',
    'ki_fp_filters',
  ]);

  const c2 = doc.components.find((component) => component.ref === 'C2');
  const jlc = c2.properties.find((property) => property.name === 'JLC');
  assert.equal(jlc.value, '', '(property (name "JLC") (value "")) 必须保留空串');
  const dnp = doc.components
    .flatMap((component) => component.properties)
    .find((property) => property.name === 'dnp');
  assert.equal(Object.prototype.hasOwnProperty.call(dnp, 'value'), false, '自闭合 property 不得有 value 键');
  assert.equal(doc.components.filter((component) => component.datasheet === undefined).length, 10);
});

test('黄金样本：libpart 的 docs/footprints/fields/pins，0 引脚符号合法', () => {
  const doc = readKiCadNetlist(SAMPLE);
  const fiducial = doc.libparts.find((libpart) => libpart.part === 'Fiducial');
  assert.deepEqual(fiducial.pins, []);
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

  const usb = doc.libparts.find((libpart) => libpart.part === 'USB4500-03-0-A_REVA');
  assert.equal(usb.docs, undefined, '缺失 docs 段时保持缺键（不是空串）');
  assert.equal(usb.fields.length, 8);
  assert.deepEqual(usb.fields[5], { name: 'MAXIMUM_PACKAGE_HEIGHT', value: '2.46mm' });

  const totalPins = doc.libparts.reduce((total, libpart) => total + libpart.pins.length, 0);
  assert.equal(totalPins, 287, 'libpart 引脚总数（§3.4 实测 287）');
});

test('黄金样本：net 的 class、pintype 修饰、pinfunction 省略形态', () => {
  const doc = readKiCadNetlist(SAMPLE);
  const classes = {};
  for (const net of doc.nets) classes[net.class] = (classes[net.class] || 0) + 1;
  assert.deepEqual(classes, {
    pwr: 3,
    pwrhi: 2,
    Default: 69,
    config: 7,
    clk: 3,
    ioout: 12,
    ioin: 8,
    iobidir: 8,
    usbdiff: 2,
  });

  const nodes = doc.nets.flatMap((net) => net.nodes);
  const withFunction = nodes.filter((node) => node.pinfunction !== undefined);
  assert.equal(withFunction.length, 360);
  assert.equal(nodes.length - withFunction.length, 224);
  assert.ok(withFunction.some((node) => node.pinfunction.includes('/')), 'pinfunction 保留原始 /');
  assert.ok(!withFunction.some((node) => node.pinfunction.includes('{slash}')), 'pinfunction 不做 {slash} 编码');

  const noConnectNodes = nodes.filter((node) => node.pintype.includes('+no_connect'));
  assert.deepEqual(
    noConnectNodes.map((node) => [node.ref, node.pin, node.pintype]),
    [
      ['J15', 'A8', 'bidirectional+no_connect'],
      ['J15', 'B8', 'bidirectional+no_connect'],
      ['X1', '1', 'input+no_connect'],
    ],
  );
  assert.equal(nodes.filter((node) => node.pintype === 'no_connect').length, 1);

  const slashNet = doc.nets.find((net) => net.name === 'SDI{slash}out0');
  assert.ok(slashNet, '读取器逐字保留 {slash}（解码是导入层的职责）');
  const hierarchyNet = doc.nets.find((net) => net.name === '/RP2040/DVDD');
  assert.ok(hierarchyNet, '层级路径前缀的裸 / 原样保留');
});

test('CRLF、无结尾换行与 UTF-8 BOM 都能读取', () => {
  const withBom = '\uFEFF' + miniNetlist();
  const doc = readKiCadNetlist(withBom);
  assert.equal(doc.ok, true);
  assert.equal(doc.components.length, 1);
  assert.equal(doc.nets.length, 1);
  assert.equal(SAMPLE.endsWith(')'), true);
  assert.equal(SAMPLE.includes('\r\n'), true);
  assert.equal(SAMPLE.includes('\n\n'), false, '黄金样本没有空行');
});

test('mini 网表：自闭合 field/property 与空串严格区分，node 省略 pinfunction', () => {
  const doc = readKiCadNetlist(miniNetlist());
  assert.equal(doc.ok, true);
  assert.deepEqual(doc.warnings, []);
  const [comp] = doc.components;
  assert.deepEqual(comp.fields, [{ name: 'MPN', value: 'X' }, { name: 'Empty' }]);
  assert.deepEqual(comp.properties, [{ name: 'dnp' }, { name: 'JLC', value: '' }]);
  assert.equal(doc.design.sheets[0].titleBlock.comments.length, 9);
  assert.equal(doc.design.sheets[0].titleBlock.comments[1], '');
  const [net] = doc.nets;
  assert.equal(net.nodes[0].pinfunction, 'A/B');
  assert.equal(Object.prototype.hasOwnProperty.call(net.nodes[1], 'pinfunction'), false);
  assert.deepEqual(doc.libparts[0].footprints, ['R_*', 'R_0603*']);
});

test('顶层分节顺序不影响语义（T4 必须允许任意顺序）', () => {
  const reordered = [
    '(export (version "E")',
    '  (nets (net (code "1") (name "N") (class "Default")',
    '    (node (ref "R1") (pin "1") (pintype "passive"))))',
    '  (libraries)',
    '  (libparts)',
    '  (components (comp (ref "R1") (value "1k") (footprint "F")',
    '    (fields (field (name "Value") "1k")) (libsource (lib "L") (part "R") (description "res"))',
    '    (sheetpath (names "/") (tstamps "/")) (tstamps "t1")))',
    '  (design (source "x.kicad_sch") (date "d") (tool "t")',
    '    (sheet (number "1") (name "/") (tstamps "/") (title_block (title "T")))))',
  ].join('\n');
  const doc = readKiCadNetlist(reordered);
  assert.equal(doc.ok, true);
  assert.equal(doc.components.length, 1);
  assert.equal(doc.nets.length, 1);
  assert.equal(doc.design.sheets[0].titleBlock.title, 'T');
});

test('畸形输入：空文本/括号不平衡/字符串未闭合/缺 export/多余内容都返回行号且不抛异常', () => {
  const cases = [
    { text: '', code: 'EMPTY_INPUT' },
    { text: '   \r\n ', code: 'EMPTY_INPUT' },
    { text: '(export (version "E")', code: 'UNTERMINATED_LIST' },
    { text: '(foo)', code: 'MISSING_EXPORT' },
    { text: ')', code: 'MISSING_EXPORT' },
    { text: '(export (version "E")) (extra)', code: 'TRAILING_TOKEN' },
    { text: '(export "abc', code: 'UNTERMINATED_STRING' },
  ];
  for (const item of cases) {
    const doc = readKiCadNetlist(item.text);
    assert.equal(doc.ok, false, JSON.stringify(item.text) + ' 应解析失败');
    assert.ok(doc.errors.length > 0);
    assert.equal(doc.errors[0].code, item.code);
    assert.equal(Number.isInteger(doc.errors[0].line), true);
    assert.ok(doc.errors[0].line >= 1);
    assert.equal(typeof doc.errors[0].message, 'string');
    assert.ok(doc.errors[0].message.length > 0);
  }

  const unbalanced = readKiCadNetlist('(export (version "E")\r\n  (design\r\n    (sheet)');
  assert.equal(unbalanced.ok, false);
  assert.ok(unbalanced.errors.some((error) => error.code === 'UNTERMINATED_LIST' && error.line === 2));

  // 非字符串输入也不得抛异常。
  for (const value of [null, undefined, 42, {}, []]) {
    const doc = readKiCadNetlist(value);
    assert.equal(doc.ok, false);
    assert.ok(doc.errors.length > 0);
  }
});

test('结构错误：缺少 design/components/nets、comp 缺 ref、net 缺 name 都拒绝', () => {
  const missingSections = readKiCadNetlist('(export (version "E"))');
  assert.equal(missingSections.ok, false);
  const codes = missingSections.errors.map((error) => error.code);
  assert.equal(codes.filter((code) => code === 'MISSING_SECTION').length, 3);

  const badComp = readKiCadNetlist(
    [
      '(export (version "E") (design (sheet (number "1") (name "/") (tstamps "/")))',
      '  (components (comp (value "x")))',
      '  (nets (net (code "1") (class "Default"))))',
    ].join('\n'),
  );
  assert.equal(badComp.ok, false);
  assert.ok(badComp.errors.some((error) => error.code === 'MISSING_COMP_REF'));
  assert.ok(badComp.errors.some((error) => error.code === 'MISSING_NET_NAME'));

  const badLibpart = readKiCadNetlist(
    [
      '(export (version "E") (design (sheet (number "1") (name "/") (tstamps "/")))',
      '  (components)',
      '  (libparts (libpart (part "R") (description "res")))',
      '  (nets))',
    ].join('\n'),
  );
  assert.equal(badLibpart.ok, false);
  assert.ok(badLibpart.errors.some((error) => error.code === 'MISSING_LIBPART_KEY'));
});

test('缺 libparts/libraries 段时只告警，不阻断解析', () => {
  const doc = readKiCadNetlist(
    [
      '(export (version "E") (design (sheet (number "1") (name "/") (tstamps "/")))',
      '  (components)',
      '  (nets))',
    ].join('\n'),
  );
  assert.equal(doc.ok, true);
  assert.equal(doc.libparts.length, 0);
  assert.deepEqual(
    doc.warnings.map((warning) => warning.code).sort(),
    ['MISSING_LIBPARTS', 'MISSING_LIBRARIES'],
  );
});
