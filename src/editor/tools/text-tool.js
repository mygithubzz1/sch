// 文本工具：点击放置注释文本，支持激活参数指定内容与字号。
import { createText } from '../../model/project.js';
import { createTool, drawScreenDot, drawScreenText } from './base.js';

export function createTextTool() {
  let ctx = null;
  let text = '文本';
  let size = 1.27;
  let rotation = 0;
  let position = null;

  function color(renderer, key, fallback) {
    const theme = renderer && renderer.theme ? renderer.theme : null;
    return theme && typeof theme[key] === 'string' ? theme[key] : fallback;
  }

  const tool = createTool({
    id: 'text',
    label: '文本',
    cursor: 'text',
    onActivate(next, activateOptions) {
      ctx = next || ctx;
      const options = activateOptions && typeof activateOptions === 'object' ? activateOptions : {};
      text = typeof options.text === 'string' && options.text !== '' ? options.text : '文本';
      size = Number(options.size) > 0 ? Number(options.size) : 1.27;
      rotation = Number(options.rotation) || 0;
      position = null;
      if (ctx) ctx.requestRender();
    },
    onDeactivate(next) {
      ctx = next || ctx;
      position = null;
      if (ctx) ctx.requestRender();
    },
    onPointerDown(e, passed) {
      const c = passed || ctx;
      if (!c || e.button !== 0) return false;
      const point = c.snapPoint(e.world, { tolerancePx: 12 });
      const entity = createText({ x: point.x, y: point.y, text, size, rotation });
      c.commands.addText(c.sheetId, entity);
      c.store.setSelection([entity.id]);
      position = point;
      c.requestRender();
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
      if (e.key === 'Escape') {
        c.editor.setTool('select');
        return true;
      }
      return false;
    },
    drawOverlay(c2d, passed) {
      const c = passed || ctx;
      if (!c || !position) return;
      drawScreenDot(c2d, c.renderer, position, color(c.renderer, 'hover', '#ffd166'), 3);
      drawScreenText(c2d, c.renderer, position, text, {
        color: color(c.renderer, 'text', '#c9d1d9'),
        fontSize: Math.max(10, size * (c.renderer.getView().scale || 1)),
        align: 'left',
      });
    },
  });

  tool.getState = () => ({ text, size, rotation, position: position ? { ...position } : null });
  return tool;
}
