// 通用库容器：符号库与封装库共用同一套增删查、检索与 JSON 往返实现。

/** 是否为普通对象（非数组、非 null）。 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 深拷贝纯数据（优先 structuredClone，失败时退化为 JSON 往返）。 */
export function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // 含不可克隆值时退化为 JSON 往返。
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/** 转为有限数字，非法值回退。 */
export function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 转为非负数字，非法值回退。 */
export function toNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/** 转为正数，非正数回退。 */
export function toPositive(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** 转为字符串，非字符串回退。 */
export function toText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

/** 转为数组，非数组返回空数组。 */
export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** 转为编号字符串（引脚号/焊盘号既可能是字符串也可能是数字）。 */
export function toNumberText(value, fallback = '') {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '') return trimmed;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

/**
 * 创建一个按 id 索引的库对象（符号库与封装库同构）。
 * @param {object} options 配置
 * @param {Array} [options.items] 初始条目
 * @param {Function} options.normalize 条目规范化函数，非法条目应抛 TypeError
 * @param {string} options.collection toJSON 中的集合键名（symbols / footprints）
 * @param {string[]} [options.searchFields] 检索参与匹配的字段
 * @returns {object} 库对象
 */
export function createLibrary({ items = [], normalize, collection = 'items', searchFields = ['id', 'name', 'description'] } = {}) {
  if (typeof normalize !== 'function') throw new TypeError('createLibrary 需要 normalize 函数');
  const fields = asArray(searchFields).filter((field) => typeof field === 'string');

  const entries = new Map();

  function add(raw) {
    const def = normalize(raw);
    entries.set(def.id, def);
    return def;
  }

  function addMany(list) {
    for (const item of asArray(list)) add(item);
    return entries.size;
  }

  function remove(id) {
    if (typeof id !== 'string') return false;
    return entries.delete(id);
  }

  function clear() {
    entries.clear();
    return library;
  }

  function get(id) {
    if (typeof id !== 'string') return null;
    const def = entries.get(id);
    return def === undefined ? null : def;
  }

  function has(id) {
    return typeof id === 'string' && entries.has(id);
  }

  function list() {
    return [...entries.values()];
  }

  function search(query) {
    const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (needle === '') return list();
    return list().filter((def) => fields.some((field) => {
      const value = def[field];
      return typeof value === 'string' && value.toLowerCase().includes(needle);
    }));
  }

  function toJSON() {
    return { version: 1, [collection]: list() };
  }

  function fromJSON(json) {
    const source = Array.isArray(json) ? json : isPlainObject(json) ? json[collection] : null;
    if (!Array.isArray(source)) {
      throw new TypeError('库 JSON 必须是数组或包含 ' + collection + ' 数组的对象');
    }
    // 先完整校验到临时表，避免中途失败留下半套数据。
    const next = new Map();
    for (const item of source) {
      const def = normalize(item);
      next.set(def.id, def);
    }
    entries.clear();
    for (const [id, def] of next) entries.set(id, def);
    return library;
  }

  function size() {
    return entries.size;
  }

  function ids() {
    return [...entries.keys()];
  }

  const library = { add, addMany, remove, clear, get, has, list, search, toJSON, fromJSON, size, ids };
  addMany(items);
  return library;
}
