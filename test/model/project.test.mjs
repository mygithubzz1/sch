// 工程数据模型测试：工厂缺省值、克隆、JSON 往返、规范化与查找。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject } from '../../src/core/schema.js';
import {
  DEFAULT_GRID,
  DEFAULT_TEXT_SIZE,
  DEFAULT_WIRE_WIDTH,
  createProject,
  createSheet,
  createSymbolInstance,
  createWire,
  createJunction,
  createLabel,
  createText,
  clone,
  normalizeProject,
  findSheetById,
  findEntityById,
  findEntityWithKind,
} from '../../src/model/project.js';

test('createProject 生成契约要求的工程结构', () => {
  const project = createProject('演示工程');
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.name, '演示工程');
  assert.equal(project.units, 'mm');
  assert.equal(project.grid, DEFAULT_GRID);
  assert.equal(project.sheets.length, 1);
  assert.deepEqual(project.library, { symbols: [], footprints: [] });
  assert.equal(typeof project.meta.created, 'string');
  assert.equal(typeof project.meta.modified, 'string');
  assert.deepEqual(createProject().name, '未命名工程');
});

test('createSheet 生成空图纸与标题栏', () => {
  const sheet = createSheet('主图');
  assert.match(sheet.id, /^sheet-/);
  assert.equal(sheet.name, '主图');
  assert.deepEqual(sheet.symbols, []);
  assert.deepEqual(sheet.wires, []);
  assert.deepEqual(sheet.junctions, []);
  assert.deepEqual(sheet.labels, []);
  assert.deepEqual(sheet.texts, []);
  assert.equal(sheet.title.title, '主图');
  assert.match(sheet.title.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(createSheet().name, '图纸 1');
});

test('createSymbolInstance 提供缺省值并规范化旋转与镜像', () => {
  const instance = createSymbolInstance({
    symbolId: 'R',
    designator: 'R1',
    value: '10k',
    x: 10,
    y: 20,
    rotation: 90,
    mirror: true,
    footprintId: 'R_0603',
  });
  assert.match(instance.id, /^sym-/);
  assert.equal(instance.symbolId, 'R');
  assert.equal(instance.designator, 'R1');
  assert.equal(instance.value, '10k');
  assert.equal(instance.x, 10);
  assert.equal(instance.y, 20);
  assert.equal(instance.rotation, 90);
  assert.equal(instance.mirror, true);
  assert.equal(instance.footprintId, 'R_0603');
  assert.deepEqual(instance.fields, {});

  const fallback = createSymbolInstance();
  assert.equal(fallback.designator, 'U?');
  assert.equal(fallback.rotation, 0);
  assert.equal(fallback.mirror, false);
  assert.equal(fallback.footprintId, null);
  assert.equal(createSymbolInstance({ rotation: -90 }).rotation, 270);
  assert.equal(createSymbolInstance({ rotation: 100 }).rotation, 90);
});

test('createWire / createJunction / createLabel / createText 缺省值', () => {
  const wire = createWire([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  assert.match(wire.id, /^wire-/);
  assert.equal(wire.points.length, 2);
  assert.equal(wire.width, DEFAULT_WIRE_WIDTH);
  assert.deepEqual(wire.points[1], { x: 10, y: 0 });
  assert.deepEqual(createWire().points, []);

  const junction = createJunction(1, 2);
  assert.match(junction.id, /^jct-/);
  assert.deepEqual({ x: junction.x, y: junction.y }, { x: 1, y: 2 });

  const label = createLabel({ text: 'VCC', kind: 'global' });
  assert.match(label.id, /^lbl-/);
  assert.equal(label.kind, 'global');
  assert.equal(label.rotation, 0);
  assert.equal(createLabel().kind, 'local');
  assert.equal(createLabel({ kind: 'weird' }).kind, 'local');

  const text = createText({ text: '注释', size: 3 });
  assert.match(text.id, /^txt-/);
  assert.equal(text.text, '注释');
  assert.equal(text.size, 3);
  assert.equal(createText().size, DEFAULT_TEXT_SIZE);
});

test('clone 深拷贝且保留原始类型', () => {
  const source = { a: 1, nested: { list: [1, 2, 3] } };
  const copy = clone(source);
  assert.deepEqual(copy, source);
  assert.notEqual(copy, source);
  assert.notEqual(copy.nested, source.nested);
  copy.nested.list.push(4);
  assert.equal(source.nested.list.length, 3);
  assert.equal(clone(5), 5);
  assert.equal(clone(null), null);
  assert.equal(clone('text'), 'text');
});

test('工程 JSON 序列化往返深度相等', () => {
  const project = createProject('往返测试');
  const sheet = project.sheets[0];
  sheet.symbols.push(createSymbolInstance({ symbolId: 'R', designator: 'R1', x: 10, y: 10 }));
  sheet.wires.push(createWire([{ x: 0, y: 0 }, { x: 10, y: 0 }]));
  sheet.junctions.push(createJunction(10, 0));
  sheet.labels.push(createLabel({ text: 'VCC', kind: 'global', x: 10, y: 0 }));
  sheet.texts.push(createText({ text: '注释', x: 0, y: 10 }));
  sheet.title = { title: '主图', company: 'ACME', rev: 'A', date: '2026-01-01', comments: '备注' };
  project.library.symbols.push({ id: 'R', name: '电阻' });

  const roundTrip = JSON.parse(JSON.stringify(project));
  assert.deepEqual(roundTrip, project);
  assert.deepEqual(JSON.parse(JSON.stringify(roundTrip)), roundTrip);
});

test('normalizeProject 补齐缺省字段且不修改入参', () => {
  const input = {
    name: '演示',
    sheets: [{ name: '主图', symbols: [{ symbolId: 'R', x: 2, y: 3 }] }],
  };
  const project = normalizeProject(input);
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.name, '演示');
  assert.equal(project.units, 'mm');
  assert.equal(project.grid, DEFAULT_GRID);
  assert.equal(project.sheets.length, 1);
  assert.equal(typeof project.sheets[0].id, 'string');
  assert.equal(project.sheets[0].symbols[0].designator, 'U?');
  assert.equal(project.sheets[0].symbols[0].rotation, 0);
  assert.equal(project.sheets[0].symbols[0].mirror, false);
  assert.deepEqual(project.sheets[0].symbols[0].fields, {});
  assert.deepEqual(project.library, { symbols: [], footprints: [] });
  assert.equal(typeof project.meta.created, 'string');
  assert.equal(input.schemaVersion, undefined);
  assert.equal(input.sheets[0].symbols[0].designator, undefined);
});

test('normalizeProject 对空/非法输入回落为单图纸工程', () => {
  for (const input of [null, undefined, [], 'x', 42]) {
    const project = normalizeProject(input);
    assert.equal(project.schemaVersion, 1);
    assert.equal(project.sheets.length, 1);
    assert.equal(Array.isArray(project.sheets[0].wires), true);
  }
});

test('normalizeProject 保留原 id 并清洗数值与枚举', () => {
  const project = normalizeProject({
    name: '清洗',
    sheets: [
      {
        id: 'sheet-a',
        name: 'A',
        symbols: [{ id: 'sym-a', symbolId: 'R', rotation: '90', x: '5', mirror: 'yes' }],
        wires: [{ id: 'wire-a', points: [{ x: '0', y: '0' }, { x: '5', y: 0 }], width: -1 }],
        junctions: [{ id: 'jct-a', x: '1.5', y: 2 }],
        labels: [{ id: 'lbl-a', x: 0, y: 0, text: 'VCC', kind: 'global' }],
        texts: [{ id: 'txt-a', x: 0, y: 0, text: 't', size: 0 }],
        title: {},
      },
    ],
  });
  const sheet = project.sheets[0];
  assert.equal(sheet.id, 'sheet-a');
  assert.equal(sheet.symbols[0].id, 'sym-a');
  assert.equal(sheet.symbols[0].rotation, 90);
  assert.equal(sheet.symbols[0].x, 5);
  assert.equal(sheet.symbols[0].mirror, false);
  assert.equal(sheet.wires[0].width, DEFAULT_WIRE_WIDTH);
  assert.deepEqual(sheet.wires[0].points[0], { x: 0, y: 0 });
  assert.deepEqual({ x: sheet.junctions[0].x, y: sheet.junctions[0].y }, { x: 1.5, y: 2 });
  assert.equal(sheet.labels[0].kind, 'global');
  assert.equal(sheet.texts[0].size, DEFAULT_TEXT_SIZE);
  assert.equal(sheet.title.title, 'A');
});

test('createProject 接受并保留 kicad / netClassAssignments，缺省时保持旧形状', () => {
  const project = createProject('富属性工程', {
    kicad: {
      source: 'C:\\workspace\\demo.kicad_sch',
      tool: 'Eeschema 9.0.8',
      date: '2026-11-19T10:25:58+0800',
      version: 'E',
      libraries: [{ logical: 'TinyTapeout', uri: 'C:\\libs\\TinyTapeout.kicad_sym' }],
    },
    netClassAssignments: { GND: 'pwr', 'SDI/out0': 'ioout', empty: '' },
  });

  assert.deepEqual(project.kicad, {
    source: 'C:\\workspace\\demo.kicad_sch',
    tool: 'Eeschema 9.0.8',
    date: '2026-11-19T10:25:58+0800',
    version: 'E',
    libraries: [{ logical: 'TinyTapeout', uri: 'C:\\libs\\TinyTapeout.kicad_sym' }],
  });
  assert.deepEqual(project.netClassAssignments, { GND: 'pwr', 'SDI/out0': 'ioout' });
  assert.deepEqual(JSON.parse(JSON.stringify(project)), project);

  const legacy = createProject('旧工程');
  assert.equal('kicad' in legacy, false);
  assert.equal('netClassAssignments' in legacy, false);
  assert.equal('kicad' in normalizeProject(legacy), false);
  assert.equal('netClassAssignments' in normalizeProject(legacy), false);
});

test('normalizeProject 深拷贝并保留 kicad / netClassAssignments，JSON 往返不丢字段', () => {
  const project = createProject('规范化', {
    kicad: { source: '/tmp/a.kicad_sch', libraries: [{ logical: 'L', uri: '/tmp/L.kicad_sym' }] },
    netClassAssignments: { MID: 'ioout' },
  });
  const roundTrip = normalizeProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(roundTrip, project);

  const normalized = normalizeProject({
    name: '外部工程',
    kicad: { source: 'x', unknown: 1 },
    netClassAssignments: { A: 'pwr', B: 42, C: '   ', '': 'x' },
  });
  assert.equal(normalized.kicad.source, 'x');
  assert.equal('unknown' in normalized.kicad, false);
  assert.deepEqual(normalized.netClassAssignments, { A: 'pwr' });
});

test('createSheet 支持 kicad 图纸路径与标题栏 source / comments 双形态', () => {
  const sheet = createSheet('RP2040', {
    index: 1,
    kicad: { number: '2', name: '/RP2040/', tstamps: '/5384e408-8f0c-411c-b558-df35c2e889ec/' },
    title: {
      title: 'RP2040 Basic Support',
      company: 'Psychogenic Technologies',
      rev: '1.0.3',
      date: '2023-11-22',
      source: 'rp2040.kicad_sch',
      comments: ['See LICENSE.txt', 'Licensed under Apache 2.0'],
    },
  });
  assert.deepEqual(sheet.kicad, {
    number: '2',
    name: '/RP2040/',
    tstamps: '/5384e408-8f0c-411c-b558-df35c2e889ec/',
  });
  assert.equal(sheet.title.source, 'rp2040.kicad_sch');
  assert.deepEqual(sheet.title.comments, ['See LICENSE.txt', 'Licensed under Apache 2.0']);

  const defaults = createSheet('默认图');
  assert.equal('kicad' in defaults, false);
  assert.equal('source' in defaults.title, false);
  assert.equal(defaults.title.comments, '');

  const tooMany = normalizeProject({
    name: '截断',
    sheets: [
      {
        name: 'S',
        title: { comments: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 11] },
      },
    ],
  });
  assert.equal(tooMany.sheets[0].title.comments.length, 9);
  assert.deepEqual(tooMany.sheets[0].title.comments, ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
});

test('createSymbolInstance 接受并保留 symbol.kicad（保序数组、区分无值/空串）', () => {
  const instance = createSymbolInstance({
    symbolId: 'C_Small',
    designator: 'C1',
    kicad: {
      datasheet: '~',
      description: '电容',
      tstamps: '00db537f-1037-4fb6-9d9b-01d9f1f6a64d',
      libsource: { lib: 'TinyTapeout', part: 'C_Small', description: 'Unpolarized capacitor' },
      properties: [{ name: 'MPN', value: 'CL10A105KA8NNNC' }, { name: 'dnp' }, { name: 'JLC', value: '' }],
      fields: [{ name: 'Footprint', value: 'C_0603' }, { name: 'Datasheet' }, { name: 'Description', value: '' }],
      sheetpath: { names: '/RP2040/', tstamps: '/uuid/' },
    },
  });

  assert.equal(instance.kicad.datasheet, '~');
  assert.deepEqual(instance.kicad.libsource, {
    lib: 'TinyTapeout',
    part: 'C_Small',
    description: 'Unpolarized capacitor',
  });
  assert.deepEqual(instance.kicad.properties[0], { name: 'MPN', value: 'CL10A105KA8NNNC' });
  assert.deepEqual(instance.kicad.properties[1], { name: 'dnp' });
  assert.equal('value' in instance.kicad.properties[1], false);
  assert.deepEqual(instance.kicad.properties[2], { name: 'JLC', value: '' });
  assert.deepEqual(instance.kicad.fields[1], { name: 'Datasheet' });
  assert.deepEqual(instance.kicad.fields[2], { name: 'Description', value: '' });
  assert.deepEqual(instance.kicad.sheetpath, { names: '/RP2040/', tstamps: '/uuid/' });

  assert.deepEqual(JSON.parse(JSON.stringify(instance)), instance);
  assert.equal('kicad' in createSymbolInstance(), false);
});

test('findSheetById / findEntityById / findEntityWithKind', () => {
  const project = createProject('查找');
  const sheet = project.sheets[0];
  const wire = createWire([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  sheet.wires.push(wire);

  assert.equal(findSheetById(project, sheet.id), sheet);
  assert.equal(findSheetById(project, 'missing'), null);
  assert.equal(findSheetById(null, 'x'), null);

  assert.equal(findEntityById(sheet, wire.id), wire);
  assert.equal(findEntityById(sheet, 'missing'), null);
  assert.deepEqual(findEntityWithKind(sheet, wire.id), { kind: 'wires', entity: wire });
  assert.equal(findEntityWithKind(sheet, ''), null);
  assert.equal(findEntityWithKind(null, 'x'), null);
});

test('symbol.kicad.tstamps 支持 string | string[] 双形态：规范化保序不压平，schema 校验两种形态', () => {
  const project = createProject('tstamps');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({
      id: 'sym-multi',
      symbolId: 'R',
      designator: 'R1',
      kicad: { tstamps: ['a', 'b', 'c'] },
    }),
  );
  sheet.symbols.push(
    createSymbolInstance({
      id: 'sym-single',
      symbolId: 'R',
      designator: 'R2',
      kicad: { tstamps: 'single' },
    }),
  );
  sheet.symbols.push(createSymbolInstance({ id: 'sym-none', symbolId: 'R', designator: 'R3' }));

  const normalized = normalizeProject(project);
  const symbols = normalized.sheets[0].symbols;
  assert.deepEqual(symbols[0].kicad.tstamps, ['a', 'b', 'c'], '数组必须保序，不得压平');
  assert.equal(symbols[1].kicad.tstamps, 'single', '单值字符串行为不变');
  assert.equal(symbols[2].kicad, undefined, '缺失 kicad 时保持旧工程形状');

  // JSON 往返与二次规范化都不丢形态。
  const roundTrip = normalizeProject(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(roundTrip.sheets[0].symbols[0].kicad.tstamps, ['a', 'b', 'c']);
  assert.equal(roundTrip.sheets[0].symbols[1].kicad.tstamps, 'single');

  const valid = validateProject(normalized);
  assert.equal(valid.ok, true, '两种形态都应通过校验：' + JSON.stringify(valid.errors));

  const invalidScalar = JSON.parse(JSON.stringify(normalized));
  invalidScalar.sheets[0].symbols[0].kicad.tstamps = 42;
  const scalarResult = validateProject(invalidScalar);
  assert.equal(scalarResult.ok, false);
  assert.ok(
    scalarResult.errors.some(
      (error) => error.includes('symbols[0].kicad.tstamps') && error.includes('期望字符串或字符串数组'),
    ),
    '非法标量应报带路径的错误：' + JSON.stringify(scalarResult.errors),
  );

  const invalidItem = JSON.parse(JSON.stringify(normalized));
  invalidItem.sheets[0].symbols[0].kicad.tstamps = ['a', 42];
  const itemResult = validateProject(invalidItem);
  assert.equal(itemResult.ok, false);
  assert.ok(
    itemResult.errors.some((error) => error.includes('kicad.tstamps[1]') && error.includes('期望字符串')),
    '数组元素类型错误应带下标路径：' + JSON.stringify(itemResult.errors),
  );
});
