// 封装 Canvas 渲染器：焊盘、钻孔、丝印、courtyard 虚线、原点十字与焊盘编号。
import { BaseCanvasRenderer } from './base-renderer.js';
import { bboxOfPoints } from '../core/geometry.js';
import { expandBounds } from './bounds.js';
import { themeColor } from './theme.js';
import { drawCanvasText } from './text.js';

export const DEFAULT_FOOTPRINT_BOUNDS = Object.freeze({ x: -20, y: -15, w: 40, h: 30 });
const DEFAULT_GRAPHIC_WIDTH = 0.15;
const ORIGIN_CROSS = 3;
const PAD_STROKE_WIDTH = 0.05;
const FOOTPRINT_PADDING = 2.54;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function padColor(theme, layer) {
  if (layer === 'top') return themeColor(theme, 'padTop');
  if (layer === 'bottom') return themeColor(theme, 'padBottom');
  return themeColor(theme, 'padThru');
}

function graphicColor(theme, layer) {
  if (layer === 'courtyard') return themeColor(theme, 'courtyard');
  if (layer === 'assembly') return themeColor(theme, 'assembly');
  if (layer === 'fab') return themeColor(theme, 'fab');
  return themeColor(theme, 'silk');
}

function roundedRectPath(ctx, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const left = -w / 2;
  const top = -h / 2;
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.lineTo(left + w - r, top);
  ctx.quadraticCurveTo(left + w, top, left + w, top + r);
  ctx.lineTo(left + w, top + h - r);
  ctx.quadraticCurveTo(left + w, top + h, left + w - r, top + h);
  ctx.lineTo(left + r, top + h);
  ctx.quadraticCurveTo(left, top + h, left, top + h - r);
  ctx.lineTo(left, top + r);
  ctx.quadraticCurveTo(left, top, left + r, top);
  ctx.closePath();
}

/** 以焊盘中心为原点构建焊盘轮廓路径。 */
export function padPath(ctx, pad) {
  const w = Math.max(0.01, toNumber(pad && pad.w, 1));
  const h = Math.max(0.01, toNumber(pad && pad.h, 1));
  const shape = pad && pad.shape ? pad.shape : 'rect';
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2);
    return;
  }
  if (shape === 'roundrect') {
    roundedRectPath(ctx, w, h, Math.min(w, h) * 0.25);
    return;
  }
  if (shape === 'oval') {
    roundedRectPath(ctx, w, h, Math.min(w, h) / 2);
    return;
  }
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
}

function collectGraphicPoints(graphic, points) {
  if (!graphic || typeof graphic !== 'object') return;
  const type = graphic.type;
  if (type === 'line' || type === 'polyline') {
    for (const point of Array.isArray(graphic.points) ? graphic.points : []) {
      if (!point) continue;
      points.push({ x: toNumber(point.x, 0), y: toNumber(point.y, 0) });
    }
    return;
  }
  if (type === 'rect') {
    const x = toNumber(graphic.x, 0);
    const y = toNumber(graphic.y, 0);
    const w = toNumber(graphic.w, 0);
    const h = toNumber(graphic.h, 0);
    points.push({ x, y }, { x: x + w, y: y + h });
    return;
  }
  if (type === 'circle' || type === 'arc') {
    const r = Math.max(0, toNumber(graphic.r, 0));
    const cx = toNumber(graphic.cx, 0);
    const cy = toNumber(graphic.cy, 0);
    points.push({ x: cx - r, y: cy - r }, { x: cx + r, y: cy + r });
    return;
  }
  if (type === 'text') {
    const size = toNumber(graphic.size, 1.27);
    const x = toNumber(graphic.x, 0);
    const y = toNumber(graphic.y, 0);
    const text = typeof graphic.text === 'string' ? graphic.text : '';
    points.push({ x, y: y - size / 2 }, { x: x + text.length * size * 0.6, y: y + size / 2 });
  }
}

/** 封装渲染器：绘制焊盘/丝印/courtyard/原点十字，支持焊盘选中高亮。 */
export class FootprintRenderer extends BaseCanvasRenderer {
  constructor(canvas, options = {}) {
    super(canvas, options);
    this.footprint = null;
  }

