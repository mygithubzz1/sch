// 网表测试夹具：用 model API 构造分压、LED、跨图纸、junction 与 ERC 场景电路（纯数据，不依赖 library 层）。
import {
  createProject,
  createSheet,
  createSymbolInstance,
  createWire,
  createJunction,
  createLabel,
} from '../../src/model/project.js';

const RESISTOR = {
  id: 'R',
  name: 'R',
  refPrefix: 'R',
  description: '电阻',
  power: false,
  pins: [
    { id: 'R.1', name: '~', number: '1', x: -5.08, y: 0, length: 2.54, orientation: 'right', electricalType: 'passive' },
    { id: 'R.2', name: '~', number: '2', x: 5.08, y: 0, length: 2.54, orientation: 'left', electricalType: 'passive' },
  ],
  graphics: [{ type: 'rect', x: -2.54, y: -1.27, w: 5.08, h: 2.54, width: 0.254 }],
};

const LED = {
  id: 'LED',
  name: 'LED',
  refPrefix: 'D',
  description: '发光二极管',
  power: false,
  pins: [
    { id: 'LED.1', name: 'A', number: '1', x: -5.08, y: 0, length: 2.54, orientation: 'right', electricalType: 'passive' },
    { id: 'LED.2', name: 'K', number: '2', x: 5.08, y: 0, length: 2.54, orientation: 'left', electricalType: 'passive' },
  ],
  graphics: [],
};

const GND = {
  id: 'GND',
  name: 'GND',
  refPrefix: '#PWR',
  description: '地符号',
  power: true,
  pins: [
    { id: 'GND.1', name: 'GND', number: '1', x: 0, y: 0, length: 2.54, orientation: 'down', electricalType: 'power_in' },
  ],
  graphics: [],
};

const VCC = {
  id: 'VCC',
  name: 'VCC',
  refPrefix: '#PWR',
  description: '电源符号',
  power: true,
  pins: [
    { id: 'VCC.1', name: 'VCC', number: '1', x: 0, y: 0, length: 2.54, orientation: 'up', electricalType: 'power_out' },
  ],
  graphics: [],
};

const FIVE_VOLT = {
  id: '+5V',
  name: '+5V',
  refPrefix: '#PWR',
  description: '5V 电源符号',
  power: true,
  pins: [
    { id: '+5V.1', name: '+5V', number: '1', x: 0, y: 0, length: 2.54, orientation: 'up', electricalType: 'power_out' },
  ],
  graphics: [],
};

const TEST_POINT = {
  id: 'TP',
  name: 'TP',
  refPrefix: 'TP',
  description: '测试点（无封装）',
  power: false,
  pins: [
    { id: 'TP.1', name: 'TP', number: '1', x: 0, y: 0, length: 0, orientation: 'up', electricalType: 'passive' },
  ],
  graphics: [],
};

const SOCKET = {
  id: 'SOCKET',
  name: 'SOCKET',
  refPrefix: 'X',
  description: 'IC 插座（虚拟器件）',
  power: false,
  virtual: true,
  pins: [
    { id: 'SOCKET.1', name: '~', number: '1', x: -5.08, y: 0, length: 2.54, orientation: 'right', electricalType: 'passive' },
    { id: 'SOCKET.2', name: '~', number: '2', x: 5.08, y: 0, length: 2.54, orientation: 'left', electricalType: 'passive' },
  ],
  graphics: [],
};

/** 内置测试符号定义（每次返回新副本，避免用例间共享可变对象）。 */
export function symbolDefs() {
  return [RESISTOR, LED, GND, VCC, FIVE_VOLT, TEST_POINT, SOCKET].map((def) => JSON.parse(JSON.stringify(def)));
}

function attachSymbols(project) {
  project.library.symbols = symbolDefs();
  return project;
}

/**
 * 分压网络：VCC -- R1 --（MID 标签，同时是 R1.2 / R2.1 的汇合点）-- R2 -- GND。
 * 全过程无导线，靠引脚端点重合与标签锚点建立连接。
 */
export function dividerProject() {
  const project = createProject('分压网络');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ symbolId: 'VCC', designator: '#PWR01', value: 'VCC', x: 0, y: 0 }),
    createSymbolInstance({ symbolId: 'R', designator: 'R1', value: '10k', x: 0, y: 5.08, rotation: 90, footprintId: 'R_0805' }),
    createSymbolInstance({ symbolId: 'R', designator: 'R2', value: '10k', x: 0, y: 15.24, rotation: 90, footprintId: 'R_0805' }),
    createSymbolInstance({ symbolId: 'GND', designator: '#PWR02', value: 'GND', x: 0, y: 20.32 }),
  );
  sheet.labels.push(createLabel({ x: 0, y: 10.16, text: 'MID', kind: 'local' }));
  return attachSymbols(project);
}

