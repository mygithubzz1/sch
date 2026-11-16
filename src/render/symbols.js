// 符号绘制：把 SymbolDef 的图形与引脚转换为世界坐标图元，Canvas 与 SVG 导出共用同一份几何。
import { bboxOfPoints, normalizeDeg, transformPoint } from '../core/geometry.js';
import { DEFAULT_THEME, themeColor } from './theme.js';
import { drawCanvasText } from './text.js';

export const DEFAULT_GRAPHIC_WIDTH = 0.25;
export const DEFAULT_PIN_WIDTH = 0.15;
export const DEFAULT_PIN_LENGTH = 2.54;
export const DEFAULT_PIN_TEXT_SIZE = 1;
const PIN_DIRECTIONS = Object.freeze({
  left: Object.freeze([-1, 0]),
  right: Object.freeze([1, 0]),
  up: Object.freeze([0, -1]),
  down: Object.freeze([0, 1]),
});

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pinDirection(orientation) {
  return PIN_DIRECTIONS[orientation] || PIN_DIRECTIONS.left;
}

/** 让文本在 0/90/180/270 中尽量保持正向可读。 */
function uprightRotation(rotation) {
  const normalized = normalizeDeg(rotation);
  return normalized === 180 || normalized === 270 ? (normalized === 270 ? 90 : 0) : normalized;
}

/** 把实例的 x/y/rotation/mirror 规范化为变换对象。 */
export function symbolTransform(source = {}) {
  const instance = source && typeof source === 'object' ? source : {};
  return {
    x: toNumber(instance.x, 0),
    y: toNumber(instance.y, 0),
    rotation: normalizeDeg(toNumber(instance.rotation, 0)),
    mirror: Boolean(instance.mirror),
  };
}

/** 估算文本宽度(mm)：CJK 按字宽计，拉丁字符按 0.6 字宽计。 */
export function measureTextWidth(text, size = 1.27) {
  const content = typeof text === 'string' ? text : String(text === undefined ? '' : text);
  const fontSize = toNumber(size, 1.27);
  let width = 0;
  for (const char of content) {
    const code = char.codePointAt(0);
    width += code > 0x2e7f ? fontSize : fontSize * 0.6;
  }
  return width;
}

function graphicStrokeWidth(graphic) {
  return Math.max(0.01, toNumber(graphic && graphic.width, DEFAULT_GRAPHIC_WIDTH));
}

function fillValue(graphic) {
  if (!graphic) return false;
  if (typeof graphic.fill === 'string') return graphic.fill;
  return graphic.fill === true;
}

function transformPoints(rawPoints, transform) {
  const points = Array.isArray(rawPoints) ? rawPoints : [];
  const result = [];
  for (const point of points) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) continue;
    result.push(transformPoint(point, transform));
  }
  return result;
}

function graphicPrimitives(graphic, transform) {
  if (!graphic || typeof graphic !== 'object') return [];
  const width = graphicStrokeWidth(graphic);
  const fill = fillValue(graphic);
  const type = graphic.type;

  if (type === 'line' || type === 'polyline') {
    const points = transformPoints(graphic.points, transform);
    if (points.length < 2) return [];
    return [{ kind: 'polyline', role: 'graphic', points, closed: type === 'polyline' && graphic.closed === true, fill, width }];
  }

  if (type === 'rect') {
    const x = toNumber(graphic.x, 0);
    const y = toNumber(graphic.y, 0);
    const w = toNumber(graphic.w, 0);
    const h = toNumber(graphic.h, 0);
    const corners = transformPoints([
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ], transform);
    return [{ kind: 'polyline', role: 'graphic', points: corners, closed: true, fill, width }];
  }

  if (type === 'circle') {
    const center = transformPoint({ x: toNumber(graphic.cx, 0), y: toNumber(graphic.cy, 0) }, transform);
    return [{
      kind: 'circle',
      role: 'graphic',
      cx: center.x,
      cy: center.y,
      r: Math.max(0, toNumber(graphic.r, 0)),
      fill,
      width,
    }];
  }

  if (type === 'arc') {
    const center = transformPoint({ x: toNumber(graphic.cx, 0), y: toNumber(graphic.cy, 0) }, transform);
    let start = normalizeDeg(toNumber(graphic.start, 0));
    let end = normalizeDeg(toNumber(graphic.end, 270));
    let anticlockwise = false;
    if (transform.mirror) {
      start = normalizeDeg(180 - start);
      end = normalizeDeg(180 - end);
      anticlockwise = true;
    }
    return [{
      kind: 'arc',
      role: 'graphic',
      cx: center.x,
      cy: center.y,
      r: Math.max(0, toNumber(graphic.r, 0)),
      start: normalizeDeg(start + transform.rotation),
      end: normalizeDeg(end + transform.rotation),
      anticlockwise,
      width,
    }];
  }

  if (type === 'text') {
    const anchor = transformPoint({ x: toNumber(graphic.x, 0), y: toNumber(graphic.y, 0) }, transform);
    return [{
      kind: 'text',
      role: 'graphicText',
      x: anchor.x,
      y: anchor.y,
      text: typeof graphic.text === 'string' ? graphic.text : String(graphic.text === undefined ? '' : graphic.text),
      size: Math.max(0.1, toNumber(graphic.size, DEFAULT_PIN_TEXT_SIZE)),
      rotation: normalizeDeg(transform.rotation + toNumber(graphic.rotation, 0)),
      align: 'center',
      baseline: 'middle',
      fill: false,
    }];
  }

  return [];
}

