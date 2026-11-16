// 内置封装库：10 个开箱即用的 FootprintDef，含焊盘、丝印与 courtyard 图形。
import { normalizeFootprintDef } from './footprint-library.js';

const SILK = 0.12;
const COURTYARD = 0.05;

/** 焊盘规格（id 由 defineFootprint 统一补全）。 */
function padSpec(number, x, y, w, h, shape = 'rect', layer = 'top', drill = 0) {
  return { number: String(number), x, y, w, h, shape, layer, drill };
}

function silkLine(x1, y1, x2, y2) {
  return { type: 'line', layer: 'silkscreen', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], width: SILK };
}

function silkRect(x, y, w, h) {
  return { type: 'rect', layer: 'silkscreen', x, y, w, h, width: SILK };
}

function silkCircle(cx, cy, r) {
  return { type: 'circle', layer: 'silkscreen', cx, cy, r, width: SILK };
}

function courtyardRect(x, y, w, h) {
  return { type: 'rect', layer: 'courtyard', x, y, w, h, width: COURTYARD };
}

/** 组装封装定义，焊盘 id 使用「封装id-pad编号」保证库内唯一。 */
function defineFootprint(id, name, description, pads, graphics) {
  return {
    id,
    name,
    description,
    pads: pads.map((pad) => ({ ...pad, id: id + '-pad-' + pad.number })),
    graphics,
  };
}

function soic8Pads() {
  const pads = [];
  for (let index = 0; index < 4; index += 1) {
    const y = -1.905 + index * 1.27;
    pads.push(padSpec(index + 1, -2.7, y, 1.5, 0.55, 'roundrect', 'top'));
    pads.push(padSpec(8 - index, 2.7, y, 1.5, 0.55, 'roundrect', 'top'));
  }
  return pads;
}

function dip8Pads() {
  const pads = [];
  for (let index = 0; index < 4; index += 1) {
    const y = -3.81 + index * 2.54;
    pads.push(padSpec(index + 1, -3.81, y, 1.6, 1.6, 'circle', 'tht', 0.8));
    pads.push(padSpec(8 - index, 3.81, y, 1.6, 1.6, 'circle', 'tht', 0.8));
  }
  return pads;
}

function qfp32Pads() {
  const pads = [];
  for (let index = 0; index < 8; index += 1) {
    const offset = -2.8 + index * 0.8;
    pads.push(padSpec(index + 1, -3.75, offset, 1.5, 0.5, 'roundrect', 'top'));
    pads.push(padSpec(index + 9, offset, 3.75, 0.5, 1.5, 'roundrect', 'top'));
    pads.push(padSpec(index + 17, 3.75, -offset, 1.5, 0.5, 'roundrect', 'top'));
    pads.push(padSpec(index + 25, -offset, -3.75, 0.5, 1.5, 'roundrect', 'top'));
  }
  return pads;
}

function headerPads(count) {
  const pads = [];
  for (let index = 0; index < count; index += 1) {
    const y = (index - (count - 1) / 2) * 2.54;
    pads.push(padSpec(index + 1, 0, y, 1.7, 1.7, index === 0 ? 'rect' : 'circle', 'tht', 1));
  }
  return pads;
}

