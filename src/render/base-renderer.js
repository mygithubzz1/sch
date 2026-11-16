// Canvas 渲染器基类：高清像素比、视图变换、脏标记、重绘调度与通用绘制流程。
import { createView, fitView, normalizeView, screenToWorld, worldToScreen, zoomAt as zoomView } from './view.js';
import { createTheme } from './theme.js';
import { drawGrid } from './grid.js';

const DEFAULT_GRID_MM = 2.54;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resolveDpr(explicit) {
  const value = Number(explicit);
  if (Number.isFinite(value) && value > 0) return value;
  const globalValue = Number(globalThis.devicePixelRatio);
  return Number.isFinite(globalValue) && globalValue > 0 ? globalValue : 1;
}

function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
  return setTimeout(callback, 0);
}

function defaultCancelFrame(id) {
  if (id === null || id === undefined) return;
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id);
}

/** 所有 Canvas 渲染器的公共骨架；子类实现 paintWorld 即可。 */
export class BaseCanvasRenderer {
  constructor(canvas, options = {}) {
    if (!canvas) throw new TypeError('渲染器需要 canvas 元素');
    this.canvas = canvas;
    this.options = options && typeof options === 'object' ? options : {};
    this.theme = createTheme(this.options.theme);
    this.grid = toNumber(this.options.grid, 0) > 0 ? toNumber(this.options.grid, DEFAULT_GRID_MM) : DEFAULT_GRID_MM;
    this.view = createView(this.options.view);
    this.selection = new Set();
    this.hover = null;
    this.dirty = true;
    this.destroyed = false;
    this.frame = null;
    this.width = 0;
    this.height = 0;
    this.dpr = resolveDpr(this.options.devicePixelRatio);
    this.requestFrame = typeof this.options.requestAnimationFrame === 'function'
      ? this.options.requestAnimationFrame
      : defaultRequestFrame;
    this.cancelFrame = typeof this.options.cancelAnimationFrame === 'function'
      ? this.options.cancelAnimationFrame
      : defaultCancelFrame;
    this.ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    this.syncSize();
  }

  /** 读取显示尺寸（CSS px 与设备像素）。 */
  syncSize() {
    const dpr = this.dpr;
    const canvas = this.canvas;
    let width = Number(canvas.clientWidth);
    let height = Number(canvas.clientHeight);
    if (!(width > 0) || !(height > 0)) {
      width = Number(canvas.width) / dpr;
      height = Number(canvas.height) / dpr;
    }
    if (!(width > 0) || !(height > 0)) {
      width = toNumber(this.options.width, 800);
      height = toNumber(this.options.height, 600);
    }
    const cssWidth = Math.max(1, Math.round(width));
    const cssHeight = Math.max(1, Math.round(height));
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    this.width = cssWidth;
    this.height = cssHeight;
    return { width: cssWidth, height: cssHeight, dpr };
  }

  /** 响应容器尺寸变化，返回新的 CSS 尺寸。 */
  resize() {
    this.dirty = true;
    const size = this.syncSize();
    this.requestRender();
    return size;
  }

  getSize() {
    return { width: this.width, height: this.height };
  }

  getCanvas() {
    return this.canvas;
  }

  getTheme() {
    return this.theme;
  }

  setTheme(theme) {
    this.theme = createTheme(theme);
    this.dirty = true;
    this.requestRender();
    return this.theme;
  }

  setGrid(size) {
    this.grid = toNumber(size, 0) > 0 ? toNumber(size, this.grid) : this.grid;
    this.dirty = true;
    this.requestRender();
    return this.grid;
  }

  getGrid() {
    return this.grid;
  }

  setView(view) {
    this.view = normalizeView(view, this.view);
    this.dirty = true;
    this.requestRender();
    return this.getView();
  }

  getView() {
    return createView(this.view);
  }

  worldToScreen(p) {
    return worldToScreen(this.view, p);
  }

  screenToWorld(p) {
    return screenToWorld(this.view, p);
  }

  zoomAt(screenPt, factor) {
    return this.setView(zoomView(this.view, screenPt, factor));
  }

  panBy(dx, dy) {
    return this.setView({
      offsetX: this.view.offsetX + toNumber(dx, 0),
      offsetY: this.view.offsetY + toNumber(dy, 0),
      scale: this.view.scale,
    });
  }

  fitToBounds(bbox, padding = 48) {
    if (!this.width || !this.height) this.syncSize();
    return this.setView(fitView(bbox, this.width, this.height, padding));
  }

  setSelection(ids) {
    const next = new Set();
    if (ids instanceof Set) {
      for (const id of ids) if (typeof id === 'string' && id) next.add(id);
    } else if (Array.isArray(ids)) {
      for (const id of ids) if (typeof id === 'string' && id) next.add(id);
    } else if (typeof ids === 'string' && ids) {
      next.add(ids);
    }
    this.selection = next;
    this.dirty = true;
    this.requestRender();
    return this.getSelection();
  }

  getSelection() {
    return Array.from(this.selection);
  }

  isSelected(id) {
    return this.selection.has(id);
  }

  setHover(id) {
    this.hover = typeof id === 'string' && id !== '' ? id : null;
    this.dirty = true;
    this.requestRender();
    return this.hover;
  }

  getHover() {
    return this.hover;
  }

  isDirty() {
    return this.dirty;
  }

  invalidate() {
    this.dirty = true;
    this.requestRender();
  }

  requestRender() {
    this.dirty = true;
    if (this.destroyed || this.frame !== null) return;
    const token = { id: null };
    this.frame = token;
    const run = () => {
      if (this.frame === token) this.frame = null;
      this.render();
    };
    const id = this.requestFrame(run);
    if (this.frame === token) token.id = id === undefined ? null : id;
  }

  cancelScheduled() {
    if (this.frame === null) return;
    const token = this.frame;
    this.frame = null;
    if (token.id !== null && token.id !== undefined) this.cancelFrame(token.id);
  }

  destroy() {
    this.cancelScheduled();
    this.destroyed = true;
    this.dirty = false;
  }

  /** 是否真的重绘：脏标记为 false 且未强制时直接返回 false。 */
  render(force = false) {
    if (this.destroyed || !this.ctx) return false;
    if (!force && !this.dirty) return false;
    this.cancelScheduled();
    this.syncSize();
    this.dirty = false;
    const ctx = this.ctx;
    const { dpr, width, height, theme } = this;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    this.paintGrid(ctx);
    this.paintUnderlay(ctx);
    ctx.save();
    const scale = this.view.scale;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * this.view.offsetX, dpr * this.view.offsetY);
    this.paintWorld(ctx);
    ctx.restore();
    this.paintOverlay(ctx);
    ctx.restore();
    return true;
  }

  paintGrid(ctx) {
    if (this.options.gridVisible === false) return;
    drawGrid(ctx, this.view, { width: this.width, height: this.height }, this.grid, this.theme);
  }

  paintUnderlay() {}

  paintWorld() {}

  paintOverlay() {}
}
