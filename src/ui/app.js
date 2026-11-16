// 应用组合根：创建上下文、装配面板/编辑器/快捷键，并把动作委托给 ui/ 下的独立模块。
import { createDefaultLibraries } from '../library/index.js';
import { loadFromLocalStorage } from '../io/project-io.js';
import { createStore } from '../model/store.js';
import { DEFAULT_THEME } from '../render/theme.js';
import { clear, el } from './dom.js';
import { hasOpenModal, openModal } from './dialogs/modal.js';
import { openShortcutsDialog } from './dialogs/help-dialog.js';
import { bindHotkeys } from './hotkeys.js';
import { buildLayout, createModeBar } from './layout.js';
import { createLayersPanel } from './panels/layers-panel.js';
import { createLibraryPanel } from './panels/library-panel.js';
import { createNetlistPanel } from './panels/netlist-panel.js';
import { createPropertiesPanel } from './panels/properties-panel.js';
import { applyDefaultLibraries, createInitialProject } from './project-setup.js';
import { createSheetTabs } from './sheet-tabs.js';
import { createStatusBar } from './status-bar.js';
import { createToastHost } from './toast.js';
import { createToolbar } from './toolbar.js';
import { isWelcomeDismissed, openWelcomeDialog } from './welcome.js';
import { createChromeSync } from './chrome-sync.js';
import { createEditActions } from './edit-actions.js';
import { createEditorSetup } from './editor-setup.js';
import { createFileActions } from './file-actions.js';
import { createFootprintMode } from './footprint-mode.js';
import { createSheetActions } from './sheet-actions.js';
import { buildToolbarActions } from './toolbar-actions.js';
import { messageOf } from './ui-utils.js';

export const APP_VERSION = '0.1.0';
const DRAFT_KEY = 'draft';

/**
 * 启动应用。
 * @param {HTMLElement} [rootEl] 挂载节点，默认 #app
 * @param {object} [options] { project, libraries, storage }
 * @returns {Promise<object>} 应用 API
 */