function pinPrimitives(pin, transform, options) {
  if (!pin || typeof pin !== 'object') return [];
  const length = Math.max(0, toNumber(pin.length, DEFAULT_PIN_LENGTH));
  const direction = pinDirection(pin.orientation);
  const dx = direction[0];
  const dy = direction[1];
  const startX = toNumber(pin.x, 0);
  const startY = toNumber(pin.y, 0);
  const primitives = [];
  const endpoint = transformPoint({ x: startX, y: startY }, transform);
  const inner = transformPoint({ x: startX + dx * length, y: startY + dy * length }, transform);
  primitives.push({
    kind: 'line',
    role: 'pin',
    points: [endpoint, inner],
    width: Math.max(0.01, toNumber(pin.width, DEFAULT_PIN_WIDTH)),
  });

  const textRotation = uprightRotation(transform.rotation);
  const numberSize = Math.max(0.1, toNumber(options.pinNumberSize, DEFAULT_PIN_TEXT_SIZE * 0.9));
  const nameSize = Math.max(0.1, toNumber(options.pinTextSize, DEFAULT_PIN_TEXT_SIZE));
  const vertical = dx === 0;

  const numberLocal = {
    x: startX + (dx * length) / 2 + (vertical ? 0.45 : 0),
    y: startY + (dy * length) / 2 + (vertical ? 0 : -0.45),
  };
  const numberAnchor = transformPoint(numberLocal, transform);
  if (pin.number !== undefined && pin.number !== null && pin.number !== '') {
    primitives.push({
      kind: 'text',
      role: 'pinNumber',
      x: numberAnchor.x,
      y: numberAnchor.y,
      text: String(pin.number),
      size: numberSize,
      rotation: textRotation,
      align: 'center',
      baseline: 'middle',
      fill: false,
    });
  }

  if (typeof pin.name === 'string' && pin.name !== '') {
    const nameAnchor = transformPoint({ x: startX + dx * (length + 0.6), y: startY + dy * (length + 0.6) }, transform);
    let align = 'center';
    let baseline = 'middle';
    if (pin.orientation === 'left') align = 'right';
    else if (pin.orientation === 'right') align = 'left';
    else if (pin.orientation === 'up') baseline = 'bottom';
    else if (pin.orientation === 'down') baseline = 'top';
    primitives.push({
      kind: 'text',
      role: 'pinName',
      x: nameAnchor.x,
      y: nameAnchor.y,
      text: pin.name,
      size: nameSize,
      rotation: textRotation,
      align,
      baseline,
      fill: false,
    });
  }

  return primitives;
}

/**
 * 生成符号的纯图元数组（世界坐标），不接触 canvas。
 * SVG 导出应直接复用本函数，禁止另写一份几何。
 */
export function drawSymbolPrimitives(symbolDef, transform = {}, options = {}) {
  const def = symbolDef && typeof symbolDef === 'object' ? symbolDef : {};
  const normalized = symbolTransform(transform);
  const opts = options && typeof options === 'object' ? options : {};
  const primitives = [];
  const graphics = Array.isArray(def.graphics) ? def.graphics : [];
  for (const graphic of graphics) {
    primitives.push(...graphicPrimitives(graphic, normalized));
  }
  const pins = Array.isArray(def.pins) ? def.pins : [];
  for (const pin of pins) {
    primitives.push(...pinPrimitives(pin, normalized, opts));
  }
  return primitives;
}

function arcExtent(primitive, points) {
  const r = Math.max(0, toNumber(primitive.r, 0));
  points.push({ x: primitive.cx - r, y: primitive.cy - r }, { x: primitive.cx + r, y: primitive.cy + r });
}

/** 文本图元的估算包围盒（考虑 90 度旋转的宽高交换）。 */
export function textPrimitiveBounds(primitive) {
  const size = toNumber(primitive && primitive.size, 1.27);
  const width = measureTextWidth(primitive && primitive.text, size);
  const height = size;
  const rotated = normalizeDeg(toNumber(primitive && primitive.rotation, 0)) % 180 !== 0;
  const boxW = rotated ? height : width;
  const boxH = rotated ? width : height;
  const x = toNumber(primitive && primitive.x, 0);
  const y = toNumber(primitive && primitive.y, 0);
  const align = primitive && primitive.align;
  const baseline = primitive && primitive.baseline;
  let left = x;
  let top = y - boxH / 2;
  if (align === 'center') left = x - boxW / 2;
  else if (align === 'right') left = x - boxW;
  if (baseline === 'bottom') top = y - boxH;
  else if (baseline === 'top') top = y;
  return { x: left, y: top, w: boxW, h: boxH };
}

