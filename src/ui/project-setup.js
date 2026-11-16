// 工程装配助手：空工程、内置库注入、导出文件名与封装库文档，均为纯函数。
import { sanitizeFileName } from '../io/project-io.js';
import { clone, createProject, normalizeProject } from '../model/project.js';

export const PROJECT_SUFFIX = '.schproj.json';
export const FOOTPRINT_LIBRARY_FORMAT = 'schematic-studio-footprints';

function libraryList(library, key) {
  if (!library) return [];
  const container = library[key];
  if (container && typeof container.list === 'function') {
    try {
      return container.list();
    } catch {
      return [];
    }
  }
  return Array.isArray(container) ? container : [];
}

/**
 * 把内置符号/封装合并进工程库（按 id 去重，工程自有定义优先）。
 * @param {object} project 工程
 * @param {{symbols?: object, footprints?: object}} [libraries] createDefaultLibraries() 结果
 * @returns {object} 新工程（不修改入参）
 */
export function applyDefaultLibraries(project, libraries) {
  const normalized = normalizeProject(project);
  const symbols = Array.isArray(normalized.library.symbols) ? normalized.library.symbols.slice() : [];
  const footprints = Array.isArray(normalized.library.footprints) ? normalized.library.footprints.slice() : [];
  const symbolIds = new Set(symbols.filter(Boolean).map((item) => item.id));
  const footprintIds = new Set(footprints.filter(Boolean).map((item) => item.id));
  for (const def of libraryList(libraries, 'symbols')) {
    if (!def || typeof def.id !== 'string' || symbolIds.has(def.id)) continue;
    symbols.push(clone(def));
    symbolIds.add(def.id);
  }
  for (const def of libraryList(libraries, 'footprints')) {
    if (!def || typeof def.id !== 'string' || footprintIds.has(def.id)) continue;
    footprints.push(clone(def));
    footprintIds.add(def.id);
  }
  normalized.library = { symbols, footprints };
  return normalized;
}

/**
 * 创建可直接编辑的空原理图（含内置库）。
 * @param {{name?: string, libraries?: object}} [options] 工程名与库容器
 * @returns {object} 新工程
 */
export function createInitialProject(options = {}) {
  const name = typeof options.name === 'string' && options.name.trim() !== '' ? options.name.trim() : '未命名工程';
  return applyDefaultLibraries(createProject(name), options.libraries);
}

/** 安全文件名（不含扩展名）。 */
export function projectBaseName(project) {
  const raw = project && typeof project.name === 'string' ? project.name : '';
  return sanitizeFileName(raw.trim() === '' ? '未命名工程' : raw.trim());
}

/** 工程下载文件名。 */
export function projectFileName(project, suffix = PROJECT_SUFFIX) {
  return projectBaseName(project) + suffix;
}

/** 网表/图片等导出文件名：工程名 + 图纸名 + 扩展名。 */
export function exportFileName(project, sheetName, extension) {
  const sheet = typeof sheetName === 'string' && sheetName.trim() !== '' ? '-' + sheetName.trim() : '';
  const ext = typeof extension === 'string' && extension !== '' ? extension.replace(/^\./, '') : '';
  return sanitizeFileName(projectBaseName(project) + sheet + (ext ? '.' + ext : ''));
}

/** 封装库导出文档（JSON 字符串，缩进 2，带格式标识）。 */
export function footprintLibraryDocument(footprints) {
  const list = (Array.isArray(footprints) ? footprints : []).filter((item) => item && typeof item.id === 'string');
  const document = {
    format: FOOTPRINT_LIBRARY_FORMAT,
    version: 1,
    generator: 'schematic-studio',
    footprints: list.map((item) => clone(item)),
  };
  return JSON.stringify(document, null, 2) + '\n';
}
