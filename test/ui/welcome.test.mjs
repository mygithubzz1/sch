// 首次提示记忆测试：localStorage 缺失、损坏与写入异常时安全降级。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WELCOME_STORAGE_KEY,
  dismissWelcome,
  isWelcomeDismissed,
} from '../../src/ui/welcome.js';

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

test('首次提示默认显示，关闭后记住状态', () => {
  const storage = createStorage();
  assert.equal(isWelcomeDismissed(storage), false);
  assert.equal(dismissWelcome(storage), true);
  assert.equal(storage.getItem(WELCOME_STORAGE_KEY), '1');
  assert.equal(isWelcomeDismissed(storage), true);
  assert.equal(WELCOME_STORAGE_KEY, 'schematic-studio:ui-welcome-dismissed');
});

test('存储缺失或异常时安全降级', () => {
  assert.equal(isWelcomeDismissed(null), false);
  assert.equal(dismissWelcome(null), false);

  const throwing = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(isWelcomeDismissed(throwing), false);
  assert.equal(dismissWelcome(throwing), false);

  const broken = {
    getItem() {
      throw new Error('denied');
    },
  };
  assert.equal(isWelcomeDismissed(broken), false);
});
