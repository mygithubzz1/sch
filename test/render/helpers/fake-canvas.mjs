// 测试用 canvas 与 2D 上下文替身：记录绘制调用，不依赖真实浏览器。
export function createFakeContext() {
  const calls = [];
  const ctx = {
    canvas: null,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    save() {
      calls.push({ op: 'save' });
    },
    restore() {
      calls.push({ op: 'restore' });
    },
    setTransform(a, b, c, d, e, f) {
      calls.push({ op: 'setTransform', args: [a, b, c, d, e, f] });
    },
    fillRect(x, y, w, h) {
      calls.push({ op: 'fillRect', args: [x, y, w, h], fillStyle: this.fillStyle });
    },
    strokeRect(x, y, w, h) {
      calls.push({ op: 'strokeRect', args: [x, y, w, h], strokeStyle: this.strokeStyle, lineWidth: this.lineWidth });
    },
    clearRect(x, y, w, h) {
      calls.push({ op: 'clearRect', args: [x, y, w, h] });
    },
    beginPath() {
      calls.push({ op: 'beginPath' });
    },
    closePath() {
      calls.push({ op: 'closePath' });
    },
    moveTo(x, y) {
      calls.push({ op: 'moveTo', args: [x, y] });
    },
    lineTo(x, y) {
      calls.push({ op: 'lineTo', args: [x, y] });
    },
    quadraticCurveTo(cx, cy, x, y) {
      calls.push({ op: 'quadraticCurveTo', args: [cx, cy, x, y] });
    },
    arc(x, y, r, start, end, anticlockwise) {
      calls.push({ op: 'arc', args: [x, y, r, start, end, Boolean(anticlockwise)] });
    },
    rect(x, y, w, h) {
      calls.push({ op: 'rect', args: [x, y, w, h] });
    },
    fill() {
      calls.push({ op: 'fill', fillStyle: this.fillStyle });
    },
    stroke() {
      calls.push({ op: 'stroke', strokeStyle: this.strokeStyle, lineWidth: this.lineWidth });
    },
    fillText(text, x, y) {
      calls.push({ op: 'fillText', text: String(text), args: [x, y], font: this.font, fillStyle: this.fillStyle });
    },
    measureText(text) {
      const size = Number.parseFloat(this.font) || 10;
      return { width: String(text).length * size * 0.6 };
    },
    translate(x, y) {
      calls.push({ op: 'translate', args: [x, y] });
    },
    rotate(angle) {
      calls.push({ op: 'rotate', args: [angle] });
    },
    scale(x, y) {
      calls.push({ op: 'scale', args: [x, y] });
    },
    setLineDash(dash) {
      calls.push({ op: 'setLineDash', args: [Array.isArray(dash) ? dash.slice() : []] });
    },
  };
  return { ctx, calls };
}

export function createFakeCanvas(width = 800, height = 600) {
  const recorder = createFakeContext();
  const canvas = {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    style: {},
    getContext(type) {
      return type === '2d' ? recorder.ctx : null;
    },
  };
  recorder.ctx.canvas = canvas;
  return { canvas, ctx: recorder.ctx, calls: recorder.calls };
}

export function operations(calls, op) {
  return calls.filter((call) => call.op === op);
}

export function fillTexts(calls) {
  return operations(calls, 'fillText').map((call) => call.text);
}

export function indexOfOp(calls, predicate) {
  return calls.findIndex((call) => predicate(call));
}