const BUILTIN_FOOTPRINTS = [
  defineFootprint(
    'R_0402',
    'R 0402',
    '0402 贴片电阻（1.0 x 0.5 mm，2 焊盘）',
    [
      padSpec(1, -0.51, 0, 0.54, 0.64, 'roundrect', 'top'),
      padSpec(2, 0.51, 0, 0.54, 0.64, 'roundrect', 'top'),
    ],
    [
      silkLine(-0.25, -0.45, -0.25, 0.45),
      silkLine(0.25, -0.45, 0.25, 0.45),
      courtyardRect(-1.03, -0.57, 2.06, 1.14),
    ],
  ),
  defineFootprint(
    'R_0603',
    'R 0603',
    '0603 贴片电阻（1.6 x 0.8 mm，2 焊盘）',
    [
      padSpec(1, -0.775, 0, 0.8, 0.95, 'roundrect', 'top'),
      padSpec(2, 0.775, 0, 0.8, 0.95, 'roundrect', 'top'),
    ],
    [
      silkLine(-0.35, -0.55, -0.35, 0.55),
      silkLine(0.35, -0.55, 0.35, 0.55),
      courtyardRect(-1.43, -0.73, 2.86, 1.46),
    ],
  ),
  defineFootprint(
    'R_0805',
    'R 0805',
    '0805 贴片电阻（2.0 x 1.25 mm，2 焊盘）',
    [
      padSpec(1, -0.9, 0, 1, 1.4, 'roundrect', 'top'),
      padSpec(2, 0.9, 0, 1, 1.4, 'roundrect', 'top'),
    ],
    [
      silkLine(-0.5, -0.8, -0.5, 0.8),
      silkLine(0.5, -0.8, 0.5, 0.8),
      courtyardRect(-1.65, -0.95, 3.3, 1.9),
    ],
  ),
  defineFootprint(
    'C_0603',
    'C 0603',
    '0603 贴片电容（1.6 x 0.8 mm，2 焊盘）',
    [
      padSpec(1, -0.7, 0, 0.8, 0.9, 'roundrect', 'top'),
      padSpec(2, 0.7, 0, 0.8, 0.9, 'roundrect', 'top'),
    ],
    [
      silkLine(-0.35, -0.55, -0.35, 0.55),
      silkLine(0.35, -0.55, 0.35, 0.55),
      courtyardRect(-1.25, -0.7, 2.5, 1.4),
    ],
  ),
  defineFootprint(
    'SOT-23',
    'SOT-23',
    'SOT-23 三极管（3 焊盘）',
    [
      padSpec(1, -0.95, -1.1, 0.6, 1.1, 'roundrect', 'top'),
      padSpec(2, 0.95, -1.1, 0.6, 1.1, 'roundrect', 'top'),
      padSpec(3, 0, 1.1, 0.6, 1.1, 'roundrect', 'top'),
    ],
    [
      silkRect(-0.75, -1, 1.5, 2),
      silkCircle(-1.5, -1.1, 0.2),
      courtyardRect(-1.55, -1.9, 3.1, 3.8),
    ],
  ),
  defineFootprint(
    'SOIC-8',
    'SOIC-8',
    'SOIC-8 贴片集成电路（8 焊盘，1.27 mm 间距）',
    soic8Pads(),
    [
      silkRect(-1.905, -2.54, 3.81, 5.08),
      silkCircle(-1.4, -2, 0.2),
      courtyardRect(-3.7, -2.9, 7.4, 5.8),
    ],
  ),
  defineFootprint(
    'DIP-8',
    'DIP-8',
    'DIP-8 通孔集成电路（8 焊盘，2.54 mm 间距）',
    dip8Pads(),
    [
      silkRect(-2.54, -5.08, 5.08, 10.16),
      silkCircle(-2.05, -4.5, 0.25),
      courtyardRect(-4.8, -6.1, 9.6, 12.2),
    ],
  ),
  defineFootprint(
    'PIN_HDR_1x2',
    '排针 1x2',
    '2.54 mm 单排 2 脚排针（通孔）',
    headerPads(2),
    [silkRect(-0.85, -2.54, 1.7, 5.08), courtyardRect(-1.25, -2.94, 2.5, 5.88)],
  ),
  defineFootprint(
    'PIN_HDR_1x4',
    '排针 1x4',
    '2.54 mm 单排 4 脚排针（通孔）',
    headerPads(4),
    [silkRect(-0.85, -5.08, 1.7, 10.16), courtyardRect(-1.25, -5.48, 2.5, 10.96)],
  ),
  defineFootprint(
    'QFP-32',
    'QFP-32',
    'QFP-32 方形贴片封装（32 焊盘，0.8 mm 间距，7 x 7 mm 本体）',
    qfp32Pads(),
    [
      silkRect(-3.5, -3.5, 7, 7),
      silkCircle(-2.9, -2.9, 0.25),
      courtyardRect(-4.75, -4.75, 9.5, 9.5),
    ],
  ),
].map(normalizeFootprintDef);

/**
 * 返回全部内置封装定义（每次调用都是独立深拷贝，调用方可安全修改）。
 * @returns {object[]} FootprintDef[]
 */
export function builtinFootprints() {
  return structuredClone(BUILTIN_FOOTPRINTS);
}
