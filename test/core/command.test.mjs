// 命令栈测试：撤销/重做、分支截断、变更通知与深度限制。
import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandStack } from '../../src/core/command.js';

function incrementCommand(state) {
  return {
    label: '加一',
    do() {
      state.value += 1;
    },
    undo() {
      state.value -= 1;
    },
  };
}

test('execute / undo / redo 维护状态并可通过 this.state 访问上下文', () => {
  const state = { value: 0 };
  const stack = new CommandStack(state);
  assert.equal(stack.canUndo(), false);
  stack.execute(incrementCommand(state));
  assert.equal(state.value, 1);
  assert.equal(stack.canUndo(), true);
  assert.equal(stack.canRedo(), false);
  assert.ok(stack.undo());
  assert.equal(state.value, 0);
  assert.equal(stack.canRedo(), true);
  assert.ok(stack.redo());
  assert.equal(state.value, 1);
});

test('execute 清空 redo 栈：撤销后执行新命令产生分支截断', () => {
  const state = { value: 0 };
  const stack = new CommandStack(state);
  stack.execute(incrementCommand(state));
  stack.execute(incrementCommand(state));
  stack.undo();
  assert.equal(stack.canRedo(), true);
  stack.execute(incrementCommand(state));
  assert.equal(stack.canRedo(), false);
  assert.equal(state.value, 2);
});

test('空栈 undo/redo 返回 null', () => {
  const stack = new CommandStack({ value: 0 });
  assert.equal(stack.undo(), null);
  assert.equal(stack.redo(), null);
});

test('onChange 在 execute/undo/redo/clear 后通知并可取消订阅', () => {
  const state = { value: 0 };
  const stack = new CommandStack(state);
  const events = [];
  const off = stack.onChange((info) => events.push(info.type + ':' + info.label));
  stack.execute(incrementCommand(state));
  stack.undo();
  stack.redo();
  stack.clear();
  assert.deepEqual(events, ['execute:加一', 'undo:加一', 'redo:加一', 'clear:']);
  off();
  stack.execute(incrementCommand(state));
  assert.equal(events.length, 4);
});

test('do 抛错时命令不入栈且不通知', () => {
  const stack = new CommandStack({});
  let notified = 0;
  stack.onChange(() => { notified += 1; });
  assert.throws(() => stack.execute({
    label: '坏命令',
    do() {
      throw new Error('boom');
    },
    undo() {},
  }), /boom/);
  assert.equal(stack.canUndo(), false);
  assert.equal(notified, 0);
});

test('clear 与 maxDepth 限制历史深度', () => {
  const state = { value: 0 };
  const stack = new CommandStack(state, { maxDepth: 2 });
  stack.execute(incrementCommand(state));
  stack.execute(incrementCommand(state));
  stack.execute(incrementCommand(state));
  stack.undo();
  stack.undo();
  assert.equal(state.value, 1);
  assert.equal(stack.canUndo(), false);
  stack.clear();
  assert.equal(stack.canUndo(), false);
  assert.equal(stack.canRedo(), false);
});

test('非法命令抛出 TypeError', () => {
  const stack = new CommandStack({});
  assert.throws(() => stack.execute({ label: '缺少方法' }), TypeError);
});
