// schema 校验测试：合法工程、缺失/非法字段、路径报告与迁移透传。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_VERSION,
  validateProject,
  migrateProject,
  isPlainObject,
} from '../../src/core/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

function makeKicadProject() {
  const project = makeValidProject();
  project.kicad = {
    source: 'C:\\workspace\\demo.kicad_sch',
    tool: 'Eeschema 9.0.8',
    date: '2026-11-19T10:25:58+0800',
    version: 'E',
    libraries: [{ logical: 'TinyTapeout', uri: 'C:\\libs\\TinyTapeout.kicad_sym' }],
  };
  project.netClassAssignments = { GND: 'pwr', 'SDI/out0': 'ioout' };
  const sheet = project.sheets[0];
  sheet.kicad = { number: '1', name: '/', tstamps: '/' };
  sheet.title.source = 'demo.kicad_sch';
  sheet.title.comments = ['a', 'b', '', '', '', '', '', '', ''];
  sheet.symbols[0].kicad = {
    datasheet: '~',
    description: '电容',
    tstamps: '00db537f-1037-4fb6-9d9b-01d9f1f6a64d',
    libsource: { lib: 'TinyTapeout', part: 'C_Small', description: 'Unpolarized capacitor' },
    properties: [{ name: 'MPN', value: 'CL10A105KA8NNNC' }, { name: 'dnp' }, { name: 'JLC', value: '' }],
    fields: [{ name: 'Footprint', value: 'C_0603' }, { name: 'Datasheet' }],
    sheetpath: { names: '/', tstamps: '/' },
  };
  return project;
}

test('新增可选 kicad 字段：完整工程通过校验且 SCHEMA_VERSION 仍为 1', () => {
  assert.equal(SCHEMA_VERSION, 1);
  const result = validateProject(makeKicadProject());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);

  // 字段缺失时零错误（旧工程向后兼容）。
  const legacy = makeValidProject();
  assert.equal(validateProject(legacy).ok, true);
  assert.equal(legacy.kicad, undefined);
  assert.equal(legacy.netClassAssignments, undefined);
});

test('examples/demo-*.json 旧工程仍通过校验', () => {
  const files = fs
    .readdirSync(path.join(ROOT, 'examples'))
    .filter((name) => /^demo-.*\.json$/.test(name));
  assert.ok(files.length >= 2);
  for (const name of files) {
    const text = fs.readFileSync(path.join(ROOT, 'examples', name), 'utf8');
    const result = validateProject(JSON.parse(text));
    assert.equal(result.ok, true, name + ' 校验失败：' + result.errors.join('; '));
  }
});

test('project.kicad 类型错误带路径报错', () => {
  const cases = [
    (project) => {
      project.kicad = 'x';
    },
    (project) => {
      project.kicad = { source: 1 };
    },
    (project) => {
      project.kicad = { libraries: {} };
    },
    (project) => {
      project.kicad = { libraries: [{ logical: 'L', uri: 2 }] };
    },
  ];
  const expected = [
    'kicad: 期望对象',
    'kicad.source: 期望字符串',
    'kicad.libraries: 期望数组',
    'kicad.libraries[0].uri: 期望字符串',
  ];
  cases.forEach((mutate, index) => {
    const project = makeKicadProject();
    mutate(project);
    const result = validateProject(project);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((message) => message.startsWith(expected[index])),
      '期望 ' + expected[index] + '，实际：' + result.errors.join('; '),
    );
  });
});

test('netClassAssignments 的值必须是非空字符串并带网络名路径', () => {
  const project = makeKicadProject();
  project.netClassAssignments = { GND: 'pwr', X: '', Y: 3 };
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('netClassAssignments.X: 期望非空字符串')));
  assert.ok(result.errors.some((message) => message.startsWith('netClassAssignments.Y: 期望非空字符串')));

  const notObject = makeKicadProject();
  notObject.netClassAssignments = ['pwr'];
  assert.ok(validateProject(notObject).errors.some((message) => message.startsWith('netClassAssignments:')));
});

test('sheet.kicad / title.source / symbol.kicad 类型错误带索引路径', () => {
  const project = makeKicadProject();
  project.sheets[0].kicad = { number: 1, name: '/', tstamps: '/' };
  project.sheets[0].title.source = 5;
  project.sheets[0].symbols[0].kicad.properties = [{ name: 'MPN', value: 1 }];
  project.sheets[0].symbols[0].kicad.fields = 'x';
  project.sheets[0].symbols[0].kicad.libsource = { lib: 1, part: 'P', description: '' };
  project.sheets[0].symbols[0].kicad.sheetpath = { names: 1, tstamps: '/' };
  const result = validateProject(project);
  assert.equal(result.ok, false);
  for (const prefix of [
    'sheets[0].kicad.number: 期望字符串',
    'sheets[0].title.source: 期望字符串',
    'sheets[0].symbols[0].kicad.properties[0].value: 期望字符串',
    'sheets[0].symbols[0].kicad.fields: 期望数组',
    'sheets[0].symbols[0].kicad.libsource.lib: 期望字符串',
    'sheets[0].symbols[0].kicad.sheetpath.names: 期望字符串',
  ]) {
    assert.ok(result.errors.some((message) => message.startsWith(prefix)), '缺少错误：' + prefix);
  }
});
