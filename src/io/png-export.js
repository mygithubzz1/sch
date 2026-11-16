// PNG 导出：基于 canvas.toBlob 的 Promise；导出前按 scale 临时放大，finally 中恢复原始尺寸与内容。
export const DEFAULT_PNG_SCALE = 2;
export const MIN_PNG_SCALE = 0.1;
export const MAX_PNG_SCALE = 8;

function resolveScale(value) {
  const number = Number(value === undefined ? DEFAULT_PNG_SCALE : value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError('exportSheetPNG 的 scale 必须为正数');
  }
  return Math.min(Math.max(number, MIN_PNG_SCALE), MAX_PNG_SCALE);
}

function resolveCreateCanvas(options) {
  if (typeof options.createCanvas === 'function') return options.createCanvas;
  try {
    if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
      return (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      };
    }
  } catch {
    // 非浏览器环境：交给调用方注入 createCanvas。
  }
  return null;
}

function prepareContext(ctx) {
  if (!ctx || typeof ctx.drawImage !== 'function') return null;
  ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/**
 * 把 canvas 转为 Blob 的 Promise；toBlob 不可用或返回空时 reject。
 * @param {object} canvas 画布
 * @param {string} [type] MIME
 * @param {number} [quality] 质量
 * @returns {Promise<Blob>}
 */
export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== 'function') {
      reject(new Error('canvas.toBlob 不可用，无法导出 PNG'));
      return;
    }
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob 未返回数据'));
      }, type, quality);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 导出 PNG：临时放大源画布 -> 绘制快照 -> toBlob -> 恢复原尺寸与画面。
 * @param {object} canvas 原理图/封装画布
 * @param {number} [scale] 输出倍率（0.1~8，默认 2）
 * @param {{createCanvas?: Function, type?: string, quality?: number}} [options]
 * @returns {Promise<Blob>} PNG Blob
 */
export async function exportSheetPNG(canvas, scale = DEFAULT_PNG_SCALE, options = {}) {
  if (!canvas || typeof canvas !== 'object') {
    throw new TypeError('exportSheetPNG 需要 canvas 对象');
  }
  const originalWidth = Math.round(Number(canvas.width));
  const originalHeight = Math.round(Number(canvas.height));
  if (!(originalWidth > 0) || !(originalHeight > 0)) {
    throw new TypeError('exportSheetPNG 的 canvas 尺寸无效');
  }
  const factor = resolveScale(scale);
  const targetWidth = Math.max(1, Math.round(originalWidth * factor));
  const targetHeight = Math.max(1, Math.round(originalHeight * factor));
  const createCanvas = resolveCreateCanvas(options);
  if (!createCanvas) {
    throw new Error('exportSheetPNG 需要浏览器环境（document 不可用）或 options.createCanvas');
  }

  const snapshot = createCanvas(originalWidth, originalHeight);
  const snapshotContext = prepareContext(
    snapshot && typeof snapshot.getContext === 'function' ? snapshot.getContext('2d') : null,
  );
  if (!snapshotContext) throw new Error('exportSheetPNG 无法创建快照画布');
  snapshotContext.drawImage(canvas, 0, 0, originalWidth, originalHeight);

  try {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = prepareContext(
      typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null,
    );
    if (!context) throw new Error('exportSheetPNG 无法获取 canvas 2D 上下文');
    context.drawImage(snapshot, 0, 0, originalWidth, originalHeight, 0, 0, targetWidth, targetHeight);
    return await canvasToBlob(canvas, options.type || 'image/png', options.quality);
  } finally {
    canvas.width = originalWidth;
    canvas.height = originalHeight;
    const restoreContext = prepareContext(
      typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null,
    );
    if (restoreContext) {
      restoreContext.drawImage(snapshot, 0, 0, originalWidth, originalHeight, 0, 0, originalWidth, originalHeight);
    }
  }
}
