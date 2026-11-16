import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_FILE_MIME,
  STORAGE_PREFIX,
  deserializeProject,
  downloadBlob,
  downloadText,
  loadFromLocalStorage,
  normalizeStorageKey,
  sanitizeFileName,
  saveToLocalStorage,
  serializeProject,
} from '../../src/io/project-io.js';
import { createIoFixture } from './fixtures.mjs';

function createFakeStorage(initial = new Map()) {
  const data = new Map(initial);
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test('serializeProject 刷新 schemaVersion 与 meta.modified，且不修改入参', () => {
  const { project } = createIoFixture();
  project.meta.modified = '2000-01-01T00:00:00.000Z';
  const text = serializeProject(project);
  const parsed = JSON.parse(text);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(project.meta.modified, '2000-01-01T00:00:00.000Z');
  assert.ok(Date.parse(parsed.meta.modified) > Date.parse('2000-01-01T00:00:00.000Z'));
  assert.equal(parsed.meta.created, project.meta.created);
  assert.ok(text.includes('\n  "'), '应使用 2 空格缩进');
  assert.throws(() => serializeProject(null), TypeError);
});

test('序列化往返后工程深度相等', () => {
  const { project } = createIoFixture();
  const text = serializeProject(project);
  const result = deserializeProject(text);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.project);
  assert.deepEqual(result.project, JSON.parse(text));
  assert.deepEqual(result.project.sheets[0].symbols.map((symbol) => symbol.designator), ['R1', 'D1', 'GND1', 'C1', 'U9']);
  assert.equal(result.project.library.symbols.length, 4);
});

test('损坏/空/非对象 JSON 返回 warnings 而不是抛错', () => {
  const broken = deserializeProject('{ not json');
  assert.equal(broken.project, null);
  assert.equal(broken.warnings.length, 1);
  assert.match(broken.warnings[0], /JSON 解析失败/);

  const empty = deserializeProject('   ');
  assert.equal(empty.project, null);
  assert.match(empty.warnings[0], /为空/);

  const nonObject = deserializeProject('[1, 2, 3]');
  assert.equal(nonObject.project, null);
  assert.match(nonObject.warnings[0], /JSON 对象/);

  const nonString = deserializeProject({});
  assert.equal(nonString.project, null);
  assert.match(nonString.warnings[0], /字符串/);
});

test('validateProject 失败时把错误清单作为 warnings 传播', () => {
  const { project } = createIoFixture();
  const raw = JSON.parse(serializeProject(project));
  raw.schemaVersion = 99;
  const result = deserializeProject(JSON.stringify(raw));
  assert.equal(result.project, null);
  assert.ok(result.warnings.some((warning) => warning.includes('schemaVersion')), result.warnings.join(';'));

  const { project: second } = createIoFixture();
  const invalid = JSON.parse(serializeProject(second));
  invalid.sheets[0].wires[0].points = [{ x: 1, y: 2 }];
  const wireResult = deserializeProject(JSON.stringify(invalid));
  assert.equal(wireResult.project, null);
  assert.ok(wireResult.warnings.some((warning) => warning.includes('points')), wireResult.warnings.join(';'));

  const { project: third } = createIoFixture();
  const missingMeta = JSON.parse(serializeProject(third));
  delete missingMeta.meta;
  const metaResult = deserializeProject(JSON.stringify(missingMeta));
  assert.equal(metaResult.project, null);
  assert.ok(metaResult.warnings.some((warning) => warning.includes('meta')), metaResult.warnings.join(';'));
});

test('localStorage 使用 schematic-studio: 前缀并可往返', () => {
  const storage = createFakeStorage();
  const { project } = createIoFixture();
  assert.equal(normalizeStorageKey('draft'), STORAGE_PREFIX + 'draft');
  assert.equal(normalizeStorageKey(STORAGE_PREFIX + 'draft'), STORAGE_PREFIX + 'draft');
  assert.equal(normalizeStorageKey('  '), STORAGE_PREFIX + 'draft');

  assert.equal(saveToLocalStorage('current', project, { storage }), true);
  assert.ok(storage.data.has(STORAGE_PREFIX + 'current'));
  const loaded = loadFromLocalStorage('current', { storage });
  assert.ok(loaded);
  assert.equal(loaded.name, project.name);
  assert.deepEqual(loaded.sheets[0].wires, project.sheets[0].wires);
});

test('localStorage 缺失、损坏或写入异常时安全降级', () => {
  const { project } = createIoFixture();
  assert.equal(saveToLocalStorage('x', project), false);
  assert.equal(loadFromLocalStorage('x'), null);

  const broken = createFakeStorage(new Map([[STORAGE_PREFIX + 'bad', '{oops']]));
  assert.equal(loadFromLocalStorage('bad', { storage: broken }), null);

  const throwing = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.equal(saveToLocalStorage('x', project, { storage: throwing }), false);
  assert.equal(loadFromLocalStorage('x', { storage: throwing }), null);
});

test('sanitizeFileName 清理非法字符', () => {
  assert.equal(sanitizeFileName('a/b:c*?.json'), 'a_b_c__.json');
  assert.equal(sanitizeFileName('   '), 'download');
  assert.equal(sanitizeFileName('原理图.schproj.json'), '原理图.schproj.json');
});

test('非浏览器环境下下载函数抛出明确错误', () => {
  assert.throws(() => downloadText('a.json', '{}'), /浏览器环境/);
  assert.throws(() => downloadBlob('a.png', {}), /浏览器环境/);
});

test('浏览器环境下载：创建链接、点击、移除并延迟释放对象 URL', async () => {
  const created = [];
  const clicked = [];
  const revoked = [];
  const scheduled = [];
  const body = {
    children: [],
    appendChild(node) {
      node.parentNode = this;
      this.children.push(node);
    },
    removeChild(node) {
      this.children = this.children.filter((item) => item !== node);
    },
  };
  const fakeDocument = {
    body,
    createElement(tagName) {
      const element = {
        tagName,
        click() {
          clicked.push(element);
        },
      };
      return element;
    },
  };
  const fakeUrl = {
    createObjectURL(blob) {
      created.push(blob);
      return 'blob:test-url';
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
  const FakeBlob = class {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options && options.type;
    }
  };
  const result = downloadText('a/b.json', '{"x":1}', 'application/json', {
    document: fakeDocument,
    URL: fakeUrl,
    Blob: FakeBlob,
    setTimeout(callback) {
      scheduled.push(callback);
      return 1;
    },
  });
  assert.equal(result.name, 'a_b.json');
  assert.equal(result.url, 'blob:test-url');
  assert.equal(created.length, 1);
  assert.ok(created[0] instanceof FakeBlob);
  assert.deepEqual(created[0].parts, ['{"x":1}']);
  assert.equal(created[0].type, 'application/json');
  assert.equal(clicked.length, 1);
  assert.equal(body.children.length, 0);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.deepEqual(revoked, ['blob:test-url']);
  assert.equal(PROJECT_FILE_MIME, 'application/json;charset=utf-8');
});
