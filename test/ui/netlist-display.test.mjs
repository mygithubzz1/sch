// KiCad 网表展示测试：netRows 的 class、网表面板行内 class、图纸备注双形态与导出对话框 version E 文案。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../../src/model/project.js';
import { createNetlistPanel } from '../../src/ui/panels/netlist-panel.js';
import { commentsTextOf, createPropertiesPanel } from '../../src/ui/panels/properties-panel.js';
import { openExportDialog } from '../../src/ui/dialogs/export-dialog.js';
import { netRows } from '../../src/ui/view-model.js';
import { findAll, findByClass, findByTag, installFakeDom } from './helpers/fake-dom.mjs';

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
