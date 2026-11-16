// 应用装配层：把 store、库、渲染器、编辑器、面板、对话框与快捷键组装成可运行原理图工具。
import { uid } from '../core/id.js';
import { createFootprintEditor } from '../editor/footprint-editor.js';
import { createFootprintStore, NEW_FOOTPRINT_ID } from '../editor/footprint-store.js';
import { boundsOfIds } from '../editor/hit-test.js';
import { createSchematicEditor } from '../editor/schematic-editor.js';
import { createDefaultLibraries } from '../library/index.js';
import {
  deserializeProject,
  downloadBlob,
  downloadText,
  loadFromLocalStorage,
  saveToLocalStorage,
  serializeProject,
  PROJECT_FILE_MIME,
} from '../io/project-io.js';
import { exportSheetPNG } from '../io/png-export.js';
import { projectToSVG } from '../io/svg-export.js';
import { ENTITY_COLLECTIONS, clone, createSheet, findSheetById } from '../model/project.js';
import { createStore } from '../model/store.js';
import { buildNetlist } from '../netlist/index.js';
import { DEFAULT_THEME } from '../render/theme.js';
import { clear, el } from './dom.js';
import { confirmDialog, hasOpenModal, openModal, promptDialog } from './dialogs/modal.js';
import { openExportDialog } from './dialogs/export-dialog.js';
import { openAboutDialog, openShortcutsDialog, openTipsDialog } from './dialogs/help-dialog.js';
import { getExampleProject } from './example-projects.js';
import { bindHotkeys } from './hotkeys.js';
import { buildLayout, createModeBar } from './layout.js';
import { createLayersPanel } from './panels/layers-panel.js';
import { createLibraryPanel } from './panels/library-panel.js';
import { createNetlistPanel } from './panels/netlist-panel.js';
import { createPropertiesPanel } from './panels/properties-panel.js';
import {
  applyDefaultLibraries,
  createInitialProject,
  exportFileName,
  footprintLibraryDocument,
  projectBaseName,
  projectFileName,
} from './project-setup.js';
import { createSheetTabs } from './sheet-tabs.js';
import { createStatusBar } from './status-bar.js';
import { createToastHost } from './toast.js';
import { createToolbar } from './toolbar.js';
import { footprintLabel, nextSheetName, sheetLabel } from './view-model.js';
import { isWelcomeDismissed, openWelcomeDialog } from './welcome.js';

export const APP_VERSION = '0.1.0';

const DRAFT_KEY = 'draft';
const FOOTPRINT_DEFAULT_NAME = '新建封装';

function messageOf(error) {
  return error && typeof error.message === 'string' ? error.message : String(error);
}

