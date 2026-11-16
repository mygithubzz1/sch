// 连通性分析：用并查集把引脚、导线、结点与标签聚合成网络，并按电源 > 全局标签 > 局部标签 > N$n 的优先级命名。
import { dist, segmentDistance, transformPoint } from '../core/geometry.js';

export const CONNECTIVITY_TOLERANCE = 1e-6;

const AUTO_NET_PREFIX = 'N$';
const POWER_ELECTRICAL_TYPES = Object.freeze(['power_in', 'power_out']);
const BUILTIN_SYMBOL_CANDIDATES = Object.freeze([
  '../library/builtin-symbols.js',
  '../../library/builtin-symbols.js',
]);

function toFinite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function copyPoint(point) {
  return { x: point.x, y: point.y };
}

function normalizePoint(raw) {
  if (!raw || !Number.isFinite(Number(raw.x)) || !Number.isFinite(Number(raw.y))) return null;
  return { x: Number(raw.x), y: Number(raw.y) };
}

function uniqueInOrder(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '' || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

/** 读取位号：优先 designator 字段，其次 fields.designator，最后占位的 'U?'。 */
function designatorOf(instance) {
  const direct = instance && typeof instance.designator === 'string' ? instance.designator.trim() : '';
  if (direct !== '') return direct;
  const fields = instance && instance.fields && typeof instance.fields === 'object' ? instance.fields : null;
  const fromFields = fields && typeof fields.designator === 'string' ? fields.designator.trim() : '';
  return fromFields !== '' ? fromFields : 'U?';
}

function electricalTypeOf(pin) {
  return pin && typeof pin.electricalType === 'string' && pin.electricalType !== ''
    ? pin.electricalType
    : 'passive';
}

/** 电源符号（power:true）的 power_in / power_out 引脚，其引脚名即全局网络名。 */
function powerNameOf(symbolDef, pin) {
  if (!symbolDef || symbolDef.power !== true) return null;
  if (!POWER_ELECTRICAL_TYPES.includes(electricalTypeOf(pin))) return null;
  const name = pin && typeof pin.name === 'string' ? pin.name.trim() : '';
  return name === '' ? null : name;
}

/** 最小并查集：add 返回新结点，find 带路径压缩，groups 返回 root -> 成员列表。 */
function createUnionFind() {
  const parent = [];
  const rank = [];

  function add() {
    parent.push(parent.length);
    rank.push(0);
    return parent.length - 1;
  }

  function find(node) {
    let root = node;
    while (parent[root] !== root) root = parent[root];
    let cursor = node;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  function union(first, second) {
    const rootA = find(first);
    const rootB = find(second);
    if (rootA === rootB) return rootA;
    if (rank[rootA] < rank[rootB]) {
      parent[rootA] = rootB;
      return rootB;
    }
    if (rank[rootA] > rank[rootB]) {
      parent[rootB] = rootA;
      return rootA;
    }
    parent[rootB] = rootA;
    rank[rootA] += 1;
    return rootA;
  }

  function groups() {
    const map = new Map();
    for (let node = 0; node < parent.length; node += 1) {
      const root = find(node);
      if (!map.has(root)) map.set(root, []);
      map.get(root).push(node);
    }
    return map;
  }

  return { add, find, union, groups, size: () => parent.length };
}

/**
 * 坐标点索引：容差网格分桶，用于「重合点」的近似查询。
 * 单元尺寸等于容差，查询时检查相邻 8 个单元（floor 分桶保证容差内点最多跨 1 个单元）。
 */
function createPointIndex(tolerance) {
  const cells = new Map();
  const cellOf = (value) => Math.floor(value / tolerance);

  function insert(point, node) {
    const key = cellOf(point.x) + '|' + cellOf(point.y);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ point: copyPoint(point), node });
  }

  function near(point) {
    const cx = cellOf(point.x);
    const cy = cellOf(point.y);
    const hits = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = cells.get(cx + dx + '|' + (cy + dy));
        if (bucket) hits.push(...bucket);
      }
    }
    return hits;
  }

  return { insert, near };
}

