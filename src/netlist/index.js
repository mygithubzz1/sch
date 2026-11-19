// 网表引擎入口：聚合连通性分析与 ERC，生成 { ok, nets, warnings, stats }，并提供 json/csv/kicad/protel 导出器。
import { analyzeProject, naturalCompare, netToContract, resolveSymbolMap } from './connectivity.js';
import { runERC } from './erc.js';
import {
  commentsAsSlots9,
  compareComponentKeys,
  compareAscii,
  compareLibparts,
  compareNetNames,
  DEFAULT_NET_CLASS,
  EMPTY_VALUE_SENTINEL,
  encodeNetName,
  KICAD_VERSION,
  pintypeOf,
  renderSExpr,
  sexpr,
  sortPinsAscii,
  stableUuid,
} from './kicad-format.js';

export {
  CONNECTIVITY_TOLERANCE,
  analyzeProject,
  analyzeSheet,
  buildConnectivity,
  buildProjectConnectivity,
  naturalCompare,
  resolveSymbolMap,
} from './connectivity.js';
export { ERC_CODES, ercWarnings, runERC } from './erc.js';

const CSV_HEADER = ['designator', 'pin', 'name', 'net'];
const DEFAULT_TOOL = 'schematic-studio';
const DEFAULT_LIBRARY = 'schematic-studio';
const DEFAULT_SHEET_PATH = '/';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value) {
  return typeof value === 'string' ? value : '';
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** 工程日期戳（用于 KiCad 网表）：meta.modified 是完整 ISO 时间戳，缺失时退化为当前时间。 */
function dateStamp(project) {
  const modified =
    project && project.meta && typeof project.meta.modified === 'string' ? project.meta.modified : '';
  if (modified.trim() !== '') return modified;
  return new Date().toISOString();
}

function projectNameOf(project) {
  const name = project && typeof project.name === 'string' ? project.name.trim() : '';
  return name === '' ? 'schematic-studio' : name;
}

/**
 * 汇总一次完整分析：明细网络 + 组件 + 告警 + 统计。
 * @param {object} project 工程数据
 * @param {object} options { symbols, symbolLookup, tolerance }
 * @returns {object} { ok, analysis, nets, components, warnings, stats }
 */
function analyzeNetlist(project, options = {}) {
  const analysis = analyzeProject(project, options);
  const erc = runERC(project, { ...options, analysis });
  const warnings = [...analysis.warnings, ...erc.warnings];
  const nets = analysis.nets.filter((net) => net.pins.length > 0);
  const stats = { ...analysis.stats, warnings: warnings.length };
  return { ok: analysis.ok, analysis, nets, components: analysis.components, warnings, stats };
}

function cloneData(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/**
 * 生成网表（契约接口）。
 * @param {object} project 工程数据
 * @param {object} options 可注入符号库与容差
 * @returns {{ ok: boolean, nets: object[], warnings: object[], stats: object, components: object[] }}
 */
export function buildNetlist(project, options = {}) {
  const result = analyzeNetlist(project, options);
  return {
    ok: result.ok,
    nets: result.nets.map(netToContract),
    warnings: result.warnings,
    stats: result.stats,
    components: sortedComponents(result.components).map((component) => {
      const contract = {
        designator: component.designator,
        value: component.value,
        footprintId: component.footprintId,
        symbolId: component.symbolId,
        instanceId: component.instanceId,
        sheetId: component.sheetId,
        power: component.power,
        refPrefix: component.refPrefix,
        virtual: component.virtual,
        pins: component.pins.map((pin) => ({ ...pin })),
      };
      // KiCad 扩展元数据透传（规范 §8.4）：白名单重建会丢掉 datasheet/libsource/properties/fields/sheetpath/tstamps。
      if (component.kicad !== undefined) contract.kicad = cloneData(component.kicad);
      return contract;
    }),
  };
}

function sortedComponents(components) {
  return [...components].sort((left, right) => naturalCompare(left.designator, right.designator));
}

/** CSV 单元格转义：含逗号/引号/换行时加引号并双写引号。 */
function csvCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function jsonDocument(project, result) {
  return {
    format: 'schematic-studio-netlist',
    version: 1,
    generator: 'schematic-studio',
    project: {
      name: projectNameOf(project),
      units: 'mm',
      grid: project && Number.isFinite(Number(project.grid)) ? Number(project.grid) : null,
    },
    components: sortedComponents(result.components).map((component) => ({
      designator: component.designator,
      value: component.value,
      footprint: component.footprintId || '',
      symbolId: component.symbolId,
      sheetId: component.sheetId,
      power: component.power,
      pins: component.pins.map((pin) => ({
        number: pin.number,
        name: pin.name,
        electricalType: pin.electricalType,
      })),
    })),
    nets: result.nets.map((net) => ({
      name: net.name,
      pins: netToContract(net).pins.map((pin) => ({
        designator: pin.designator,
        pin: pin.pinNumber,
        pinName: pin.pinName,
        symbolId: pin.symbolId,
        sheetId: pin.sheetId,
      })),
    })),
    warnings: result.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ref: warning.ref || null,
    })),
    stats: result.stats,
  };
}

