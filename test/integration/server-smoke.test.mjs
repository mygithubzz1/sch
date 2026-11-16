// 服务器冒烟测试：与 scripts/smoke.mjs 共用同一套 runSmoke 逻辑（以子测试调用），
// 并额外验证脚本可独立执行、以 0 退出且不产生告警。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { REQUIRED_PATHS, runSmoke } from '../../scripts/smoke.mjs';
import { ROOT } from './helpers.mjs';

const SCRIPT = path.join(ROOT, 'scripts', 'smoke.mjs');

test('服务器冒烟：随机端口启动后静态资源全部可用', async (t) => {
  const result = await runSmoke({ rootDir: ROOT });

  await t.test('全部检查通过且服务器已关闭', () => {
    const failures = result.checks.filter((check) => !check.ok).map((check) => check.path + ' -> ' + check.reason);
    assert.deepEqual(failures, [], failures.join('\n'));
    assert.equal(result.ok, true);
    assert.equal(result.failed, 0);
    assert.ok(result.total >= 80, '冒烟检查项数异常：' + result.total);
  });

  await t.test('覆盖页面、入口、样式与示例资源', () => {
    const paths = result.checks.map((check) => check.path);
    for (const required of REQUIRED_PATHS) {
      assert.ok(paths.includes(required), '冒烟缺少关键资源 ' + required);
    }
    assert.ok(paths.some((route) => route.startsWith('/src/ui/')), '应覆盖 src/ui 入口模块');
    assert.ok(paths.some((route) => route.startsWith('/src/editor/')), '应覆盖 src/editor 入口模块');
  });

  await t.test('模块返回 JS Content-Type 且响应体与磁盘一致', () => {
    const main = result.checks.find((check) => check.path === '/src/main.js');
    assert.ok(main, '缺少 /src/main.js 检查项');
    assert.equal(main.status, 200);
    assert.match(main.contentType, /^text\/javascript/);
    assert.equal(main.contentMatches, true);

    const uiApp = result.checks.find((check) => check.path === '/src/ui/app.js');
    assert.match(uiApp.contentType, /^text\/javascript/);
    assert.equal(uiApp.contentMatches, true);

    const demo = result.checks.find((check) => check.path === '/examples/demo-led.json');
    assert.match(demo.contentType, /^application\/json/);
    assert.equal(demo.contentMatches, true);

    const css = result.checks.find((check) => check.path === '/src/ui/styles.css');
    assert.match(css.contentType, /^text\/css/);
    assert.equal(css.contentMatches, true);
  });

  await t.test('冒烟结束后服务器已关闭', async () => {
    await assert.rejects(
      () => fetch(result.baseUrl + '/', { signal: AbortSignal.timeout(2000) }),
      /fetch failed|ECONNREFUSED|connect/i,
      '冒烟结束后随机端口服务应已关闭',
    );
  });

  await t.test('404 与路径穿越防护生效', () => {
    const missing = result.checks.find((check) => check.path === '/src/ui/__missing-module__.js');
    assert.ok(missing);
    assert.equal(missing.status, 404);
    assert.match(missing.contentType, /^text\/html/);

    const traversal = result.checks.find((check) => check.path === '/..%2fpackage.json');
    assert.ok(traversal);
    assert.equal(traversal.status, 403);
    assert.match(traversal.contentType, /^text\/html/);
  });
});

test('scripts/smoke.mjs 可独立运行并以 0 退出', () => {
  const logFile = path.join(os.tmpdir(), 'schematic-studio-smoke-' + process.pid + '.log');
  const fd = fs.openSync(logFile, 'w');
  let result;
  try {
    result = spawnSync(process.execPath, [SCRIPT], {
      cwd: ROOT,
      stdio: ['ignore', fd, fd],
      timeout: 60000,
    });
  } finally {
    fs.closeSync(fd);
  }
  const output = fs.readFileSync(logFile, 'utf8');
  fs.rmSync(logFile, { force: true });
  assert.equal(result.error, undefined, '启动冒烟脚本失败：' + (result.error && result.error.message));
  assert.equal(result.status, 0, '冒烟脚本应成功退出：\n' + output);
  assert.match(output, /\[smoke\] 通过 \d+\/\d+ 项检查/);
  assert.doesNotMatch(output, /[smoke] FAIL/);
});
