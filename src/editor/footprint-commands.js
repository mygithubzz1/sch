// 封装编辑命令：焊盘/图形的增删移动与属性修改，全部经 store.commands 执行。
import { normalizeDeg, round } from '../core/geometry.js';
import { uid } from '../core/id.js';
import { clone } from '../model/project.js';
import { PAD_LAYERS, PAD_SHAPES, normalizePad } from '../library/footprint-library.js';
import { FOOTPRINT_LAYERS, normalizeGraphic } from '../library/graphic.js';
import { nextPadNumber } from './footprint-store.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asIdList(ids) {
  if (typeof ids === 'string') return [ids];
  return asArray(ids).filter((id) => typeof id === 'string' && id !== '');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function requireStore(command) {
  const store = command && command.state;
  if (
    !store ||
    typeof store.getFootprint !== 'function' ||
    typeof store.applyFootprint !== 'function' ||
    !store.commands
  ) {
    throw new TypeError('封装命令未绑定 store：请使用 executeCommand / createFootprintCommandApi 执行');
  }
  return store;
}

function createFootprintEditCommand(label, mutator, options = {}) {
  let before = null;
  let after = null;
  return {
    label: label || '编辑封装',
    state: options.state || null,
    result: null,
    do() {
      const store = requireStore(this);
      if (!after) {
        before = clone(store.getFootprint());
        const draft = clone(before);
        const result = mutator(draft, store);
        after = draft;
        this.result = result === undefined ? null : result;
      }
      store.applyFootprint(clone(after));
      return this.result;
    },
    undo() {
      const store = requireStore(this);
      if (!before) return null;
      store.applyFootprint(clone(before));
      return before;
    },
  };
}

/** 把 store 绑定到封装命令。 */
export function bindFootprintCommand(command, store) {
  if (!command || typeof command.do !== 'function' || typeof command.undo !== 'function') {
    throw new TypeError('命令必须是 { label, do(), undo() } 对象');
  }
  command.state = store;
  return command;
}

/** 通过 footprint store 的命令栈执行。 */
export function executeFootprintCommand(store, command) {
  if (!store || !store.commands || typeof store.commands.execute !== 'function') {
    throw new TypeError('executeFootprintCommand 需要带 commands 的 footprint store');
  }
  bindFootprintCommand(command, store);
  store.commands.execute(command);
  return command;
}

/** 添加焊盘（自动编号与 id；未指定编号时取下一个可用编号）。 */
export function addPadCommand(pad, options = {}) {
  const source = pad && typeof pad === 'object' ? pad : {};
  return createFootprintEditCommand(options.label || '添加焊盘', (draft) => {
    const number =
      source.number === undefined || source.number === null || source.number === ''
        ? nextPadNumber(draft)
        : String(source.number);
    const id = typeof source.id === 'string' && source.id !== '' ? source.id : uid('pad');
    const entity = normalizePad({ ...source, id, number }, draft.pads.length);
    draft.pads.push(entity);
    return entity.id;
  }, options);
}

/** 删除焊盘或图形（按 id 同时匹配两类实体）。 */
export function removeFootprintEntitiesCommand(ids, options = {}) {
  const idSet = new Set(asIdList(ids));
  return createFootprintEditCommand(idSet.size > 1 ? '批量删除' : options.label || '删除', (draft) => {
    draft.pads = asArray(draft.pads).filter((pad) => !idSet.has(pad.id));
    draft.graphics = asArray(draft.graphics).filter((graphic) => !idSet.has(graphic.id));
    return idSet.size;
  }, options);
}

/** 平移图形（按类型修改坐标/折点）。 */
export function translateGraphic(graphic, delta) {
  if (!graphic) return graphic;
  const dx = round(toNumber(delta && delta.x), 6);
  const dy = round(toNumber(delta && delta.y), 6);
  if (graphic.type === 'line' || graphic.type === 'polyline') {
    graphic.points = asArray(graphic.points).map((point) => ({
      x: round(toNumber(point.x) + dx, 6),
      y: round(toNumber(point.y) + dy, 6),
    }));
  } else if (graphic.type === 'circle' || graphic.type === 'arc') {
    graphic.cx = round(toNumber(graphic.cx) + dx, 6);
    graphic.cy = round(toNumber(graphic.cy) + dy, 6);
  } else {
    graphic.x = round(toNumber(graphic.x) + dx, 6);
    graphic.y = round(toNumber(graphic.y) + dy, 6);
  }
  return graphic;
}

/** 平移焊盘或图形。 */
export function moveFootprintEntitiesCommand(ids, delta, options = {}) {
  const idSet = new Set(asIdList(ids));
  const dx = round(toNumber(delta && delta.x), 6);
  const dy = round(toNumber(delta && delta.y), 6);
  return createFootprintEditCommand(options.label || '移动', (draft) => {
    for (const pad of asArray(draft.pads)) {
      if (!pad || !idSet.has(pad.id)) continue;
      pad.x = round(toNumber(pad.x) + dx, 6);
      pad.y = round(toNumber(pad.y) + dy, 6);
    }
    for (const graphic of asArray(draft.graphics)) {
      if (!graphic || !idSet.has(graphic.id)) continue;
      translateGraphic(graphic, { x: dx, y: dy });
    }
    return { dx, dy };
  }, options);
}

