// 封装编辑器测试装置：内存封装仓库 + 真实渲染器 + 假画布事件。
import { FootprintRenderer } from '../../src/render/footprint-renderer.js';
import { createFootprintStore } from '../../src/editor/footprint-store.js';
import { createFootprintEditor } from '../../src/editor/footprint-editor.js';
import { createEventCanvas, makeFootprint } from './fixtures.mjs';

export function createFootprintHarness(options = {}) {
  const fake = createEventCanvas();
  const store = createFootprintStore(options.footprint || makeFootprint());
  const renderer = new FootprintRenderer(fake.canvas, {
    width: 800,
    height: 600,
    titleBar: false,
    ...(options.rendererOptions || {}),
  });
  const editor = createFootprintEditor({
    canvas: fake.canvas,
    store,
    renderer,
    options: { keyTarget: fake.canvas, grid: 0.635, ...(options.editorOptions || {}) },
  });
  const events = [];
  editor.on('edit-pad', (info) => events.push({ type: 'edit-pad', ...info }));
  editor.on('edit-graphic', (info) => events.push({ type: 'edit-graphic', ...info }));
  editor.on('tool', (info) => events.push({ type: 'tool', ...info }));
  editor.on('error', (info) => events.push({ type: 'error', ...info }));

  function screenOf(world) {
    return renderer.worldToScreen(world);
  }

  function pointer(type, world, extra = {}) {
    const screen = screenOf(world);
    return fake.fire(type, {
      clientX: screen.x,
      clientY: screen.y,
      button: 0,
      buttons: type === 'pointerdown' ? 1 : 0,
      ...extra,
    });
  }

  function click(world, extra = {}) {
    pointer('pointerdown', world, extra);
    pointer('pointerup', world, extra);
  }

  function keyDown(key, extra = {}) {
    return fake.fire('keydown', { key, target: null, ...extra });
  }

  function keyUp(key, extra = {}) {
    return fake.fire('keyup', { key, target: null, ...extra });
  }

  function key(keyName, extra = {}) {
    keyDown(keyName, extra);
    keyUp(keyName, extra);
  }

  return {
    fake,
    canvas: fake.canvas,
    fire: fake.fire,
    store,
    renderer,
    editor,
    events,
    screenOf,
    pointer,
    click,
    keyDown,
    keyUp,
    key,
    footprint: () => store.getFootprint(),
    dispose: () => editor.destroy(),
  };
}
