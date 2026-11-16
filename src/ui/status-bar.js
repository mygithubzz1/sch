// 状态栏：坐标、网格、缩放、当前工具、网络数与吸附状态，指针移动时只更新文本。
import { el, setText } from './dom.js';
import { statusSegments } from './view-model.js';

/**
 * 创建状态栏。
 * @returns {object} { element, update }
 */
export function createStatusBar() {
  const items = new Map();
  const element = el('footer', { class: 'statusbar', attrs: { role: 'status', 'aria-live': 'off' } });
  const selection = el('span', { class: 'status-selection' });
  element.appendChild(selection);

  function ensure(key) {
    if (items.has(key)) return items.get(key);
    const value = el('span', { class: 'status-value' });
    const item = el('span', { class: 'status-item', attrs: { 'data-key': key } }, [
      el('span', { class: 'status-label' }),
      value,
    ]);
    items.set(key, { item, label: item.firstChild, value });
    element.insertBefore(item, selection);
    return items.get(key);
  }

  /**
   * 更新状态栏。
   * @param {object} state { pointer, grid, scale, tool, netCount, snap, mode, selectionCount, sheetName }
   */
  function update(state = {}) {
    const segments = statusSegments(state);
    for (const segment of segments) {
      const entry = ensure(segment.key);
      setText(entry.label, segment.label);
      setText(entry.value, segment.value);
    }
    for (const [key, entry] of items) {
      if (segments.some((segment) => segment.key === key)) continue;
      entry.item.remove();
      items.delete(key);
    }
    const count = Number(state.selectionCount) || 0;
    const sheetName = typeof state.sheetName === 'string' ? state.sheetName : '';
    setText(selection, (sheetName ? sheetName + ' · ' : '') + (count > 0 ? '已选 ' + count + ' 项' : '就绪'));
  }

  update({});

  return { element, update };
}
