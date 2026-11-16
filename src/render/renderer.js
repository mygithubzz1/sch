// 原理图 Canvas 渲染器：背景、网格、标题栏、符号、导线、结点、标签、文本与选中高亮。
import { BaseCanvasRenderer } from './base-renderer.js';
import { normalizeDeg } from '../core/geometry.js';
import { contentBBox } from './bounds.js';
import { themeColor } from './theme.js';
import { drawTitleBar } from './title-bar.js';
import { drawSymbol, measureTextWidth, symbolBBox, symbolGraphicsBBox, textPrimitiveBounds } from './symbols.js';

const JUNCTION_RADIUS = 0.5;
const LABEL_SIZE = 1.27;
const TEXT_DEFAULT_SIZE = 1.27;
const LABEL_DISTANCE = 0.6;
const SYMBOL_LABEL_GAP = 0.35;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 原理图渲染器：所有颜色来自 theme，世界坐标统一走 view 变换。 */
export class SchematicRenderer extends BaseCanvasRenderer {
  constructor(canvas, options = {}) {
    super(canvas, options);
    this.project = null;
    this.sheet = null;
    this.symbolResolver = typeof options.symbolResolver === 'function' ? options.symbolResolver : null;
  }

  /** 更新数据：{ project, sheet }；重复设置同一引用也会请求重绘，兼容原地修改。 */
  setState(state = {}) {
    const next = state && typeof state === 'object' ? state : {};
    if ('project' in next) this.project = next.project || null;
    if ('sheet' in next) {
      this.sheet = next.sheet || null;
    } else if (this.project) {
      const sheets = Array.isArray(this.project.sheets) ? this.project.sheets : [];
      if (!this.sheet || !sheets.includes(this.sheet)) this.sheet = sheets[0] || null;
    }
    this.invalidate();
    return this;
  }

  getProject() {
    return this.project;
  }

  getSheet() {
    return this.sheet;
  }

  /** 从 options.symbolResolver 或 project.library.symbols 查找符号定义。 */
  getSymbolDef(symbolId) {
    if (!symbolId) return null;
    if (this.symbolResolver) {
      const resolved = this.symbolResolver(symbolId);
      if (resolved) return resolved;
    }
    const library = this.project && this.project.library ? this.project.library : null;
    const symbols = library && Array.isArray(library.symbols) ? library.symbols : [];
    return symbols.find((symbol) => symbol && symbol.id === symbolId) || null;
  }

  getContentBounds() {
    return contentBBox(this.sheet, { resolveSymbol: (id) => this.getSymbolDef(id) });
  }

  /** 缩放并居中到当前图纸内容；空图纸使用 A4 默认范围。 */
  fitToContent(padding = 48) {
    if (!this.width || !this.height) this.syncSize();
    this.fitToBounds(this.getContentBounds(), padding);
    return this.getView();
  }

  paintUnderlay(ctx) {
    drawTitleBar(ctx, {
      width: this.width,
      height: this.height,
      theme: this.theme,
      project: this.project,
      sheet: this.sheet,
      visible: this.options.titleBar !== false,
    });
  }

  paintWorld(ctx) {
    const sheet = this.sheet;
    if (!sheet) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.drawSymbols(ctx, sheet);
    this.drawWires(ctx, sheet);
    this.drawJunctions(ctx, sheet);
    this.drawLabels(ctx, sheet);
    this.drawTexts(ctx, sheet);
    this.drawHighlights(ctx, sheet);
  }

  drawSymbols(ctx, sheet) {
    const instances = Array.isArray(sheet.symbols) ? sheet.symbols : [];
    const options = {
      showPinNames: this.options.showPinNames !== false,
      showPinNumbers: this.options.showPinNumbers !== false,
      pinTextSize: toNumber(this.theme.pinTextSize, 1),
      scale: this.view.scale,
    };
    for (const instance of instances) {
      if (!instance) continue;
      const def = this.getSymbolDef(instance.symbolId);
      if (def) drawSymbol(ctx, def, instance, this.theme, options);
      else this.drawMissingSymbol(ctx, instance);
      this.drawSymbolLabels(ctx, instance, def);
    }
  }

  drawMissingSymbol(ctx, instance) {
    const x = toNumber(instance.x, 0);
    const y = toNumber(instance.y, 0);
    ctx.save();
    ctx.setLineDash([1.2, 0.8]);
    ctx.strokeStyle = themeColor(this.theme, 'hover');
    ctx.lineWidth = 0.2;
    ctx.strokeRect(x - 2.54, y - 2.54, 5.08, 5.08);
    ctx.restore();
  }

