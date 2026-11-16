// 封装编辑器：画布事件分发、缩放/平移、工具切换、快捷键与焊盘/图形属性命令。
import { createBus } from '../core/event-bus.js';
import { FootprintRenderer } from '../render/footprint-renderer.js';
import { createFootprintCommandApi } from './footprint-commands.js';
import {
  describeFootprintEntity,
  footprintBoundsOfIds,
  hitTestFootprint,
  hitTestFootprintBox,
} from './footprint-hit-test.js';
import { createFootprintStore } from './footprint-store.js';
import { createCanvasInteraction } from './interaction.js';
import { snapToGrid } from './snapping.js';
import { createFootprintSelectTool } from './footprint-tools/select-tool.js';
import { createPadTool } from './footprint-tools/pad-tool.js';
import { createMoveTool } from './footprint-tools/move-tool.js';
import { createGraphicTool } from './footprint-tools/graphic-tool.js';

const DEFAULT_GRID = 0.635;

const DEFAULT_TOOLS = Object.freeze({
  select: createFootprintSelectTool,
  pad: createPadTool,
  move: createMoveTool,
  graphic: createGraphicTool,
});

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isEditableTarget(target) {
  if (!target) return false;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable === true;
}

/**
 * 创建封装编辑器。
 * @param {object} config { canvas, store?, renderer?, options? }
 * @returns {object} 编辑器 API
 */