/**
 * 生成 JSON 网表（可 JSON.parse，缩进 2，无 BOM）。
 * @param {object} project 工程数据
 * @param {object} options 同 buildNetlist
 * @returns {string} JSON 文本
 */
export function generateJSON(project, options = {}) {
  return JSON.stringify(jsonDocument(project, analyzeNetlist(project, options)), null, 2) + '\n';
}

/**
 * 生成 CSV 网表：表头 designator,pin,name,net，按位号 + 引脚号自然排序。
 * @param {object} project 工程数据
 * @param {object} options 同 buildNetlist
 * @returns {string} CSV 文本
 */
export function generateCSV(project, options = {}) {
  const result = analyzeNetlist(project, options);
  const netOfPin = new Map();
  for (const net of result.nets) {
    for (const pin of net.pins) {
      netOfPin.set(pin.instanceId + '\u0000' + pin.pinNumber, net.name);
    }
  }

  const lines = [CSV_HEADER.join(',')];
  for (const component of sortedComponents(result.components)) {
    const pins = [...component.pins].sort((left, right) => naturalCompare(left.number, right.number));
    for (const pin of pins) {
      const netName = netOfPin.get(component.instanceId + '\u0000' + pin.number) || '';
      lines.push(
        [component.designator, pin.number, pin.name, netName].map(csvCell).join(','),
      );
    }
  }
  return lines.join('\n') + '\n';
}

function stripLibraryPrefix(symbolId) {
  const text = asText(symbolId);
  const colon = text.lastIndexOf(':');
  return colon >= 0 && colon < text.length - 1 ? text.slice(colon + 1) : text;
}

/** 图纸 KiCad 元数据（规范 §8.3）：缺失时按序号 / 根路径补缺省。 */
function sheetKicadOf(sheet, index) {
  const meta = asPlainObject(sheet && sheet.kicad);
  return {
    number: asText(meta && meta.number) || String(index + 1),
    name: asText(meta && meta.name) || DEFAULT_SHEET_PATH,
    tstamps: asText(meta && meta.tstamps) || DEFAULT_SHEET_PATH,
  };
}

function sheetInfosOf(project) {
  return asArray(project && project.sheets).map((sheet, index) => {
    const kicad = sheetKicadOf(sheet, index);
    const order = Number(kicad.number);
    return { sheet, index, kicad, path: kicad.name, order: Number.isFinite(order) ? order : index + 1 };
  });
}

function sheetInfoByIdOf(sheetInfos) {
  const map = new Map();
  for (const info of sheetInfos) {
    const id = asText(info.sheet && info.sheet.id);
    if (id !== '') map.set(id, info);
  }
  return map;
}

