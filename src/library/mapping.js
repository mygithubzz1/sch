// 符号到封装的默认映射：放置符号后由 UI 自动带入封装，未知符号返回 null。
import { asArray } from './create-library.js';

/** 内置符号 id -> 默认封装 id。 */
export const SYMBOL_FOOTPRINT_MAP = Object.freeze({
  R: 'R_0805',
  C: 'C_0603',
  C_POL: 'C_0603',
  L: 'R_0805',
  D: 'R_0805',
  LED: 'R_0805',
  NPN: 'SOT-23',
  PNP: 'SOT-23',
  OPAMP: 'SOIC-8',
  IC_8: 'DIP-8',
  CONN_2: 'PIN_HDR_1x2',
  CONN_4: 'PIN_HDR_1x4',
});

/**
 * 返回符号的默认封装 id；未知符号、空值返回 null（不抛异常）。
 * @param {string} symbolId 符号 id
 * @returns {string|null} 封装 id
 */
export function defaultFootprintFor(symbolId) {
  if (typeof symbolId !== 'string') return null;
  const key = symbolId.trim();
  if (key === '') return null;
  return Object.prototype.hasOwnProperty.call(SYMBOL_FOOTPRINT_MAP, key) ? SYMBOL_FOOTPRINT_MAP[key] : null;
}

/**
 * 按引脚数推荐封装，供「属性检查器」手动选择封装时优先展示。
 * @param {object} symbolDef 符号定义
 * @param {object[]} footprints 封装定义数组
 * @returns {object[]} 焊盘数等于引脚数的封装数组
 */
export function suggestFootprints(symbolDef, footprints = []) {
  const pins = asArray(symbolDef && symbolDef.pins);
  if (pins.length === 0) return [];
  return asArray(footprints).filter((footprint) => asArray(footprint && footprint.pads).length === pins.length);
}
