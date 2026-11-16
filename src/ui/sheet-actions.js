// 图纸管理动作：新建、重命名、删除图纸，并刷新标签页与状态栏。
import { createSheet, findSheetById } from '../model/project.js';
import { confirmDialog, promptDialog } from './dialogs/modal.js';
import { clone } from '../model/project.js';
import { nextSheetName } from './view-model.js';

/**
 * 创建图纸管理动作。
 * @param {object} ctx 组合根上下文
 * @returns {object} 图纸动作
 */
export function createSheetActions(ctx) {
  function createSheetAction() {
    const project = ctx.store.getProject();
    const name = nextSheetName(project.sheets);
    const sheet = createSheet(name);
    try {
      ctx.store.update((draft, draftProject) => {
        draftProject.sheets.push(clone(sheet));
      }, { label: '新建图纸' });
      ctx.store.setSheetId(sheet.id);
      ctx.sheetTabs.refresh();
      ctx.syncChrome();
      ctx.showToast('已新建图纸：' + name, 'success');
    } catch (error) {
      ctx.handleError(error, '新建图纸');
    }
  }

  async function renameSheetAction(sheetId, currentName) {
    const name = await promptDialog({
      root: ctx.layout.modalRoot,
      title: '重命名图纸',
      label: '图纸名称',
      value: currentName,
      validate: (value) => (value.trim() === '' ? '请输入图纸名称' : ''),
    });
    if (name === null) return;
    const trimmed = name.trim();
    try {
      ctx.store.update((draft, draftProject) => {
        const target = draftProject.sheets.find((item) => item && item.id === sheetId);
        if (!target) return;
        if (target.title && target.title.title === target.name) target.title.title = trimmed;
        target.name = trimmed;
      }, { label: '重命名图纸' });
      ctx.sheetTabs.refresh();
      ctx.syncChrome();
    } catch (error) {
      ctx.handleError(error, '重命名图纸');
    }
  }

  async function deleteSheetAction(sheetId) {
    const project = ctx.store.getProject();
    if (project.sheets.length <= 1) {
      ctx.showToast('至少需要保留一张图纸', 'warn');
      return;
    }
    const target = findSheetById(project, sheetId);
    const name = target ? target.name : '该图纸';
    const confirmed = await confirmDialog({
      root: ctx.layout.modalRoot,
      title: '删除图纸',
      message: '确定删除「' + name + '」及其中的全部元件与导线？该操作可撤销。',
      confirmLabel: '删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      ctx.store.update((draft, draftProject) => {
        draftProject.sheets = draftProject.sheets.filter((item) => !item || item.id !== sheetId);
      }, { label: '删除图纸' });
      ctx.sheetTabs.refresh();
      ctx.syncChrome();
      ctx.showToast('已删除图纸：' + name, 'success');
    } catch (error) {
      ctx.handleError(error, '删除图纸');
    }
  }

  return { createSheetAction, renameSheetAction, deleteSheetAction };
}
