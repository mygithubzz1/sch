// 焊盘工具：点击放焊盘并自动编号递增，SMD 默认 top，H 切换通孔，数字键切换形状。
import { uid } from '../../core/id.js';
import { nextPadNumber } from '../footprint-store.js';
import { createTool, drawScreenText } from '../tools/base.js';

const SHAPES = ['rect', 'roundrect', 'circle', 'oval'];

export function createPadTool() {
  let ctx = null;
  let position = null;
  let layer = 'top';
  let shape = 'roundrect';
  let width = 1.6;
  let height = 1;
  let drill = 0;

  function color(renderer, key, fallback) {
    const theme = renderer && renderer.theme ? renderer.theme : null;
    return theme && typeof theme[key] === 'string' ? theme[key] : fallback;
  }

  function reset() {
    position = null;
  }

  const tool = createTool({
    id: 'pad',
    label: '焊盘',
    cursor: 'crosshair',
    onActivate(next, activateOptions) {
      ctx = next || ctx;
      const options = activateOptions && typeof activateOptions === 'object' ? activateOptions : {};
      layer = options.layer === 'bottom' || options.layer === 'tht' ? options.layer : 'top';
      shape = SHAPES.includes(options.shape) ? options.shape : 'roundrect';
      width = Number(options.w) > 0 ? Number(options.w) : 1.6;
      height = Number(options.h) > 0 ? Number(options.h) : 1;
      drill = layer === 'tht' ? (Number(options.drill) > 0 ? Number(options.drill) : 0.8) : 0;
      reset();
      if (ctx) ctx.requestRender();
    },
    onDeactivate(next) {
      ctx = next || ctx;
      reset();
      if (ctx) ctx.requestRender();
    },
    onPointerMove(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      position = c.snapPoint(e.world);
      c.requestRender();
      return true;
    },
    onPointerDown(e, passed) {
      const c = passed || ctx;
      if (!c || e.button !== 0) return false;
      const point = position ? { ...position } : c.snapPoint(e.world);
      const footprint = c.store.getFootprint();
      const pad = {
        id: uid('pad'),
        number: nextPadNumber(footprint),
        x: point.x,
        y: point.y,
        w: width,
        h: height,
        shape,
        rotation: 0,
        layer,
        drill: layer === 'tht' ? drill : 0,
      };
      c.commands.addPad(pad);
      c.store.setSelection([pad.id]);
      c.requestRender();
      return true;
    },
    onKeyDown(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      if (e.key === 'h' || e.key === 'H') {
        layer = layer === 'tht' ? 'top' : 'tht';
        if (layer === 'tht' && drill <= 0) drill = 0.8;
        if (layer !== 'tht') drill = 0;
        c.requestRender();
        return true;
      }
      if (e.key >= '1' && e.key <= '4') {
        shape = SHAPES[Number(e.key) - 1];
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
      const scale = c.renderer.getView().scale || 1;
      const point = c.renderer.worldToScreen(position);
      const w = width * scale;
      const h = height * scale;
      const fill = color(
        c.renderer,
        layer === 'top' ? 'padTop' : layer === 'bottom' ? 'padBottom' : 'padThru',
        '#e0a44a',
      );
      c2d.save();
      c2d.globalAlpha = 0.55;
      c2d.fillStyle = fill;
      c2d.strokeStyle = color(c.renderer, 'padStroke', '#111111');
      c2d.lineWidth = 1;
      if (shape === 'circle' || shape === 'oval') {
        c2d.beginPath();
        c2d.ellipse(point.x, point.y, w / 2, h / 2, 0, 0, Math.PI * 2);
        c2d.fill();
        c2d.stroke();
      } else {
        c2d.fillRect(point.x - w / 2, point.y - h / 2, w, h);
        c2d.strokeRect(point.x - w / 2, point.y - h / 2, w, h);
      }
      c2d.restore();
      drawScreenText(c2d, c.renderer, { x: position.x, y: position.y + height / 2 + 0.6 }, layer.toUpperCase(), {
        color: color(c.renderer, 'padText', '#ffffff'),
        fontSize: 10,
        align: 'center',
      });
    },
  });

  tool.setLayer = (nextLayer) => {
    if (nextLayer !== 'top' && nextLayer !== 'bottom' && nextLayer !== 'tht') return false;
    layer = nextLayer;
    if (layer === 'tht' && drill <= 0) drill = 0.8;
    return true;
  };
  tool.getLayer = () => layer;
  tool.getState = () => ({ layer, shape, width, height, drill, position: position ? { ...position } : null });
  return tool;
}
