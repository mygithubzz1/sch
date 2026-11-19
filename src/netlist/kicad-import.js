// KiCad 网表导入：把 kicad-reader 的结构化文档重建为可编辑工程（库符号、多图纸、网络标签与 net class）。
//
// 重建策略（见 docs/NETLIST_KICAD_SPEC.md §8 与 T4 契约）：
// 1. libpart → library.symbols[*]：引脚按序号纵向分布在矩形本体左侧，类型/名称/不连接标记取自网表；
// 2. comp → 符号实例：按 sheetpath 归入对应图纸，flow 布局，symbol.kicad 保留全部实例元数据；
// 3. 连通性用「每引脚 2.54mm stub 导线 + 同名网络标签」重建：标签同名即在连通性分析中合网，
//    因此 buildNetlist 能重新推导出与源网表一致的引脚集合；
// 4. 网络名先做 {slash}→/ 解码，再按图纸前缀判定 local / global（§5.2、§8.8）：
//    - 单图纸网络且 prefix ≠ "/" 且解码名以 prefix 开头 → 标签文本去掉前缀、kind=local；
//    - 其余（含跨图纸网络）→ 标签文本为解码名本身、kind=global；
//    跨图纸网络必须用 global（否则局域标签不会跨图合并），这是对实测数据的必要细化；
// 5. unconnected-(…) 网络不建标签（导出侧由 T3 合成），对应引脚保持悬空并保留 pintype 修饰；
// 6. net class 写入 project.netClassAssignments（按任务书含 Default），键与模型网络名同口径。
import { validateProject } from '../core/schema.js';
import { PIN_ELECTRICAL_TYPES, normalizeSymbolDef } from '../library/symbol-library.js';
import {
  DEFAULT_GRID,
  createLabel,
  createProject,
  createSheet,
  createSymbolInstance,
  createWire,
  nowIso,
} from '../model/project.js';
import { readKiCadNetlist } from './kicad-reader.js';

/** KiCad 对「未连接引脚」自动合成的网络名前缀（§4.5）。 */
export const UNCONNECTED_NET_PREFIX = 'unconnected-(';

const GRID_STEP = 2.54;
const PIN_LENGTH = 2.54;
const STUB_LENGTH = 2.54;
const BODY_WIDTH = 12.7;
const SYMBOL_CELL_WIDTH = PIN_LENGTH + STUB_LENGTH + BODY_WIDTH + GRID_STEP;
const ROW_WIDTH_LIMIT = 420;
const START_X = 25.4;
const START_Y = -25.4;
const MAX_WARNINGS = 200;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatDiagnostic(item) {
  const line = Number.isInteger(item && item.line) ? item.line : 1;
  const code = toText(item && item.code, 'ERROR');
  const message = toText(item && item.message, '未知错误');
  return '第 ' + line + ' 行 [' + code + '] ' + message;
}

function decodeNetName(name) {
  return toText(name, '').split('{slash}').join('/');
}

/** 网络名前缀判定所需的图纸路径（comp.sheetpath.names，缺省 "/"）。 */
function sheetPathOf(component) {
  if (!isPlainObject(component) || !isPlainObject(component.sheetpath)) return '/';
  return toText(component.sheetpath.names, '/') || '/';
}

function libPartKey(lib, part) {
  return toText(lib, '') + ':' + toText(part, '');
}

