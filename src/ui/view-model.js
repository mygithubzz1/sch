// 界面视图模型：把工程/网表数据转换为面板可直接渲染的纯数据，便于单元测试。
import { ENTITY_COLLECTIONS } from '../model/project.js';

/** 符号分类（顺序即界面展示顺序）。 */
export const SYMBOL_CATEGORIES = Object.freeze([
  { id: 'basic', label: '基础元件' },
  { id: 'semiconductor', label: '半导体与放大' },
  { id: 'power', label: '电源与地' },
  { id: 'connector', label: '连接器与模块' },
  { id: 'other', label: '其他符号' },
]);

const CATEGORY_BY_SYMBOL = Object.freeze({
  R: 'basic', C: 'basic', C_POL: 'basic', L: 'basic', D: 'basic', LED: 'basic', XTAL: 'basic', SW_PUSH: 'basic',
  NPN: 'semiconductor', PNP: 'semiconductor', OPAMP: 'semiconductor', IC_8: 'semiconductor', MCU_16: 'semiconductor',
  GND: 'power', VCC: 'power', '+5V': 'power',
  CONN_2: 'connector', CONN_4: 'connector',
});

/** 网表/ERC 告警代码的中文标签。 */
export const WARNING_LABELS = Object.freeze({
  FLOATING_PIN: '悬空引脚',
  SINGLE_PIN_NET: '单引脚网络',
  DUPLICATE_DESIGNATOR: '位号重复',
  MISSING_FOOTPRINT: '缺少封装',
  UNCONNECTED_WIRE: '未连接导线',
  POWER_OUT_CONFLICT: '电源冲突',
  UNKNOWN_SYMBOL: '未知符号',
  INVALID_WIRE: '非法导线',
  NET_NAME_CONFLICT: '网络名冲突',
});

const TOOL_LABELS = Object.freeze({
  select: '选择',
  wire: '导线',
  place: '放置符号',
  label: '标签',
  text: '文本',
  erase: '删除',
  pad: '焊盘',
  move: '移动',
  graphic: '图形',
});

const LAYER_LABELS = Object.freeze({
  silkscreen: '丝印',
  courtyard: 'Courtyard',
  assembly: '装配层',
  fab: '制造层',
  top: '顶层焊盘',
  bottom: '底层焊盘',
  tht: '通孔焊盘',
});

/** 数字格式化：去掉多余的 0，默认两位小数。 */
export function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const fixed = number.toFixed(Math.max(0, Math.min(6, digits)));
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** 世界坐标格式化："12.7, -3.81"，无坐标时为 "—"。 */
export function formatCoordinate(point) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return '—';
  return formatNumber(point.x) + ', ' + formatNumber(point.y);
}

/** 缩放百分比文本。 */
export function zoomPercent(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value) || value <= 0) return '100%';
  return Math.round(value * 100) + '%';
}

/** 工具名称的中文标签。 */
export function toolLabel(name) {
  return TOOL_LABELS[name] || name || '—';
}

/** 图层名称的中文标签。 */
export function layerLabel(layer) {
  return LAYER_LABELS[layer] || layer || '—';
}

/** 符号所属分类 id。 */
export function symbolCategory(symbol) {
  if (!symbol || typeof symbol !== 'object') return 'other';
  return CATEGORY_BY_SYMBOL[symbol.id] || 'other';
}

/** 按分类分组符号（空分类不返回；不修改入参）。 */
export function groupSymbols(symbols) {
  const buckets = new Map(SYMBOL_CATEGORIES.map((category) => [category.id, []]));
  for (const symbol of Array.isArray(symbols) ? symbols : []) {
    if (!symbol || typeof symbol.id !== 'string') continue;
    const bucket = buckets.get(symbolCategory(symbol)) || buckets.get('other');
    bucket.push(symbol);
  }
  const groups = [];
  for (const category of SYMBOL_CATEGORIES) {
    const items = buckets.get(category.id) || [];
    if (items.length > 0) groups.push({ id: category.id, label: category.label, items });
  }
  return groups;
}