function instanceByIdOf(sheetInfos) {
  const map = new Map();
  for (const info of sheetInfos) {
    for (const symbol of asArray(info.sheet && info.sheet.symbols)) {
      const id = asText(symbol && symbol.id);
      if (id !== '') map.set(id, symbol);
    }
  }
  return map;
}

/** 字段值语义（规范 §3.3.1 / §8.4）：fields 的空串与缺失一律自闭合，故空串归一为 undefined。 */
function fieldValueOf(entry) {
  if (!entry || entry.value === undefined || entry.value === null) return undefined;
  const text = String(entry.value);
  return text === '' ? undefined : text;
}

function fieldNode(entry) {
  return sexpr('field', {
    inline: [['name', asText(entry && entry.name)]],
    value: fieldValueOf(entry),
  });
}

/** property 区分「无 value 子节点」（自闭合）与「value 为空串」（(value "")），见规范 §3.3.2；整体单行。 */
function propertyNode(entry) {
  const inline = [['name', asText(entry && entry.name)]];
  if (entry && entry.value !== undefined && entry.value !== null) {
    inline.push(['value', String(entry.value)]);
  }
  return sexpr('property', { inline });
}

function titleBlockNode(sheet) {
  const title = asPlainObject(sheet && sheet.title) || {};
  const children = [
    sexpr('title', { value: asText(title.title) }),
    sexpr('company', { value: asText(title.company) }),
    sexpr('rev', { value: asText(title.rev) }),
    sexpr('date', { value: asText(title.date) }),
    sexpr('source', { value: asText(title.source) }),
  ];
  commentsAsSlots9(title.comments).forEach((value, index) => {
    // 黄金样本：(comment (number "1") (value "…")) 整体单行。
    children.push(
      sexpr('comment', {
        inline: [
          ['number', String(index + 1)],
          ['value', value],
        ],
      }),
    );
  });
  return sexpr('title_block', { children });
}

function designNode(project, sheetInfos) {
  const meta = asPlainObject(project && project.kicad) || {};
  const version = asText(meta.version) || KICAD_VERSION;
  const children = [
    sexpr('source', { value: asText(meta.source) || projectNameOf(project) }),
    sexpr('date', { value: asText(meta.date) || dateStamp(project) }),
    sexpr('tool', { value: asText(meta.tool) || DEFAULT_TOOL }),
  ];
  for (const info of sheetInfos) {
    children.push(
      sexpr('sheet', {
        inline: [
          ['number', info.kicad.number],
          ['name', info.kicad.name],
          ['tstamps', info.kicad.tstamps],
        ],
        children: [titleBlockNode(info.sheet)],
      }),
    );
  }
  return { node: sexpr('design', { children }), version };
}

/** 每个用到的库符号的 lib/part/description：优先 comp 的 kicad.libsource，其次工程库与库符号定义。 */
function resolveLibInfos(components, context) {
  const bySymbol = new Map();
  for (const component of components) {
    const symbolId = asText(component.symbolId);
    const kicad = asPlainObject(component.kicad);
    const explicit = kicad ? asPlainObject(kicad.libsource) : null;
    const current = bySymbol.get(symbolId) || { lib: '', part: '', description: '' };
    if (explicit) {
      if (current.lib === '') current.lib = asText(explicit.lib);
      if (current.part === '') current.part = asText(explicit.part);
      if (current.description === '') current.description = asText(explicit.description);
    }
    bySymbol.set(symbolId, current);
  }

  const singleLibrary = context.libraries.length === 1 ? asText(context.libraries[0].logical) : '';
  const defaultLib = singleLibrary || DEFAULT_LIBRARY;
  for (const [symbolId, info] of bySymbol) {
    const def = context.symbolMap.get(symbolId) || null;
    if (info.lib === '') info.lib = defaultLib;
    if (info.part === '') info.part = stripLibraryPrefix((def && def.id) || symbolId);
    if (info.description === '') info.description = asText(def && def.description);
  }
  return bySymbol;
}

