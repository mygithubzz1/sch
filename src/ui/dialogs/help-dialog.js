// 帮助对话框：快捷键一览、操作提示与关于信息。
import { el } from '../dom.js';
import { SHORTCUT_HELP_GROUPS } from '../hotkeys.js';
import { openModal } from './modal.js';

/** 打开快捷键一览。 */
export function openShortcutsDialog(config = {}) {
  const groups = SHORTCUT_HELP_GROUPS.map((group) => el('section', { class: 'help-group' }, [
    el('h3', { class: 'help-group-title', text: group.group }),
    el('dl', { class: 'shortcut-list' }, group.items.map((item) => el('div', { class: 'shortcut-row' }, [
      el('dt', { class: 'shortcut-keys' }, [el('kbd', { text: item.keys })]),
      el('dd', { class: 'shortcut-label', text: item.label }),
    ]))),
  ]));
  return openModal({
    root: config.root,
    title: '快捷键一览',
    subtitle: '输入框聚焦时不会拦截编辑类快捷键；Ctrl+S / Ctrl+Shift+S 始终可用。',
    body: el('div', { class: 'help-groups' }, groups),
    width: 660,
    actions: [{ label: '知道了', kind: 'primary', autofocus: true }],
  });
}

const TIPS = Object.freeze([
  '左侧元件库点击符号进入放置模式：点击画布放置，R 旋转、X 镜像、Shift+点击结束、Esc 取消。',
  '按 W 或点击工具栏「导线」连续画线；点击引脚/导线端点会自动吸附并生成结点，Enter 或双击结束。',
  '选中对象后在右侧属性面板修改位号、值、封装、坐标与旋转；所有修改都会进入撤销栈（Ctrl+Z）。',
  '底部「生成网表」会执行连通性分析与 ERC：点击警告可跳转并选中对应器件，点击网络中的引脚可定位元件。',
  '多张图纸在画布上方标签页切换；双击标签页可重命名，点击「＋」新建。',
  'Ctrl+S 保存到浏览器本地草稿并下载 .schproj.json；文件菜单可重新打开工程或恢复本地草稿。',
  '「封装编辑」模式下可放置/移动焊盘、绘制丝印与 Courtyard，完成后点击「保存到工程库」。',
  '导出：Ctrl+E 打开网表导出（JSON/CSV/KiCad/Protel），文件菜单可导出 SVG、PNG 与封装库 JSON。',
]);

/** 打开操作提示。 */
export function openTipsDialog(config = {}) {
  return openModal({
    root: config.root,
    title: '操作提示',
    subtitle: '五分钟上手原理图工作室',
    body: el('ol', { class: 'tips-list' }, TIPS.map((tip) => el('li', { text: tip }))),
    width: 620,
    actions: [{ label: '开始绘制', kind: 'primary', autofocus: true }],
  });
}

/** 打开关于对话框。 */
export function openAboutDialog(config = {}) {
  const lines = Array.isArray(config.details) ? config.details : [];
  return openModal({
    root: config.root,
    title: '关于原理图工作室',
    subtitle: '纯 HTML / CSS / 原生 JS，零依赖、零构建',
    body: el('div', { class: 'about' }, [
      el('p', { text: '版本 ' + (config.version || '0.1.0') + ' · 深色专业主题 · Canvas 2D 渲染' }),
      el('ul', { class: 'about-list' }, [
        el('li', { text: '原理图绘制、符号/封装库、封装绘制与多图纸管理' }),
        el('li', { text: '连通性分析、ERC 与 JSON/CSV/KiCad/Protel 网表导出' }),
        el('li', { text: 'SVG/PNG 导出、工程保存与完整撤销重做' }),
        ...lines.map((line) => el('li', { text: String(line) })),
      ]),
      el('p', { class: 'about-meta', text: '本工具不加载任何外部字体、图标或 CDN 资源。' }),
    ]),
    width: 520,
    actions: [{ label: '关闭', kind: 'primary', autofocus: true }],
  });
}
