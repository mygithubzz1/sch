// 界面同步：派生状态、状态栏/工具栏/模式栏更新与库签名，供 app.js 组合根调用。
import { ENTITY_COLLECTIONS } from '../model/project.js';
import { footprintLabel, sheetLabel } from './view-model.js';

/**
 * 创建界面同步器。
 * @param {object} ctx 组合根上下文（store/layout/面板与动作函数）
 * @returns {object} 派生状态与同步函数
 */
export function createChromeSync(ctx) {
  function activeEditor() {
    return ctx.mode === 'footprint' ? ctx.footprintEditor : ctx.schematicEditor;
  }

  function activeSelection() {
    if (ctx.mode === 'footprint') {
      return ctx.footprintEditor ? ctx.footprintEditor.getStore().getSelection() : [];
    }
    return ctx.store ? ctx.store.getSelection() : [];
  }

  function activeCanUndo() {
    if (ctx.mode === 'footprint') return ctx.footprintEditor ? ctx.footprintEditor.canUndo() : false;
    return ctx.store ? ctx.store.canUndo() : false;
  }

  function activeCanRedo() {
    if (ctx.mode === 'footprint') return ctx.footprintEditor ? ctx.footprintEditor.canRedo() : false;
    return ctx.store ? ctx.store.canRedo() : false;
  }

  function librarySignature() {
    const project = ctx.store.getProject();
    const symbols = Array.isArray(project.library.symbols) ? project.library.symbols : [];
    const footprints = Array.isArray(project.library.footprints) ? project.library.footprints : [];
    return symbols.map((symbol) => (symbol ? symbol.id : '')).join(',') + '|' +
      footprints.map((footprint) => footprint
        ? footprint.id + ':' + (footprint.name || '') + ':' + (Array.isArray(footprint.pads) ? footprint.pads.length : 0)
        : '').join(',');
  }

  function sheetEntityCount(sheet) {
    if (!sheet) return 0;
    return ENTITY_COLLECTIONS.reduce((sum, key) => sum + (Array.isArray(sheet[key]) ? sheet[key].length : 0), 0);
  }

  function buildUiState() {
    const editor = activeEditor();
    const project = ctx.store.getProject();
    return {
      mode: ctx.mode,
      tool: editor ? editor.getTool() : '',
      canUndo: activeCanUndo(),
      canRedo: activeCanRedo(),
      selectionCount: activeSelection().length,
      snap: ctx.snapEnabled,
      projectName: project ? project.name : '',
      dirty: ctx.dirty || (ctx.mode === 'footprint' && ctx.footprintDirty),
    };
  }

  function statusState() {
    const editor = activeEditor();
    const project = ctx.store.getProject();
    const sheet = ctx.store.getSheet();
    const view = editor ? editor.getRenderer().getView() : { scale: 1 };
    return {
      pointer: ctx.pointerWorld,
      grid: editor ? editor.getGrid() : (project && project.grid) || 2.54,
      scale: view && view.scale ? view.scale : 1,
      tool: editor ? editor.getTool() : '',
      netCount: ctx.lastNetlist && Array.isArray(ctx.lastNetlist.nets) ? ctx.lastNetlist.nets.length : 0,
      snap: ctx.snapEnabled,
      mode: ctx.mode,
      selectionCount: activeSelection().length,
      sheetName: ctx.mode === 'footprint'
        ? (ctx.footprintEditor ? footprintLabel(ctx.footprintEditor.getFootprint()) : '封装')
        : (sheet ? sheetLabel(sheet) : ''),
    };
  }

  function syncChrome() {
    if (ctx.destroyed || !ctx.store) return;
    ctx.toolbar.update(buildUiState());
    ctx.statusBar.update(statusState());
    updateModeBar();
    updateEmptyHint();
  }

  function updateStatusOnly() {
    if (ctx.destroyed || !ctx.store) return;
    ctx.statusBar.update(statusState());
  }

  function updateEmptyHint() {
    const show = ctx.mode === 'schematic' && sheetEntityCount(ctx.store.getSheet()) === 0;
    if (ctx.layout.canvasHint) ctx.layout.canvasHint.hidden = !show;
  }

  function updateModeBar() {
    if (!ctx.modeBar) return;
    if (ctx.mode !== 'footprint') {
      ctx.modeBar.element.setAttribute('hidden', '');
      ctx.layout.sheetTabsSlot.removeAttribute('hidden');
      return;
    }
    ctx.modeBar.element.removeAttribute('hidden');
    ctx.layout.sheetTabsSlot.setAttribute('hidden', '');
    const footprint = ctx.footprintEditor ? ctx.footprintEditor.getFootprint() : null;
    ctx.modeBar.title.textContent = footprintLabel(footprint);
    ctx.modeBar.dirtyLabel.textContent = ctx.footprintDirty ? '未保存' : '';
    ctx.modeBar.dirtyLabel.classList.toggle('is-dirty', ctx.footprintDirty);
    ctx.modeBar.saveButton.disabled = !ctx.footprintEditor;
    ctx.modeBar.setActiveTool(ctx.footprintEditor ? ctx.footprintEditor.getTool() : '');
    ctx.modeBar.setEnabled('undo', activeCanUndo());
    ctx.modeBar.setEnabled('redo', activeCanRedo());
    ctx.modeBar.setEnabled('delete', activeSelection().length > 0);
  }

  return {
    activeEditor,
    activeSelection,
    activeCanUndo,
    activeCanRedo,
    librarySignature,
    buildUiState,
    statusState,
    syncChrome,
    updateStatusOnly,
    updateEmptyHint,
    updateModeBar,
  };
}