function libsourceNode(component, context) {
  const kicad = asPlainObject(component.kicad);
  const explicit = kicad ? asPlainObject(kicad.libsource) : null;
  const fallback = context.libInfoBySymbolId.get(asText(component.symbolId)) || {
    lib: DEFAULT_LIBRARY,
    part: stripLibraryPrefix(component.symbolId),
    description: '',
  };
  return sexpr('libsource', {
    inline: [
      ['lib', (explicit && asText(explicit.lib)) || fallback.lib],
      ['part', (explicit && asText(explicit.part)) || fallback.part],
      ['description', (explicit && asText(explicit.description)) || fallback.description],
    ],
  });
}

const RESERVED_FIELD_NAMES = Object.freeze(['Footprint', 'Datasheet', 'Description']);

/** comp/fields（规范 §8.4）：优先 kicad.fields（保序），否则由 symbol.fields + Footprint/Datasheet/Description 派生。 */
function componentFieldsOf(component, instance) {
  const kicad = asPlainObject(component.kicad);
  if (kicad && Array.isArray(kicad.fields)) return kicad.fields;
  const userFields = asPlainObject(instance && instance.fields) || {};
  const fields = [];
  for (const [name, value] of Object.entries(userFields)) {
    if (RESERVED_FIELD_NAMES.includes(name)) continue;
    fields.push(value === undefined || value === null ? { name } : { name, value: String(value) });
  }
  const footprint = asText(component.footprintId);
  fields.push(footprint === '' ? { name: 'Footprint' } : { name: 'Footprint', value: footprint });
  fields.push({ name: 'Datasheet' });
  fields.push({ name: 'Description' });
  return fields;
}

/** comp/property（规范 §8.4）：优先 kicad.properties（保序），否则由用户字段 + Sheetname/Sheetfile 派生。 */
function componentPropertiesOf(component, instance, sheet) {
  const kicad = asPlainObject(component.kicad);
  if (kicad && Array.isArray(kicad.properties)) return kicad.properties;
  const userFields = asPlainObject(instance && instance.fields) || {};
  const properties = Object.entries(userFields).map(([name, value]) => ({
    name,
    value: value === undefined || value === null ? undefined : String(value),
  }));
  properties.push({ name: 'Sheetname', value: asText(sheet && sheet.name) });
  properties.push({ name: 'Sheetfile', value: '' });
  return properties;
}

function componentTstampsOf(component, kicad) {
  const explicit = asText(kicad && kicad.tstamps);
  if (explicit !== '') return explicit;
  return stableUuid(asText(component.instanceId) || asText(component.designator) || 'comp');
}

function componentNode(component, context) {
  const kicad = asPlainObject(component.kicad);
  const instance = context.instanceById.get(asText(component.instanceId)) || null;
  const sheetInfo = context.sheetInfoById.get(asText(component.sheetId)) || null;
  const sheet = sheetInfo ? sheetInfo.sheet : null;
  const sheetKicad = sheetInfo ? sheetInfo.kicad : { number: '1', name: DEFAULT_SHEET_PATH, tstamps: DEFAULT_SHEET_PATH };

  const children = [
    sexpr('value', { value: asText(component.value) }),
    sexpr('footprint', { value: asText(component.footprintId) }),
  ];

  // datasheet：有 kicad 元数据时「空 ⇒ 省略」；旧工程缺元数据时按 KiCad 约定写 "~"。
  const datasheet = kicad ? asText(kicad.datasheet) : EMPTY_VALUE_SENTINEL;
  if (datasheet !== '') children.push(sexpr('datasheet', { value: datasheet }));

  const description = asText(kicad && kicad.description);
  if (description !== '') children.push(sexpr('description', { value: description }));

  const fields = componentFieldsOf(component, instance);
  if (fields.length > 0) {
    children.push(sexpr('fields', { children: fields.map((entry) => fieldNode(entry)) }));
  }

  children.push(libsourceNode(component, context));

  for (const property of componentPropertiesOf(component, instance, sheet)) {
    children.push(propertyNode(property));
  }

  const sheetpath = asPlainObject(kicad && kicad.sheetpath);
  const names = asText(sheetpath && sheetpath.names) || sheetKicad.name;
  const tstamps = asText(sheetpath && sheetpath.tstamps) || sheetKicad.tstamps;
  children.push(sexpr('sheetpath', { inline: [['names', names], ['tstamps', tstamps]] }));
  children.push(sexpr('tstamps', { value: componentTstampsOf(component, kicad) }));

  return sexpr('comp', {
    inline: [['ref', asText(component.designator)]],
    children,
  });
}

