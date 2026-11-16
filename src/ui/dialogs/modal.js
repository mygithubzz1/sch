// 通用模态对话框：遮罩、Escape 关闭、Tab 焦点循环、确认框与输入框。
import { appendChildren, el } from '../dom.js';

const modalStack = [];
let documentListener = null;

function focusableElements(dialog) {
  if (!dialog || typeof dialog.querySelectorAll !== 'function') return [];
  const selector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(dialog.querySelectorAll(selector)).filter((node) => !node.hidden);
}

function trapFocus(event, entry) {
  const items = focusableElements(entry.dialog);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !entry.dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function ensureDocumentListener() {
  if (documentListener || typeof document === 'undefined') return;
  documentListener = (event) => {
    const top = modalStack[modalStack.length - 1];
    if (!top) return;
    if (event.key === 'Escape' && top.closable) {
      event.preventDefault();
      event.stopPropagation();
      top.close('escape');
      return;
    }
    if (event.key === 'Tab') trapFocus(event, top);
  };
  document.addEventListener('keydown', documentListener, true);
}

function releaseDocumentListener() {
  if (modalStack.length > 0 || !documentListener) return;
  document.removeEventListener('keydown', documentListener, true);
  documentListener = null;
}

/** 是否有打开的对话框（快捷键据此暂停）。 */
export function hasOpenModal() {
  return modalStack.length > 0;
}

/**
 * 打开模态对话框。
 * @param {object} config { root, title, subtitle, body, actions, width, closable, className, onClose }
 * @returns {{element: HTMLElement, body: HTMLElement, close: Function}}
 */
export function openModal(config = {}) {
  const container = config.root || (typeof document === 'undefined' ? null : document.body);
  if (!container) throw new Error('openModal 需要挂载容器');
  const closable = config.closable !== false;
  const title = typeof config.title === 'string' ? config.title : '对话框';
  const previousFocus = typeof document === 'undefined' ? null : document.activeElement;

  const titleNode = el('h2', { class: 'modal-title', text: title, attrs: { id: 'modal-title-' + (modalStack.length + 1) } });
  const subtitleNode = config.subtitle
    ? el('p', { class: 'modal-subtitle', text: String(config.subtitle) })
    : null;
  const closeButton = closable
    ? el('button', {
      class: 'icon-btn modal-close',
      attrs: { type: 'button', 'aria-label': '关闭对话框' },
      text: '×',
    })
    : null;
  const body = el('div', { class: 'modal-body' });
  appendChildren(body, config.body || []);
  const footer = el('footer', { class: 'modal-footer' });
  const backdrop = el('div', { class: 'modal-backdrop' });
  const dialog = el('section', {
    class: 'modal' + (config.className ? ' ' + config.className : ''),
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleNode.id,
    },
  }, [
    el('header', { class: 'modal-header' }, [
      el('div', { class: 'modal-heading' }, [titleNode, subtitleNode]),
      closeButton,
    ]),
    body,
    footer,
  ]);
  if (Number.isFinite(Number(config.width)) && Number(config.width) > 0) {
    dialog.style.width = Number(config.width) + 'px';
  } else if (typeof config.width === 'string' && config.width !== '') {
    dialog.style.width = config.width;
  }
  backdrop.appendChild(dialog);
  container.appendChild(backdrop);

  let closed = false;
  const entry = {
    element: backdrop,
    dialog,
    body,
    footer,
    closable,
    close(reason = 'programmatic') {
      if (closed) return;
      closed = true;
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      const index = modalStack.indexOf(entry);
      if (index >= 0) modalStack.splice(index, 1);
      releaseDocumentListener();
      if (previousFocus && typeof previousFocus.focus === 'function') {
        try {
          previousFocus.focus();
        } catch {
          // 忽略宿主环境不支持聚焦的情况。
        }
      }
      if (typeof config.onClose === 'function') config.onClose(reason);
    },
  };

  const context = {
    element: backdrop,
    dialog,
    body,
    footer,
    close: () => entry.close('action'),
  };

  if (closeButton) closeButton.addEventListener('click', () => entry.close('close-button'));
  if (closable) {
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) entry.close('backdrop');
    });
  }

  const actions = Array.isArray(config.actions) ? config.actions : [];
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    const kind = action.kind === 'primary' ? 'primary' : action.kind === 'danger' ? 'danger' : 'ghost';
    const button = el('button', {
      class: 'btn btn-' + kind + (action.autofocus ? ' autofocus' : ''),
      attrs: { type: 'button' },
      text: action.label || '确定',
      on: {
        click: () => {
          if (typeof action.onClick === 'function') {
            const result = action.onClick(context);
            if (result === false) return;
          }
          if (action.close !== false) entry.close('action');
        },
      },
    });
    if (action.disabled) button.disabled = true;
    footer.appendChild(button);
    if (action.autofocus) {
      setTimeout(() => {
        try {
          button.focus();
        } catch {
          // 忽略聚焦失败。
        }
      }, 0);
    }
  }
  if (footer.children.length === 0) footer.remove();

  modalStack.push(entry);
  ensureDocumentListener();
  setTimeout(() => {
    const focusTarget = body.querySelector('input, textarea, select');
    const autofocusButton = dialog.querySelector('.autofocus');
    try {
      if (focusTarget) focusTarget.focus();
      else if (autofocusButton) autofocusButton.focus();
      else dialog.focus();
    } catch {
      // 忽略聚焦失败。
    }
  }, 0);

  return { element: backdrop, dialog, body, footer, close: context.close };
}

