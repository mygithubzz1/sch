// KiCad 网表语义往返集成测试（T6 验收）：
// examples/tinytapeout-demo.net（KiCad 9.0.8 黄金样本）→ importKiCadNetlist → generateKiCad → readKiCadNetlist，
// 逐网络、逐节点、逐元件比对「导入 → 重建 → 再导出」的语义一致性。
//
// 断言口径（对照 docs/NETLIST_KICAD_SPEC.md §9 与 T6 任务书）：
// - 网络名集合、网络 → 排序后 [ref,pin] 集合、net class、节点 pintype/pinfunction 与源网表完全一致；
// - 元件位号集合一致，libparts 不减少，design.sheet 数量一致；
// - 导出文本满足 KiCad 9 文件级格式（UTF-8 无 BOM、全 CRLF、末尾无换行）；
// - 二次往返是不动点（导出 → 再导入 → 再导出 字节稳定），证明重建过程无信息漂移。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProject } from '../../src/core/schema.js';
import { buildNetlist, generateKiCad } from '../../src/netlist/index.js';
import { importKiCadNetlist } from '../../src/netlist/kicad-import.js';
import { readKiCadNetlist } from '../../src/netlist/kicad-reader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'examples/tinytapeout-demo.net');
const SOURCE_TEXT = fs.readFileSync(FIXTURE, 'utf8');

// 黄金样本 254KB：整个往返只在首次用到时构建一次，避免每个用例重复导入 150 元件 / 583 导线。
let cache = null;

function roundtrip() {
  if (cache !== null) return cache;
  const sourceDoc = readKiCadNetlist(SOURCE_TEXT);
  assert.equal(sourceDoc.ok, true, '黄金样本应可解析：' + JSON.stringify(sourceDoc.errors));
  const imported = importKiCadNetlist(SOURCE_TEXT);
  assert.equal(imported.ok, true, '黄金样本应可导入：' + (imported.errors || []).join('；'));
  const generated = generateKiCad(imported.project);
  const regeneratedDoc = readKiCadNetlist(generated);
  assert.equal(
    regeneratedDoc.ok,
    true,
    '再导出的网表应可解析：' + JSON.stringify(regeneratedDoc.errors),
  );
  cache = { sourceDoc, imported, generated, regeneratedDoc };
  return cache;
}

/** 网络名 → { class, pins: [{ ref, pin }] }（pins 按 ref、pin 的码点序排序，消除行序影响）。 */
function netTable(doc) {
  const table = new Map();
  for (const net of doc.nets) {
    const pins = net.nodes
      .map((node) => ({ ref: node.ref, pin: node.pin }))
      .sort((left, right) => compareText(left.ref, right.ref) || compareText(left.pin, right.pin));
    table.set(net.name, { className: net.class === undefined || net.class === '' ? 'Default' : net.class, pins });
  }
  return table;
}

/** 节点级属性表：`网络|ref|pin` → { pintype, pinfunction }（缺 token 归一为 null）。 */
function nodeTable(doc) {
  const table = new Map();
  for (const net of doc.nets) {
    for (const node of net.nodes) {
      table.set(net.name + '|' + node.ref + '|' + node.pin, {
        pintype: node.pintype,
        pinfunction: node.pinfunction === undefined ? null : node.pinfunction,
      });
    }
  }
  return table;
}

