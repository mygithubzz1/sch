// 原理图编辑器测试装置：store + 真实渲染器 + 假画布事件。
import { createStore } from '../../src/model/store.js';
import { SchematicRenderer } from '../../src/render/renderer.js';
import { createSchematicEditor } from '../../src/editor/schematic-editor.js';
import { createEventCanvas, makeProject } from './fixtures.mjs';

export function createEditorHarness(options = {}) {
  const fake = createEventCanvas();
  const store = createStore(options.project || makeProject());
  const renderer = new SchematicRenderer(fake.canvas, {
    width: 800,
    height: 600,
    titleBar: false,
    ...(options.rendererOptions || {}),
  });
  const editor = createSchematicEditor({
    canvas: fake.canvas,
    store,
    renderer,
    options: { keyTarget: fake.canvas, ...(options.editorOptions || {}) },
  });
  const events = [];
  editor.on('edit-entity', (info) => events.push({ type: 'edit-entity', ...info }));
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
    sheet: () => store.getSheet(),
    dispose: () => editor.destroy(),
  };
}