export function createFootprintEditor(config = {}) {
  const canvas = config.canvas;
  if (!canvas || typeof canvas.addEventListener !== 'function') {
    throw new TypeError('createFootprintEditor 需要 canvas');
  }
  const options = config.options && typeof config.options === 'object' ? config.options : {};
  if (config.store && typeof config.store.getFootprint !== 'function') {
    throw new TypeError('createFootprintEditor 的 store 必须是 createFootprintStore 创建的封装仓库');
  }
  const store = config.store || createFootprintStore(options.footprint);
  const renderer = config.renderer || new FootprintRenderer(canvas, {
    width: options.width,
    height: options.height,
    theme: options.theme,
  });
  const bus = options.bus || createBus();
  const busOwned = !options.bus;
  const commands = createFootprintCommandApi(store);
  const toolInstances = new Map();
  const offs = [];

  let api = null;
  let currentTool = null;
  let currentName = '';
  let gridOverride = toNumber(options.grid, 0) > 0 ? toNumber(options.grid) : 0;

  function getGrid() {
    return gridOverride > 0 ? gridOverride : DEFAULT_GRID;
  }

  function scaleOf() {
    const view = renderer.getView();
    const scale = view && Number(view.scale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function hitTestPoint(point, hitOptions = {}) {
    const tolerancePx = toNumber(hitOptions.tolerancePx, 6);
    return hitTestFootprint(store.getFootprint(), point, { tolerance: tolerancePx / scaleOf() });
  }

  function hitTestRect(rect) {
    return hitTestFootprintBox(store.getFootprint(), rect);
  }

  const ctx = {
    store,
    commands,
    renderer,
    bus,
    snapTolerancePx: 8,
    get editor() {
      return api;
    },
    get footprint() {
      return store.getFootprint();
    },
    get theme() {
      return renderer.theme;
    },
    screenToWorld(point) {
      return renderer.screenToWorld(point);
    },
    worldToScreen(point) {
      return renderer.worldToScreen(point);
    },
    snapPoint(point, snapOptions = {}) {
      void snapOptions;
      return snapToGrid(point, getGrid());
    },
    hitTest: hitTestPoint,
    hitTestBox: hitTestRect,
    hitTestPad(point, tolerancePx = 6) {
      return hitTestFootprint(store.getFootprint(), point, { tolerance: tolerancePx / scaleOf() });
    },
    boundsOfIds(ids) {
      return footprintBoundsOfIds(store.getFootprint(), ids);
    },
    describeEntity(id) {
      return describeFootprintEntity(store.getFootprint(), id);
    },
    requestRender() {
      if (renderer && typeof renderer.requestRender === 'function') renderer.requestRender();
      else if (renderer && typeof renderer.invalidate === 'function') renderer.invalidate();
    },
  };
  Object.defineProperty(ctx, 'grid', {
    enumerable: true,
    get: getGrid,
  });

  const originalOverlay = typeof renderer.paintOverlay === 'function' ? renderer.paintOverlay : null;
  renderer.paintOverlay = function paintFootprintOverlay(c2d) {
    if (originalOverlay) originalOverlay.call(renderer, c2d);
    if (!currentTool || typeof currentTool.drawOverlay !== 'function') return;
    try {
      currentTool.drawOverlay(c2d, ctx);
    } catch (error) {
      bus.emit('error', { error, source: 'drawOverlay' });
    }
  };

  function dispatch(method, event) {
    if (!currentTool || typeof currentTool[method] !== 'function') return false;
    try {
      return currentTool[method](event, ctx) === true;
    } catch (error) {
      bus.emit('error', { error, method });
      if (typeof options.onError === 'function') options.onError(error, method);
      return false;
    }
  }

  function ensureTool(name) {
    const key = String(name || '');
    if (toolInstances.has(key)) return toolInstances.get(key);
    const custom = options.tools && options.tools[key] ? options.tools[key] : null;
    const factory = custom || DEFAULT_TOOLS[key];
    if (!factory) return null;
    const tool = typeof factory === 'function' ? factory() : factory;
    if (!tool || typeof tool !== 'object') return null;
    toolInstances.set(key, tool);
    return tool;
  }

  function setTool(name, toolOptions = {}) {
    const next = ensureTool(name);
    if (!next) return false;
    if (currentTool && typeof currentTool.onDeactivate === 'function') {
      try {
        currentTool.onDeactivate(ctx);
      } catch (error) {
        bus.emit('error', { error, method: 'onDeactivate' });
      }
    }
    currentTool = next;
    currentName = String(name);
    interaction.setCursor(next.cursor || 'default');
    if (typeof next.onActivate === 'function') {
      try {
        next.onActivate(ctx, toolOptions && typeof toolOptions === 'object' ? toolOptions : {});
      } catch (error) {
        bus.emit('error', { error, method: 'onActivate' });
      }
    }
    bus.emit('tool', { name: currentName, tool: next, options: toolOptions || {} });
    ctx.requestRender();
    return true;
  }

  function updateHover(world) {
    const hit = hitTestPoint(world, { tolerancePx: 6 });
    store.setHover(hit ? hit.id : null);
  }

  function handleDoubleClick(event) {
    if (dispatch('onDoubleClick', event)) return;
    const hit = hitTestPoint(event.world, { tolerancePx: 6 });
    if (!hit) return;
    store.setSelection([hit.id]);
    const info = {
      id: hit.id,
      kind: hit.kind,
      entity: hit.entity,
      world: event.world,
      originalEvent: event.originalEvent,
    };
    bus.emit(hit.kind === 'pad' ? 'edit-pad' : 'edit-graphic', info);
    const callback = hit.kind === 'pad' ? options.onEditPad : options.onEditGraphic;
    if (typeof callback === 'function') callback(info);
  }

  function deleteSelection() {
    const footprint = store.getFootprint();
    const ids = store.getSelection().filter((id) => describeFootprintEntity(footprint, id) !== null);
    if (ids.length === 0) return false;
    commands.removeEntities(ids);
    return true;
  }

  function selectAll() {
    const footprint = store.getFootprint();
    const ids = [];
    for (const pad of Array.isArray(footprint.pads) ? footprint.pads : []) if (pad && pad.id) ids.push(pad.id);
    for (const graphic of Array.isArray(footprint.graphics) ? footprint.graphics : []) {
      if (graphic && graphic.id) ids.push(graphic.id);
    }
    store.setSelection(ids);
    return ids;
  }

  function handleKeyDown(event) {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (mod && (key === 'z' || key === 'Z')) {
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && (key === 'y' || key === 'Y')) {
      event.preventDefault();
      store.redo();
      return;
    }
    if (mod && (key === 'a' || key === 'A')) {
      event.preventDefault();
      selectAll();
      return;
    }
    if (dispatch('onKeyDown', event)) return;
    if (key === 'Escape') {
      if (store.getSelection().length > 0) {
        store.setSelection([]);
        return;
      }
      setTool('select');
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      deleteSelection();
    }
  }

  const interaction = createCanvasInteraction({
    canvas,
    renderer,
    options: {
      keyTarget: options.keyTarget,
      win: options.win,
      onViewChange: (view) => {
        bus.emit('view', view);
        if (typeof options.onViewChange === 'function') options.onViewChange(view);
      },
    },
    handlers: {
      onPointerDown(event) {
        if (isEditableTarget(event.originalEvent && event.originalEvent.target)) return;
        focusCanvas();
        dispatch('onPointerDown', event);
      },
      onPointerMove(event) {
        dispatch('onPointerMove', event);
        if (event.buttons === 0) updateHover(event.world);
      },
      onPointerUp(event) {
        dispatch('onPointerUp', event);
        if (event.buttons === 0) updateHover(event.world);
      },
      onPointerLeave(event) {
        dispatch('onPointerLeave', event);
        store.setHover(null);
      },
      onDoubleClick(event) {
        handleDoubleClick(event);
      },
      onKeyDown(event) {
        handleKeyDown(event);
      },
      onKeyUp(event) {
        dispatch('onKeyUp', event);
      },
    },
  });

  function focusCanvas() {
    try {
      if (canvas.tabIndex === undefined || canvas.tabIndex < 0) canvas.tabIndex = 0;
      if (typeof canvas.focus === 'function') canvas.focus();
    } catch {
      // 测试替身不支持 focus 时忽略。
    }
  }

  function refresh() {
    renderer.setState({ footprint: store.getFootprint() });
    if (typeof renderer.setSelection === 'function') renderer.setSelection(store.getSelection());
    if (typeof renderer.setHover === 'function') renderer.setHover(store.getHover());
    if (typeof renderer.setGrid === 'function') renderer.setGrid(getGrid());
    ctx.requestRender();
  }

  function fitToContent(padding = 40) {
    if (typeof renderer.fitToContent === 'function') renderer.fitToContent(padding);
    bus.emit('view', renderer.getView());
    ctx.requestRender();
    return renderer.getView();
  }

  api = {
    getCanvas() {
      return canvas;
    },
    getStore() {
      return store;
    },
    getRenderer() {
      return renderer;
    },
    getCommands() {
      return commands;
    },
    getBus() {
      return bus;
    },
    getContext() {
      return ctx;
    },
    getFootprint() {
      return store.getFootprint();
    },
    setFootprint(footprint, setOptions = {}) {
      const next = store.setFootprint(footprint, setOptions);
      refresh();
      return next;
    },
    getTool() {
      return currentName;
    },
    getActiveTool() {
      return currentTool;
    },
    getToolName() {
      return currentName;
    },
    listTools() {
      return Object.keys(DEFAULT_TOOLS);
    },
    setTool,
    refresh,
    focus: focusCanvas,
    destroy() {
      if (currentTool && typeof currentTool.onDeactivate === 'function') {
        try {
          currentTool.onDeactivate(ctx);
        } catch {
          // 销毁阶段忽略工具清理异常。
        }
      }
      currentTool = null;
      interaction.destroy();
      for (const off of offs) if (typeof off === 'function') off();
      offs.length = 0;
      if (originalOverlay) renderer.paintOverlay = originalOverlay;
      else delete renderer.paintOverlay;
      if (busOwned) bus.clear();
    },
    undo() {
      return store.undo();
    },
    redo() {
      return store.redo();
    },
    canUndo() {
      return store.canUndo();
    },
    canRedo() {
      return store.canRedo();
    },
    deleteSelection,
    selectAll,
    setSelection(ids) {
      return store.setSelection(ids);
    },
    getSelection() {
      return store.getSelection();
    },
    getGrid,
    setGrid(grid) {
      const value = toNumber(grid, 0);
      gridOverride = value > 0 ? value : 0;
      if (typeof renderer.setGrid === 'function') renderer.setGrid(getGrid());
      bus.emit('grid', { grid: getGrid() });
      ctx.requestRender();
      return getGrid();
    },
    getLayer() {
      return currentTool && typeof currentTool.getLayer === 'function' ? currentTool.getLayer() : 'silkscreen';
    },
    setLayer(layer) {
      const ok = currentTool && typeof currentTool.setLayer === 'function' ? currentTool.setLayer(layer) : false;
      if (ok) ctx.requestRender();
      return ok;
    },
    getGraphicShape() {
      return currentTool && typeof currentTool.getShape === 'function' ? currentTool.getShape() : 'line';
    },
    setGraphicShape(shape) {
      const ok = currentTool && typeof currentTool.setShape === 'function' ? currentTool.setShape(shape) : false;
      if (ok) ctx.requestRender();
      return ok;
    },
    setPadProperties(id, patch) {
      return commands.updatePad(id, patch);
    },
    setGraphicProperties(id, patch) {
      return commands.updateGraphic(id, patch);
    },
    fitToContent,
    getView() {
      return renderer.getView();
    },
    setView(view) {
      renderer.setView(view);
      bus.emit('view', renderer.getView());
      ctx.requestRender();
      return renderer.getView();
    },
    screenToWorld(point) {
      return renderer.screenToWorld(point);
    },
    worldToScreen(point) {
      return renderer.worldToScreen(point);
    },
    isPanning() {
      return interaction.isPanning();
    },
    on(eventName, handler) {
      return bus.on(eventName, handler);
    },
    off(eventName, handler) {
      return bus.off(eventName, handler);
    },
    emit(eventName, payload) {
      return bus.emit(eventName, payload);
    },
  };

  offs.push(store.on('changed', () => {
    renderer.setState({ footprint: store.getFootprint() });
    ctx.requestRender();
  }));
  offs.push(store.on('selection', (payload) => {
    if (renderer && typeof renderer.setSelection === 'function') renderer.setSelection(payload.ids);
    ctx.requestRender();
  }));
  offs.push(store.on('hover', (payload) => {
    if (renderer && typeof renderer.setHover === 'function') renderer.setHover(payload.id);
    ctx.requestRender();
  }));

  refresh();
  setTool(options.tool || 'select');

  return api;
}