function kicadFootprintsOf(def) {
  const values = [];
  const seen = new Set();
  for (const source of [asArray(def && def.footprints), asArray(def && def.fpFilters)]) {
    for (const item of source) {
      const text = asText(item);
      if (text === '' || seen.has(text)) continue;
      seen.add(text);
      values.push(text);
    }
  }
  return values;
}

/** libpart/fields 缺省补全（规范 §8.5）：Reference → Value → Footprint → Datasheet → Description。 */
function libpartFieldsOf(def) {
  if (Array.isArray(def && def.fields) && def.fields.length > 0) return def.fields;
  return [
    { name: 'Reference', value: asText(def && def.refPrefix) || 'U' },
    { name: 'Value', value: asText(def && def.name) || asText(def && def.id) },
    { name: 'Footprint' },
    { name: 'Datasheet', value: EMPTY_VALUE_SENTINEL },
    { name: 'Description', value: asText(def && def.description) },
  ];
}

/** libpart/pin@name 空时写 ""（规范 §3.4）；旧数据的 "~" 是 KiCad 的「无引脚名」写法，归一为空串。 */
function libpartPinNameOf(pin) {
  const name = asText(pin && pin.name);
  return name === EMPTY_VALUE_SENTINEL ? '' : name;
}

function libpartNode(def, libInfo) {
  const children = [sexpr('description', { value: asText(def && def.description) })];
  const docs = asText(def && def.docs);
  if (docs !== '') children.push(sexpr('docs', { value: docs }));

  const footprints = kicadFootprintsOf(def);
  if (footprints.length > 0) {
    children.push(sexpr('footprints', { children: footprints.map((fp) => sexpr('fp', { value: fp })) }));
  }

  children.push(sexpr('fields', { children: libpartFieldsOf(def).map((entry) => fieldNode(entry)) }));

  const pins = asArray(def && def.pins);
  if (pins.length > 0) {
    children.push(
      sexpr('pins', {
        children: pins.map((pin) =>
          sexpr('pin', {
            inline: [
              ['num', asText(String(pin && pin.number === undefined ? '' : pin.number))],
              ['name', libpartPinNameOf(pin)],
              // libpart pin 的 type 不带 +no_connect / +free 修饰（规范 §4.3）。
              ['type', pintypeOf(pin).split('+')[0]],
            ],
          }),
        ),
      }),
    );
  }

  return sexpr('libpart', {
    inline: [
      ['lib', libInfo.lib],
      ['part', libInfo.part],
    ],
    children,
  });
}

function libpartsNode(components, context) {
  const rows = [];
  const seen = new Set();
  for (const component of components) {
    const symbolId = asText(component.symbolId);
    if (seen.has(symbolId)) continue;
    const def = context.symbolMap.get(symbolId) || null;
    if (!def) continue;
    seen.add(symbolId);
    const libInfo = context.libInfoBySymbolId.get(symbolId) || {
      lib: DEFAULT_LIBRARY,
      part: stripLibraryPrefix(symbolId),
      description: '',
    };
    rows.push({ lib: libInfo.lib, part: libInfo.part, node: libpartNode(def, libInfo) });
  }
  rows.sort((left, right) => compareLibparts(left, right));
  return sexpr('libparts', { children: rows.map((row) => row.node) });
}

