// 工程文件与导出动作：新建/打开/保存/恢复、示例、SVG/PNG/网表/封装库导出与网表生成定位。
import { boundsOfIds } from '../editor/index.js';
import {
  PROJECT_FILE_MIME,
  deserializeProject,
  downloadBlob,
  downloadText,
  loadFromLocalStorage,
  saveToLocalStorage,
  serializeProject,
} from '../io/project-io.js';
import { exportSheetPNG } from '../io/png-export.js';
import { projectToSVG } from '../io/svg-export.js';
import { buildNetlist } from '../netlist/index.js';
import { importKiCadNetlist } from '../netlist/kicad-import.js';
import { DEFAULT_THEME } from '../render/theme.js';
import { openExportDialog } from './dialogs/export-dialog.js';
import { confirmDialog, promptDialog } from './dialogs/modal.js';
import { loadExampleProject } from './example-projects.js';
import {
  applyDefaultLibraries,
  createInitialProject,
  exportFileName,
  footprintLibraryDocument,
  projectBaseName,
  projectFileName,
} from './project-setup.js';
import { messageOf, readFileText } from './ui-utils.js';
import { footprintLabel, sheetLabel } from './view-model.js';

const DRAFT_KEY = 'draft';

function svgFileName(project, sheet) {
  return exportFileName(project, sheet ? sheetLabel(sheet) : '', 'svg');
}

/** 统计值归一化（导入器缺失字段或非法值时按 0 显示）。 */
function countOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

/**
 * 创建工程文件/导出动作。
 * @param {object} ctx 组合根上下文
 * @returns {object} 文件与导出动作
 */
