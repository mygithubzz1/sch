// 菜单栏与工具栏：菜单下拉、工具按钮、撤销/重做与吸附状态，全部通过 actions 回调驱动。
import { el, clear } from './dom.js';
import { iconNode } from './icons.js';

const MENU_DEFINITIONS = Object.freeze([
  {
    id: 'file',
    label: '文件',
    items: [
      { id: 'newProject', label: '新建工程', shortcut: 'Ctrl+N' },
      { id: 'openProject', label: '打开工程…', shortcut: 'Ctrl+O' },
      { id: 'saveProject', label: '保存', shortcut: 'Ctrl+S' },
      { id: 'saveProjectAs', label: '另存为…', shortcut: 'Ctrl+Shift+S' },
      { separator: true },
      { id: 'exportNetlist', label: '导出网表…', shortcut: 'Ctrl+E' },
      { id: 'exportSvg', label: '导出 SVG…' },
      { id: 'exportPng', label: '导出 PNG…' },
      { separator: true },
      { id: 'exportFootprints', label: '导出封装库 JSON…' },
      { id: 'restoreDraft', label: '恢复本地草稿' },
    ],
  },
  {
    id: 'edit',
    label: '编辑',
    items: [
      { id: 'undo', label: '撤销', shortcut: 'Ctrl+Z', needsUndo: true },
      { id: 'redo', label: '重做', shortcut: 'Ctrl+Shift+Z', needsRedo: true },
      { separator: true },
      { id: 'selectAll', label: '全选', shortcut: 'Ctrl+A' },
      { id: 'delete', label: '删除所选', shortcut: 'Delete', needsSelection: true },
      { separator: true },
      { id: 'projectProps', label: '工程与图纸属性' },
    ],
  },
  {
    id: 'place',
    label: '放置',
    items: [
      { id: 'selectTool', label: '选择工具', shortcut: 'V', needsSchematic: true },
      { id: 'wireTool', label: '导线', shortcut: 'W', needsSchematic: true },
      { id: 'placeTool', label: '放置符号…', needsSchematic: true },
      { id: 'labelTool', label: '网络标签', needsSchematic: true },
      { id: 'textTool', label: '文本', needsSchematic: true },
      { separator: true },
      { id: 'footprintMode', label: '封装编辑 / 返回原理图' },
    ],
  },
  {
    id: 'tools',
    label: '工具',
    items: [
      { id: 'gridSnap', label: '切换网格吸附', shortcut: 'G' },
      { id: 'fit', label: '缩放适配', shortcut: 'F' },
      { id: 'zoomIn', label: '放大', shortcut: '+' },
      { id: 'zoomOut', label: '缩小', shortcut: '-' },
      { separator: true },
      { id: 'generateNetlist', label: '生成网表' },
      { id: 'exportNetlist', label: '导出网表…' },
    ],
  },
  {
    id: 'help',
    label: '帮助',
    items: [
      { id: 'tips', label: '操作提示' },
      { id: 'shortcuts', label: '快捷键一览', shortcut: '?' },
      { id: 'about', label: '关于原理图工作室' },
    ],
  },
]);

const TOOL_GROUPS = Object.freeze([
  [
    { id: 'selectTool', icon: 'select', label: '选择', tool: 'select', shortcut: 'V' },
    { id: 'wireTool', icon: 'wire', label: '导线', tool: 'wire', shortcut: 'W' },
    { id: 'placeTool', icon: 'place', label: '放置', tool: 'place' },
    { id: 'labelTool', icon: 'label', label: '标签', tool: 'label' },
    { id: 'textTool', icon: 'text', label: '文本', tool: 'text' },
    { id: 'eraseTool', icon: 'erase', label: '删除', tool: 'erase' },
  ],
  [
    { id: 'undo', icon: 'undo', label: '撤销', shortcut: 'Ctrl+Z' },
    { id: 'redo', icon: 'redo', label: '重做', shortcut: 'Ctrl+Shift+Z' },
    { id: 'delete', icon: 'trash', label: '删除', shortcut: 'Delete' },
  ],
  [
    { id: 'gridSnap', icon: 'grid', label: '吸附', toggle: 'snap' },
    { id: 'fit', icon: 'fit', label: '适配', shortcut: 'F' },
  ],
  [
    { id: 'footprintMode', icon: 'footprint', label: '封装编辑', toggle: 'footprint' },
  ],
  [
    { id: 'generateNetlist', icon: 'netlist', label: '网表' },
    { id: 'exportNetlist', icon: 'export', label: '导出', shortcut: 'Ctrl+E' },
  ],
]);

/**
 * 创建顶部菜单栏与工具栏。
 * @param {object} config { actions }
 * @returns {object} { menuBar, toolbar, update, closeMenus, destroy }
 */