  /** 更新数据：{ footprint }；也接受直接传入 FootprintDef。 */
  setState(state = {}) {
    const next = state && typeof state === 'object' ? state : {};
    let footprint = next.footprint || next.footprintDef || next.def || null;
    if (!footprint && Array.isArray(next.pads)) footprint = next;
    this.footprint = footprint && typeof footprint === 'object' ? footprint : null;
    if (Array.isArray(next.selection) || next.selection instanceof Set) this.setSelection(next.selection);
    this.invalidate();
    return this;
  }

  getFootprint() {
    return this.footprint;
  }

  setFootprint(footprint) {
    return this.setState({ footprint });
  }

  getContentBounds() {
    const footprint = this.footprint;
    if (!footprint) return { ...DEFAULT_FOOTPRINT_BOUNDS };
    const points = [];
    for (const pad of Array.isArray(footprint.pads) ? footprint.pads : []) {
      if (!pad) continue;
      const w = Math.max(0.01, toNumber(pad.w, 1));
      const h = Math.max(0.01, toNumber(pad.h, 1));
      const radius = Math.hypot(w, h) / 2;
      const x = toNumber(pad.x, 0);
      const y = toNumber(pad.y, 0);
      points.push({ x: x - radius, y: y - radius }, { x: x + radius, y: y + radius });
    }
    for (const graphic of Array.isArray(footprint.graphics) ? footprint.graphics : []) {
      collectGraphicPoints(graphic, points);
    }
    if (!points.length) return { ...DEFAULT_FOOTPRINT_BOUNDS };
    return expandBounds(bboxOfPoints(points), FOOTPRINT_PADDING);
  }

  fitToContent(padding = 48) {
    if (!this.width || !this.height) this.syncSize();
    this.fitToBounds(this.getContentBounds(), padding);
    return this.getView();
  }

  paintUnderlay(ctx) {
    if (this.options.titleBar === false) return;
    const theme = this.theme;
    const family = themeColor(theme, 'fontFamily');
    const footprint = this.footprint;
    const name = footprint && footprint.name ? footprint.name : '未选择封装';
    const padCount = footprint && Array.isArray(footprint.pads) ? footprint.pads.length : 0;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '13px ' + family;
    ctx.fillStyle = themeColor(theme, 'titleBarText');
    ctx.fillText('封装：' + name, 16, 26);
    ctx.font = '11px ' + family;
    ctx.fillStyle = themeColor(theme, 'titleBarMuted');
    ctx.fillText(padCount + ' 个焊盘', 16, 44);
    ctx.restore();
  }

  paintWorld(ctx) {
    if (!this.footprint) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.drawOrigin(ctx);
    this.drawGraphics(ctx);
    this.drawPads(ctx);
    this.drawPadNumbers(ctx);
    this.drawHighlights(ctx);
  }

  drawOrigin(ctx) {
    const scale = this.view.scale;
    ctx.save();
    ctx.strokeStyle = themeColor(this.theme, 'origin');
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    ctx.moveTo(-ORIGIN_CROSS, 0);
    ctx.lineTo(ORIGIN_CROSS, 0);
    ctx.moveTo(0, -ORIGIN_CROSS);
    ctx.lineTo(0, ORIGIN_CROSS);
    ctx.stroke();
    ctx.restore();
  }

  drawGraphic(ctx, graphic, color, dash) {
    if (!graphic) return;
    const scale = this.view.scale || 1;
    const width = Math.max(0.01, toNumber(graphic.width, DEFAULT_GRAPHIC_WIDTH), 0.8 / scale);
    const fill = typeof graphic.fill === 'string' ? graphic.fill : graphic.fill === true ? color : null;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = fill || color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    const type = graphic.type;
    if (type === 'line' || type === 'polyline') {
      const points = Array.isArray(graphic.points) ? graphic.points : [];
      if (points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(toNumber(points[0].x, 0), toNumber(points[0].y, 0));
        for (let index = 1; index < points.length; index += 1) {
          ctx.lineTo(toNumber(points[index].x, 0), toNumber(points[index].y, 0));
        }
        if (graphic.closed) ctx.closePath();
        if (fill) ctx.fill();
        ctx.stroke();
      }
    } else if (type === 'rect') {
      const x = toNumber(graphic.x, 0);
      const y = toNumber(graphic.y, 0);
      const w = toNumber(graphic.w, 0);
      const h = toNumber(graphic.h, 0);
      if (fill) ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    } else if (type === 'circle') {
      ctx.beginPath();
      ctx.arc(toNumber(graphic.cx, 0), toNumber(graphic.cy, 0), Math.max(0, toNumber(graphic.r, 0)), 0, Math.PI * 2);
      if (fill) ctx.fill();
      ctx.stroke();
    } else if (type === 'arc') {
      ctx.beginPath();
      ctx.arc(
        toNumber(graphic.cx, 0),
        toNumber(graphic.cy, 0),
        Math.max(0, toNumber(graphic.r, 0)),
        (toNumber(graphic.start, 0) * Math.PI) / 180,
        (toNumber(graphic.end, 270) * Math.PI) / 180,
      );
      ctx.stroke();
    } else if (type === 'text') {
      drawCanvasText(ctx, {
        text: typeof graphic.text === 'string' ? graphic.text : '',
        x: toNumber(graphic.x, 0),
        y: toNumber(graphic.y, 0),
        size: toNumber(graphic.size, 1.27),
        align: 'center',
        baseline: 'middle',
        color,
        fontFamily: themeColor(this.theme, 'fontFamily'),
      });
    }
    ctx.restore();
  }

