// 符号定义解析：汇总外部符号源、工程内置库与内置符号库，供吸附、命中与放置工具共用。
import { builtinSymbols } from '../library/builtin-symbols.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function addDef(map, def) {
  if (!def || typeof def !== 'object') return;
  const id = typeof def.id === 'string' ? def.id.trim() : '';
  if (id === '' || map.has(id)) return;
  map.set(id, def);
}

function collectFromSource(map, source) {
  if (!source) return;
  if (Array.isArray(source)) {
    for (const def of source) addDef(map, def);
    return;
  }
  if (source instanceof Map) {
    for (const def of source.values()) addDef(map, def);
    return;
  }
  if (typeof source.list === 'function') {
    for (const def of asArray(source.list())) addDef(map, def);
    return;
  }
  if (typeof source === 'object') {
    for (const def of Object.values(source)) addDef(map, def);
  }
}

function buildDefMap(project, options = {}) {
  const map = new Map();
  collectFromSource(map, options.symbols);
  collectFromSource(map, options.symbolLibrary);
  collectFromSource(map, options.symbolMap);
  const projectSymbols = project && project.library ? project.library.symbols : null;
  collectFromSource(map, projectSymbols);
  // 内置库作为兜底：UI 未把内置符号写入 project.library 时编辑器仍可工作。
  collectFromSource(map, builtinSymbols());
  return map;
}

/**
 * 创建符号解析函数 id -> SymbolDef|null。
 * options 支持 symbols / symbolLibrary / symbolMap，可覆盖内置库。
 * resolver.refresh(project) 可在加载新工程后重建索引。
 * @param {object} project 工程数据
 * @param {object} [options] 符号来源
 * @returns {Function} 带 refresh/defs 的解析函数
 */
export function createSymbolResolver(project, options = {}) {
  let map = buildDefMap(project, options);
  const resolver = (symbolId) => {
    const id = typeof symbolId === 'string' ? symbolId : '';
    return map.get(id) || null;
  };
  resolver.refresh = (nextProject) => {
    map = buildDefMap(nextProject, options);
    return resolver;
  };
  resolver.defs = () => Array.from(map.values());
  resolver.has = (symbolId) => map.has(String(symbolId || ''));
  return resolver;
}
