// 极简 DOM 假实现：只覆盖 UI 面板/工具栏/对话框单元测试所需接口（无第三方依赖）。

function matchesSelector(node, selector) {
  if (!node || node.nodeType !== 1) return false;
  const alternatives = String(selector).split(',').map((part) => part.trim()).filter(Boolean);
  return alternatives.some((part) => {
    let text = part;
    let lastChild = false;
    if (text.includes(':last-child')) {
      lastChild = true;
      text = text.replace(':last-child', '');
    }
    text = text.replace(/:not\([^)]*\)/g, '');
    if (text === '') return false;

    const attributeMatch = /^([A-Za-z][\w-]*)?\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]$/.exec(text);
    if (attributeMatch) {
      const [, tag, name, quoted, singleQuoted, bare] = attributeMatch;
      if (tag && node.tagName !== tag.toUpperCase()) return false;
      const value = node.getAttribute(name);
      if (value === null) return false;
      const expected = quoted !== undefined ? quoted : singleQuoted !== undefined ? singleQuoted : bare;
      if (expected !== undefined && value !== expected) return false;
    } else if (text.startsWith('.')) {
      if (!node.classList.contains(text.slice(1))) return false;
    } else if (/^[A-Za-z][\w-]*$/.test(text)) {
      if (node.tagName !== text.toUpperCase()) return false;
    } else if (text !== '*') {
      return false;
    }

    if (lastChild) {
      const parent = node.parentNode;
      if (!parent || parent.children[parent.children.length - 1] !== node) return false;
    }
    return true;
  });
}

export class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.data = String(text);
    this.parentNode = null;
  }

  get textContent() {
    return this.data;
  }

  set textContent(value) {
    this.data = String(value);
  }
}

export class FakeElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.selected = false;
    this.tabIndex = 0;
    this._text = '';
    this._classes = new Set();
    this._innerHTML = '';
  }

  get className() {
    return [...this._classes].join(' ');
  }

  set className(value) {
    this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get classList() {
    const classes = this._classes;
    return {
      add: (...names) => { for (const name of names) classes.add(name); },
      remove: (...names) => { for (const name of names) classes.delete(name); },
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
    };
  }

  get textContent() {
    if (this.children.length > 0 && this._text === '') {
      return this.children.map((child) => child.textContent).join('');
    }
    return this._text + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._text = value === undefined || value === null ? '' : String(value);
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
  }

  get firstChild() {
    return this.children.length > 0 ? this.children[0] : null;
  }

  get lastChild() {
    return this.children.length > 0 ? this.children[this.children.length - 1] : null;
  }

  appendChild(node) {
    if (!node) return node;
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    if (node) node.parentNode = null;
    return node;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  setAttribute(name, value) {
    const text = value === undefined || value === null ? '' : String(value);
    this.attributes.set(name, text);
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'hidden') this.hidden = false;
    if (name === 'disabled') this.disabled = false;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }

  dispatchEvent(type, extra = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() { event.defaultPrevented = true; },
      stopPropagation() {},
      ...extra,
    };
    for (const handler of [...(this.listeners.get(type) || [])]) handler(event);
    return event;
  }

  click() {
    this.dispatchEvent('click');
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
    }
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }

  querySelector(selector) {
    const matches = this.querySelectorAll(selector);
    return matches.length > 0 ? matches[0] : null;
  }

  scrollIntoView() {}

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }
}

/** 创建假 document（含 body、activeElement 与事件表）。 */
export function createFakeDocument() {
  const doc = {
    body: null,
    activeElement: null,
    documentElement: null,
    listeners: new Map(),
    createElement(tag) {
      const node = new FakeElement(tag);
      node.ownerDocument = doc;
      return node;
    },
    createTextNode(text) {
      const node = new FakeTextNode(text);
      node.ownerDocument = doc;
      return node;
    },
    addEventListener(type, handler) {
      if (!doc.listeners.has(type)) doc.listeners.set(type, []);
      doc.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const list = doc.listeners.get(type) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
  };
  doc.body = doc.createElement('body');
  doc.documentElement = doc.body;
  return doc;
}

/**
 * 安装假 document，返回恢复函数。Node 测试进程按文件隔离，互不影响。
 * @returns {{document: object, restore: Function}}
 */
export function installFakeDom() {
  const previous = globalThis.document;
  const doc = createFakeDocument();
  globalThis.document = doc;
  return {
    document: doc,
    restore() {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}

/** 深度优先查找所有满足谓词的元素节点。 */
export function findAll(root, predicate, result = []) {
  for (const child of root.children || []) {
    if (child.nodeType === 1 && predicate(child)) result.push(child);
    if (child.nodeType === 1) findAll(child, predicate, result);
  }
  return result;
}

/** 按 class 查找第一个元素。 */
export function findByClass(root, className) {
  return findAll(root, (node) => node.classList.contains(className))[0] || null;
}

/** 按标签查找所有元素。 */
export function findByTag(root, tagName) {
  return findAll(root, (node) => node.tagName === String(tagName).toUpperCase());
}

/** 按精确文本查找第一个元素。 */
export function findByText(root, text) {
  return findAll(root, (node) => node.textContent === String(text))[0] || null;
}
