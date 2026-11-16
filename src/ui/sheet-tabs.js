// 多图纸标签页：切换、新建、双击重命名、关闭删除，直接订阅 store 刷新。
import { el, clear } from './dom.js';
import { iconNode } from './icons.js';
import { sheetLabel } from './view-model.js';

/**
 * 创建图纸标签页。
 * @param {object} config { store, onSelect, onNew, onRename, onDelete }
 * @returns {object} { element, refresh, destroy }
 */
export function createSheetTabs(config = {}) {
  const store = config.store;
  if (!store) throw new TypeError('createSheetTabs 需要 store');
  const onSelect = typeof config.onSelect === 'function' ? config.onSelect : (id) => store.setSheetId(id);
  const onNew = typeof config.onNew === 'function' ? config.onNew : () => {};
  const onRename = typeof config.onRename === 'function' ? config.onRename : () => {};
  const onDelete = typeof config.onDelete === 'function' ? config.onDelete : () => {};

  const list = el('div', { class: 'sheet-tab-list', attrs: { role: 'tablist', 'aria-label': '图纸' } });
  const addButton = el('button', {
    class: 'sheet-add',
    attrs: { type: 'button', title: '新建图纸', 'aria-label': '新建图纸' },
    on: { click: () => onNew() },
  }, [iconNode('plus')]);
  const hint = el('span', { class: 'sheet-hint', text: '双击标签重命名' });
  const element = el('div', { class: 'sheet-tabs' }, [list, addButton, hint]);

  function refresh() {
    clear(list);
    const project = store.getProject();
    const sheets = Array.isArray(project.sheets) ? project.sheets : [];
    const activeId = store.getSheetId();
    sheets.forEach((sheet, index) => {
      if (!sheet) return;
      const active = sheet.id === activeId;
      const label = sheetLabel(sheet, index);
      const tab = el('div', {
        class: 'sheet-tab' + (active ? ' is-active' : ''),
        attrs: {
          role: 'tab',
          tabindex: active ? '0' : '-1',
          'aria-selected': active ? 'true' : 'false',
          title: label + '（双击重命名）',
        },
        on: {
          click: () => {
            if (!active) onSelect(sheet.id);
          },
          dblclick: (event) => {
            event.preventDefault();
            onRename(sheet.id, label);
          },
          keydown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(sheet.id);
            }
          },
        },
      }, [
        el('span', { class: 'sheet-tab-name', text: label }),
        el('button', {
          class: 'sheet-close',
          attrs: { type: 'button', title: '删除图纸', 'aria-label': '删除图纸 ' + label },
          text: '×',
          on: {
            click: (event) => {
              event.stopPropagation();
              onDelete(sheet.id);
            },
          },
        }),
      ]);
      list.appendChild(tab);
    });
  }

  const offs = [
    store.on('sheet', refresh),
    store.on('changed', refresh),
  ];
  refresh();

  return {
    element,
    refresh,
    destroy() {
      for (const off of offs) {
        if (typeof off === 'function') off();
      }
      offs.length = 0;
      clear(list);
    },
  };
}
