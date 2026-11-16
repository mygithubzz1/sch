// 导线工具：连续折线绘制、锚点/栅格吸附、自动 junction、双击或回车结束、Backspace 回退。
import { dist } from '../../core/geometry.js';
import { createTool, dedupeConsecutive, drawScreenDot, drawScreenPolyline } from './base.js';

export function createWireTool() {
  let ctx = null;
  let points = [];
  let cursor = null;

  function reset() {
    points = [];
    cursor = null;
  }

  function color(renderer, key, fallback) {
    const theme = renderer && renderer.theme ? renderer.theme : null;
    return theme && typeof theme[key] === 'string' ? theme[key] : fallback;
  }

  function finish(c) {
    const clean = dedupeConsecutive(points);
    if (c && clean.length >= 2) {
      c.commands.addWire(c.sheetId, clean, { autoJunction: true, resolveSymbol: c.resolveSymbol });
    }
    reset();
    if (c) c.requestRender();
  }

  const tool = createTool({
    id: 'wire',
    label: '导线',
    cursor: 'crosshair',
    onActivate(next) {
      ctx = next || ctx;
      reset();
      if (ctx) ctx.requestRender();
    },
    onDeactivate(next) {
      ctx = next || ctx;
      reset();
      if (ctx) ctx.requestRender();
    },
    onPointerDown(e, passed) {
      const c = passed || ctx;
      if (!c || e.button !== 0) return false;
      const point = c.snapPoint(e.world, { tolerancePx: 12 });
      if (points.length === 0) {
        points = [point];
      } else if (dist(points[points.length - 1], point) > 1e-9) {
        points.push(point);
      }
      cursor = point;
      c.requestRender();
      return true;
    },
    onPointerMove(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      cursor = c.snapPoint(e.world, { tolerancePx: 12 });
      c.requestRender();
      return true;
    },
    onDoubleClick(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      finish(c);
      return true;
    },
    onKeyDown(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      if (e.key === 'Enter') {
        finish(c);
        return true;
      }
      if (e.key === 'Escape') {
        if (points.length === 0) return false;
        reset();
        c.requestRender();
        return true;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (points.length === 0) return false;
        if (points.length > 1) points.pop();
        else points = [];
        c.requestRender();
        return true;
      }
      return false;
    },
    drawOverlay(c2d, passed) {
      const c = passed || ctx;
      if (!c) return;
      const stroke = color(c.renderer, 'wire', '#7ee787');
      if (points.length === 0) {
        if (cursor) drawScreenDot(c2d, c.renderer, cursor, color(c.renderer, 'hover', '#ffd166'), 3);
        return;
      }
      const preview = cursor ? [...points, cursor] : points;
      drawScreenPolyline(c2d, c.renderer, preview, stroke, 2);
      if (cursor) drawScreenPolyline(c2d, c.renderer, [points[points.length - 1], cursor], stroke, 1, [5, 3]);
      for (const point of points) drawScreenDot(c2d, c.renderer, point, stroke, 2.5);
      if (cursor) drawScreenDot(c2d, c.renderer, cursor, color(c.renderer, 'hover', '#ffd166'), 3.5);
    },
  });

  tool.getState = () => ({ points: points.map((point) => ({ ...point })), cursor: cursor ? { ...cursor } : null });
  return tool;
}
