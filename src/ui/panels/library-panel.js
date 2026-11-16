// 元件库面板：符号搜索/分类/缩略图放置，以及封装库列表与新建/编辑入口。
import { drawSymbol, symbolBBox } from '../../render/symbols.js';
import { FootprintRenderer } from '../../render/footprint-renderer.js';
import { el, clear } from '../dom.js';
import { iconNode } from '../icons.js';
import { footprintRows, groupedSymbols } from '../view-model.js';

function drawSymbolThumbnail(canvas, symbolDef, theme) {
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx || !symbolDef) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  let box = null;
  try {
    box = symbolBBox(symbolDef, { x: 0, y: 0 });
  } catch {
    box = null;
  }
  if (!box || !(box.w > 0) || !(box.h > 0)) return;
  const pad = 7;
  const scale = Math.min((width - pad * 2) / box.w, (height - pad * 2) / box.h);
  if (!(scale > 0)) return;
  const offsetX = (width - box.w * scale) / 2 - box.x * scale;
  const offsetY = (height - box.h * scale) / 2 - box.y * scale;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawSymbol(ctx, symbolDef, { x: 0, y: 0, rotation: 0 }, theme, {
    scale,
    showPinNames: false,
    showPinNumbers: false,
    showGraphicsText: true,
  });
  ctx.restore();
}

function drawFootprintThumbnail(canvas, footprintDef, theme) {
  if (!footprintDef) return;
  try {
    const renderer = new FootprintRenderer(canvas, { theme, titleBar: false, width: canvas.width, height: canvas.height });
    renderer.setState({ footprint: footprintDef });
    renderer.fitToContent(6);
    renderer.render(true);
    renderer.destroy();
  } catch {
    // 缩略图绘制失败不影响列表可用性。
  }
}

/**
 * 创建元件库面板。
 * @param {object} config { getSymbols, getFootprints, onPlaceSymbol, onEditFootprint, onNewFootprint, theme }
 * @returns {object} 面板 API
 */