function boxOfPoints(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

/** 点是否落在导线（折线）上：先做包围盒预筛，再逐段求距离。 */
function pointNearWire(point, wireEntry, tolerance) {
  const box = wireEntry.box;
  if (
    point.x < box.minX - tolerance ||
    point.x > box.maxX + tolerance ||
    point.y < box.minY - tolerance ||
    point.y > box.maxY + tolerance
  ) {
    return false;
  }
  for (const segment of wireEntry.segments) {
    if (segmentDistance(point, segment.a, segment.b) <= tolerance) return true;
  }
  return false;
}

function addSymbolDef(map, def) {
  if (!def || typeof def !== 'object') return;
  const id = typeof def.id === 'string' ? def.id : '';
  if (id === '' || map.has(id)) return;
  if (!Array.isArray(def.pins)) return;
  map.set(id, def);
}

/**
 * 收集可用的符号定义：options.symbols > options.symbolLibrary > project.library.symbols > 内置符号库。
 * @param {object} project 工程数据（可为 null）
 * @param {object} options 可注入的符号来源
 * @returns {Map<string, object>} id -> SymbolDef
 */
export function resolveSymbolMap(project, options = {}) {
  const map = new Map();
  const external = [options.symbols, options.symbolLibrary];
  for (const source of external) {
    if (!source) continue;
    if (Array.isArray(source)) {
      source.forEach((def) => addSymbolDef(map, def));
    } else if (source instanceof Map) {
      for (const def of source.values()) addSymbolDef(map, def);
    } else if (typeof source.list === 'function') {
      for (const def of asArray(source.list())) addSymbolDef(map, def);
    } else if (typeof source === 'object') {
      for (const def of Object.values(source)) addSymbolDef(map, def);
    }
  }
  const projectSymbols = project && project.library ? project.library.symbols : null;
  asArray(projectSymbols).forEach((def) => addSymbolDef(map, def));
  asArray(BUILTIN_SYMBOLS).forEach((def) => addSymbolDef(map, def));
  return map;
}

function createResolver(project, options) {
  const map = options.symbolMap instanceof Map ? options.symbolMap : resolveSymbolMap(project, options);
  const extra = typeof options.symbolLookup === 'function' ? options.symbolLookup : null;
  return (symbolId) => {
    const key = typeof symbolId === 'string' ? symbolId : '';
    const def = map.get(key);
    if (def) return def;
    if (!extra) return null;
    return extra(key) || null;
  };
}

/** 名称比较：按数字段自然排序，保证不同环境下的稳定顺序。 */
export function naturalCompare(left, right) {
  const a = left === undefined || left === null ? '' : String(left);
  const b = right === undefined || right === null ? '' : String(right);
  if (a === b) return 0;
  const pattern = /(\d+|\D+)/g;
  const partsA = a.match(pattern) || [];
  const partsB = b.match(pattern) || [];
  const total = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < total; index += 1) {
    const partA = partsA[index];
    const partB = partsB[index];
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;
    const numericA = /^\d+$/.test(partA);
    const numericB = /^\d+$/.test(partB);
    if (numericA && numericB) {
      const diff = Number(partA) - Number(partB);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      continue;
    }
    if (numericA !== numericB) return numericA ? -1 : 1;
    if (partA !== partB) return partA < partB ? -1 : 1;
  }
  return a < b ? -1 : 1;
}

function claimUniqueName(base, used) {
  const text = typeof base === 'string' ? base.trim() : '';
  if (text === '') return null;
  let name = text;
  let suffix = 1;
  while (used.has(name)) {
    suffix += 1;
    if (suffix > 999) return null;
    name = text + '_' + suffix;
  }
  used.add(name);
  return name;
}