export function createFileActions(ctx) {
  function refreshEverything() {
    ctx.ensureSchematicEditor();
    try {
      ctx.schematicEditor.refresh();
    } catch (error) {
      console.warn('[schematic-studio] 编辑器刷新失败', error);
    }
    ctx.librarySignatureCache = ctx.librarySignature();
    ctx.libraryPanel.refresh();
    ctx.propertiesPanel.refresh(true);
    ctx.sheetTabs.refresh();
    ctx.netlistPanel.clear();
    ctx.lastNetlist = null;
    ctx.pointerWorld = null;
    ctx.syncChrome();
    ctx.updateEmptyHint();
    requestAnimationFrame(() => {
      if (ctx.destroyed || ctx.mode !== 'schematic') return;
      ctx.resizeActive();
      try {
        ctx.schematicEditor.fitToContent(48);
      } catch (error) {
        console.warn('[schematic-studio] 视图适配失败', error);
      }
      ctx.syncChrome();
    });
  }

  async function loadProject(project, message) {
    if (ctx.mode === 'footprint') {
      const exited = await ctx.exitFootprintMode();
      if (!exited) return false;
    }
    ctx.store.setProject(project, { history: false });
    ctx.dirty = false;
    ctx.footprintDirty = false;
    refreshEverything();
    ctx.showToast(message, 'success');
    return true;
  }

  async function newProject() {
    if (ctx.mode === 'footprint') {
      const exited = await ctx.exitFootprintMode();
      if (!exited) return;
    }
    if (ctx.dirty) {
      const discard = await confirmDialog({
        root: ctx.layout.modalRoot,
        title: '新建工程',
        message: '当前工程有未保存的修改，新建将丢弃这些修改。',
        confirmLabel: '新建空白工程',
        danger: true,
      });
      if (!discard) return;
    }
    const project = createInitialProject({ libraries: ctx.libs });
    await loadProject(project, '已新建空白工程');
  }

  function openProject() {
    try {
      ctx.layout.fileInput.click();
    } catch (error) {
      ctx.handleError(error, '打开文件选择器');
    }
  }

  async function handleFileInputChange() {
    const file = ctx.layout.fileInput.files && ctx.layout.fileInput.files[0];
    ctx.layout.fileInput.value = '';
    if (!file) return;
    try {
      const text = await readFileText(file);
      const parsed = deserializeProject(text);
      if (!parsed.project) {
        ctx.showMessageDialog('无法打开工程', parsed.warnings.length > 0 ? parsed.warnings : ['工程文件解析失败']);
        return;
      }
      if (ctx.mode === 'footprint') {
        const exited = await ctx.exitFootprintMode();
        if (!exited) return;
      }
      if (ctx.dirty) {
        const discard = await confirmDialog({
          root: ctx.layout.modalRoot,
          title: '打开工程',
          message: '当前工程有未保存的修改，打开新工程将丢弃这些修改。',
          confirmLabel: '打开工程',
          danger: true,
        });
        if (!discard) return;
      }
      const project = applyDefaultLibraries(parsed.project, ctx.libs);
      await loadProject(project, '已打开工程：' + file.name);
    } catch (error) {
      ctx.handleError(error, '打开工程');
    }
  }

  /** 打开 KiCad 网表文件选择器（独立 input，不复用工程文件 input）。 */
  function openNetlistImport() {
    try {
      ctx.layout.netlistFileInput.click();
    } catch (error) {
      ctx.handleError(error, '打开网表文件选择器');
    }
  }

  /**
   * 读取并导入 KiCad 网表：先解析成功再退出封装模式并确认丢弃未保存修改，
   * 失败时只弹错误对话框，不触碰当前工程与选区。
   */
  async function handleNetlistFileChange() {
    const input = ctx.layout.netlistFileInput;
    const file = input && input.files && input.files[0];
    if (input) input.value = '';
    if (!file) return;

    let result = null;
    try {
      const text = await readFileText(file);
      result = importKiCadNetlist(text);
    } catch (error) {
      ctx.showMessageDialog('无法导入 KiCad 网表', ['读取或解析网表失败：' + messageOf(error)]);
      return;
    }
    if (!result || result.ok !== true || !result.project) {
      const errors = result && Array.isArray(result.errors) ? result.errors : [];
      ctx.showMessageDialog(
        '无法导入 KiCad 网表',
        errors.length > 0 ? errors : ['网表解析失败：未找到可导入的 export 段。'],
      );
      return;
    }

    if (ctx.mode === 'footprint') {
      const exited = await ctx.exitFootprintMode();
      if (!exited) return;
    }
    if (ctx.dirty) {
      const discard = await confirmDialog({
        root: ctx.layout.modalRoot,
        title: '导入 KiCad 网表',
        message: '当前工程有未保存的修改，导入网表将丢弃这些修改。',
        confirmLabel: '导入网表',
        danger: true,
      });
      if (!discard) return;
    }

    const stats = result.stats || {};
    const message = '已导入 KiCad 网表：元件 ' + countOf(stats.components) +
      ' · 网络 ' + countOf(stats.nets) + ' · 图纸 ' + countOf(stats.sheets);
    try {
      const loaded = await loadProject(result.project, message);
      if (loaded && Array.isArray(result.warnings) && result.warnings.length > 0) {
        ctx.showToast('导入完成，另有 ' + result.warnings.length + ' 条提示', 'warn');
      }
    } catch (error) {
      ctx.handleError(error, '导入 KiCad 网表');
    }
  }

  async function openExample(exampleId) {
    const example = await loadExampleProject(exampleId);
    if (example.error || !example.data) {
      ctx.showMessageDialog('无法打开示例工程', [
        example.error || '示例工程数据为空。',
        '请使用最新版 Chrome/Edge（支持 JSON 模块）打开本应用。',
      ]);
      return;
    }
    if (ctx.mode === 'footprint') {
      const exited = await ctx.exitFootprintMode();
      if (!exited) return;
    }
    if (ctx.dirty) {
      const discard = await confirmDialog({
        root: ctx.layout.modalRoot,
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
        ctx.showMessageDialog('无法打开示例工程', parsed.warnings.length > 0 ? parsed.warnings : ['示例工程解析失败']);
        return;
      }
      const project = applyDefaultLibraries(parsed.project, ctx.libs);
      await loadProject(project, '已打开示例工程：' + example.label);
    } catch (error) {
      ctx.handleError(error, '打开示例工程');
    }
  }

  function saveProject() {
    try {
      const project = ctx.store.getProject();
      const text = serializeProject(project);
      const stored = saveToLocalStorage(DRAFT_KEY, text);
      downloadText(projectFileName(project), text, PROJECT_FILE_MIME);
      ctx.dirty = false;
      ctx.syncChrome();
      ctx.showToast(
        stored ? '已保存：本地草稿已更新并下载工程 JSON' : '已下载工程 JSON（本地存储不可用）',
        stored ? 'success' : 'warn',
      );
      return true;
    } catch (error) {
      ctx.handleError(error, '保存工程');
      return false;
    }
  }

  async function saveProjectAs() {
    const current = ctx.store.getProject().name;
    const name = await promptDialog({
      root: ctx.layout.modalRoot,
      title: '另存为',
      label: '工程名称',
      value: current,
      hint: '文件名会自动清洗非法字符，扩展名为 .schproj.json',
      validate: (value) => (value.trim() === '' ? '请输入工程名称' : ''),
    });
    if (name === null) return;
    try {
      ctx.store.update((sheet, project) => {
        project.name = name.trim();
      }, { label: '重命名工程' });
      saveProject();
    } catch (error) {
      ctx.handleError(error, '另存为');
    }
  }

  async function restoreDraft() {
    try {
      const project = loadFromLocalStorage(DRAFT_KEY);
      if (!project) {
        ctx.showToast('没有可恢复的本地草稿', 'warn');
        return;
      }
      const loaded = await loadProject(applyDefaultLibraries(project, ctx.libs), '已恢复本地草稿');
      if (loaded) {
        ctx.dirty = false;
        ctx.syncChrome();
      }
    } catch (error) {
      ctx.handleError(error, '恢复本地草稿');
    }
  }

  function exportFootprints() {
    try {
      const project = ctx.store.getProject();
      const footprints = project.library.footprints;
      const name = projectBaseName(project) + '-footprints.json';
      downloadText(name, footprintLibraryDocument(footprints), 'application/json;charset=utf-8');
      ctx.showToast('已导出封装库：' + name, 'success');
    } catch (error) {
      ctx.handleError(error, '导出封装库');
    }
  }

  function exportSvg() {
    try {
      const project = ctx.store.getProject();
      const sheet = ctx.store.getSheet();
      const svg = projectToSVG(project, sheet, { theme: DEFAULT_THEME });
      const name = svgFileName(project, sheet);
      downloadText(name, svg, 'image/svg+xml;charset=utf-8');
      ctx.showToast('已导出 SVG：' + name, 'success');
    } catch (error) {
      ctx.handleError(error, '导出 SVG');
    }
  }

  async function exportPng() {
    const editor = ctx.activeEditor();
    if (!editor) return;
    const canvas = editor.getCanvas();
    const project = ctx.store.getProject();
    const label = ctx.mode === 'footprint'
      ? footprintLabel(ctx.footprintEditor ? ctx.footprintEditor.getFootprint() : null)
      : sheetLabel(ctx.store.getSheet());
    try {
      const blob = await exportSheetPNG(canvas, 2);
      const name = exportFileName(project, label, 'png');
      downloadBlob(name, blob);
      ctx.showToast('已导出 PNG：' + name, 'success');
    } catch (error) {
      ctx.handleError(error, '导出 PNG');
    } finally {
      const current = ctx.activeEditor();
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
      root: ctx.layout.modalRoot,
      project: ctx.store.getProject(),
      sheetName: sheetLabel(ctx.store.getSheet()),
      initialFormat: 'json',
      notify: (message, type) => ctx.showToast(message, type),
    });
  }

  function generateNetlist() {
    if (ctx.mode === 'footprint') {
      ctx.showToast('请先返回原理图再生成网表', 'warn');
      return;
    }
    ctx.netlistPanel.setBusy(true);
    try {
      const result = buildNetlist(ctx.store.getProject());
      ctx.lastNetlist = result;
      ctx.netlistPanel.setResult(result);
      ctx.syncChrome();
      const warnings = Array.isArray(result.warnings) ? result.warnings.length : 0;
      ctx.showToast(
        '网表已生成：' + result.nets.length + ' 个网络，' + warnings + ' 条检查提示',
        warnings > 0 ? 'warn' : 'success',
      );
    } catch (error) {
      ctx.netlistPanel.setError(messageOf(error));
      ctx.handleError(error, '生成网表');
    }
  }

  function locateTarget(target) {
    if (!target) return;
    if (ctx.mode === 'footprint') {
      ctx.showToast('请先返回原理图再定位器件', 'warn');
      return;
    }
    try {
      if (target.sheetId && target.sheetId !== ctx.store.getSheetId()) ctx.store.setSheetId(target.sheetId);
      const id = target.instanceId || target.wireId;
      if (!id) return;
      const editor = ctx.ensureSchematicEditor();
      ctx.store.setSelection([id]);
      editor.focus();
      const sheet = ctx.store.getSheet();
      const bounds = boundsOfIds(sheet, [id], { resolveSymbol: editor.getSymbolResolver() });
      if (bounds && bounds.w > 0 && bounds.h > 0) {
        editor.getRenderer().fitToBounds(bounds, 140);
        ctx.store.setView(editor.getRenderer().getView());
        editor.refresh();
      }
      ctx.syncChrome();
    } catch (error) {
      ctx.handleError(error, '定位对象');
    }
  }

  return {
    refreshEverything,
    loadProject,
    newProject,
    openProject,
    handleFileInputChange,
    openNetlistImport,
    handleNetlistFileChange,
    openExample,
    saveProject,
    saveProjectAs,
    restoreDraft,
    exportFootprints,
    exportSvg,
    exportPng,
    openNetlistDialog,
    generateNetlist,
    locateTarget,
  };
}