function inferRefPrefix(ref) {
  const match = /^([A-Za-z_#]+)/.exec(toText(ref, ''));
  return match ? match[1] : 'U';
}

function projectNameFromSource(source, fallback) {
  const parts = toText(source, '').split(/[\\/]/);
  const file = parts[parts.length - 1] || '';
  const name = file.replace(/\.kicad_sch$/i, '').trim();
  return name || fallback;
}

function displayNameOfSheet(path, index) {
  if (path === '/' || path === '') return 'Root';
  const segments = path.split('/').filter((item) => item !== '');
  return segments.length > 0 ? segments[segments.length - 1] : 'Sheet ' + (index + 1);
}

/** 解析 node@pintype：`base[+no_connect][+free]`（§4.2）。 */
function parsePintype(value) {
  const tokens = toText(value, '').split('+').map((item) => item.trim()).filter(Boolean);
  const base = tokens.length > 0 ? tokens[0] : 'passive';
  const modifiers = new Set(tokens.slice(1));
  return { base, noConnect: modifiers.has('no_connect'), free: modifiers.has('free') };
}

function warn(warnings, code, message) {
  if (warnings.length >= MAX_WARNINGS) return;
  warnings.push({ code, message });
}

/** 符号本体高度：至少容纳 1 个引脚位（0 引脚符号也留出矩形）。 */
function bodyHeightOf(pinCount) {
  return Math.max(pinCount + 1, 2) * GRID_STEP;
}

/** 引脚几何：全部放在本体左侧，连接端点 x = -2.54，方向朝右（指向本体）。 */
function pinGeometry(index) {
  return { x: -PIN_LENGTH, y: -(index + 1) * GRID_STEP, length: PIN_LENGTH, orientation: 'right' };
}

/** 单图纸的 flow 布局：按行排布，行高取该行最高符号，保证符号/引脚/标签互不重叠。 */
function layoutPositions(pinCounts) {
  const positions = [];
  let x = START_X;
  let y = START_Y;
  let rowHeight = 0;
  for (const pinCount of pinCounts) {
    const cellWidth = SYMBOL_CELL_WIDTH;
    const cellHeight = bodyHeightOf(pinCount) + GRID_STEP;
    if (x > START_X && x + cellWidth > START_X + ROW_WIDTH_LIMIT) {
      y -= rowHeight;
      x = START_X;
      rowHeight = 0;
    }
    positions.push({ x, y });
    x += cellWidth;
    rowHeight = Math.max(rowHeight, cellHeight);
  }
  return positions;
}

/** 从 comp.fields 建立旧式 fields 对象（schema 要求 symbol.fields 为对象）。 */
function legacyFieldsOf(component) {
  const fields = {};
  for (const field of asArray(component.fields)) {
    const name = toText(field && field.name, '');
    if (name === '') continue;
    fields[name] = field.value === undefined ? '' : toText(field.value, '');
  }
  return fields;
}

/** 收集某 libpart 的 ki_keywords / ki_fp_filters（取首个非空属性，§8.5）。 */
function harvestProperties(comps) {
  let keywords = '';
  let fpFilters = [];
  for (const component of comps) {
    for (const property of asArray(component.properties)) {
      if (!isPlainObject(property)) continue;
      if (keywords === '' && property.name === 'ki_keywords' && typeof property.value === 'string') {
        keywords = property.value;
      }
      if (fpFilters.length === 0 && property.name === 'ki_fp_filters' && typeof property.value === 'string') {
        fpFilters = property.value
          .split(/\s+/)
          .map((item) => item.trim())
          .filter((item) => item !== '');
      }
    }
  }
  return { keywords, fpFilters };
}

/**
 * 依据 libpart + 节点修饰符生成库符号定义。
 * @param {object} libpart 结构化 libpart
 * @param {object} context { components, modifiers, warnings }
 * @returns {object|null} normalizeSymbolDef 结果
 */
function buildLibrarySymbol(libpart, context) {
  const id = libPartKey(libpart.lib, libpart.part);
  const comps = asArray(context.components).filter(
    (component) => libPartKey(component.libsource.lib, component.libsource.part) === id,
  );
  const reference = asArray(libpart.fields).find((field) => field.name === 'Reference');
  const refPrefix =
    reference && typeof reference.value === 'string' && reference.value.trim() !== ''
      ? reference.value.trim()
      : inferRefPrefix(comps.length > 0 ? comps[0].ref : '');
  const { keywords, fpFilters } = harvestProperties(comps);
  const usedNumbers = new Set();
  const pins = asArray(libpart.pins).map((pin, index) => {
    const number = toText(pin.num, '');
    let pinId = 'pin-' + (number === '' ? String(index + 1) : number);
    if (usedNumbers.has(pinId)) pinId = pinId + '-' + (index + 1);
    usedNumbers.add(pinId);
    const modifier = context.modifiers.get(id + '\u0000' + number) || null;
    const baseType = modifier && modifier.base !== '' ? modifier.base : toText(pin.type, 'passive');
    if (!PIN_ELECTRICAL_TYPES.includes(baseType)) {
      warn(context.warnings, 'UNKNOWN_PIN_TYPE', 'libpart ' + id + ' 引脚 ' + number + ' 电气类型非法：' + baseType);
    }
    const geometry = pinGeometry(index);
    const entry = {
      id: pinId,
      name: toText(pin.name, ''),
      number: number === '' ? String(index + 1) : number,
      x: geometry.x,
      y: geometry.y,
      length: geometry.length,
      orientation: geometry.orientation,
      electricalType: PIN_ELECTRICAL_TYPES.includes(baseType) ? baseType : 'passive',
    };
    if (modifier && modifier.noConnect) entry.noConnect = true;
    if (modifier && modifier.free) entry.free = true;
    return entry;
  });

  const bodyHeight = bodyHeightOf(pins.length);
  const raw = {
    id,
    name: toText(libpart.part, id),
    refPrefix: refPrefix === '' ? 'U' : refPrefix,
    description: toText(libpart.description, ''),
    footprints: asArray(libpart.footprints).slice(),
    keywords,
    fpFilters,
    power: false,
    pins,
    graphics: [
      { type: 'rect', x: 0, y: -bodyHeight, w: BODY_WIDTH, h: bodyHeight, width: 0.254 },
    ],
  };
  if (typeof libpart.docs === 'string') raw.docs = libpart.docs;
  if (asArray(libpart.fields).length > 0) raw.fields = asArray(libpart.fields).slice();
  try {
    return normalizeSymbolDef(raw);
  } catch (error) {
    warn(context.warnings, 'SYMBOL_BUILD_FAILED', '构建库符号 ' + id + ' 失败：' + (error && error.message));
    return null;
  }
}

/** 从结构化文档构建多图纸工程骨架（sheet.kicad / title / comments[9]）。 */
function buildSheets(doc, warnings) {
  const sheets = [];
  const byPath = new Map();
  const usedIds = new Set();
  doc.design.sheets.forEach((sheet, index) => {
    const kicadPath = toText(sheet.name, '/') || '/';
    const number = toText(sheet.number, String(index + 1));
    let id = 'sheet-' + (number === '' ? String(index + 1) : number);
    if (usedIds.has(id)) id = id + '-' + (index + 1);
    usedIds.add(id);
    let name = displayNameOfSheet(kicadPath, index);
    if (sheets.some((item) => item.name === name)) name = name + ' (' + (index + 1) + ')';
    const titleBlock = isPlainObject(sheet.titleBlock) ? sheet.titleBlock : {};
    const sheetObject = createSheet(name, {
      id,
      index,
      kicad: { number, name: kicadPath, tstamps: toText(sheet.tstamps, '/') || '/' },
      title: {
        title: toText(titleBlock.title, ''),
        company: toText(titleBlock.company, ''),
        rev: toText(titleBlock.rev, ''),
        date: toText(titleBlock.date, ''),
        source: toText(titleBlock.source, ''),
        comments: asArray(titleBlock.comments).slice(0, 9),
      },
    });
    sheets.push(sheetObject);
    if (!byPath.has(kicadPath)) byPath.set(kicadPath, sheetObject);
    else warn(warnings, 'DUPLICATE_SHEET_PATH', '重复的 sheet 路径 ' + kicadPath + '，元件归入首个图纸');
  });
  if (sheets.length === 0) {
    // 读取器已保证至少有 1 个 sheet；此处兜底，保证工程 schema 至少有 1 张图纸。
    sheets.push(createSheet('Root', { id: 'sheet-1', index: 0 }));
    byPath.set('/', sheets[0]);
  }
  return { sheets, byPath, root: sheets[0] };
}

/**
 * 导入 KiCad 9 网表文本为可编辑工程。
 * 任何输入都不会抛出未捕获异常：失败时返回 { ok:false, errors:[...], diagnostics, warnings }。
 * @param {string} text 网表文本
 * @param {{name?: string}} [options] name 可覆盖工程名
 * @returns {{ ok: boolean, project?: object, warnings: object[], stats?: object,
 *             errors?: string[], diagnostics?: object[] }}
 */
export function importKiCadNetlist(text, options = {}) {
  const doc = readKiCadNetlist(text);
  const warnings = [];
  for (const item of asArray(doc.warnings)) {
    warn(warnings, toText(item && item.code, 'WARNING'), toText(item && item.message, ''));
  }
  if (!doc.ok) {
    const diagnostics = asArray(doc.errors);
    return {
      ok: false,
      errors: diagnostics.map(formatDiagnostic),
      diagnostics,
      warnings,
    };
  }

  const design = isPlainObject(doc.design) ? doc.design : { source: '', date: '', tool: '', sheets: [] };
  const { sheets, byPath, root } = buildSheets(doc, warnings);
  const sheetPathByRef = new Map();
  const compByRef = new Map();
  const compsByPart = new Map();

  for (const component of asArray(doc.components)) {
    const ref = toText(component.ref, '');
    if (ref === '') continue;
    if (compByRef.has(ref)) {
      warn(warnings, 'DUPLICATE_COMP_REF', '位号 ' + ref + ' 重复出现，后续节点按首个元件处理');
      continue;
    }
    compByRef.set(ref, component);
    sheetPathByRef.set(ref, sheetPathOf(component));
    const key = libPartKey(component.libsource.lib, component.libsource.part);
    if (!compsByPart.has(key)) compsByPart.set(key, []);
    compsByPart.get(key).push(component);
  }

  // 节点 pintype 修饰符按 (libpart, 引脚号) 汇总：样本内无冲突，若冲突则记 warning 并取最后一次观测。
  const modifiers = new Map();
  for (const net of asArray(doc.nets)) {
    for (const node of asArray(net.nodes)) {
      const component = compByRef.get(node.ref);
      if (!component) continue;
      const key = libPartKey(component.libsource.lib, component.libsource.part) + '\u0000' + node.pin;
      const parsed = parsePintype(node.pintype);
      const previous = modifiers.get(key);
      if (previous) {
        if (previous.noConnect !== parsed.noConnect || previous.free !== parsed.free) {
          warn(
            warnings,
            'PIN_MODIFIER_CONFLICT',
            '符号 ' + key.replace('\u0000', ' 引脚 ') + ' 的 no_connect/free 标记在不同实例间不一致',
          );
        }
        if (previous.base !== parsed.base) {
          warn(
            warnings,
            'PIN_TYPE_MISMATCH',
            '符号 ' + key.replace('\u0000', ' 引脚 ') + ' 在网表中的电气类型与库定义不一致',
          );
        }
      }
      modifiers.set(key, { base: parsed.base, noConnect: parsed.noConnect, free: parsed.free });
    }
  }

  const symbolDefs = [];
  const symbolDefById = new Map();
  for (const libpart of asArray(doc.libparts)) {
    const id = libPartKey(libpart.lib, libpart.part);
    if (symbolDefById.has(id)) {
      warn(warnings, 'DUPLICATE_LIBPART', '重复的 libpart ' + id + '，保留首个定义');
      continue;
    }
    const def = buildLibrarySymbol(libpart, {
      components: compsByPart.get(id) || [],
      modifiers,
      warnings,
    });
    if (def) {
      symbolDefs.push(def);
      symbolDefById.set(id, def);
    }
  }

  // 元件按图纸分组（保持网表中的出现顺序），再逐图纸 flow 布局。
  const componentsBySheet = new Map(sheets.map((sheet) => [sheet.id, []]));
  for (const component of asArray(doc.components)) {
    const ref = toText(component.ref, '');
    if (ref === '' || compByRef.get(ref) !== component) continue;
    const path = sheetPathByRef.get(ref);
    let sheet = byPath.get(path);
    if (!sheet) {
      warn(warnings, 'UNKNOWN_SHEETPATH', '元件 ' + ref + ' 的 sheetpath ' + path + ' 不在 design.sheets 中，归入根图纸');
      sheet = root;
    }
    componentsBySheet.get(sheet.id).push(component);
  }

  const pinPointsByRef = new Map();
  const usedInstanceIds = new Set();
  let wireCount = 0;

  for (const sheet of sheets) {
    const comps = componentsBySheet.get(sheet.id) || [];
    const pinCounts = comps.map((component) => {
      const def = symbolDefById.get(libPartKey(component.libsource.lib, component.libsource.part));
      return def ? def.pins.length : 0;
    });
    const positions = layoutPositions(pinCounts);
    comps.forEach((component, index) => {
      const ref = toText(component.ref, '');
      const key = libPartKey(component.libsource.lib, component.libsource.part);
      const def = symbolDefById.get(key) || null;
      if (!def) {
        warn(warnings, 'UNKNOWN_LIBPART', '元件 ' + ref + ' 的符号 ' + key + ' 未在 libparts 中定义，引脚不参与连通性');
      }
      const tstamps = toText(component.tstamps, '');
      let instanceId = 'sym-' + (tstamps === '' ? sheet.id + '-' + ref : tstamps);
      if (usedInstanceIds.has(instanceId)) instanceId = instanceId + '-' + (index + 1);
      usedInstanceIds.add(instanceId);
      const position = positions[index];
      const kicad = {
        datasheet: toText(component.datasheet, ''),
        description: toText(component.description, ''),
        tstamps,
        libsource: {
          lib: toText(component.libsource.lib, ''),
          part: toText(component.libsource.part, ''),
          description: toText(component.libsource.description, ''),
        },
        properties: asArray(component.properties).map((property) => {
          const entry = { name: toText(property.name, '') };
          if (typeof property.value === 'string') entry.value = property.value;
          return entry;
        }),
        fields: asArray(component.fields).map((field) => {
          const entry = { name: toText(field.name, '') };
          if (typeof field.value === 'string') entry.value = field.value;
          return entry;
        }),
        sheetpath: {
          names: toText(component.sheetpath.names, '/'),
          tstamps: toText(component.sheetpath.tstamps, '/'),
        },
      };
      const instance = createSymbolInstance({
        id: instanceId,
        symbolId: key,
        designator: ref,
        value: toText(component.value, ''),
        x: position.x,
        y: position.y,
        rotation: 0,
        mirror: false,
        footprintId: toText(component.footprint, '') === '' ? null : toText(component.footprint, ''),
        fields: legacyFieldsOf(component),
        kicad,
      });
      sheet.symbols.push(instance);

      // 每引脚 stub 导线：从引脚连接端点向左延伸 2.54mm，标签落在导线末端。
      const points = new Map();
      if (def) {
        for (const pin of def.pins) {
          const pinPoint = { x: instance.x + pin.x, y: instance.y + pin.y };
          if (pin.electricalType === 'no_connect') continue;
          const stubEnd = { x: pinPoint.x - STUB_LENGTH, y: pinPoint.y };
          sheet.wires.push(createWire([pinPoint, stubEnd]));
          wireCount += 1;
          points.set(pin.number, stubEnd);
        }
      }
      pinPointsByRef.set(ref, points);
    });
  }

  // 网络标签与 net class：unconnected-(…) 跳过（§4.5，导出侧合成）。
  const assignments = {};
  let labelCount = 0;
  let netsLabeled = 0;
  let netsSkippedUnconnected = 0;
  const classCounts = {};
  for (const net of asArray(doc.nets)) {
    const sourceName = toText(net.name, '');
    if (sourceName === '') continue;
    const className = toText(net.class, 'Default') || 'Default';
    classCounts[className] = (classCounts[className] || 0) + 1;
    if (sourceName.startsWith(UNCONNECTED_NET_PREFIX)) {
      netsSkippedUnconnected += 1;
      continue;
    }
    const decoded = decodeNetName(sourceName);
    const prefixes = [];
    for (const node of asArray(net.nodes)) {
      const path = sheetPathByRef.get(node.ref);
      if (path !== undefined && !prefixes.includes(path)) prefixes.push(path);
    }
    const prefix = prefixes.length > 0 ? prefixes[0] : '/';
    const multiSheet = prefixes.length > 1;
    let text = decoded;
    let kind = 'global';
    if (!multiSheet && prefix !== '/' && decoded.startsWith(prefix) && decoded.length > prefix.length) {
      text = decoded.slice(prefix.length);
      kind = 'local';
    }
    if (text === '') {
      warn(warnings, 'EMPTY_NET_NAME', '网络 ' + sourceName + ' 解码后为空，跳过标签');
      continue;
    }
    let labelled = 0;
    for (const node of asArray(net.nodes)) {
      const points = pinPointsByRef.get(node.ref);
      const point = points ? points.get(node.pin) : null;
      if (!point) {
        warn(
          warnings,
          'MISSING_PIN_POINT',
          '网络 ' + sourceName + ' 的节点 ' + node.ref + '-' + node.pin + ' 找不到引脚，已跳过该节点',
        );
        continue;
      }
      const sheetPath = sheetPathByRef.get(node.ref);
      const sheet = byPath.get(sheetPath) || root;
      sheet.labels.push(createLabel({ x: point.x, y: point.y, rotation: 0, text, kind }));
      labelled += 1;
      labelCount += 1;
    }
    if (labelled === 0) continue;
    netsLabeled += 1;
    if (Object.prototype.hasOwnProperty.call(assignments, text) && assignments[text] !== className) {
      warn(
        warnings,
        'NET_CLASS_CONFLICT',
        '网络名 ' + text + ' 对应多个 net class（保留 ' + assignments[text] + '，忽略 ' + className + '）',
      );
    } else {
      assignments[text] = className;
    }
  }

  const timestamp = nowIso();
  const project = createProject(toText(options && options.name, '') || projectNameFromSource(design.source, 'KiCad 导入工程'), {
    kicad: {
      source: toText(design.source, ''),
      tool: toText(design.tool, 'schematic-studio') || 'schematic-studio',
      date: toText(design.date, ''),
      version: toText(doc.version, 'E') || 'E',
      libraries: asArray(doc.libraries).map((library) => ({
        logical: toText(library.logical, ''),
        uri: toText(library.uri, ''),
      })),
    },
    netClassAssignments: assignments,
  });
  project.grid = DEFAULT_GRID;
  project.sheets = sheets;
  project.library = { symbols: symbolDefs, footprints: [] };
  project.meta = { created: timestamp, modified: timestamp };

  const validation = validateProject(project);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors.slice(),
      diagnostics: validation.errors.map((message) => ({ line: 1, code: 'PROJECT_INVALID', message })),
      warnings,
    };
  }

  return {
    ok: true,
    project,
    warnings,
    stats: {
      sheets: sheets.length,
      components: asArray(doc.components).length,
      libparts: symbolDefs.length,
      libraries: asArray(doc.libraries).length,
      nets: asArray(doc.nets).length,
      nodes: asArray(doc.nets).reduce((total, net) => total + asArray(net.nodes).length, 0),
      labels: labelCount,
      wires: wireCount,
      netsLabeled,
      netsSkippedUnconnected,
      classes: classCounts,
    },
  };
}
