// 网络标签工具：点击放置标签，G 切换全局/局部，Esc 返回选择工具。
import { createLabel } from '../../model/project.js';
import { createTool, drawScreenDot, drawScreenText } from './base.js';

export function createLabelTool() {
  let ctx = null;
  let text = 'NET';
  let kind = 'local';
  let rotation = 0;
  let position = null;

  function color(renderer, key, fallback) {
    const theme = renderer && renderer.theme ? renderer.theme : null;
    return theme && typeof theme[key] === 'string' ? theme[key] : fallback;
  }

  const tool = createTool({
    id: 'label',
    label: '网络标签',
    cursor: 'text',
    onActivate(next, activateOptions) {
      ctx = next || ctx;
      const options = activateOptions && typeof activateOptions === 'object' ? activateOptions : {};
      text = typeof options.text === 'string' && options.text !== '' ? options.text : 'NET';
      kind = options.kind === 'global' ? 'global' : 'local';
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
      const label = createLabel({ x: point.x, y: point.y, rotation, text, kind });
      c.commands.addLabel(c.sheetId, label);
      c.store.setSelection([label.id]);
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
      if (e.key === 'g' || e.key === 'G') {
        kind = kind === 'global' ? 'local' : 'global';
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
      const global = kind === 'global';
      drawScreenDot(c2d, c.renderer, position, color(c.renderer, 'hover', '#ffd166'), 3);
      drawScreenText(c2d, c.renderer, position, text, {
        color: color(c.renderer, global ? 'labelGlobal' : 'label', '#9ad1ff'),
        fontSize: 12,
        align: 'left',
      });
      if (global) {
        drawScreenText(c2d, c.renderer, position, '[全局]', {
          color: color(c.renderer, 'labelGlobal', '#9ad1ff'),
          fontSize: 10,
          align: 'right',
        });
      }
    },
  });

  tool.getState = () => ({ text, kind, rotation, position: position ? { ...position } : null });
  return tool;
}
