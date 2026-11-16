// Canvas 文本绘制辅助：先用高分辨率字号排版再等比缩回，避免浏览器量化亚像素字宽导致中文重叠。
const DEFAULT_SIZE = 1.27;

/**
 * 排版分辨率：浏览器会把小字号的字宽量化到 1px，直接以 1.27px 绘制中文时字距被压扁。
 * 先按 size * RESOLUTION 排版再缩回 1/RESOLUTION，最终字号不变但字距正确。
 */
export const TEXT_LAYOUT_RESOLUTION = 8;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toText(value) {
  if (typeof value === 'string') return value;
  return value === undefined || value === null ? '' : String(value);
}

function resolveResolution(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? number : TEXT_LAYOUT_RESOLUTION;
}

/**
 * 在已应用世界变换的 canvas 上绘制文本（世界单位 → 高分辨率排版 → 缩回）。
 * @param {CanvasRenderingContext2D} ctx 画布上下文
 * @param {object} options { text, x, y, size, rotation, align, baseline, color, fontFamily, resolution }
 * @returns {boolean} 是否实际绘制
 */
export function drawCanvasText(ctx, options = {}) {
  if (!ctx || typeof ctx.save !== 'function' || typeof ctx.fillText !== 'function') return false;
  const content = toText(options.text);
  if (content === '') return false;
  const size = Math.max(0.01, toNumber(options.size, DEFAULT_SIZE));
  const resolution = resolveResolution(options.resolution);
  const fontFamily = typeof options.fontFamily === 'string' && options.fontFamily !== '' ? options.fontFamily : 'sans-serif';

  ctx.save();
  ctx.translate(toNumber(options.x, 0), toNumber(options.y, 0));
  const rotation = toNumber(options.rotation, 0);
  if (rotation) ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(1 / resolution, 1 / resolution);
  ctx.font = size * resolution + 'px ' + fontFamily;
  ctx.textAlign = options.align || 'left';
  ctx.textBaseline = options.baseline || 'alphabetic';
  if (typeof options.color === 'string' && options.color !== '') ctx.fillStyle = options.color;
  ctx.fillText(content, 0, 0);
  ctx.restore();
  return true;
}

/**
 * 用与 drawCanvasText 相同的排版测量文本宽度（返回世界单位）。
 * 无 measureText 能力的上下文返回 null，调用方回退到估算函数。
 * @param {CanvasRenderingContext2D} ctx 画布上下文
 * @param {string} text 文本
 * @param {number} [size] 字号（世界单位）
 * @param {string} [fontFamily] 字体族
 * @param {number} [resolution] 排版分辨率
 * @returns {number|null} 世界单位宽度
 */
export function measureCanvasText(ctx, text, size = DEFAULT_SIZE, fontFamily = 'sans-serif', resolution = TEXT_LAYOUT_RESOLUTION) {
  if (!ctx || typeof ctx.save !== 'function' || typeof ctx.measureText !== 'function') return null;
  const content = toText(text);
  if (content === '') return 0;
  const fontSize = Math.max(0.01, toNumber(size, DEFAULT_SIZE));
  const ratio = resolveResolution(resolution);
  const family = typeof fontFamily === 'string' && fontFamily !== '' ? fontFamily : 'sans-serif';
  ctx.save();
  ctx.font = fontSize * ratio + 'px ' + family;
  const metrics = ctx.measureText(content);
  ctx.restore();
  const width = Number(metrics && metrics.width);
  return Number.isFinite(width) ? width / ratio : null;
}
