// 应用外壳测试：入口 HTML/样式、UI 文件齐备性、模块可导入、分层依赖方向，以及 KiCad 网表导入/展示的 UI 集成。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { createProject } from '../../src/model/project.js';
import { createNetlistPanel } from '../../src/ui/panels/netlist-panel.js';
import { commentsTextOf, createPropertiesPanel } from '../../src/ui/panels/properties-panel.js';
import { openExportDialog } from '../../src/ui/dialogs/export-dialog.js';
import { netRows } from '../../src/ui/view-model.js';
import { findAll, findByClass, findByTag, findByText, installFakeDom } from './helpers/fake-dom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function loadUiModule(relativePath) {
  return import(pathToFileURL(path.join(ROOT, relativePath)).href);
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function walk(dir, filter, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, result);
    else if (filter(full)) result.push(full);
  }
  return result;
}

const UI_FILES = [
  'dom.js',
  'icons.js',
  'view-model.js',
  'project-setup.js',
  'example-projects.js',
  'ui-utils.js',
  'chrome-sync.js',
  'editor-setup.js',
  'footprint-mode.js',
  'file-actions.js',
  'edit-actions.js',
  'sheet-actions.js',
  'toolbar-actions.js',
  'hotkeys.js',
  'toast.js',
  'welcome.js',
  'layout.js',
  'toolbar.js',
  'sheet-tabs.js',
  'status-bar.js',
  'app.js',
  'styles.css',
  'dialogs/modal.js',
  'dialogs/export-dialog.js',
  'dialogs/help-dialog.js',
  'panels/library-panel.js',
  'panels/layers-panel.js',
  'panels/netlist-panel.js',
  'panels/properties-panel.js',
];

const UI_JS_FILES = UI_FILES.filter((file) => file.endsWith('.js'));

test('index.html 定稿：样式表、#app 与 main.js 模块入口', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="stylesheet" href="\.\/src\/ui\/styles\.css"\s*\/>/);
  assert.match(html, /id="app"/);
  assert.match(html, /<script type="module" src="\.\/src\/main\.js"><\/script>/);
  assert.match(html, /<title>原理图工作室<\/title>/);
  assert.match(html, /lang="zh-CN"/);
});

test('样式表包含外壳/面板/对话框关键选择器', () => {
  const css = read('src/ui/styles.css');
  for (const selector of [
    '.app-shell', '.menubar', '.toolbar', '.workspace', '.canvas-stack',
    '.library-panel', '.properties-panel', '.netlist-panel', '.layers-panel',
    '.statusbar', '.sheet-tabs', '.mode-bar', '.modal', '.toast', '.format-grid',
  ]) {
    assert.ok(css.includes(selector), '样式应包含 ' + selector);
  }
  assert.ok(css.length > 5000, '样式表应包含完整主题');
});

test('UI 文件齐备，JS 文件首行为职责注释', () => {
  for (const file of UI_FILES) {
    const full = path.join(ROOT, 'src/ui', file);
    assert.ok(fs.existsSync(full), '缺少 ' + file);
    if (file.endsWith('.js')) {
      const firstLine = fs.readFileSync(full, 'utf8').split(/\r?\n/)[0];
      assert.ok(firstLine.startsWith('// '), file + ' 首行应为职责注释，实际：' + firstLine);
    } else {
      const firstLine = fs.readFileSync(full, 'utf8').split(/\r?\n/)[0];
      assert.ok(firstLine.startsWith('/*'), file + ' 首行应为样式说明注释');
    }
  }
});

test('全部 UI 模块可在 Node 中导入（无顶层 DOM 依赖）', async () => {
  for (const file of UI_JS_FILES) {
    const url = pathToFileURL(path.join(ROOT, 'src/ui', file)).href;
    const module = await import(url);
    assert.equal(typeof module, 'object', file + ' 应可导入');
  }
});

test('入口导出 bootstrap、APP_VERSION 与 startApp', async () => {
  const main = await import(pathToFileURL(path.join(ROOT, 'src/main.js')).href);
  const app = await import(pathToFileURL(path.join(ROOT, 'src/ui/app.js')).href);
  assert.equal(typeof main.bootstrap, 'function');
  assert.equal(typeof main.APP_VERSION, 'string');
  assert.equal(main.APP_VERSION, app.APP_VERSION);
  assert.equal(typeof app.startApp, 'function');
  const result = await main.bootstrap();
  assert.equal(result.version, main.APP_VERSION);
  assert.equal(result.root, null);
  assert.equal(result.app, null);
  await assert.rejects(() => app.startApp(null), /浏览器环境/);
});

