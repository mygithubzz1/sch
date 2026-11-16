// 唯一 ID 生成测试：格式、前缀与进程内唯一性。
import test from 'node:test';
import assert from 'node:assert/strict';
import { uid } from '../../src/core/id.js';

test('uid 生成 prefix-片段-序号 格式', () => {
  const id = uid('R');
  assert.match(id, /^R-[0-9a-f]{6}-\d+$/);
  assert.equal(uid().startsWith('id-'), true);
  assert.equal(uid('').startsWith('id-'), true);
});

test('uid 在进程内唯一且序号递增', () => {
  const ids = new Set();
  let previous = 0;
  for (let index = 0; index < 500; index += 1) {
    const id = uid('sym');
    assert.equal(ids.has(id), false);
    ids.add(id);
    const sequence = Number(id.split('-').pop());
    assert.ok(sequence > previous);
    previous = sequence;
  }
  assert.equal(ids.size, 500);
});
