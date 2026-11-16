// 元件库门面：聚合符号库、封装库、默认映射与共享常量，供 UI/编辑器一行创建内置库。
import { createSymbolLibrary } from './symbol-library.js';
import { builtinSymbols } from './builtin-symbols.js';
import { createFootprintLibrary } from './footprint-library.js';
import { builtinFootprints } from './builtin-footprints.js';

export {
  createSymbolLibrary,
  normalizeSymbolDef,
  normalizePin,
  validateSymbolDef,
  PIN_ORIENTATIONS,
  PIN_ELECTRICAL_TYPES,
  POWER_PIN_TYPES,
} from './symbol-library.js';
export { builtinSymbols } from './builtin-symbols.js';
export {
  createFootprintLibrary,
  normalizeFootprintDef,
  normalizePad,
  validateFootprintDef,
  PAD_SHAPES,
  PAD_LAYERS,
} from './footprint-library.js';
export { builtinFootprints } from './builtin-footprints.js';
export { defaultFootprintFor, suggestFootprints, SYMBOL_FOOTPRINT_MAP } from './mapping.js';
export { GRAPHIC_TYPES, FOOTPRINT_LAYERS, DEFAULT_STROKE_WIDTH, DEFAULT_TEXT_SIZE } from './graphic.js';

/**
 * 一次创建内置符号库与封装库。
 * @returns {{symbols: object, footprints: object}} 两个库对象
 */
export function createDefaultLibraries() {
  return {
    symbols: createSymbolLibrary(builtinSymbols()),
    footprints: createFootprintLibrary(builtinFootprints()),
  };
}