export function createToolbar(config = {}) {
  const actions = config.actions && typeof config.actions === 'object' ? config.actions : {};
  const menuRecords = [];
  const itemRecords = [];
  const toolRecords = [];
  let openWrap = null;
  let openPanel = null;

  function invoke(actionId) {
    closeMenus();
    const action = actions[actionId];
    if (typeof action === 'function') action();
  }

  function closeMenus() {
    for (const record of menuRecords) {
      record.panel.hidden = true;
      record.button.setAttribute('aria-expanded', 'false');
      record.wrap.classList.remove('is-open');
    }
    openWrap = null;
    openPanel = null;
  }

  function openMenu(record) {
    if (openPanel === record.panel) {
      closeMenus();
      return;
    }
    closeMenus();
    record.panel.hidden = false;
    record.button.setAttribute('aria-expanded', 'true');
    record.wrap.classList.add('is-open');
    openWrap = record.wrap;
    openPanel = record.panel;
  }

  function buildMenu(definition) {
    const button = el('button', {
      class: 'menu-btn',
      attrs: { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
      text: definition.label,
    });
    const panel = el('div', {
      class: 'menu',
      attrs: { role: 'menu', 'aria-label': definition.label },
      hidden: true,
    });
    for (const item of definition.items) {
      if (item.separator) {
        panel.appendChild(el('div', { class: 'menu-sep', attrs: { role: 'separator' } }));
        continue;
      }
      const itemNode = el('button', {
        class: 'menu-item',
        attrs: { type: 'button', role: 'menuitem' },
        on: { click: () => invoke(item.id) },
      }, [
        el('span', { class: 'menu-item-label', text: item.label }),
        item.shortcut ? el('span', { class: 'menu-item-shortcut', text: item.shortcut }) : null,
      ]);
      panel.appendChild(itemNode);
      itemRecords.push({ id: item.id, node: itemNode, flags: item });
    }
    const wrap = el('div', { class: 'menu-wrap' }, [button, panel]);
    const record = { wrap, button, panel, definition };
    menuRecords.push(record);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openMenu(record);
    });
    button.addEventListener('pointerenter', () => {
      if (openPanel && openPanel !== panel) openMenu(record);
    });
    return wrap;
  }

  function buildToolButton(definition) {
    const button = el('button', {
      class: 'tool-btn',
      attrs: {
        type: 'button',
        title: definition.label + (definition.shortcut ? ' (' + definition.shortcut + ')' : ''),
        'aria-label': definition.label,
      },
      on: { click: () => invoke(definition.id) },
    }, [
      iconNode(definition.icon),
      el('span', { class: 'tool-btn-label', text: definition.label }),
    ]);
    toolRecords.push({ id: definition.id, node: button, definition });
    return button;
  }

  const brand = el('div', { class: 'brand' }, [
    el('span', { class: 'brand-mark', text: '⚡' }),
    el('span', { class: 'brand-name', text: '原理图工作室' }),
  ]);
  const spacer = el('div', { class: 'menubar-spacer' });
  const projectLabel = el('span', { class: 'menubar-project' });
  const menuBar = el('header', { class: 'menubar', attrs: { role: 'banner' } }, [
    brand,
    el('nav', { class: 'menu-list', attrs: { role: 'menubar' } }, MENU_DEFINITIONS.map(buildMenu)),
    spacer,
    projectLabel,
  ]);

  const toolbarGroups = TOOL_GROUPS.map((group) => el('div', { class: 'toolbar-group' }, group.map(buildToolButton)));
  const toolbarMeta = el('div', { class: 'toolbar-meta' });
  const toolbar = el('div', { class: 'toolbar', attrs: { role: 'toolbar', 'aria-label': '主工具栏' } }, [
    ...toolbarGroups,
    toolbarMeta,
  ]);

  function onDocumentPointerDown(event) {
    if (!openWrap) return;
    if (event && openWrap.contains(event.target)) return;
    closeMenus();
  }
  function onDocumentKeyDown(event) {
    if (!openPanel) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenus();
      const active = menuRecords.find((record) => record.panel === openPanel);
      if (active) active.button.focus();
    }
  }
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onDocumentKeyDown, true);

  /**
   * 刷新菜单/工具栏状态。
   * @param {object} state { tool, canUndo, canRedo, selectionCount, snap, mode, projectName, dirty }
   */
  function update(state = {}) {
    for (const record of itemRecords) {
      const flags = record.flags;
      let disabled = false;
      if (flags.needsUndo && !state.canUndo) disabled = true;
      if (flags.needsRedo && !state.canRedo) disabled = true;
      if (flags.needsSelection && !(state.selectionCount > 0)) disabled = true;
      if (flags.needsSchematic && state.mode === 'footprint') disabled = true;
      record.node.disabled = disabled;
    }
    for (const record of toolRecords) {
      const definition = record.definition;
      let active = false;
      let disabled = false;
      if (definition.tool) active = state.mode !== 'footprint' && state.tool === definition.tool;
      if (definition.toggle === 'snap') active = state.snap !== false;
      if (definition.toggle === 'footprint') active = state.mode === 'footprint';
      if (definition.id === 'undo') disabled = !state.canUndo;
      if (definition.id === 'redo') disabled = !state.canRedo;
      if (definition.id === 'delete') disabled = !(state.selectionCount > 0);
      if (['selectTool', 'wireTool', 'placeTool', 'labelTool', 'textTool', 'eraseTool'].includes(definition.id)) {
        disabled = state.mode === 'footprint';
      }
      record.node.disabled = disabled;
      record.node.classList.toggle('is-active', active);
      record.node.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    projectLabel.textContent = (state.projectName || '未命名工程') + (state.dirty ? ' •' : '');
    projectLabel.title = state.dirty ? '有未保存的修改' : '工程已保存';
    const scope = state.mode === 'footprint' ? '封装编辑模式' : '原理图模式';
    toolbarMeta.textContent = scope + (state.selectionCount > 0 ? ' · 已选 ' + state.selectionCount : '');
  }

  update({});

  return {
    menuBar,
    toolbar,
    update,
    closeMenus,
    destroy() {
      closeMenus();
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      clear(menuBar);
      clear(toolbar);
    },
  };
}
