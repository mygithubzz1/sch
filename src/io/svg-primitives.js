// SVG 图元序列化：符号、导线、结点、标签、文本与标题栏的纯字符串输出，供 svg-export 组装。
import {
  drawSymbolPrimitives,
  measureTextWidth,
  symbolBBox,
  symbolGraphicsBBox,
} from '../render/symbols.js';
import { themeColor } from '../render/theme.js';

export const TITLE_BLOCK_WIDTH = 120;
export const TITLE_BLOCK_HEIGHT = 30;
export const TITLE_BLOCK_MARGIN = 3;
export const JUNCTION_RADIUS = 0.5;
export const LABEL_SIZE = 1.27;
const DEFAULT_TEXT_SIZE = 1.27;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 数字格式化：最多 4 位小数，避免 SVG 中出现浮点噪声。 */
export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  const rounded = Math.round(number * 10000) / 10000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** 转义 XML 文本/属性中的特殊字符，并丢弃非法控制字符。 */
export function escapeXml(value) {
  const text = String(value === undefined || value === null ? '' : value).replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
    '',
  );
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function svgBaseline(baseline) {
  if (baseline === 'middle') return 'middle';
  if (baseline === 'bottom') return 'text-after-edge';
  if (baseline === 'top') return 'text-before-edge';
  return 'auto';
}

/** 生成 <text> 元素；baseline 使用 SVG dominant-baseline 取值。 */
export function textElement(options) {
  const x = toNumber(options.x);
  const y = toNumber(options.y);
  const size = Math.max(0.1, toNumber(options.size, DEFAULT_TEXT_SIZE));
  const rotation = toNumber(options.rotation, 0);
  const anchor = options.anchor || 'start';
  const baseline = options.baseline || 'middle';
  const family = options.family ? ' font-family="' + escapeXml(options.family) + '"' : '';
  let element = '<text x="' + formatNumber(x) + '" y="' + formatNumber(y) + '" font-size="' + formatNumber(size) + '"' + family;
  element += ' fill="' + escapeXml(options.color || '#000000') + '"';
  element += ' text-anchor="' + escapeXml(anchor) + '"';
  element += ' dominant-baseline="' + escapeXml(baseline) + '"';
  if (rotation) {
    element += ' transform="rotate(' + formatNumber(rotation) + ' ' + formatNumber(x) + ' ' + formatNumber(y) + ')"';
  }
  element += '>' + escapeXml(options.value) + '</text>';
  return element;
}

function roleColor(primitive, theme) {
  if (primitive.role === 'pin') return themeColor(theme, 'pin');
  if (primitive.role === 'pinName' || primitive.role === 'pinNumber') return themeColor(theme, 'pinText');
  if (primitive.role === 'graphicText') return themeColor(theme, 'symbolText');
  return themeColor(theme, 'symbol');
}

function fillColor(primitive, theme) {
  if (typeof primitive.fill === 'string') return primitive.fill;
  if (primitive.fill === true) return themeColor(theme, 'symbolFill');
  return 'none';
}

function arcPath(primitive) {
  const radius = Math.max(0, toNumber(primitive.r));
  const startRad = (toNumber(primitive.start) * Math.PI) / 180;
  const endRad = (toNumber(primitive.end) * Math.PI) / 180;
  const startX = toNumber(primitive.cx) + radius * Math.cos(startRad);
  const startY = toNumber(primitive.cy) + radius * Math.sin(startRad);
  const endX = toNumber(primitive.cx) + radius * Math.cos(endRad);
  const endY = toNumber(primitive.cy) + radius * Math.sin(endRad);
  const sweep = primitive.anticlockwise
    ? ((toNumber(primitive.start) - toNumber(primitive.end) + 360) % 360)
    : ((toNumber(primitive.end) - toNumber(primitive.start) + 360) % 360);
  const largeArc = sweep > 180 ? 1 : 0;
  const sweepFlag = primitive.anticlockwise ? 0 : 1;
  return (
    'M ' + formatNumber(startX) + ' ' + formatNumber(startY) +
    ' A ' + formatNumber(radius) + ' ' + formatNumber(radius) + ' 0 ' + largeArc + ' ' + sweepFlag +
    ' ' + formatNumber(endX) + ' ' + formatNumber(endY)
  );
}

