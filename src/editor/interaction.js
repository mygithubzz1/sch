// 画布交互骨架：指针事件归一化、中键/空格平移、滚轮缩放与键盘事件挂载清理。
import { panView, zoomAt } from '../render/view.js';

function isEditableTarget(target) {
  if (!target) return false;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable === true;
}

function defaultKeyTarget() {
  if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
    return document;
  }
  return null;
}

function defaultWindow() {
  if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
    return window;
  }
  return null;
}

/**
 * 创建画布交互层；编辑器只需提供 handlers。
 * handlers: onPointerDown / onPointerMove / onPointerUp / onPointerLeave /
 *           onDoubleClick / onKeyDown / onKeyUp / onWheel
 * options: keyTarget / win / onViewChange
 */
export function createCanvasInteraction(config = {}) {
  const canvas = config.canvas;
  if (!canvas || typeof canvas.addEventListener !== 'function') {
    throw new TypeError('画布交互层需要 canvas');
  }
  const renderer = config.renderer;
  if (!renderer || typeof renderer.screenToWorld !== 'function') {
    throw new TypeError('画布交互层需要 renderer');
  }
  const options = config.options && typeof config.options === 'object' ? config.options : {};
  const handlers = config.handlers && typeof config.handlers === 'object' ? config.handlers : {};
  const keyTarget = options.keyTarget || defaultKeyTarget() || canvas;
  const win = options.win || defaultWindow();
  const listeners = [];

  let spaceDown = false;
  let panning = null;
  let attached = false;

  function listen(target, type, handler, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, opts);
    listeners.push({ target, type, handler, opts });
  }

  function unlistenAll() {
    for (const entry of listeners) {
      if (entry.target && typeof entry.target.removeEventListener === 'function') {
        entry.target.removeEventListener(entry.type, entry.handler, entry.opts);
      }
    }
    listeners.length = 0;
  }

  /** 把事件坐标换算为画布内 CSS 像素。 */
  function toLocal(raw) {
    const event = raw && typeof raw === 'object' ? raw : {};
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect()
      : { left: 0, top: 0 };
    const left = Number.isFinite(Number(rect.left)) ? Number(rect.left) : 0;
    const top = Number.isFinite(Number(rect.top)) ? Number(rect.top) : 0;
    if (Number.isFinite(Number(event.clientX)) && Number.isFinite(Number(event.clientY))) {
      return { x: Number(event.clientX) - left, y: Number(event.clientY) - top };
    }
    if (Number.isFinite(Number(event.offsetX)) && Number.isFinite(Number(event.offsetY))) {
      return { x: Number(event.offsetX), y: Number(event.offsetY) };
    }
    return { x: 0, y: 0 };
  }

  function normalize(raw, type) {
    const event = raw || {};
    const local = toLocal(event);
    const world = renderer.screenToWorld(local);
    return {
      type,
      originalEvent: event,
      local,
      world,
      button: Number.isFinite(Number(event.button)) ? Number(event.button) : 0,
      buttons: Number.isFinite(Number(event.buttons)) ? Number(event.buttons) : 0,
      detail: Number.isFinite(Number(event.detail)) ? Number(event.detail) : 0,
      pointerId: event.pointerId,
      shiftKey: event.shiftKey === true,
      ctrlKey: event.ctrlKey === true,
      metaKey: event.metaKey === true,
      altKey: event.altKey === true,
      preventDefault() {
        if (typeof event.preventDefault === 'function') event.preventDefault();
      },
      stopPropagation() {
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
      },
    };
  }

  function normalizeKey(raw, type) {
    const event = raw || {};
    return {
      type,
      originalEvent: event,
      key: typeof event.key === 'string' ? event.key : '',
      code: typeof event.code === 'string' ? event.code : '',
      target: event.target,
      repeat: event.repeat === true,
      shiftKey: event.shiftKey === true,
      ctrlKey: event.ctrlKey === true,
      metaKey: event.metaKey === true,
      altKey: event.altKey === true,
      preventDefault() {
        if (typeof event.preventDefault === 'function') event.preventDefault();
      },
      stopPropagation() {
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
      },
    };
  }

  function startPan(event) {
    panning = { start: event.local, view: renderer.getView() };
    if (typeof canvas.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // 不支持指针捕获的宿主忽略即可。
      }
    }
  }

  function endPan(event) {
    const id = event && event.pointerId;
    if (typeof canvas.releasePointerCapture === 'function' && id !== undefined) {
      try {
        canvas.releasePointerCapture(id);
      } catch {
        // 同上：忽略不支持捕获的环境。
      }
    }
    panning = null;
  }

  function emitView(view) {
    if (typeof options.onViewChange === 'function') options.onViewChange(view);
  }

  function onPointerDown(raw) {
    const event = normalize(raw, 'pointerdown');
    if (event.button === 2) return;
    if (event.button === 1 || (spaceDown && event.button === 0)) {
      event.preventDefault();
      startPan(event);
      return;
    }
    if (typeof handlers.onPointerDown === 'function') handlers.onPointerDown(event);
  }

  function onPointerMove(raw) {
    const event = normalize(raw, 'pointermove');
    if (panning) {
      event.preventDefault();
      const next = panView(panning.view, event.local.x - panning.start.x, event.local.y - panning.start.y);
      renderer.setView(next);
      emitView(renderer.getView());
      return;
    }
    if (typeof handlers.onPointerMove === 'function') handlers.onPointerMove(event);
  }

  function onPointerUp(raw) {
    const event = normalize(raw, 'pointerup');
    if (panning) {
      endPan(raw);
      return;
    }
    if (typeof handlers.onPointerUp === 'function') handlers.onPointerUp(event);
  }

  function onPointerLeave(raw) {
    if (panning) return;
    if (typeof handlers.onPointerLeave === 'function') handlers.onPointerLeave(normalize(raw, 'pointerleave'));
  }

  function onDoubleClick(raw) {
    if (panning) return;
    if (typeof handlers.onDoubleClick === 'function') handlers.onDoubleClick(normalize(raw, 'dblclick'));
  }

  function onWheel(raw) {
    if (raw && typeof raw.preventDefault === 'function') raw.preventDefault();
    const event = normalize(raw, 'wheel');
    const deltaY = Number(raw && raw.deltaY);
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    const factor = Math.pow(1.0015, -deltaY);
    const next = zoomAt(renderer.getView(), event.local, factor);
    renderer.setView(next);
    emitView(renderer.getView());
    if (typeof handlers.onWheel === 'function') handlers.onWheel(event, renderer.getView());
  }

  function onKeyDown(raw) {
    if (isEditableTarget(raw && raw.target)) return;
    if (raw && raw.key === ' ') {
      spaceDown = true;
      if (typeof raw.preventDefault === 'function') raw.preventDefault();
      return;
    }
    if (typeof handlers.onKeyDown === 'function') handlers.onKeyDown(normalizeKey(raw, 'keydown'));
  }

  function onKeyUp(raw) {
    if (isEditableTarget(raw && raw.target)) return;
    if (raw && raw.key === ' ') {
      spaceDown = false;
      if (typeof raw.preventDefault === 'function') raw.preventDefault();
      return;
    }
    if (typeof handlers.onKeyUp === 'function') handlers.onKeyUp(normalizeKey(raw, 'keyup'));
  }

  function onContextMenu(raw) {
    if (raw && typeof raw.preventDefault === 'function') raw.preventDefault();
  }

  function onBlur() {
    spaceDown = false;
    panning = null;
  }

  function attach() {
    if (attached) return;
    attached = true;
    listen(canvas, 'pointerdown', onPointerDown);
    listen(canvas, 'pointermove', onPointerMove);
    listen(canvas, 'pointerup', onPointerUp);
    listen(canvas, 'pointercancel', onPointerUp);
    listen(canvas, 'pointerleave', onPointerLeave);
    listen(canvas, 'dblclick', onDoubleClick);
    listen(canvas, 'wheel', onWheel, { passive: false });
    listen(canvas, 'contextmenu', onContextMenu);
    listen(keyTarget, 'keydown', onKeyDown);
    listen(keyTarget, 'keyup', onKeyUp);
    if (win && win !== keyTarget) listen(win, 'blur', onBlur);
  }

  function destroy() {
    unlistenAll();
    attached = false;
    spaceDown = false;
    panning = null;
  }

  attach();

  return {
    canvas,
    renderer,
    normalize,
    normalizeKey,
    toLocal,
    isPanning() {
      return panning !== null;
    },
    isSpaceDown() {
      return spaceDown;
    },
    setSpaceDown(value) {
      spaceDown = value === true;
    },
    setCursor(cursor) {
      if (canvas.style && typeof canvas.style === 'object') canvas.style.cursor = cursor || 'default';
    },
    attach,
    destroy,
  };
}
