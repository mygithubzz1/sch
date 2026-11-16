// 服务器冒烟脚本：用 server.mjs 的 createServer 在随机端口启动，逐个请求页面与模块资源，
// 断言状态码、Content-Type 与响应体字节，最后关闭服务器。用法：node scripts/smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../server.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(MODULE_DIR, '..');

/** 冒烟必须覆盖的关键资源（页面、入口、样式与示例数据）。 */
export const REQUIRED_PATHS = Object.freeze([
  '/',
  '/index.html',
  '/src/main.js',
  '/src/ui/styles.css',
  '/src/ui/app.js',
  '/src/editor/index.js',
  '/examples/demo-led.json',
  '/examples/demo-mcu.json',
]);

/** 反向检查：不存在的模块应 404，路径穿越应 403。 */
export const NEGATIVE_CHECKS = Object.freeze([
  { path: '/src/ui/__missing-module__.js', status: 404, contentType: /^text\/html/ },
  { path: '/..%2fpackage.json', status: 403, contentType: /^text\/html/ },
]);

const CONTENT_TYPE_BY_EXTENSION = Object.freeze({
  '.html': /^text\/html/,
  '.js': /^text\/javascript/,
  '.css': /^text\/css/,
  '.json': /^application\/json/,
  '.svg': /^image\/svg\+xml/,
  '.png': /^image\/png/,
});

function walkFiles(directory, extension) {
  const result = [];
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(full, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) result.push(full);
  }
  return result.sort();
}

function toUrlPath(rootDir, file) {
  return '/' + path.relative(rootDir, file).split(path.sep).join('/');
}

/** 本地 URL 路径 -> 磁盘文件（/ 映射 index.html）。 */
export function localFileFor(rootDir, urlPath) {
  const clean = decodeURIComponent(String(urlPath || '/').split('?')[0].split('#')[0]);
  const segments = clean.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) return path.join(rootDir, 'index.html');
  return path.join(rootDir, ...segments);
}

/** 冒烟请求清单：关键资源 + src 下全部模块 + examples 下全部 JSON。 */
export function smokePaths(rootDir = ROOT) {
  const paths = new Set(REQUIRED_PATHS);
  for (const file of walkFiles(path.join(rootDir, 'src'), '.js')) paths.add(toUrlPath(rootDir, file));
  for (const file of walkFiles(path.join(rootDir, 'examples'), '.json')) paths.add(toUrlPath(rootDir, file));
  for (const check of NEGATIVE_CHECKS) paths.delete(check.path);
  return [...paths].sort();
}

async function request(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { response, buffer };
}

async function checkStaticAsset(fetchImpl, baseUrl, rootDir, urlPath) {
  const localPath = localFileFor(rootDir, urlPath);
  const expectedType = CONTENT_TYPE_BY_EXTENSION[path.extname(localPath).toLowerCase()] || null;
  const check = {
    path: urlPath,
    kind: 'asset',
    expectedStatus: 200,
    status: 0,
    contentType: '',
    cacheControl: '',
    bytes: 0,
    contentMatches: false,
    ok: false,
    reason: '',
  };
  try {
    const { response, buffer } = await request(fetchImpl, baseUrl + urlPath);
    check.status = response.status;
    check.contentType = response.headers.get('content-type') || '';
    check.cacheControl = response.headers.get('cache-control') || '';
    check.bytes = buffer.length;
    const expectedBytes = fs.readFileSync(localPath);
    check.contentMatches = buffer.equals(expectedBytes);
    const problems = [];
    if (check.status !== 200) problems.push('期望 200，实际 ' + check.status);
    if (expectedType && !expectedType.test(check.contentType)) {
      problems.push('Content-Type 不符：' + (check.contentType || '(空)'));
    }
    if (!check.contentMatches) {
      problems.push('响应体与磁盘文件不一致（' + buffer.length + ' vs ' + expectedBytes.length + ' 字节）');
    }
    if (check.cacheControl !== 'no-store') problems.push('缺少 Cache-Control: no-store');
    check.ok = problems.length === 0;
    check.reason = problems.join('；');
  } catch (error) {
    check.reason = '请求失败：' + (error && error.message ? error.message : String(error));
  }
  return check;
}

async function checkNegative(fetchImpl, baseUrl, item) {
  const check = {
    path: item.path,
    kind: 'negative',
    expectedStatus: item.status,
    status: 0,
    contentType: '',
    cacheControl: '',
    bytes: 0,
    contentMatches: true,
    ok: false,
    reason: '',
  };
  try {
    const { response, buffer } = await request(fetchImpl, baseUrl + item.path);
    check.status = response.status;
    check.contentType = response.headers.get('content-type') || '';
    check.bytes = buffer.length;
    const problems = [];
    if (check.status !== item.status) problems.push('期望 ' + item.status + '，实际 ' + check.status);
    if (item.contentType && !item.contentType.test(check.contentType)) {
      problems.push('Content-Type 不符：' + (check.contentType || '(空)'));
    }
    check.ok = problems.length === 0;
    check.reason = problems.join('；');
  } catch (error) {
    check.reason = '请求失败：' + (error && error.message ? error.message : String(error));
  }
  return check;
}

/**
 * 启动随机端口的静态服务器，逐项请求并断言，最后关闭服务器。
 * @param {{rootDir?: string, fetchImpl?: Function}} [options] 站点根目录与 fetch 实现
 * @returns {Promise<{ok: boolean, baseUrl: string, durationMs: number, total: number, passed: number, failed: number, checks: object[]}>}
 */
export async function runSmoke(options = {}) {
  const rootDir = path.resolve(options.rootDir || ROOT);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('runSmoke 需要可用的 fetch 实现');
  const startedAt = Date.now();
  const server = createServer(rootDir);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = 'http://127.0.0.1:' + port;
  const checks = [];
  try {
    for (const urlPath of smokePaths(rootDir)) {
      checks.push(await checkStaticAsset(fetchImpl, baseUrl, rootDir, urlPath));
    }
    for (const item of NEGATIVE_CHECKS) {
      checks.push(await checkNegative(fetchImpl, baseUrl, item));
    }
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
  }
  const failedChecks = checks.filter((check) => !check.ok);
  return {
    ok: failedChecks.length === 0,
    baseUrl,
    durationMs: Date.now() - startedAt,
    total: checks.length,
    passed: checks.length - failedChecks.length,
    failed: failedChecks.length,
    checks,
  };
}

function isEntryPoint() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return entry !== '' && entry === path.resolve(fileURLToPath(import.meta.url));
}

if (isEntryPoint()) {
  const result = await runSmoke();
  for (const check of result.checks) {
    if (!check.ok) console.error('[smoke] FAIL ' + check.path + ' -> ' + check.reason);
  }
  if (result.ok) {
    console.log('[smoke] 通过 ' + result.passed + '/' + result.total + ' 项检查（' + result.durationMs + 'ms）');
    console.log('[smoke] 服务器地址 ' + result.baseUrl);
  } else {
    console.error('[smoke] 失败 ' + result.failed + '/' + result.total + ' 项检查');
    process.exitCode = 1;
  }
}
