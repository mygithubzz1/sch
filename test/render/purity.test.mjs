import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../src/render/', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');

test('纯渲染模块不引用 DOM 全局', () => {
  for (const file of ['view.js', 'theme.js', 'grid.js', 'symbols.js', 'bounds.js']) {
    const source = read(file);
    assert.ok(!/\bdocument\b/.test(source), file + ' 不应出现 document');
    assert.ok(!/\bwindow\b/.test(source), file + ' 不应出现 window');
    assert.ok(!/requestAnimationFrame/.test(source), file + ' 不应调度动画帧');
    assert.ok(source.startsWith('//'), file + ' 顶部缺少职责注释');
  }
});

test('渲染代码不硬编码颜色，全部取自主题', () => {
  for (const file of ['view.js', 'grid.js', 'symbols.js', 'bounds.js', 'title-bar.js', 'base-renderer.js', 'renderer.js', 'footprint-renderer.js']) {
    const source = read(file);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(source), file + ' 不应出现十六进制颜色字面量');
    assert.ok(!/rgba?\(/.test(source), file + ' 不应出现 rgba 颜色字面量');
  }
});

test('渲染层只依赖 core/model，不反向依赖 editor/io/ui', () => {
  for (const file of ['view.js', 'theme.js', 'grid.js', 'symbols.js', 'bounds.js', 'title-bar.js', 'base-renderer.js', 'renderer.js', 'footprint-renderer.js']) {
    const source = read(file);
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      const target = match[1];
      assert.ok(!target.includes('/editor/'), file + ' 不应依赖 editor: ' + target);
      assert.ok(!target.includes('/io/'), file + ' 不应依赖 io: ' + target);
      assert.ok(!target.includes('/ui/'), file + ' 不应依赖 ui: ' + target);
    }
  }
});