/**
 * LED 指示电路：VCC（两个电源符号）-- 导线 -- R1 -- 导线 -- D1 -- GND，
 * 另有一根悬空导线用于触发 UNCONNECTED_WIRE。
 */
export function ledProject() {
  const project = createProject('LED 指示电路');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ symbolId: 'VCC', designator: '#PWR01', value: 'VCC', x: 0, y: 0 }),
    createSymbolInstance({ symbolId: 'VCC', designator: '#PWR03', value: 'VCC', x: 2.54, y: 0 }),
    createSymbolInstance({ symbolId: 'R', designator: 'R1', value: '330', x: 17.78, y: 0, footprintId: 'R_0805' }),
    createSymbolInstance({ symbolId: 'LED', designator: 'D1', value: '红色', x: 30.48, y: 0, footprintId: 'LED_0805' }),
    createSymbolInstance({ symbolId: 'GND', designator: '#PWR02', value: 'GND', x: 35.56, y: 0 }),
  );
  sheet.wires.push(
    createWire([{ x: 0, y: 0 }, { x: 12.7, y: 0 }]),
    createWire([{ x: 22.86, y: 0 }, { x: 25.4, y: 0 }]),
    createWire([{ x: 0, y: 10.16 }, { x: 7.62, y: 10.16 }]),
  );
  return attachSymbols(project);
}

/** 电源名优先于局部标签：+5V 电源符号 + R9 + GND，+5V 网络上还挂了一个局部标签。 */
export function powerNameProject() {
  const project = createProject('电源命名优先级');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ symbolId: '+5V', designator: '#PWR10', value: '+5V', x: 0, y: 0 }),
    createSymbolInstance({ symbolId: 'R', designator: 'R9', value: '4.7k', x: 10.16, y: 0, footprintId: 'R_0805' }),
    createSymbolInstance({ symbolId: 'GND', designator: '#PWR11', value: 'GND', x: 20.32, y: 0 }),
  );
  sheet.wires.push(
    createWire([{ x: 0, y: 0 }, { x: 5.08, y: 0 }]),
    createWire([{ x: 15.24, y: 0 }, { x: 20.32, y: 0 }]),
  );
  sheet.labels.push(createLabel({ x: 0, y: 0, text: 'LOCAL_V', kind: 'local' }));
  return attachSymbols(project);
}

/**
 * 跨两张图纸的全局标签：两片都叫 SIG 的 global label 合并成同一网络；
 * 同名 local label LOCAL1 不跨图纸合并（得到 LOCAL1 / LOCAL1_2）；位号 R1 重复。
 */
export function hierarchicalProject() {
  const project = createProject('跨图纸信号');
  const first = project.sheets[0];
  const second = createSheet('图纸 2');
  project.sheets.push(second);

  for (const sheet of [first, second]) {
    sheet.symbols.push(
      createSymbolInstance({ symbolId: 'R', designator: 'R1', value: sheet === first ? '1k' : '2k', x: 10, y: 0, footprintId: 'R_0805' }),
    );
    sheet.wires.push(createWire([{ x: 15.08, y: 0 }, { x: 20, y: 0 }]));
    sheet.labels.push(createLabel({ x: 20, y: 0, text: 'SIG', kind: 'global' }));
    sheet.labels.push(createLabel({ x: 4.92, y: 0, text: 'LOCAL1', kind: 'local' }));
  }
  return attachSymbols(project);
}

/** junction 夹具：水平导线与垂直导线在 (10,0) 中段十字交叉，可开关 junction。 */
export function junctionProject(options = {}) {
  const withJunction = options.withJunction === true;
  const project = createProject('junction 合并');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ symbolId: 'R', designator: 'R1', value: '1k', x: 25.08, y: 0, footprintId: 'R_0805' }),
    createSymbolInstance({ symbolId: 'R', designator: 'R2', value: '2k', x: 10, y: 15.08, rotation: 90, footprintId: 'R_0805' }),
  );
  sheet.wires.push(
    createWire([{ x: 0, y: 0 }, { x: 20, y: 0 }]),
    createWire([{ x: 10, y: -10 }, { x: 10, y: 10 }]),
  );
  if (withJunction) sheet.junctions.push(createJunction(10, 0));
  return attachSymbols(project);
}

