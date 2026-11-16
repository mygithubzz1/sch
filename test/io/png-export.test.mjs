import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasToBlob, exportSheetPNG } from '../../src/io/png-export.js';

function createFakeCanvas(width, height) {
  const canvas = {
    width,
    height,
    contexts: [],
    draws: [],
    blobCalls: [],
    toBlob(callback, type, quality) {
      canvas.blobCalls.push({ type, quality, width: canvas.width, height: canvas.height });
      callback(new Blob(['png-bytes'], { type: 'image/png' }));
    },
    getContext(kind) {
      if (kind !== '2d') return null;
      const context = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage(...args) {
          canvas.draws.push(args);
        },
      };
      canvas.contexts.push(context);
      return context;
    },
  };
  return canvas;
}

test('exportSheetPNG 按 scale 放大输出并恢复原尺寸与内容', async () => {
  const source = createFakeCanvas(800, 600);
  const snapshots = [];
  const blob = await exportSheetPNG(source, 2, {
    createCanvas(width, height) {
      const canvas = createFakeCanvas(width, height);
      snapshots.push(canvas);
      return canvas;
    },
  });
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'image/png');
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].width, 800);
  assert.equal(snapshots[0].height, 600);
  assert.equal(source.blobCalls.length, 1);
  assert.equal(source.blobCalls[0].width, 1600);
  assert.equal(source.blobCalls[0].height, 1200);
  assert.equal(source.blobCalls[0].type, 'image/png');
  assert.equal(source.width, 800);
  assert.equal(source.height, 600);
  const scaled = source.draws.some((args) => args[7] === 1600 && args[8] === 1200);
  const restored = source.draws.some((args) => args[7] === 800 && args[8] === 600);
  assert.ok(scaled, '缺少放大绘制');
  assert.ok(restored, '缺少恢复绘制');
});

test('exportSheetPNG 默认 scale 为 2', async () => {
  const source = createFakeCanvas(100, 50);
  await exportSheetPNG(source, undefined, { createCanvas: createFakeCanvas });
  assert.equal(source.blobCalls[0].width, 200);
  assert.equal(source.blobCalls[0].height, 100);
  assert.equal(source.width, 100);
  assert.equal(source.height, 50);
});

test('非法参数以 rejection 报错', async () => {
  await assert.rejects(() => exportSheetPNG(null), TypeError);
  await assert.rejects(() => exportSheetPNG({ width: 0, height: 10 }), TypeError);
  await assert.rejects(() => exportSheetPNG(createFakeCanvas(10, 10), 0), RangeError);
  const source = createFakeCanvas(10, 10);
  await assert.rejects(() => exportSheetPNG(source, 2), /浏览器环境/);
});

test('toBlob 返回空或缺失时 reject', async () => {
  const empty = createFakeCanvas(10, 10);
  empty.toBlob = (callback) => callback(null);
  await assert.rejects(
    () => exportSheetPNG(empty, 1, { createCanvas: createFakeCanvas }),
    /未返回数据/,
  );
  const missing = createFakeCanvas(10, 10);
  delete missing.toBlob;
  await assert.rejects(() => canvasToBlob(missing), /toBlob 不可用/);
});

test('scale 超出范围时被限制在 0.1~8', async () => {
  const huge = createFakeCanvas(10, 10);
  await exportSheetPNG(huge, 100, { createCanvas: createFakeCanvas });
  assert.equal(huge.blobCalls[0].width, 80);
  assert.equal(huge.blobCalls[0].height, 80);
  const tiny = createFakeCanvas(100, 100);
  await exportSheetPNG(tiny, 0.001, { createCanvas: createFakeCanvas });
  assert.equal(tiny.blobCalls[0].width, 10);
});
