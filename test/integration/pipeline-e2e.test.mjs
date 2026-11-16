// 整链路端到端：示例工程 -> 注入内置库（UI 启动路径）-> Canvas 渲染 -> SVG 导出 -> PNG 导出，
// 证明 model/library/render/io 各层协作可用，且导出不破坏画布状态。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { deserializeProject } from '../../src/io/project-io.js';
import { canvasToBlob, exportSheetPNG } from '../../src/io/png-export.js';
import { projectToSVG } from '../../src/io/svg-export.js';
import { createDefaultLibraries } from '../../src/library/index.js';
import { buildNetlist } from '../../src/netlist/index.js';
import { SchematicRenderer } from '../../src/render/renderer.js';
import { applyDefaultLibraries } from '../../src/ui/project-setup.js';
import { createFakeCanvas, fillTexts, operations } from '../render/helpers/fake-canvas.mjs';
import { ROOT } from './helpers.mjs';

const DEMO_LED = path.join(ROOT, 'examples/demo-led.json');

/** 模拟 UI 启动路径：严格反序列化示例 + 注入内置符号/封装库。 */
function loadDemoWithLibraries() {
  const parsed = deserializeProject(fs.readFileSync(DEMO_LED, 'utf8'));
  assert.deepEqual(parsed.warnings, []);
  assert.ok(parsed.project);
  return applyDefaultLibraries(parsed.project, createDefaultLibraries());
}

function createRenderer(project, width = 900, height = 700) {
  const { canvas, calls } = createFakeCanvas(width, height);
  const renderer = new SchematicRenderer(canvas, {
    devicePixelRatio: 1,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  });
  renderer.setState({ project, sheet: project.sheets[0] });
  return { renderer, canvas, calls };
}

/** 满足 exportSheetPNG 契约的最小画布替身（含 drawImage/toBlob）。 */
function createPngCanvas(width, height) {
  const calls = [];
  const context = {
    canvas: null,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    drawImage(...args) {
      calls.push({ op: 'drawImage', args });
    },
    fillRect(...args) {
      calls.push({ op: 'fillRect', args });
    },
  };
  const canvas = {
    width,
    height,
    calls,
    getContext(type) {
      return type === '2d' ? context : null;
    },
    toBlob(callback, type) {
      callback(new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: type || 'image/png' }));
    },
  };
  context.canvas = canvas;
  return canvas;
}

test('注入内置库后示例工程可直接渲染与生成网表', () => {
  const project = loadDemoWithLibraries();
  assert.equal(project.library.symbols.length, 18, '应注入 18 个内置符号');
  assert.equal(project.library.footprints.length, 10, '应注入 10 个内置封装');
  const netlist = buildNetlist(project);
  assert.equal(netlist.nets.length, 3);
  assert.deepEqual(netlist.warnings, []);

  const { renderer, calls } = createRenderer(project);
  const view = renderer.fitToContent(40);
  assert.ok(view.scale > 0);
  assert.equal(renderer.render(true), true);
  assert.ok(operations(calls, 'fillText').length >= 8, '应绘制位号/值/引脚文字');
  const texts = fillTexts(calls);
  for (const expected of ['R1', '220R', 'D1', 'LED', 'VCC', 'GND', 'LED 指示灯 / 图纸 1']) {
    assert.ok(texts.includes(expected), '画布渲染应包含 ' + expected);
  }
  assert.ok(calls.some((call) => call.op === 'stroke'), '应绘制符号/导线描边');
  assert.ok(calls.some((call) => call.op === 'setTransform' && call.args[0] === view.scale));
});

test('示例工程可导出结构完整的 SVG', () => {
  const project = loadDemoWithLibraries();
  const svg = projectToSVG(project, project.sheets[0]);
  assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('<title>LED 指示灯 / 图纸 1</title>'));
  assert.equal((svg.match(/<polyline class="wire"/g) || []).length, 3, '应有 3 段导线');
  assert.equal((svg.match(/data-designator=/g) || []).length, 4, '应有 4 个符号');
  assert.equal(svg.includes('symbol-missing'), false, '注入内置库后不应出现占位框');
  assert.ok(svg.trimEnd().endsWith('</svg>'));
});

test('SVG 导出对工程名/标题做 XML 转义', () => {
  const project = loadDemoWithLibraries();
  project.name = 'A&B <原理图>';
  project.sheets[0].title.title = '标题 "1"';
  // 用 A4 页面尺寸强制绘制标题栏（小电路会自动省略标题栏）。
  const svg = projectToSVG(project, project.sheets[0], { pageSize: { w: 297, h: 210 } });
  assert.ok(svg.includes('A&amp;B &lt;原理图&gt;'));
  assert.equal(svg.includes('A&B <原理图>'), false, '不能输出裸 < &');
  assert.ok(svg.includes('标题 &quot;1&quot;'));
});

test('PNG 导出按倍率放大并在结束后恢复画布尺寸', async () => {
  const canvas = createPngCanvas(400, 300);
  const created = [];
  const blob = await exportSheetPNG(canvas, 2, {
    createCanvas: (width, height) => {
      const snapshot = createPngCanvas(width, height);
      created.push({ width, height, canvas: snapshot });
      return snapshot;
    },
  });
  assert.ok(blob instanceof Blob);
  assert.ok(blob.size > 0);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(created.map((item) => [item.width, item.height]), [[400, 300]]);
  assert.equal(created[0].canvas.calls.some((call) => call.op === 'drawImage'), true, '快照应绘制原画布');
  assert.equal(canvas.width, 400, '导出后必须恢复原始宽度');
  assert.equal(canvas.height, 300, '导出后必须恢复原始高度');
  assert.equal(canvas.calls.filter((call) => call.op === 'drawImage').length, 2, '放大与恢复各绘制一次');
});

test('PNG 导出对非法输入给出类型化错误', async () => {
  await assert.rejects(() => exportSheetPNG(null), TypeError);
  await assert.rejects(() => exportSheetPNG({ width: 0, height: 0 }), TypeError);
  await assert.rejects(() => exportSheetPNG(createPngCanvas(10, 10), 0), RangeError);
  await assert.rejects(() => canvasToBlob({}), /toBlob/);
});
