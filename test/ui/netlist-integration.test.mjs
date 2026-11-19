// KiCad 网表 UI 集成测试：文件菜单入口、独立 input、导入成功/失败与脏工程确认。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProject } from '../../src/model/project.js';
import { findByTag, findByText, installFakeDom } from './helpers/fake-dom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function loadUiModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

/** 最简 ctx：只实现 createFileActions 在失败分支会用到的成员。 */
function createMinimalContext(overrides = {}) {
  const project = createProject('现有工程');
  const selection = ['sym-keep'];
  const calls = {
    toasts: [],
    dialogs: [],
    errors: [],
    setProjects: [],
    exits: 0,
    dialogsRoot: null,
  };
  const ctx = {
    mode: 'schematic',
    dirty: false,
    store: {
      setProject(next, options) { calls.setProjects.push({ project: next, options }); },
      getProject: () => project,
      getSelection: () => selection.slice(),
    },
    showToast(message, type) { calls.toasts.push({ message, type }); },
    showMessageDialog(title, lines) { calls.dialogs.push({ title, lines: lines.slice() }); },
    handleError(error, context) { calls.errors.push({ error, context }); },
    exitFootprintMode: async () => { calls.exits += 1; return true; },
    ...overrides,
  };
  return { ctx, calls, project, selection };
}

function createFileInput(document, file) {
  const input = document.createElement('input');
  input.className = 'file-input';
  input.files = file ? [file] : [];
  input.value = 'C:\\fakepath\\' + (file ? file.name : '');
  return input;
}

test('文件菜单在「打开工程…」之后提供「导入 KiCad 网表…」动作', async () => {
  const dom = installFakeDom();
  try {
    const { createToolbar, MENU_DEFINITIONS } = await loadUiModule('src/ui/toolbar.js');
    assert.ok(Array.isArray(MENU_DEFINITIONS));
    const fileMenu = MENU_DEFINITIONS.find((menu) => menu.id === 'file');
    const ids = fileMenu.items.map((item) => item.id).filter(Boolean);
    assert.equal(ids[ids.indexOf('openProject') + 1], 'importNetlist');
    const item = fileMenu.items.find((entry) => entry.id === 'importNetlist');
    assert.equal(item.label, '导入 KiCad 网表…');

    const invoked = [];
    const toolbar = createToolbar({ actions: { importNetlist: () => invoked.push('importNetlist') } });
    const node = findByText(toolbar.menuBar, '导入 KiCad 网表…');
    assert.ok(node, '菜单中应渲染「导入 KiCad 网表…」');
    node.click();
    assert.deepEqual(invoked, ['importNetlist']);
    toolbar.destroy();
  } finally {
    dom.restore();
  }
});

test('布局提供独立的 KiCad 网表 input（accept .net），不覆盖工程文件 input', async () => {
  const dom = installFakeDom();
  try {
    const { buildLayout } = await loadUiModule('src/ui/layout.js');
    const root = dom.document.createElement('div');
    const layout = buildLayout(root);
    assert.ok(layout.fileInput);
    assert.ok(layout.netlistFileInput);
    assert.notEqual(layout.netlistFileInput, layout.fileInput);
    assert.equal(layout.netlistFileInput.getAttribute('accept'), '.net,text/plain');
    assert.equal(layout.netlistFileInput.getAttribute('type'), 'file');
    assert.ok(layout.netlistFileInput.classList.contains('file-input'));
    assert.equal(layout.fileInput.getAttribute('accept'), '.json,.schproj.json,application/json');
    const inputs = findByTag(root, 'input');
    assert.ok(inputs.includes(layout.fileInput));
    assert.ok(inputs.includes(layout.netlistFileInput));
  } finally {
    dom.restore();
  }
});

test('工具栏动作表注册 importNetlist 并委托 openNetlistImport', async () => {
  const { buildToolbarActions } = await loadUiModule('src/ui/toolbar-actions.js');
  let calls = 0;
  const actions = buildToolbarActions({
    openNetlistImport: () => { calls += 1; },
  });
  assert.equal(typeof actions.importNetlist, 'function');
  actions.importNetlist();
  assert.equal(calls, 1);
});