  drawGraphics(ctx) {
    const graphics = Array.isArray(this.footprint.graphics) ? this.footprint.graphics : [];
    for (const graphic of graphics) {
      if (!graphic) continue;
      const layer = graphic.layer || 'silkscreen';
      const color = graphicColor(this.theme, layer);
      const dash = layer === 'courtyard' ? [1, 0.6] : null;
      this.drawGraphic(ctx, graphic, color, dash);
    }
  }

  drawPads(ctx) {
    const pads = Array.isArray(this.footprint.pads) ? this.footprint.pads : [];
    for (const pad of pads) {
      if (!pad) continue;
      ctx.save();
      ctx.translate(toNumber(pad.x, 0), toNumber(pad.y, 0));
      const rotation = toNumber(pad.rotation, 0);
      if (rotation) ctx.rotate((rotation * Math.PI) / 180);
      padPath(ctx, pad);
      ctx.fillStyle = padColor(this.theme, pad.layer);
      ctx.fill();
      ctx.strokeStyle = themeColor(this.theme, 'padStroke');
      ctx.lineWidth = Math.max(PAD_STROKE_WIDTH, 1 / (this.view.scale || 1));
      ctx.stroke();
      const drill = toNumber(pad.drill, 0);
      if (drill > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, drill / 2, 0, Math.PI * 2);
        ctx.fillStyle = themeColor(this.theme, 'padDrill');
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawPadNumbers(ctx) {
    const pads = Array.isArray(this.footprint.pads) ? this.footprint.pads : [];
    const family = themeColor(this.theme, 'fontFamily');
    const color = themeColor(this.theme, 'padText');
    for (const pad of pads) {
      if (!pad || pad.number === undefined || pad.number === null || pad.number === '') continue;
      const size = Math.max(0.4, Math.min(1.2, Math.min(toNumber(pad.w, 1), toNumber(pad.h, 1)) * 0.45));
      drawCanvasText(ctx, {
        text: String(pad.number),
        x: toNumber(pad.x, 0),
        y: toNumber(pad.y, 0),
        size,
        align: 'center',
        baseline: 'middle',
        color,
        fontFamily: family,
      });
    }
  }

  drawHighlights(ctx) {
    if (!this.selection.size && !this.hover) return;
    const scale = this.view.scale;
    const pads = Array.isArray(this.footprint.pads) ? this.footprint.pads : [];
    for (const pad of pads) {
      if (!pad) continue;
      const selected = this.selection.has(pad.id);
      const hovered = this.hover === pad.id;
      if (!selected && !hovered) continue;
      ctx.save();
      ctx.translate(toNumber(pad.x, 0), toNumber(pad.y, 0));
      const rotation = toNumber(pad.rotation, 0);
      if (rotation) ctx.rotate((rotation * Math.PI) / 180);
      padPath(ctx, pad);
      ctx.fillStyle = themeColor(this.theme, selected ? 'selectionFill' : 'hoverFill');
      ctx.fill();
      ctx.strokeStyle = themeColor(this.theme, selected ? 'selection' : 'hover');
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([4 / scale, 2 / scale]);
      ctx.stroke();
      ctx.restore();
    }
  }
}