/** 符号检索：匹配 id/name/refPrefix/description，忽略大小写。 */
export function filterSymbols(symbols, query) {
  const text = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const list = (Array.isArray(symbols) ? symbols : []).filter((symbol) => symbol && typeof symbol.id === 'string');
  if (text === '') return list;
  return list.filter((symbol) => {
    const haystack = [symbol.id, symbol.name, symbol.refPrefix, symbol.description]
      .filter((item) => typeof item === 'string')
      .join(' ')
      .toLowerCase();
    return haystack.includes(text);
  });
}

/** 封装检索：匹配 id/name/description。 */
export function filterFootprints(footprints, query) {
  const text = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const list = (Array.isArray(footprints) ? footprints : []).filter((item) => item && typeof item.id === 'string');
  if (text === '') return list;
  return list.filter((item) => {
    const haystack = [item.id, item.name, item.description]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLowerCase();
    return haystack.includes(text);
  });
}

/** 搜索后仍需展示的分组符号。 */
export function groupedSymbols(symbols, query) {
  return groupSymbols(filterSymbols(symbols, query));
}

/** 封装列表行数据。 */
export function footprintRows(footprints) {
  return (Array.isArray(footprints) ? footprints : [])
    .filter((item) => item && typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      name: item.name || item.id,
      description: item.description || '',
      padCount: Array.isArray(item.pads) ? item.pads.length : 0,
    }));
}

/** 状态栏分段数据。 */
export function statusSegments(state = {}) {
  const tool = toolLabel(state.tool);
  const segments = [
    { key: 'coordinate', label: '坐标', value: state.pointer ? formatCoordinate(state.pointer) : '—' },
    { key: 'grid', label: '网格', value: formatNumber(state.grid) + ' mm' },
    { key: 'zoom', label: '缩放', value: zoomPercent(state.scale) },
    { key: 'tool', label: '工具', value: tool },
    { key: 'nets', label: '网络', value: String(Number.isFinite(Number(state.netCount)) ? Number(state.netCount) : 0) },
    { key: 'snap', label: '吸附', value: state.snap === false ? '关' : '开' },
  ];
  if (state.mode === 'footprint') {
    segments.push({ key: 'mode', label: '模式', value: '封装编辑' });
  }
  return segments;
}

/** 状态栏单行文本（测试与 tooltip 使用）。 */
export function formatStatus(state = {}) {
  return statusSegments(state).map((segment) => segment.label + ' ' + segment.value).join(' · ');
}

/** 网表统计摘要。 */
export function netlistSummary(result) {
  const nets = Array.isArray(result && result.nets) ? result.nets : [];
  const warnings = Array.isArray(result && result.warnings) ? result.warnings : [];
  const components = Array.isArray(result && result.components) ? result.components : [];
  let pins = 0;
  for (const net of nets) pins += Array.isArray(net && net.pins) ? net.pins.length : 0;
  return {
    ok: result ? result.ok !== false : false,
    netCount: nets.length,
    pinCount: pins,
    componentCount: components.length,
    warningCount: warnings.length,
  };
}

/** 网络列表行：pin 标签用于点击定位。 */
export function netRows(result) {
  const nets = Array.isArray(result && result.nets) ? result.nets : [];
  return nets.map((net) => {
    const pins = Array.isArray(net && net.pins) ? net.pins : [];
    return {
      name: net && typeof net.name === 'string' && net.name !== '' ? net.name : '未命名网络',
      pins: pins.map((pin) => ({
        label: (pin && pin.designator ? pin.designator : '?') + '.' + (pin && pin.pinNumber !== undefined ? pin.pinNumber : '?'),
        pinName: pin && typeof pin.pinName === 'string' ? pin.pinName : '',
        instanceId: pin && pin.instanceId ? pin.instanceId : null,
        sheetId: pin && pin.sheetId ? pin.sheetId : null,
        designator: pin && pin.designator ? pin.designator : '',
        pinNumber: pin && pin.pinNumber !== undefined ? String(pin.pinNumber) : '',
      })),
    };
  });
}

