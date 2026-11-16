// 封装图层面板：选择图形图层/形状与焊盘层，并显示图层颜色图例。
import { FOOTPRINT_LAYERS } from '../../library/graphic.js';
import { PAD_LAYERS } from '../../library/footprint-library.js';
import { el } from '../dom.js';
import { themeColor } from '../../render/theme.js';
import { layerLabel } from '../view-model.js';

/**
 * 创建封装图层面板。
 * @param {object} config { theme, onGraphicLayer, onGraphicShape, onPadLayer }
 * @returns {object} 面板 API
 */
export function createLayersPanel(config = {}) {
  const theme = config.theme || {};
  const onGraphicLayer = typeof config.onGraphicLayer === 'function' ? config.onGraphicLayer : () => {};
  const onGraphicShape = typeof config.onGraphicShape === 'function' ? config.onGraphicShape : () => {};
  const onPadLayer = typeof config.onPadLayer === 'function' ? config.onPadLayer : () => {};

  const graphicLayer = el('select', { class: 'input', attrs: { 'aria-label': '图形图层' } },
    FOOTPRINT_LAYERS.map((layer) => el('option', { attrs: { value: layer }, text: layerLabel(layer) })));
  const graphicShape = el('select', { class: 'input', attrs: { 'aria-label': '图形形状' } }, [
    el('option', { attrs: { value: 'line' }, text: '直线 / 折线' }),
    el('option', { attrs: { value: 'rect' }, text: '矩形' }),
  ]);
  const padLayer = el('select', { class: 'input', attrs: { 'aria-label': '焊盘层' } },
    PAD_LAYERS.map((layer) => el('option', { attrs: { value: layer }, text: layerLabel(layer) })));

  const legend = el('div', { class: 'layer-legend' }, FOOTPRINT_LAYERS.map((layer) => {
    const key = layer === 'silkscreen' ? 'silk' : layer;
    const color = themeColor(theme, key);
    return el('span', { class: 'layer-chip' }, [
      el('span', { class: 'layer-dot', style: { background: color } }),
      el('span', { text: layerLabel(layer) }),
    ]);
  }));

  graphicLayer.addEventListener('change', () => onGraphicLayer(graphicLayer.value));
  graphicShape.addEventListener('change', () => onGraphicShape(graphicShape.value));
  padLayer.addEventListener('change', () => onPadLayer(padLayer.value));

  const element = el('section', { class: 'panel layers-panel', hidden: true, attrs: { 'aria-label': '封装图层' } }, [
    el('header', { class: 'panel-header' }, [
      el('h2', { class: 'panel-title', text: '封装图层' }),
      el('span', { class: 'badge', text: '封装' }),
    ]),
    el('div', { class: 'panel-body layers-body' }, [
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label', text: '图形图层' }),
        graphicLayer,
      ]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label', text: '图形形状' }),
        graphicShape,
      ]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label', text: '焊盘层' }),
        padLayer,
      ]),
      el('p', { class: 'field-hint', text: '快捷键：L 循环图层 · R 切换形状 · H 切换通孔 · 数字键 1-4 切换焊盘形状。' }),
      legend,
    ]),
  ]);

  function setState(state = {}) {
    if (typeof state.layer === 'string' && FOOTPRINT_LAYERS.includes(state.layer)) graphicLayer.value = state.layer;
    if (state.shape === 'line' || state.shape === 'rect') graphicShape.value = state.shape;
    if (typeof state.padLayer === 'string' && PAD_LAYERS.includes(state.padLayer)) padLayer.value = state.padLayer;
  }

  return {
    element,
    setVisible(visible) {
      if (visible) element.removeAttribute('hidden');
      else element.setAttribute('hidden', '');
    },
    setState,
    getState: () => ({ layer: graphicLayer.value, shape: graphicShape.value, padLayer: padLayer.value }),
  };
}
