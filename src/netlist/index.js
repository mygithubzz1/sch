// 网表引擎入口：聚合连通性分析与 ERC，生成 { ok, nets, warnings, stats }，并提供 json/csv/kicad/protel 导出器。
import { analyzeProject, netToContract, naturalCompare } from './connectivity.js';
import { runERC } from './erc.js';

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** 工程日期戳（用于 KiCad 网表）；优先使用 meta.modified。 */
function dateStamp(project) {
  const modified =
    project && project.meta && typeof project.meta.modified === 'string' ? project.meta.modified : '';
  if (modified.slice(0, 10) !== '') return modified.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
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
    components: sortedComponents(result.components).map((component) => ({
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
    })),
  };
}

function sortedComponents(components) {
  return [...components].sort((left, right) => naturalCompare(left.designator, right.designator));
}

/** KiCad 对没有名称的引脚使用 "~"，保持与 KiCad 原生网表一致。 */
function pinFunctionText(pin) {
  const name = typeof pin.pinName === 'string' ? pin.pinName.trim() : '';
  return name === '' ? '~' : name;
}

function sortedPins(pins) {
  return [...pins].sort(
    (left, right) =>
      naturalCompare(left.designator, right.designator) || naturalCompare(left.pinNumber, right.pinNumber),
  );
}

/** S-表达式字符串转义：反斜杠、双引号、换行与制表符。 */
function escapeSExpr(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
    .replace(/\t/g, '\\t');
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

/**
 * 生成 KiCad 6+ S-表达式网表。
 * @param {object} project 工程数据
 * @param {object} options 同 buildNetlist
 * @returns {string} KiCad 网表文本
 */
export function generateKiCad(project, options = {}) {
  const result = analyzeNetlist(project, options);
  const lines = [];
  lines.push('(export (version "E")');
  lines.push('  (design');
  lines.push('    (source "' + escapeSExpr(projectNameOf(project)) + '")');
  lines.push('    (date "' + escapeSExpr(dateStamp(project)) + '")');
  lines.push('    (tool "schematic-studio")');
  lines.push('  )');
  lines.push('  (components');
  for (const component of sortedComponents(result.components)) {
    // KiCad 网表同样列出电源符号，保证 nets 段里的 #PWRxx 节点都有对应 comp。
    lines.push(
      '    (comp (ref "' + escapeSExpr(component.designator) + '")' +
        ' (value "' + escapeSExpr(component.value) + '")' +
        ' (footprint "' + escapeSExpr(component.footprintId || '') + '")' +
        ' (libsource (lib "schematic-studio") (part "' + escapeSExpr(component.symbolId) + '")))',
    );
  }
  lines.push('  )');
  lines.push('  (nets');
  result.nets.forEach((net, index) => {
    lines.push('    (net (code ' + (index + 1) + ') (name "' + escapeSExpr(net.name) + '")');
    for (const pin of sortedPins(net.pins)) {
      lines.push(
        '      (node (ref "' + escapeSExpr(pin.designator) + '")' +
          ' (pin "' + escapeSExpr(pin.pinNumber) + '")' +
          ' (pinfunction "' + escapeSExpr(pinFunctionText(pin)) + '")' +
          ' (pintype "' + escapeSExpr(pin.electricalType) + '"))',
      );
    }
    lines.push('    )');
  });
  lines.push('  )');
  lines.push(')');
  return lines.join('\n') + '\n';
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
    label: 'KiCad 6 网表',
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
