// 浏览器主流程验证：headless Chrome + CDP 驱动真实界面，覆盖示例/网表/导出/放置/连线/撤销/封装。
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = '/docs/review/browser-flow.html';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || null;
}

async function waitFor(check, label, timeoutMs = 15000, interval = 120) {
  const start = Date.now();
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // 继续等待
    }
    if (Date.now() - start > timeoutMs) throw new Error('超时: ' + label);
    await delay(interval);
  }
}

async function waitForFile(directory, before, pattern) {
  return waitFor(() => {
    const files = fs.readdirSync(directory).filter((name) => pattern.test(name));
    const fresh = files.filter((name) => !before.has(name));
    if (fresh.length === 0) return null;
    return fresh.map((name) => path.join(directory, name)).sort().pop();
  }, '下载文件 ' + pattern, 15000);
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('未找到 Chrome/Edge，请设置 CHROME_PATH');
    process.exitCode = 1;
    return;
  }

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-flow-dl-'));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-flow-profile-'));
  let chrome = null;
  let ws = null;
  let server = null;
  const failures = [];
  const passes = [];

  const check = (label, ok, detail = '') => {
    if (ok) passes.push(label + (detail ? ' — ' + detail : ''));
    else failures.push(label + (detail ? ' — ' + detail : ''));
    console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
  };

  try {
    server = createServer(ROOT);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const cdpPort = 9400 + Math.floor(Math.random() * 400);

    chrome = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=' + cdpPort,
      '--user-data-dir=' + profileDir,
      '--window-size=1680,1000',
      'about:blank',
    ], { stdio: 'ignore', windowsHide: true });

    await waitFor(async () => (await fetch('http://127.0.0.1:' + cdpPort + '/json/version')).ok, 'Chrome CDP');
    const target = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/new?about:blank', { method: 'PUT' })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    const consoleErrors = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
          else waiter.resolve(message.result);
        }
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params);
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') consoleErrors.push(message.params);
    });

    function send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }

    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error('页面脚本异常: ' + JSON.stringify(result.exceptionDetails).slice(0, 600));
      return result.result.value;
    }

    async function clickSelector(selector) {
      return evaluate('(() => { const node = document.querySelector(' + JSON.stringify(selector) + '); if (!node) return false; node.click(); return true; })()');
    }

    async function clickText(selector, text) {
      return evaluate('(() => { const nodes = [...document.querySelectorAll(' + JSON.stringify(selector) + ')];' +
        ' const node = nodes.find((item) => item.textContent.trim().includes(' + JSON.stringify(text) + '));' +
        ' if (!node) return false; node.click(); return true; })()');
    }

    async function clickModalButton(label) {
      const clicked = await evaluate('(() => { const modals = [...document.querySelectorAll(".modal")].filter((node) => node.getBoundingClientRect().width > 0);' +
        ' const modal = modals[modals.length - 1]; if (!modal) return false;' +
        ' const node = [...modal.querySelectorAll("button")].find((item) => item.textContent.trim().includes(' + JSON.stringify(label) + '));' +
        ' if (!node) return false; node.click(); return true; })()');
      await delay(250);
      return clicked;
    }

    async function canvasPoint(world, mode = 'schematic') {
      return evaluate('(() => { const app = window.__app;' +
        ' const editor = ' + JSON.stringify(mode) + " === 'footprint' ? app.getFootprintEditor() : app.getEditor();" +
        ' const canvas = ' + JSON.stringify(mode) + " === 'footprint' ? app.layout.footprintCanvas : app.layout.schematicCanvas;" +
        ' const renderer = editor.getRenderer(); const screen = renderer.worldToScreen(' + JSON.stringify(world) + ');' +
        ' const rect = canvas.getBoundingClientRect();' +
        ' return { x: rect.left + screen.x, y: rect.top + screen.y }; })()');
    }

    async function clickWorld(world, mode = 'schematic') {
      const point = await canvasPoint(world, mode);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
      await delay(120);
      return point;
    }

    async function pressKey(key, code = key, windowsVirtualKeyCode = 0) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
      await delay(120);
    }

    async function pinOfSymbol(symbolId, pinIndex) {
      return evaluate('(() => { const app = window.__app; const store = app.store; const sheet = store.getSheet();' +
        ' const instance = sheet.symbols.find((item) => item.symbolId === ' + JSON.stringify(symbolId) + ');' +
        ' if (!instance) return null; const project = store.getProject();' +
        ' const def = project.library.symbols.find((item) => item.id === instance.symbolId);' +
        ' if (!def || !def.pins[' + pinIndex + ']) return null; const pin = def.pins[' + pinIndex + '];' +
        ' return { x: instance.x + pin.x, y: instance.y + pin.y }; })()');
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir }).catch(() => {});
    await send('Page.navigate', { url: 'http://127.0.0.1:' + port + HARNESS });
    await waitFor(() => evaluate('window.__flowReady === true && !!window.__app'), '应用就绪');
    await delay(500);

    if (await evaluate("document.body.innerText.includes('欢迎使用原理图工作室')")) {
      await clickText('button', '开始使用');
      await delay(250);
    }

    // 1) 打开 LED 示例并生成网表
    await clickText('.menu-btn', '文件');
    await delay(150);
    await clickText('.menu-item', '打开示例：LED 指示灯');
    await waitFor(() => evaluate("window.__app.store.getProject().name === 'LED 指示灯'"), 'LED 示例载入');
    await clickText('.netlist-panel button', '生成网表');
    await delay(600);
    const summary = await evaluate("document.querySelector('.netlist-summary')?.innerText.replace(/\\n/g, ' ') || ''");
    check('打开 LED 示例 + 生成网表', summary.includes('网络 3') && summary.includes('引脚 6') && summary.includes('元件 4') && summary.includes('警告 0'), summary);
    const netNames = await evaluate("window.__app.getNetlist().nets.map((net) => net.name).sort().join(',')");
    check('网表网络集合 VCC/N$1/GND', netNames === 'GND,N$1,VCC', netNames);

    // 2) 导出 SVG（真实下载）
    const svgBefore = new Set(fs.readdirSync(downloadDir));
    await clickText('.menu-btn', '文件');
    await delay(150);
    await clickText('.menu-item', '导出 SVG');
    const svgFile = await waitForFile(downloadDir, svgBefore, /\.svg$/);
    const svgText = fs.readFileSync(svgFile, 'utf8');
    check('导出 SVG 真实产出', svgText.includes('<svg') && svgText.includes('#PWR01'), path.basename(svgFile));

    // 3) 新建工程：放置 R、C、GND，连线并自动 junction
    await clickText('.menu-btn', '文件');
    await delay(150);
    await clickText('.menu-item', '新建工程');
    await delay(200);
    if (await evaluate("!!document.querySelector('.modal')")) await clickText('.modal button', '新建空白工程');
    await waitFor(() => evaluate("window.__app.store.getSheet().symbols.length === 0"), '新建空白工程');
    await delay(300);

    await clickSelector('[data-symbol="R"]');
    await clickWorld({ x: 60.96, y: 50.8 });
    await clickSelector('[data-symbol="C"]');
    await clickWorld({ x: 78.74, y: 50.8 });
    await clickSelector('[data-symbol="GND"]');
    await clickWorld({ x: 73.66, y: 60.96 });
    await clickText('.tool-btn', '选择');
    await delay(200);
    const placed = await evaluate("window.__app.store.getSheet().symbols.map((item) => item.symbolId).sort().join(',')");
    check('放置 R/C/GND 三个符号', placed === 'C,GND,R', placed);

    await evaluate('window.__app.getEditor().fitToContent(48)');
    await delay(250);
    const rPin2 = await pinOfSymbol('R', 1);
    const cPin1 = await pinOfSymbol('C', 0);
    const gndPin = await pinOfSymbol('GND', 0);
    await clickText('.tool-btn', '导线');
    await clickWorld(rPin2);
    await clickWorld(cPin1);
    await pressKey('Enter', 'Enter', 13);
    await clickWorld(rPin2);
    await clickWorld(gndPin);
    await pressKey('Enter', 'Enter', 13);
    await delay(300);
    const wiring = await evaluate("({ wires: window.__app.store.getSheet().wires.length, junctions: window.__app.store.getSheet().junctions.length })");
    check('连线并自动生成 junction', wiring.wires >= 2 && wiring.junctions >= 1, JSON.stringify(wiring));

    // 4) 改位号/值/封装 + 撤销
    await clickText('.tool-btn', '选择');
    await clickWorld({ x: 60.96, y: 50.8 });
    await delay(250);
    await evaluate('(() => { const fields = [...document.querySelectorAll(".properties-panel .field")];' +
      ' const set = (label, value) => { const field = fields.find((item) => item.querySelector(".field-label")?.textContent.trim() === label);' +
      ' if (!field) return false; const control = field.querySelector("input, select"); control.value = value;' +
      ' control.dispatchEvent(new Event("change", { bubbles: true })); return true; };' +
      ' window.__setField = set; return set("位号", "R9") && set("值", "1k") && set("封装", "R_0603"); })()');
    await delay(250);
    const edited = await evaluate("(() => { const item = window.__app.store.getSheet().symbols.find((symbol) => symbol.designator === 'R9'); return item ? item.value + '/' + item.footprintId : 'missing'; })()");
    check('修改位号/值/封装', edited === '1k/R_0603', edited);
    await clickText('.toolbar .tool-btn', '撤销');
    await delay(150);
    await clickText('.toolbar .tool-btn', '撤销');
    await delay(150);
    await clickText('.toolbar .tool-btn', '撤销');
    await delay(250);
    const afterUndo = await evaluate("(() => { const item = window.__app.store.getSheet().symbols.find((symbol) => symbol.symbolId === 'R'); return item ? item.designator + '/' + item.value + '/' + item.footprintId : 'missing'; })()");
    check('撤销恢复位号/值/封装修改', afterUndo === 'R1/电阻/R_0805', String(afterUndo));

    // 5) 生成网表并导出 KiCad / CSV
    await clickText('.netlist-panel button', '生成网表');
    await delay(500);
    const kicadBefore = new Set(fs.readdirSync(downloadDir));
    await clickText('.toolbar .tool-btn', '导出');
    await waitFor(() => evaluate("!!document.querySelector('.modal .format-card')"), '导出对话框');
    await evaluate("document.querySelector('input[name=\"netlist-format\"][value=\"kicad\"]').click()");
    await delay(250);
    const kicadPreview = await evaluate("document.querySelector('.code-preview')?.textContent || ''");
    await clickModalButton('下载文件');
    await delay(600);
    const kicadFile = await waitForFile(downloadDir, kicadBefore, /\.net$/);
    const kicadText = fs.readFileSync(kicadFile, 'utf8');
    check('导出 KiCad 网表', kicadPreview.includes('(export') && kicadText.includes('(export'), path.basename(kicadFile));
    const csvBefore = new Set(fs.readdirSync(downloadDir));
    await evaluate("document.querySelector('input[name=\"netlist-format\"][value=\"csv\"]').click()");
    await delay(250);
    await clickModalButton('下载文件');
    const csvFile = await waitForFile(downloadDir, csvBefore, /\.csv$/);
    const csvText = fs.readFileSync(csvFile, 'utf8');
    check('导出 CSV 网表', csvText.split(/\r?\n/)[0] === 'designator,pin,name,net', path.basename(csvFile));
    await clickModalButton('关闭');
    await delay(200);

    // 6) 封装编辑器：进入、放置焊盘、退出
    await clickText('.tool-btn', '封装编辑');
    await waitFor(() => evaluate("window.__app.getMode() === 'footprint'"), '进入封装编辑');
    await delay(400);
    await clickText('.mode-bar .tool-btn', '焊盘');
    await delay(200);
    const padsBefore = await evaluate("window.__app.getFootprintEditor().getStore().getFootprint().pads.length");
    await clickWorld({ x: 0, y: 0 }, 'footprint');
    await delay(300);
    const padsAfter = await evaluate("window.__app.getFootprintEditor().getStore().getFootprint().pads.length");
    check('封装编辑器放置焊盘', padsAfter === padsBefore + 1, padsBefore + ' -> ' + padsAfter);

    await clickText('.mode-bar button', '返回原理图');
    await delay(300);
    if (await evaluate("!!document.querySelector('.modal')")) {
      await clickModalButton('退出并丢弃');
      await delay(400);
    }
    check('退出封装编辑', (await evaluate("window.__app.getMode()")) === 'schematic', await evaluate("window.__app.getMode()"));

    await send('Page.captureScreenshot', { format: 'png' }).then((shot) => {
      fs.writeFileSync(path.join(ROOT, 'docs/review/browser-main-flow.png'), Buffer.from(shot.data, 'base64'));
    });

    // 7) 控制台错误检查
    check('控制台 0 错误', consoleErrors.length === 0, 'errors=' + consoleErrors.length);
    if (consoleErrors.length > 0) {
      console.log('控制台错误详情：' + JSON.stringify(consoleErrors.slice(0, 3)).slice(0, 2000));
    }

    console.log('\n通过 ' + passes.length + '/' + (passes.length + failures.length) + ' 项');
    if (failures.length > 0) {
      console.log('失败项：\n- ' + failures.join('\n- '));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('流程执行失败: ' + (error && error.stack ? error.stack : error));
    process.exitCode = 1;
  } finally {
    try { ws && ws.close(); } catch { /* ignore */ }
    if (chrome) chrome.kill();
    if (server) await new Promise((resolve) => server.close(resolve));
    await delay(500);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

await main();