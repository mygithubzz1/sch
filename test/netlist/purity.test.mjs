// 网表层纯度与符号解析测试：禁止 DOM / 反向依赖，符号来源优先级与内置库回退。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSymbolMap, buildConnectivity } from '../../src/netlist/connectivity.js';
import { createProject, createSymbolInstance } from '../../src/model/project.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NETLIST_DIR = path.join(ROOT, 'src/netlist');

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

const FORBIDDEN_IMPORTS = ['../render/', '../editor/', '../io/', '../ui/'];

function listModules() {
  return fs
    .readdirSync(NETLIST_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(NETLIST_DIR, entry.name));
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

test('src/netlist 下的模块带职责注释且不引用 DOM 全局', () => {
  const files = listModules();
  assert.ok(files.length >= 3, '网表层至少应有 connectivity / erc / index 三个模块');

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

test('src/netlist 只使用相对 import，且不依赖 render / editor / io / ui', () => {
  for (const file of listModules()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      assert.equal(specifier.startsWith('.'), true, path.basename(file) + ' 的 import 必须相对路径：' + specifier);
      assert.equal(specifier.startsWith('node:'), false, path.basename(file) + ' 不得引用 node 内置模块');
      for (const forbidden of FORBIDDEN_IMPORTS) {
        assert.equal(specifier.includes(forbidden), false, path.basename(file) + ' 越层依赖 ' + specifier);
      }
    }
  }
});

test('符号解析：options.symbols 优先于 project.library.symbols', () => {
  const project = createProject('符号来源');
  project.library.symbols = [
    { id: 'R', pins: [{ number: '1', x: 0, y: 0, electricalType: 'passive' }] },
  ];
  const injected = {
    id: 'R',
    power: false,
    pins: [
      { number: '1', x: -1, y: 0, electricalType: 'passive' },
      { number: '2', x: 1, y: 0, electricalType: 'passive' },
    ],
  };

  const map = resolveSymbolMap(project, { symbols: [injected] });
  assert.equal(map.get('R'), injected);
  assert.equal(map.get('R').pins.length, 2);

  const projectOnly = resolveSymbolMap(project);
  assert.equal(projectOnly.get('R').pins.length, 1);
});

test('符号解析：缺失内置库时通过 options 注入仍可构建网络', () => {
  const project = createProject('注入符号');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ symbolId: 'SW', designator: 'SW1', x: 0, y: 0 }),
    createSymbolInstance({ symbolId: 'SW', designator: 'SW2', x: 0, y: 20 }),
  );
  const switchDef = {
    id: 'SW',
    power: false,
    pins: [
      { number: '1', x: -5.08, y: 0, electricalType: 'passive' },
      { number: '2', x: 5.08, y: 0, electricalType: 'passive' },
    ],
  };
  // SW1.1 (-5.08,0) 与 SW2 顶部引脚不重合；仅验证注入符号可用
  const { nets } = buildConnectivity(project, sheet, { symbols: [switchDef] });
  assert.equal(nets.length, 4);
  assert.ok(nets.every((net) => net.pins.length === 1));
  assert.deepEqual(
    nets.flatMap((net) => net.pins.map((pin) => pin.designator + '-' + pin.pinNumber)).sort(),
    ['SW1-1', 'SW1-2', 'SW2-1', 'SW2-2'],
  );
});

test('内置符号库回退：library 层存在时无需显式注入即可解析 GND / R', (t) => {
  const builtinPath = path.join(ROOT, 'src/library/builtin-symbols.js');
  if (!fs.existsSync(builtinPath)) {
    t.skip('library 层尚未落地，跳过内置符号回退检查');
    return;
  }

  const project = createProject('内置库回退');
  const map = resolveSymbolMap(project);
  assert.ok(map.has('GND'), '应能回退解析 GND');
  assert.ok(map.has('R'), '应能回退解析 R');
  assert.equal(map.get('GND').power, true);
  assert.ok(Array.isArray(map.get('GND').pins));
  assert.ok(map.get('GND').pins.length >= 1);
});