export async function startApp(rootEl, options = {}) {
  if (typeof document === 'undefined') {
    throw new Error('startApp 需要浏览器环境（document 不可用）');
  }
  const root = rootEl || document.getElementById('app');
  if (!root) throw new Error('startApp 找不到挂载节点（#app）');

  // 组合根上下文：所有可变状态与动作集中在此，独立模块只通过 ctx 访问。
  const ctx = {
    appVersion: APP_VERSION,
    libs: null,
    store: null,
    layout: null,
    toasts: null,
    toolbar: null,
    libraryPanel: null,
    propertiesPanel: null,
    netlistPanel: null,
    layersPanel: null,
    sheetTabs: null,
    statusBar: null,
    modeBar: null,
    schematicEditor: null,
    footprintEditor: null,
    hotkeys: null,
    resizeObserver: null,
    resizeFrame: null,
    mode: 'schematic',
    snapEnabled: true,
    lastNetlist: null,
    lastSymbolId: null,
    lastFootprintId: null,
    padLayer: 'top',
    dirty: false,
    footprintDirty: false,
    pointerWorld: null,
    librarySignatureCache: '',
    destroyed: false,
  };

  // ---- 错误与提示 ----
  ctx.handleError = function handleError(error, context) {
    console.error('[schematic-studio] ' + context, error);
    if (ctx.toasts) ctx.toasts.error(context + '失败：' + messageOf(error));
  };

  ctx.showToast = function showToast(message, type = 'info') {
    if (!ctx.toasts) return;
    const fn = ctx.toasts[type];
    if (typeof fn === 'function') fn(message);
    else ctx.toasts.info(message);
  };

  ctx.showMessageDialog = function showMessageDialog(title, lines) {
    const body = el('div', { class: 'dialog-lines' }, (Array.isArray(lines) ? lines : []).slice(0, 24)
      .map((line) => el('p', { text: String(line) })));
    openModal({
      root: ctx.layout.modalRoot,
      title,
      body,
      width: 560,
      actions: [{ label: '关闭', kind: 'primary', autofocus: true }],
    });
  };

  // ---- 动作模块（通过 ctx 双向引用，调用发生在装配完成之后） ----
  Object.assign(ctx, createChromeSync(ctx));
  Object.assign(ctx, createEditorSetup(ctx));
  Object.assign(ctx, createFootprintMode(ctx));
  Object.assign(ctx, createFileActions(ctx));
  Object.assign(ctx, createEditActions(ctx));
  Object.assign(ctx, createSheetActions(ctx));
  ctx.toolbarActions = buildToolbarActions(ctx);

  // ---- 布局装配 ----
  ctx.libs = options.libraries || createDefaultLibraries();
  ctx.layout = buildLayout(root);
  ctx.toasts = createToastHost(ctx.layout.toastRoot);
  const initialProject = options.project
    ? applyDefaultLibraries(options.project, ctx.libs)
    : createInitialProject({ libraries: ctx.libs });
  ctx.store = createStore(initialProject);

  ctx.toolbar = createToolbar({ actions: ctx.toolbarActions });
  ctx.layout.topBar.append(ctx.toolbar.menuBar, ctx.toolbar.toolbar);

  ctx.libraryPanel = createLibraryPanel({
    getSymbols: () => ctx.store.getProject().library.symbols,
    getFootprints: () => ctx.store.getProject().library.footprints,
    onPlaceSymbol: (symbolId) => ctx.placeSymbol(symbolId),
    onEditFootprint: (footprintId) => { void ctx.editFootprint(footprintId); },
    onNewFootprint: () => { void ctx.newFootprint(); },
    theme: DEFAULT_THEME,
  });
  ctx.layout.librarySlot.appendChild(ctx.libraryPanel.element);

  ctx.layersPanel = createLayersPanel({
    theme: DEFAULT_THEME,
    onGraphicLayer: (layer) => {
      if (ctx.mode === 'footprint' && ctx.footprintEditor && ctx.footprintEditor.getTool() === 'graphic') {
        ctx.footprintEditor.setLayer(layer);
      }
    },
    onGraphicShape: (shape) => {
      if (ctx.mode === 'footprint' && ctx.footprintEditor && ctx.footprintEditor.getTool() === 'graphic') {
        ctx.footprintEditor.setGraphicShape(shape);
      }
    },
    onPadLayer: (layer) => {
      ctx.padLayer = layer;
      if (ctx.mode === 'footprint' && ctx.footprintEditor && ctx.footprintEditor.getTool() === 'pad') {
        ctx.footprintEditor.setLayer(layer);
      }
    },
  });
  ctx.layout.layersSlot.appendChild(ctx.layersPanel.element);

  ctx.propertiesPanel = createPropertiesPanel({
    store: ctx.store,
    getEditor: () => ctx.schematicEditor,
    getSymbols: () => ctx.store.getProject().library.symbols,
    getFootprints: () => ctx.store.getProject().library.footprints,
    getMode: () => ctx.mode,
    onSaveFootprint: () => ctx.saveFootprintToLibrary(),
    onExitFootprint: () => { void ctx.exitFootprintMode(); },
    notify: (message, type) => ctx.showToast(message, type),
  });
  ctx.layout.propertiesSlot.appendChild(ctx.propertiesPanel.element);

  ctx.netlistPanel = createNetlistPanel({
    onGenerate: () => ctx.generateNetlist(),
    onExport: () => ctx.openNetlistDialog(),
    onLocate: (target) => ctx.locateTarget(target),
  });
  ctx.layout.netlistSlot.appendChild(ctx.netlistPanel.element);

  ctx.sheetTabs = createSheetTabs({
    store: ctx.store,
    onSelect: (sheetId) => {
      ctx.store.setSheetId(sheetId);
      ctx.syncChrome();
    },
    onNew: () => ctx.createSheetAction(),
    onRename: (sheetId, name) => { void ctx.renameSheetAction(sheetId, name); },
    onDelete: (sheetId) => { void ctx.deleteSheetAction(sheetId); },
  });
  ctx.layout.sheetTabsSlot.appendChild(ctx.sheetTabs.element);

  ctx.statusBar = createStatusBar();
  ctx.layout.statusSlot.appendChild(ctx.statusBar.element);

  ctx.modeBar = createModeBar({
    onTool: (tool) => ctx.setFootprintTool(tool),
    onUndo: () => ctx.undoActive(),
    onRedo: () => ctx.redoActive(),
    onDelete: () => ctx.deleteActive(),
    onFit: () => ctx.fitActive(),
    onSave: () => ctx.saveFootprintToLibrary(),
    onExit: () => { void ctx.exitFootprintMode(); },
  });
  ctx.layout.modeBarSlot.appendChild(ctx.modeBar.element);

  // ---- 事件接线 ----
  ctx.bindPointerStatus(ctx.layout.schematicCanvas);
  ctx.bindPointerStatus(ctx.layout.footprintCanvas);
  ctx.layout.fileInput.addEventListener('change', () => { void ctx.handleFileInputChange(); });

  ctx.store.on('changed', () => {
    ctx.dirty = true;
    ctx.netlistPanel.setStale(true);
    const nextSignature = ctx.librarySignature();
    if (nextSignature !== ctx.librarySignatureCache) {
      ctx.librarySignatureCache = nextSignature;
      ctx.libraryPanel.refresh();
    }
    ctx.syncChrome();
  });
  ctx.store.on('selection', () => ctx.syncChrome());
  ctx.store.on('sheet', () => {
    ctx.pointerWorld = null;
    ctx.syncChrome();
    ctx.updateEmptyHint();
  });
  ctx.store.on('view', () => ctx.updateStatusOnly());

  ctx.librarySignatureCache = ctx.librarySignature();
  ctx.ensureSchematicEditor();

  ctx.hotkeys = bindHotkeys({
    target: window,
    isBlocked: () => hasOpenModal(),
    handlers: {
      newProject: () => { void ctx.newProject(); },
      save: () => ctx.saveProject(),
      saveAs: () => { void ctx.saveProjectAs(); },
      open: () => ctx.openProject(),
      exportNetlist: () => ctx.openNetlistDialog(),
      wireTool: () => ctx.wireTool(),
      selectTool: () => ctx.selectTool(),
      gridSnap: () => {
        if (ctx.mode === 'schematic' && ctx.schematicEditor && ctx.schematicEditor.getTool() === 'label') return;
        ctx.toggleGridSnap();
      },
      rotate: () => ctx.rotateSelectionByHotkey(),
      mirror: () => ctx.mirrorSelectionByHotkey(),
      zoomIn: () => ctx.zoomBy(1.25),
      zoomOut: () => ctx.zoomBy(0.8),
      fit: () => ctx.fitActive(),
      help: () => openShortcutsDialog({ root: ctx.layout.modalRoot }),
    },
  });

  function scheduleResizeHandler() {
    ctx.scheduleResize();
  }

  function onBeforeUnload(event) {
    if (!ctx.dirty && !(ctx.mode === 'footprint' && ctx.footprintDirty)) return undefined;
    if (event) {
      event.preventDefault();
      event.returnValue = '';
    }
    return '';
  }

  function onWindowError(event) {
    console.error('[schematic-studio] 未捕获错误', event.error || event.message);
    if (ctx.toasts) ctx.toasts.error('运行错误：' + (event.message || '未知错误'));
  }

  function onUnhandledRejection(event) {
    console.error('[schematic-studio] 未处理的 Promise 异常', event.reason);
    if (ctx.toasts) ctx.toasts.error('未处理的异常：' + messageOf(event.reason));
  }

  if (typeof ResizeObserver === 'function') {
    ctx.resizeObserver = new ResizeObserver(() => ctx.scheduleResize());
    ctx.resizeObserver.observe(ctx.layout.canvasStack);
  }
  window.addEventListener('resize', scheduleResizeHandler);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  ctx.syncChrome();
  ctx.updateEmptyHint();
  requestAnimationFrame(() => {
    if (ctx.destroyed) return;
    ctx.resizeActive();
    try {
      ctx.schematicEditor.fitToContent(48);
    } catch (error) {
      console.warn('[schematic-studio] 初始视图适配失败', error);
    }
    ctx.syncChrome();
  });

  setTimeout(() => {
    if (ctx.destroyed) return;
    if (!isWelcomeDismissed(options.storage)) {
      openWelcomeDialog({
        root: ctx.layout.modalRoot,
        storage: options.storage,
        version: APP_VERSION,
      });
    }
  }, 350);

  try {
    if (loadFromLocalStorage(DRAFT_KEY)) {
      ctx.toasts.info('检测到本地草稿，可从「文件 → 恢复本地草稿」打开', { timeout: 4800 });
    }
  } catch {
    // 本地存储不可用时不打扰用户。
  }

  function destroy() {
    if (ctx.destroyed) return;
    ctx.destroyed = true;
    if (ctx.hotkeys && typeof ctx.hotkeys.unbind === 'function') ctx.hotkeys.unbind();
    if (ctx.resizeObserver) {
      ctx.resizeObserver.disconnect();
      ctx.resizeObserver = null;
    }
    if (ctx.resizeFrame !== null) {
      cancelAnimationFrame(ctx.resizeFrame);
      ctx.resizeFrame = null;
    }
    window.removeEventListener('resize', scheduleResizeHandler);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    if (ctx.schematicEditor) {
      ctx.schematicEditor.destroy();
      ctx.schematicEditor = null;
    }
    if (ctx.footprintEditor) {
      ctx.footprintEditor.destroy();
      ctx.footprintEditor = null;
    }
    ctx.propertiesPanel?.destroy();
    ctx.libraryPanel?.destroy();
    ctx.sheetTabs?.destroy();
    ctx.toolbar?.destroy();
    ctx.toasts?.clear();
    clear(root);
  }

  return {
    version: APP_VERSION,
    root,
    layout: ctx.layout,
    store: ctx.store,
    libraries: ctx.libs,
    getEditor: () => ctx.schematicEditor,
    getFootprintEditor: () => ctx.footprintEditor,
    getMode: () => ctx.mode,
    getNetlist: () => ctx.lastNetlist,
    syncChrome: ctx.syncChrome,
    refresh: ctx.refreshEverything,
    newProject: ctx.newProject,
    openProject: ctx.openProject,
    saveProject: ctx.saveProject,
    saveProjectAs: ctx.saveProjectAs,
    generateNetlist: ctx.generateNetlist,
    openNetlistDialog: ctx.openNetlistDialog,
    exportSvg: ctx.exportSvg,
    exportPng: ctx.exportPng,
    exportFootprints: ctx.exportFootprints,
    restoreDraft: ctx.restoreDraft,
    locateTarget: ctx.locateTarget,
    enterFootprintMode: ctx.enterFootprintMode,
    exitFootprintMode: ctx.exitFootprintMode,
    toggleFootprintMode: ctx.toggleFootprintMode,
    saveFootprintToLibrary: ctx.saveFootprintToLibrary,
    showToast: ctx.showToast,
    destroy,
  };
}
