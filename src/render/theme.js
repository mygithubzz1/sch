// 深色专业主题：渲染器只允许从主题取色，禁止在绘制代码中硬编码颜色。
export const DEFAULT_THEME = Object.freeze({
  background: '#121821',
  grid: '#1e2833',
  gridMajor: '#2b3948',
  wire: '#5ad08a',
  junction: '#5ad08a',
  symbol: '#d7e2ee',
  symbolFill: '#1b2530',
  symbolText: '#c9d5e3',
  pin: '#93a4b8',
  pinText: '#7f8fa3',
  label: '#69b7ff',
  labelGlobal: '#ffb454',
  text: '#c9d5e3',
  reference: '#dbe6f2',
  value: '#9fb0c4',
  selection: '#3d9bff',
  selectionFill: 'rgba(61, 155, 255, 0.14)',
  hover: '#ffd166',
  hoverFill: 'rgba(255, 209, 102, 0.12)',
  padTop: '#e5484d',
  padBottom: '#3b82f6',
  padThru: '#22c55e',
  padDrill: '#0a0e13',
  padStroke: '#0a0e13',
  padText: '#ffffff',
  silk: '#e5edf5',
  courtyard: '#a78bfa',
  assembly: '#ffb454',
  fab: '#7f8fa3',
  origin: '#ff8f5a',
  titleBarBg: '#0d131a',
  titleBarBorder: '#2b3948',
  titleBarText: '#d7e2ee',
  titleBarMuted: '#7f8fa3',
  fontFamily: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif",
  fontSize: 1.27,
  pinTextSize: 1,
});

/** 契约要求的主题键，测试与导出器可据此校验主题完整性。 */
export const THEME_KEYS = Object.freeze([
  'background', 'grid', 'gridMajor', 'wire', 'junction', 'symbol', 'symbolFill',
  'pin', 'pinText', 'label', 'labelGlobal', 'selection', 'hover',
  'padTop', 'padBottom', 'padDrill', 'silk', 'courtyard',
]);

/** 以默认主题为底合并覆盖项，返回全新主题对象（不修改 DEFAULT_THEME）。 */
export function createTheme(overrides = {}) {
  const merged = { ...DEFAULT_THEME };
  if (overrides && typeof overrides === 'object') {
    for (const key of Object.keys(overrides)) {
      if (overrides[key] !== undefined) merged[key] = overrides[key];
    }
  }
  return merged;
}

/** 读取主题色；缺失时回退到默认主题，避免 undefined 传入 canvas。 */
export function themeColor(theme, key) {
  if (theme && typeof theme[key] === 'string' && theme[key] !== '') return theme[key];
  return DEFAULT_THEME[key];
}