function readFileText(file) {
  if (file && typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result === undefined || reader.result === null ? '' : reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

function sheetEntityCount(sheet) {
  if (!sheet) return 0;
  return ENTITY_COLLECTIONS.reduce((sum, key) => sum + (Array.isArray(sheet[key]) ? sheet[key].length : 0), 0);
}

function svgFileName(project, sheet) {
  return exportFileName(project, sheet ? sheetLabel(sheet) : '', 'svg');
}

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

  let libs = null;
  let store = null;
  let layout = null;
  let toasts = null;
  let toolbar = null;
  let libraryPanel = null;
  let propertiesPanel = null;
  let netlistPanel = null;
  let layersPanel = null;
  let sheetTabs = null;
  let statusBar = null;
  let modeBar = null;
  let schematicEditor = null;
  let footprintEditor = null;
  let hotkeys = null;
  let resizeObserver = null;
  let resizeFrame = null;
  let mode = 'schematic';
  let snapEnabled = true;
  let lastNetlist = null;
  let lastSymbolId = null;
  let lastFootprintId = null;
  let padLayer = 'top';
  let dirty = false;
  let footprintDirty = false;
  let pointerWorld = null;
  let librarySignatureCache = '';
  let destroyed = false;

  // ---- 派生状态 ----

  function activeEditor() {
    return mode === 'footprint' ? footprintEditor : schematicEditor;
  }

  function activeSelection() {
    if (mode === 'footprint') {
      return footprintEditor ? footprintEditor.getStore().getSelection() : [];
    }
    return store ? store.getSelection() : [];
  }

  function activeCanUndo() {
    if (mode === 'footprint') return footprintEditor ? footprintEditor.canUndo() : false;
    return store ? store.canUndo() : false;
  }

  function activeCanRedo() {
    if (mode === 'footprint') return footprintEditor ? footprintEditor.canRedo() : false;
    return store ? store.canRedo() : false;
  }

  function librarySignature() {
    const project = store.getProject();
    const symbols = Array.isArray(project.library.symbols) ? project.library.symbols : [];
    const footprints = Array.isArray(project.library.footprints) ? project.library.footprints : [];
    return symbols.map((symbol) => (symbol ? symbol.id : '')).join(',') + '|' +
      footprints.map((footprint) => footprint
        ? footprint.id + ':' + (footprint.name || '') + ':' + (Array.isArray(footprint.pads) ? footprint.pads.length : 0)
        : '').join(',');
  }

  function buildUiState() {
    const editor = activeEditor();
    const project = store.getProject();
    return {
      mode,
      tool: editor ? editor.getTool() : '',
      canUndo: activeCanUndo(),
      canRedo: activeCanRedo(),
      selectionCount: activeSelection().length,
      snap: snapEnabled,
      projectName: project ? project.name : '',
      dirty: dirty || (mode === 'footprint' && footprintDirty),
    };
  }

  function statusState() {
    const editor = activeEditor();
    const project = store.getProject();
    const sheet = store.getSheet();
    const view = editor ? editor.getRenderer().getView() : { scale: 1 };
    return {
      pointer: pointerWorld,
      grid: editor ? editor.getGrid() : (project && project.grid) || 2.54,
      scale: view && view.scale ? view.scale : 1,
      tool: editor ? editor.getTool() : '',
      netCount: lastNetlist && Array.isArray(lastNetlist.nets) ? lastNetlist.nets.length : 0,
      snap: snapEnabled,
      mode,
      selectionCount: activeSelection().length,
      sheetName: mode === 'footprint'
        ? (footprintEditor ? footprintLabel(footprintEditor.getFootprint()) : '封装')
        : (sheet ? sheetLabel(sheet) : ''),
    };
  }

  function syncChrome() {
    if (destroyed || !store) return;
    toolbar.update(buildUiState());
    statusBar.update(statusState());
    updateModeBar();
    updateEmptyHint();
  }

  function updateStatusOnly() {
    if (destroyed || !store) return;
    statusBar.update(statusState());
  }

  function updateEmptyHint() {
    const show = mode === 'schematic' && sheetEntityCount(store.getSheet()) === 0;
    if (layout.canvasHint) layout.canvasHint.hidden = !show;
  }

  function updateModeBar() {
    if (!modeBar) return;
    if (mode !== 'footprint') {
      modeBar.element.setAttribute('hidden', '');
      layout.sheetTabsSlot.removeAttribute('hidden');
      return;
    }
    modeBar.element.removeAttribute('hidden');
    layout.sheetTabsSlot.setAttribute('hidden', '');
    const footprint = footprintEditor ? footprintEditor.getFootprint() : null;
    modeBar.title.textContent = footprintLabel(footprint);
    modeBar.dirtyLabel.textContent = footprintDirty ? '未保存' : '';
    modeBar.dirtyLabel.classList.toggle('is-dirty', footprintDirty);
    modeBar.saveButton.disabled = !footprintEditor;
    modeBar.setActiveTool(footprintEditor ? footprintEditor.getTool() : '');
    modeBar.setEnabled('undo', activeCanUndo());
    modeBar.setEnabled('redo', activeCanRedo());
    modeBar.setEnabled('delete', activeSelection().length > 0);
  }

  // ---- 错误与提示 ----

  function handleError(error, context) {
    console.error('[schematic-studio] ' + context, error);
    if (toasts) toasts.error(context + '失败：' + messageOf(error));
  }

  function showToast(message, type = 'info') {
    if (!toasts) return;
    const fn = toasts[type];
    if (typeof fn === 'function') fn(message);
    else toasts.info(message);
  }

  function showMessageDialog(title, lines) {
    const body = el('div', { class: 'dialog-lines' }, (Array.isArray(lines) ? lines : []).slice(0, 24)
      .map((line) => el('p', { text: String(line) })));
    openModal({
      root: layout.modalRoot,
      title,
      body,
      width: 560,
      actions: [{ label: '关闭', kind: 'primary', autofocus: true }],
    });
  }

  // ---- 编辑器装配 ----

  function applySnapWrapper(editor) {
    const ctx = editor && typeof editor.getContext === 'function' ? editor.getContext() : null;
    if (!ctx || typeof ctx.snapPoint !== 'function') return;
    const original = ctx.snapPoint;
    ctx.snapPoint = function snapWithToggle(point, snapOptions = {}) {
      if (snapEnabled) return original(point, snapOptions);
      const tolerancePx = snapOptions && Number.isFinite(Number(snapOptions.tolerancePx))
        ? Number(snapOptions.tolerancePx)
        : 10;
      const anchor = typeof ctx.findSnapPoint === 'function' ? ctx.findSnapPoint(point, tolerancePx) : null;
      return anchor ? { x: anchor.x, y: anchor.y } : { x: point.x, y: point.y };
    };
  }

  function ensureSchematicEditor() {
    if (schematicEditor) return schematicEditor;
    schematicEditor = createSchematicEditor({
      canvas: layout.schematicCanvas,
      store,
      options: {
        theme: DEFAULT_THEME,
        grid: store.getProject().grid,
        onError(error, method) {
          console.error('[schematic-studio] 原理图编辑器错误', method, error);
        },
      },
    });
    applySnapWrapper(schematicEditor);
    schematicEditor.on('tool', () => syncChrome());
    schematicEditor.on('error', (payload) => {
      if (payload && payload.error) handleError(payload.error, '画布操作');
    });
    return schematicEditor;
  }

  function attachFootprintEditor(editor) {
    const fstore = editor.getStore();
    fstore.on('changed', () => {
      footprintDirty = true;
      syncChrome();
    });
    fstore.on('selection', () => syncChrome());
    fstore.on('hover', () => {});
    editor.on('tool', () => {
      syncLayersFromEditor();
      syncChrome();
    });
    editor.on('view', () => updateStatusOnly());
    editor.on('error', (payload) => {
      if (payload && payload.error) handleError(payload.error, '封装画布操作');
    });
  }

  function syncLayersFromEditor() {
    if (!layersPanel || !footprintEditor) return;
    const tool = footprintEditor.getTool();
    const state = layersPanel.getState();
    if (tool === 'graphic') {
      const layer = footprintEditor.getLayer();
      layersPanel.setState({ layer, shape: footprintEditor.getGraphicShape(), padLayer: state.padLayer });
    } else if (tool === 'pad') {
      padLayer = footprintEditor.getLayer();
      layersPanel.setState({ layer: state.layer, shape: state.shape, padLayer });
    }
  }

  function resizeActive() {
    const editor = activeEditor();
    if (!editor) return;
    try {
      editor.getRenderer().resize();
    } catch (error) {
      console.warn('[schematic-studio] 画布尺寸同步失败', error);
    }
  }

  function scheduleResize() {
    if (resizeFrame !== null || destroyed) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      resizeActive();
      syncChrome();
    });
  }

  // ---- 模式切换 ----

  async function enterFootprintMode(footprintDef) {
    if (!footprintDef || typeof footprintDef !== 'object') {
      showToast('没有可编辑的封装，请先在左侧封装库选择或新建', 'warn');
      return false;
    }
    if (mode === 'footprint' && footprintEditor) {
      if (footprintDirty) {
        const discard = await confirmDialog({
          root: layout.modalRoot,
          title: '切换封装',
          message: '当前封装的修改尚未保存，切换将丢弃这些修改。',
          confirmLabel: '丢弃并切换',
          danger: true,
        });
        if (!discard) return false;
        footprintDirty = false;
      }
      footprintEditor.setFootprint(clone(footprintDef));
      lastFootprintId = footprintDef.id;
      footprintEditor.fitToContent(40);
      propertiesPanel.refresh(true);
      syncChrome();
      return true;
    }
    if (schematicEditor) {
      try {
        store.setView(schematicEditor.getRenderer().getView());
      } catch {
        // 视图写回失败不影响切换。
      }
      schematicEditor.destroy();
      schematicEditor = null;
    }
    mode = 'footprint';
    pointerWorld = null;
    layout.schematicCanvas.hidden = true;
    layout.footprintCanvas.hidden = false;
    const fstore = createFootprintStore(clone(footprintDef));
    footprintEditor = createFootprintEditor({
      canvas: layout.footprintCanvas,
      store: fstore,
      options: {
        theme: DEFAULT_THEME,
        onError(error, method) {
          console.error('[schematic-studio] 封装编辑器错误', method, error);
        },
      },
    });
    lastFootprintId = footprintDef.id;
    footprintDirty = false;
    attachFootprintEditor(footprintEditor);
    propertiesPanel.setFootprintEditor(footprintEditor);
    layersPanel.setVisible(true);
    layersPanel.setState({ layer: 'silkscreen', shape: 'line', padLayer });
    libraryPanel.setTab('footprints');
    libraryPanel.setQuery('');
    syncChrome();
    requestAnimationFrame(() => {
      if (destroyed || mode !== 'footprint') return;
      try {
        footprintEditor.getRenderer().resize();
        footprintEditor.fitToContent(40);
      } catch (error) {
        console.warn('[schematic-studio] 封装视图适配失败', error);
      }
      syncChrome();
    });
    return true;
  }

  async function exitFootprintMode() {
    if (mode !== 'footprint') return true;
    if (footprintDirty) {
      const discard = await confirmDialog({
        root: layout.modalRoot,
        title: '退出封装编辑',
        message: '当前封装的修改尚未保存到工程库，退出将丢失这些修改。',
        confirmLabel: '退出并丢弃',
        danger: true,
      });
      if (!discard) return false;
    }
    if (footprintEditor) {
      footprintEditor.destroy();
      footprintEditor = null;
    }
    propertiesPanel.setFootprintEditor(null);
    if (layersPanel) layersPanel.setVisible(false);
    libraryPanel.setTab('symbols');
    mode = 'schematic';
    footprintDirty = false;
    pointerWorld = null;
    layout.footprintCanvas.hidden = true;
    layout.schematicCanvas.hidden = false;
    ensureSchematicEditor();
    propertiesPanel.refresh(true);
    const view = store.getView();
    try {
      if (view) schematicEditor.getRenderer().setView(view);
      else schematicEditor.fitToContent(48);
      schematicEditor.refresh();
    } catch (error) {
      console.warn('[schematic-studio] 恢复原理图视图失败', error);
    }
    syncChrome();
    requestAnimationFrame(() => {
      resizeActive();
      syncChrome();
    });
    return true;
  }

  async function toggleFootprintMode() {
    if (mode === 'footprint') {
      await exitFootprintMode();
      return;
    }
    const footprints = store.getProject().library.footprints;
    const target = footprints.find((item) => item && item.id === lastFootprintId) || footprints[0] || null;
    if (!target) {
      showToast('工程封装库为空，请先在左侧封装库新建封装', 'warn');
      return;
    }
    await enterFootprintMode(target);
  }

  function setFootprintTool(name) {
    if (!footprintEditor) return;
    const state = layersPanel.getState();
    try {
      if (name === 'pad') footprintEditor.setTool('pad', { layer: state.padLayer });
      else if (name === 'graphic') footprintEditor.setTool('graphic', { layer: state.layer, shape: state.shape });
      else footprintEditor.setTool(name);
      syncLayersFromEditor();
      syncChrome();
    } catch (error) {
      handleError(error, '切换封装工具');
    }
  }

  function saveFootprintToLibrary() {
    if (!footprintEditor) return;
    const fstore = footprintEditor.getStore();
    let def = clone(fstore.getFootprint());
    if (!Array.isArray(def.pads) || def.pads.length === 0) {
      showToast('请先放置至少一个焊盘再保存到工程库', 'warn');
      return;
    }
    if (def.id === NEW_FOOTPRINT_ID) {
      const id = uid('fp');
      fstore.update((draft) => {
        draft.id = id;
      }, { label: '分配封装 ID' });
      def = clone(fstore.getFootprint());
    }
    try {
      store.update((sheet, project) => {
        const list = project.library.footprints;
        const index = list.findIndex((item) => item && item.id === def.id);
        if (index >= 0) list[index] = clone(def);
        else list.push(clone(def));
      }, { label: '保存封装 ' + footprintLabel(def) });
      footprintDirty = false;
      lastFootprintId = def.id;
      librarySignatureCache = librarySignature();
      libraryPanel.refresh();
      propertiesPanel.refresh(true);
      syncChrome();
      showToast('封装已保存到工程库：' + footprintLabel(def), 'success');
    } catch (error) {
      handleError(error, '保存封装');
    }
  }

  async function newFootprint() {
    const name = await promptDialog({
      root: layout.modalRoot,
      title: '新建封装',
      label: '封装名称',
      value: FOOTPRINT_DEFAULT_NAME,
      hint: '创建后请在画布上放置焊盘并绘制丝印。',
      validate: (value) => (value.trim() === '' ? '请输入封装名称' : ''),
    });
    if (name === null) return;
    const def = {
      id: uid('fp'),
      name: name.trim() === '' ? FOOTPRINT_DEFAULT_NAME : name.trim(),
      description: '',
      pads: [],
      graphics: [],
    };
    await enterFootprintMode(def);
  }

  async function editFootprint(footprintId) {
    const def = store.getProject().library.footprints.find((item) => item && item.id === footprintId);
    if (!def) {
      showToast('找不到封装：' + footprintId, 'warn');
      return;
    }
    lastFootprintId = footprintId;
    await enterFootprintMode(def);
  }

  // ---- 工程文件 ----

  function refreshEverything() {
    ensureSchematicEditor();
    try {
      schematicEditor.refresh();
    } catch (error) {
      console.warn('[schematic-studio] 编辑器刷新失败', error);
    }
    librarySignatureCache = librarySignature();
    libraryPanel.refresh();
    propertiesPanel.refresh(true);
    sheetTabs.refresh();
    netlistPanel.clear();
    lastNetlist = null;
    pointerWorld = null;
    syncChrome();
    updateEmptyHint();
    requestAnimationFrame(() => {
      if (destroyed || mode !== 'schematic') return;
      resizeActive();
      try {
        schematicEditor.fitToContent(48);
      } catch (error) {
        console.warn('[schematic-studio] 视图适配失败', error);
      }
      syncChrome();
    });
  }

  async function loadProject(project, message) {
    if (mode === 'footprint') {
      const exited = await exitFootprintMode();
      if (!exited) return false;
    }
    store.setProject(project, { history: false });
    dirty = false;
    footprintDirty = false;
    refreshEverything();
    showToast(message, 'success');
    return true;
  }

  async function newProject() {
    if (mode === 'footprint') {
      const exited = await exitFootprintMode();
      if (!exited) return;
    }
    if (dirty) {
      const discard = await confirmDialog({
        root: layout.modalRoot,
        title: '新建工程',
        message: '当前工程有未保存的修改，新建将丢弃这些修改。',
        confirmLabel: '新建空白工程',
        danger: true,
      });
      if (!discard) return;
    }
    const project = createInitialProject({ libraries: libs });
    await loadProject(project, '已新建空白工程');
  }

  function openProject() {
    try {
      layout.fileInput.click();
    } catch (error) {
      handleError(error, '打开文件选择器');
    }
  }

  async function handleFileInputChange() {
    const file = layout.fileInput.files && layout.fileInput.files[0];
    layout.fileInput.value = '';
    if (!file) return;
    try {
      const text = await readFileText(file);
      const parsed = deserializeProject(text);
      if (!parsed.project) {
        showMessageDialog('无法打开工程', parsed.warnings.length > 0 ? parsed.warnings : ['工程文件解析失败']);
        return;
      }
      if (mode === 'footprint') {
        const exited = await exitFootprintMode();
        if (!exited) return;
      }
      if (dirty) {
        const discard = await confirmDialog({
          root: layout.modalRoot,
          title: '打开工程',
          message: '当前工程有未保存的修改，打开新工程将丢弃这些修改。',
          confirmLabel: '打开工程',
          danger: true,
        });
        if (!discard) return;
      }
      const project = applyDefaultLibraries(parsed.project, libs);
      await loadProject(project, '已打开工程：' + file.name);
    } catch (error) {
      handleError(error, '打开工程');
    }
  }

  async function openExample(exampleId) {
    const example = getExampleProject(exampleId);
    if (!example) {
      showToast('找不到示例工程：' + exampleId, 'warn');
      return;
    }
    if (mode === 'footprint') {
      const exited = await exitFootprintMode();
      if (!exited) return;
    }
    if (dirty) {
      const discard = await confirmDialog({
        root: layout.modalRoot,
        title: '打开示例工程',
        message: '当前工程有未保存的修改，打开示例将丢弃这些修改。',
        confirmLabel: '打开示例',
        danger: true,
      });
      if (!discard) return;
    }
    try {
      const parsed = deserializeProject(JSON.stringify(example.data));
      if (!parsed.project) {
        showMessageDialog('无法打开示例工程', parsed.warnings.length > 0 ? parsed.warnings : ['示例工程解析失败']);
        return;
      }
      const project = applyDefaultLibraries(parsed.project, libs);
      await loadProject(project, '已打开示例工程：' + example.label);
    } catch (error) {
      handleError(error, '打开示例工程');
    }
  }

  function saveProject() {
    try {
      const project = store.getProject();
      const text = serializeProject(project);
      const stored = saveToLocalStorage(DRAFT_KEY, text);
      downloadText(projectFileName(project), text, PROJECT_FILE_MIME);
      dirty = false;
      syncChrome();
      showToast(
        stored ? '已保存：本地草稿已更新并下载工程 JSON' : '已下载工程 JSON（本地存储不可用）',
        stored ? 'success' : 'warn',
      );
      return true;
    } catch (error) {
      handleError(error, '保存工程');
      return false;
    }
  }

  async function saveProjectAs() {
    const current = store.getProject().name;
    const name = await promptDialog({
      root: layout.modalRoot,
      title: '另存为',
      label: '工程名称',
      value: current,
      hint: '文件名会自动清洗非法字符，扩展名为 .schproj.json',
      validate: (value) => (value.trim() === '' ? '请输入工程名称' : ''),
    });
    if (name === null) return;
    try {
      store.update((sheet, project) => {
        project.name = name.trim();
      }, { label: '重命名工程' });
      saveProject();
    } catch (error) {
      handleError(error, '另存为');
    }
  }

  async function restoreDraft() {
    try {
      const project = loadFromLocalStorage(DRAFT_KEY);
      if (!project) {
        showToast('没有可恢复的本地草稿', 'warn');
        return;
      }
      const loaded = await loadProject(applyDefaultLibraries(project, libs), '已恢复本地草稿');
      if (loaded) {
        dirty = false;
        syncChrome();
      }
    } catch (error) {
      handleError(error, '恢复本地草稿');
    }
  }

  function exportFootprints() {
    try {
      const project = store.getProject();
      const footprints = project.library.footprints;
      const name = projectBaseName(project) + '-footprints.json';
      downloadText(name, footprintLibraryDocument(footprints), 'application/json;charset=utf-8');
      showToast('已导出封装库：' + name, 'success');
    } catch (error) {
      handleError(error, '导出封装库');
    }
  }

  function exportSvg() {
    try {
      const project = store.getProject();
      const sheet = store.getSheet();
      const svg = projectToSVG(project, sheet, { theme: DEFAULT_THEME });
      const name = svgFileName(project, sheet);
      downloadText(name, svg, 'image/svg+xml;charset=utf-8');
      showToast('已导出 SVG：' + name, 'success');
    } catch (error) {
      handleError(error, '导出 SVG');
    }
  }

  async function exportPng() {
    const editor = activeEditor();
    if (!editor) return;
    const canvas = editor.getCanvas();
    const project = store.getProject();
    const label = mode === 'footprint'
      ? footprintLabel(footprintEditor ? footprintEditor.getFootprint() : null)
      : sheetLabel(store.getSheet());
    try {
      const blob = await exportSheetPNG(canvas, 2);
      const name = exportFileName(project, label, 'png');
      downloadBlob(name, blob);
      showToast('已导出 PNG：' + name, 'success');
    } catch (error) {
      handleError(error, '导出 PNG');
    } finally {
      const current = activeEditor();
      if (current && typeof current.refresh === 'function') {
        try {
          current.refresh();
        } catch {
          // 刷新失败不影响导出结果。
        }
      }
    }
  }

  function openNetlistDialog() {
    openExportDialog({
      root: layout.modalRoot,
      project: store.getProject(),
      sheetName: sheetLabel(store.getSheet()),
      initialFormat: 'json',
      notify: (message, type) => showToast(message, type),
    });
  }

  function generateNetlist() {
    if (mode === 'footprint') {
      showToast('请先返回原理图再生成网表', 'warn');
      return;
    }
    netlistPanel.setBusy(true);
    try {
      const result = buildNetlist(store.getProject());
      lastNetlist = result;
      netlistPanel.setResult(result);
      syncChrome();
      const warnings = Array.isArray(result.warnings) ? result.warnings.length : 0;
      showToast(
        '网表已生成：' + result.nets.length + ' 个网络，' + warnings + ' 条检查提示',
        warnings > 0 ? 'warn' : 'success',
      );
    } catch (error) {
      netlistPanel.setError(messageOf(error));
      handleError(error, '生成网表');
    }
  }

  function locateTarget(target) {
    if (!target) return;
    if (mode === 'footprint') {
      showToast('请先返回原理图再定位器件', 'warn');
      return;
    }
    try {
      if (target.sheetId && target.sheetId !== store.getSheetId()) store.setSheetId(target.sheetId);
      const id = target.instanceId || target.wireId;
      if (!id) return;
      const editor = ensureSchematicEditor();
      store.setSelection([id]);
      editor.focus();
      const sheet = store.getSheet();
      const bounds = boundsOfIds(sheet, [id], { resolveSymbol: editor.getSymbolResolver() });
      if (bounds && bounds.w > 0 && bounds.h > 0) {
        editor.getRenderer().fitToBounds(bounds, 140);
        store.setView(editor.getRenderer().getView());
        editor.refresh();
      }
      syncChrome();
    } catch (error) {
      handleError(error, '定位对象');
    }
  }

  // ---- 编辑动作 ----

  function setSchematicTool(name, toolOptions) {
    if (mode === 'footprint') return false;
    const editor = ensureSchematicEditor();
    try {
      const ok = editor.setTool(name, toolOptions || {});
      syncChrome();
      return ok;
    } catch (error) {
      handleError(error, '切换工具');
      return false;
    }
  }

  function placeSymbol(symbolId) {
    if (!symbolId) return;
    lastSymbolId = symbolId;
    libraryPanel.setSelectedSymbol(symbolId);
    if (mode === 'footprint') {
      showToast('请先返回原理图再放置符号', 'warn');
      return;
    }
    const editor = ensureSchematicEditor();
    editor.setTool('place', { symbolId });
    syncChrome();
    showToast('点击画布放置 ' + symbolId + '（R 旋转 / X 镜像 / Esc 取消）', 'info');
  }

  function selectTool() {
    if (mode === 'footprint') setFootprintTool('select');
    else setSchematicTool('select');
  }

  function wireTool() {
    if (mode === 'footprint') return;
    if (setSchematicTool('wire')) showToast('导线工具：连续点击画线，Enter 或双击结束', 'info');
  }

  function placeTool() {
    if (mode === 'footprint') return;
    if (lastSymbolId) {
      placeSymbol(lastSymbolId);
      return;
    }
    libraryPanel.setTab('symbols');
    libraryPanel.focusSearch();
    showToast('请在左侧元件库中选择符号，然后点击画布放置', 'info');
  }

  function labelTool() {
    if (mode === 'footprint') return;
    if (setSchematicTool('label', { text: 'NET', kind: 'local' })) {
      showToast('标签工具：点击放置，G 切换全局/局部', 'info');
    }
  }

  function textTool() {
    if (mode === 'footprint') return;
    if (setSchematicTool('text', { text: '文本', size: 1.27 })) {
      showToast('文本工具：点击画布放置注释', 'info');
    }
  }

  function eraseTool() {
    if (mode === 'footprint') return;
    if (setSchematicTool('erase')) showToast('删除工具：点击对象即可删除', 'info');
  }

  function undoActive() {
    try {
      if (mode === 'footprint') {
        if (footprintEditor) footprintEditor.undo();
      } else {
        store.undo();
      }
      syncChrome();
    } catch (error) {
      handleError(error, '撤销');
    }
  }

  function redoActive() {
    try {
      if (mode === 'footprint') {
        if (footprintEditor) footprintEditor.redo();
      } else {
        store.redo();
      }
      syncChrome();
    } catch (error) {
      handleError(error, '重做');
    }
  }

  function deleteActive() {
    const editor = activeEditor();
    if (!editor) return;
    try {
      editor.deleteSelection();
      syncChrome();
    } catch (error) {
      handleError(error, '删除');
    }
  }

  function selectAllActive() {
    const editor = activeEditor();
    if (!editor) return;
    try {
      editor.selectAll();
      syncChrome();
    } catch (error) {
      handleError(error, '全选');
    }
  }

  function zoomBy(factor) {
    const editor = activeEditor();
    if (!editor) return;
    const renderer = editor.getRenderer();
    const size = renderer.getSize();
    renderer.zoomAt({ x: size.width / 2, y: size.height / 2 }, factor);
    if (mode === 'schematic') {
      store.setView(renderer.getView());
    } else {
      updateStatusOnly();
    }
    syncChrome();
  }

  function fitActive() {
    const editor = activeEditor();
    if (!editor) return;
    try {
      editor.fitToContent(mode === 'footprint' ? 40 : 48);
      syncChrome();
    } catch (error) {
      handleError(error, '缩放适配');
    }
  }

  function toggleGridSnap() {
    if (mode === 'footprint') {
      showToast('封装编辑固定使用 0.635 mm 栅格吸附', 'info');
      return;
    }
    snapEnabled = !snapEnabled;
    syncChrome();
    showToast(
      snapEnabled ? '网格吸附已开启' : '网格吸附已关闭（仍会吸附引脚与导线端点）',
      'info',
    );
  }

  function rotateSelectionByHotkey() {
    if (mode !== 'schematic' || !schematicEditor) return;
    if (schematicEditor.getTool() === 'place') return;
    const ids = store.getSelection();
    if (ids.length === 0) {
      showToast('请先选择符号（R 可在放置模式下旋转预览）', 'info');
      return;
    }
    const sheet = store.getSheet();
    const hasSymbol = ids.some((id) => (Array.isArray(sheet.symbols) ? sheet.symbols : []).some((item) => item.id === id));
    if (!hasSymbol) {
      showToast('所选对象中没有符号', 'info');
      return;
    }
    try {
      schematicEditor.getCommands().rotateSymbols(store.getSheetId(), ids, 90, { label: '旋转符号 90°' });
    } catch (error) {
      handleError(error, '旋转符号');
    }
  }

  function mirrorSelectionByHotkey() {
    if (mode !== 'schematic' || !schematicEditor) return;
    if (schematicEditor.getTool() === 'place') return;
    const ids = store.getSelection();
    if (ids.length === 0) {
      showToast('请先选择符号（X 可在放置模式下切换镜像）', 'info');
      return;
    }
    const sheet = store.getSheet();
    const hasSymbol = ids.some((id) => (Array.isArray(sheet.symbols) ? sheet.symbols : []).some((item) => item.id === id));
    if (!hasSymbol) {
      showToast('所选对象中没有符号', 'info');
      return;
    }
    try {
      schematicEditor.getCommands().mirrorSymbols(store.getSheetId(), ids, undefined, { label: '镜像符号' });
    } catch (error) {
      handleError(error, '镜像符号');
    }
  }

  function showProjectProps() {
    if (mode === 'footprint') {
      showToast('请先返回原理图再编辑工程与图纸属性', 'warn');
      return;
    }
    store.setSelection([]);
    propertiesPanel.refresh(true);
    const node = propertiesPanel.element;
    node.classList.remove('is-flash');
    void node.offsetWidth;
    node.classList.add('is-flash');
    setTimeout(() => node.classList.remove('is-flash'), 900);
    showToast('在右侧属性面板编辑图纸与工程属性', 'info');
  }

  // ---- 图纸管理 ----

  function createSheetAction() {
    const project = store.getProject();
    const name = nextSheetName(project.sheets);
    const sheet = createSheet(name);
    try {
      store.update((draft, draftProject) => {
        draftProject.sheets.push(clone(sheet));
      }, { label: '新建图纸' });
      store.setSheetId(sheet.id);
      sheetTabs.refresh();
      syncChrome();
      showToast('已新建图纸：' + name, 'success');
    } catch (error) {
      handleError(error, '新建图纸');
    }
  }

  async function renameSheetAction(sheetId, currentName) {
    const name = await promptDialog({
      root: layout.modalRoot,
      title: '重命名图纸',
      label: '图纸名称',
      value: currentName,
      validate: (value) => (value.trim() === '' ? '请输入图纸名称' : ''),
    });
    if (name === null) return;
    const trimmed = name.trim();
    try {
      store.update((draft, draftProject) => {
        const target = draftProject.sheets.find((item) => item && item.id === sheetId);
        if (!target) return;
        if (target.title && target.title.title === target.name) target.title.title = trimmed;
        target.name = trimmed;
      }, { label: '重命名图纸' });
      sheetTabs.refresh();
      syncChrome();
    } catch (error) {
      handleError(error, '重命名图纸');
    }
  }

  async function deleteSheetAction(sheetId) {
    const project = store.getProject();
    if (project.sheets.length <= 1) {
      showToast('至少需要保留一张图纸', 'warn');
      return;
    }
    const target = findSheetById(project, sheetId);
    const name = target ? target.name : '该图纸';
    const confirmed = await confirmDialog({
      root: layout.modalRoot,
      title: '删除图纸',
      message: '确定删除「' + name + '」及其中的全部元件与导线？该操作可撤销。',
      confirmLabel: '删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      store.update((draft, draftProject) => {
        draftProject.sheets = draftProject.sheets.filter((item) => !item || item.id !== sheetId);
      }, { label: '删除图纸' });
      sheetTabs.refresh();
      syncChrome();
      showToast('已删除图纸：' + name, 'success');
    } catch (error) {
      handleError(error, '删除图纸');
    }
  }

  // ---- 下拉菜单与工具栏动作映射 ----

  const toolbarActions = {
    newProject: () => { void newProject(); },
    openProject: () => openProject(),
    openExampleLed: () => { void openExample('led'); },
    openExampleMcu: () => { void openExample('mcu'); },
    saveProject: () => saveProject(),
    saveProjectAs: () => { void saveProjectAs(); },
    exportNetlist: () => openNetlistDialog(),
    exportSvg: () => exportSvg(),
    exportPng: () => { void exportPng(); },
    exportFootprints: () => exportFootprints(),
    restoreDraft: () => { void restoreDraft(); },
    undo: () => undoActive(),
    redo: () => redoActive(),
    selectAll: () => selectAllActive(),
    delete: () => deleteActive(),
    projectProps: () => showProjectProps(),
    selectTool: () => selectTool(),
    wireTool: () => wireTool(),
    placeTool: () => placeTool(),
    labelTool: () => labelTool(),
    textTool: () => textTool(),
    eraseTool: () => eraseTool(),
    footprintMode: () => { void toggleFootprintMode(); },
    gridSnap: () => toggleGridSnap(),
    fit: () => fitActive(),
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(0.8),
    generateNetlist: () => generateNetlist(),
    tips: () => openTipsDialog({ root: layout.modalRoot }),
    shortcuts: () => openShortcutsDialog({ root: layout.modalRoot }),
    about: () => openAboutDialog({
      root: layout.modalRoot,
      version: APP_VERSION,
      details: ['当前工程：' + store.getProject().name + ' · ' + store.getProject().sheets.length + ' 张图纸'],
    }),
  };

  // ---- 布局装配 ----

  libs = options.libraries || createDefaultLibraries();
  layout = buildLayout(root);
  toasts = createToastHost(layout.toastRoot);
  const initialProject = options.project
    ? applyDefaultLibraries(options.project, libs)
    : createInitialProject({ libraries: libs });
  store = createStore(initialProject);

  toolbar = createToolbar({ actions: toolbarActions });
  layout.topBar.append(toolbar.menuBar, toolbar.toolbar);

  libraryPanel = createLibraryPanel({
    getSymbols: () => store.getProject().library.symbols,
    getFootprints: () => store.getProject().library.footprints,
    onPlaceSymbol: (symbolId) => placeSymbol(symbolId),
    onEditFootprint: (footprintId) => { void editFootprint(footprintId); },
    onNewFootprint: () => { void newFootprint(); },
    theme: DEFAULT_THEME,
  });
  layout.librarySlot.appendChild(libraryPanel.element);

  layersPanel = createLayersPanel({
    theme: DEFAULT_THEME,
    onGraphicLayer: (layer) => {
      if (mode === 'footprint' && footprintEditor && footprintEditor.getTool() === 'graphic') {
        footprintEditor.setLayer(layer);
      }
    },
    onGraphicShape: (shape) => {
      if (mode === 'footprint' && footprintEditor && footprintEditor.getTool() === 'graphic') {
        footprintEditor.setGraphicShape(shape);
      }
    },
    onPadLayer: (layer) => {
      padLayer = layer;
      if (mode === 'footprint' && footprintEditor && footprintEditor.getTool() === 'pad') {
        footprintEditor.setLayer(layer);
      }
    },
  });
  layout.layersSlot.appendChild(layersPanel.element);

  propertiesPanel = createPropertiesPanel({
    store,
    getEditor: () => schematicEditor,
    getSymbols: () => store.getProject().library.symbols,
    getFootprints: () => store.getProject().library.footprints,
    getMode: () => mode,
    onSaveFootprint: () => saveFootprintToLibrary(),
    onExitFootprint: () => { void exitFootprintMode(); },
    notify: (message, type) => showToast(message, type),
  });
  layout.propertiesSlot.appendChild(propertiesPanel.element);

  netlistPanel = createNetlistPanel({
    onGenerate: () => generateNetlist(),
    onExport: () => openNetlistDialog(),
    onLocate: (target) => locateTarget(target),
  });
  layout.netlistSlot.appendChild(netlistPanel.element);

  sheetTabs = createSheetTabs({
    store,
    onSelect: (sheetId) => {
      store.setSheetId(sheetId);
      syncChrome();
    },
    onNew: () => createSheetAction(),
    onRename: (sheetId, name) => { void renameSheetAction(sheetId, name); },
    onDelete: (sheetId) => { void deleteSheetAction(sheetId); },
  });
  layout.sheetTabsSlot.appendChild(sheetTabs.element);

  statusBar = createStatusBar();
  layout.statusSlot.appendChild(statusBar.element);

  modeBar = createModeBar({
    onTool: (tool) => setFootprintTool(tool),
    onUndo: () => undoActive(),
    onRedo: () => redoActive(),
    onDelete: () => deleteActive(),
    onFit: () => fitActive(),
    onSave: () => saveFootprintToLibrary(),
    onExit: () => { void exitFootprintMode(); },
  });
  layout.modeBarSlot.appendChild(modeBar.element);

  // 画布上的坐标状态与空图纸提示
  function bindPointerStatus(canvas) {
    canvas.addEventListener('pointermove', (event) => {
      const editor = activeEditor();
      if (!editor) return;
      const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
      pointerWorld = editor.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      updateStatusOnly();
    });
    canvas.addEventListener('pointerleave', () => {
      pointerWorld = null;
      updateStatusOnly();
    });
  }
  bindPointerStatus(layout.schematicCanvas);
  bindPointerStatus(layout.footprintCanvas);

  layout.fileInput.addEventListener('change', () => { void handleFileInputChange(); });

  // store 事件：脏标记、网表过期、库变化与界面同步
  store.on('changed', () => {
    dirty = true;
    netlistPanel.setStale(true);
    const nextSignature = librarySignature();
    if (nextSignature !== librarySignatureCache) {
      librarySignatureCache = nextSignature;
      libraryPanel.refresh();
    }
    syncChrome();
  });
  store.on('selection', () => syncChrome());
  store.on('sheet', () => {
    pointerWorld = null;
    syncChrome();
    updateEmptyHint();
  });
  store.on('view', () => updateStatusOnly());

  librarySignatureCache = librarySignature();
  ensureSchematicEditor();

  hotkeys = bindHotkeys({
    target: window,
    isBlocked: () => hasOpenModal(),
    handlers: {
      newProject: () => { void newProject(); },
      save: () => saveProject(),
      saveAs: () => { void saveProjectAs(); },
      open: () => openProject(),
      exportNetlist: () => openNetlistDialog(),
      wireTool: () => wireTool(),
      selectTool: () => selectTool(),
      gridSnap: () => {
        if (mode === 'schematic' && schematicEditor && schematicEditor.getTool() === 'label') return;
        toggleGridSnap();
      },
      rotate: () => rotateSelectionByHotkey(),
      mirror: () => mirrorSelectionByHotkey(),
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(0.8),
      fit: () => fitActive(),
      help: () => openShortcutsDialog({ root: layout.modalRoot }),
    },
  });

  function scheduleResizeHandler() {
    scheduleResize();
  }

  function onBeforeUnload(event) {
    if (!dirty && !(mode === 'footprint' && footprintDirty)) return undefined;
    if (event) {
      event.preventDefault();
      event.returnValue = '';
    }
    return '';
  }

  function onWindowError(event) {
    console.error('[schematic-studio] 未捕获错误', event.error || event.message);
    if (toasts) toasts.error('运行错误：' + (event.message || '未知错误'));
  }

  function onUnhandledRejection(event) {
    console.error('[schematic-studio] 未处理的 Promise 异常', event.reason);
    if (toasts) toasts.error('未处理的异常：' + messageOf(event.reason));
  }

  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(() => scheduleResize());
    resizeObserver.observe(layout.canvasStack);
  }
  window.addEventListener('resize', scheduleResizeHandler);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  syncChrome();
  updateEmptyHint();
  requestAnimationFrame(() => {
    if (destroyed) return;
    resizeActive();
    try {
      schematicEditor.fitToContent(48);
    } catch (error) {
      console.warn('[schematic-studio] 初始视图适配失败', error);
    }
    syncChrome();
  });

  setTimeout(() => {
    if (destroyed) return;
    if (!isWelcomeDismissed(options.storage)) {
      openWelcomeDialog({
        root: layout.modalRoot,
        storage: options.storage,
        version: APP_VERSION,
      });
    }
  }, 350);

  try {
    if (loadFromLocalStorage(DRAFT_KEY)) {
      toasts.info('检测到本地草稿，可从「文件 → 恢复本地草稿」打开', { timeout: 4800 });
    }
  } catch {
    // 本地存储不可用时不打扰用户。
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (hotkeys && typeof hotkeys.unbind === 'function') hotkeys.unbind();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = null;
    }
    window.removeEventListener('resize', scheduleResizeHandler);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    if (schematicEditor) {
      schematicEditor.destroy();
      schematicEditor = null;
    }
    if (footprintEditor) {
      footprintEditor.destroy();
      footprintEditor = null;
    }
    propertiesPanel?.destroy();
    libraryPanel?.destroy();
    sheetTabs?.destroy();
    toolbar?.destroy();
    toasts?.clear();
    clear(root);
  }

  return {
    version: APP_VERSION,
    root,
    layout,
    store,
    libraries: libs,
    getEditor: () => schematicEditor,
    getFootprintEditor: () => footprintEditor,
    getMode: () => mode,
    getNetlist: () => lastNetlist,
    syncChrome,
    refresh: refreshEverything,
    newProject,
    openProject,
    saveProject,
    saveProjectAs,
    generateNetlist,
    openNetlistDialog,
    exportSvg,
    exportPng,
    exportFootprints,
    restoreDraft,
    locateTarget,
    enterFootprintMode,
    exitFootprintMode,
    toggleFootprintMode,
    saveFootprintToLibrary,
    showToast,
    destroy,
  };
}
