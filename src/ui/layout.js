// 应用外壳布局：创建菜单栏/工具栏槽位、画布、面板列、模态与提示容器，以及封装模式栏。
import { clear, el } from './dom.js';
import { iconNode } from './icons.js';

/**
 * 构建应用外壳 DOM（只创建节点，不处理业务）。
 * @param {HTMLElement} root 挂载容器
 * @returns {object} 布局节点集合
 */
export function buildLayout(root) {
  clear(root);
  const topBar = el('div', { class: 'top-bars' });
  const librarySlot = el('div', { class: 'slot slot-library' });
  const layersSlot = el('div', { class: 'slot slot-layers' });
  const left = el('aside', { class: 'side-column side-left', attrs: { 'aria-label': '左侧面板' } }, [
    librarySlot,
    layersSlot,
  ]);
  const sheetTabsSlot = el('div', { class: 'slot slot-sheet-tabs' });
  const modeBarSlot = el('div', { class: 'slot slot-mode-bar' });
  const schematicCanvas = el('canvas', {
    class: 'editor-canvas editor-canvas--schematic',
    attrs: { 'aria-label': '原理图画布', tabindex: '0' },
  });
  const footprintCanvas = el('canvas', {
    class: 'editor-canvas editor-canvas--footprint',
    attrs: { 'aria-label': '封装画布', tabindex: '0' },
    hidden: true,
  });
  const canvasHint = el('div', { class: 'canvas-hint' }, [
    el('span', { class: 'canvas-hint-title', text: '空白原理图' }),
    el('span', {
      class: 'canvas-hint-text',
      text: '从左侧元件库点选符号放置，按 W 画导线，按 F 适配视图',
    }),
  ]);
  const canvasStack = el('div', { class: 'canvas-stack' }, [schematicCanvas, footprintCanvas, canvasHint]);
  const netlistSlot = el('div', { class: 'slot slot-netlist' });
  const center = el('main', { class: 'center' }, [sheetTabsSlot, modeBarSlot, canvasStack, netlistSlot]);
  const propertiesSlot = el('div', { class: 'slot slot-properties' });
  const right = el('aside', { class: 'side-column side-right', attrs: { 'aria-label': '属性面板' } }, [propertiesSlot]);
  const workspace = el('div', { class: 'workspace' }, [left, center, right]);
  const statusSlot = el('div', { class: 'slot slot-status' });
  const shell = el('div', { class: 'app-shell' }, [topBar, workspace, statusSlot]);
  const modalRoot = el('div', { class: 'modal-root' });
  const toastRoot = el('div', { class: 'toast-root', attrs: { 'aria-live': 'polite' } });
  const fileInput = el('input', {
    class: 'file-input',
    attrs: {
      type: 'file',
      accept: '.json,.schproj.json,application/json',
      'aria-hidden': 'true',
      tabindex: '-1',
    },
  });
  // KiCad 网表导入使用独立 input，避免与「打开工程」共用 accept/change 语义。
  const netlistFileInput = el('input', {
    class: 'file-input',
    attrs: {
      type: 'file',
      accept: '.net,text/plain',
      'aria-hidden': 'true',
      tabindex: '-1',
    },
  });
  root.append(shell, modalRoot, toastRoot, fileInput, netlistFileInput);
  return {
    root,
    shell,
    topBar,
    librarySlot,
    layersSlot,
    sheetTabsSlot,
    modeBarSlot,
    netlistSlot,
    propertiesSlot,
    statusSlot,
    schematicCanvas,
    footprintCanvas,
    canvasStack,
    canvasHint,
    modalRoot,
    toastRoot,
    fileInput,
    netlistFileInput,
  };
}

/**
 * 创建封装编辑模式栏（封装专用工具与保存/返回按钮）。
 * @param {object} config { onTool, onUndo, onRedo, onDelete, onFit, onSave, onExit }
 * @returns {object} 模式栏 API
 */
export function createModeBar(config = {}) {
  const callbacks = {
    onTool: typeof config.onTool === 'function' ? config.onTool : () => {},
    onUndo: typeof config.onUndo === 'function' ? config.onUndo : () => {},
    onRedo: typeof config.onRedo === 'function' ? config.onRedo : () => {},
    onDelete: typeof config.onDelete === 'function' ? config.onDelete : () => {},
    onFit: typeof config.onFit === 'function' ? config.onFit : () => {},
    onSave: typeof config.onSave === 'function' ? config.onSave : () => {},
    onExit: typeof config.onExit === 'function' ? config.onExit : () => {},
  };
  const toolButtons = new Map();
  const toolDefinitions = [
    { id: 'select', icon: 'select', label: '选择' },
    { id: 'pad', icon: 'chip', label: '焊盘' },
    { id: 'move', icon: 'move', label: '移动' },
    { id: 'graphic', icon: 'graphic', label: '图形' },
  ];
  const toolGroup = el('div', { class: 'toolbar-group mode-tool-group' }, toolDefinitions.map((definition) => {
    const button = el('button', {
      class: 'tool-btn',
      attrs: { type: 'button', title: definition.label, 'aria-label': definition.label },
      on: { click: () => callbacks.onTool(definition.id) },
    }, [iconNode(definition.icon), el('span', { class: 'tool-btn-label', text: definition.label })]);
    toolButtons.set(definition.id, button);
    return button;
  }));

  const actionButtons = new Map();
  const actionDefinitions = [
    { id: 'undo', icon: 'undo', label: '撤销', handler: 'onUndo' },
    { id: 'redo', icon: 'redo', label: '重做', handler: 'onRedo' },
    { id: 'delete', icon: 'trash', label: '删除', handler: 'onDelete' },
    { id: 'fit', icon: 'fit', label: '适配', handler: 'onFit' },
  ];
  const actionNodes = actionDefinitions.map((definition) => {
    const button = el('button', {
      class: 'tool-btn',
      attrs: { type: 'button', title: definition.label, 'aria-label': definition.label },
      on: { click: () => callbacks[definition.handler]() },
    }, [iconNode(definition.icon), el('span', { class: 'tool-btn-label', text: definition.label })]);
    actionButtons.set(definition.id, button);
    return button;
  });

  const title = el('span', { class: 'mode-title' });
  const dirtyLabel = el('span', { class: 'mode-dirty' });
  const saveButton = el('button', {
    class: 'btn btn-primary btn-sm',
    attrs: { type: 'button' },
    on: { click: () => callbacks.onSave() },
  }, [iconNode('save'), el('span', { text: '保存到工程库' })]);
  const exitButton = el('button', {
    class: 'btn btn-ghost btn-sm',
    attrs: { type: 'button' },
    on: { click: () => callbacks.onExit() },
  }, [iconNode('select'), el('span', { text: '返回原理图' })]);

  const element = el('div', { class: 'mode-bar', hidden: true }, [
    el('span', { class: 'mode-badge', text: '封装编辑' }),
    title,
    el('div', { class: 'mode-tools' }, [toolGroup, ...actionNodes]),
    el('div', { class: 'mode-spacer' }),
    dirtyLabel,
    saveButton,
    exitButton,
  ]);

  return {
    element,
    title,
    dirtyLabel,
    saveButton,
    exitButton,
    setActiveTool(activeTool) {
      for (const [id, button] of toolButtons) button.classList.toggle('is-active', id === activeTool);
    },
    setEnabled(id, enabled) {
      const button = actionButtons.get(id);
      if (button) button.disabled = !enabled;
    },
  };
}
