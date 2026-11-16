// 极简事件总线：支持命名事件、取消订阅与通配监听，供 store 与编辑器解耦。
export function createBus() {
  const listeners = new Map();

  function on(name, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('事件处理函数必须是函数');
    }
    const key = String(name);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(handler);
    return function offHandler() {
      off(key, handler);
    };
  }

  function off(name, handler) {
    const key = String(name);
    const bucket = listeners.get(key);
    if (!bucket) return false;
    const removed = bucket.delete(handler);
    if (bucket.size === 0) listeners.delete(key);
    return removed;
  }

  function emit(name, payload) {
    const key = String(name);
    const direct = listeners.get(key);
    const wildcard = listeners.get('*');
    if (!direct && !wildcard) return 0;
    let called = 0;
    const invoke = (handler) => {
      called += 1;
      handler(payload, key);
    };
    if (direct) [...direct].forEach(invoke);
    if (wildcard) [...wildcard].forEach(invoke);
    return called;
  }

  function clear() {
    listeners.clear();
  }

  return { on, off, emit, clear };
}