test('不引入外部字体、图标或 CDN 资源', () => {
  const files = ['index.html', 'src/ui/styles.css', ...UI_JS_FILES.map((file) => 'src/ui/' + file)];
  const pattern = /(?:fonts\.googleapis|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|@import|url\(\s*["']?https?:)/i;
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, pattern, file + ' 不应加载外部资源');
    assert.doesNotMatch(text, /(?:src|href)\s*=\s*["']https?:\/\//i, file + ' 不应引用远程地址');
  }
});

// examples/*.json 是「数据」而非「模块依赖」：只允许白名单模块以 JSON 数据形式按需导入。
const DATA_IMPORT_ALLOWED_FILES = new Set(['example-projects.js']);
const DATA_IMPORT_PATTERN = /^\.\.\/\.\.\/examples\/[a-z0-9-]+\.json$/;

function importSpecifiers(text) {
  const specifiers = new Set();
  for (const pattern of [/from\s+['"]([^'"]+)['"]/g, /import\s*\(\s*['"]([^'"]+)['"]/g]) {
    let match = pattern.exec(text);
    while (match) {
      specifiers.add(match[1]);
      match = pattern.exec(text);
    }
  }
  return [...specifiers];
}

test('UI 层依赖方向合法：只引用下层模块，示例 JSON 走数据导入白名单', async () => {
  const allowed = new Set(['core', 'model', 'library', 'render', 'netlist', 'editor', 'io', 'ui']);
  for (const file of UI_JS_FILES) {
    const text = read('src/ui/' + file);
    for (const specifier of importSpecifiers(text)) {
      const resolved = path.posix.normalize(path.posix.join('src/ui/' + path.posix.dirname(file), specifier));
      if (DATA_IMPORT_PATTERN.test(specifier)) {
        assert.equal(DATA_IMPORT_ALLOWED_FILES.has(file), true, file + ' 不在示例数据导入白名单，不能导入 ' + specifier);
        assert.ok(resolved.startsWith('examples/'), file + ' 示例数据路径非法：' + specifier);
        assert.ok(fs.existsSync(path.join(ROOT, resolved)), file + ' 引用的示例数据不存在：' + resolved);
        continue;
      }
      assert.ok(specifier.startsWith('.'), file + ' 不应使用裸模块导入：' + specifier);
      assert.ok(resolved.startsWith('src/'), file + ' 引用越界：' + specifier);
      const layer = resolved.split('/')[1];
      assert.ok(allowed.has(layer), file + ' 引用了非法层：' + specifier + ' -> ' + resolved);
    }

    // 任何 examples/ 字面量都必须是白名单模块中的 JSON 数据文件。
    const examplesLiterals = [...text.matchAll(/['"]([^'"]*examples\/[^'"]+)['"]/g)].map((match) => match[1]);
    for (const literal of examplesLiterals) {
      assert.equal(DATA_IMPORT_PATTERN.test(literal), true, file + ' 出现未登记的 examples 导入：' + literal);
      assert.equal(DATA_IMPORT_ALLOWED_FILES.has(file), true, file + ' 不允许导入示例数据：' + literal);
    }
  }
});

test('示例数据走动态 JSON 导入，旧浏览器不会因静态 import attributes 白屏', () => {
  const text = read('src/ui/example-projects.js');
  assert.match(text, /import\s*\(\s*['"]\.\.\/\.\.\/examples\/demo-led\.json['"]/);
  assert.match(text, /import\s*\(\s*['"]\.\.\/\.\.\/examples\/demo-mcu\.json['"]/);
  assert.doesNotMatch(text, /^\s*import\s.+?from\s+['"][^'"]*examples\//m, '不得静态导入示例 JSON');
  assert.match(text, /try\s*{/);
  assert.match(text, /catch\s*\(/);
  assert.match(text, /error/);
});

test('示例工程可动态加载，未知 id 返回结构化错误', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src/ui/example-projects.js')).href);
  assert.deepEqual(module.EXAMPLE_PROJECTS.map((example) => example.id), ['led', 'mcu']);
  assert.deepEqual(module.exampleProjects().map((example) => example.id), ['led', 'mcu']);
  assert.equal(module.getExampleMetadata('led').label, 'LED 指示灯');
  assert.equal(module.getExampleMetadata('nope'), null);

  const led = await module.loadExampleProject('led');
  assert.equal(led.error, null);
  assert.equal(led.label, 'LED 指示灯');
  assert.equal(led.data.name, 'LED 指示灯');
  assert.equal(led.data.sheets.length, 1);

  const mcu = await module.loadExampleProject('mcu');
  assert.equal(mcu.error, null);
  assert.equal(mcu.data.name, 'MCU 最小系统');

  const unknown = await module.loadExampleProject('nope');
  assert.equal(unknown.data, null);
  assert.match(unknown.error, /找不到示例工程/);
});

test('下层模块没有反向依赖 src/ui', () => {
  const dirs = ['core', 'model', 'library', 'render', 'netlist', 'editor', 'io'];
  const offenders = [];
  for (const dir of dirs) {
    for (const full of walk(path.join(ROOT, 'src', dir), (file) => file.endsWith('.js'))) {
      const text = fs.readFileSync(full, 'utf8');
      if (/from\s+['"][^'"]*\/ui\//.test(text) || /from\s+['"]\.\.\/ui\//.test(text)) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  }
  assert.deepEqual(offenders, []);
});

/** 最小可导入网表：1 元件 / 2 网络 / 1 图纸（UI 测试不重复跑黄金样本的完整解析）。 */
const TINY_NETLIST = `(export (version "E")
  (design
    (source "C:\\\\demo\\\\demo.kicad_sch")
    (date "2026-01-01T00:00:00+0800")
    (tool "Eeschema 9.0.8")
    (sheet (number "1") (name "/") (tstamps "/")
      (title_block
        (title "")
        (company "")
        (rev "")
        (date "")
        (source "demo.kicad_sch")
        (comment (number "1") (value ""))
        (comment (number "2") (value ""))
        (comment (number "3") (value ""))
        (comment (number "4") (value ""))
        (comment (number "5") (value ""))
        (comment (number "6") (value ""))
        (comment (number "7") (value ""))
        (comment (number "8") (value ""))
        (comment (number "9") (value ""))
      )
    )
  )
  (components
    (comp (ref "R1")
      (value "100")
      (footprint "")
      (datasheet "~")
      (fields (field (name "Footprint")) (field (name "Datasheet")))
      (libsource (lib "Demo") (part "R") (description ""))
      (property (name "Sheetname") (value "Root"))
      (property (name "Sheetfile") (value "demo.kicad_sch"))
      (sheetpath (names "/") (tstamps "/"))
      (tstamps "11111111-1111-1111-1111-111111111111")
    )
  )
  (libparts
    (libpart (lib "Demo") (part "R")
      (description "")
      (fields (field (name "Reference") (value "R")) (field (name "Value") (value "R")) (field (name "Footprint")) (field (name "Datasheet") (value "~")) (field (name "Description")))
      (pins (pin (num "1") (name "A") (type "passive")) (pin (num "2") (name "B") (type "passive")))
    )
  )
  (libraries (library (logical "Demo") (uri "")))
  (nets
    (net (code "1") (name "VCC") (class "Power") (node (ref "R1") (pin "1") (pintype "passive")))
    (net (code "2") (name "GND") (class "Default") (node (ref "R1") (pin "2") (pintype "passive")))
  )
)`;

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
    const file = { name: 'demo.net', text: async () => TINY_NETLIST };
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
    assert.equal(imported.sheets.length, 1);
    assert.equal(imported.kicad.version, 'E');
    assert.equal(imported.library.symbols.length, 1);
    assert.equal(imported.netClassAssignments.VCC, 'Power');
    assert.equal(ctx.dirty, false);
    const success = calls.toasts.filter((toast) => toast.type === 'success');
    assert.ok(success.length >= 1);
    assert.equal(success[success.length - 1].message, '已导入 KiCad 网表：元件 1 · 网络 2 · 图纸 1');
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
    const { ctx, calls } = createMinimalContext({ dirty: true });
    const input = createFileInput(dom.document, { name: 'demo.net', text: async () => TINY_NETLIST });
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


function createFakeStore(project) {
  const labels = [];
  return {
    labels,
    getProject: () => project,
    getSheet: () => project.sheets[0],
    getSheetId: () => project.sheets[0].id,
    getSelection: () => [],
    on: () => () => {},
    update(mutator, options = {}) {
      mutator(project.sheets[0], project);
      labels.push(options.label);
    },
  };
}

test('netRows 输出 net class，缺省为 Default', () => {
  const rows = netRows({
    nets: [
      { name: 'VCC', class: 'Power', pins: [] },
      { name: 'N$1', pins: [] },
      { name: '', class: '   ', pins: [] },
    ],
  });
  assert.equal(rows[0].class, 'Power');
  assert.equal(rows[1].class, 'Default');
  assert.equal(rows[2].class, 'Default');
  assert.equal(netRows(null).length, 0);
});

test('网表面板在每个网络行展示 net class（缺省 Default）', () => {
  const dom = installFakeDom();
  try {
    const panel = createNetlistPanel({});
    panel.setResult({
      ok: true,
      nets: [
        {
          name: 'VCC',
          class: 'Power',
          pins: [{ designator: 'R1', pinNumber: '1', pinName: 'A', instanceId: 'sym-1', sheetId: 'sheet-1' }],
        },
        { name: 'GND', class: 'Default', pins: [] },
        { name: 'N$1', pins: [] },
      ],
      components: [{ designator: 'R1' }],
      warnings: [],
    });
    const chips = findAll(panel.element, (node) => node.classList.contains('net-class'));
    assert.equal(chips.length, 3);
    assert.deepEqual(chips.map((chip) => chip.textContent), ['Power', 'Default', 'Default']);
    assert.equal(chips[0].getAttribute('title'), 'net class：Power');
  } finally {
    dom.restore();
  }
});

test('图纸备注双形态：数组按行显示，提交统一写回字符串', () => {
  const dom = installFakeDom();
  try {
    const project = createProject('备注测试');
    project.sheets[0].title.comments = ['第一行', '第二行', ''];
    const store = createFakeStore(project);
    const panel = createPropertiesPanel({
      store,
      getSymbols: () => [],
      getFootprints: () => [],
      getEditor: () => null,
    });
    const textarea = findByTag(panel.element, 'textarea')[0];
    assert.ok(textarea, '属性面板应有备注 textarea');
    assert.equal(textarea.value, '第一行\n第二行\n');
    assert.doesNotMatch(textarea.value, /\[object Object\]|第一行,第二行/);

    textarea.value = '新的备注';
    textarea.dispatchEvent('change');
    assert.equal(project.sheets[0].title.comments, '新的备注');
    assert.equal(typeof project.sheets[0].title.comments, 'string');
    assert.deepEqual(store.labels, ['修改备注']);
    panel.destroy();
  } finally {
    dom.restore();
  }
});

test('commentsTextOf 兼容字符串/数组/空值', () => {
  assert.equal(commentsTextOf('a\nb'), 'a\nb');
  assert.equal(commentsTextOf(['a', null, 'b']), 'a\n\nb');
  assert.equal(commentsTextOf(undefined), '');
  assert.equal(commentsTextOf(null), '');
});

test('导出对话框为 KiCad 格式给出 KiCad 9 (version E) 说明', () => {
  const dom = installFakeDom();
  try {
    const root = dom.document.createElement('div');
    const modal = openExportDialog({
      root,
      project: createProject('导出测试'),
      sheetName: 'Root',
      initialFormat: 'kicad',
    });
    const cards = findAll(modal.element, (node) => node.classList.contains('format-card'));
    assert.equal(cards.length, 4, '四种导出格式行为保持不变');
    const cardNote = findByClass(modal.element, 'format-card-note');
    assert.ok(cardNote);
    assert.equal(cardNote.textContent, 'KiCad 9 (version E)');
    const hint = findByClass(modal.element, 'format-note');
    assert.match(hint.textContent, /KiCad 9 \(version E\)/);

    const jsonRadio = findAll(
      modal.element,
      (node) => node.tagName === 'INPUT' && node.getAttribute('value') === 'json',
    )[0];
    assert.ok(jsonRadio);
    jsonRadio.checked = true;
    jsonRadio.dispatchEvent('change');
    assert.equal(findByClass(modal.element, 'format-note').textContent, '', '非 KiCad 格式不显示版本说明');
    modal.close();
  } finally {
    dom.restore();
  }
});

