// 编辑动作：工具切换、放置/连线/标签/文本/删除入口、撤销重做、缩放适配与选择操作。
/**
 * 创建编辑动作。
 * @param {object} ctx 组合根上下文
 * @returns {object} 编辑动作
 */
export function createEditActions(ctx) {
  function setSchematicTool(name, toolOptions) {
    if (ctx.mode === 'footprint') return false;
    const editor = ctx.ensureSchematicEditor();
    try {
      const ok = editor.setTool(name, toolOptions || {});
      ctx.syncChrome();
      return ok;
    } catch (error) {
      ctx.handleError(error, '切换工具');
      return false;
    }
  }

  function placeSymbol(symbolId) {
    if (!symbolId) return;
    ctx.lastSymbolId = symbolId;
    ctx.libraryPanel.setSelectedSymbol(symbolId);
    if (ctx.mode === 'footprint') {
      ctx.showToast('请先返回原理图再放置符号', 'warn');
      return;
    }
    const editor = ctx.ensureSchematicEditor();
    editor.setTool('place', { symbolId });
    ctx.syncChrome();
    ctx.showToast('点击画布放置 ' + symbolId + '（R 旋转 / X 镜像 / Esc 取消）', 'info');
  }

  function selectTool() {
    if (ctx.mode === 'footprint') ctx.setFootprintTool('select');
    else setSchematicTool('select');
  }

  function wireTool() {
    if (ctx.mode === 'footprint') return;
    if (setSchematicTool('wire')) ctx.showToast('导线工具：连续点击画线，Enter 或双击结束', 'info');
  }

  function placeTool() {
    if (ctx.mode === 'footprint') return;
    if (ctx.lastSymbolId) {
      placeSymbol(ctx.lastSymbolId);
      return;
    }
    ctx.libraryPanel.setTab('symbols');
    ctx.libraryPanel.focusSearch();
    ctx.showToast('请在左侧元件库中选择符号，然后点击画布放置', 'info');
  }

  function labelTool() {
    if (ctx.mode === 'footprint') return;
    if (setSchematicTool('label', { text: 'NET', kind: 'local' })) {
      ctx.showToast('标签工具：点击放置，G 切换全局/局部', 'info');
    }
  }

  function textTool() {
    if (ctx.mode === 'footprint') return;
    if (setSchematicTool('text', { text: '文本', size: 1.27 })) {
      ctx.showToast('文本工具：点击画布放置注释', 'info');
    }
  }

  function eraseTool() {
    if (ctx.mode === 'footprint') return;
    if (setSchematicTool('erase')) ctx.showToast('删除工具：点击对象即可删除', 'info');
  }

  function undoActive() {
    try {
      if (ctx.mode === 'footprint') {
        if (ctx.footprintEditor) ctx.footprintEditor.undo();
      } else {
        ctx.store.undo();
      }
      ctx.syncChrome();
    } catch (error) {
      ctx.handleError(error, '撤销');
    }
  }

  function redoActive() {
    try {
      if (ctx.mode === 'footprint') {
        if (ctx.footprintEditor) ctx.footprintEditor.redo();
      } else {
        ctx.store.redo();
      }
      ctx.syncChrome();
    } catch (error) {
      ctx.handleError(error, '重做');
    }
  }

  function deleteActive() {
    const editor = ctx.activeEditor();
    if (!editor) return;
    try {
      editor.deleteSelection();
      ctx.syncChrome();
    } catch (error) {
      ctx.handleError(error, '删除');
    }
  }

  function selectAllActive() {
    const editor = ctx.activeEditor();
    if (!editor) return;
    try {
      editor.selectAll();
      ctx.syncChrome();
    } catch (error) {
      ctx.handleError(error, '全选');
    }
  }

  function zoomBy(factor) {
    const editor = ctx.activeEditor();
    if (!editor) return;
    const renderer = editor.getRenderer();
    const size = renderer.getSize();
    renderer.zoomAt({ x: size.width / 2, y: size.height / 2 }, factor);
    if (ctx.mode === 'schematic') {
      ctx.store.setView(renderer.getView());
    } else {
      ctx.updateStatusOnly();
    }
    ctx.syncChrome();
  }

  function fitActive() {
    const editor = ctx.activeEditor();
    if (!editor) return;
    try {
      editor.fitToContent(ctx.mode === 'footprint' ? 40 : 48);
      ctx.syncChrome();
    } catch (error) {
      ctx.handleError(error, '缩放适配');
    }
  }

  function toggleGridSnap() {
    if (ctx.mode === 'footprint') {
      ctx.showToast('封装编辑固定使用 0.635 mm 栅格吸附', 'info');
      return;
    }
    ctx.snapEnabled = !ctx.snapEnabled;
    ctx.syncChrome();
    ctx.showToast(
      ctx.snapEnabled ? '网格吸附已开启' : '网格吸附已关闭（仍会吸附引脚与导线端点）',
      'info',
    );
  }

  function rotateSelectionByHotkey() {
    if (ctx.mode !== 'schematic' || !ctx.schematicEditor) return;
    if (ctx.schematicEditor.getTool() === 'place') return;
    const ids = ctx.store.getSelection();
    if (ids.length === 0) {
      ctx.showToast('请先选择符号（R 可在放置模式下旋转预览）', 'info');
      return;
    }
    const sheet = ctx.store.getSheet();
    const hasSymbol = ids.some((id) => (Array.isArray(sheet.symbols) ? sheet.symbols : []).some((item) => item.id === id));
    if (!hasSymbol) {
      ctx.showToast('所选对象中没有符号', 'info');
      return;
    }
    try {
      ctx.schematicEditor.getCommands().rotateSymbols(ctx.store.getSheetId(), ids, 90, { label: '旋转符号 90°' });
    } catch (error) {
      ctx.handleError(error, '旋转符号');
    }
  }

  function mirrorSelectionByHotkey() {
    if (ctx.mode !== 'schematic' || !ctx.schematicEditor) return;
    if (ctx.schematicEditor.getTool() === 'place') return;
    const ids = ctx.store.getSelection();
    if (ids.length === 0) {
      ctx.showToast('请先选择符号（X 可在放置模式下切换镜像）', 'info');
      return;
    }
    const sheet = ctx.store.getSheet();
    const hasSymbol = ids.some((id) => (Array.isArray(sheet.symbols) ? sheet.symbols : []).some((item) => item.id === id));
    if (!hasSymbol) {
      ctx.showToast('所选对象中没有符号', 'info');
      return;
    }
    try {
      ctx.schematicEditor.getCommands().mirrorSymbols(ctx.store.getSheetId(), ids, undefined, { label: '镜像符号' });
    } catch (error) {
      ctx.handleError(error, '镜像符号');
    }
  }

  function showProjectProps() {
    if (ctx.mode === 'footprint') {
      ctx.showToast('请先返回原理图再编辑工程与图纸属性', 'warn');
      return;
    }
    ctx.store.setSelection([]);
    ctx.propertiesPanel.refresh(true);
    const node = ctx.propertiesPanel.element;
    node.classList.remove('is-flash');
    void node.offsetWidth;
    node.classList.add('is-flash');
    setTimeout(() => node.classList.remove('is-flash'), 900);
    ctx.showToast('在右侧属性面板编辑图纸与工程属性', 'info');
  }

  return {
    setSchematicTool,
    placeSymbol,
    selectTool,
    wireTool,
    placeTool,
    labelTool,
    textTool,
    eraseTool,
    undoActive,
    redoActive,
    deleteActive,
    selectAllActive,
    zoomBy,
    fitActive,
    toggleGridSnap,
    rotateSelectionByHotkey,
    mirrorSelectionByHotkey,
    showProjectProps,
  };
}
