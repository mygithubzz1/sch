// 内联 SVG 图标集合：全部为本地静态路径，不依赖外部字体、图标库或 CDN。

const PATHS = Object.freeze({
  select: '<path d="M5 3l13 7.5-5.6 1.5L10 19z"/>',
  wire: '<path d="M4 18l5-5 4 3 7-9"/><circle cx="4" cy="18" r="1.6"/><circle cx="20" cy="7" r="1.6"/>',
  place: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  label: '<path d="M3 12V4h8l9 8-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M8.5 20h7"/>',
  erase: '<path d="M4 20h16"/><path d="M8 16l8-8 4 4-6 6H9z"/><path d="M10 8l4 4"/>',
  undo: '<path d="M9 7H5V3"/><path d="M5 7a8 8 0 1 1-1 8"/>',
  redo: '<path d="M15 7h4V3"/><path d="M19 7a8 8 0 1 0 1 8"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  grid: '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  footprint: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  netlist: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/>',
  export: '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v3h16v-3"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  open: '<path d="M3 7h6l2 2h10v11H3z"/><path d="M3 7V4h6l2 2"/>',
  new: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M12 11v7M8.5 14.5h7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  warning: '<path d="M12 3l9 17H3z"/><path d="M12 9v5M12 17v.5"/>',
  check: '<path d="M5 12l5 5L20 6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V4h11"/>',
  zoomIn: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8 11h6"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3v5h-5"/>',
  mirror: '<path d="M12 3v18"/><path d="M9 7L3 12l6 5zM15 7l6 5-6 5z"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 17l9 5 9-5"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  graphic: '<path d="M4 17l6-9 4 6 6-8"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-.9.7-1.5 1.3-1.5 2.5M12 17v.5"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
});

/** 返回图标的 SVG 标记（静态可信字符串）。 */
export function iconMarkup(name) {
  const body = PATHS[name] || PATHS.dot;
  return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}

/** 创建图标节点（span 容器，尺寸由 CSS 控制）。 */
export function iconNode(name, className = '') {
  const span = document.createElement('span');
  span.className = className ? 'icon-wrap ' + className : 'icon-wrap';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = iconMarkup(name);
  return span;
}

/** 替换图标节点的图形。 */
export function setIcon(node, name) {
  if (!node) return;
  node.innerHTML = iconMarkup(name);
}

export const ICON_NAMES = Object.freeze(Object.keys(PATHS));
