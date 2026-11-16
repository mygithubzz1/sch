// 轻量消息提示：右下角浮动卡片，自动消失，可点击关闭。
import { el } from './dom.js';

const DEFAULT_TIMEOUT = 3200;

/**
 * 创建提示宿主。
 * @param {HTMLElement} host 容器（通常是 .toast-root）
 * @returns {object} { show, info, success, warn, error, clear }
 */
export function createToastHost(host) {
  let timer = null;

  function clear() {
    if (host) host.textContent = '';
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /**
   * 显示一条提示。
   * @param {string} message 文案
   * @param {{type?: 'info'|'success'|'warn'|'error', timeout?: number}} [options] 样式与时长
   * @returns {HTMLElement|null} 提示节点
   */
  function show(message, options = {}) {
    if (!host || typeof document === 'undefined') return null;
    const type = ['info', 'success', 'warn', 'error'].includes(options.type) ? options.type : 'info';
    const node = el('div', { class: 'toast toast--' + type, attrs: { role: 'status' } }, [
      el('span', { class: 'toast-dot' }),
      el('span', { class: 'toast-text', text: String(message === undefined || message === null ? '' : message) }),
      el('button', {
        class: 'toast-close',
        attrs: { type: 'button', 'aria-label': '关闭提示' },
        text: '×',
        on: { click: () => node.remove() },
      }),
    ]);
    host.appendChild(node);
    while (host.children.length > 4) host.removeChild(host.firstChild);
    if (timer) clearTimeout(timer);
    const timeout = Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : DEFAULT_TIMEOUT;
    if (timeout > 0) {
      timer = setTimeout(() => {
        timer = null;
        node.classList.add('toast--leave');
        setTimeout(() => node.remove(), 220);
      }, timeout);
    }
    return node;
  }

  return {
    show,
    info: (message, options) => show(message, { ...options, type: 'info' }),
    success: (message, options) => show(message, { ...options, type: 'success' }),
    warn: (message, options) => show(message, { ...options, type: 'warn' }),
    error: (message, options) => show(message, { ...options, type: 'error', timeout: 5200 }),
    clear,
  };
}
