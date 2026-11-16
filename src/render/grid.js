// 栅格绘制：次级栅格 + 主栅格加粗，缩放过小时自动抽稀（纯计算 + canvas 绘制）。
import { DEFAULT_THEME, themeColor } from './theme.js';

export const MIN_GRID_PIXELS = 8;
export const MAJOR_EVERY = 5;
export const MAX_GRID_LINES = 6000;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 把 number 或 {width,height} 统一成视口尺寸。 */
export function normalizeSize(size) {
  if (typeof size === 'number') {
    const side = Math.max(1, toNumber(size, 1));
    return { width: side, height: side };
  }
  const source = size && typeof size === 'object' ? size : {};
  return {
    width: Math.max(1, toNumber(source.width, 800)),
    height: Math.max(1, toNumber(source.height, 600)),
  };
}

/**
 * 依据缩放级别选择实际绘制的最小栅格间距：
 * 屏幕间距不足 minPixels 时按 5 倍逐级抽稀，主栅格始终是次栅格的 5 倍。
 */
export function computeGridStep(step, scale, minPixels = MIN_GRID_PIXELS) {
  const base = toNumber(step, 0) > 0 ? toNumber(step, 2.54) : 2.54;
  const zoom = toNumber(scale, 0) > 0 ? toNumber(scale, 1) : 1;
  const min = toNumber(minPixels, 0) > 0 ? toNumber(minPixels, MIN_GRID_PIXELS) : MIN_GRID_PIXELS;
  let minor = base;
  let guard = 0;
  while (minor * zoom < min && guard < 24) {
    minor *= MAJOR_EVERY;
    guard += 1;
  }
  return { minor, major: minor * MAJOR_EVERY, majorEvery: MAJOR_EVERY };
}

function pushVertical(lines, x, height, major) {
  lines.push({ x1: x, y1: 0, x2: x, y2: height, major });
}

function pushHorizontal(lines, y, width, major) {
  lines.push({ x1: 0, y1: y, x2: width, y2: y, major });
}

/**
 * 计算当前视图下需要绘制的栅格线（屏幕坐标，CSS px）。
 * 返回值中的 lines 同时包含横线与竖线，major 标记主栅格。
 */
export function gridLines(view, size, step, options = {}) {
  const { width, height } = normalizeSize(size);
  const scale = toNumber(view && view.scale, 0) > 0 ? toNumber(view && view.scale, 1) : 1;
  const offsetX = toNumber(view && view.offsetX, 0);
  const offsetY = toNumber(view && view.offsetY, 0);
  const { minor, major, majorEvery } = computeGridStep(step, scale, options.minPixels);
  const stepPx = minor * scale;
  const lines = [];
  if (!(stepPx > 0)) return { minor, major, majorEvery, scale, lines };

  const firstColumn = Math.ceil((0 - offsetX) / stepPx);
  const lastColumn = Math.floor((width - offsetX) / stepPx);
  for (let index = firstColumn; index <= lastColumn && lines.length < MAX_GRID_LINES; index += 1) {
    pushVertical(lines, offsetX + index * stepPx, height, index % majorEvery === 0);
  }

  const firstRow = Math.ceil((0 - offsetY) / stepPx);
  const lastRow = Math.floor((height - offsetY) / stepPx);
  for (let index = firstRow; index <= lastRow && lines.length < MAX_GRID_LINES; index += 1) {
    pushHorizontal(lines, offsetY + index * stepPx, width, index % majorEvery === 0);
  }

  return { minor, major, majorEvery, scale, lines };
}

function alignToPixel(value) {
  return Math.round(value) + 0.5;
}

function strokeLines(ctx, lines, color, lineWidth) {
  if (!lines.length) return;
  ctx.beginPath();
  for (const line of lines) {
    if (line.y1 === line.y2) {
      const y = alignToPixel(line.y1);
      ctx.moveTo(0, y);
      ctx.lineTo(line.x2, y);
    } else {
      const x = alignToPixel(line.x1);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, line.y2);
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/** 绘制栅格，返回本次实际使用的间距与线段统计，便于调试与测试。 */
export function drawGrid(ctx, view, size, step, theme = DEFAULT_THEME) {
  const data = gridLines(view, size, step);
  if (!ctx || typeof ctx.beginPath !== 'function' || !data.lines.length) return data;
  const minorLines = data.lines.filter((line) => !line.major);
  const majorLines = data.lines.filter((line) => line.major);
  ctx.save();
  strokeLines(ctx, minorLines, themeColor(theme, 'grid'), 1);
  strokeLines(ctx, majorLines, themeColor(theme, 'gridMajor'), 1.5);
  ctx.restore();
  return data;
}
