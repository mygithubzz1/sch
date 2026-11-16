// 序列化端到端：示例 serialize -> deserialize -> 再生成网表，深层比较必须一致；
// 损坏/非法输入必须走 { project: null, warnings } 分支而不是抛异常。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  deserializeProject,
  loadFromLocalStorage,
  saveToLocalStorage,
  serializeProject,
} from '../../src/io/project-io.js';
import { buildNetlist } from '../../src/netlist/index.js';
import { ROOT } from './helpers.mjs';

const DEMO_LED = path.join(ROOT, 'examples/demo-led.json');
const DEMO_TEXT = fs.readFileSync(DEMO_LED, 'utf8');

function loadDemo() {
  const result = deserializeProject(DEMO_TEXT);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.project);
  return result.project;
}

/** 内存版 localStorage，避免依赖浏览器 global。 */
function createMemoryStorage() {
  const map = new Map();
  return {
    get size() {
      return map.size;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    keys() {
      return [...map.keys()];
    },
  };
}

test('serialize -> deserialize 后网表深比较一致', () => {
  const project = loadDemo();
  const originalNets = buildNetlist(project).nets;
  const serialized = serializeProject(project);
  assert.equal(typeof serialized, 'string');
  assert.match(serialized, /\n  "schemaVersion": 1,/);

  const reloaded = deserializeProject(serialized);
  assert.deepEqual(reloaded.warnings, []);
  assert.ok(reloaded.project);
  assert.deepEqual(buildNetlist(reloaded.project).nets, originalNets);
  assert.deepEqual(reloaded.project.sheets[0].symbols, project.sheets[0].symbols);
  assert.deepEqual(reloaded.project.sheets[0].wires, project.sheets[0].wires);
  assert.equal(reloaded.project.name, project.name);
  assert.equal(reloaded.project.library.symbols.length, project.library.symbols.length);
});

test('serializeProject 不修改入参并刷新 meta.modified', () => {
  const project = loadDemo();
  const snapshot = JSON.parse(JSON.stringify(project));
  const serialized = serializeProject(project);
  assert.deepEqual(project, snapshot, 'serializeProject 不得修改传入工程');

  const meta = JSON.parse(serialized).meta;
  assert.equal(typeof meta.modified, 'string');
  assert.ok(meta.modified.length > 0);
  assert.equal(meta.created, project.meta.created, '已有 created 应保留');
});

test('损坏或非法工程文本走 { project: null, warnings } 分支且不抛异常', () => {
  const cases = [
    { input: '{ "name": ', expect: 'JSON 解析失败' },
    { input: '   ', expect: '工程文本为空' },
    { input: '[]', expect: '工程数据必须是 JSON 对象' },
    { input: 'null', expect: '工程数据必须是 JSON 对象' },
    { input: 42, expect: '工程文本必须是字符串' },
    { input: null, expect: '工程文本必须是字符串' },
  ];
  for (const item of cases) {
    const result = deserializeProject(item.input);
    assert.equal(result.project, null, '非法输入不应返回工程：' + String(item.input));
    assert.ok(Array.isArray(result.warnings) && result.warnings.length > 0);
    assert.ok(
      result.warnings.some((warning) => typeof warning === 'string' && warning.includes(item.expect)),
      '告警应包含「' + item.expect + '」，实际：' + result.warnings.join('；'),
    );
  }
});

test('缺字段或版本不符的工程被拒绝并给出可读原因', () => {
  const project = JSON.parse(DEMO_TEXT);

  const missingMeta = JSON.parse(DEMO_TEXT);
  delete missingMeta.meta;
  const missingMetaResult = deserializeProject(JSON.stringify(missingMeta));
  assert.equal(missingMetaResult.project, null);
  assert.ok(missingMetaResult.warnings.some((warning) => warning.startsWith('meta')));

  const badVersion = { ...project, schemaVersion: 99 };
  const badVersionResult = deserializeProject(JSON.stringify(badVersion));
  assert.equal(badVersionResult.project, null);
  assert.ok(badVersionResult.warnings.some((warning) => warning.includes('schemaVersion')));

  const badData = JSON.parse(DEMO_TEXT);
  badData.sheets[0].symbols[0].rotation = 45;
  const badDataResult = deserializeProject(JSON.stringify(badData));
  assert.equal(badDataResult.project, null);
  assert.ok(badDataResult.warnings.some((warning) => warning.includes('rotation')));
});

test('serializeProject 对非对象入参抛出 TypeError', () => {
  for (const value of [null, undefined, '', 'text', 42, []]) {
    assert.throws(() => serializeProject(value), TypeError, '应对 ' + String(value) + ' 抛出 TypeError');
  }
});

test('localStorage 草稿往返后网表仍一致，损坏草稿安全降级', () => {
  const project = loadDemo();
  const storage = createMemoryStorage();

  assert.equal(saveToLocalStorage('draft', project, { storage }), true);
  assert.equal(storage.size, 1);
  assert.deepEqual(storage.keys(), ['schematic-studio:draft']);

  const loaded = loadFromLocalStorage('draft', { storage });
  assert.ok(loaded, '应能恢复草稿');
  assert.deepEqual(buildNetlist(loaded).nets, buildNetlist(project).nets);

  assert.equal(loadFromLocalStorage('missing', { storage }), null);
  storage.setItem('schematic-studio:broken', '{ 破碎');
  assert.equal(loadFromLocalStorage('broken', { storage }), null);

  const outcome = saveToLocalStorage('draft', project);
  assert.equal(typeof outcome, 'boolean', '无 storage 时应返回布尔值而不是抛异常');
});

test('两张不同的示例工程序列化后网表互不串扰', () => {
  const led = loadDemo();
  const mcuText = fs.readFileSync(path.join(ROOT, 'examples/demo-mcu.json'), 'utf8');
  const mcu = deserializeProject(mcuText).project;
  assert.ok(mcu);
  const ledNets = buildNetlist(deserializeProject(serializeProject(led)).project).nets;
  const mcuNets = buildNetlist(deserializeProject(serializeProject(mcu)).project).nets;
  assert.equal(ledNets.length, 3);
  assert.equal(mcuNets.length, 16);
  assert.notDeepEqual(ledNets, mcuNets);
});
