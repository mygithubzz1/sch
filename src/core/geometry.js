// 二维几何纯函数：点/向量运算、矩形判断与符号变换，供所有层共享。
export const EPSILON = 1e-9;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 创建一个点。 */
export function pt(x = 0, y = 0) {
  return { x: toNumber(x), y: toNumber(y) };
}

/** 向量相加。 */
export function add(a, b) {
  return { x: toNumber(a.x) + toNumber(b.x), y: toNumber(a.y) + toNumber(b.y) };
}

/** 向量相减。 */
export function sub(a, b) {
  return { x: toNumber(a.x) - toNumber(b.x), y: toNumber(a.y) - toNumber(b.y) };
}

/** 向量缩放。 */
export function scale(a, k) {
  const factor = toNumber(k);
  return { x: toNumber(a.x) * factor, y: toNumber(a.y) * factor };
}

/** 两点距离。 */
export function dist(a, b) {
  return Math.hypot(toNumber(a.x) - toNumber(b.x), toNumber(a.y) - toNumber(b.y));
}

/** 向量长度。 */
export function len(a) {
  return Math.hypot(toNumber(a.x), toNumber(a.y));
}

/** 把标量吸附到栅格；栅格非正时原样返回。 */
export function snapV(v, grid) {
  const value = toNumber(v);
  const step = toNumber(grid);
  if (!(step > 0)) return value;
  const snapped = Math.round(value / step) * step;
  return Math.abs(snapped) < EPSILON ? 0 : snapped;
}

/** 把点吸附到栅格。 */
export function snapPt(p, grid) {
  return { x: snapV(p.x, grid), y: snapV(p.y, grid) };
}

/** 绕原点（默认）旋转一个点，角度单位为度，90 的倍数使用精确结果。 */
export function rotatePoint(p, deg = 0, origin = { x: 0, y: 0 }) {
  const center = origin || { x: 0, y: 0 };
  const dx = toNumber(p.x) - toNumber(center.x);
  const dy = toNumber(p.y) - toNumber(center.y);
  const normalized = normalizeDeg(deg);

  if (normalized === 0) return { x: center.x + dx, y: center.y + dy };
  if (normalized === 90) return { x: center.x - dy, y: center.y + dx };
  if (normalized === 180) return { x: center.x - dx, y: center.y - dy };
  if (normalized === 270) return { x: center.x + dy, y: center.y - dx };

  const radians = (normalized * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: toNumber(center.x) + dx * cos - dy * sin,
    y: toNumber(center.y) + dx * sin + dy * cos,
  };
}

/** 沿垂直轴（Y 轴）镜像一个点，保持 y 不变。 */
export function mirrorPoint(p, origin = { x: 0, y: 0 }) {
  const center = origin || { x: 0, y: 0 };
  return { x: 2 * toNumber(center.x) - toNumber(p.x), y: toNumber(p.y) };
}

/** 点到线段的最短距离。 */
export function segmentDistance(p, a, b) {
  const ax = toNumber(a.x);
  const ay = toNumber(a.y);
  const bx = toNumber(b.x);
  const by = toNumber(b.y);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq < EPSILON) {
    return dist(p, { x: ax, y: ay });
  }

  const t = Math.max(0, Math.min(1, ((toNumber(p.x) - ax) * dx + (toNumber(p.y) - ay) * dy) / lengthSq));
  return dist(p, { x: ax + t * dx, y: ay + t * dy });
}

/** 点是否落在矩形内（含边界，支持负宽高）。 */
export function pointInRect(p, rect) {
  const box = rectFromPoints({ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h });
  const x = toNumber(p.x);
  const y = toNumber(p.y);
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

/** 由两个角点构造规范矩形。 */
export function rectFromPoints(a, b) {
  const ax = toNumber(a.x);
  const ay = toNumber(a.y);
  const bx = toNumber(b.x);
  const by = toNumber(b.y);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/** 两个矩形是否相交（含相切，支持负宽高）。 */
export function rectsIntersect(a, b) {
  const first = rectFromPoints({ x: a.x, y: a.y }, { x: toNumber(a.x) + toNumber(a.w), y: toNumber(a.y) + toNumber(a.h) });
  const second = rectFromPoints({ x: b.x, y: b.y }, { x: toNumber(b.x) + toNumber(b.w), y: toNumber(b.y) + toNumber(b.h) });
  return (
    first.x <= second.x + second.w &&
    first.x + first.w >= second.x &&
    first.y <= second.y + second.h &&
    first.y + first.h >= second.y
  );
}

/** 点集包围盒；空集返回零矩形。 */
export function bboxOfPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) continue;
    minX = Math.min(minX, Number(point.x));
    minY = Math.min(minY, Number(point.y));
    maxX = Math.max(maxX, Number(point.x));
    maxY = Math.max(maxY, Number(point.y));
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 依次应用 mirror -> rotate(deg) -> translate，返回变换后的点。 */
export function transformPoint(p, transform = {}) {
  const mirror = Boolean(transform.mirror);
  const rotation = toNumber(transform.rotation);
  const mirrored = mirror ? mirrorPoint(p) : pt(p.x, p.y);
  const rotated = rotatePoint(mirrored, rotation);
  return { x: rotated.x + toNumber(transform.x), y: rotated.y + toNumber(transform.y) };
}

/** 把角度规范化到 [0, 360)。 */
export function normalizeDeg(deg) {
  const value = toNumber(deg);
  const wrapped = ((value % 360) + 360) % 360;
  return Math.abs(wrapped - 360) < EPSILON ? 0 : wrapped;
}

/** 数值夹取。 */
export function clamp(value, min, max) {
  return Math.min(Math.max(toNumber(value), min), max);
}

/** 按位数四舍五入，仅用于消除浮点噪声。 */
export function round(value, digits = 6) {
  const factor = Math.pow(10, digits);
  return Math.round(toNumber(value) * factor) / factor;
}
