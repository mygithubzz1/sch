// 脚手架冒烟测试：校验静态服务器、入口外壳、包配置与文档是否符合任务契约。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, createServer, contentTypeFor, resolveHost, resolveRequestPath, startServer } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

async function withServer(run) {
  const server = createServer(ROOT);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(server);
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    });
  }
}

function request(server, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request(
      { host: '127.0.0.1', port: address.port, path: requestPath, method, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('package.json 为零依赖 ES 模块工程', () => {
  const pkg = JSON.parse(readText('package.json'));
  assert.equal(pkg.name, 'schematic-studio');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.start, 'node server.mjs');
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test('index.html 挂载 #app 与 src/main.js', () => {
  const html = readText('index.html');
  assert.match(html, /id="app"/);
  assert.match(html, /<script type="module" src="\.\/src\/main\.js"><\/script>/);
  assert.match(html, /<title>原理图工作室<\/title>/);
});

test('src/main.js 导出 bootstrap 函数', async () => {
  const mod = await import('../src/main.js');
  assert.equal(typeof mod.bootstrap, 'function');
  assert.equal(typeof mod.APP_VERSION, 'string');
});

test('docs 三份文档齐备且契约含关键小节', () => {
  for (const file of ['README.md', 'docs/ARCHITECTURE.md', 'docs/CONTRACTS.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), file + ' 应存在');
  }
  const contracts = readText('docs/CONTRACTS.md');
  for (const section of ['core/id.js', 'core/geometry.js', 'model/store.js', 'netlist/index.js', 'render/renderer.js', 'editor/schematic-editor.js', 'io/svg-export.js', 'ui']) {
    assert.ok(contracts.includes(section), '契约应包含 ' + section);
  }
});

test('createServer 返回未监听的 http.Server 实例', () => {
  const server = createServer(ROOT);
  assert.ok(server instanceof http.Server);
  assert.equal(server.listening, false);
  server.close();
});

test('contentTypeFor 覆盖 html/js/css/json/svg/png/ico/txt', () => {
  assert.match(contentTypeFor('a.html'), /^text\/html/);
  assert.match(contentTypeFor('a.js'), /^text\/javascript/);
  assert.match(contentTypeFor('a.css'), /^text\/css/);
  assert.match(contentTypeFor('a.json'), /^application\/json/);
  assert.match(contentTypeFor('a.svg'), /^image\/svg\+xml/);
  assert.equal(contentTypeFor('a.png'), 'image/png');
  assert.equal(contentTypeFor('a.ico'), 'image/x-icon');
  assert.match(contentTypeFor('a.txt'), /^text\/plain/);
});

test('根路径返回 index.html 且禁用缓存', async () => {
  await withServer(async (server) => {
    const res = await request(server, '/');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.body, /src\/main\.js/);
    assert.match(res.body, /原理图工作室/);
  });
});

test('静态资源按扩展名返回正确 MIME', async () => {
  await withServer(async (server) => {
    const res = await request(server, '/src/main.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/javascript/);
    assert.equal(res.headers['cache-control'], 'no-store');
  });
});

test('未知文件返回 404 与提示 HTML', async () => {
  await withServer(async (server) => {
    const res = await request(server, '/not-exists.html');
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.match(res.body, /404/);
  });
});

test('拒绝 .. 路径穿越', async () => {
  await withServer(async (server) => {
    const plain = await request(server, '/../package.json');
    assert.equal(plain.status, 403);
    const encoded = await request(server, '/..%2fpackage.json');
    assert.equal(encoded.status, 403);
    assert.doesNotMatch(plain.body, /"name":\s*"schematic-studio"/);
  });
});

test('resolveRequestPath 对非法路径返回错误状态', () => {
  assert.equal(resolveRequestPath(ROOT, '/../secret').ok, false);
  assert.equal(resolveRequestPath(ROOT, '/../secret').status, 403);
  assert.equal(resolveRequestPath(ROOT, '/%E0%A4%A').ok, false);
  assert.equal(resolveRequestPath(ROOT, '/%E0%A4%A').status, 400);
  const ok = resolveRequestPath(ROOT, '/src/main.js?cache=1');
  assert.equal(ok.ok, true);
  assert.ok(ok.filePath.endsWith(path.join('src', 'main.js')));
});

test('拒绝点开头的敏感路径且保留正常资源访问', async () => {
  for (const requestPath of ['/.git/config', '/.agent-teams/schematic-studio/team.json', '/.env', '/.gitignore', '/src/.hidden.js']) {
    const resolved = resolveRequestPath(ROOT, requestPath);
    assert.equal(resolved.ok, false, requestPath + ' 应被拒绝');
    assert.equal(resolved.status, 404, requestPath + ' 应返回 404');
  }

  await withServer(async (server) => {
    for (const requestPath of ['/.git/config', '/.agent-teams/schematic-studio/team.json', '/.env']) {
      const res = await request(server, requestPath);
      assert.equal(res.status, 404, requestPath + ' 不应可读');
      assert.doesNotMatch(res.body, /\[core\]|appId|SECRET/);
    }
    const source = await request(server, '/src/main.js');
    assert.equal(source.status, 200);
    const example = await request(server, '/examples/demo-led.json');
    assert.equal(example.status, 200);
    const image = await request(server, '/docs/images/app-overview.png');
    assert.equal(image.status, 200);
    assert.equal(image.headers['content-type'], 'image/png');
    const page = await request(server, '/index.html');
    assert.equal(page.status, 200);
  });
});

test('默认只监听回环地址，显式请求才放开', async () => {
  assert.equal(DEFAULT_HOST, '127.0.0.1');
  assert.equal(resolveHost({}), '127.0.0.1');
  assert.equal(resolveHost({ host: '' }), '127.0.0.1');
  assert.equal(resolveHost({ host: '0.0.0.0' }), '0.0.0.0');
  assert.equal(resolveHost({}, ['node', 'server.mjs', '--host', '0.0.0.0'], {}), '0.0.0.0');
  assert.equal(resolveHost({}, ['node', 'server.mjs', '--host=192.168.1.9'], {}), '192.168.1.9');
  assert.equal(resolveHost({}, [], { HOST: '10.0.0.2' }), '10.0.0.2');
  assert.equal(resolveHost({}, [], {}), DEFAULT_HOST);

  // quiet: true 关闭启动日志：测试进程的 stdout 只应包含 node:test 的结果帧，
  // 否则 startServer 的 console.log 会污染帧通道并触发 "Unable to deserialize cloned data"。
  const server = startServer({ port: 0, rootDir: ROOT, quiet: true });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const address = server.address();
    assert.equal(address.address, '127.0.0.1');
    assert.ok(address.port > 0);
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
  }
});

test('HEAD 请求返回响应头但无响应体', async () => {
  await withServer(async (server) => {
    const res = await request(server, '/index.html', 'HEAD');
    assert.equal(res.status, 200);
    assert.equal(res.body, '');
    assert.ok(Number(res.headers['content-length']) > 0);
  });
});

test('不支持的方法返回 405', async () => {
  await withServer(async (server) => {
    const res = await request(server, '/', 'POST');
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'GET, HEAD');
  });
});
