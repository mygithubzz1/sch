// 菜单与工具栏动作映射：把 ctx 上的动作函数组装成 toolbar 需要的回调表。
import { openAboutDialog, openShortcutsDialog, openTipsDialog } from './dialogs/help-dialog.js';

/**
 * 构建工具栏/菜单动作表。
 * @param {object} ctx 组合根上下文
 * @returns {object} id -> 回调
 */
export function buildToolbarActions(ctx) {
  return {
    newProject: () => { void ctx.newProject(); },
    openProject: () => ctx.openProject(),
    importNetlist: () => ctx.openNetlistImport(),
    openExampleLed: () => { void ctx.openExample('led'); },
    openExampleMcu: () => { void ctx.openExample('mcu'); },
    saveProject: () => ctx.saveProject(),
    saveProjectAs: () => { void ctx.saveProjectAs(); },
    exportNetlist: () => ctx.openNetlistDialog(),
    exportSvg: () => ctx.exportSvg(),
    exportPng: () => { void ctx.exportPng(); },
    exportFootprints: () => ctx.exportFootprints(),
    restoreDraft: () => { void ctx.restoreDraft(); },
    undo: () => ctx.undoActive(),
    redo: () => ctx.redoActive(),
    selectAll: () => ctx.selectAllActive(),
    delete: () => ctx.deleteActive(),
    projectProps: () => ctx.showProjectProps(),
    selectTool: () => ctx.selectTool(),
    wireTool: () => ctx.wireTool(),
    placeTool: () => ctx.placeTool(),
    labelTool: () => ctx.labelTool(),
    textTool: () => ctx.textTool(),
    eraseTool: () => ctx.eraseTool(),
    footprintMode: () => { void ctx.toggleFootprintMode(); },
    gridSnap: () => ctx.toggleGridSnap(),
    fit: () => ctx.fitActive(),
    zoomIn: () => ctx.zoomBy(1.25),
    zoomOut: () => ctx.zoomBy(0.8),
    generateNetlist: () => ctx.generateNetlist(),
    tips: () => openTipsDialog({ root: ctx.layout.modalRoot }),
    shortcuts: () => openShortcutsDialog({ root: ctx.layout.modalRoot }),
    about: () => openAboutDialog({
      root: ctx.layout.modalRoot,
      version: ctx.appVersion,
      details: ['当前工程：' + ctx.store.getProject().name + ' · ' + ctx.store.getProject().sheets.length + ' 张图纸'],
    }),
  };
}