  drawSymbolLabels(ctx, instance, def) {
    const fullBox = def
      ? symbolBBox(def, instance)
      : { x: toNumber(instance.x, 0) - 2.54, y: toNumber(instance.y, 0) - 2.54, w: 5.08, h: 5.08 };
    const graphicsBox = def ? symbolGraphicsBBox(def, instance) : null;
    const box = graphicsBox && graphicsBox.w > 0 && graphicsBox.h > 0 ? graphicsBox : fullBox;
    const size = toNumber(this.options.labelSize, TEXT_DEFAULT_SIZE);
    const family = themeColor(this.theme, 'fontFamily');
    const centerX = box.x + box.w / 2;
    ctx.save();
    ctx.font = size + 'px ' + family;
    ctx.textAlign = 'center';

    if (def && def.power) {
      const label = instance.value || instance.designator || '';
      if (label) {
        const orientation = Array.isArray(def.pins) && def.pins[0] ? def.pins[0].orientation : 'down';
        if (orientation === 'up') {
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = themeColor(this.theme, 'reference');
          ctx.fillText(label, centerX, box.y - SYMBOL_LABEL_GAP);
        } else {
          ctx.textBaseline = 'top';
          ctx.fillStyle = themeColor(this.theme, 'value');
          ctx.fillText(label, centerX, box.y + box.h + SYMBOL_LABEL_GAP);
        }
      }
      ctx.restore();
      return;
    }

    const pins = def && Array.isArray(def.pins) ? def.pins : [];
    const hasVerticalPins = pins.some((pin) => pin && (pin.orientation === 'up' || pin.orientation === 'down'));
    const hasHorizontalPins = pins.some((pin) => pin && (pin.orientation === 'left' || pin.orientation === 'right'));
    if (def && hasVerticalPins && !hasHorizontalPins) {
      const labelX = box.x + box.w + 0.5;
      const centerY = box.y + box.h / 2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = themeColor(this.theme, 'reference');
      ctx.fillText(instance.designator || '?', labelX, centerY - 0.55);
      if (instance.value) {
        ctx.fillStyle = themeColor(this.theme, 'value');
        ctx.fillText(instance.value, labelX, centerY + 0.75);
      }
      ctx.restore();
      return;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = themeColor(this.theme, 'reference');
    ctx.fillText(instance.designator || '?', centerX, box.y - SYMBOL_LABEL_GAP);
    if (instance.value) {
      ctx.textBaseline = 'top';
      ctx.fillStyle = themeColor(this.theme, 'value');
      ctx.fillText(instance.value, centerX, box.y + box.h + SYMBOL_LABEL_GAP);
    }
    ctx.restore();
  }

  drawWires(ctx, sheet) {
    const wires = Array.isArray(sheet.wires) ? sheet.wires : [];
    const scale = this.view.scale || 1;
    ctx.save();
    ctx.strokeStyle = themeColor(this.theme, 'wire');
    for (const wire of wires) {
      if (!wire || !Array.isArray(wire.points) || wire.points.length < 2) continue;
      ctx.lineWidth = Math.max(0.05, toNumber(wire.width, 0.1524), 1 / scale);
      ctx.beginPath();
      ctx.moveTo(toNumber(wire.points[0].x, 0), toNumber(wire.points[0].y, 0));
      for (let index = 1; index < wire.points.length; index += 1) {
        ctx.lineTo(toNumber(wire.points[index].x, 0), toNumber(wire.points[index].y, 0));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawJunctions(ctx, sheet) {
    const junctions = Array.isArray(sheet.junctions) ? sheet.junctions : [];
    if (!junctions.length) return;
    const scale = this.view.scale || 1;
    const radius = Math.max(JUNCTION_RADIUS, 1.5 / scale);
    ctx.save();
    ctx.fillStyle = themeColor(this.theme, 'junction');
    for (const junction of junctions) {
      if (!junction) continue;
      ctx.beginPath();
      ctx.arc(toNumber(junction.x, 0), toNumber(junction.y, 0), radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawLabels(ctx, sheet) {
    const labels = Array.isArray(sheet.labels) ? sheet.labels : [];
    const family = themeColor(this.theme, 'fontFamily');
    const size = LABEL_SIZE;
    for (const label of labels) {
      if (!label) continue;
      const text = typeof label.text === 'string' ? label.text : String(label.text === undefined ? '' : label.text);
      const global = label.kind === 'global';
      const color = themeColor(this.theme, global ? 'labelGlobal' : 'label');
      ctx.save();
      ctx.translate(toNumber(label.x, 0), toNumber(label.y, 0));
      const rotation = toNumber(label.rotation, 0);
      if (rotation) ctx.rotate((normalizeDeg(rotation) * Math.PI) / 180);
      ctx.font = size + 'px ' + family;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (global) {
        const textWidth = measureTextWidth(text, size);
        const padX = 0.5;
        const padY = 0.32;
        const boxX = 0.5;
        const boxY = -size / 2 - padY;
        const boxW = textWidth + padX * 2;
        const boxH = size + padY * 2;
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(boxX, -size / 2);
        ctx.lineTo(boxX, size / 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeRect(boxX, boxY, boxW, boxH);
        ctx.fillText(text, boxX + padX, 0);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(text, LABEL_DISTANCE, 0);
      }
      ctx.restore();
    }
  }

  drawTexts(ctx, sheet) {
    const texts = Array.isArray(sheet.texts) ? sheet.texts : [];
    const family = themeColor(this.theme, 'fontFamily');
    ctx.save();
    ctx.fillStyle = themeColor(this.theme, 'text');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const text of texts) {
      if (!text) continue;
      const size = Math.max(0.2, toNumber(text.size, TEXT_DEFAULT_SIZE));
      ctx.save();
      ctx.translate(toNumber(text.x, 0), toNumber(text.y, 0));
      const rotation = toNumber(text.rotation, 0);
      if (rotation) ctx.rotate((normalizeDeg(rotation) * Math.PI) / 180);
      ctx.font = size + 'px ' + family;
      ctx.fillText(typeof text.text === 'string' ? text.text : String(text.text === undefined ? '' : text.text), 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  highlightColor(id) {
    if (this.selection.has(id)) return themeColor(this.theme, 'selection');
    if (this.hover === id) return themeColor(this.theme, 'hover');
    return null;
  }

  highlightFill(id) {
    if (this.selection.has(id)) return themeColor(this.theme, 'selectionFill');
    if (this.hover === id) return themeColor(this.theme, 'hoverFill');
    return null;
  }

  drawHighlightBox(ctx, box, color, fill, scale) {
    const pad = 0.35;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = fill || 'transparent';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([6 / scale, 3 / scale]);
    ctx.fillRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
    ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
    ctx.restore();
  }

  drawHighlights(ctx, sheet) {
    if (!this.selection.size && !this.hover) return;
    const scale = this.view.scale;

    for (const instance of Array.isArray(sheet.symbols) ? sheet.symbols : []) {
      if (!instance) continue;
      const color = this.highlightColor(instance.id);
      if (!color) continue;
      const def = this.getSymbolDef(instance.symbolId);
      const box = def
        ? symbolBBox(def, instance)
        : { x: toNumber(instance.x, 0) - 2.54, y: toNumber(instance.y, 0) - 2.54, w: 5.08, h: 5.08 };
      this.drawHighlightBox(ctx, box, color, this.highlightFill(instance.id), scale);
    }

    for (const wire of Array.isArray(sheet.wires) ? sheet.wires : []) {
      if (!wire || !Array.isArray(wire.points) || wire.points.length < 2) continue;
      const color = this.highlightColor(wire.id);
      if (!color) continue;
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.05, toNumber(wire.width, 0.1524)) + 3 / scale;
      ctx.beginPath();
      ctx.moveTo(toNumber(wire.points[0].x, 0), toNumber(wire.points[0].y, 0));
      for (let index = 1; index < wire.points.length; index += 1) {
        ctx.lineTo(toNumber(wire.points[index].x, 0), toNumber(wire.points[index].y, 0));
      }
      ctx.stroke();
      ctx.restore();
    }

    for (const junction of Array.isArray(sheet.junctions) ? sheet.junctions : []) {
      if (!junction) continue;
      const color = this.highlightColor(junction.id);
      if (!color) continue;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 / scale;
      ctx.beginPath();
      ctx.arc(toNumber(junction.x, 0), toNumber(junction.y, 0), JUNCTION_RADIUS + 1.5 / scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const label of Array.isArray(sheet.labels) ? sheet.labels : []) {
      if (!label) continue;
      const color = this.highlightColor(label.id);
      if (!color) continue;
      const box = textPrimitiveBounds({
        x: toNumber(label.x, 0),
        y: toNumber(label.y, 0),
        text: label.text,
        size: LABEL_SIZE,
        rotation: toNumber(label.rotation, 0),
        align: 'left',
        baseline: 'middle',
      });
      this.drawHighlightBox(ctx, { x: box.x, y: box.y, w: box.w + LABEL_DISTANCE, h: box.h }, color, this.highlightFill(label.id), scale);
    }

    for (const text of Array.isArray(sheet.texts) ? sheet.texts : []) {
      if (!text) continue;
      const color = this.highlightColor(text.id);
      if (!color) continue;
      const box = textPrimitiveBounds({
        x: toNumber(text.x, 0),
        y: toNumber(text.y, 0),
        text: text.text,
        size: Math.max(0.2, toNumber(text.size, TEXT_DEFAULT_SIZE)),
        rotation: toNumber(text.rotation, 0),
        align: 'left',
        baseline: 'middle',
      });
      this.drawHighlightBox(ctx, box, color, this.highlightFill(text.id), scale);
    }
  }
}