// 集成分层扫描：零 DOM 区（core/model/library/netlist + render 纯模块）做文本扫描，
// 允许 DOM 的运行时边界（render/io/ui/editor 与入口）只要求 import 期无副作用、可被 node 直接导入。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { DOM_GLOBALS, ROOT, SRC, listFiles, relativeToRoot, stripComments } from './helpers.mjs';

/** 零 DOM 零 node 的内置层（契约固定清单）。 */
const ZERO_DOM_DIRS = ['core', 'model', 'library', 'netlist'];
const ZERO_DOM_RENDER_FILES = ['view.js', 'theme.js', 'grid.js', 'symbols.js', 'bounds.js'];

/** 允许 DOM 的运行时边界：只要求 import 期不触碰 document/window，node 可直接导入。 */
const DOM_BOUNDARY_RENDER_FILES = ['renderer.js', 'base-renderer.js', 'footprint-renderer.js', 'title-bar.js'];
const DOM_BOUNDARY_DIRS = ['io', 'ui', 'editor'];
const DOM_BOUNDARY_ENTRIES = ['main.js'];

function collectZeroDomFiles() {
  const files = [];
  for (const directory of ZERO_DOM_DIRS) {
    const found = listFiles(path.join(SRC, directory), '.js');
    assert.ok(found.length > 0, '零 DOM 层缺失：src/' + directory);
    files.push(...found);
  }
  for (const name of ZERO_DOM_RENDER_FILES) {
    const file = path.join(SRC, 'render', name);
    assert.ok(fs.existsSync(file), '零 DOM 渲染模块缺失：src/render/' + name);
    files.push(file);
  }
  return files;
}

function collectBoundaryFiles() {
  const files = [];
  for (const name of DOM_BOUNDARY_RENDER_FILES) {
    const file = path.join(SRC, 'render', name);
    assert.ok(fs.existsSync(file), '运行时边界模块缺失：src/render/' + name);
    files.push(file);
  }
  for (const directory of DOM_BOUNDARY_DIRS) {
    const found = listFiles(path.join(SRC, directory), '.js');
    assert.ok(found.length > 0, '运行时边界目录缺失：src/' + directory);
    files.push(...found);
  }
  for (const name of DOM_BOUNDARY_ENTRIES) {
    const file = path.join(SRC, name);
    assert.ok(fs.existsSync(file), '应用入口缺失：src/' + name);
    files.push(file);
  }
  return files;
}

const ZERO_DOM_FILES = collectZeroDomFiles();
const BOUNDARY_FILES = collectBoundaryFiles();

test('零 DOM 区模块带职责注释且不引用浏览器全局', () => {
  assert.ok(ZERO_DOM_FILES.length >= 20, '零 DOM 区模块数量异常：' + ZERO_DOM_FILES.length);
  const violations = [];
  for (const file of ZERO_DOM_FILES) {
    const source = fs.readFileSync(file, 'utf8');
    const firstLine = source.split(/\r?\n/)[0].trim();
    if (!/^\/\/ /.test(firstLine)) violations.push(relativeToRoot(file) + ' 缺少顶部职责注释');
    const code = stripComments(source);
    for (const name of DOM_GLOBALS) {
      if (new RegExp('\\b' + name + '\\b').test(code)) {
        violations.push(relativeToRoot(file) + ' 引用了浏览器全局 ' + name);
      }
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('零 DOM 区模块不使用 node 内置模块、process 或 require', () => {
  const violations = [];
  for (const file of ZERO_DOM_FILES) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    if (/\bfrom\s*['"]node:/.test(code)) violations.push(relativeToRoot(file) + ' 引用了 node: 内置模块');
    if (/\bimport\s*\(\s*['"]node:/.test(code)) violations.push(relativeToRoot(file) + ' 动态引用 node: 内置模块');
    if (/\brequire\s*\(/.test(code)) violations.push(relativeToRoot(file) + ' 使用了 require()');
    if (/\bprocess\s*\./.test(code)) violations.push(relativeToRoot(file) + ' 访问了 process');
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('零 DOM 区模块可在 node 中直接导入（import 期无 DOM 访问）', async () => {
  const failures = [];
  for (const file of ZERO_DOM_FILES) {
    try {
      const module = await import(pathToFileURL(file).href);
      if (!module || typeof module !== 'object') failures.push(relativeToRoot(file) + ' 导入结果异常');
    } catch (error) {
      failures.push(relativeToRoot(file) + ' 导入失败：' + (error && error.message ? error.message : error));
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('允许 DOM 的运行时边界模块可在 node 导入且 import 期无副作用', async () => {
  assert.ok(BOUNDARY_FILES.length >= 30, '运行时边界模块数量异常：' + BOUNDARY_FILES.length);
  const failures = [];
  for (const file of BOUNDARY_FILES) {
    try {
      const module = await import(pathToFileURL(file).href);
      const exportsCount = Object.keys(module).length;
      if (exportsCount === 0) failures.push(relativeToRoot(file) + ' 没有导出（可能是误放的脚本）');
    } catch (error) {
      failures.push(relativeToRoot(file) + ' 导入失败：' + (error && error.message ? error.message : error));
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('src 顶层只包含约定的分层目录与入口文件', () => {
  const entries = fs.readdirSync(SRC, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  assert.deepEqual(directories, ['core', 'editor', 'io', 'library', 'model', 'netlist', 'render', 'ui']);
  assert.deepEqual(files, ['main.js']);
});

test('仓库根不再保留业务模块或遗留分层目录', () => {
  const legacyDirectories = ['library', 'netlist', 'render', 'editor', 'io', 'ui'];
  const leftovers = legacyDirectories.filter((name) => fs.existsSync(path.join(ROOT, name)));
  assert.deepEqual(
    leftovers,
    [],
    '发现遗留根级业务目录（缺陷报告）：' + leftovers.join('、') + '；业务模块必须迁移到 src/ 下',
  );
  const rootScripts = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:m?js)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(rootScripts, ['server.mjs'], '仓库根只允许 server.mjs 作为零依赖开发服务器');
});
