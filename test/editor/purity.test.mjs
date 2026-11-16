// 编辑器层质量门：职责注释、无反向依赖、纯模块无 DOM、工具接口完整且可在 node 导入。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EDITOR_DIR = path.join(ROOT, 'src/editor');

function listModules(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listModules(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(full);
  }
  return result.sort();
}

function relative(file) {
  return path.relative(EDITOR_DIR, file).replace(/\\/g, '/');
}

const MODULES = listModules(EDITOR_DIR);

test('编辑器层每个模块都有顶部职责注释', () => {
  assert.ok(MODULES.length >= 20);
  for (const file of MODULES) {
    const firstLine = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
    assert.match(firstLine, /^\/\/ /, relative(file) + ' 缺少职责注释');
  }
});

test('编辑器层不反向依赖 io/ui，且不使用 node 内置模块', () => {
  for (const file of MODULES) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      const specifier = match[1];
      assert.equal(specifier.startsWith('.'), true, relative(file) + ' 的 import 必须相对路径：' + specifier);
      assert.equal(specifier.startsWith('node:'), false, relative(file) + ' 不得引用 node 模块');
      assert.equal(specifier.includes('/ui/'), false, relative(file) + ' 反向依赖 ui：' + specifier);
      assert.equal(specifier.includes('/io/'), false, relative(file) + ' 反向依赖 io：' + specifier);
      assert.equal(specifier.includes('/editor/'), false, '同层引用应使用 ./：' + specifier);
    }
  }
});

test('纯逻辑模块不引用 DOM 全局，可在 node 直接导入', () => {
  const pure = [
    'snapping.js',
    'commands.js',
    'hit-test.js',
    'wire-utils.js',
    'symbol-resolver.js',
    'footprint-store.js',
    'footprint-commands.js',
    'footprint-hit-test.js',
    'tools/base.js',
    'tools/select-tool.js',
    'tools/wire-tool.js',
    'tools/place-tool.js',
    'tools/label-tool.js',
    'tools/text-tool.js',
    'tools/erase-tool.js',
    'footprint-tools/select-tool.js',
    'footprint-tools/pad-tool.js',
    'footprint-tools/move-tool.js',
    'footprint-tools/graphic-tool.js',
  ];
  for (const name of pure) {
    const source = fs.readFileSync(path.join(EDITOR_DIR, name), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const globalName of ['window', 'document', 'localStorage', 'requestAnimationFrame']) {
      assert.equal(
        new RegExp('\\b' + globalName + '\\b').test(code),
        false,
        name + ' 不应引用 ' + globalName,
      );
    }
  }
});

test('所有编辑器模块可在 node 中动态导入（无顶层 DOM 访问）', async () => {
  for (const file of MODULES) {
    const module = await import(pathToFileURL(file).href);
    assert.ok(module && typeof module === 'object', relative(file) + ' 导入结果异常');
  }
});

test('工具模块实现契约要求的全部方法', async () => {
  const factories = [
    ['tools/select-tool.js', 'createSelectTool'],
    ['tools/wire-tool.js', 'createWireTool'],
    ['tools/place-tool.js', 'createPlaceTool'],
    ['tools/label-tool.js', 'createLabelTool'],
    ['tools/text-tool.js', 'createTextTool'],
    ['tools/erase-tool.js', 'createEraseTool'],
    ['footprint-tools/select-tool.js', 'createFootprintSelectTool'],
    ['footprint-tools/pad-tool.js', 'createPadTool'],
    ['footprint-tools/move-tool.js', 'createMoveTool'],
    ['footprint-tools/graphic-tool.js', 'createGraphicTool'],
  ];
  const methods = [
    'onActivate',
    'onDeactivate',
    'onPointerDown',
    'onPointerMove',
    'onPointerUp',
    'onDoubleClick',
    'onKeyDown',
  ];
  for (const [file, exportName] of factories) {
    const module = await import(pathToFileURL(path.join(EDITOR_DIR, file)).href);
    const tool = module[exportName]();
    assert.equal(typeof tool.id, 'string');
    assert.equal(typeof tool.cursor, 'string');
    for (const method of methods) {
      assert.equal(typeof tool[method], 'function', file + ' 缺少 ' + method);
    }
  }
});

test('编辑器门面导出核心 API', async () => {
  const module = await import(pathToFileURL(path.join(EDITOR_DIR, 'index.js')).href);
  for (const name of [
    'createSchematicEditor',
    'createFootprintEditor',
    'createCommandApi',
    'createFootprintCommandApi',
    'createFootprintStore',
    'collectAnchors',
    'findSnapPoint',
    'snapToGrid',
    'hitTest',
    'createPadTool',
    'createWireTool',
  ]) {
    assert.equal(typeof module[name], 'function', 'index.js 缺少导出 ' + name);
  }
});
