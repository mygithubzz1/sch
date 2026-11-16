// 内置符号库：18 个开箱即用的 SymbolDef，坐标以 2.54mm 栅格为准（引脚连接端点落在栅格上）。
import { normalizeSymbolDef } from './symbol-library.js';

const STROKE = 0.254;

/** 创建引脚；orientation 表示从连接端点 (x, y) 朝符号本体延伸的方向。 */
function makePin(symbolId, number, name, x, y, orientation, electricalType = 'passive', length = 2.54) {
  return { id: symbolId + '-pin-' + number, name, number, x, y, length, orientation, electricalType };
}

function line(x1, y1, x2, y2) {
  return { type: 'line', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], width: STROKE };
}

function poly(points, fill) {
  const graphic = { type: 'polyline', points: points.map(([x, y]) => ({ x, y })), width: STROKE };
  if (fill) graphic.fill = fill;
  return graphic;
}

function rect(x, y, w, h, fill) {
  const graphic = { type: 'rect', x, y, w, h, width: STROKE };
  if (fill) graphic.fill = fill;
  return graphic;
}

function circle(cx, cy, r) {
  return { type: 'circle', cx, cy, r, width: STROKE };
}

function arc(cx, cy, r, start, end) {
  return { type: 'arc', cx, cy, r, start, end, width: STROKE };
}

function text(x, y, value, size = 1.27, rotation = 0) {
  return { type: 'text', x, y, text: value, size, rotation };
}

/** 带箭羽的箭头（3 条 line），用于 LED 等发光/方向标记。 */
function arrow(x1, y1, x2, y2, head = 0.762) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const baseX = x2 - ux * head;
  const baseY = y2 - uy * head;
  return [
    line(x1, y1, x2, y2),
    line(x2, y2, baseX + px * head * 0.55, baseY + py * head * 0.55),
    line(x2, y2, baseX - px * head * 0.55, baseY - py * head * 0.55),
  ];
}

/** 三角箭头（闭合折线），沿 (x1,y1)->(x2,y2) 方向在 at 比例处绘制，用于三极管发射极。 */
function arrowHead(x1, y1, x2, y2, at = 0.62, size = 0.889) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const cx = x1 + dx * at;
  const cy = y1 + dy * at;
  const tipX = cx + ux * size * 0.6;
  const tipY = cy + uy * size * 0.6;
  const baseX = cx - ux * size * 0.4;
  const baseY = cy - uy * size * 0.4;
  return poly(
    [
      [tipX, tipY],
      [baseX + px * size * 0.5, baseY + py * size * 0.5],
      [baseX - px * size * 0.5, baseY - py * size * 0.5],
      [tipX, tipY],
    ],
  );
}

