// 快捷键：纯解析函数 + window 级绑定；编辑器自有的按键不在此重复绑定，避免重复执行。

/**
 * 界面层绑定的快捷键。
 * allowInInput 为 true 的快捷键在输入框聚焦时也生效（保存/另存为）。
 */
export const UI_SHORTCUTS = Object.freeze([
  { id: 'newProject', keys: 'Ctrl+N', key: 'n', ctrl: true, shift: false, label: '新建工程' },
  { id: 'save', keys: 'Ctrl+S', key: 's', ctrl: true, shift: false, label: '保存工程', allowInInput: true },
  { id: 'saveAs', keys: 'Ctrl+Shift+S', key: 's', ctrl: true, shift: true, label: '另存为', allowInInput: true },
  { id: 'open', keys: 'Ctrl+O', key: 'o', ctrl: true, shift: false, label: '打开工程' },
  { id: 'exportNetlist', keys: 'Ctrl+E', key: 'e', ctrl: true, shift: false, label: '导出网表' },
  { id: 'wireTool', keys: 'W', key: 'w', ctrl: false, shift: false, label: '导线工具' },
  { id: 'selectTool', keys: 'V', key: 'v', ctrl: false, shift: false, label: '选择工具' },
  { id: 'gridSnap', keys: 'G', key: 'g', ctrl: false, shift: false, label: '切换网格吸附' },
  { id: 'rotate', keys: 'R', key: 'r', ctrl: false, shift: false, label: '旋转符号 90°' },
  { id: 'mirror', keys: 'X', key: 'x', ctrl: false, shift: false, label: '镜像符号' },
  { id: 'zoomIn', keys: '+', key: ['+', '='], ctrl: false, label: '放大', repeatAllowed: true },
  { id: 'zoomOut', keys: '-', key: ['-', '_'], ctrl: false, label: '缩小', repeatAllowed: true },
  { id: 'fit', keys: 'F', key: 'f', ctrl: false, shift: false, label: '缩放适配' },
  { id: 'help', keys: '?', key: ['?'], ctrl: false, label: '快捷键与帮助' },
]);

/** 编辑器/工具层已经实现的快捷键（仅用于帮助面板展示，不重复绑定）。 */
export const EDITOR_SHORTCUTS = Object.freeze([
  { keys: 'Ctrl+Z', label: '撤销' },
  { keys: 'Ctrl+Shift+Z / Ctrl+Y', label: '重做' },
  { keys: 'Ctrl+A', label: '全选' },
  { keys: 'Delete', label: '删除所选' },
  { keys: 'Esc', label: '取消当前操作 / 取消选择' },
  { keys: 'Shift+点击', label: '结束连续放置' },
  { keys: 'Enter', label: '结束连续画线' },
  { keys: '空格+拖动 / 中键拖动', label: '平移画布' },
  { keys: '滚轮', label: '以光标为中心缩放' },
  { keys: 'L / R / H / 1-4', label: '封装工具：切图层 / 切形状 / 通孔 / 焊盘形状' },
]);

/** 帮助面板展示的分组。 */
export const SHORTCUT_HELP_GROUPS = Object.freeze([
  {
    group: '文件',
    items: [
      { keys: 'Ctrl+N', label: '新建空白工程' },
      { keys: 'Ctrl+S', label: '保存工程（本地草稿 + 下载 JSON）' },
      { keys: 'Ctrl+Shift+S', label: '另存为' },
      { keys: 'Ctrl+O', label: '打开工程 JSON' },
      { keys: 'Ctrl+E', label: '导出网表（JSON/CSV/KiCad/Protel）' },
    ],
  },
  {
    group: '编辑',
    items: [
      { keys: 'Ctrl+Z', label: '撤销' },
      { keys: 'Ctrl+Shift+Z / Ctrl+Y', label: '重做' },
      { keys: 'Ctrl+A', label: '全选当前图纸' },
      { keys: 'Delete', label: '删除所选对象' },
      { keys: 'Esc', label: '取消当前操作 / 取消选择' },
      { keys: 'R', label: '旋转所选符号 90°（放置时旋转预览）' },
      { keys: 'X', label: '镜像所选符号（放置时切换镜像）' },
    ],
  },
  {
    group: '视图与工具',
    items: [
      { keys: 'W', label: '导线工具' },
      { keys: 'V', label: '选择工具' },
      { keys: 'G', label: '切换网格吸附（标签工具中为全局/局部切换）' },
      { keys: '+ / -', label: '放大 / 缩小' },
      { keys: 'F', label: '缩放适配内容' },
      { keys: '?', label: '打开快捷键帮助' },
    ],
  },
]);

/** 判断事件目标是否为可编辑控件。 */
export function isEditableTarget(target) {
  if (!target) return false;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable === true;
}

function keyMatches(entry, event) {
  const keys = Array.isArray(entry.key) ? entry.key : [entry.key];
  const key = typeof event.key === 'string' ? event.key : '';
  const lowered = key.toLowerCase();
  return keys.some((candidate) => candidate === key || candidate.toLowerCase() === lowered);
}

function modifierMatches(entry, event) {
  const ctrl = event.ctrlKey === true || event.metaKey === true;
  if (ctrl !== (entry.ctrl === true)) return false;
  if (event.altKey === true) return false;
  if (entry.shift !== undefined && (event.shiftKey === true) !== entry.shift) return false;
  return true;
}

/** 解析快捷键为界面动作 id；无匹配返回 null。 */
export function resolveHotkey(event) {
  if (!event || typeof event !== 'object') return null;
  for (const entry of UI_SHORTCUTS) {
    if (keyMatches(entry, event) && modifierMatches(entry, event)) return entry.id;
  }
  return null;
}

/**
 * 在 window（或指定目标）上绑定界面快捷键。
 * @param {object} config { target, handlers, isBlocked }
 * @returns {{unbind: Function, shortcuts: ReadonlyArray}} 绑定句柄
 */
export function bindHotkeys(config = {}) {
  const target = config.target;
  if (!target || typeof target.addEventListener !== 'function') {
    throw new TypeError('bindHotkeys 需要可监听事件的目标（如 window）');
  }
  const handlers = config.handlers && typeof config.handlers === 'object' ? config.handlers : {};
  const isBlocked = typeof config.isBlocked === 'function' ? config.isBlocked : () => false;

  function onKeyDown(event) {
    if (!event || event.defaultPrevented === true) return;
    if (isBlocked()) return;
    const entry = UI_SHORTCUTS.find((item) => keyMatches(item, event) && modifierMatches(item, event));
    if (!entry) return;
    if (isEditableTarget(event.target) && entry.allowInInput !== true) return;
    if (event.repeat === true && entry.repeatAllowed !== true) return;
    const handler = handlers[entry.id];
    if (typeof handler !== 'function') return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    handler(event);
  }

  target.addEventListener('keydown', onKeyDown);
  return {
    shortcuts: UI_SHORTCUTS,
    unbind() {
      target.removeEventListener('keydown', onKeyDown);
    },
  };
}