/** ERC 夹具：重复位号、缺封装、浮空引脚、单脚网络、未知符号与悬空导线。 */
export function ercProject() {
  const project = createProject('ERC 检查');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ symbolId: 'R', designator: 'R1', value: '1k', x: 0, y: 0, footprintId: 'R_0805' }),
    createSymbolInstance({ symbolId: 'R', designator: 'R1', value: '2k', x: 20, y: 0, footprintId: 'R_0805' }),
    createSymbolInstance({ symbolId: 'R', designator: 'R2', value: '3k', x: 40, y: 0 }),
    createSymbolInstance({ symbolId: 'R', designator: 'R3', value: '4k', x: 60, y: 20, footprintId: 'R_0402' }),
    createSymbolInstance({ symbolId: 'NOPE', designator: 'U1', value: '未知器件', x: 80, y: 0, footprintId: 'DIP-8' }),
  );
  sheet.wires.push(
    createWire([{ x: 5.08, y: 0 }, { x: 14.92, y: 0 }]),
    createWire([{ x: 65.08, y: 20 }, { x: 70, y: 20 }]),
    createWire([{ x: 80, y: 40 }, { x: 90, y: 40 }]),
  );
  return attachSymbols(project);
}

/**
 * 虚拟器件夹具：电源符号孤立/只接导线、测试点与 IC 插座（无封装），
 * 另有普通电阻缺封装；用于验证 ERC 的电源/虚拟器件告警豁免。
 */
export function virtualProject() {
  const project = createProject('虚拟器件');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ symbolId: 'GND', designator: '#PWR01', value: 'GND', x: 0, y: 0 }),
    createSymbolInstance({ symbolId: 'TP', designator: 'TP1', value: '测试点', x: 20, y: 0 }),
    createSymbolInstance({ symbolId: 'SOCKET', designator: 'X1', value: 'DIP-8 插座', x: 40, y: 0 }),
    createSymbolInstance({ symbolId: 'R', designator: 'R1', value: '1k', x: 60, y: 0 }),
    createSymbolInstance({ symbolId: 'GND', designator: '#PWR02', value: 'GND', x: 80, y: 20 }),
  );
  // #PWR02 只接一段悬空导线：其网络只有 1 个电源引脚，不应报 SINGLE_PIN_NET。
  sheet.wires.push(createWire([{ x: 80, y: 20 }, { x: 90, y: 20 }]));
  return attachSymbols(project);
}

/** 特殊字符夹具：工程名、元件值、网络名（局部标签）含引号、反斜杠与逗号。 */
export function specialCharsProject() {
  const project = createProject('特殊"字符"工程');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ symbolId: 'R', designator: 'R1', value: '10"k\\x', x: 0, y: 0, footprintId: 'R_0805' }),
  );
  sheet.wires.push(createWire([{ x: 5.08, y: 0 }, { x: 10.16, y: 0 }]));
  sheet.labels.push(createLabel({ x: 10.16, y: 0, text: 'A,B', kind: 'local' }));
  return attachSymbols(project);
}

/** 空工程：只有一张空图纸。 */
export function emptyProject() {
  return attachSymbols(createProject('空工程'));
}

/**
 * 富属性夹具：project.kicad / project.netClassAssignments / sheet.kicad / sheet.title.source /
 * symbol.kicad / 库符号元数据 / KiCad 引脚类型与 noConnect、free 修饰齐备，
 * 供 T3 导出器逐字段取数，也用于连通性契约测试。
 */
const RICH_SYMBOL = {
  id: 'RICH',
  name: '富属性符号',
  refPrefix: 'U',
  description: 'Rich attribute test symbol',
  docs: 'https://example.com/docs',
  footprints: ['Package_SO:SOT-23'],
  keywords: 'rich test',
  fpFilters: ['SOT-*'],
  fields: [
    { name: 'Reference', value: 'U' },
    { name: 'Value', value: 'RICH' },
    { name: 'Footprint' },
    { name: 'Datasheet', value: '~' },
    { name: 'Description', value: 'Rich attribute test symbol' },
  ],
  power: false,
  pins: [
    { id: 'RICH.1', name: 'SBU1', number: '1', x: -5.08, y: 0, length: 2.54, orientation: 'right', electricalType: 'bidirectional', noConnect: true },
    { id: 'RICH.2', name: 'mio[36]/ctrl', number: '2', x: 5.08, y: 0, length: 2.54, orientation: 'left', electricalType: 'input', free: true },
    { id: 'RICH.3', name: 'NC', number: '3', x: 0, y: -5.08, length: 2.54, orientation: 'up', electricalType: 'no_connect' },
  ],
  graphics: [{ type: 'rect', x: -2.54, y: -2.54, w: 5.08, h: 5.08, width: 0.254 }],
};