const BUILTIN_SYMBOLS = [
  {
    id: 'R',
    name: '电阻',
    refPrefix: 'R',
    description: '无极性电阻（矩形符号）',
    power: false,
    pins: [makePin('R', '1', '', 0, -5.08, 'down'), makePin('R', '2', '', 0, 5.08, 'up')],
    graphics: [rect(-1.27, -2.54, 2.54, 5.08, true)],
  },
  {
    id: 'C',
    name: '电容',
    refPrefix: 'C',
    description: '无极性电容',
    power: false,
    pins: [makePin('C', '1', '', 0, -5.08, 'down'), makePin('C', '2', '', 0, 5.08, 'up')],
    graphics: [line(-1.905, -2.54, 1.905, -2.54), line(-1.905, 2.54, 1.905, 2.54)],
  },
  {
    id: 'C_POL',
    name: '极性电容',
    refPrefix: 'C',
    description: '电解电容（带正极标记）',
    power: false,
    pins: [makePin('C_POL', '1', '+', 0, -5.08, 'down'), makePin('C_POL', '2', '-', 0, 5.08, 'up')],
    graphics: [
      line(-1.905, -2.54, 1.905, -2.54),
      arc(0, 2.54, 1.905, 0, 180),
      text(-3.175, -3.175, '+', 1.524),
    ],
  },
  {
    id: 'L',
    name: '电感',
    refPrefix: 'L',
    description: '电感线圈（4 段半圆）',
    power: false,
    pins: [makePin('L', '1', '', 0, -5.08, 'down'), makePin('L', '2', '', 0, 5.08, 'up')],
    graphics: [
      arc(0, -1.905, 0.635, -90, 90),
      arc(0, -0.635, 0.635, -90, 90),
      arc(0, 0.635, 0.635, -90, 90),
      arc(0, 1.905, 0.635, -90, 90),
    ],
  },
  {
    id: 'D',
    name: '二极管',
    refPrefix: 'D',
    description: '二极管（三角形 + 阴极横线），阳极在左',
    power: false,
    pins: [
      makePin('D', '1', 'A', -5.08, 0, 'right', 'passive', 3.81),
      makePin('D', '2', 'K', 5.08, 0, 'left', 'passive', 3.81),
    ],
    graphics: [
      poly([[-1.27, -1.27], [-1.27, 1.27], [1.27, 0], [-1.27, -1.27]], true),
      line(1.27, -1.27, 1.27, 1.27),
    ],
  },
  {
    id: 'LED',
    name: '发光二极管',
    refPrefix: 'D',
    description: '发光二极管（二极管 + 两支发光箭头）',
    power: false,
    pins: [
      makePin('LED', '1', 'A', -5.08, 0, 'right', 'passive', 3.81),
      makePin('LED', '2', 'K', 5.08, 0, 'left', 'passive', 3.81),
    ],
    graphics: [
      poly([[-1.27, -1.27], [-1.27, 1.27], [1.27, 0], [-1.27, -1.27]], true),
      line(1.27, -1.27, 1.27, 1.27),
      ...arrow(0, -2.54, 1.27, -3.81),
      ...arrow(-1.27, -2.54, 0, -3.81),
    ],
  },
  {
    id: 'NPN',
    name: 'NPN 晶体管',
    refPrefix: 'Q',
    description: 'NPN 双极型晶体管，发射极箭头朝外',
    power: false,
    pins: [
      makePin('NPN', '1', 'E', 2.54, 5.08, 'up'),
      makePin('NPN', '2', 'B', -5.08, 0, 'right'),
      makePin('NPN', '3', 'C', 2.54, -5.08, 'down'),
    ],
    graphics: [
      line(-2.54, -2.54, -2.54, 2.54),
      line(-2.54, -1.27, 2.54, -2.54),
      line(-2.54, 1.27, 2.54, 2.54),
      arrowHead(-2.54, 1.27, 2.54, 2.54),
    ],
  },
  {
    id: 'PNP',
    name: 'PNP 晶体管',
    refPrefix: 'Q',
    description: 'PNP 双极型晶体管，发射极箭头朝内',
    power: false,
    pins: [
      makePin('PNP', '1', 'E', 2.54, 5.08, 'up'),
      makePin('PNP', '2', 'B', -5.08, 0, 'right'),
      makePin('PNP', '3', 'C', 2.54, -5.08, 'down'),
    ],
    graphics: [
      line(-2.54, -2.54, -2.54, 2.54),
      line(-2.54, -1.27, 2.54, -2.54),
      line(-2.54, 1.27, 2.54, 2.54),
      arrowHead(2.54, 2.54, -2.54, 1.27),
    ],
  },
  {
    id: 'GND',
    name: 'GND',
    refPrefix: '#PWR',
    description: '地（电源符号，引脚名为网络名）',
    power: true,
    pins: [makePin('GND', '1', 'GND', 0, 0, 'down', 'power_in', 0)],
    graphics: [
      line(0, 0, 0, 1.27),
      line(-1.27, 1.27, 1.27, 1.27),
      line(-0.762, 1.905, 0.762, 1.905),
      line(-0.254, 2.54, 0.254, 2.54),
    ],
  },
  {
    id: 'VCC',
    name: 'VCC',
    refPrefix: '#PWR',
    description: '电源正极（电源符号，引脚名为网络名）',
    power: true,
    pins: [makePin('VCC', '1', 'VCC', 0, 0, 'up', 'power_out', 0)],
    graphics: [line(0, 0, 0, -1.27), poly([[-1.27, -1.27], [0, -2.54], [1.27, -1.27]])],
  },
  {
    id: '+5V',
    name: '+5V',
    refPrefix: '#PWR',
    description: '+5V 电源（电源符号，引脚名为网络名）',
    power: true,
    pins: [makePin('+5V', '1', '+5V', 0, 0, 'up', 'power_out', 0)],
    graphics: [line(0, 0, 0, -1.27), poly([[-1.27, -1.27], [0, -2.54], [1.27, -1.27]])],
  },
  {
    id: 'SW_PUSH',
    name: '按钮开关',
    refPrefix: 'SW',
    description: '常开按钮开关',
    power: false,
    pins: [
      makePin('SW_PUSH', '1', '', -5.08, 0, 'right'),
      makePin('SW_PUSH', '2', '', 5.08, 0, 'left'),
    ],
    graphics: [
      circle(-2.54, 0, 0.508),
      circle(2.54, 0, 0.508),
      line(-1.905, -1.905, 1.905, -1.905),
      line(0, -1.905, 0, -2.54),
    ],
  },
  {
    id: 'XTAL',
    name: '晶体',
    refPrefix: 'Y',
    description: '石英晶体谐振器（两脚）',
    power: false,
    pins: [
      makePin('XTAL', '1', '', -5.08, 0, 'right'),
      makePin('XTAL', '2', '', 5.08, 0, 'left'),
    ],
    graphics: [
      line(-2.54, -2.54, -2.54, 2.54),
      line(2.54, -2.54, 2.54, 2.54),
      rect(-1.27, -1.905, 2.54, 3.81, true),
    ],
  },
  {
    id: 'OPAMP',
    name: '运放',
    refPrefix: 'U',
    description: '单运放（5 个引脚：IN+/IN-/OUT/V+/V-）',
    power: false,
    pins: [
      makePin('OPAMP', '1', 'OUT', 5.08, 0, 'left', 'output'),
      makePin('OPAMP', '2', 'IN-', -5.08, 2.54, 'right', 'input'),
      makePin('OPAMP', '3', 'IN+', -5.08, -2.54, 'right', 'input'),
      makePin('OPAMP', '4', 'V+', 0, -5.08, 'down', 'power_in', 3.175),
      makePin('OPAMP', '8', 'V-', 0, 5.08, 'up', 'power_in', 3.175),
    ],
    graphics: [
      poly([[-2.54, -3.81], [-2.54, 3.81], [2.54, 0], [-2.54, -3.81]], true),
      text(-1.905, -2.54, '+', 1.524),
      text(-1.905, 2.54, '-', 1.524),
    ],
  },
  {
    id: 'IC_8',
    name: 'IC 8 脚',
    refPrefix: 'U',
    description: '8 脚集成电路（左右各 4 脚，逆时针编号）',
    power: false,
    pins: [
      makePin('IC_8', '1', '', -7.62, -5.08, 'right', 'passive', 3.81),
      makePin('IC_8', '2', '', -7.62, -2.54, 'right', 'passive', 3.81),
      makePin('IC_8', '3', '', -7.62, 0, 'right', 'passive', 3.81),
      makePin('IC_8', '4', '', -7.62, 2.54, 'right', 'passive', 3.81),
      makePin('IC_8', '5', '', 7.62, 2.54, 'left', 'passive', 3.81),
      makePin('IC_8', '6', '', 7.62, 0, 'left', 'passive', 3.81),
      makePin('IC_8', '7', '', 7.62, -2.54, 'left', 'passive', 3.81),
      makePin('IC_8', '8', '', 7.62, -5.08, 'left', 'passive', 3.81),
    ],
    graphics: [rect(-3.81, -6.35, 7.62, 10.16, true), circle(-2.921, -5.08, 0.508)],
  },
  {
    id: 'MCU_16',
    name: 'MCU 16 脚',
    refPrefix: 'U',
    description: '16 脚单片机（左右各 8 脚，逆时针编号）',
    power: false,
    pins: [
      makePin('MCU_16', '1', '', -7.62, -10.16, 'right'),
      makePin('MCU_16', '2', '', -7.62, -7.62, 'right'),
      makePin('MCU_16', '3', '', -7.62, -5.08, 'right'),
      makePin('MCU_16', '4', '', -7.62, -2.54, 'right'),
      makePin('MCU_16', '5', '', -7.62, 0, 'right'),
      makePin('MCU_16', '6', '', -7.62, 2.54, 'right'),
      makePin('MCU_16', '7', '', -7.62, 5.08, 'right'),
      makePin('MCU_16', '8', '', -7.62, 7.62, 'right'),
      makePin('MCU_16', '9', '', 7.62, 7.62, 'left'),
      makePin('MCU_16', '10', '', 7.62, 5.08, 'left'),
      makePin('MCU_16', '11', '', 7.62, 2.54, 'left'),
      makePin('MCU_16', '12', '', 7.62, 0, 'left'),
      makePin('MCU_16', '13', '', 7.62, -2.54, 'left'),
      makePin('MCU_16', '14', '', 7.62, -5.08, 'left'),
      makePin('MCU_16', '15', '', 7.62, -7.62, 'left'),
      makePin('MCU_16', '16', '', 7.62, -10.16, 'left'),
    ],
    graphics: [rect(-5.08, -11.43, 10.16, 21.59, true), circle(-3.81, -10.16, 0.635)],
  },
  {
    id: 'CONN_2',
    name: '连接器 2 脚',
    refPrefix: 'J',
    description: '2 脚排针连接器',
    power: false,
    pins: [
      makePin('CONN_2', '1', '', -5.08, -2.54, 'right'),
      makePin('CONN_2', '2', '', -5.08, 2.54, 'right'),
    ],
    graphics: [
      rect(-2.54, -3.81, 2.54, 7.62, true),
      line(-2.54, -2.54, -1.27, -2.54),
      line(-2.54, 2.54, -1.27, 2.54),
    ],
  },
  {
    id: 'CONN_4',
    name: '连接器 4 脚',
    refPrefix: 'J',
    description: '4 脚排针连接器',
    power: false,
    pins: [
      makePin('CONN_4', '1', '', -5.08, -5.08, 'right'),
      makePin('CONN_4', '2', '', -5.08, -2.54, 'right'),
      makePin('CONN_4', '3', '', -5.08, 0, 'right'),
      makePin('CONN_4', '4', '', -5.08, 2.54, 'right'),
    ],
    graphics: [
      rect(-2.54, -6.35, 2.54, 10.16, true),
      line(-2.54, -5.08, -1.27, -5.08),
      line(-2.54, -2.54, -1.27, -2.54),
      line(-2.54, 0, -1.27, 0),
      line(-2.54, 2.54, -1.27, 2.54),
    ],
  },
].map(normalizeSymbolDef);

/**
 * 返回全部内置符号定义（每次调用都是独立深拷贝，调用方可安全修改）。
 * @returns {object[]} SymbolDef[]
 */
export function builtinSymbols() {
  return structuredClone(BUILTIN_SYMBOLS);
}
