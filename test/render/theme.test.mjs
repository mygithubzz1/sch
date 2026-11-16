import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, THEME_KEYS, createTheme, themeColor } from '../../src/render/theme.js';

test('DEFAULT_THEME 包含契约要求的全部颜色键', () => {
  for (const key of THEME_KEYS) {
    assert.equal(typeof DEFAULT_THEME[key], 'string', '缺少主题键 ' + key);
    assert.ok(DEFAULT_THEME[key].length > 0, '主题键为空 ' + key);
  }
  assert.ok(THEME_KEYS.includes('padTop'));
  assert.ok(THEME_KEYS.includes('padBottom'));
  assert.ok(THEME_KEYS.includes('padDrill'));
  assert.ok(THEME_KEYS.includes('silk'));
  assert.ok(THEME_KEYS.includes('courtyard'));
});

test('默认主题是深色配色且 THT 焊盘为绿色', () => {
  assert.ok(DEFAULT_THEME.background.startsWith('#'));
  assert.notEqual(DEFAULT_THEME.background, DEFAULT_THEME.symbol);
  assert.equal(DEFAULT_THEME.padThru, '#22c55e');
  assert.equal(DEFAULT_THEME.padTop, '#e5484d');
  assert.equal(DEFAULT_THEME.padBottom, '#3b82f6');
});

test('createTheme 合并不修改默认主题', () => {
  const custom = createTheme({ wire: '#ffffff', grid: undefined });
  assert.equal(custom.wire, '#ffffff');
  assert.equal(custom.grid, DEFAULT_THEME.grid);
  assert.equal(DEFAULT_THEME.wire, '#5ad08a');
  const copy = createTheme();
  assert.equal(copy.wire, DEFAULT_THEME.wire);
  copy.wire = '#000000';
  assert.equal(DEFAULT_THEME.wire, '#5ad08a');
});

test('themeColor 在缺失键时回退到默认主题', () => {
  assert.equal(themeColor({ wire: '#123456' }, 'wire'), '#123456');
  assert.equal(themeColor({}, 'wire'), DEFAULT_THEME.wire);
  assert.equal(themeColor(null, 'selection'), DEFAULT_THEME.selection);
});
