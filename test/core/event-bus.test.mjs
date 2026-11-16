// 事件总线测试：订阅、取消、通配与清空。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../src/core/event-bus.js';

test('on/emit 按事件名派发并返回监听数量', () => {
  const bus = createBus();
  const received = [];
  bus.on('changed', (payload, name) => received.push({ payload, name }));
  const count = bus.emit('changed', { value: 1 });
  assert.equal(count, 1);
  assert.deepEqual(received, [{ payload: { value: 1 }, name: 'changed' }]);
});

test('on 返回的取消函数与 off 都能移除监听', () => {
  const bus = createBus();
  let calls = 0;
  const off = bus.on('x', () => { calls += 1; });
  bus.emit('x');
  off();
  bus.emit('x');
  assert.equal(calls, 1);

  const handler = () => { calls += 1; };
  bus.on('x', handler);
  assert.equal(bus.off('x', handler), true);
  assert.equal(bus.off('x', handler), false);
  bus.emit('x');
  assert.equal(calls, 1);
});

test('通配监听与 clear', () => {
  const bus = createBus();
  const names = [];
  bus.on('*', (payload, name) => names.push(name));
  bus.emit('a');
  bus.emit('b', 1);
  assert.deepEqual(names, ['a', 'b']);
  bus.clear();
  assert.equal(bus.emit('a'), 0);
});

test('非法处理函数抛出 TypeError', () => {
  const bus = createBus();
  assert.throws(() => bus.on('x', null), TypeError);
});
