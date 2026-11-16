// 封装编辑文档：单个 FootprintDef + 撤销栈 + 选择/悬浮，无 DOM 依赖。
import { CommandStack } from '../core/command.js';
import { createBus } from '../core/event-bus.js';
import { uid } from '../core/id.js';
import { clone } from '../model/project.js';
import { normalizeFootprintDef } from '../library/footprint-library.js';
import { FOOTPRINT_LAYERS, normalizeGraphic } from '../library/graphic.js';

export const NEW_FOOTPRINT_ID = 'NEW_FOOTPRINT';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 规范化封装并补齐焊盘/图形的稳定 id（图形在库数据里没有 id，编辑期需要）。
 * @param {*} raw 原始封装
 * @returns {object} 可编辑的 FootprintDef
 */
export function prepareFootprint(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = typeof source.id === 'string' && source.id.trim() !== '' ? source.id.trim() : NEW_FOOTPRINT_ID;
  const normalized = normalizeFootprintDef({ ...source, id });

  const padIds = new Set();
  normalized.pads = asArray(normalized.pads).map((pad) => {
    let padId = pad.id;
    if (typeof padId !== 'string' || padId === '' || padIds.has(padId)) padId = uid('pad');
    padIds.add(padId);
    return { ...pad, id: padId };
  });

  const graphicIds = new Set();
  const graphics = [];
  asArray(source.graphics).forEach((rawGraphic) => {
    const graphic = normalizeGraphic(rawGraphic, {
      layers: FOOTPRINT_LAYERS,
      defaultLayer: 'silkscreen',
    });
    if (!graphic) return;
    let graphicId =
      rawGraphic && typeof rawGraphic.id === 'string' && rawGraphic.id !== '' ? rawGraphic.id : uid('gfx');
    if (graphicIds.has(graphicId)) graphicId = uid('gfx');
    graphicIds.add(graphicId);
    graphics.push({ ...graphic, id: graphicId });
  });
  normalized.graphics = graphics;
  return normalized;
}

/** 下一个可用焊盘编号（纯数字按最大值 +1，否则按数量 +1）。 */
export function nextPadNumber(footprint) {
  const pads = footprint && Array.isArray(footprint.pads) ? footprint.pads : [];
  let max = 0;
  for (const pad of pads) {
    const number = Number(pad && pad.number);
    if (Number.isFinite(number) && number > max) max = number;
  }
  return String(max > 0 ? max + 1 : pads.length + 1);
}

function sameIds(a, b) {
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

/**
 * 创建封装编辑状态仓库。
 * @param {object} [initialFootprint] 初始封装
 * @returns {object} footprint store API
 */
export function createFootprintStore(initialFootprint) {
  const bus = createBus();
  let current = prepareFootprint(initialFootprint);
  let selection = [];
  let hover = null;
  let commands = null;

  function getFootprint() {
    return current;
  }

  function getSelection() {
    return [...selection];
  }

  function setSelection(ids) {
    const next = Array.isArray(ids)
      ? [...new Set(ids.filter((id) => typeof id === 'string' && id !== ''))]
      : [];
    if (sameIds(selection, next)) return [...selection];
    selection = next;
    bus.emit('selection', { ids: [...next] });
    return [...selection];
  }

  function getHover() {
    return hover;
  }

  function setHover(id) {
    const next = typeof id === 'string' && id !== '' ? id : null;
    if (hover === next) return hover;
    hover = next;
    bus.emit('hover', { id: next });
    return hover;
  }

  function on(eventName, handler) {
    return bus.on(eventName, handler);
  }

  function emit(eventName, payload) {
    return bus.emit(eventName, payload);
  }

  /** 低层替换：供命令 do/undo 使用，不写历史、不发事件（由命令栈统一广播）。 */
  function applyFootprint(footprint) {
    current = prepareFootprint(footprint);
    return current;
  }

  function pruneSelection() {
    if (selection.length === 0) return;
    const alive = new Set();
    for (const pad of asArray(current.pads)) if (pad && pad.id) alive.add(pad.id);
    for (const graphic of asArray(current.graphics)) if (graphic && graphic.id) alive.add(graphic.id);
    const next = selection.filter((id) => alive.has(id));
    if (next.length === selection.length) return;
    selection = next;
    bus.emit('selection', { ids: [...next] });
  }

  const api = {
    getFootprint,
    applyFootprint,
    setFootprint(footprint, options = {}) {
      const normalized = prepareFootprint(footprint);
      if (options.history === true) {
        const before = clone(current);
        commands.execute({
          label: options.label || '加载封装',
          do() {
            current = clone(normalized);
          },
          undo() {
            current = clone(before);
          },
        });
      } else {
        current = normalized;
        selection = [];
        hover = null;
        commands.clear();
        bus.emit('selection', { ids: [] });
        bus.emit('hover', { id: null });
      }
      return current;
    },
    getSelection,
    setSelection,
    getHover,
    setHover,
    on,
    emit,
    undo() {
      return commands.undo();
    },
    redo() {
      return commands.redo();
    },
    canUndo() {
      return commands.canUndo();
    },
    canRedo() {
      return commands.canRedo();
    },
    commands: null,
    get footprint() {
      return current;
    },
  };

  commands = new CommandStack(api);
  api.commands = commands;

  /** 通过命令栈执行一次可撤销修改；mutator(footprint, store) 原地修改草稿。 */
  api.update = function update(mutator, options = {}) {
    if (typeof mutator !== 'function') {
      throw new TypeError('store.update 需要 mutator(footprint) 函数');
    }
    const label = options.label || '编辑封装';
    const before = clone(current);
    let after = null;
    commands.execute({
      label,
      do() {
        if (!after) {
          const draft = clone(before);
          mutator(draft, api);
          after = prepareFootprint(draft);
        }
        current = clone(after);
      },
      undo() {
        current = clone(before);
      },
    });
    return current;
  };

  commands.onChange((info) => {
    pruneSelection();
    bus.emit('changed', {
      footprint: current,
      reason: info.type,
      label: info.label,
    });
  });

  return api;
}
