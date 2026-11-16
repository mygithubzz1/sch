import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSymbolInstance } from '../../src/model/project.js';
import { builtinSymbols } from '../../src/library/builtin-symbols.js';
import { createTheme } from '../../src/render/theme.js';
import { escapeXml, projectToSVG } from '../../src/io/svg-export.js';
import { deserializeProject } from '../../src/io/project-io.js';
import { createEmptyProject, createIoFixture } from './fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('projectToSVG 输出完整 SVG 头与 viewBox', () => {
  const { project, sheet } = createIoFixture();
  const svg = projectToSVG(project, sheet);
  assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('width="') && svg.includes('mm"'));
  assert.ok(svg.includes('viewBox="'));
  assert.ok(svg.includes('<title>IO 测试工程 / 主图</title>'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(!svg.includes('NaN'));
});

test('工程与图纸的全部图层都出现在 SVG 中', () => {
  const { project, sheet } = createIoFixture();
  const theme = createTheme();
  const svg = projectToSVG(project, sheet);
  for (const id of ['symbols', 'wires', 'junctions', 'labels', 'texts', 'title-block']) {
    assert.ok(svg.includes('id="' + id + '"'), '缺少图层 ' + id);
  }
  assert.ok(svg.includes('data-designator="R1"'));
  assert.ok(svg.includes('>220</text>'));
  assert.ok(svg.includes('stroke="' + theme.wire + '"'));
  assert.ok(svg.includes('<circle class="junction"'));
  assert.ok(svg.includes('>+5V &amp; &lt;VCC&gt;</text>'));
  assert.ok(svg.includes('>OUT</text>'));
  assert.ok(svg.includes('注释 &lt;script&gt;'));
  assert.ok(svg.includes('IO 与导出验证'));
});

test('XML 特殊字符被正确转义且无裸 &', () => {
  assert.equal(escapeXml('<&>"\''), '&lt;&amp;&gt;&quot;&apos;');
  const { project, sheet } = createIoFixture();
  const svg = projectToSVG(project, sheet);
  assert.ok(svg.includes('LED &lt;red&gt;'));
  const { project: escapeProject, sheet: escapeSheet } = createEmptyProject('转义工程');
  escapeSheet.title.company = 'A&B <C>';
  const titleSvg = projectToSVG(escapeProject, escapeSheet);
  assert.ok(titleSvg.includes('A&amp;B &lt;C&gt;'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes('alert("x")'));
  assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(svg), '存在未转义的 &');
  assert.equal((svg.match(/<g /g) || []).length, (svg.match(/<\/g>/g) || []).length);
});

test('圆弧导出为 SVG path（含 A 指令）', () => {
  const { project, sheet } = createIoFixture();
  const svg = projectToSVG(project, sheet);
  assert.ok(svg.includes('<path d="M '));
  assert.ok(svg.includes(' A '));
  assert.ok(svg.includes('fill="none"'));
});

test('空图纸仍可导出 viewBox 与标题栏', () => {
  const { project, sheet } = createEmptyProject('空工程');
  const svg = projectToSVG(project, sheet);
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('viewBox="0 0 297 210"'));
  assert.ok(svg.includes('id="title-block"'));
  assert.ok(svg.includes('空工程 / 空白图纸'));
  assert.ok(!svg.includes('undefined'));
  assert.ok(!svg.includes('NaN'));
});

test('旋转文本使用 rotate 变换', () => {
  const { project, sheet } = createIoFixture();
  const svg = projectToSVG(project, sheet);
  assert.ok(svg.includes('transform="rotate(90 '));
});

test('导出选项：标题栏/背景/主题/引脚文字可切换', () => {
  const { project, sheet } = createIoFixture();
  const minimal = projectToSVG(project, sheet, { titleBlock: false, background: false, showPinNumbers: false, showPinNames: false });
  assert.ok(!minimal.includes('id="title-block"'));
  assert.ok(!minimal.includes('id="background"'));
  assert.ok(!minimal.includes('>1</text>'));
  assert.ok(!minimal.includes('>A</text>'));

  const custom = projectToSVG(project, sheet, { theme: { wire: '#ff00ff' } });
  assert.ok(custom.includes('stroke="#ff00ff"'));
  const paged = projectToSVG(project, sheet, { pageSize: { w: 100, h: 60 } });
  assert.ok(paged.includes('viewBox="0 0 100 60"'));
});

test('缺失符号绘制占位框而不是抛错', () => {
  const { project, sheet } = createIoFixture();
  const svg = projectToSVG(project, sheet);
  assert.ok(svg.includes('symbol-missing'));
  assert.ok(svg.includes('data-designator="U9"'));
});

test('未显式传入 symbols 时回退内置符号库，可用 useBuiltinSymbols:false 关闭', () => {
  const { project, sheet } = createEmptyProject('解析器测试');
  sheet.symbols.push(createSymbolInstance({
    id: 'sym-r7', symbolId: 'R', designator: 'R7', value: '4k7', x: 10, y: 10,
    rotation: 0, mirror: false, footprintId: null, fields: {},
  }));

  const withoutLibrary = projectToSVG(project, sheet);
  assert.ok(withoutLibrary.includes('data-symbol-id="R"'));
  assert.ok(withoutLibrary.includes('>R7</text>'));
  assert.ok(!withoutLibrary.includes('symbol-missing'));

  const strict = projectToSVG(project, sheet, { useBuiltinSymbols: false });
  assert.ok(strict.includes('symbol-missing'));

  const unknownSheet = { ...sheet, symbols: [{ ...sheet.symbols[0], symbolId: 'NO_SUCH_SYMBOL' }] };
  assert.ok(projectToSVG(project, unknownSheet).includes('symbol-missing'));

  const withOptions = projectToSVG(project, sheet, { symbols: builtinSymbols() });
  assert.ok(withOptions.includes('data-symbol-id="R"'));
  assert.ok(!withOptions.includes('symbol-missing'));
});

test('examples/demo-led.json 直接导出 SVG 不含占位框', () => {
  const text = fs.readFileSync(path.join(ROOT, 'examples/demo-led.json'), 'utf8');
  const { project, warnings } = deserializeProject(text);
  assert.deepEqual(warnings, []);
  assert.ok(project);
  const svg = projectToSVG(project, project.sheets[0]);
  assert.ok(!svg.includes('symbol-missing'));
  assert.ok(svg.includes('data-symbol-id="R"'));
  assert.ok(svg.includes('data-symbol-id="LED"'));
  assert.ok(svg.includes('data-designator="R1"'));
  assert.ok(svg.includes('220R'));
});

test('sheet 缺省时使用工程第一张图纸；空工程不抛错', () => {
  const { project, sheet } = createIoFixture();
  const svg = projectToSVG(project);
  assert.ok(svg.includes(sheet.name));
  const empty = projectToSVG(null, null);
  assert.ok(empty.includes('<svg'));
  assert.ok(empty.includes('未命名工程'));
});
