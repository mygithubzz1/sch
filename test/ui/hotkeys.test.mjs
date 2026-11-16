// 快捷键解析与绑定测试：界面只接管自己负责的按键，编辑器自有快捷键不重复处理。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITOR_SHORTCUTS,
  SHORTCUT_HELP_GROUPS,
  UI_SHORTCUTS,
  bindHotkeys,
  isEditableTarget,
  resolveHotkey,
} from '../../src/ui/hotkeys.js';

function keyEvent(key, extra = {}) {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, ...extra };
}

function createTarget() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, handler) {
      listeners.push({ type, handler });
    },
    removeEventListener(type, handler) {
      const index = listeners.findIndex((item) => item.type === type && item.handler === handler);
      if (index >= 0) listeners.splice(index, 1);
    },
    fire(type, event) {
      for (const listener of listeners.filter((item) => item.type === type)) listener.handler(event);
    },
  };
}

test('界面快捷键映射到动作 id', () => {
  assert.equal(resolveHotkey(keyEvent('n', { ctrlKey: true })), 'newProject');
  assert.equal(resolveHotkey(keyEvent('s', { ctrlKey: true })), 'save');
  assert.equal(resolveHotkey(keyEvent('s', { ctrlKey: true, shiftKey: true })), 'saveAs');
  assert.equal(resolveHotkey(keyEvent('o', { ctrlKey: true })), 'open');
  assert.equal(resolveHotkey(keyEvent('e', { ctrlKey: true })), 'exportNetlist');
  assert.equal(resolveHotkey(keyEvent('w')), 'wireTool');
  assert.equal(resolveHotkey(keyEvent('v')), 'selectTool');
  assert.equal(resolveHotkey(keyEvent('g')), 'gridSnap');
  assert.equal(resolveHotkey(keyEvent('r')), 'rotate');
  assert.equal(resolveHotkey(keyEvent('x')), 'mirror');
  assert.equal(resolveHotkey(keyEvent('+')), 'zoomIn');
  assert.equal(resolveHotkey(keyEvent('=')), 'zoomIn');
  assert.equal(resolveHotkey(keyEvent('-')), 'zoomOut');
  assert.equal(resolveHotkey(keyEvent('f')), 'fit');
  assert.equal(resolveHotkey(keyEvent('?', { shiftKey: true })), 'help');
});

test('编辑器负责的快捷键不在界面层重复解析', () => {
  for (const event of [
    keyEvent('z', { ctrlKey: true }),
    keyEvent('z', { ctrlKey: true, shiftKey: true }),
    keyEvent('y', { ctrlKey: true }),
    keyEvent('a', { ctrlKey: true }),
    keyEvent('Delete'),
    keyEvent('Backspace'),
    keyEvent('Escape'),
    keyEvent('Enter'),
    keyEvent(' '),
  ]) {
    assert.equal(resolveHotkey(event), null, '按键 ' + event.key + ' 应由编辑器处理');
  }
});

test('修饰键必须严格匹配', () => {
  assert.equal(resolveHotkey(keyEvent('s')), null);
  assert.equal(resolveHotkey(keyEvent('s', { ctrlKey: true, altKey: true })), null);
  assert.equal(resolveHotkey(keyEvent('W', { shiftKey: true })), null);
  assert.equal(resolveHotkey(keyEvent('w', { ctrlKey: true })), null);
  assert.equal(resolveHotkey(keyEvent('+', { ctrlKey: true })), null);
  assert.equal(resolveHotkey(null), null);
});

test('isEditableTarget 识别输入控件与 contenteditable', () => {
  assert.equal(isEditableTarget(null), false);
  assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableTarget({ tagName: 'textarea' }), true);
  assert.equal(isEditableTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV' }), false);
});

test('bindHotkeys 在输入框聚焦时跳过普通快捷键、保留保存', () => {
  const target = createTarget();
  const calls = [];
  const binding = bindHotkeys({
    target,
    handlers: {
      save: () => calls.push('save'),
      wireTool: () => calls.push('wire'),
      fit: () => calls.push('fit'),
    },
  });
  const input = { tagName: 'INPUT' };
  const fakeEvent = (key, extra = {}) => ({
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: input,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...extra,
  });

  target.fire('keydown', fakeEvent('s', { ctrlKey: true }));
  assert.deepEqual(calls, ['save']);
  target.fire('keydown', fakeEvent('w'));
  assert.deepEqual(calls, ['save']);
  target.fire('keydown', fakeEvent('f'));
  assert.deepEqual(calls, ['save']);
  binding.unbind();
  target.fire('keydown', fakeEvent('s', { ctrlKey: true, target: null }));
  assert.deepEqual(calls, ['save']);
});

test('bindHotkeys 支持阻塞回调、preventDefault 与重复键控制', () => {
  const target = createTarget();
  const calls = [];
  let blocked = true;
  const binding = bindHotkeys({
    target,
    isBlocked: () => blocked,
    handlers: {
      gridSnap: () => calls.push('snap'),
      zoomIn: (event) => calls.push('zoom:' + event.prevented),
      rotate: () => calls.push('rotate'),
    },
  });
  const fire = (key, extra = {}) => {
    const event = {
      key,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: null,
      repeat: false,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
      ...extra,
    };
    target.fire('keydown', event);
    return event;
  };

  fire('g');
  assert.deepEqual(calls, []);
  blocked = false;
  fire('+');
  assert.deepEqual(calls, ['zoom:true']);
  fire('r', { repeat: true });
  assert.deepEqual(calls, ['zoom:true']);
  fire('r');
  assert.deepEqual(calls, ['zoom:true', 'rotate']);
  binding.unbind();
  assert.equal(target.listeners.length, 0);
});

test('快捷键帮助覆盖任务要求的全部按键', () => {
  const text = [
    ...SHORTCUT_HELP_GROUPS.flatMap((group) => group.items.map((item) => item.keys)),
    ...UI_SHORTCUTS.map((item) => item.keys),
    ...EDITOR_SHORTCUTS.map((item) => item.keys),
  ].join(' | ');
  for (const required of ['Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+Y', 'Ctrl+S', 'Ctrl+A', 'Delete', 'R', 'X', 'G', 'W', 'Esc', '+ / -', 'F']) {
    assert.ok(text.includes(required), '快捷键帮助应包含 ' + required);
  }
  assert.ok(UI_SHORTCUTS.some((item) => item.id === 'save'));
  assert.ok(UI_SHORTCUTS.every((item) => typeof item.label === 'string' && item.label !== ''));
});
