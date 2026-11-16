// 应用外壳测试：入口 HTML/样式、UI 文件齐备性、模块可导入与分层依赖方向。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

test('UI 层依赖方向合法：只引用下层模块', async () => {
  const allowed = new Set(['core', 'model', 'library', 'render', 'netlist', 'editor', 'io', 'ui']);
  for (const file of UI_JS_FILES) {
    const text = read('src/ui/' + file);
    const specifiers = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.ok(specifier.startsWith('.'), file + ' 不应使用裸模块导入：' + specifier);
      const resolved = path.posix.normalize(path.posix.join('src/ui/' + path.posix.dirname(file), specifier));
      assert.ok(resolved.startsWith('src/'), file + ' 引用越界：' + specifier);
      const layer = resolved.split('/')[1];
      assert.ok(allowed.has(layer), file + ' 引用了非法层：' + specifier + ' -> ' + resolved);
    }
  }
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
