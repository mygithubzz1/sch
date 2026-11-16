// 分层纯净性测试：library 不得依赖 DOM、node 内置模块或上层目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LIBRARY_DIR = path.join(ROOT, 'src/library');

const FORBIDDEN_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'requestAnimationFrame',
  'CanvasRenderingContext2D',
  'globalThis',
];

function listModules(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(directory, entry.name));
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function importSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  let match = pattern.exec(source);
  while (match) {
    specifiers.push(match[1]);
    match = pattern.exec(source);
  }
  return specifiers;
}

const files = listModules(LIBRARY_DIR);

test('library 模块带职责注释且不引用 DOM', () => {
  assert.ok(files.length >= 8);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const firstLine = source.split(/\r?\n/)[0].trim();
    assert.match(firstLine, /^\/\/ /, path.basename(file) + ' 需要顶部职责注释');

    const code = stripComments(source);
    for (const name of FORBIDDEN_GLOBALS) {
      const pattern = new RegExp('\\b' + name + '\\b');
      assert.equal(pattern.test(code), false, path.basename(file) + ' 不应引用 ' + name);
    }
  }
});

test('library 只使用同层相对 import', () => {
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      assert.equal(specifier.startsWith('./'), true, path.basename(file) + ' 只允许同层 import：' + specifier);
      assert.equal(specifier.endsWith('.js'), true, path.basename(file) + ' import 必须带扩展名：' + specifier);
    }
  }
});
