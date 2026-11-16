// 选择工具：点选/Shift 加选、空白框选、拖动多选实体并吸附，松手提交一条可撤销命令。
import { dist, rectFromPoints } from '../../core/geometry.js';
import { boundsOfIds, describeEntity, entityBounds } from '../hit-test.js';
import { computeMoveDelta, createTool, drawWorldBox } from './base.js';

export function createSelectTool() {
  let ctx = null;
  let mode = 'idle';
  let start = null;
  let dragIds = [];
  let delta = { x: 0, y: 0 };
  let moved = false;
  let marquee = null;
  let additive = false;

  function reset() {
    mode = 'idle';
    start = null;
    dragIds = [];
    delta = { x: 0, y: 0 };
    moved = false;
    marquee = null;
    additive = false;
  }

  function themeColor(renderer, key, fallback) {
    const theme = renderer && renderer.theme ? renderer.theme : null;
    return theme && typeof theme[key] === 'string' ? theme[key] : fallback;
  }

  const tool = createTool({
    id: 'select',
    label: '选择',
    cursor: 'default',
    onActivate(next) {
      ctx = next || ctx;
      reset();
    },
    onDeactivate(next) {
      ctx = next || ctx;
      reset();
      if (ctx) ctx.requestRender();
    },
    onPointerDown(e, passed) {
      const c = passed || ctx;
      if (!c || e.button !== 0) return false;
      const hit = c.hitTest(e.world);
      if (e.shiftKey) {
        if (hit) {
          const selection = c.store.getSelection();
          const next = selection.includes(hit.id)
            ? selection.filter((id) => id !== hit.id)
            : [...selection, hit.id];
          c.store.setSelection(next);
        } else {
          additive = true;
          mode = 'marquee';
          start = e.world;
          marquee = rectFromPoints(e.world, e.world);
        }
        c.requestRender();
        return true;
      }
      if (hit) {
        const selection = c.store.getSelection();
        if (!selection.includes(hit.id)) c.store.setSelection([hit.id]);
        mode = 'drag';
        start = e.world;
        dragIds = c.store.getSelection().slice();
        delta = { x: 0, y: 0 };
        moved = false;
        c.requestRender();
        return true;
      }
      c.store.setSelection([]);
      additive = false;
      mode = 'marquee';
      start = e.world;
      marquee = rectFromPoints(e.world, e.world);
      c.requestRender();
      return true;
    },
    onPointerMove(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      if (mode === 'drag') {
        delta = computeMoveDelta(start, e.world, c, dragIds);
        if (dist(delta, { x: 0, y: 0 }) > 1e-9) moved = true;
        c.requestRender();
        return true;
      }
      if (mode === 'marquee') {
        marquee = rectFromPoints(start, e.world);
        c.requestRender();
        return true;
      }
      return false;
    },
    onPointerUp(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      if (mode === 'drag') {
        const ids = dragIds.slice();
        const finalDelta = { x: delta.x, y: delta.y };
        const wasMoved = moved;
        reset();
        if (wasMoved && (finalDelta.x !== 0 || finalDelta.y !== 0)) {
          c.commands.moveEntities(c.sheetId, ids, finalDelta);
        }
        c.requestRender();
        return true;
      }
      if (mode === 'marquee') {
        const rect = marquee ? { ...marquee } : null;
        const base = additive ? c.store.getSelection() : [];
        reset();
        if (rect) {
          const ids = c.hitTestBox(rect);
          c.store.setSelection(Array.from(new Set([...base, ...ids])));
        }
        c.requestRender();
        return true;
      }
      return false;
    },
    onKeyDown(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      if (e.key === 'Escape') {
        reset();
        c.store.setSelection([]);
        c.requestRender();
        return true;
      }
      return false;
    },
    drawOverlay(c2d, passed) {
      const c = passed || ctx;
      if (!c) return;
      if (mode === 'drag' && (delta.x !== 0 || delta.y !== 0)) {
        const sheet = c.store.getSheet();
        const offset = { x: delta.x, y: delta.y };
        for (const id of dragIds) {
          const described = describeEntity(sheet, id);
          if (!described) continue;
          const box = entityBounds(sheet, described.kind, described.entity, { resolveSymbol: c.resolveSymbol });
          drawWorldBox(
            c2d,
            c.renderer,
            { x: box.x + offset.x, y: box.y + offset.y, w: box.w, h: box.h },
            { color: themeColor(c.renderer, 'selection', '#4ea1ff'), width: 1.5, dash: [5, 3] },
          );
        }
        const union = boundsOfIds(sheet, dragIds, { resolveSymbol: c.resolveSymbol });
        drawWorldBox(
          c2d,
          c.renderer,
          { x: union.x + offset.x, y: union.y + offset.y, w: union.w, h: union.h },
          { color: themeColor(c.renderer, 'selection', '#4ea1ff'), width: 1, dash: [2, 3] },
        );
      }
      if (mode === 'marquee' && marquee) {
        drawWorldBox(c2d, c.renderer, marquee, {
          color: themeColor(c.renderer, 'selection', '#4ea1ff'),
          fill: themeColor(c.renderer, 'selectionFill', 'rgba(78,161,255,0.12)'),
          width: 1,
          dash: [4, 3],
        });
      }
    },
  });

  tool.getState = () => ({ mode, delta: { ...delta }, marquee: marquee ? { ...marquee } : null });
  return tool;
}
