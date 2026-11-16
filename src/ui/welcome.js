// 首次启动提示：介绍核心操作，并用 localStorage 记住「不再显示」。
import { el } from './dom.js';
import { iconNode } from './icons.js';
import { openModal } from './dialogs/modal.js';

export const WELCOME_STORAGE_KEY = 'schematic-studio:ui-welcome-dismissed';

function resolveStorage(storage) {
  if (storage && typeof storage.getItem === 'function') return storage;
  try {
    return globalThis.localStorage && typeof globalThis.localStorage.getItem === 'function'
      ? globalThis.localStorage
      : null;
  } catch {
    return null;
  }
}

/** 是否已经关闭过首次提示。 */
export function isWelcomeDismissed(storage) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    return target.getItem(WELCOME_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 记录「不再显示」。 */
export function dismissWelcome(storage) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(WELCOME_STORAGE_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

const TIPS = Object.freeze([
  { icon: 'place', title: '放置元件', text: '左侧点选符号 → 画布点击放置；R 旋转、X 镜像、Esc 取消。' },
  { icon: 'wire', title: '连接导线', text: '按 W 进入导线工具，连续点击画线，Enter 或双击结束。' },
  { icon: 'select', title: '编辑属性', text: '选中对象后在右侧修改位号/值/封装/坐标，全部可撤销。' },
  { icon: 'netlist', title: '生成网表', text: '底部「生成网表」检查连通性与 ERC，警告可点击定位。' },
  { icon: 'save', title: '保存工程', text: 'Ctrl+S 保存本地草稿并下载 .schproj.json 工程文件。' },
]);

/**
 * 打开首次启动提示。
 * @param {object} config { root, storage, version, onClose }
 * @returns {object} 模态句柄
 */
export function openWelcomeDialog(config = {}) {
  const checkbox = el('input', { attrs: { type: 'checkbox', id: 'welcome-hide' } });
  checkbox.checked = true;
  const body = el('div', { class: 'welcome' }, [
    el('p', { class: 'welcome-lead', text: '把所有模块组装好之后，这里是一张可直接编辑的空原理图。' }),
    el('ul', { class: 'welcome-tips' }, TIPS.map((tip) => el('li', { class: 'welcome-tip' }, [
      iconNode(tip.icon, 'welcome-icon'),
      el('div', {}, [
        el('strong', { text: tip.title }),
        el('span', { class: 'welcome-tip-text', text: tip.text }),
      ]),
    ]))),
    el('label', { class: 'welcome-hide', attrs: { for: 'welcome-hide' } }, [
      checkbox,
      el('span', { text: '不再自动显示（可从「帮助 → 操作提示」重新打开）' }),
    ]),
  ]);
  return openModal({
    root: config.root,
    title: '欢迎使用原理图工作室',
    subtitle: '版本 ' + (config.version || '0.1.0') + ' · 深色主题 · 零依赖',
    body,
    width: 640,
    className: 'modal--welcome',
    onClose: () => {
      if (checkbox.checked) dismissWelcome(config.storage);
      if (typeof config.onClose === 'function') config.onClose(checkbox.checked);
    },
    actions: [{ label: '开始使用', kind: 'primary', autofocus: true }],
  });
}