/** 把一个 drawSymbolPrimitives 图元转换为 SVG 元素字符串。 */
export function primitiveToSvg(primitive, theme, family) {
  if (!primitive) return '';
  if (primitive.kind === 'text') {
    return textElement({
      x: primitive.x,
      y: primitive.y,
      value: primitive.text,
      size: primitive.size,
      rotation: primitive.rotation,
      anchor: primitive.align === 'center' ? 'middle' : primitive.align === 'right' ? 'end' : 'start',
      baseline: svgBaseline(primitive.baseline),
      color: roleColor(primitive, theme),
      family,
    });
  }
  const stroke = escapeXml(roleColor(primitive, theme));
  const fill = escapeXml(fillColor(primitive, theme));
  const width = formatNumber(Math.max(0.01, toNumber(primitive.width, 0.25)));
  if (primitive.kind === 'line' || primitive.kind === 'polyline') {
    const points = (Array.isArray(primitive.points) ? primitive.points : [])
      .map((point) => formatNumber(point.x) + ',' + formatNumber(point.y))
      .join(' ');
    if (points === '') return '';
    const tag = primitive.closed ? 'polygon' : 'polyline';
    return (
      '<' + tag + ' points="' + points + '" fill="' + fill + '" stroke="' + stroke +
      '" stroke-width="' + width + '" stroke-linejoin="round" stroke-linecap="round"/>'
    );
  }
  if (primitive.kind === 'circle') {
    return (
      '<circle cx="' + formatNumber(primitive.cx) + '" cy="' + formatNumber(primitive.cy) + '" r="' +
      formatNumber(primitive.r) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + width + '"/>'
    );
  }
  if (primitive.kind === 'arc') {
    return (
      '<path d="' + arcPath(primitive) + '" fill="none" stroke="' + stroke +
      '" stroke-width="' + width + '" stroke-linecap="round"/>'
    );
  }
  return '';
}

