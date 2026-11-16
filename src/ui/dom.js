// DOM 构件助手：创建元素、批量挂载、事件与属性赋值；只在 UI 层使用，不涉及业务逻辑。

const PROPERTY_KEYS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'tabIndex', 'textContent']);
const ATTRIBUTE_KEYS = new Set([
  'role', 'type', 'placeholder', 'min', 'max', 'step', 'accept', 'autocomplete', 'name', 'for',
  'rows', 'cols', 'colspan', 'rowspan', 'spellcheck', 'draggable', 'aria-label', 'aria-hidden',
  'aria-expanded', 'aria-selected', 'aria-controls', 'aria-pressed', 'aria-modal', 'aria-live',
]);

function flatten(children, target) {
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      flatten(child, target);
    } else if (typeof child === 'string' || typeof child === 'number') {
      target.push(document.createTextNode(String(child)));
    } else {
      target.push(child);
    }
  }
}

function applyProps(node, props) {
  if (!props || typeof props !== 'object') return;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class' || key === 'className') {
      node.className = String(value);
      continue;
    }
    if (key === 'text') {
      node.textContent = String(value);
      continue;
    }
    if (key === 'html') {
      node.innerHTML = String(value);
      continue;
    }
    if (key === 'dataset') {
      Object.assign(node.dataset, value);
      continue;
    }
    if (key === 'style') {
      if (typeof value === 'string') node.style.cssText = value;
      else Object.assign(node.style, value);
      continue;
    }
    if (key === 'on') {
      for (const [type, handler] of Object.entries(value)) {
        if (typeof handler === 'function') node.addEventListener(type, handler);
      }
      continue;
    }
    if (key === 'attrs') {
      for (const [name, attrValue] of Object.entries(value)) {
        if (attrValue === undefined || attrValue === null || attrValue === false) continue;
        node.setAttribute(name, attrValue === true ? '' : String(attrValue));
      }
      continue;
    }
    if (PROPERTY_KEYS.has(key)) {
      node[key] = value;
      continue;
    }
    if (ATTRIBUTE_KEYS.has(key) || key.startsWith('aria-') || key.startsWith('data-')) {
      node.setAttribute(key, value === true ? '' : String(value));
      continue;
    }
    if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
      else node.removeAttribute(key);
      continue;
    }
    node.setAttribute(key, String(value));
  }
}

/**
 * 创建元素。
 * @param {string} tag 标签名
 * @param {object} [props] class/text/html/dataset/style/on/attrs 以及普通属性
 * @param {Array|string|Node} [children] 子节点（可嵌套数组，null 会被忽略）
 * @returns {HTMLElement} 新元素
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  applyProps(node, props);
  const nodes = [];
  flatten(children, nodes);
  for (const child of nodes) node.appendChild(child);
  return node;
}

/** 清空节点内容。 */
export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** 批量添加子节点（自动展开数组与字符串）。 */
export function appendChildren(node, children) {
  if (!node) return node;
  const nodes = [];
  flatten(children, nodes);
  for (const child of nodes) node.appendChild(child);
  return node;
}

/** 订阅事件并返回取消订阅函数。 */
export function on(node, type, handler, options) {
  if (!node || typeof node.addEventListener !== 'function') return () => {};
  node.addEventListener(type, handler, options);
  return () => node.removeEventListener(type, handler, options);
}

/** 阻止事件冒泡与默认行为。 */
export function stopEvent(event) {
  if (!event) return;
  if (typeof event.preventDefault === 'function') event.preventDefault();
  if (typeof event.stopPropagation === 'function') event.stopPropagation();
}

/** 设置文本内容（null 视为空串）。 */
export function setText(node, value) {
  if (!node) return;
  node.textContent = value === undefined || value === null ? '' : String(value);
}

/** 切换 hidden 属性。 */
export function setHidden(node, hidden) {
  if (!node) return;
  if (hidden) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

/** 移除节点。 */
export function removeNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}
