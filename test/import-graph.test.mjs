// 导入图校验：解析 src 下全部模块的相对 import（含跨行、再导出、副作用与动态字面量），
// 断言目标文件存在、说明符规范、无未解析导入、无循环依赖，并交叉校验解析完整性。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  SRC,
  buildImportGraph,
  extractImportSpecifiers,
  listFiles,
  looseSpecifiers,
  relativeToRoot,
  resolveSpecifier,
} from './integration/helpers.mjs';

const MODULES = listFiles(SRC, '.js');
const GRAPH = buildImportGraph(MODULES);

/** 深度优先检测循环依赖，返回环路径（相对仓库根）。 */
function findCycles(graph) {
  const state = new Map();
  const cycles = [];
  const visit = (node, stack) => {
    const status = state.get(node) || 0;
    if (status === 1) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node].map(relativeToRoot));
      return;
    }
    if (status === 2) return;
    state.set(node, 1);
    stack.push(node);
    const entry = graph.get(node);
    for (const target of entry ? entry.edges : []) visit(target, stack);
    stack.pop();
    state.set(node, 2);
  };
  for (const node of graph.keys()) visit(node, []);
  return cycles;
}

test('import 说明符解析器识别跨行 import、再导出、副作用与动态 import', () => {
  const sample = [
    "import a from './a.js';",
    'import {',
    '  b,',
    '  c,',
    '} from "../b.js";',
    "import './side-effect.js';",
    "export { d } from './d.js';",
    "export * from './e.js';",
    "const lazy = () => import('./f.js');",
    'const meta = import.meta.url;',
    'const text = "from ./not-an-import.js";',
  ].join('\n');
  assert.deepEqual(
    new Set(extractImportSpecifiers(sample)),
    new Set(['./a.js', '../b.js', './side-effect.js', './d.js', './e.js', './f.js']),
  );
});

test('导入图覆盖 src 下全部模块', () => {
  assert.ok(MODULES.length >= 70, 'src 下模块数量异常：' + MODULES.length);
  assert.equal(GRAPH.size, MODULES.length, '导入图节点应与 src 模块一一对应');
  assert.ok(
    MODULES.some((file) => relativeToRoot(file) === 'src/main.js'),
    '导入图应包含应用入口 src/main.js',
  );
  assert.equal(
    relativeToRoot(MODULES[0]).startsWith('src/'),
    true,
    '所有模块都必须位于 src/ 下',
  );
});

test('所有 import 都是带扩展名的相对路径，且目标文件存在', () => {
  const problems = [];
  for (const file of MODULES) {
    for (const specifier of GRAPH.get(file).specifiers) {
      if (!specifier.startsWith('.')) {
        problems.push(relativeToRoot(file) + ' 使用了非相对路径 import：' + specifier);
        continue;
      }
      if (path.extname(specifier) === '') {
        problems.push(relativeToRoot(file) + ' 的 import 缺少扩展名：' + specifier);
        continue;
      }
      if (!resolveSpecifier(file, specifier)) {
        problems.push(relativeToRoot(file) + ' 的 import 无法解析：' + specifier);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('导入目标都落在仓库内的 src/ 或 examples/', () => {
  const outside = [];
  for (const file of MODULES) {
    for (const target of GRAPH.get(file).edges) {
      const targetPath = relativeToRoot(target);
      if (!targetPath.startsWith('src/') && !targetPath.startsWith('examples/')) {
        outside.push(relativeToRoot(file) + ' -> ' + targetPath);
      }
    }
  }
  assert.deepEqual(outside, [], '导入目标越出分层目录：\n' + outside.join('\n'));
});

test('导入图没有循环依赖', () => {
  const cycles = findCycles(GRAPH);
  const messages = cycles.map((cycle) => cycle.join(' -> '));
  assert.deepEqual(cycles, [], '发现循环依赖：\n' + messages.join('\n'));
});

test('结构化解析与宽松扫描结果一致（无漏解析导入）', () => {
  const mismatches = [];
  for (const file of MODULES) {
    const source = fs.readFileSync(file, 'utf8');
    const parsed = new Set(GRAPH.get(file).specifiers);
    const loose = looseSpecifiers(source);
    for (const specifier of parsed) {
      if (!loose.has(specifier)) mismatches.push(relativeToRoot(file) + ' 多余说明符 ' + specifier);
    }
    for (const specifier of loose) {
      if (!parsed.has(specifier)) mismatches.push(relativeToRoot(file) + ' 漏解析 ' + specifier);
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join('\n'));
});

test('JSON 资源导入（import attributes）指向合法 JSON', () => {
  const jsonTargets = new Set();
  for (const file of MODULES) {
    for (const specifier of GRAPH.get(file).specifiers) {
      if (!specifier.endsWith('.json')) continue;
      const resolved = resolveSpecifier(file, specifier);
      assert.ok(resolved, relativeToRoot(file) + ' 的 JSON 导入不存在：' + specifier);
      jsonTargets.add(relativeToRoot(resolved));
      const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      assert.equal(typeof parsed, 'object', relativeToRoot(resolved) + ' 必须是 JSON 对象');
    }
  }
  assert.deepEqual(
    [...jsonTargets].sort(),
    ['examples/demo-led.json', 'examples/demo-mcu.json'],
    '应用应通过 src/ 内的模块静态导入两份示例工程',
  );
});

test('导入图记录了 src/main.js 到各层的依赖边', () => {
  const entry = MODULES.find((file) => relativeToRoot(file) === 'src/main.js');
  assert.ok(entry, '缺少 src/main.js');
  const direct = new Set(GRAPH.get(entry).edges.map(relativeToRoot));
  assert.deepEqual([...direct], ['src/ui/app.js'], '入口只应装配 UI 层');
});