/** 告警行：code 标签 + 定位目标。 */
export function warningRows(warnings) {
  return (Array.isArray(warnings) ? warnings : []).map((warning, index) => {
    const code = warning && typeof warning.code === 'string' ? warning.code : 'WARNING';
    const ref = warning && warning.ref && typeof warning.ref === 'object' ? warning.ref : {};
    return {
      id: 'w' + index,
      code,
      label: WARNING_LABELS[code] || code,
      message: warning && typeof warning.message === 'string' ? warning.message : '',
      sheetId: ref.sheetId || (warning && warning.sheetId) || null,
      instanceId: ref.instanceId || null,
      wireId: ref.wireId || null,
      netName: ref.netName || (warning && warning.netName) || '',
    };
  });
}

/** 告警定位目标（供画布聚焦）。 */
export function warningTarget(warning) {
  const ref = warning && warning.ref && typeof warning.ref === 'object' ? warning.ref : (warning || {});
  return {
    sheetId: ref.sheetId || null,
    instanceId: ref.instanceId || null,
    wireId: ref.wireId || null,
  };
}

/** 单/多选信息：kind = symbols|wires|junctions|labels|texts|multi|none。 */
export function selectionInfo(sheet, ids) {
  const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  if (list.length === 0 || !sheet) return { count: 0, kind: 'none', entity: null, entities: [] };
  const entities = [];
  for (const id of list) {
    for (const kind of ENTITY_COLLECTIONS) {
      const collection = Array.isArray(sheet[kind]) ? sheet[kind] : [];
      const entity = collection.find((item) => item && item.id === id);
      if (entity) {
        entities.push({ id, kind, entity });
        break;
      }
    }
  }
  if (entities.length === 0) return { count: 0, kind: 'none', entity: null, entities: [] };
  if (entities.length > 1) return { count: entities.length, kind: 'multi', entity: null, entities };
  const only = entities[0];
  return { count: 1, kind: only.kind, entity: only.entity, entities };
}

const SELECTION_TITLES = Object.freeze({
  symbols: '符号',
  wires: '导线',
  junctions: '结点',
  labels: '网络标签',
  texts: '文本',
  multi: '多选',
});

/** 选择集标题与摘要。 */
export function selectionTitle(info) {
  if (!info || info.kind === 'none') return '未选择对象';
  if (info.kind === 'multi') return '已选择 ' + info.count + ' 个对象';
  const label = SELECTION_TITLES[info.kind] || '对象';
  const entity = info.entity || {};
  if (info.kind === 'symbols') return label + ' · ' + (entity.designator || '?');
  if (info.kind === 'wires') return label + ' · ' + (Array.isArray(entity.points) ? entity.points.length : 0) + ' 点';
  if (info.kind === 'labels') return label + ' · ' + (entity.text || '(空)');
  if (info.kind === 'texts') return label + ' · ' + (entity.text || '(空)');
  return label;
}

/** 图纸名称（空名称时回退到序号）。 */
export function sheetLabel(sheet, index = 0) {
  const name = sheet && typeof sheet.name === 'string' ? sheet.name.trim() : '';
  return name === '' ? '图纸 ' + (index + 1) : name;
}

/** 下一个可用的图纸名称（避免重名）。 */
export function nextSheetName(sheets) {
  const names = new Set((Array.isArray(sheets) ? sheets : []).map((sheet) => sheet && sheet.name));
  let index = 1;
  while (names.has('图纸 ' + index)) index += 1;
  return '图纸 ' + index;
}

/** 封装名称。 */
export function footprintLabel(footprint) {
  if (!footprint) return '未选择封装';
  return footprint.name || footprint.id || '未命名封装';
}

/** 项目标题栏文案。 */
export function projectTitle(project) {
  const name = project && typeof project.name === 'string' && project.name.trim() !== '' ? project.name.trim() : '未命名工程';
  return name;
}