function collectNetNameCandidates(net) {
  const powerNames = uniqueInOrder(net.powerNames);
  const globalNames = uniqueInOrder(
    net.labels.filter((label) => label.kind === 'global').map((label) => label.text),
  );
  const localNames = uniqueInOrder(
    net.labels.filter((label) => label.kind !== 'global').map((label) => label.text),
  );
  const candidates = [];
  if (powerNames.length > 0) candidates.push({ source: 'power', name: powerNames[0], label: '电源名' });
  if (globalNames.length > 0) candidates.push({ source: 'global', name: globalNames[0], label: '全局标签' });
  if (localNames.length > 0) candidates.push({ source: 'local', name: localNames[0], label: '局部标签' });
  return { candidates, powerNames, globalNames, localNames };
}

/** 按优先级给网络命名；自动名 N$n 按网络发现顺序稳定递增，重名标签追加 _2/_3 后缀。 */
function assignNetNames(nets, warnings) {
  const ordered = [...nets].sort((left, right) => left.order - right.order);
  const used = new Set();
  let autoIndex = 0;

  for (const net of ordered) {
    const { candidates, powerNames, globalNames, localNames } = collectNetNameCandidates(net);
    net.name = null;
    net.nameSource = 'auto';
    for (const candidate of candidates) {
      const name = claimUniqueName(candidate.name, used);
      if (name) {
        net.name = name;
        net.nameSource = candidate.source;
        break;
      }
    }
    if (!net.name) {
      let name = '';
      do {
        autoIndex += 1;
        name = AUTO_NET_PREFIX + autoIndex;
      } while (used.has(name));
      used.add(name);
      net.name = name;
    }

    const groups = [
      { names: powerNames, label: '电源名' },
      { names: globalNames, label: '全局标签' },
      { names: localNames, label: '局部标签' },
    ];
    for (const group of groups) {
      if (group.names.length <= 1) continue;
      warnings.push({
        code: 'NET_NAME_CONFLICT',
        message: '同一网络存在多个' + group.label + '：' + group.names.join('、') + '（采用 ' + net.name + '）',
        ref: {
          sheetId: asArray(net.sheetIds)[0] || null,
          netName: net.name,
          names: group.names.slice(),
        },
      });
    }
  }
}

/**
 * 把明细网络转换为契约净结构 { name, pins:[{designator,pinNumber,pinName,symbolId,instanceId,sheetId}] }。
 * @param {object} net 明细网络
 * @returns {{ name: string, pins: object[] }}
 */
export function netToContract(net) {
  const pins = [...net.pins]
    .sort(
      (left, right) =>
        naturalCompare(left.designator, right.designator) ||
        naturalCompare(left.pinNumber, right.pinNumber),
    )
    .map((pin) => ({
      designator: pin.designator,
      pinNumber: pin.pinNumber,
      pinName: pin.pinName,
      symbolId: pin.symbolId,
      instanceId: pin.instanceId,
      sheetId: pin.sheetId,
    }));
  return { name: net.name, pins };
}

/**
 * 单张图纸的连通性分析，保留导线/结点/标签等明细供 ERC 与导出器使用。
 * @param {object} project 工程数据
 * @param {object} sheet 图纸
 * @param {object} options { tolerance, symbols, symbolMap, symbolLookup, resolveSymbol, sheetIndex }
 * @returns {object} { ok, sheetId, sheetIndex, nets, components, warnings, stats }
 */
