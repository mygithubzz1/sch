// 编辑器装配与画布尺寸同步：创建原理图/封装编辑器、吸附开关包装与尺寸调度。
import { createFootprintStore, createSchematicEditor } from '../editor/index.js';
import { DEFAULT_THEME } from '../render/theme.js';

/**
 * 创建编辑器装配器。
 * @param {object} ctx 组合根上下文
 * @returns {object} 编辑器相关函数
 */
export function createEditorSetup(ctx) {
  function applySnapWrapper(editor) {
    const context = editor && typeof editor.getContext === 'function' ? editor.getContext() : null;
    if (!context || typeof context.snapPoint !== 'function') return;
    const original = context.snapPoint;
    context.snapPoint = function snapWithToggle(point, snapOptions = {}) {
      if (ctx.snapEnabled) return original(point, snapOptions);
      const tolerancePx = snapOptions && Number.isFinite(Number(snapOptions.tolerancePx))
        ? Number(snapOptions.tolerancePx)
        : 10;
      const anchor = typeof context.findSnapPoint === 'function' ? context.findSnapPoint(point, tolerancePx) : null;
      return anchor ? { x: anchor.x, y: anchor.y } : { x: point.x, y: point.y };
    };
  }

  function ensureSchematicEditor() {
    if (ctx.schematicEditor) return ctx.schematicEditor;
    ctx.schematicEditor = createSchematicEditor({
      canvas: ctx.layout.schematicCanvas,
      store: ctx.store,
      options: {
        theme: DEFAULT_THEME,
        grid: ctx.store.getProject().grid,
        onError(error, method) {
          console.error('[schematic-studio] 原理图编辑器错误', method, error);
        },
      },
    });
    applySnapWrapper(ctx.schematicEditor);
    ctx.schematicEditor.on('tool', () => ctx.syncChrome());
    ctx.schematicEditor.on('error', (payload) => {
      if (payload && payload.error) ctx.handleError(payload.error, '画布操作');
    });
    return ctx.schematicEditor;
  }

  function attachFootprintEditor(editor) {
    const store = editor.getStore();
    store.on('changed', () => {
      ctx.footprintDirty = true;
      ctx.syncChrome();
    });
    store.on('selection', () => ctx.syncChrome());
    store.on('hover', () => {});
    editor.on('tool', () => {
      syncLayersFromEditor();
      ctx.syncChrome();
    });
    editor.on('view', () => ctx.updateStatusOnly());
    editor.on('error', (payload) => {
      if (payload && payload.error) ctx.handleError(payload.error, '封装画布操作');
    });
  }

  function syncLayersFromEditor() {
    if (!ctx.layersPanel || !ctx.footprintEditor) return;
    const tool = ctx.footprintEditor.getTool();
    const state = ctx.layersPanel.getState();
    if (tool === 'graphic') {
      const layer = ctx.footprintEditor.getLayer();
      ctx.layersPanel.setState({ layer, shape: ctx.footprintEditor.getGraphicShape(), padLayer: state.padLayer });
    } else if (tool === 'pad') {
      ctx.padLayer = ctx.footprintEditor.getLayer();
      ctx.layersPanel.setState({ layer: state.layer, shape: state.shape, padLayer: ctx.padLayer });
    }
  }

  function resizeActive() {
    const editor = ctx.activeEditor();
    if (!editor) return;
    try {
      editor.getRenderer().resize();
    } catch (error) {
      console.warn('[schematic-studio] 画布尺寸同步失败', error);
    }
  }

  function scheduleResize() {
    if (ctx.resizeFrame !== null || ctx.destroyed) return;
    ctx.resizeFrame = requestAnimationFrame(() => {
      ctx.resizeFrame = null;
      resizeActive();
      ctx.syncChrome();
    });
  }

  function bindPointerStatus(canvas) {
    canvas.addEventListener('pointermove', (event) => {
      const editor = ctx.activeEditor();
      if (!editor) return;
      const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
      ctx.pointerWorld = editor.screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      ctx.updateStatusOnly();
    });
    canvas.addEventListener('pointerleave', () => {
      ctx.pointerWorld = null;
      ctx.updateStatusOnly();
    });
  }

  return {
    applySnapWrapper,
    ensureSchematicEditor,
    attachFootprintEditor,
    syncLayersFromEditor,
    resizeActive,
    scheduleResize,
    bindPointerStatus,
  };
}
