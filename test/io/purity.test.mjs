import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../src/io/', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

test('SVG 导出模块是纯函数，不依赖 DOM/canvas', () => {
  for (const file of ['svg-export.js', 'svg-primitives.js']) {
    const source = read(file);
    assert.ok(!/\bdocument\b/.test(source), file + ' 不应出现 document');
    assert.ok(!/\bwindow\b/.test(source), file + ' 不应出现 window');
    assert.ok(!/getContext|createElement|toBlob/.test(source), file + ' 不应接触 canvas/DOM');
    assert.ok(source.startsWith('//'), file + ' 顶部缺少职责注释');
  }
});

test('SVG 导出复用 render 图元几何而不重复实现', () => {
  const primitives = read('svg-primitives.js');
  const entry = read('svg-export.js');
  assert.ok(primitives.includes("from '../render/symbols.js'"));
  assert.ok(primitives.includes('drawSymbolPrimitives'));
  assert.ok(entry.includes("from '../render/bounds.js'"));
  assert.ok(primitives.includes("from '../render/theme.js'"));
});

test('io 层不反向依赖 editor/ui', () => {
  for (const file of ['project-io.js', 'svg-export.js', 'svg-primitives.js', 'png-export.js']) {
    const source = read(file);
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      const target = match[1];
      assert.ok(!target.includes('/editor/'), file + ' 不应依赖 editor: ' + target);
      assert.ok(!target.includes('/ui/'), file + ' 不应依赖 ui: ' + target);
    }
  }
});
