// 零依赖静态文件服务器：为本地开发提供静态资源，并导出 createServer 供测试复用。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = MODULE_DIR;
const DEFAULT_PORT = 8080;
/** 默认只监听回环地址；需要局域网访问时必须显式 HOST / --host。 */
export const DEFAULT_HOST = '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const NOT_FOUND_PAGE = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>404 未找到 - 原理图工作室</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem">
<h1>404 未找到</h1>
<p>请求的资源不存在。</p>
<p><a href="/">返回主页</a></p>
</body>
</html>
`;

/**
 * 依据扩展名返回 Content-Type。
 * @param {string} filePath 文件路径
 * @returns {string} MIME 类型
 */
export function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * 判断目标绝对路径是否位于根目录之内（拒绝路径穿越）。
 * @param {string} rootDir 根目录绝对路径
 * @param {string} targetPath 目标绝对路径
 * @returns {boolean} 是否安全
 */
export function isPathInside(rootDir, targetPath) {
  const relative = path.relative(rootDir, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 把 URL 路径解析为根目录内的候选文件路径；非法输入返回 null。
 * 以点开头的路径段（.git、.agent-teams、.env、.vscode 等）一律视为不存在，返回 404。
 * @param {string} rootDir 根目录绝对路径
 * @param {string} url 原始请求地址
 * @returns {{ ok: boolean, status?: number, filePath?: string }}
 */
export function resolveRequestPath(rootDir, url) {
  const rawPath = String(url || '/').split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { ok: false, status: 400 };
  }
  if (decoded.includes('\0')) {
    return { ok: false, status: 400 };
  }
  const segments = decoded.split(/[\\/]+/);
  if (segments.some((segment) => segment === '..')) {
    return { ok: false, status: 403 };
  }
  if (segments.some((segment) => segment.length > 1 && segment.startsWith('.'))) {
    return { ok: false, status: 404 };
  }
  const normalized = path.posix.normalize(decoded);
  const relative = normalized.replace(/^[\\/]+/, '');
  const filePath = path.resolve(rootDir, relative);
  if (!isPathInside(rootDir, filePath)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, filePath };
}

function sendBuffer(res, method, status, headers, body) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Length': payload.length, ...headers });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(payload);
}

function sendNotFound(res, method) {
  sendBuffer(res, method, 404, { 'Content-Type': 'text/html; charset=utf-8' }, NOT_FOUND_PAGE);
}

function sendStatus(res, method, status, message) {
  const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${status}</title></head>` +
    `<body style="font-family:system-ui,sans-serif;padding:2rem"><h1>${status}</h1><p>${message}</p></body></html>`;
  sendBuffer(res, method, status, { 'Content-Type': 'text/html; charset=utf-8' }, page);
}

function statOrNull(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function handleRequest(req, res, rootDir) {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendStatus(res, method, 405, '仅支持 GET / HEAD 请求。');
    return;
  }

  const resolved = resolveRequestPath(rootDir, req.url);
  if (!resolved.ok) {
    if (resolved.status === 404) {
      sendNotFound(res, method);
      return;
    }
    sendStatus(res, method, resolved.status, resolved.status === 403 ? '禁止访问该路径。' : '请求地址无效。');
    return;
  }

  let filePath = resolved.filePath;
  const stats = statOrNull(filePath);

  if (stats && stats.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  const finalStats = stats && stats.isDirectory() ? statOrNull(filePath) : stats;
  if (!finalStats || !finalStats.isFile()) {
    sendNotFound(res, method);
    return;
  }

  let data;
  try {
    data = fs.readFileSync(filePath);
  } catch {
    sendStatus(res, method, 500, '读取文件失败。');
    return;
  }

  sendBuffer(res, method, 200, { 'Content-Type': contentTypeFor(filePath) }, data);
}

/**
 * 创建静态服务器实例（不自动监听）。
 * @param {string} [rootDir] 站点根目录，默认为本文件所在目录
 * @returns {import('node:http').Server} HTTP 服务器
 */
export function createServer(rootDir = DEFAULT_ROOT) {
  const resolvedRoot = path.resolve(rootDir);
  return http.createServer((req, res) => {
    try {
      handleRequest(req, res, resolvedRoot);
    } catch {
      if (!res.headersSent) {
        sendStatus(res, req.method, 500, '服务器内部错误。');
      } else {
        res.end();
      }
    }
  });
}

/** 从命令行参数解析 --host（支持 --host=127.0.0.1 与 --host 127.0.0.1）。 */
function parseHostArg(argv = process.argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg !== 'string') continue;
    if (arg.startsWith('--host=')) {
      const value = arg.slice('--host='.length).trim();
      if (value !== '') return value;
    } else if (arg === '--host') {
      const value = argv[index + 1];
      if (typeof value === 'string' && value.trim() !== '' && !value.startsWith('--')) return value.trim();
    }
  }
  return undefined;
}

/**
 * 解析监听地址：默认只监听回环，显式 options.host / --host / HOST 才放开。
 * @returns {string} 监听地址
 */
export function resolveHost(options = {}, argv = process.argv, env = process.env) {
  const explicit = typeof options.host === 'string' && options.host.trim() !== '' ? options.host.trim() : undefined;
  if (explicit) return explicit;
  const fromArgv = parseHostArg(argv);
  if (fromArgv) return fromArgv;
  const fromEnv = typeof env.HOST === 'string' ? env.HOST.trim() : '';
  return fromEnv !== '' ? fromEnv : DEFAULT_HOST;
}

/** 解析端口：显式 0 表示由系统分配临时端口。 */
export function resolvePort(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 65535 ? number : DEFAULT_PORT;
}

/**
 * 启动服务器并打印访问地址。
 * @param {{ port?: number, rootDir?: string, host?: string }} [options] 启动参数
 * @returns {import('node:http').Server} 已开始监听的服务器
 */
export function startServer(options = {}) {
  const port = resolvePort(options.port ?? process.env.PORT);
  const rootDir = options.rootDir ?? DEFAULT_ROOT;
  const host = resolveHost(options);
  const server = createServer(rootDir);
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
    console.log(`原理图工作室 dev server 已启动: http://${displayHost}:${actualPort}`);
    console.log(`静态根目录: ${path.resolve(rootDir)}`);
    if (host !== DEFAULT_HOST) console.log('警告: 已监听非回环地址，局域网内可访问。');
  });
  return server;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath && entryPath === path.resolve(fileURLToPath(import.meta.url))) {
  startServer();
}
