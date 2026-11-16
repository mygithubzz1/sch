// 放置工具：符号预览、R 旋转、X 镜像、Esc 取消、点击后继续放置、Shift+点击结束。
import { normalizeDeg } from '../../core/geometry.js';
import { defaultFootprintFor } from '../../library/mapping.js';
import { createSymbolInstance } from '../../model/project.js';
import { createTool, drawGhostSymbol, drawScreenDot, nextDesignator } from './base.js';

export function createPlaceTool() {
  let ctx = null;
  let symbolId = 'R';
  let rotation = 0;
  let mirror = false;
  let position = null;
  let options = {};

  function reset() {
    position = null;
    rotation = 0;
    mirror = false;
  }

  function color(renderer, key, fallback) {
    const theme = renderer && renderer.theme ? renderer.theme : null;
    return theme && typeof theme[key] === 'string' ? theme[key] : fallback;
  }

  const tool = createTool({
    id: 'place',
    label: '放置符号',
    cursor: 'copy',
    onActivate(next, activateOptions) {
      ctx = next || ctx;
      options = activateOptions && typeof activateOptions === 'object' ? activateOptions : {};
      const fallback = ctx && ctx.placement && ctx.placement.symbolId ? ctx.placement.symbolId : 'R';
      symbolId = options.symbolId || fallback;
      rotation = normalizeDeg(Number(options.rotation) || 0);
      mirror = options.mirror === true;
      position = null;
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
      const def = c.resolveSymbol(symbolId);
      if (!def) return false;
      const point = position ? { ...position } : c.snapPoint(e.world, { tolerancePx: 12 });
      const sheet = c.store.getSheet();
      const instance = createSymbolInstance({
        symbolId,
        designator: nextDesignator(sheet, def.refPrefix, c.resolveSymbol),
        value: typeof options.value === 'string' ? options.value : def.name,
        x: point.x,
        y: point.y,
        rotation,
        mirror,
        footprintId: defaultFootprintFor(symbolId),
      });
      c.commands.addSymbol(c.sheetId, instance);
      c.store.setSelection([instance.id]);
      if (e.shiftKey) c.editor.setTool('select');
      else c.requestRender();
      return true;
    },
    onPointerMove(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      position = c.snapPoint(e.world, { tolerancePx: 12 });
      c.requestRender();
      return true;
    },
    onKeyDown(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      if (e.key === 'r' || e.key === 'R') {
        rotation = normalizeDeg(rotation + 90);
        c.requestRender();
        return true;
      }
      if (e.key === 'x' || e.key === 'X') {
        mirror = !mirror;
        c.requestRender();
        return true;
      }
      if (e.key === 'Escape') {
        c.editor.setTool('select');
        return true;
      }
      return false;
    },
    drawOverlay(c2d, passed) {
      const c = passed || ctx;
      if (!c || !position) return;
      const def = c.resolveSymbol(symbolId);
      if (def) {
        drawGhostSymbol(c2d, c.renderer, def, { x: position.x, y: position.y, rotation, mirror }, c.renderer.theme);
      }
      drawScreenDot(c2d, c.renderer, position, color(c.renderer, 'selection', '#4ea1ff'), 4);
    },
  });

  tool.getState = () => ({ symbolId, rotation, mirror, position: position ? { ...position } : null });
  return tool;
}