/**
 * 确认对话框；返回是否确认。
 * @param {object} config { root, title, message, confirmLabel, cancelLabel, danger }
 * @returns {Promise<boolean>} 用户选择
 */
export function confirmDialog(config = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const body = el('p', { class: 'dialog-message', text: String(config.message || '') });
    openModal({
      root: config.root,
      title: config.title || '请确认',
      subtitle: config.subtitle,
      body,
      width: config.width || 420,
      onClose: () => finish(false),
      actions: [
        { label: config.cancelLabel || '取消', kind: 'ghost', onClick: () => finish(false) },
        {
          label: config.confirmLabel || '确定',
          kind: config.danger ? 'danger' : 'primary',
          autofocus: true,
          onClick: () => finish(true),
        },
      ],
    });
  });
}

/**
 * 文本输入对话框；返回输入值或 null（取消）。
 * @param {object} config { root, title, label, value, placeholder, hint, multiline, confirmLabel, validate }
 * @returns {Promise<string|null>} 输入内容
 */
export function promptDialog(config = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const input = config.multiline
      ? el('textarea', { class: 'input', rows: 4, attrs: { placeholder: config.placeholder || '' } })
      : el('input', {
        class: 'input',
        attrs: { type: 'text', placeholder: config.placeholder || '', autocomplete: 'off' },
      });
    input.value = config.value === undefined || config.value === null ? '' : String(config.value);
    const error = el('p', { class: 'field-error', attrs: { role: 'alert' } });
    const field = el('label', { class: 'field' }, [
      el('span', { class: 'field-label', text: config.label || '名称' }),
      input,
      config.hint ? el('span', { class: 'field-hint', text: config.hint }) : null,
      error,
    ]);
    const modal = openModal({
      root: config.root,
      title: config.title || '输入',
      body: field,
      width: config.width || 420,
      onClose: () => finish(null),
      actions: [
        { label: '取消', kind: 'ghost', onClick: () => finish(null) },
        { label: config.confirmLabel || '确定', kind: 'primary', onClick: submit, close: false },
      ],
    });
    function submit() {
      const value = input.value;
      const message = typeof config.validate === 'function' ? config.validate(value) : '';
      if (typeof message === 'string' && message !== '') {
        error.textContent = message;
        try {
          input.focus();
        } catch {
          // 忽略聚焦失败。
        }
        return;
      }
      finish(value);
      modal.close();
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && config.multiline !== true) {
        event.preventDefault();
        submit();
      }
    });
  });
}