const RICH_SHEET_TSTAMPS = '/5384e408-8f0c-411c-b558-df35c2e889ec/';

export function richAttributesProject() {
  const project = createProject('富属性工程', {
    kicad: {
      source: 'C:\\workspace\\kicad\\demos\\tiny_tapeout\\tinytapeout-demo.kicad_sch',
      tool: 'Eeschema 9.0.8',
      date: '2026-11-19T10:25:58+0800',
      version: 'E',
      libraries: [
        {
          logical: 'TinyTapeout',
          uri: 'C:\\workspace\\kicad\\tinytapeout-kicad-libs\\symbols\\TinyTapeout.kicad_sym',
        },
      ],
    },
    netClassAssignments: {
      GND: 'pwr',
      MID: 'ioout',
      VCC: 'pwr',
      SBU1: 'iobidir',
      'mio[36]/ctrl': 'config',
    },
  });

  const root = project.sheets[0];
  root.kicad = { number: '1', name: '/', tstamps: '/' };
  root.title.source = 'tinytapeout-demo.kicad_sch';
  root.title.comments = [
    'See LICENSE.txt for details',
    'Licensed under Apache 2.0',
    '(C) 2023 Pat Deegan',
    '',
    '',
    '',
    '',
    '',
    '',
  ];
  root.symbols.push(
    createSymbolInstance({ symbolId: 'VCC', designator: '#PWR01', value: 'VCC', x: 0, y: 0 }),
    createSymbolInstance({
      symbolId: 'R',
      designator: 'R1',
      value: '10k',
      x: 0,
      y: 5.08,
      rotation: 90,
      footprintId: 'R_0805',
      kicad: {
        datasheet: '~',
        description: 'Resistor, small symbol',
        tstamps: '00db537f-1037-4fb6-9d9b-01d9f1f6a64d',
        libsource: { lib: 'TinyTapeout', part: 'R_Small', description: 'Resistor, small symbol' },
        properties: [
          { name: 'MPN', value: 'RC0603FR-0710KL' },
          { name: 'dnp' },
          { name: 'JLC', value: '' },
        ],
        fields: [
          { name: 'Footprint', value: 'R_0805' },
          { name: 'Datasheet', value: '~' },
          { name: 'Description', value: 'Resistor, small symbol' },
        ],
        sheetpath: { names: '/', tstamps: '/' },
      },
    }),
    createSymbolInstance({ symbolId: 'R', designator: 'R2', value: '10k', x: 0, y: 15.24, rotation: 90, footprintId: 'R_0805' }),
    createSymbolInstance({ symbolId: 'GND', designator: '#PWR02', value: 'GND', x: 0, y: 20.32 }),
  );
  root.labels.push(createLabel({ x: 0, y: 10.16, text: 'MID', kind: 'local' }));

  const sub = createSheet('RP2040', {
    index: 1,
    kicad: { number: '2', name: '/RP2040/', tstamps: RICH_SHEET_TSTAMPS },
    title: {
      title: 'RP2040 Basic Support',
      company: 'Psychogenic Technologies',
      rev: '1.0.3',
      date: '2023-11-22',
      source: 'rp2040.kicad_sch',
      comments: [
        'See LICENSE.txt for details',
        'Licensed under Apache 2.0',
        '(C) 2023 Pat Deegan',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
    },
  });
  project.sheets.push(sub);
  sub.symbols.push(
    createSymbolInstance({
      symbolId: 'RICH',
      designator: 'U1',
      value: 'RICH',
      x: 100,
      y: 0,
      kicad: {
        datasheet: 'https://example.com/u1.pdf',
        description: 'Rich attribute test symbol',
        tstamps: 'f1a2b3c4-0000-4000-8000-000000000001',
        libsource: { lib: 'TinyTapeout', part: 'RICH', description: 'Rich attribute test symbol' },
        properties: [{ name: 'Sheetname', value: 'RP2040' }, { name: 'Sheetfile', value: 'rp2040.kicad_sch' }],
        fields: [{ name: 'Footprint', value: 'Package_SO:SOT-23' }],
        sheetpath: { names: '/RP2040/', tstamps: RICH_SHEET_TSTAMPS },
      },
    }),
  );
  sub.labels.push(
    createLabel({ x: 94.92, y: 0, text: 'SBU1', kind: 'local' }),
    createLabel({ x: 105.08, y: 0, text: 'mio[36]/ctrl', kind: 'local' }),
  );

  const symbols = symbolDefs();
  symbols.push(JSON.parse(JSON.stringify(RICH_SYMBOL)));
  project.library.symbols = symbols;
  return project;
}