function librariesNode(context) {
  const seen = new Set();
  const children = [];
  for (const library of context.libraries) {
    const logical = asText(library && library.logical);
    if (logical === '' || seen.has(logical)) continue;
    seen.add(logical);
    children.push(
      sexpr('library', {
        inline: [['logical', logical]],
        children: [sexpr('uri', { value: asText(library && library.uri) })],
      }),
    );
  }
  return sexpr('libraries', { children });
}

/** 引脚功能文本（规范 §3.6 / §5.4）：取引脚名原文，空（含旧数据 "~"）时整段省略，不做 {slash} 编码。 */
function pinFunctionOf(pin) {
  const raw =
    typeof pin.pinfunction === 'string'
      ? pin.pinfunction
      : typeof pin.pinName === 'string'
        ? pin.pinName
        : typeof pin.name === 'string'
          ? pin.name
          : '';
  return raw === EMPTY_VALUE_SENTINEL ? '' : raw;
}

function nodeNode(pin) {
  const inline = [
    ['ref', asText(pin.designator)],
    ['pin', asText(pin.pinNumber)],
  ];
  const pinfunction = pinFunctionOf(pin);
  if (pinfunction !== '') inline.push(['pinfunction', pinfunction]);
  inline.push(['pintype', pintypeOf(pin)]);
  return sexpr('node', { inline });
}