/** 图元数组的包围盒；空数组返回零矩形。 */
export function primitivesBBox(primitives) {
  const points = [];
  const list = Array.isArray(primitives) ? primitives : [];
  for (const primitive of list) {
    if (!primitive) continue;
    if (primitive.kind === 'line' || primitive.kind === 'polyline') {
      points.push(...(primitive.points || []));
    } else if (primitive.kind === 'circle') {
      const r = Math.max(0, toNumber(primitive.r, 0));
      points.push({ x: primitive.cx - r, y: primitive.cy - r }, { x: primitive.cx + r, y: primitive.cy + r });
    } else if (primitive.kind === 'arc') {
      arcExtent(primitive, points);
    } else if (primitive.kind === 'text') {
      const box = textPrimitiveBounds(primitive);
      points.push({ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h });
    }
  }
  return bboxOfPoints(points);
}

/** 符号在世界坐标下的包围盒（含引脚与引脚文字）。 */
export function symbolBBox(symbolDef, transform = {}, options = {}) {
  return primitivesBBox(drawSymbolPrimitives(symbolDef, transform, options));
}

/** 仅符号本体图形（不含引脚与引脚文字）的包围盒，用于放置位号与值。 */
export function symbolGraphicsBBox(symbolDef, transform = {}, options = {}) {
  const primitives = drawSymbolPrimitives(symbolDef, transform, options)
    .filter((primitive) => primitive.role === 'graphic' || primitive.role === 'graphicText');
  return primitivesBBox(primitives);
}

function resolveFill(primitive, theme) {
  if (typeof primitive.fill === 'string') return primitive.fill;
  if (primitive.fill === true) return themeColor(theme, 'symbolFill');
  return null;
}

function tracePath(ctx, primitive) {
  ctx.beginPath();
  if (primitive.kind === 'line' || primitive.kind === 'polyline') {
    const points = primitive.points || [];
    if (!points.length) return false;
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
    if (primitive.closed) ctx.closePath();
    return true;
  }
  if (primitive.kind === 'circle') {
    ctx.arc(primitive.cx, primitive.cy, primitive.r, 0, Math.PI * 2);
    return primitive.r > 0;
  }
  if (primitive.kind === 'arc') {
    const start = (primitive.start * Math.PI) / 180;
    const end = (primitive.end * Math.PI) / 180;
    ctx.arc(primitive.cx, primitive.cy, primitive.r, start, end, Boolean(primitive.anticlockwise));
    return primitive.r > 0;
  }
  return false;
}

function drawPrimitive(ctx, primitive, theme, options) {
  if (primitive.kind === 'text') {
    if (!primitive.text) return;
    const color = primitive.role === 'pinName' || primitive.role === 'pinNumber'
      ? themeColor(theme, 'pinText')
      : primitive.role === 'graphicText'
        ? themeColor(theme, 'symbolText')
        : themeColor(theme, 'text');
    drawCanvasText(ctx, {
      text: primitive.text,
      x: primitive.x,
      y: primitive.y,
      size: primitive.size,
      rotation: primitive.rotation,
      align: primitive.align || 'left',
      baseline: primitive.baseline || 'alphabetic',
      color,
      fontFamily: themeColor(theme, 'fontFamily'),
    });
    return;
  }

  if (!tracePath(ctx, primitive)) return;
  const fill = resolveFill(primitive, theme);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  const scale = toNumber(options.scale, 0);
  const minPixels = primitive.role === 'pin' ? 0.75 : 0.8;
  const minWidth = scale > 0 ? minPixels / scale : 0;
  ctx.strokeStyle = primitive.role === 'pin' ? themeColor(theme, 'pin') : themeColor(theme, 'symbol');
  ctx.lineWidth = Math.max(0.01, toNumber(primitive.width, options.strokeWidth || DEFAULT_GRAPHIC_WIDTH), minWidth);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * 在已应用世界变换的 canvas 上绘制符号（含引脚线、引脚号与名）。
 * opts: { showPins, showPinNames, showPinNumbers, showText, pinTextSize, pinNumberSize }
 */
export function drawSymbol(ctx, symbolDef, transform, theme = DEFAULT_THEME, opts = {}) {
  if (!ctx || typeof ctx.beginPath !== 'function') return [];
  const options = opts && typeof opts === 'object' ? opts : {};
  const primitives = drawSymbolPrimitives(symbolDef, transform, options);
  for (const primitive of primitives) {
    if (primitive.role === 'pin' && options.showPins === false) continue;
    if (primitive.role === 'pinName' && options.showPinNames === false) continue;
    if (primitive.role === 'pinNumber' && options.showPinNumbers === false) continue;
    if (primitive.role === 'graphicText' && options.showText === false) continue;
    drawPrimitive(ctx, primitive, theme, options);
  }
  return primitives;
}