/** 修改焊盘属性（w/h/shape/layer/drill/rotation/number/x/y）。 */
export function applyPadPatch(pad, patch) {
  if (!pad) return false;
  const source = patch && typeof patch === 'object' ? patch : {};
  if ('number' in source) pad.number = source.number === undefined || source.number === null ? '' : String(source.number);
  if ('x' in source) pad.x = round(toNumber(source.x), 6);
  if ('y' in source) pad.y = round(toNumber(source.y), 6);
  if ('w' in source && Number(source.w) > 0) pad.w = Number(source.w);
  if ('h' in source && Number(source.h) > 0) pad.h = Number(source.h);
  if ('shape' in source && PAD_SHAPES.includes(source.shape)) pad.shape = source.shape;
  if ('layer' in source && PAD_LAYERS.includes(source.layer)) pad.layer = source.layer;
  if ('drill' in source) pad.drill = Math.max(0, toNumber(source.drill));
  if ('rotation' in source) pad.rotation = round(normalizeDeg(toNumber(source.rotation)), 6);
  return true;
}

export function updatePadCommand(id, patch, options = {}) {
  return createFootprintEditCommand(options.label || '修改焊盘', (draft) => {
    const pad = asArray(draft.pads).find((item) => item && item.id === id);
    if (!pad) return false;
    return applyPadPatch(pad, patch);
  }, options);
}

/** 修改图形属性（layer/width/fill/text/size/rotation/x/y/w/h/points）。 */
export function applyGraphicPatch(graphic, patch) {
  if (!graphic) return false;
  const source = patch && typeof patch === 'object' ? patch : {};
  if ('layer' in source && FOOTPRINT_LAYERS.includes(source.layer)) graphic.layer = source.layer;
  if ('width' in source && Number(source.width) > 0) graphic.width = Number(source.width);
  if ('fill' in source) graphic.fill = source.fill === true;
  if ('text' in source) graphic.text = source.text === undefined || source.text === null ? '' : String(source.text);
  if ('size' in source && Number(source.size) > 0) graphic.size = Number(source.size);
  if ('rotation' in source) graphic.rotation = round(normalizeDeg(toNumber(source.rotation)), 6);
  if ('x' in source) graphic.x = round(toNumber(source.x), 6);
  if ('y' in source) graphic.y = round(toNumber(source.y), 6);
  if ('w' in source && Number(source.w) >= 0) graphic.w = Number(source.w);
  if ('h' in source && Number(source.h) >= 0) graphic.h = Number(source.h);
  if ('points' in source && Array.isArray(source.points)) {
    const points = source.points
      .map((point) => ({ x: round(toNumber(point && point.x), 6), y: round(toNumber(point && point.y), 6) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length >= 2) graphic.points = points;
  }
  return true;
}

export function updateGraphicCommand(id, patch, options = {}) {
  return createFootprintEditCommand(options.label || '修改图形', (draft) => {
    const graphic = asArray(draft.graphics).find((item) => item && item.id === id);
    if (!graphic) return false;
    return applyGraphicPatch(graphic, patch);
  }, options);
}

/** 添加封装图形（线/矩形等），自动补 id。 */
export function addGraphicCommand(graphic, options = {}) {
  const raw = graphic && typeof graphic === 'object' ? graphic : {};
  const normalized = normalizeGraphic(raw, {
    layers: FOOTPRINT_LAYERS,
    defaultLayer: options.layer || 'silkscreen',
  });
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : uid('gfx');
  return createFootprintEditCommand(options.label || '添加图形', (draft) => {
    if (!normalized) return null;
    draft.graphics.push({ ...clone(normalized), id });
    return id;
  }, options);
}

/** 创建封装命令门面。 */
export function createFootprintCommandApi(store) {
  if (!store || !store.commands) throw new TypeError('createFootprintCommandApi 需要 footprint store');
  const run = (command) => executeFootprintCommand(store, command);
  return {
    store,
    execute: run,
    addPad: (pad, options) => run(addPadCommand(pad, options)),
    removeEntities: (ids, options) => run(removeFootprintEntitiesCommand(ids, options)),
    moveEntities: (ids, delta, options) => run(moveFootprintEntitiesCommand(ids, delta, options)),
    addGraphic: (graphic, options) => run(addGraphicCommand(graphic, options)),
    updatePad: (id, patch, options) => run(updatePadCommand(id, patch, options)),
    updateGraphic: (id, patch, options) => run(updateGraphicCommand(id, patch, options)),
  };
}