export function analyzeSheet(project, sheet, options = {}) {
  const tolerance =
    Number.isFinite(options.tolerance) && options.tolerance > 0 ? options.tolerance : CONNECTIVITY_TOLERANCE;
  const projectSheets = project && Array.isArray(project.sheets) ? project.sheets : [];
  const sheetIndex = Number.isInteger(options.sheetIndex) ? options.sheetIndex : projectSheets.indexOf(sheet);
  const sheetId = sheet && typeof sheet.id === 'string' ? sheet.id : null;
  const warnings = [];

  if (!sheet || typeof sheet !== 'object') {
    return {
      ok: false,
      sheetId,
      sheetIndex,
      nets: [],
      components: [],
      warnings: [{ code: 'INVALID_SHEET', message: '图纸数据缺失，无法建立连通性', ref: { sheetId, sheetIndex } }],
      stats: { symbols: 0, wires: 0, junctions: 0, labels: 0, pins: 0, nets: 0 },
    };
  }

  const resolveSymbol =
    typeof options.resolveSymbol === 'function' ? options.resolveSymbol : createResolver(project, options);

  const uf = createUnionFind();
  const index = createPointIndex(tolerance);
  const conductorPoints = [];
  const pinEntries = [];
  const wireEntries = [];
  const labelEntries = [];
  const junctionEntries = [];
  const pinByNode = new Map();
  const wireByNode = new Map();
  const labelByNode = new Map();
  const components = [];

  for (const instance of asArray(sheet.symbols)) {
    if (!instance || typeof instance !== 'object') continue;
    const designator = designatorOf(instance);
    const def = resolveSymbol(instance.symbolId);
    const component = {
      designator,
      value: typeof instance.value === 'string' ? instance.value : '',
      footprintId: typeof instance.footprintId === 'string' ? instance.footprintId : null,
      symbolId: typeof instance.symbolId === 'string' ? instance.symbolId : '',
      instanceId: typeof instance.id === 'string' ? instance.id : '',
      sheetId,
      x: toFinite(instance.x),
      y: toFinite(instance.y),
      power: Boolean(def && def.power === true),
      resolved: Boolean(def && Array.isArray(def.pins)),
      pins: [],
    };
    components.push(component);

    if (!component.resolved) {
      warnings.push({
        code: 'UNKNOWN_SYMBOL',
        message:
          '找不到符号定义 ' + (component.symbolId || '(空)') + '（位号 ' + designator + '），其引脚未纳入网表',
        ref: { sheetId, designator, instanceId: component.instanceId, symbolId: component.symbolId },
      });
      continue;
    }

    for (const pin of def.pins) {
      if (!pin || typeof pin !== 'object') continue;
      const type = electricalTypeOf(pin);
      const pinNumber = pin.number === undefined || pin.number === null ? '' : String(pin.number);
      const pinName = typeof pin.name === 'string' ? pin.name : '';
      component.pins.push({ number: pinNumber, name: pinName, electricalType: type });
      if (type === 'not_connected') continue;

      const point = transformPoint(
        { x: toFinite(pin.x), y: toFinite(pin.y) },
        {
          x: toFinite(instance.x),
          y: toFinite(instance.y),
          rotation: toFinite(instance.rotation),
          mirror: instance.mirror === true,
        },
      );
      const powerName = powerNameOf(def, pin);
      const record = {
        designator,
        pinNumber,
        pinName,
        symbolId: component.symbolId,
        instanceId: component.instanceId,
        sheetId,
        electricalType: type,
        power: powerName !== null,
        x: point.x,
        y: point.y,
      };
      const node = uf.add();
      pinEntries.push({ node, record, point, powerName });
      pinByNode.set(node, { record, powerName });
      conductorPoints.push({ node, point });
      index.insert(point, node);
    }
  }

  for (const wire of asArray(sheet.wires)) {
    if (!wire || typeof wire !== 'object') continue;
    const points = asArray(wire.points).map(normalizePoint).filter(Boolean);
    if (points.length < 2) {
      warnings.push({
        code: 'INVALID_WIRE',
        message: '导线至少需要两个有效端点，已忽略',
        ref: { sheetId, wireId: typeof wire.id === 'string' ? wire.id : null },
      });
      continue;
    }
    const node = uf.add();
    const segments = [];
    for (let i = 1; i < points.length; i += 1) segments.push({ a: points[i - 1], b: points[i] });
    const entry = {
      node,
      record: { id: typeof wire.id === 'string' ? wire.id : '', points: points.map(copyPoint), sheetId },
      points,
      segments,
      box: boxOfPoints(points),
    };
    wireEntries.push(entry);
    wireByNode.set(node, entry);
    for (const point of points) {
      conductorPoints.push({ node, point });
      index.insert(point, node);
    }
  }

  for (const label of asArray(sheet.labels)) {
    if (!label || typeof label !== 'object') continue;
    const text = typeof label.text === 'string' ? label.text.trim() : '';
    if (text === '') continue;
    const point = normalizePoint(label);
    if (!point) continue;
    const kind = label.kind === 'global' ? 'global' : 'local';
    const node = uf.add();
    const record = {
      id: typeof label.id === 'string' ? label.id : '',
      text,
      kind,
      x: point.x,
      y: point.y,
      sheetId,
    };
    labelEntries.push({ node, record, point });
    labelByNode.set(node, { record });
    conductorPoints.push({ node, point });
    index.insert(point, node);
  }

  for (const junction of asArray(sheet.junctions)) {
    if (!junction || typeof junction !== 'object') continue;
    const point = normalizePoint(junction);
    if (!point) continue;
    junctionEntries.push({
      point,
      record: { id: typeof junction.id === 'string' ? junction.id : '', x: point.x, y: point.y, sheetId },
      node: null,
    });
  }

  // 1) 重合的引脚 / 导线端点与折点 / 标签锚点直接相连。
  for (const entry of conductorPoints) {
    for (const hit of index.near(entry.point)) {
      if (dist(hit.point, entry.point) <= tolerance) uf.union(entry.node, hit.node);
    }
  }

  // 2) 引脚或标签落在导线中段（T 形接点）也相连。
  for (const entry of [...pinEntries, ...labelEntries]) {
    for (const wireEntry of wireEntries) {
      if (pointNearWire(entry.point, wireEntry, tolerance)) uf.union(entry.node, wireEntry.node);
    }
  }

  // 3) 导线端点或折点落在另一根导线上：两根导线相连（跨线中段相交不算）。
  for (const wireEntry of wireEntries) {
    for (const other of wireEntries) {
      if (wireEntry === other) continue;
      if (uf.find(wireEntry.node) === uf.find(other.node)) continue;
      if (wireEntry.points.some((point) => pointNearWire(point, other, tolerance))) {
        uf.union(wireEntry.node, other.node);
      }
    }
  }

  // 4) junction：把它接触到的所有导线、引脚、标签合并成同一个网络。
  for (const entry of junctionEntries) {
    const touching = [];
    for (const wireEntry of wireEntries) {
      if (pointNearWire(entry.point, wireEntry, tolerance)) touching.push(wireEntry.node);
    }
    for (const candidate of [...pinEntries, ...labelEntries]) {
      if (dist(candidate.point, entry.point) <= tolerance) touching.push(candidate.node);
    }
    if (touching.length === 0) continue;
    for (let i = 1; i < touching.length; i += 1) uf.union(touching[0], touching[i]);
    entry.node = touching[0];
  }

  // 5) 同名标签相连：局部标签仅本图纸内，全局标签在工程级再合并。
  const labelGroups = new Map();
  for (const entry of labelEntries) {
    const key = entry.record.kind + '\u0000' + entry.record.text;
    if (!labelGroups.has(key)) labelGroups.set(key, entry.node);
    else uf.union(labelGroups.get(key), entry.node);
  }

  // 6) 电源符号引脚按引脚名全局相连。
  const powerGroups = new Map();
  for (const entry of pinEntries) {
    if (!entry.powerName) continue;
    if (!powerGroups.has(entry.powerName)) powerGroups.set(entry.powerName, entry.node);
    else uf.union(powerGroups.get(entry.powerName), entry.node);
  }

  const groups = uf.groups();
  const nets = [];
  const netByRoot = new Map();
  for (const [root, nodes] of groups) {
    let order = Infinity;
    const net = {
      id: '',
      name: null,
      nameSource: 'auto',
      sheetId,
      sheetIds: [],
      sheetIndex,
      order: 0,
      powerNames: [],
      pins: [],
      wires: [],
      junctions: [],
      labels: [],
    };
    for (const node of nodes) {
      order = Math.min(order, node);
      const wireEntry = wireByNode.get(node);
      if (wireEntry) {
        net.wires.push(wireEntry.record);
        continue;
      }
      const pinEntry = pinByNode.get(node);
      if (pinEntry) {
        net.pins.push(pinEntry.record);
        if (pinEntry.powerName) net.powerNames.push(pinEntry.powerName);
        continue;
      }
      const labelEntry = labelByNode.get(node);
      if (labelEntry) net.labels.push(labelEntry.record);
    }
    if (net.pins.length === 0 && net.wires.length === 0 && net.labels.length === 0) continue;
    net.order = order;
    net.sheetIds = sheetId === null ? [] : [sheetId];
    nets.push(net);
    netByRoot.set(root, net);
  }

  for (const entry of junctionEntries) {
    if (entry.node === null) continue;
    const net = netByRoot.get(uf.find(entry.node));
    if (net) net.junctions.push(entry.record);
  }

  assignNetNames(nets, warnings);
  nets.sort((left, right) => naturalCompare(left.name, right.name));
  nets.forEach((net, index) => {
    net.id = 'net-' + (index + 1);
  });

  const stats = {
    symbols: asArray(sheet.symbols).length,
    wires: asArray(sheet.wires).length,
    junctions: asArray(sheet.junctions).length,
    labels: asArray(sheet.labels).length,
    pins: pinEntries.length,
    nets: nets.length,
  };
  return { ok: true, sheetId, sheetIndex, nets, components, warnings, stats };
}

