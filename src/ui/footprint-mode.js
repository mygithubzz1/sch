// 封装编辑模式：进入/退出、工具切换、封装保存与新建编辑，隔离封装相关状态。
import { uid } from '../core/id.js';
import { NEW_FOOTPRINT_ID, createFootprintEditor, createFootprintStore } from '../editor/index.js';
import { clone } from '../model/project.js';
import { DEFAULT_THEME } from '../render/theme.js';
import { confirmDialog, promptDialog } from './dialogs/modal.js';
import { footprintLabel } from './view-model.js';

const FOOTPRINT_DEFAULT_NAME = '新建封装';

/**
 * 创建封装模式控制器。
 * @param {object} ctx 组合根上下文
 * @returns {object} 封装模式动作
 */
export function createFootprintMode(ctx) {
  async function enterFootprintMode(footprintDef) {
    if (!footprintDef || typeof footprintDef !== 'object') {
      ctx.showToast('没有可编辑的封装，请先在左侧封装库选择或新建', 'warn');
      return false;
    }
    if (ctx.mode === 'footprint' && ctx.footprintEditor) {
      if (ctx.footprintDirty) {
        const discard = await confirmDialog({
          root: ctx.layout.modalRoot,
          title: '切换封装',
          message: '当前封装的修改尚未保存，切换将丢弃这些修改。',
          confirmLabel: '丢弃并切换',
          danger: true,
        });
        if (!discard) return false;
        ctx.footprintDirty = false;
      }
      ctx.footprintEditor.setFootprint(clone(footprintDef));
      ctx.lastFootprintId = footprintDef.id;
      ctx.footprintEditor.fitToContent(40);
      ctx.propertiesPanel.refresh(true);
      ctx.syncChrome();
      return true;
    }
    if (ctx.schematicEditor) {
      try {
        ctx.store.setView(ctx.schematicEditor.getRenderer().getView());
      } catch {
        // 视图写回失败不影响切换。
      }
      ctx.schematicEditor.destroy();
      ctx.schematicEditor = null;
    }
    ctx.mode = 'footprint';
    ctx.pointerWorld = null;
    ctx.layout.schematicCanvas.hidden = true;
    ctx.layout.footprintCanvas.hidden = false;
    const fstore = createFootprintStore(clone(footprintDef));
    ctx.footprintEditor = createFootprintEditor({
      canvas: ctx.layout.footprintCanvas,
      store: fstore,
      options: {
        theme: DEFAULT_THEME,
        onError(error, method) {
          console.error('[schematic-studio] 封装编辑器错误', method, error);
        },
      },
    });
    ctx.lastFootprintId = footprintDef.id;
    ctx.footprintDirty = false;
    ctx.attachFootprintEditor(ctx.footprintEditor);
    ctx.propertiesPanel.setFootprintEditor(ctx.footprintEditor);
    ctx.layersPanel.setVisible(true);
    ctx.layersPanel.setState({ layer: 'silkscreen', shape: 'line', padLayer: ctx.padLayer });
    ctx.libraryPanel.setTab('footprints');
    ctx.libraryPanel.setQuery('');
    ctx.syncChrome();
    requestAnimationFrame(() => {
      if (ctx.destroyed || ctx.mode !== 'footprint') return;
      try {
        ctx.footprintEditor.getRenderer().resize();
        ctx.footprintEditor.fitToContent(40);
      } catch (error) {
        console.warn('[schematic-studio] 封装视图适配失败', error);
      }
      ctx.syncChrome();
    });
    return true;
  }

  async function exitFootprintMode() {
    if (ctx.mode !== 'footprint') return true;
    if (ctx.footprintDirty) {
      const discard = await confirmDialog({
        root: ctx.layout.modalRoot,
        title: '退出封装编辑',
        message: '当前封装的修改尚未保存到工程库，退出将丢失这些修改。',
        confirmLabel: '退出并丢弃',
        danger: true,
      });
      if (!discard) return false;
    }
    if (ctx.footprintEditor) {
      ctx.footprintEditor.destroy();
      ctx.footprintEditor = null;
    }
    ctx.propertiesPanel.setFootprintEditor(null);
    if (ctx.layersPanel) ctx.layersPanel.setVisible(false);
    ctx.libraryPanel.setTab('symbols');
    ctx.mode = 'schematic';
    ctx.footprintDirty = false;
    ctx.pointerWorld = null;
    ctx.layout.footprintCanvas.hidden = true;
    ctx.layout.schematicCanvas.hidden = false;
    ctx.ensureSchematicEditor();
    ctx.propertiesPanel.refresh(true);
    const view = ctx.store.getView();
    try {
      if (view) ctx.schematicEditor.getRenderer().setView(view);
      else ctx.schematicEditor.fitToContent(48);
      ctx.schematicEditor.refresh();
    } catch (error) {
      console.warn('[schematic-studio] 恢复原理图视图失败', error);
    }
    ctx.syncChrome();
    requestAnimationFrame(() => {
      ctx.resizeActive();
      ctx.syncChrome();
    });
    return true;
  }

  async function toggleFootprintMode() {
    if (ctx.mode === 'footprint') {
      await exitFootprintMode();
      return;
    }
    const footprints = ctx.store.getProject().library.footprints;
    const target = footprints.find((item) => item && item.id === ctx.lastFootprintId) || footprints[0] || null;
    if (!target) {
      ctx.showToast('工程封装库为空，请先在左侧封装库新建封装', 'warn');
      return;
    }
    await enterFootprintMode(target);
  }

  function setFootprintTool(name) {
    if (!ctx.footprintEditor) return;
    const state = ctx.layersPanel.getState();
    try {
      if (name === 'pad') ctx.footprintEditor.setTool('pad', { layer: state.padLayer });
      else if (name === 'graphic') ctx.footprintEditor.setTool('graphic', { layer: state.layer, shape: state.shape });
      else ctx.footprintEditor.setTool(name);
      ctx.syncLayersFromEditor();
      ctx.syncChrome();
    } catch (error) {
      ctx.handleError(error, '切换封装工具');
    }
  }

  function saveFootprintToLibrary() {
    if (!ctx.footprintEditor) return;
    const fstore = ctx.footprintEditor.getStore();
    let def = clone(fstore.getFootprint());
    if (!Array.isArray(def.pads) || def.pads.length === 0) {
      ctx.showToast('请先放置至少一个焊盘再保存到工程库', 'warn');
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
      ctx.store.update((sheet, project) => {
        const list = project.library.footprints;
        const index = list.findIndex((item) => item && item.id === def.id);
        if (index >= 0) list[index] = clone(def);
        else list.push(clone(def));
      }, { label: '保存封装 ' + footprintLabel(def) });
      ctx.footprintDirty = false;
      ctx.lastFootprintId = def.id;
      ctx.librarySignatureCache = ctx.librarySignature();
      ctx.libraryPanel.refresh();
      ctx.propertiesPanel.refresh(true);
      ctx.syncChrome();
      ctx.showToast('封装已保存到工程库：' + footprintLabel(def), 'success');
    } catch (error) {
      ctx.handleError(error, '保存封装');
    }
  }

  async function newFootprint() {
    const name = await promptDialog({
      root: ctx.layout.modalRoot,
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
    const def = ctx.store.getProject().library.footprints.find((item) => item && item.id === footprintId);
    if (!def) {
      ctx.showToast('找不到封装：' + footprintId, 'warn');
      return;
    }
    ctx.lastFootprintId = footprintId;
    await enterFootprintMode(def);
  }

  return {
    enterFootprintMode,
    exitFootprintMode,
    toggleFootprintMode,
    setFootprintTool,
    saveFootprintToLibrary,
    newFootprint,
    editFootprint,
  };
}
