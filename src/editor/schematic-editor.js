// 原理图编辑器：canvas 事件分发、滚轮缩放、中键/空格平移、双击属性、快捷键与 store 同步。
import { createBus } from '../core/event-bus.js';
import { ENTITY_COLLECTIONS, findEntityWithKind } from '../model/project.js';
import { SchematicRenderer } from '../render/renderer.js';
import { createCommandApi } from './commands.js';
import { createCanvasInteraction } from './interaction.js';
import { collectAnchors, findSnapPoint, snapToGrid, DEFAULT_GRID } from './snapping.js';
import { createSymbolResolver } from './symbol-resolver.js';
import { hitTest, hitTestBox } from './hit-test.js';
import { createSelectTool } from './tools/select-tool.js';
import { createWireTool } from './tools/wire-tool.js';
import { createPlaceTool } from './tools/place-tool.js';
import { createLabelTool } from './tools/label-tool.js';
import { createTextTool } from './tools/text-tool.js';
import { createEraseTool } from './tools/erase-tool.js';

const DEFAULT_TOOLS = Object.freeze({
  select: createSelectTool,
  wire: createWireTool,
  place: createPlaceTool,
  label: createLabelTool,
  text: createTextTool,
  erase: createEraseTool,
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
 * 创建原理图编辑器。
 * @param {object} config { canvas, store, renderer?, options? }
 * @returns {object} 编辑器 API
 */
export function createSchematicEditor(config = {}) {
  const canvas = config.canvas;
  const store = config.store;
  if (!canvas || typeof canvas.addEventListener !== 'function') {
    throw new TypeError('createSchematicEditor 需要 canvas');
  }
  if (!store || typeof store.getProject !== 'function' || !store.commands) {
    throw new TypeError('createSchematicEditor 需要 store');
  }
  const options = config.options && typeof config.options === 'object' ? config.options : {};
  const renderer = config.renderer || new SchematicRenderer(canvas, {
    width: options.width,
    height: options.height,
    theme: options.theme,
    grid: options.rendererGrid,
  });
  const bus = options.bus || createBus();
  const busOwned = !options.bus;
  const commands = createCommandApi(store);
  const symbolResolver = createSymbolResolver(store.getProject(), options);
  const toolInstances = new Map();
  const offs = [];

  let api = null;
  let currentTool = null;
  let currentName = '';
  let gridOverride = toNumber(options.grid, 0) > 0 ? toNumber(options.grid) : 0;

  function getGrid() {
    if (gridOverride > 0) return gridOverride;
    const project = store.getProject();
    const grid = project ? toNumber(project.grid, DEFAULT_GRID) : DEFAULT_GRID;
    return grid > 0 ? grid : DEFAULT_GRID;
  }

  function scaleOf() {
    const view = renderer.getView();
    const scale = view && Number(view.scale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function getAnchors(snapOptions = {}) {
    return collectAnchors(store.getProject(), store.getSheet(), {
      resolveSymbol: symbolResolver,
      excludeIds: snapOptions.excludeIds,
      tolerance: snapOptions.tolerance,
    });
  }

  function findSnap(point, tolerancePx = 10) {
    const anchors = getAnchors();
    return findSnapPoint(anchors, point, toNumber(tolerancePx, 10) / scaleOf());
  }

  function snapPoint(point, snapOptions = {}) {
    const tolerancePx = toNumber(snapOptions.tolerancePx, 10);
    if (snapOptions.useAnchors !== false) {
      const anchors = getAnchors({ excludeIds: snapOptions.excludeIds });
      const hit = findSnapPoint(anchors, point, tolerancePx / scaleOf());
      if (hit) return hit;
    }
    return snapToGrid(point, getGrid());
  }

  function hitTestPoint(point, hitOptions = {}) {
    const tolerancePx = toNumber(hitOptions.tolerancePx, 6);
    return hitTest(store.getSheet(), point, {
      tolerance: tolerancePx / scaleOf(),
      resolveSymbol: symbolResolver,
    });
  }

  function hitTestRect(rect) {
    return hitTestBox(store.getSheet(), rect, { resolveSymbol: symbolResolver });
  }

  const ctx = {
    store,
    commands,
    renderer,
    bus,
    placement: null,
    snapTolerancePx: 10,
    get editor() {
      return api;
    },
    get project() {
      return store.getProject();
    },
    get sheet() {
      return store.getSheet();
    },
    get sheetId() {
      return store.getSheetId();
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
    snapToGrid(point) {
      return snapToGrid(point, getGrid());
    },
    getAnchors,
    findSnapPoint: findSnap,
    snapPoint,
    hitTest: hitTestPoint,
    hitTestBox: hitTestRect,
    resolveSymbol: (symbolId) => symbolResolver(symbolId),
    requestRender() {
      if (renderer && typeof renderer.requestRender === 'function') renderer.requestRender();
      else if (renderer && typeof renderer.invalidate === 'function') renderer.invalidate();
    },
    setSelection(ids) {
      return store.setSelection(ids);
    },
    getSelection() {
      return store.getSelection();
    },
  };
  Object.defineProperty(ctx, 'grid', {
    enumerable: true,
    get: getGrid,
  });

  // overlay 预览：接管渲染器的 paintOverlay 钩子，保持单画布与 DPR 一致。
  const originalOverlay = typeof renderer.paintOverlay === 'function' ? renderer.paintOverlay : null;
  if (renderer && typeof renderer === 'object') {
    renderer.paintOverlay = function paintEditorOverlay(c2d) {
      if (originalOverlay) originalOverlay.call(renderer, c2d);
      if (!currentTool || typeof currentTool.drawOverlay !== 'function') return;
      try {
        currentTool.drawOverlay(c2d, ctx);
      } catch (error) {
        bus.emit('error', { error, source: 'drawOverlay' });
      }
    };
  }

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
    if (currentName === 'place') ctx.placement = toolOptions && typeof toolOptions === 'object' ? toolOptions : {};
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
    bus.emit('edit-entity', info);
    if (typeof options.onEditEntity === 'function') options.onEditEntity(info);
  }

  function deleteSelection() {
    const sheet = store.getSheet();
    const ids = store
      .getSelection()
      .filter((id) => sheet && findEntityWithKind(sheet, id) !== null);
    if (ids.length === 0) return false;
    commands.removeEntities(store.getSheetId(), ids);
    return true;
  }

  function selectAll() {
    const sheet = store.getSheet();
    if (!sheet) return [];
    const ids = [];
    for (const kind of ENTITY_COLLECTIONS) {
      for (const entity of Array.isArray(sheet[kind]) ? sheet[kind] : []) {
        if (entity && typeof entity.id === 'string') ids.push(entity.id);
      }
    }
    store.setSelection(ids);
    return ids;
  }

  function undo() {
    const changed = store.undo();
    return changed !== null && changed !== undefined;
  }

  function redo() {
    const changed = store.redo();
    return changed !== null && changed !== undefined;
  }

  function handleKeyDown(event) {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (mod && (key === 'z' || key === 'Z')) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && (key === 'y' || key === 'Y')) {
      event.preventDefault();
      redo();
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
      onViewChange: (view) => store.setView(view),
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
      // 测试替身或受限环境不支持 focus 时忽略。
    }
  }

  function refresh() {
    symbolResolver.refresh(store.getProject());
    renderer.setState({ project: store.getProject(), sheet: store.getSheet() });
    if (typeof renderer.setSelection === 'function') renderer.setSelection(store.getSelection());
    if (typeof renderer.setHover === 'function') renderer.setHover(store.getHover());
    if (typeof renderer.setGrid === 'function') renderer.setGrid(getGrid());
    ctx.requestRender();
  }

  function fitToContent(padding = 48) {
    if (typeof renderer.fitToContent === 'function') renderer.fitToContent(padding);
    const view = renderer.getView();
    store.setView(view);
    ctx.requestRender();
    return view;
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
    getSymbolResolver() {
      return (symbolId) => symbolResolver(symbolId);
    },
    getBus() {
      return bus;
    },
    getContext() {
      return ctx;
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
          // 销毁阶段忽略工具的清理异常。
        }
      }
      currentTool = null;
      interaction.destroy();
      for (const off of offs) {
        if (typeof off === 'function') off();
      }
      offs.length = 0;
      if (typeof renderer === 'object' && renderer) {
        if (originalOverlay) renderer.paintOverlay = originalOverlay;
        else delete renderer.paintOverlay;
      }
      if (busOwned) bus.clear();
    },
    undo,
    redo,
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
    fitToContent,
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

  offs.push(store.on('changed', (payload) => {
    const project = payload && payload.project ? payload.project : store.getProject();
    const sheet = payload && payload.sheet ? payload.sheet : store.getSheet();
    symbolResolver.refresh(project);
    renderer.setState({ project, sheet });
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
  offs.push(store.on('view', (view) => {
    renderer.setView(view);
    ctx.requestRender();
  }));
  offs.push(store.on('sheet', (payload) => {
    renderer.setState({ project: store.getProject(), sheet: payload && payload.sheet ? payload.sheet : store.getSheet() });
    if (renderer && typeof renderer.setSelection === 'function') renderer.setSelection(store.getSelection());
    ctx.requestRender();
  }));

  refresh();
  if (store.getView()) renderer.setView(store.getView());
  else store.setView(renderer.getView());
  setTool(options.tool || 'select');

  return api;
}