function mergeSheetNet(target, net, sheetIndex) {
  target.pins.push(...net.pins);
  target.wires.push(...net.wires);
  target.junctions.push(...net.junctions);
  target.labels.push(...net.labels);
  target.powerNames.push(...net.powerNames);
  if (net.sheetId && !target.sheetIds.includes(net.sheetId)) target.sheetIds.push(net.sheetId);
  target.order = Math.min(target.order, sheetIndex * 1000000 + net.order);
}

function dedupePins(pins) {
  const seen = new Set();
  return pins.filter((pin) => {
    const key = pin.sheetId + '\u0000' + pin.instanceId + '\u0000' + pin.pinNumber;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 全工程连通性分析：先按图纸独立分析，再用全局标签与电源名跨图纸合并。
 * @param {object} project 工程数据
 * @param {object} options 同 analyzeSheet
 * @returns {object} { ok, nets, components, warnings, stats, sheets }
 */
export function analyzeProject(project, options = {}) {
  const sheets = project && Array.isArray(project.sheets) ? project.sheets : null;
  if (!sheets || sheets.length === 0) {
    return {
      ok: false,
      nets: [],
      components: [],
      warnings: [
        { code: 'INVALID_PROJECT', message: '工程缺少图纸数据，无法生成网表', ref: { sheetId: null } },
      ],
      stats: { sheets: 0, components: 0, symbols: 0, wires: 0, junctions: 0, labels: 0, pins: 0, nets: 0 },
      sheets: [],
    };
  }

  const resolveSymbol =
    typeof options.resolveSymbol === 'function' ? options.resolveSymbol : createResolver(project, options);
  const sheetResults = sheets.map((sheet, sheetIndex) =>
    analyzeSheet(project, sheet, { ...options, sheetIndex, resolveSymbol }),
  );

  const warnings = [];
  const components = [];
  const flatNets = [];
  const stats = {
    sheets: sheets.length,
    components: 0,
    symbols: 0,
    wires: 0,
    junctions: 0,
    labels: 0,
    pins: 0,
    nets: 0,
  };

  sheetResults.forEach((result, sheetIndex) => {
    warnings.push(...result.warnings);
    components.push(...result.components);
    stats.symbols += result.stats.symbols;
    stats.wires += result.stats.wires;
    stats.junctions += result.stats.junctions;
    stats.labels += result.stats.labels;
    stats.pins += result.stats.pins;
    for (const net of result.nets) {
      flatNets.push({ net, sheetIndex });
    }
  });
  stats.components = components.length;

  const uf = createUnionFind();
  const nodes = flatNets.map(() => uf.add());
  const unionByKey = new Map();
  const link = (key, node) => {
    if (!key) return;
    if (unionByKey.has(key)) uf.union(unionByKey.get(key), node);
    else unionByKey.set(key, node);
  };

  flatNets.forEach(({ net }, position) => {
    for (const label of net.labels) {
      if (label.kind === 'global') link('global:' + label.text, nodes[position]);
    }
    for (const name of uniqueInOrder(net.powerNames)) link('power:' + name, nodes[position]);
  });

  const mergedByRoot = new Map();
  flatNets.forEach(({ net, sheetIndex }, position) => {
    const root = uf.find(nodes[position]);
    if (!mergedByRoot.has(root)) {
      mergedByRoot.set(root, {
        id: '',
        name: null,
        nameSource: 'auto',
        sheetIds: [],
        order: Infinity,
        powerNames: [],
        pins: [],
        wires: [],
        junctions: [],
        labels: [],
        sheetIndex,
      });
    }
    mergeSheetNet(mergedByRoot.get(root), net, sheetIndex);
  });

  const nets = [...mergedByRoot.values()];
  for (const net of nets) net.pins = dedupePins(net.pins);
  assignNetNames(nets, warnings);
  nets.sort((left, right) => naturalCompare(left.name, right.name));
  nets.forEach((net, index) => {
    net.id = 'net-' + (index + 1);
  });
  stats.nets = nets.length;

  return { ok: true, nets, components, warnings, stats, sheets: sheetResults };
}

/**
 * 单张图纸连通性（契约接口）。
 * @param {object} project 工程数据
 * @param {object} sheet 图纸
 * @param {object} options 同 analyzeSheet
 * @returns {{ nets: object[], warnings: object[] }}
 */
export function buildConnectivity(project, sheet, options = {}) {
  const result = analyzeSheet(project, sheet, options);
  return {
    nets: result.nets.filter((net) => net.pins.length > 0).map(netToContract),
    warnings: result.warnings,
  };
}

/**
 * 跨图纸连通性（契约扩展）：global label 与电源名跨 sheet 合并。
 * @param {object} project 工程数据
 * @param {object} options 同 analyzeProject
 * @returns {{ nets: object[], warnings: object[] }}
 */
export function buildProjectConnectivity(project, options = {}) {
  const analysis = analyzeProject(project, options);
  return {
    nets: analysis.nets.filter((net) => net.pins.length > 0).map(netToContract),
    warnings: analysis.warnings,
  };
}

// 可选回退：若 library 层已提供内置符号库则自动加载（缺失时静默跳过，不影响本层独立测试）。
async function loadBuiltinSymbols() {
  for (const specifier of BUILTIN_SYMBOL_CANDIDATES) {
    try {
      const module = await import(specifier);
      const exported =
        typeof module.builtinSymbols === 'function'
          ? module.builtinSymbols()
          : module.builtinSymbols || module.default;
      if (Array.isArray(exported)) return exported;
    } catch {
      // library 层尚未落地或导出名不同：忽略，由调用方通过 options.symbols 注入。
    }
  }
  return null;
}

const BUILTIN_SYMBOLS = await loadBuiltinSymbols();
