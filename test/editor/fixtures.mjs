// 编辑器测试夹具：可派发事件的假画布、标准工程与最小封装（无编辑器依赖）。
import { createFakeCanvas } from '../render/helpers/fake-canvas.mjs';
import {
  createJunction,
  createLabel,
  createProject,
  createSymbolInstance,
  createText,
  createWire,
} from '../../src/model/project.js';

/** 带 addEventListener/fire 的假画布（不依赖 DOM）。 */
export function createEventCanvas(width = 800, height = 600) {
  const base = createFakeCanvas(width, height);
  const canvas = base.canvas;
  const listeners = new Map();
  canvas.addEventListener = (type, handler) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  };
  canvas.removeEventListener = (type, handler) => {
    const list = listeners.get(type) || [];
    listeners.set(type, list.filter((item) => item !== handler));
  };
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height });
  canvas.focus = () => {};
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.style = {};

  function fire(type, event = {}) {
    const list = listeners.get(type) || [];
    const payload = { preventDefault() {}, stopPropagation() {}, ...event };
    for (const handler of [...list]) handler(payload);
    return payload;
  }

  return { canvas, ctx: base.ctx, calls: base.calls, listeners, fire };
}

/** 标准图纸：两个电阻、一根导线、结点、标签与文本。 */
export function makeProject() {
  const project = createProject('编辑器测试');
  const sheet = project.sheets[0];
  sheet.symbols.push(
    createSymbolInstance({ id: 'sym-r1', symbolId: 'R', designator: 'R1', value: '10k', x: 20.32, y: 20.32 }),
    createSymbolInstance({ id: 'sym-r2', symbolId: 'R', designator: 'R2', value: '1k', x: 40.64, y: 20.32 }),
  );
  const wire = createWire([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  wire.id = 'wire-1';
  sheet.wires.push(wire);
  sheet.junctions.push(createJunction(10, 0));
  sheet.junctions[0].id = 'jct-1';
  sheet.labels.push(createLabel({ id: 'lbl-1', x: 0, y: 10, text: 'NET_A', kind: 'local' }));
  sheet.texts.push(createText({ id: 'txt-1', x: 0, y: 20, text: '注释', size: 1.27 }));
  return project;
}

/** 最小可编辑封装。 */
export function makeFootprint() {
  return {
    id: 'TEST_FP',
    name: '测试封装',
    description: '编辑器用例',
    pads: [
      { id: 'pad-1', number: '1', x: 0, y: 0, w: 1.6, h: 1, shape: 'rect', rotation: 0, layer: 'top', drill: 0 },
      { id: 'pad-2', number: '2', x: 2.54, y: 0, w: 1.6, h: 1, shape: 'rect', rotation: 0, layer: 'top', drill: 0 },
    ],
    graphics: [
      { id: 'gfx-1', type: 'line', points: [{ x: -2, y: -2 }, { x: 2, y: -2 }], width: 0.15, layer: 'silkscreen' },
    ],
  };
}