test('畸形/不含 export 段的网表：弹出错误对话框列出 errors，当前工程与选区不变', async () => {
  const dom = installFakeDom();
  try {
    const { createFileActions } = await loadUiModule('src/ui/file-actions.js');
    const file = { name: 'broken.net', text: async () => '(notanexport (version "E"))' };
    const { ctx, calls, project, selection } = createMinimalContext();
    const input = createFileInput(dom.document, file);
    ctx.layout = { netlistFileInput: input, modalRoot: dom.document.createElement('div') };

    const actions = createFileActions(ctx);
    assert.equal(typeof actions.openNetlistImport, 'function');
    assert.equal(typeof actions.handleNetlistFileChange, 'function');

    await assert.doesNotReject(() => actions.handleNetlistFileChange());
    assert.equal(calls.dialogs.length, 1);
    assert.equal(calls.dialogs[0].title, '无法导入 KiCad 网表');
    assert.ok(calls.dialogs[0].lines.length > 0);
    assert.match(calls.dialogs[0].lines.join('\n'), /MISSING_EXPORT/);
    assert.equal(calls.setProjects.length, 0, '失败时不应写入工程');
    assert.deepEqual(ctx.store.getSelection(), selection, '失败时选区应保持不变');
    assert.equal(ctx.store.getProject(), project, '失败时当前工程应保持不变');
    assert.equal(calls.errors.length, 0, '不应抛未捕获异常');
    assert.equal(input.value, '', '读取后应清空 input 以便重复选择同一文件');
  } finally {
    dom.restore();
  }
});

test('成功导入：退出封装模式 → 脏工程确认 → 载入工程并提示元件/网络/图纸数', async () => {
  const dom = installFakeDom();
  const previousRaf = globalThis.requestAnimationFrame;
  const rafCallbacks = [];
  globalThis.requestAnimationFrame = (callback) => { rafCallbacks.push(callback); return rafCallbacks.length; };
  try {
    const { createFileActions } = await loadUiModule('src/ui/file-actions.js');
    const golden = fs.readFileSync(path.join(ROOT, 'examples/tinytapeout-demo.net'), 'utf8');
    const file = { name: 'tinytapeout-demo.net', text: async () => golden };
    const { ctx, calls } = createMinimalContext({ mode: 'footprint', dirty: true });
    ctx.exitFootprintMode = async () => { calls.exits += 1; ctx.mode = 'schematic'; return true; };
    const input = createFileInput(dom.document, file);
    const modalRoot = dom.document.createElement('div');
    ctx.layout = { netlistFileInput: input, modalRoot };
    ctx.ensureSchematicEditor = () => ({ refresh() {}, fitToContent() {} });
    ctx.schematicEditor = { refresh() {} };
    ctx.librarySignature = () => '';
    ctx.libraryPanel = { refresh() {} };
    ctx.propertiesPanel = { refresh() {} };
    ctx.sheetTabs = { refresh() {} };
    ctx.netlistPanel = { clear() {} };
    ctx.syncChrome = () => {};
    ctx.updateEmptyHint = () => {};
    ctx.resizeActive = () => {};

    const actions = createFileActions(ctx);
    const pending = actions.handleNetlistFileChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.exits, 1, '封装模式下应先退出封装模式');
    const confirm = findByText(modalRoot, '导入网表');
    assert.ok(confirm, '脏工程应弹出丢弃确认');
    confirm.click();
    await pending;

    assert.equal(calls.setProjects.length, 1);
    const imported = calls.setProjects[0].project;
    assert.equal(imported.sheets.length, 2);
    assert.equal(imported.kicad.version, 'E');
    assert.equal(imported.library.symbols.length, 28);
    assert.ok(Object.keys(imported.netClassAssignments).length > 0);
    assert.equal(ctx.dirty, false);
    const success = calls.toasts.filter((toast) => toast.type === 'success');
    assert.ok(success.length >= 1);
    assert.equal(success[success.length - 1].message, '已导入 KiCad 网表：元件 150 · 网络 114 · 图纸 2');
    assert.equal(calls.dialogs.length, 0);
    assert.equal(calls.errors.length, 0);
  } finally {
    globalThis.requestAnimationFrame = previousRaf;
    dom.restore();
  }
});

test('导入取消（脏工程确认点取消）不替换当前工程', async () => {
  const dom = installFakeDom();
  try {
    const { createFileActions } = await loadUiModule('src/ui/file-actions.js');
    const golden = fs.readFileSync(path.join(ROOT, 'examples/tinytapeout-demo.net'), 'utf8');
    const { ctx, calls } = createMinimalContext({ dirty: true });
    const input = createFileInput(dom.document, { name: 'demo.net', text: async () => golden });
    const modalRoot = dom.document.createElement('div');
    ctx.layout = { netlistFileInput: input, modalRoot };

    const actions = createFileActions(ctx);
    const pending = actions.handleNetlistFileChange();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancel = findByText(modalRoot, '取消');
    assert.ok(cancel);
    cancel.click();
    await pending;
    assert.equal(calls.setProjects.length, 0);
    assert.equal(calls.exits, 0);
  } finally {
    dom.restore();
  }
});
