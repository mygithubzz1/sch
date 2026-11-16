// 工程装配测试：内置库注入、工程文件命名与封装库导出文档。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultLibraries } from '../../src/library/index.js';
import { createProject, normalizeProject } from '../../src/model/project.js';
import {
  applyDefaultLibraries,
  createInitialProject,
  exportFileName,
  footprintLibraryDocument,
  projectBaseName,
  projectFileName,
  FOOTPRINT_LIBRARY_FORMAT,
} from '../../src/ui/project-setup.js';

const libraries = createDefaultLibraries();

test('初始工程装配 18 个符号与 10 个封装', () => {
  const project = createInitialProject({ libraries });
  assert.equal(project.name, '未命名工程');
  assert.equal(project.library.symbols.length, 18);
  assert.equal(project.library.footprints.length, 10);
  assert.equal(new Set(project.library.symbols.map((item) => item.id)).size, 18);
  assert.equal(new Set(project.library.footprints.map((item) => item.id)).size, 10);
  assert.ok(project.library.symbols.some((item) => item.id === 'R'));
  assert.ok(project.library.footprints.some((item) => item.id === 'R_0805'));
  assert.equal(project.sheets.length, 1);
});

test('注入内置库不覆盖工程自有定义、不重复注入', () => {
  const source = createProject('自定义工程');
  source.library.symbols.push({ id: 'R', name: '自定义电阻', refPrefix: 'R', pins: [], graphics: [] });
  source.library.footprints.push({ id: 'MY_FP', name: '我的封装', pads: [], graphics: [] });
  const merged = applyDefaultLibraries(source, libraries);
  assert.equal(merged.library.symbols.length, 18);
  assert.equal(merged.library.footprints.length, 11);
  assert.ok(merged.library.footprints.some((item) => item.id === 'R_0805'));
  const resistor = merged.library.symbols.find((item) => item.id === 'R');
  assert.equal(resistor.name, '自定义电阻');
  assert.ok(merged.library.footprints.some((item) => item.id === 'MY_FP'));
  // 不修改入参
  assert.equal(source.library.symbols.length, 1);
  assert.equal(source.library.footprints.length, 1);
  // 再次注入保持幂等
  const again = applyDefaultLibraries(merged, libraries);
  assert.equal(again.library.symbols.length, 18);
  assert.equal(again.library.footprints.length, 11);
});

test('工程文件名安全清洗', () => {
  assert.equal(projectBaseName({ name: '分压电路' }), '分压电路');
  assert.equal(projectFileName({ name: 'a/b:c' }), 'a_b_c.schproj.json');
  assert.equal(projectBaseName({ name: '   ' }), '未命名工程');
  assert.equal(exportFileName({ name: 'AMP' }, '图纸 1', 'svg'), 'AMP-图纸 1.svg');
  assert.equal(exportFileName({ name: 'AMP' }, '', 'png'), 'AMP.png');
  assert.equal(exportFileName({ name: 'AMP' }, 'sheet/1', 'net.json'), 'AMP-sheet_1.net.json');
});

test('封装库导出文档结构稳定', () => {
  const footprints = normalizeProject(createInitialProject({ libraries })).library.footprints;
  const text = footprintLibraryDocument(footprints);
  assert.ok(text.endsWith('\n'));
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, FOOTPRINT_LIBRARY_FORMAT);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.generator, 'schematic-studio');
  assert.equal(parsed.footprints.length, footprints.length);
  assert.notEqual(parsed.footprints, footprints);
  assert.deepEqual(parsed.footprints[0], footprints[0]);
  assert.equal(parsed.footprints[0].id, footprints[0].id);
  assert.deepEqual(JSON.parse(footprintLibraryDocument(null)).footprints, []);
});
