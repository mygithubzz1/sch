// 擦除工具：点击命中实体立即删除（一条可撤销命令），悬浮时用虚线框提示。
import { describeEntity, entityBounds } from '../hit-test.js';
import { createTool, drawWorldBox } from './base.js';

export function createEraseTool() {
  let ctx = null;

  function color(renderer, key, fallback) {
    const theme = renderer && renderer.theme ? renderer.theme : null;
    return theme && typeof theme[key] === 'string' ? theme[key] : fallback;
  }

  const tool = createTool({
    id: 'erase',
    label: '擦除',
    cursor: 'not-allowed',
    onActivate(next) {
      ctx = next || ctx;
    },
    onDeactivate(next) {
      ctx = next || ctx;
      if (ctx) ctx.store.setHover(null);
    },
    onPointerDown(e, passed) {
      const c = passed || ctx;
      if (!c || e.button !== 0) return false;
      const hit = c.hitTest(e.world);
      if (!hit) return false;
      c.commands.removeEntities(c.sheetId, [hit.id]);
      c.requestRender();
      return true;
    },
    drawOverlay(c2d, passed) {
      const c = passed || ctx;
      if (!c) return;
      const hoverId = c.store.getHover();
      if (!hoverId) return;
      const described = describeEntity(c.store.getSheet(), hoverId);
      if (!described) return;
      const box = entityBounds(c.store.getSheet(), described.kind, described.entity, {
        resolveSymbol: c.resolveSymbol,
      });
      drawWorldBox(c2d, c.renderer, box, {
        color: color(c.renderer, 'hover', '#ff6b6b'),
        width: 2,
        dash: [4, 3],
      });
    },
  });

  return tool;
}
