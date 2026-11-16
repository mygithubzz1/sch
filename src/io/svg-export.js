// SVG 导出入口：解析工程/图纸、汇总各图层并组装完整 SVG（纯函数，不依赖 canvas）。
import { contentBBox } from '../render/bounds.js';
import { createTheme, themeColor } from '../render/theme.js';
import { builtinSymbols } from '../library/builtin-symbols.js';
import {
  escapeXml,
  formatNumber,
  junctionToSvg,
  labelToSvg,
  missingSymbolToSvg,
  symbolToSvg,
  textToSvg,
  titleBlockToSvg,
  wireToSvg,
} from './svg-primitives.js';

export { escapeXml } from './svg-primitives.js';

const DEFAULT_PADDING = 6;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createSymbolResolver(project, options) {
  const map = new Map();
  const add = (def) => {
    if (def && typeof def.id === 'string' && def.id !== '') map.set(def.id, def);
  };
  // 与网表解析顺序一致：内置符号兜底，project.library / options.symbols 覆盖同名定义。
  if (options.useBuiltinSymbols !== false) builtinSymbols().forEach(add);
  const library = project && project.library ? project.library : null;
  if (library && Array.isArray(library.symbols)) library.symbols.forEach(add);
  if (Array.isArray(options.symbols)) options.symbols.forEach(add);
  const optionLibrary = options.library;
  if (optionLibrary) {
    if (Array.isArray(optionLibrary.symbols)) optionLibrary.symbols.forEach(add);
    if (optionLibrary.symbols && typeof optionLibrary.symbols.list === 'function') {
      for (const def of optionLibrary.symbols.list()) add(def);
    }
  }
  const custom = typeof options.symbolResolver === 'function' ? options.symbolResolver : null;
  return (id) => {
    if (custom) {
      const resolved = custom(id);
      if (resolved) return resolved;
    }
    if (map.has(id)) return map.get(id);
    if (optionLibrary && typeof optionLibrary.get === 'function') return optionLibrary.get(id) || null;
    return null;
  };
}

function resolveBounds(sheet, resolveSymbol, options) {
  if (options.bounds && typeof options.bounds === 'object') {
    const box = options.bounds;
    return {
      x: toNumber(box.x),
      y: toNumber(box.y),
      w: Math.max(1, toNumber(box.w, 0)),
      h: Math.max(1, toNumber(box.h, 0)),
    };
  }
  if (options.pageSize && typeof options.pageSize === 'object') {
    return {
      x: 0,
      y: 0,
      w: Math.max(1, toNumber(options.pageSize.w || options.pageSize.width, 297)),
      h: Math.max(1, toNumber(options.pageSize.h || options.pageSize.height, 210)),
    };
  }
  return contentBBox(sheet, {
    resolveSymbol,
    padding: toNumber(options.padding, DEFAULT_PADDING),
  });
}

/**
 * 把一张图纸导出为独立 SVG 字符串（含 viewBox、背景、符号、导线、结点、标签、文本与标题栏）。
 * @param {object} project 工程
 * @param {object} sheet 图纸；缺省取第一张
 * @param {object} [options] { theme, padding, bounds, pageSize, background, titleBlock,
 *   showPinNames, showPinNumbers, showText, symbols, library, symbolResolver, useBuiltinSymbols }
 *   符号解析顺序：symbolResolver > project.library / options.symbols / options.library > 内置符号库；
 *   传 useBuiltinSymbols:false 可关闭内置库兜底（用于严格校验工程自带库）。
 * @returns {string} SVG 文本
 */
export function projectToSVG(project, sheet, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const safeProject = project && typeof project === 'object' ? project : { name: '未命名工程', sheets: [] };
  const sheets = Array.isArray(safeProject.sheets) ? safeProject.sheets : [];
  const targetSheet = sheet && typeof sheet === 'object' ? sheet : sheets[0] || null;
  const theme = createTheme(opts.theme);
  const family = themeColor(theme, 'fontFamily');
  const resolveSymbol = createSymbolResolver(safeProject, opts);
  const box = resolveBounds(targetSheet, resolveSymbol, opts);
  const projectName = safeProject.name || '未命名工程';
  const sheetName = targetSheet && targetSheet.name ? targetSheet.name : '图纸';
  const label = projectName + ' / ' + sheetName;

  const symbols = (targetSheet && Array.isArray(targetSheet.symbols) ? targetSheet.symbols : [])
    .map((instance) => {
      if (!instance) return '';
      const def = resolveSymbol(instance.symbolId);
      return def ? symbolToSvg(def, instance, theme, opts, family) : missingSymbolToSvg(instance, theme, family);
    })
    .join('');
  const wires = (targetSheet && Array.isArray(targetSheet.wires) ? targetSheet.wires : [])
    .map((wire) => wireToSvg(wire, theme))
    .join('');
  const junctions = (targetSheet && Array.isArray(targetSheet.junctions) ? targetSheet.junctions : [])
    .map((junction) => junctionToSvg(junction, theme))
    .join('');
  const labels = (targetSheet && Array.isArray(targetSheet.labels) ? targetSheet.labels : [])
    .map((item) => labelToSvg(item, theme, family))
    .join('');
  const texts = (targetSheet && Array.isArray(targetSheet.texts) ? targetSheet.texts : [])
    .map((item) => textToSvg(item, theme, family))
    .join('');

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + formatNumber(box.w) + 'mm" height="' +
    formatNumber(box.h) + 'mm" viewBox="' + formatNumber(box.x) + ' ' + formatNumber(box.y) + ' ' +
    formatNumber(box.w) + ' ' + formatNumber(box.h) + '" role="img" aria-label="' +
    escapeXml(label) + '">',
  );
  lines.push('<title>' + escapeXml(label) + '</title>');
  if (opts.background !== false) {
    lines.push(
      '<rect id="background" x="' + formatNumber(box.x) + '" y="' + formatNumber(box.y) +
      '" width="' + formatNumber(box.w) + '" height="' + formatNumber(box.h) + '" fill="' +
      escapeXml(themeColor(theme, 'background')) + '"/>',
    );
  }
  lines.push('<g id="symbols">' + symbols + '</g>');
  lines.push('<g id="wires">' + wires + '</g>');
  lines.push('<g id="junctions">' + junctions + '</g>');
  lines.push('<g id="labels">' + labels + '</g>');
  lines.push('<g id="texts">' + texts + '</g>');
  const titleBlock = titleBlockToSvg(safeProject, targetSheet, box, theme, family, opts);
  if (titleBlock) lines.push(titleBlock);
  lines.push('</svg>');
  lines.push('');
  return lines.join('\n');
}
