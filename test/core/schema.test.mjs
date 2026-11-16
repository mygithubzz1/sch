// schema 校验测试：合法工程、缺失/非法字段、路径报告与迁移透传。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  validateProject,
  migrateProject,
  isPlainObject,
} from '../../src/core/schema.js';

function makeValidProject() {
  return {
    schemaVersion: 1,
    name: '测试工程',
    units: 'mm',
    grid: 2.54,
    sheets: [
      {
        id: 'sheet-1',
        name: '图纸 1',
        symbols: [
          {
            id: 'sym-1',
            symbolId: 'R',
            designator: 'R1',
            value: '10k',
            x: 0,
            y: 0,
            rotation: 0,
            mirror: false,
            footprintId: null,
            fields: {},
          },
        ],
        wires: [{ id: 'wire-1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], width: 0.1524 }],
        junctions: [{ id: 'jct-1', x: 0, y: 0 }],
        labels: [{ id: 'lbl-1', x: 0, y: 0, rotation: 0, text: 'VCC', kind: 'global' }],
        texts: [{ id: 'txt-1', x: 0, y: 0, rotation: 0, text: '注释', size: 1.27 }],
        title: { title: '图纸 1', company: '', rev: '', date: '2026-01-01', comments: '' },
      },
    ],
    library: { symbols: [], footprints: [] },
    meta: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
  };
}

test('合法工程通过校验', () => {
  const result = validateProject(makeValidProject());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(SCHEMA_VERSION, 1);
});

test('缺失顶层字段报告错误', () => {
  const project = makeValidProject();
  delete project.sheets;
  delete project.grid;
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('sheets:')));
  assert.ok(result.errors.some((message) => message.startsWith('grid:')));
});

test('非法 schemaVersion 与 units 报告错误', () => {
  const project = makeValidProject();
  project.schemaVersion = 2;
  project.units = 'inch';
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes('不支持的版本')));
  assert.ok(result.errors.some((message) => message.startsWith('units:')));
});

test('实体缺失字段带索引路径', () => {
  const project = makeValidProject();
  delete project.sheets[0].symbols[0].designator;
  project.sheets[0].labels[0].kind = 'bus';
  project.sheets[0].wires[0].points = [{ x: 0, y: 0 }];
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('sheets[0].symbols[0].designator:')));
  assert.ok(result.errors.some((message) => message.startsWith('sheets[0].labels[0].kind:')));
  assert.ok(result.errors.some((message) => message.includes('至少需要两个点')));
});

test('非对象输入与空图纸数组报告错误', () => {
  assert.equal(validateProject(null).ok, false);
  assert.equal(validateProject('x').ok, false);
  assert.equal(validateProject([]).ok, false);
  const project = makeValidProject();
  project.sheets = [];
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes('至少需要一张图纸')));
});

test('migrateProject 对 v1 原样返回，非对象透传', () => {
  const project = makeValidProject();
  assert.equal(migrateProject(project), project);
  assert.equal(migrateProject(null), null);
  assert.equal(migrateProject('raw'), 'raw');
});

test('isPlainObject 排除数组与 null', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(3), false);
});
