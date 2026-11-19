// 回归探针：startServer 的启动日志必须可静默/重定向，避免污染 node:test 结果帧通道
// （污染会表现为 "Unable to deserialize cloned data"）；同时守护默认命令行仍打印原有日志。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import { startServer } from '../../server.mjs';
import { ROOT } from './helpers.mjs';

const START_LINE = /^原理图工作室 dev server 已启动: http:\/\/127\.0\.0\.1:\d+$/;
const ROOT_LINE = '静态根目录: ' + path.resolve(ROOT);

function waitForListening(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      // 启动日志写在 listen 回调里；等一个 tick 保证它已执行完。
      setImmediate(resolve);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

/** 临时接管 console.log，返回捕获数组与恢复函数。 */
function captureConsoleLog() {
  const messages = [];
  const original = console.log;
  console.log = (...args) => messages.push(args.join(' '));
  return {
    messages,
    restore() {
      console.log = original;
    },
  };
}

test('startServer quiet:true 不向 stdout 写任何启动日志', async () => {
  const capture = captureConsoleLog();
  let server;
  try {
    server = startServer({ port: 0, rootDir: ROOT, quiet: true });
    await waitForListening(server);
  } finally {
    capture.restore();
    if (server) await closeServer(server);
  }
  assert.deepEqual(capture.messages, [], 'quiet:true 不应调用 console.log');
});

test('startServer 注入 logger 时启动日志被重定向（地址与静态根目录）', async () => {
  const messages = [];
  const server = startServer({
    port: 0,
    rootDir: ROOT,
    logger: { log: (message) => messages.push(message) },
  });
  try {
    await waitForListening(server);
    const port = server.address().port;
    assert.equal(messages.length, 2);
    assert.equal(messages[0], `原理图工作室 dev server 已启动: http://127.0.0.1:${port}`);
    assert.equal(messages[1], ROOT_LINE);
  } finally {
    await closeServer(server);
  }
});

test('startServer 监听非回环地址时保留第 3 条非回环警告', async () => {
  const messages = [];
  const server = startServer({
    port: 0,
    rootDir: ROOT,
    host: '0.0.0.0',
    logger: (message) => messages.push(message),
  });
  try {
    await waitForListening(server);
    assert.equal(messages.length, 3);
    assert.match(messages[0], /^原理图工作室 dev server 已启动: http:\/\/localhost:\d+$/);
    assert.equal(messages[1], ROOT_LINE);
    assert.equal(messages[2], '警告: 已监听非回环地址，局域网内可访问。');
  } finally {
    await closeServer(server);
  }
});

test('node server.mjs 默认路径仍打印原有启动日志（子进程捕获 stdout）', async () => {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', HOST: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  let buffer = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  const logsReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待启动日志超时，已收到：' + buffer)), 10000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop();
      for (const line of parts) {
        if (line !== '') lines.push(line);
      }
      if (lines.length >= 2) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', reject);
  });
  try {
    await logsReady;
  } finally {
    child.kill();
    await once(child, 'close');
  }
  assert.equal(stderr, '', '默认启动不应写 stderr');
  assert.equal(lines.length, 2, '默认路径应只打印地址与静态根目录两条日志');
  assert.match(lines[0], START_LINE);
  assert.equal(lines[1], ROOT_LINE);
});
