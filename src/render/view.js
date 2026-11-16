// 视图变换：世界坐标(mm)与屏幕坐标(CSS px)之间唯一的权威转换实现（纯函数）。
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 20;
export const DEFAULT_SCALE = 4;
export const DEFAULT_PADDING = 48;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 把缩放限制在允许区间内；非法值退回默认缩放。 */
export function clampScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_SCALE;
  return Math.min(Math.max(number, MIN_SCALE), MAX_SCALE);
}

/** 创建视图；缺省偏移为 0，缺省缩放为 DEFAULT_SCALE px/mm。 */
export function createView(partial = {}) {
  const source = partial && typeof partial === 'object' ? partial : {};
  return {
    offsetX: toNumber(source.offsetX, 0),
    offsetY: toNumber(source.offsetY, 0),
    scale: clampScale(source.scale === undefined ? DEFAULT_SCALE : source.scale),
  };
}

/** 以 fallback 为兜底规范化任意视图对象，返回新对象。 */
export function normalizeView(view, fallback = createView()) {
  const base = createView(fallback);
  const source = view && typeof view === 'object' ? view : {};
  return {
    offsetX: toNumber(source.offsetX, base.offsetX),
    offsetY: toNumber(source.offsetY, base.offsetY),
    scale: clampScale(source.scale === undefined ? base.scale : source.scale),
  };
}

/** 视图缩放的安全取值（外部传入的裸视图也能安全参与计算）。 */
export function scaleOf(view) {
  const scale = Number(view && view.scale);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** 世界坐标(mm) -> 屏幕坐标(CSS px)。 */
export function worldToScreen(view, p) {
  const scale = scaleOf(view);
  const offsetX = toNumber(view && view.offsetX, 0);
  const offsetY = toNumber(view && view.offsetY, 0);
  const point = p && typeof p === 'object' ? p : {};
  return {
    x: offsetX + toNumber(point.x, 0) * scale,
    y: offsetY + toNumber(point.y, 0) * scale,
  };
}

/** 屏幕坐标(CSS px) -> 世界坐标(mm)。 */
export function screenToWorld(view, p) {
  const scale = scaleOf(view);
  const offsetX = toNumber(view && view.offsetX, 0);
  const offsetY = toNumber(view && view.offsetY, 0);
  const point = p && typeof p === 'object' ? p : {};
  return {
    x: (toNumber(point.x, 0) - offsetX) / scale,
    y: (toNumber(point.y, 0) - offsetY) / scale,
  };
}

/**
 * 以屏幕上的锚点为中心缩放：锚点下的世界坐标在缩放前后保持不变。
 * factor 为相对倍率（>1 放大），非法 factor 时原样返回规范化视图。
 */
export function zoomAt(view, screenPt, factor) {
  const base = createView(view);
  const ratio = Number(factor);
  if (!Number.isFinite(ratio) || ratio <= 0) return base;
  const nextScale = clampScale(base.scale * ratio);
  if (nextScale === base.scale) return base;
  const anchor = screenToWorld(base, screenPt);
  const point = screenPt && typeof screenPt === 'object' ? screenPt : {};
  return {
    scale: nextScale,
    offsetX: toNumber(point.x, 0) - anchor.x * nextScale,
    offsetY: toNumber(point.y, 0) - anchor.y * nextScale,
  };
}

/** 平移视图，dx/dy 为屏幕像素增量。 */
export function panView(view, dx, dy) {
  const base = createView(view);
  return {
    offsetX: base.offsetX + toNumber(dx, 0),
    offsetY: base.offsetY + toNumber(dy, 0),
    scale: base.scale,
  };
}

/**
 * 让世界包围盒适配到视口，并居中显示。
 * padding 为四周留白(CSS px)；包围盒退化为点或线时使用默认缩放。
 */
export function fitView(bbox, width, height, padding = DEFAULT_PADDING) {
  const viewportWidth = Math.max(1, toNumber(width, 800));
  const viewportHeight = Math.max(1, toNumber(height, 600));
  const maxPadding = Math.max(0, Math.min(viewportWidth, viewportHeight) / 2 - 1);
  const pad = Math.min(Math.max(0, toNumber(padding, DEFAULT_PADDING)), maxPadding);
  const box = bbox && typeof bbox === 'object' ? bbox : {};
  const boxX = toNumber(box.x, 0);
  const boxY = toNumber(box.y, 0);
  const boxW = Math.max(0, toNumber(box.w, 0));
  const boxH = Math.max(0, toNumber(box.h, 0));

  const availableWidth = Math.max(1, viewportWidth - pad * 2);
  const availableHeight = Math.max(1, viewportHeight - pad * 2);
  let scale = DEFAULT_SCALE;
  if (boxW > 0 && boxH > 0) {
    scale = clampScale(Math.min(availableWidth / boxW, availableHeight / boxH));
  } else if (boxW > 0) {
    scale = clampScale(availableWidth / boxW);
  } else if (boxH > 0) {
    scale = clampScale(availableHeight / boxH);
  }

  const centerX = boxX + boxW / 2;
  const centerY = boxY + boxH / 2;
  return {
    scale,
    offsetX: viewportWidth / 2 - centerX * scale,
    offsetY: viewportHeight / 2 - centerY * scale,
  };
}

/** 当前视口覆盖的世界矩形。 */
export function viewBounds(view, width, height) {
  const w = Math.max(0, toNumber(width, 0));
  const h = Math.max(0, toNumber(height, 0));
  const topLeft = screenToWorld(view, { x: 0, y: 0 });
  const bottomRight = screenToWorld(view, { x: w, y: h });
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: bottomRight.x - topLeft.x,
    h: bottomRight.y - topLeft.y,
  };
}
