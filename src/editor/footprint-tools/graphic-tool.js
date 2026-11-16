// 图形工具：拖拽绘制丝印线/矩形，L 循环 silkscreen/courtyard/assembly/fab，R 切换线/矩形。
import { dist, round } from '../../core/geometry.js';
import { uid } from '../../core/id.js';
import { FOOTPRINT_LAYERS } from '../../library/graphic.js';
import { createTool, drawWorldBox } from '../tools/base.js';

const DEFAULT_WIDTH = 0.15;

function layerColor(theme, layer) {
  if (!theme) return '#cccccc';
  if (layer === 'courtyard') return theme.courtyard || '#7aa2f7';
  if (layer === 'assembly') return theme.assembly || '#f7a072';
  if (layer === 'fab') return theme.fab || '#9ece6a';
  return theme.silk || '#dddddd';
}

export function createGraphicTool() {
  let ctx = null;
  let layerIndex = 0;
  let shape = 'line';
  let drawing = false;
  let start = null;
  let end = null;
  let drawingShape = 'line';

  function color(renderer, key, fallback) {
    const theme = renderer && renderer.theme ? renderer.theme : null;
    return theme && typeof theme[key] === 'string' ? theme[key] : fallback;
  }

  function reset() {
    drawing = false;
    start = null;
    end = null;
    drawingShape = shape;
  }

  const tool = createTool({
    id: 'graphic',
    label: '图形',
    cursor: 'crosshair',
    onActivate(next, activateOptions) {
      ctx = next || ctx;
      const options = activateOptions && typeof activateOptions === 'object' ? activateOptions : {};
      const index = FOOTPRINT_LAYERS.indexOf(options.layer);
      layerIndex = index >= 0 ? index : 0;
      shape = options.shape === 'rect' ? 'rect' : 'line';
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
      drawing = true;
      start = c.snapPoint(e.world);
      end = { ...start };
      drawingShape = e.shiftKey ? 'rect' : shape;
      c.requestRender();
      return true;
    },
    onPointerMove(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      if (drawing) {
        end = c.snapPoint(e.world);
        c.requestRender();
        return true;
      }
      return false;
    },
    onPointerUp(e, passed) {
      const c = passed || ctx;
      if (!c || !drawing) return false;
      const from = start ? { x: round(start.x, 6), y: round(start.y, 6) } : null;
      const to = end ? { x: round(end.x, 6), y: round(end.y, 6) } : null;
      const kind = drawingShape;
      reset();
      if (!from || !to || dist(from, to) < 1e-6) {
        c.requestRender();
        return true;
      }
      const layer = FOOTPRINT_LAYERS[layerIndex] || 'silkscreen';
      const id = uid('gfx');
      let graphic = null;
      if (kind === 'rect') {
        graphic = {
          id,
          type: 'rect',
          x: round(Math.min(from.x, to.x), 6),
          y: round(Math.min(from.y, to.y), 6),
          w: round(Math.abs(to.x - from.x), 6),
          h: round(Math.abs(to.y - from.y), 6),
          width: DEFAULT_WIDTH,
          fill: false,
          layer,
        };
      } else {
        graphic = {
          id,
          type: 'line',
          points: [from, to],
          width: DEFAULT_WIDTH,
          fill: false,
          layer,
        };
      }
      c.commands.addGraphic(graphic);
      c.store.setSelection([id]);
      c.requestRender();
      return true;
    },
    onKeyDown(e, passed) {
      const c = passed || ctx;
      if (!c) return false;
      if (e.key === 'l' || e.key === 'L') {
        layerIndex = (layerIndex + 1) % FOOTPRINT_LAYERS.length;
        c.requestRender();
        return true;
      }
      if (e.key === 'r' || e.key === 'R') {
        shape = shape === 'rect' ? 'line' : 'rect';
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
      if (!c) return;
      const layer = FOOTPRINT_LAYERS[layerIndex] || 'silkscreen';
      if (drawing && start && end) {
        if (drawingShape === 'rect') {
          drawWorldBox(
            c2d,
            c.renderer,
            {
              x: Math.min(start.x, end.x),
              y: Math.min(start.y, end.y),
              w: Math.abs(end.x - start.x),
              h: Math.abs(end.y - start.y),
            },
            { color: layerColor(c.renderer.theme, layer), width: 1.5, dash: [4, 3] },
          );
        } else {
          const a = c.renderer.worldToScreen(start);
          const b = c.renderer.worldToScreen(end);
          c2d.save();
          c2d.strokeStyle = layerColor(c.renderer.theme, layer);
          c2d.lineWidth = 1.5;
          c2d.setLineDash([4, 3]);
          c2d.beginPath();
          c2d.moveTo(a.x, a.y);
          c2d.lineTo(b.x, b.y);
          c2d.stroke();
          c2d.restore();
        }
      }
      const label = layer + ' / ' + (drawing ? drawingShape : shape);
      c2d.save();
      c2d.fillStyle = color(c.renderer, 'titleBarText', '#dddddd');
      c2d.font = '12px sans-serif';
      c2d.textAlign = 'left';
      c2d.textBaseline = 'bottom';
      c2d.fillText(label, 16, (c.renderer.height || 600) - 16);
      c2d.restore();
    },
  });

  tool.setLayer = (layer) => {
    const index = FOOTPRINT_LAYERS.indexOf(layer);
    if (index < 0) return false;
    layerIndex = index;
    return true;
  };
  tool.getLayer = () => FOOTPRINT_LAYERS[layerIndex] || 'silkscreen';
  tool.setShape = (nextShape) => {
    if (nextShape !== 'line' && nextShape !== 'rect') return false;
    shape = nextShape;
    return true;
  };
  tool.getShape = () => shape;
  tool.getState = () => ({ layer: tool.getLayer(), shape, drawing, start, end });
  return tool;
}
