// 标题栏绘制：屏幕空间右下角的工程 / 图纸 / 版本信息块。
import { DEFAULT_THEME, themeColor } from './theme.js';

export const TITLE_BAR_HEIGHT = 78;
const TITLE_BAR_MAX_WIDTH = 320;
const TITLE_BAR_MARGIN = 12;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clipText(ctx, text, maxWidth, family) {
  const value = typeof text === 'string' ? text : String(text === undefined ? '' : text);
  if (!(maxWidth > 0)) return '';
  if (typeof ctx.measureText !== 'function') return value;
  if (ctx.measureText(value).width <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && ctx.measureText(result + '…').width > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + '…';
}

/**
 * 绘制标题栏；options: { width, height, theme, project, sheet, visible }。
 * 返回是否实际绘制（视口过小或被关闭时返回 false）。
 */
export function drawTitleBar(ctx, options = {}) {
  if (!ctx || options.visible === false) return false;
  const width = toNumber(options.width, 0);
  const height = toNumber(options.height, 0);
  const boxWidth = Math.min(TITLE_BAR_MAX_WIDTH, width - TITLE_BAR_MARGIN * 2);
  if (boxWidth < 160 || height < 140) return false;
  const theme = options.theme || DEFAULT_THEME;
  const family = themeColor(theme, 'fontFamily');
  const boxHeight = TITLE_BAR_HEIGHT;
  const x = width - boxWidth - TITLE_BAR_MARGIN;
  const y = height - boxHeight - TITLE_BAR_MARGIN;
  const sheet = options.sheet || null;
  const project = options.project || null;
  const title = sheet && sheet.title ? sheet.title : {};
  const projectName = project && project.name ? project.name : '未命名工程';
  const sheetName = sheet && sheet.name ? sheet.name : '图纸';
  const maxTextWidth = boxWidth - 24;

  ctx.save();
  ctx.fillStyle = themeColor(theme, 'titleBarBg');
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.strokeStyle = themeColor(theme, 'titleBarBorder');
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1);
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 30.5);
  ctx.lineTo(x + boxWidth - 12, y + 30.5);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '13px ' + family;
  ctx.fillStyle = themeColor(theme, 'titleBarText');
  ctx.fillText(clipText(ctx, projectName + ' / ' + sheetName, maxTextWidth), x + 12, y + 22);

  ctx.font = '12px ' + family;
  const heading = title.title || sheetName;
  ctx.fillText(clipText(ctx, heading, maxTextWidth), x + 12, y + 48);

  const meta = [];
  if (title.rev) meta.push('REV ' + title.rev);
  if (title.date) meta.push(title.date);
  if (title.company) meta.push(title.company);
  ctx.font = '11px ' + family;
  ctx.fillStyle = themeColor(theme, 'titleBarMuted');
  ctx.fillText(clipText(ctx, meta.join('   '), maxTextWidth), x + 12, y + 66);
  ctx.restore();
  return true;
}
