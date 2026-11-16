// 封装选择工具：点选焊盘/图形、Shift 加选、空白框选、Esc 清空。
import { rectFromPoints } from '../../core/geometry.js';
import { footprintBoundsOfIds } from '../footprint-hit-test.js';
import { createTool, drawWorldBox } from '../tools/base.js';

export function createFootprintSelectTool() {
  let ctx = null;
  let mode = 'idle';
  let start = null;
  let marquee = null;
  let additive = false;

  function reset() {
    mode = 'idle';
    start = null;
    marquee = null;
    additive = false;
  }

  function color(renderer, key, fallback) {
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
          c.store.setSelection(
            selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id],
          );
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
        c.store.setSelection([hit.id]);
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
      if (mode === 'marquee' && marquee) {
        drawWorldBox(c2d, c.renderer, marquee, {
          color: color(c.renderer, 'selection', '#4ea1ff'),
          fill: color(c.renderer, 'selectionFill', 'rgba(78,161,255,0.12)'),
          width: 1,
          dash: [4, 3],
        });
      }
      const selection = c.store.getSelection();
      if (mode === 'marquee' && selection.length) {
        const box = footprintBoundsOfIds(c.store.getFootprint(), selection);
        drawWorldBox(c2d, c.renderer, box, {
          color: color(c.renderer, 'selection', '#4ea1ff'),
          width: 1,
          dash: [2, 3],
        });
      }
    },
  });

  tool.getState = () => ({ mode, marquee: marquee ? { ...marquee } : null });
  return tool;
}