export function createLibraryPanel(config = {}) {
  const getSymbols = typeof config.getSymbols === 'function' ? config.getSymbols : () => [];
  const getFootprints = typeof config.getFootprints === 'function' ? config.getFootprints : () => [];
  const onPlaceSymbol = typeof config.onPlaceSymbol === 'function' ? config.onPlaceSymbol : () => {};
  const onEditFootprint = typeof config.onEditFootprint === 'function' ? config.onEditFootprint : () => {};
  const onNewFootprint = typeof config.onNewFootprint === 'function' ? config.onNewFootprint : () => {};
  const theme = config.theme;
  const themeConfig = theme || {};

  let tab = 'symbols';
  let query = '';
  let selectedSymbolId = null;

  const countBadge = el('span', { class: 'badge' });
  const searchInput = el('input', {
    class: 'input search-input',
    attrs: { type: 'search', placeholder: '搜索符号…', 'aria-label': '搜索元件库' },
  });
  const symbolTab = el('button', { class: 'seg-btn', attrs: { type: 'button', role: 'tab' }, text: '符号' });
  const footprintTab = el('button', { class: 'seg-btn', attrs: { type: 'button', role: 'tab' }, text: '封装' });
  const symbolView = el('div', { class: 'library-view symbol-view' });
  const footprintView = el('div', { class: 'library-view footprint-view', hidden: true });
  const hint = el('span', { class: 'panel-hint', text: '点击符号后到画布放置' });
  const newFootprintButton = el('button', {
    class: 'btn btn-ghost btn-sm',
    attrs: { type: 'button' },
  }, [iconNode('plus'), el('span', { text: '新建封装' })]);
  const footer = el('footer', { class: 'panel-footer library-footer' }, [newFootprintButton, hint]);

  const element = el('aside', { class: 'panel library-panel', attrs: { 'aria-label': '元件库' } }, [
    el('header', { class: 'panel-header' }, [
      el('h2', { class: 'panel-title', text: '元件库' }),
      countBadge,
    ]),
    el('div', { class: 'panel-tools' }, [
      el('div', { class: 'search-box' }, [iconNode('search'), searchInput]),
    ]),
    el('div', { class: 'seg-tabs', attrs: { role: 'tablist', 'aria-label': '库类型' } }, [symbolTab, footprintTab]),
    el('div', { class: 'panel-scroll library-scroll' }, [symbolView, footprintView]),
    footer,
  ]);

  function applyTab() {
    const symbolsActive = tab === 'symbols';
    symbolTab.classList.toggle('is-active', symbolsActive);
    footprintTab.classList.toggle('is-active', !symbolsActive);
    symbolTab.setAttribute('aria-selected', symbolsActive ? 'true' : 'false');
    footprintTab.setAttribute('aria-selected', symbolsActive ? 'false' : 'true');
    symbolView.hidden = !symbolsActive;
    footprintView.hidden = symbolsActive;
    searchInput.placeholder = symbolsActive ? '搜索符号…' : '搜索封装…';
    newFootprintButton.hidden = symbolsActive;
    hint.textContent = symbolsActive ? '点击符号后到画布放置' : '选择封装进行编辑或新建';
    countBadge.textContent = String(symbolsActive ? getSymbols().length : getFootprints().length);
  }

  function renderSymbols() {
    clear(symbolView);
    const groups = groupedSymbols(getSymbols(), query);
    if (groups.length === 0) {
      symbolView.appendChild(el('div', { class: 'empty-state' }, [
        iconNode('search'),
        el('p', { text: query ? '没有匹配的符号' : '符号库为空' }),
        query ? el('button', {
          class: 'btn btn-ghost btn-sm',
          attrs: { type: 'button' },
          text: '清除搜索',
          on: { click: () => setQuery('') },
        }) : null,
      ]));
      return;
    }
    for (const group of groups) {
      const grid = el('div', { class: 'symbol-grid' });
      for (const symbol of group.items) {
        const canvas = el('canvas', { class: 'symbol-thumb', attrs: { width: 76, height: 50, 'aria-hidden': 'true' } });
        const card = el('button', {
          class: 'symbol-card' + (symbol.id === selectedSymbolId ? ' is-selected' : ''),
          attrs: { type: 'button', title: symbol.description || symbol.name || symbol.id, 'data-symbol': symbol.id },
          on: {
            click: () => {
              selectedSymbolId = symbol.id;
              for (const node of symbolView.querySelectorAll('.symbol-card.is-selected')) node.classList.remove('is-selected');
              card.classList.add('is-selected');
              onPlaceSymbol(symbol.id);
            },
          },
        }, [
          canvas,
          el('span', { class: 'symbol-name', text: symbol.name || symbol.id }),
          el('span', { class: 'symbol-id', text: symbol.id }),
        ]);
        drawSymbolThumbnail(canvas, symbol, themeConfig);
        grid.appendChild(card);
      }
      symbolView.appendChild(el('section', { class: 'symbol-group' }, [
        el('h3', { class: 'symbol-group-title', text: group.label }),
        grid,
      ]));
    }
    if (selectedSymbolId) {
      const active = symbolView.querySelector('[data-symbol="' + selectedSymbolId + '"]');
      if (active) active.classList.add('is-selected');
    }
  }

  function renderFootprints() {
    clear(footprintView);
    const rows = footprintRows(getFootprints()).filter((row) => {
      const text = query.trim().toLowerCase();
      if (text === '') return true;
      return (row.id + ' ' + row.name + ' ' + row.description).toLowerCase().includes(text);
    });
    if (rows.length === 0) {
      footprintView.appendChild(el('div', { class: 'empty-state' }, [
        iconNode('footprint'),
        el('p', { text: query ? '没有匹配的封装' : '封装库为空' }),
      ]));
      return;
    }
    const list = el('div', { class: 'footprint-list' });
    for (const row of rows) {
      const canvas = el('canvas', { class: 'footprint-thumb', attrs: { width: 52, height: 42, 'aria-hidden': 'true' } });
      const def = getFootprints().find((item) => item && item.id === row.id);
      drawFootprintThumbnail(canvas, def, themeConfig);
      const editButton = el('button', {
        class: 'btn btn-ghost btn-xs',
        attrs: { type: 'button', title: '在封装编辑器中编辑' },
        text: '编辑',
        on: {
          click: (event) => {
            event.stopPropagation();
            onEditFootprint(row.id);
          },
        },
      });
      const rowNode = el('div', { class: 'footprint-row' }, [
        canvas,
        el('div', { class: 'footprint-meta' }, [
          el('span', { class: 'footprint-name', text: row.name }),
          el('span', { class: 'footprint-sub', text: row.id + ' · ' + row.padCount + ' 焊盘' }),
        ]),
        editButton,
      ]);
      list.appendChild(rowNode);
    }
    footprintView.appendChild(list);
  }

  function refresh() {
    applyTab();
    if (tab === 'symbols') renderSymbols();
    else renderFootprints();
  }

  function setQuery(value) {
    query = typeof value === 'string' ? value : '';
    if (searchInput.value !== query) searchInput.value = query;
    refresh();
  }

  function setTab(nextTab) {
    tab = nextTab === 'footprints' ? 'footprints' : 'symbols';
    refresh();
  }

  function setSelectedSymbol(symbolId) {
    selectedSymbolId = typeof symbolId === 'string' ? symbolId : null;
    refresh();
  }

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    refresh();
  });
  symbolTab.addEventListener('click', () => setTab('symbols'));
  footprintTab.addEventListener('click', () => setTab('footprints'));
  newFootprintButton.addEventListener('click', () => onNewFootprint());

  refresh();

  return {
    element,
    refresh,
    setTab,
    getTab: () => tab,
    setQuery,
    getQuery: () => query,
    focusSearch() {
      try {
        searchInput.focus();
        searchInput.select();
      } catch {
        // 忽略聚焦失败。
      }
    },
    setSelectedSymbol,
    getSelectedSymbol: () => selectedSymbolId,
    destroy() {
      clear(symbolView);
      clear(footprintView);
    },
  };
}