function truncate(text, maxWidth, size) {
  const value = typeof text === 'string' ? text : String(text === undefined ? '' : text);
  if (measureTextWidth(value, size) <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && measureTextWidth(result + '…', size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + '…';
}

function symbolLabelElements(def, instance, theme, family) {
  const graphicsBox = symbolGraphicsBBox(def, instance);
  const fullBox = symbolBBox(def, instance);
  const box = graphicsBox.w > 0 && graphicsBox.h > 0 ? graphicsBox : fullBox;
  const size = toNumber(theme.fontSize, DEFAULT_TEXT_SIZE);
  const gap = 0.35;
  const centerX = box.x + box.w / 2;
  const designator = instance.designator || '?';
  const value = instance.value || '';
  const labels = [];

  if (def.power) {
    const label = value || designator;
    if (!label) return '';
    const orientation = Array.isArray(def.pins) && def.pins[0] ? def.pins[0].orientation : 'down';
    if (orientation === 'up') {
      labels.push(textElement({
        x: centerX, y: box.y - gap, value: label, size, anchor: 'middle',
        baseline: 'text-after-edge', color: themeColor(theme, 'reference'), family,
      }));
    } else {
      labels.push(textElement({
        x: centerX, y: box.y + box.h + gap, value: label, size, anchor: 'middle',
        baseline: 'text-before-edge', color: themeColor(theme, 'value'), family,
      }));
    }
    return labels.join('');
  }

  const pins = Array.isArray(def.pins) ? def.pins : [];
  const hasVertical = pins.some((pin) => pin && (pin.orientation === 'up' || pin.orientation === 'down'));
  const hasHorizontal = pins.some((pin) => pin && (pin.orientation === 'left' || pin.orientation === 'right'));
  if (hasVertical && !hasHorizontal) {
    const labelX = box.x + box.w + 0.5;
    const centerY = box.y + box.h / 2;
    labels.push(textElement({
      x: labelX, y: centerY - 0.55, value: designator, size, anchor: 'start',
      baseline: 'middle', color: themeColor(theme, 'reference'), family,
    }));
    if (value) {
      labels.push(textElement({
        x: labelX, y: centerY + 0.75, value, size, anchor: 'start',
        baseline: 'middle', color: themeColor(theme, 'value'), family,
      }));
    }
    return labels.join('');
  }

  labels.push(textElement({
    x: centerX, y: box.y - gap, value: designator, size, anchor: 'middle',
    baseline: 'text-after-edge', color: themeColor(theme, 'reference'), family,
  }));
  if (value) {
    labels.push(textElement({
      x: centerX, y: box.y + box.h + gap, value, size, anchor: 'middle',
      baseline: 'text-before-edge', color: themeColor(theme, 'value'), family,
    }));
  }
  return labels.join('');
}

/** 符号实例（图形 + 引脚 + 位号/值）转 SVG 分组。 */
export function symbolToSvg(def, instance, theme, options, family) {
  const primitives = drawSymbolPrimitives(def, instance, { pinTextSize: theme.pinTextSize });
  const body = primitives
    .filter((primitive) => {
      if (primitive.role === 'pinName' && options.showPinNames === false) return false;
      if (primitive.role === 'pinNumber' && options.showPinNumbers === false) return false;
      if (primitive.role === 'graphicText' && options.showText === false) return false;
      return true;
    })
    .map((primitive) => primitiveToSvg(primitive, theme, family))
    .join('');
  const labels = symbolLabelElements(def, instance, theme, family);
  return (
    '<g class="symbol" data-symbol-id="' + escapeXml(def.id) +
    '" data-designator="' + escapeXml(instance.designator || '') + '">' + body + labels + '</g>'
  );
}

/** 符号定义缺失时的占位框。 */
export function missingSymbolToSvg(instance, theme, family) {
  const x = toNumber(instance.x);
  const y = toNumber(instance.y);
  return (
    '<g class="symbol symbol-missing" data-designator="' + escapeXml(instance.designator || '') + '">' +
    '<rect x="' + formatNumber(x - 2.54) + '" y="' + formatNumber(y - 2.54) +
    '" width="5.08" height="5.08" fill="none" stroke="' + escapeXml(themeColor(theme, 'hover')) +
    '" stroke-width="0.2" stroke-dasharray="1.2 0.8"/>' +
    textElement({
      x, y: y - 3, value: instance.designator || '?', size: 1.27, anchor: 'middle',
      baseline: 'text-after-edge', color: themeColor(theme, 'reference'), family,
    }) +
    '</g>'
  );
}

/** 导线段转 SVG polyline。 */
export function wireToSvg(wire, theme) {
  const points = (Array.isArray(wire.points) ? wire.points : [])
    .map((point) => formatNumber(point.x) + ',' + formatNumber(point.y))
    .join(' ');
  if (points === '') return '';
  return (
    '<polyline class="wire" points="' + points + '" fill="none" stroke="' +
    escapeXml(themeColor(theme, 'wire')) + '" stroke-width="' +
    formatNumber(Math.max(0.05, toNumber(wire.width, 0.1524))) +
    '" stroke-linecap="round" stroke-linejoin="round"/>'
  );
}

/** 结点转 SVG circle。 */
export function junctionToSvg(junction, theme) {
  return (
    '<circle class="junction" cx="' + formatNumber(junction.x) + '" cy="' + formatNumber(junction.y) +
    '" r="' + formatNumber(JUNCTION_RADIUS) + '" fill="' + escapeXml(themeColor(theme, 'junction')) + '"/>'
  );
}

/** 本地/全局标签转 SVG（含锚点与旋转）。 */
export function labelToSvg(label, theme, family) {
  if (!label) return '';
  const text = typeof label.text === 'string' ? label.text : '';
  const global = label.kind === 'global';
  const color = escapeXml(themeColor(theme, global ? 'labelGlobal' : 'label'));
  const transform =
    'translate(' + formatNumber(label.x) + ' ' + formatNumber(label.y) + ') rotate(' +
    formatNumber(toNumber(label.rotation)) + ')';
  if (global) {
    const textWidth = measureTextWidth(text, LABEL_SIZE);
    const padX = 0.5;
    const padY = 0.32;
    const boxX = 0.5;
    const boxY = -LABEL_SIZE / 2 - padY;
    const boxW = textWidth + padX * 2;
    const boxH = LABEL_SIZE + padY * 2;
    return (
      '<g class="label label-global" transform="' + transform + '">' +
      '<polygon points="0,0 ' + formatNumber(boxX) + ',' + formatNumber(-LABEL_SIZE / 2) + ' ' +
      formatNumber(boxX) + ',' + formatNumber(LABEL_SIZE / 2) + '" fill="' + color + '"/>' +
      '<rect x="' + formatNumber(boxX) + '" y="' + formatNumber(boxY) + '" width="' + formatNumber(boxW) +
      '" height="' + formatNumber(boxH) + '" fill="none" stroke="' + color + '" stroke-width="0.12"/>' +
      textElement({
        x: boxX + padX, y: 0, value: text, size: LABEL_SIZE, anchor: 'start',
        baseline: 'middle', color, family,
      }) +
      '</g>'
    );
  }
  return (
    '<g class="label label-local" transform="' + transform + '">' +
    '<circle cx="0" cy="0" r="0.22" fill="' + color + '"/>' +
    textElement({
      x: 0.6, y: 0, value: text, size: LABEL_SIZE, anchor: 'start',
      baseline: 'middle', color, family,
    }) +
    '</g>'
  );
}

/** 文本注释转 SVG。 */
export function textToSvg(text, theme, family) {
  if (!text) return '';
  return textElement({
    x: text.x,
    y: text.y,
    value: text.text,
    size: toNumber(text.size, DEFAULT_TEXT_SIZE),
    rotation: toNumber(text.rotation),
    anchor: 'start',
    baseline: 'middle',
    color: themeColor(theme, 'text'),
    family,
  });
}

/** 右下角标题栏（工程/图纸/标题/版本/日期/公司）。 */
export function titleBlockToSvg(project, sheet, box, theme, family, options = {}) {
  if (options.titleBlock === false) return '';
  if (box.w < 50 || box.h < 30) return '';
  const maxWidth = Math.max(24, box.w - TITLE_BLOCK_MARGIN * 2);
  const maxHeight = Math.max(10, box.h - TITLE_BLOCK_MARGIN * 2);
  const width = Math.min(TITLE_BLOCK_WIDTH, maxWidth, Math.max(50, box.w * 0.45));
  const height = Math.min(TITLE_BLOCK_HEIGHT, maxHeight, Math.max(12, box.h * 0.12));
  const x = box.x + box.w - width - TITLE_BLOCK_MARGIN;
  const y = box.y + box.h - height - TITLE_BLOCK_MARGIN;
  const title = sheet && sheet.title ? sheet.title : {};
  const projectName = project && project.name ? project.name : '未命名工程';
  const sheetName = sheet && sheet.name ? sheet.name : '图纸';
  const meta = [
    title.rev ? 'REV ' + title.rev : '',
    title.date || '',
    title.company || '',
  ].filter(Boolean).join('   ');
  const line1Size = height * 0.2;
  const line2Size = height * 0.19;
  const line3Size = height * 0.15;
  return (
    '<g id="title-block">' +
    '<rect x="' + formatNumber(x) + '" y="' + formatNumber(y) + '" width="' + formatNumber(width) +
    '" height="' + formatNumber(height) + '" fill="' + escapeXml(themeColor(theme, 'titleBarBg')) +
    '" stroke="' + escapeXml(themeColor(theme, 'titleBarBorder')) + '" stroke-width="0.2"/>' +
    '<line x1="' + formatNumber(x + 3) + '" y1="' + formatNumber(y + line1Size * 2.1) + '" x2="' +
    formatNumber(x + width - 3) + '" y2="' + formatNumber(y + line1Size * 2.1) + '" stroke="' +
    escapeXml(themeColor(theme, 'titleBarBorder')) + '" stroke-width="0.15"/>' +
    textElement({
      x: x + 3, y: y + line1Size * 1.25,
      value: truncate(projectName + ' / ' + sheetName, width - 6, line1Size),
      size: line1Size, anchor: 'start', baseline: 'middle',
      color: themeColor(theme, 'titleBarText'), family,
    }) +
    textElement({
      x: x + 3, y: y + height * 0.58,
      value: truncate(title.title || sheetName, width - 6, line2Size),
      size: line2Size, anchor: 'start', baseline: 'middle',
      color: themeColor(theme, 'titleBarText'), family,
    }) +
    textElement({
      x: x + 3, y: y + height * 0.84,
      value: truncate(meta, width - 6, line3Size),
      size: line3Size, anchor: 'start', baseline: 'middle',
      color: themeColor(theme, 'titleBarMuted'), family,
    }) +
    '</g>'
  );
}
