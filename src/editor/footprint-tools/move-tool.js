// 移动工具：拖动焊盘/图形，按栅格吸附，松手后提交一条可撤销命令。
import { snapToGrid } from '../snapping.js';
import { describeFootprintEntity, footprintBoundsOfIds } from '../footprint-hit-test.js';
import { createTool, drawWorldBox } from '../tools/base.js';

export function createMoveTool() {
  let ctx = null;
  let mode = 'idle';
  let start = null;
  let ids = [];
  let delta = { x: 0, y: 0 };
  let moved = false;

  function reset() {
    mode = 'idle';
    start = null;
    ids = [];
    delta = { x: 0, y: 0 };
    moved = false;
  }

  function color(renderer, key, fallback) {
    const theme = renderer && renderer.theme ? renderer.theme : null;
    return theme && typeof theme[key] === 'string' ? theme[key] : fallback;
  }

  const tool = createTool({
    id: 'move',
    label: '移动',
    cursor: 'move',
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
      if (!hit) return false;
      const selection = c.store.getSelection();
      if (!selection.includes(hit.id)) c.store.setSelection([hit.id]);
      mode = 'drag';
      start = e.world;
      ids = c.store.getSelection().slice();
      delta = { x: 0, y: 0 };
      moved = false;
      c.requestRender();
      return true;
    },
    onPointerMove(e, passed) {
      const c = passed || ctx;
      if (!c || mode !== 'drag') return false;
      const candidate = {
        x: start.x + (e.world.x - start.x),
        y: start.y + (e.world.y - start.y),
      };
      const snapped = snapToGrid(candidate, c.grid);
      delta = { x: snapped.x - start.x, y: snapped.y - start.y };
      moved = moved || delta.x !== 0 || delta.y !== 0;
      c.requestRender();
      return true;
    },
    onPointerUp(e, passed) {
      const c = passed || ctx;
      if (!c || mode !== 'drag') return false;
      const finalDelta = { x: delta.x, y: delta.y };
      const dragged = ids.slice();
      const wasMoved = moved;
      reset();
      if (wasMoved && (finalDelta.x !== 0 || finalDelta.y !== 0)) {
        c.commands.moveEntities(dragged, finalDelta);
      }
      c.requestRender();
      return true;
    },
    onKeyDown(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      if (e.key === 'Escape') {
        reset();
        c.editor.setTool('select');
        return true;
      }
      return false;
    },
    drawOverlay(c2d, passed) {
      const c = passed || ctx;
      if (!c || mode !== 'drag' || (delta.x === 0 && delta.y === 0)) return;
      const footprint = c.store.getFootprint();
      for (const id of ids) {
        const described = describeFootprintEntity(footprint, id);
        if (!described) continue;
        const box = footprintBoundsOfIds(footprint, [id]);
        drawWorldBox(
          c2d,
          c.renderer,
          { x: box.x + delta.x, y: box.y + delta.y, w: box.w, h: box.h },
          { color: color(c.renderer, 'selection', '#4ea1ff'), width: 1.5, dash: [5, 3] },
        );
      }
    },
  });

  tool.getState = () => ({ mode, delta: { ...delta } });
  return tool;
}
