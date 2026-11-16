// 工具公共设施：工具接口兜底、拖动吸附、overlay 绘制与位号生成。
import { dist, normalizeDeg } from '../../core/geometry.js';
import { drawSymbol } from '../../render/symbols.js';
import { findSnapPoint, snapToGrid } from '../snapping.js';

/** 工具接口默认实现：所有方法都存在，工具只覆盖需要的部分。 */
export function createTool(definition = {}) {
  const tool = {
    id: definition.id || 'tool',
    label: definition.label || definition.id || '工具',
    cursor: definition.cursor || 'default',
    onActivate: definition.onActivate || function onActivate() {},
    onDeactivate: definition.onDeactivate || function onDeactivate() {},
    onPointerDown: definition.onPointerDown || function onPointerDown() { return false; },
    onPointerMove: definition.onPointerMove || function onPointerMove() { return false; },
    onPointerUp: definition.onPointerUp || function onPointerUp() { return false; },
    onPointerLeave: definition.onPointerLeave || function onPointerLeave() {},
    onDoubleClick: definition.onDoubleClick || function onDoubleClick() { return false; },
    onKeyDown: definition.onKeyDown || function onKeyDown() { return false; },
    onKeyUp: definition.onKeyUp || function onKeyUp() { return false; },
    drawOverlay: definition.drawOverlay || function drawOverlay() {},
  };
  return tool;
}

/** 去掉连续重复点。 */
export function dedupeConsecutive(points) {
  const result = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!point) continue;
    const last = result[result.length - 1];
    if (last && dist(last, point) < 1e-6) continue;
    result.push({ x: Number(point.x), y: Number(point.y) });
  }
  return result;
}

/** 拖动位移：优先吸附到锚点，其次吸附到栅格（保持拖拽起始偏移）。 */
export function computeMoveDelta(startWorld, currentWorld, ctx, excludeIds = []) {
  if (!startWorld || !currentWorld) return { x: 0, y: 0 };
  const raw = { x: currentWorld.x - startWorld.x, y: currentWorld.y - startWorld.y };
  const candidate = { x: startWorld.x + raw.x, y: startWorld.y + raw.y };
  const view = ctx.renderer && typeof ctx.renderer.getView === 'function' ? ctx.renderer.getView() : null;
  const scale = view && Number(view.scale) > 0 ? Number(view.scale) : 1;
  const tolerancePx = Number.isFinite(Number(ctx.snapTolerancePx)) ? Number(ctx.snapTolerancePx) : 10;
  const anchors = typeof ctx.getAnchors === 'function' ? ctx.getAnchors({ excludeIds }) : [];
  const hit = findSnapPoint(anchors, candidate, tolerancePx / scale);
  if (hit) return { x: hit.x - startWorld.x, y: hit.y - startWorld.y };
  const snapped = snapToGrid(candidate, ctx.grid);
  return { x: snapped.x - startWorld.x, y: snapped.y - startWorld.y };
}

/** 下一个可用位号：前缀 + 递增数字。 */
export function nextDesignator(sheet, refPrefix, resolveSymbol) {
  const prefix = typeof refPrefix === 'string' && refPrefix !== '' ? refPrefix : 'U';
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('^' + escaped + '(\\d+)$');
  let max = 0;
  const symbols = sheet && Array.isArray(sheet.symbols) ? sheet.symbols : [];
  for (const instance of symbols) {
    if (!instance) continue;
    const designator = typeof instance.designator === 'string' ? instance.designator : '';
    const match = designator.match(pattern);
    if (match) max = Math.max(max, Number(match[1]) || 0);
    else if (typeof resolveSymbol === 'function') {
      const def = resolveSymbol(instance.symbolId);
      if (def && def.refPrefix === prefix) {
        const loose = designator.match(/(\d+)$/);
        if (loose) max = Math.max(max, Number(loose[1]) || 0);
      }
    }
  }
  return prefix + (max + 1);
}

function screenPoint(renderer, world) {
  return renderer.worldToScreen(world);
}

/** 在 overlay(CSS px 空间) 上绘制世界坐标折线。 */
export function drawScreenPolyline(ctx, renderer, points, color, width = 1.5, dash = null) {
  const list = Array.isArray(points) ? points : [];
  if (!ctx || list.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  const first = screenPoint(renderer, list[0]);
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < list.length; index += 1) {
    const point = screenPoint(renderer, list[index]);
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

/** 在 overlay 上绘制世界坐标圆点。 */
export function drawScreenDot(ctx, renderer, world, color, radius = 3) {
  if (!ctx || !world) return;
  const point = screenPoint(renderer, world);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 在 overlay 上绘制世界坐标矩形（虚线框可选半透明填充）。 */
export function drawWorldBox(ctx, renderer, box, style = {}) {
  if (!ctx || !box) return;
  const topLeft = screenPoint(renderer, { x: box.x, y: box.y });
  const bottomRight = screenPoint(renderer, { x: box.x + box.w, y: box.y + box.h });
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  const w = Math.abs(bottomRight.x - topLeft.x);
  const h = Math.abs(bottomRight.y - topLeft.y);
  ctx.save();
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fillRect(x, y, w, h);
  }
  if (style.color) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width || 1.5;
    if (style.dash) ctx.setLineDash(style.dash);
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

/** 在 overlay 上绘制符号半透明预览（旋转/镜像与放置位置一致）。 */
export function drawGhostSymbol(ctx, renderer, symbolDef, transform, theme, options = {}) {
  if (!ctx || !symbolDef || !transform) return;
  const view = renderer.getView();
  const scale = Number(view.scale) > 0 ? Number(view.scale) : 1;
  const origin = screenPoint(renderer, { x: transform.x, y: transform.y });
  ctx.save();
  ctx.globalAlpha = Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 0.65;
  ctx.translate(origin.x, origin.y);
  ctx.scale(scale, scale);
  drawSymbol(
    ctx,
    symbolDef,
    { x: 0, y: 0, rotation: normalizeDeg(transform.rotation), mirror: transform.mirror === true },
    theme,
    { scale, showPinNames: options.showPinNames !== false, showPinNumbers: options.showPinNumbers !== false },
  );
  ctx.restore();
}

/** 在 overlay 上绘制世界坐标文本。 */
export function drawScreenText(ctx, renderer, world, text, style = {}) {
  if (!ctx || !text) return;
  const point = screenPoint(renderer, world);
  ctx.save();
  ctx.fillStyle = style.color || '#ffffff';
  ctx.font = (style.fontSize || 12) + 'px ' + (style.fontFamily || 'sans-serif');
  ctx.textAlign = style.align || 'left';
  ctx.textBaseline = style.baseline || 'middle';
  ctx.fillText(String(text), point.x, point.y);
  ctx.restore();
}
