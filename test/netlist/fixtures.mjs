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

/** 内置测试符号定义（每次返回新副本，避免用例间共享可变对象）。 */
export function symbolDefs() {
  return [RESISTOR, LED, GND, VCC, FIVE_VOLT].map((def) => JSON.parse(JSON.stringify(def)));
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