function classHistogram(doc) {
  const histogram = {};
  for (const net of doc.nets) {
    const className = net.class === undefined || net.class === '' ? 'Default' : net.class;
    histogram[className] = (histogram[className] || 0) + 1;
  }
  return histogram;
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

test('黄金样本可导入，工程通过校验且网表可构建', () => {
  const { sourceDoc, imported } = roundtrip();
  assert.equal(sourceDoc.nets.length, 114, '黄金样本应有 114 个网络');
  assert.equal(imported.warnings.length, 0, '导入不应产生告警：' + JSON.stringify(imported.warnings));
  assert.deepEqual(
    {
      sheets: imported.stats.sheets,
      components: imported.stats.components,
      libparts: imported.stats.libparts,
      libraries: imported.stats.libraries,
      nets: imported.stats.nets,
      nodes: imported.stats.nodes,
    },
    { sheets: 2, components: 150, libparts: 28, libraries: 1, nets: 114, nodes: 584 },
    '导入统计应与黄金样本一致',
  );

  const validation = validateProject(imported.project);
  assert.equal(validation.ok, true, '导入工程应通过 validateProject：' + JSON.stringify(validation.errors));

  const netlist = buildNetlist(imported.project);
  assert.equal(netlist.ok, true, '导入工程应可构建网表：' + JSON.stringify(netlist.warnings));
  assert.ok(netlist.nets.length > 0, '构建出的网表不应为空');
});

test('导出文本满足 KiCad 9 文件级格式（无 BOM、全 CRLF、末尾无换行）', () => {
  const { imported, generated } = roundtrip();
  assert.equal(generated.charCodeAt(0) === 0xfeff, false, '导出文本不应带 UTF-8 BOM');
  assert.equal((generated.match(/(?<!\r)\n/g) || []).length, 0, '不应存在裸 LF 行尾');
  const crlfCount = (generated.match(/\r\n/g) || []).length;
  assert.equal(crlfCount, generated.split('\r\n').length - 1, '每一行都应以 CRLF 分隔');
  assert.equal(/[\r\n]$/.test(generated), false, '文件末尾不应有换行');
  assert.equal(generated.endsWith(')'), true, '文件应以顶层闭括号结束');
  assert.equal(generateKiCad(imported.project), generated, '同一工程重复导出应字节稳定');
});

test('网络名集合与「网络 → 排序后 [ref,pin] 集合」与源网表完全一致', () => {
  const { sourceDoc, regeneratedDoc } = roundtrip();
  const source = netTable(sourceDoc);
  const result = netTable(regeneratedDoc);

  assert.equal(result.size, 114, '再导出应有 114 个网络');
  assert.deepEqual(
    [...source.keys()].sort(compareText),
    [...result.keys()].sort(compareText),
    '网络名集合应与源网表一致',
  );
  assert.deepEqual(
    regeneratedDoc.nets.map((net) => net.code),
    sourceDoc.nets.map((net) => net.code),
    '网络编号与顺序应与源网表一致（1..114）',
  );

  const mismatches = [];
  for (const [name, expected] of source) {
    const actual = result.get(name);
    if (actual === undefined) {
      mismatches.push(name + '：再导出缺少该网络');
      continue;
    }
    if (JSON.stringify(actual.pins) !== JSON.stringify(expected.pins)) {
      mismatches.push(name + '：' + JSON.stringify(actual.pins) + ' ≠ ' + JSON.stringify(expected.pins));
    }
  }
  assert.deepEqual(mismatches, [], '每个网络的引脚集合应与源网表一致');
  const sourceNodes = sourceDoc.nets.reduce((total, net) => total + net.nodes.length, 0);
  const resultNodes = regeneratedDoc.nets.reduce((total, net) => total + net.nodes.length, 0);
  assert.equal(sourceNodes, 584, '源网表应有 584 个节点');
  assert.equal(resultNodes, 584, '再导出的节点总数应守恒');
});

test('每个网络的 net class 与源网表一致', () => {
  const { sourceDoc, regeneratedDoc } = roundtrip();
  const source = netTable(sourceDoc);
  const result = netTable(regeneratedDoc);
  const diffs = [];
  for (const [name, expected] of source) {
    const actual = result.get(name);
    if (actual === undefined) {
      diffs.push(name + '：缺少网络');
      continue;
    }
    if (actual.className !== expected.className) {
      diffs.push(name + '：' + actual.className + ' ≠ ' + expected.className);
    }
  }
  assert.deepEqual(diffs, [], '每个网络的 net class 应与源网表一致');
  assert.deepEqual(classHistogram(regeneratedDoc), classHistogram(sourceDoc), 'net class 直方图应一致');
  assert.deepEqual(
    classHistogram(sourceDoc),
    { Default: 69, pwr: 3, pwrhi: 2, config: 7, clk: 3, ioout: 12, ioin: 8, iobidir: 8, usbdiff: 2 },
    '源网表 net class 分布应固定（9 类 / 114 网络）',
  );
});

test('节点级 pintype 与 pinfunction 与源网表一致', () => {
  const { sourceDoc, regeneratedDoc } = roundtrip();
  const source = nodeTable(sourceDoc);
  const result = nodeTable(regeneratedDoc);
  assert.equal(result.size, source.size, '节点条目数应一致');
  const diffs = [];
  for (const [key, expected] of source) {
    const actual = result.get(key);
    if (actual === undefined) {
      diffs.push(key + '：缺少节点');
      continue;
    }
    if (actual.pintype !== expected.pintype || actual.pinfunction !== expected.pinfunction) {
      diffs.push(key + '：' + JSON.stringify(actual) + ' ≠ ' + JSON.stringify(expected));
    }
  }
  assert.deepEqual(diffs, [], '节点 pintype / pinfunction 应与源网表一致');
  assert.equal(
    [...result.values()].filter((node) => String(node.pintype).includes('no_connect')).length,
    4,
    'no_connect 修饰应保留（2 个 bidirectional+no_connect、1 个 no_connect、1 个 input+no_connect）',
  );
});

test('元件位号集合与 libparts 不减少', () => {
  const { sourceDoc, regeneratedDoc } = roundtrip();
  const sourceRefs = sourceDoc.components.map((component) => component.ref).sort(compareText);
  const resultRefs = regeneratedDoc.components.map((component) => component.ref).sort(compareText);
  assert.equal(sourceRefs.length, 150, '源网表应有 150 个元件');
  assert.deepEqual(resultRefs, sourceRefs, '元件位号集合应与源网表一致');
  assert.deepEqual(
    sourceDoc.components.filter((component) => component.value !== undefined).length,
    150,
    '源网表 150 个元件都应带 value',
  );

  assert.ok(regeneratedDoc.libparts.length >= 28, 'libparts 不应少于 28 个');
  const libpartKeys = (doc) => doc.libparts.map((part) => part.lib + ':' + part.part).sort(compareText);
  assert.deepEqual(libpartKeys(regeneratedDoc), libpartKeys(sourceDoc), 'libparts 集合应与源网表一致');
});

test('design 段保留 2 个图纸与图纸路径', () => {
  const { sourceDoc, regeneratedDoc } = roundtrip();
  assert.equal(regeneratedDoc.design.sheets.length, 2, 'design.sheet 应为 2');
  const sheetKeys = (doc) => doc.design.sheets.map((sheet) => sheet.number + '|' + sheet.name + '|' + sheet.tstamps);
  assert.deepEqual(sheetKeys(regeneratedDoc), sheetKeys(sourceDoc), '图纸编号/路径应与源网表一致');
  assert.deepEqual(
    regeneratedDoc.design.sheets.map((sheet) => sheet.name),
    ['/', '/RP2040/'],
    '图纸路径应保留根图 / 与子图 /RP2040/',
  );
  assert.equal(regeneratedDoc.design.sheets[0].titleBlock.title, 'TinyTapeout 4/5 Demo Board PRELIM');
  assert.equal(regeneratedDoc.design.sheets[0].titleBlock.comments.length, 9, 'title_block 的 9 槽 comments 应保留');
});

test('二次往返是不动点（导入 → 导出 → 导入 → 导出 字节稳定）', () => {
  const { generated } = roundtrip();
  const reimported = importKiCadNetlist(generated);
  assert.equal(reimported.ok, true, '再导出的网表应可再次导入：' + (reimported.errors || []).join('；'));
  assert.equal(reimported.warnings.length, 0, '二次导入不应产生告警：' + JSON.stringify(reimported.warnings));
  assert.equal(generateKiCad(reimported.project), generated, '二次导出应与首次导出逐字节相同');
});

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('黄金样本逐字节还原：导入 → 导出与源文件完全相同（254285 字节 / SHA256 2f92e581…a53f）', () => {
  const { generated } = roundtrip();
  const sourceBuffer = fs.readFileSync(FIXTURE);
  const generatedBuffer = Buffer.from(generated, 'utf8');

  assert.equal(sourceBuffer.length, 254285, '黄金样本应为 254285 字节');
  assert.equal(generatedBuffer.length, 254285, '导出字节数必须与源文件相同');
  assert.equal(generatedBuffer.length, sourceBuffer.length, '长度必须逐字节一致');
  assert.equal(sha256(sourceBuffer), '2f92e581a7b7451307f6536d9858e42351d2378cdc22b3dfb9ab19e4e831a53f');
  assert.equal(sha256(generatedBuffer), sha256(sourceBuffer), 'SHA256 必须与源文件完全相同');
  assert.equal(generatedBuffer.equals(sourceBuffer), true, '导出内容必须与源文件逐字节相同');

  assert.equal(generated.split('\r\n').length, 4680, '应为 4680 行');
  assert.equal((generated.match(/\r\n/g) || []).length, 4679, '应为 4679 个 CRLF 行尾');
  assert.equal((generated.match(/(?<!\r)\n/g) || []).length, 0, '不得出现裸 LF');
  assert.equal(/[\r\n]$/.test(generated), false, '末尾不得有换行');
  assert.equal(generated.charCodeAt(0) === 0xfeff, false, '不得带 BOM');
});

test('多值 comp tstamps 在导入工程与导出文本中完整保留（J4 3 个 / U4 5 个）', () => {
  const { imported, generated } = roundtrip();
  const symbols = imported.project.sheets.flatMap((sheet) => sheet.symbols);
  const byRef = new Map(symbols.map((symbol) => [symbol.designator, symbol]));

  assert.deepEqual(byRef.get('J4').kicad.tstamps, [
    '4c9d5f26-ed78-4f01-a96d-6cb9799c635a',
    'd330ac86-79a4-43c5-9c0a-69cac1356867',
    '342c76f3-b2b8-40b2-a0b0-d83e480188cc',
  ]);
  assert.equal(byRef.get('U4').kicad.tstamps.length, 5);
  assert.equal(typeof byRef.get('C1').kicad.tstamps, 'string', '单值元件保持字符串形态');

  assert.ok(
    generated.includes(
      '(tstamps "4c9d5f26-ed78-4f01-a96d-6cb9799c635a" "d330ac86-79a4-43c5-9c0a-69cac1356867" "342c76f3-b2b8-40b2-a0b0-d83e480188cc")',
    ),
    'J4 的 3 个 tstamps 必须原样输出',
  );
  const u4Line = generated.split('\r\n').find((line) => line.trimStart().startsWith('(tstamps "71933cd7'));
  assert.equal(
    u4Line.trim(),
    // tstamps 是 comp 的最后一个子节点：按 §2.3 R4，行尾多一个闭括号属于 comp。
    '(tstamps "71933cd7-333f-4442-aab4-3820c85802bb" "ef8c3c98-ea16-47a2-aa94-e8f9234624b4" "e919256b-c5bd-4d79-b39d-e69d1ddba8a8" "f2cd6ad8-250f-4db7-93a7-df84ad0b6adf" "4ef3ed4e-bc9a-4001-a514-469079376569"))',
    'U4 的 5 个 tstamps 必须按原顺序原样输出',
  );
});
