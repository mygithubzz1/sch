// 分层纯净性测试：core/model 不得引用 DOM、node 内置模块或上层目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

const LAYERS = [
  {
    dir: 'src/core',
    forbiddenImports: ['../model/', '../library/', '../netlist/', '../render/', '../editor/', '../io/', '../ui/'],
  },
  {
    dir: 'src/model',
    forbiddenImports: ['../library/', '../netlist/', '../render/', '../editor/', '../io/', '../ui/'],
  },
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

for (const layer of LAYERS) {
  const files = listModules(path.join(ROOT, layer.dir));

  test(layer.dir + ' 下的模块带职责注释且不引用 DOM', () => {
    assert.ok(files.length > 0);
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

  test(layer.dir + ' 只使用相对 import 且不越层依赖', () => {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const specifiers = importSpecifiers(source);
      for (const specifier of specifiers) {
        assert.equal(specifier.startsWith('.'), true, path.basename(file) + ' 的 import 必须相对路径：' + specifier);
        assert.equal(specifier.startsWith('node:'), false, path.basename(file) + ' 不得引用 node 内置模块');
        for (const forbidden of layer.forbiddenImports) {
          assert.equal(
            specifier.includes(forbidden),
            false,
            path.basename(file) + ' 越层依赖 ' + specifier,
          );
        }
      }
    }
  });
}
