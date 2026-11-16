// 工程持久化：序列化/反序列化、localStorage 草稿与浏览器下载（浏览器 API 仅在函数内运行时检测）。
import { SCHEMA_VERSION, migrateProject, validateProject } from '../core/schema.js';
import { clone, normalizeProject, nowIso } from '../model/project.js';

export const STORAGE_PREFIX = 'schematic-studio:';
export const PROJECT_FILE_MIME = 'application/json;charset=utf-8';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error) {
  if (error && typeof error.message === 'string' && error.message !== '') return error.message;
  return String(error);
}

/**
 * 序列化工程：写入当前 schemaVersion 并刷新 meta.modified。
 * @param {object} project 工程数据
 * @returns {string} 缩进 2 的 JSON 文本
 */
export function serializeProject(project) {
  if (!isPlainObject(project)) throw new TypeError('serializeProject 需要工程对象');
  const next = clone(project);
  next.schemaVersion = SCHEMA_VERSION;
  const previousMeta = isPlainObject(next.meta) ? next.meta : {};
  const modified = nowIso();
  next.meta = { ...previousMeta, modified };
  if (typeof next.meta.created !== 'string' || next.meta.created === '') {
    next.meta.created = modified;
  }
  return JSON.stringify(next, null, 2);
}

/**
 * 解析工程文本：parse -> migrate -> validate；任何异常都转为 warnings，绝不抛出。
 * @param {string} text 工程 JSON 文本
 * @returns {{ project: object|null, warnings: string[] }} 结果
 */
export function deserializeProject(text) {
  if (typeof text !== 'string') {
    return { project: null, warnings: ['工程文本必须是字符串'] };
  }
  const trimmed = text.trim();
  if (trimmed === '') {
    return { project: null, warnings: ['工程文本为空'] };
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { project: null, warnings: ['JSON 解析失败：' + messageOf(error)] };
  }
  if (!isPlainObject(parsed)) {
    return { project: null, warnings: ['工程数据必须是 JSON 对象'] };
  }
  let migrated;
  try {
    migrated = migrateProject(parsed);
  } catch (error) {
    return { project: null, warnings: ['工程版本迁移失败：' + messageOf(error)] };
  }
  const validation = validateProject(migrated);
  if (!validation.ok) {
    return { project: null, warnings: validation.errors.slice() };
  }
  try {
    return { project: normalizeProject(migrated), warnings: [] };
  } catch (error) {
    return { project: null, warnings: ['工程规范化失败：' + messageOf(error)] };
  }
}

/** 规范化草稿 key：统一补齐 schematic-studio: 前缀，避免重复前缀。 */
export function normalizeStorageKey(key) {
  const raw = typeof key === 'string' ? key.trim() : '';
  if (raw === '') return STORAGE_PREFIX + 'draft';
  return raw.startsWith(STORAGE_PREFIX) ? raw : STORAGE_PREFIX + raw;
}

function resolveStorage(options) {
  if (options && options.storage) return options.storage;
  try {
    const storage = globalThis.localStorage;
    return storage && typeof storage.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
}

function resolveDocument(options) {
  if (options && options.document) return options.document;
  try {
    return typeof document === 'undefined' ? null : document;
  } catch {
    return null;
  }
}

/**
 * 保存草稿到 localStorage；无 storage 或写入失败（配额/隐私模式）时返回 false。
 * @param {string} key 草稿 key（自动加前缀）
 * @param {object|string} project 工程或已序列化文本
 * @param {{storage?: object}} [options] 可注入 storage（测试用）
 * @returns {boolean} 是否保存成功
 */
export function saveToLocalStorage(key, project, options = {}) {
  const storage = resolveStorage(options);
  if (!storage) return false;
  try {
    const payload = typeof project === 'string' ? project : serializeProject(project);
    storage.setItem(normalizeStorageKey(key), payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取 localStorage 草稿；不存在、损坏或无 storage 时返回 null。
 * @param {string} key 草稿 key（自动加前缀）
 * @param {{storage?: object}} [options] 可注入 storage（测试用）
 * @returns {object|null} 工程
 */
export function loadFromLocalStorage(key, options = {}) {
  const storage = resolveStorage(options);
  if (!storage) return null;
  try {
    const text = storage.getItem(normalizeStorageKey(key));
    if (typeof text !== 'string' || text === '') return null;
    return deserializeProject(text).project;
  } catch {
    return null;
  }
}

/** 清洗下载文件名中的非法字符。 */
export function sanitizeFileName(name) {
  const raw = typeof name === 'string' ? name.trim() : '';
  const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  return cleaned === '' ? 'download' : cleaned;
}

/**
 * 触发浏览器下载二进制数据；非浏览器环境抛出明确错误。
 * @param {string} name 文件名
 * @param {Blob} blob 数据
 * @param {{document?: object, URL?: object, setTimeout?: Function}} [options]
 * @returns {{ name: string, url: string }} 实际使用的文件名与对象 URL
 */
export function downloadBlob(name, blob, options = {}) {
  const doc = resolveDocument(options);
  if (!doc) throw new Error('downloadBlob 需要浏览器环境（document 不可用）');
  const urlApi = options.URL || globalThis.URL;
  if (!urlApi || typeof urlApi.createObjectURL !== 'function') {
    throw new Error('downloadBlob 需要 URL.createObjectURL 支持');
  }
  const fileName = sanitizeFileName(name);
  const url = urlApi.createObjectURL(blob);
  let anchor = null;
  try {
    anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    if (doc.body && typeof doc.body.appendChild === 'function') doc.body.appendChild(anchor);
    if (typeof anchor.click !== 'function') throw new Error('downloadBlob 无法点击下载链接');
    anchor.click();
  } finally {
    if (anchor && anchor.parentNode && typeof anchor.parentNode.removeChild === 'function') {
      anchor.parentNode.removeChild(anchor);
    }
    const scheduler = options.setTimeout || (typeof setTimeout === 'function' ? setTimeout : null);
    const revoke = () => {
      if (typeof urlApi.revokeObjectURL === 'function') urlApi.revokeObjectURL(url);
    };
    if (scheduler) scheduler(revoke, 0);
    else revoke();
  }
  return { name: fileName, url };
}

/**
 * 以文本形式下载（JSON/SVG/网表等）；非浏览器环境抛出明确错误。
 * @param {string} name 文件名
 * @param {string} text 文本内容
 * @param {string} [mime] MIME 类型
 * @param {{document?: object, URL?: object, Blob?: Function, setTimeout?: Function}} [options]
 * @returns {{ name: string, url: string }}
 */
export function downloadText(name, text, mime = PROJECT_FILE_MIME, options = {}) {
  const doc = resolveDocument(options);
  if (!doc) throw new Error('downloadText 需要浏览器环境（document 不可用）');
  const BlobCtor = options.Blob || globalThis.Blob;
  if (typeof BlobCtor !== 'function') throw new Error('downloadText 需要 Blob 支持');
  const blob = new BlobCtor([String(text === undefined || text === null ? '' : text)], {
    type: mime || 'text/plain;charset=utf-8',
  });
  return downloadBlob(name, blob, { ...options, document: doc });
}