function netClassOf(project, net, displayName) {
  const explicit = asText(net && net.class);
  if (explicit !== '') return explicit;
  const assignments = asPlainObject(project && project.netClassAssignments);
  if (assignments) {
    for (const key of [asText(net && net.name), asText(displayName)]) {
      if (key === '' || !Object.prototype.hasOwnProperty.call(assignments, key)) continue;
      const value = assignments[key];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
  }
  return DEFAULT_NET_CLASS;
}

function netDisplayNameOf(net, context) {
  const sheetId = asArray(net && net.sheetIds)[0];
  const info = sheetId ? context.sheetInfoById.get(asText(sheetId)) : null;
  return encodeNetName(net && net.name, {
    sheetPath: info ? info.kicad.name : DEFAULT_SHEET_PATH,
    nameSource: asText(net && net.nameSource),
  });
}

function netRowOf(net, context) {
  const name = netDisplayNameOf(net, context);
  return {
    name,
    className: netClassOf(context.project, net, name),
    pins: sortPinsAscii(net && net.pins),
  };
}

function pinKeyOf(instanceId, pinNumber) {
  return asText(instanceId) + '\u0000' + asText(pinNumber);
}

/** unconnected 网名（KiCad 9）：unconnected-(<ref>-<引脚名>-Pad<pin>)，引脚名为空或等于引脚号时省略。 */
function unconnectedNameOf(designator, pin) {
  const ref = asText(designator);
  const number = asText(pin && pin.number);
  const rawName = asText(pin && pin.name);
  const name = rawName === EMPTY_VALUE_SENTINEL ? '' : rawName;
  const middle = name !== '' && name !== number ? name + '-' : '';
  return 'unconnected-(' + ref + '-' + middle + 'Pad' + number + ')';
}

/**
 * 待导出的真实网络：单引脚自动网络（`N$n`）在 KiCad 里不是网络，而是 unconnected 引脚。
 * 这里把它们剔除，交给 synthesizeUnconnectedNets 合成 `unconnected-(…)`（规范 §4.5）。
 * 电源符号的单脚网络保留（电源符号不参与 unconnected 合成，避免丢掉悬空电源引脚）。
 * @param {object} result analyzeNetlist 的明细结果
 * @returns {object[]} 保留的网络
 */
function realNetsOf(result) {
  const componentByInstance = new Map();
  for (const component of asArray(result && result.components)) {
    componentByInstance.set(asText(component.instanceId), component);
  }
  return asArray(result && result.nets).filter((net) => {
    const pins = asArray(net && net.pins);
    if (pins.length !== 1 || net.nameSource !== 'auto') return true;
    // 电源符号没有真实引脚网络语义，保留其单脚网络，不替换成 unconnected。
    const component = componentByInstance.get(asText(pins[0].instanceId));
    return Boolean(component && component.power === true);
  });
}

/**
 * 合成 unconnected-(…) 网络：KiCad 9 会为「未进入任何网络的引脚」单独建网（规范 §4.5 / §3.6）。
 * 判定条件是「引脚未出现在任何保留网络里」，不是「noConnect 为真」——悬空的 passive 引脚同样要合成。
 * 电源符号不是真实元件，不参与合成。
 * @param {object} result analyzeNetlist 的明细结果
 * @param {object[]} realNets 已剔除单引脚自动网络后的网络
 * @returns {object[]} 合成网络（与明细网络同形状的纯数据）
 */
function synthesizeUnconnectedNets(result, realNets) {
  const connected = new Set();
  for (const net of asArray(realNets)) {
    for (const pin of asArray(net && net.pins)) {
      connected.add(pinKeyOf(pin.instanceId, pin.pinNumber));
    }
  }

  const nets = [];
  const usedNames = new Set();
  for (const component of asArray(result && result.components)) {
    if (component.power === true) continue;
    for (const pin of asArray(component.pins)) {
      if (connected.has(pinKeyOf(component.instanceId, pin.number))) continue;
      const name = unconnectedNameOf(component.designator, pin);
      // 重复位号（非法工程）会撞名：保留首个，避免输出重名网络。
      if (usedNames.has(name)) continue;
      usedNames.add(name);
      nets.push({
        name,
        nameSource: 'auto',
        sheetIds: asText(component.sheetId) === '' ? [] : [component.sheetId],
        pins: [
          {
            designator: component.designator,
            pinNumber: asText(pin.number),
            pinName: asText(pin.name),
            symbolId: component.symbolId,
            instanceId: component.instanceId,
            sheetId: component.sheetId,
            electricalType: pin.electricalType,
            noConnect: pin.noConnect === true,
            free: pin.free === true,
            power: false,
          },
        ],
      });
    }
  }
  return nets;
}

function netsNode(result, context) {
  const realNets = realNetsOf(result);
  const rows = [];
  for (const net of realNets) rows.push(netRowOf(net, context));
  for (const net of synthesizeUnconnectedNets(result, realNets)) rows.push(netRowOf(net, context));
  rows.sort((left, right) => compareNetNames(left.name, right.name));
  const children = rows.map((row, index) =>
    sexpr('net', {
      inline: [
        ['code', String(index + 1)],
        ['name', row.name],
        ['class', row.className],
      ],
      children: row.pins.map((pin) => nodeNode(pin)),
    }),
  );
  return sexpr('nets', { children });
}

function kicadContextOf(project, options) {
  const sheetInfos = sheetInfosOf(project);
  const meta = asPlainObject(project && project.kicad) || {};
  const libraries = asArray(meta.libraries).filter((library) => asPlainObject(library) !== null);
  const context = {
    project,
    sheetInfos,
    sheetInfoById: sheetInfoByIdOf(sheetInfos),
    instanceById: instanceByIdOf(sheetInfos),
    symbolMap: resolveSymbolMap(project, options),
    libraries,
    libInfoBySymbolId: new Map(),
  };
  return context;
}

function sortComponentsForKiCad(components, context) {
  return [...components]
    .map((component) => {
      const info = context.sheetInfoById.get(asText(component.sheetId));
      return {
        component,
        key: {
          sheetOrder: info ? info.order : Number.MAX_SAFE_INTEGER,
          designator: asText(component.designator),
        },
      };
    })
    .sort((left, right) => compareComponentKeys(left.key, right.key) || compareAscii(left.key.designator, right.key.designator))
    .map((entry) => entry.component);
}

/**
 * 生成 KiCad 9（version "E"）S-表达式网表，结构与 examples/tinytapeout-demo.net 同构。
 * 分段顺序固定：export / design（含每图纸 sheet + title_block）/ components / libparts / libraries / nets。
 * 文件级格式（规范 §2）：UTF-8 无 BOM、CRLF 行尾、文件末尾无换行、闭括号并入最后一行。
 * @param {object} project 工程数据
 * @param {object} options 同 buildNetlist
 * @returns {string} KiCad 9 网表文本
 */
export function generateKiCad(project, options = {}) {
  const result = analyzeNetlist(project, options);
  const context = kicadContextOf(project, options);
  const components = sortComponentsForKiCad(result.components, context);
  context.libInfoBySymbolId = resolveLibInfos(components, context);

  const design = designNode(project, context.sheetInfos);
  const root = sexpr('export', {
    inline: [['version', design.version]],
    children: [
      design.node,
      sexpr('components', { children: components.map((component) => componentNode(component, context)) }),
      libpartsNode(components, context),
      librariesNode(context),
      netsNode(result, context),
    ],
  });
  return renderSExpr(root);
}

/**
 * 生成 Protel / PCBNEW .net 文本（[Design] / [Components] / [NETLIST] 段，CRLF 行尾）。
 * @param {object} project 工程数据
 * @param {object} options 同 buildNetlist
 * @returns {string} Protel 网表文本
 */
export function generateProtel(project, options = {}) {
  const result = analyzeNetlist(project, options);
  // 电源符号只是原理图记号、没有封装，Protel/PCB 网表里不作为元件，也不作为网络节点。
  const pcbComponents = result.components.filter((component) => !component.power);
  const lines = [];
  lines.push('[Design]');
  lines.push('Version=PCB4.0');
  lines.push('');
  lines.push('[Components]');
  for (const component of sortedComponents(pcbComponents)) {
    lines.push(
      [component.designator, component.footprintId || '', component.value || ''].join('\t'),
    );
  }
  lines.push('');
  lines.push('[NETLIST]');
  for (const net of result.nets) {
    const nodes = sortedPins(net.pins)
      .filter((pin) => !pin.power)
      .map((pin) => pin.designator + '-' + pin.pinNumber);
    if (nodes.length === 0) continue;
    lines.push([net.name, ...nodes].join('\t'));
  }
  lines.push('');
  return lines.join('\r\n');
}

function sortedPins(pins) {
  return [...pins].sort(
    (left, right) =>
      naturalCompare(left.designator, right.designator) || naturalCompare(left.pinNumber, right.pinNumber),
  );
}

/**
 * 导出器注册表（契约：每项必须提供 id / label / extension / mime / generate(project)）。
 * extension 不含前导点；generate 为纯函数，返回不带 BOM 的完整字符串。
 */
export const EXPORTERS = Object.freeze({
  json: Object.freeze({
    id: 'json',
    label: 'JSON 网表',
    extension: 'net.json',
    mime: 'application/json',
    generate: generateJSON,
  }),
  csv: Object.freeze({
    id: 'csv',
    label: 'CSV 网表',
    extension: 'net.csv',
    mime: 'text/csv',
    generate: generateCSV,
  }),
  kicad: Object.freeze({
    id: 'kicad',
    label: 'KiCad 9 网表',
    extension: 'net',
    mime: 'text/plain',
    generate: generateKiCad,
  }),
  protel: Object.freeze({
    id: 'protel',
    label: 'Protel / PCBNEW 网表',
    extension: 'net',
    mime: 'text/plain',
    generate: generateProtel,
  }),
});

/** 导出器列表（按 json / csv / kicad / protel 顺序）。 */
export const EXPORTER_LIST = Object.freeze(Object.values(EXPORTERS));

/** 按 id 取导出器，未知 id 返回 null。 */
export function getExporter(id) {
  return Object.prototype.hasOwnProperty.call(EXPORTERS, id) ? EXPORTERS[id] : null;
}
