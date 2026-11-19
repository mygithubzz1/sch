// 网表面板：生成/导出入口、网络与引脚列表、ERC 警告列表与定位交互。
import { el, clear } from '../dom.js';
import { iconNode } from '../icons.js';
import { netlistSummary, netRows, warningRows, warningTarget } from '../view-model.js';

function messageOf(error) {
  return error && typeof error.message === 'string' ? error.message : String(error);
}

/**
 * 创建网表面板。
 * @param {object} config { onGenerate, onExport, onLocate }
 * @returns {object} 面板 API
 */
export function createNetlistPanel(config = {}) {
  const onGenerate = typeof config.onGenerate === 'function' ? config.onGenerate : () => {};
  const onExport = typeof config.onExport === 'function' ? config.onExport : () => {};
  const onLocate = typeof config.onLocate === 'function' ? config.onLocate : () => {};

  let result = null;
  let errorMessage = '';
  let busy = false;
  let stale = false;
  let tab = 'nets';

  const stateBadge = el('span', { class: 'badge', text: '未生成' });
  const generateButton = el('button', {
    class: 'btn btn-primary btn-sm',
    attrs: { type: 'button' },
  }, [iconNode('play'), el('span', { text: '生成网表' })]);
  const exportButton = el('button', {
    class: 'btn btn-ghost btn-sm',
    attrs: { type: 'button', title: '导出网表（Ctrl+E）' },
  }, [iconNode('export'), el('span', { text: '导出…' })]);
  exportButton.disabled = true;

  const summary = el('div', { class: 'netlist-summary' });
  const netTab = el('button', { class: 'seg-btn', attrs: { type: 'button', role: 'tab' }, text: '网络' });
  const warningTab = el('button', { class: 'seg-btn', attrs: { type: 'button', role: 'tab' }, text: '警告' });
  const body = el('div', { class: 'panel-scroll netlist-body' });

  const element = el('section', { class: 'panel netlist-panel', attrs: { 'aria-label': '网表与检查' } }, [
    el('header', { class: 'panel-header' }, [
      el('h2', { class: 'panel-title', text: '网表' }),
      stateBadge,
      el('div', { class: 'panel-actions' }, [generateButton, exportButton]),
    ]),
    summary,
    el('div', { class: 'seg-tabs netlist-tabs', attrs: { role: 'tablist', 'aria-label': '网表视图' } }, [netTab, warningTab]),
    body,
  ]);

  function currentWarnings() {
    return result ? warningRows(result.warnings) : [];
  }

  function currentNets() {
    return result ? netRows(result) : [];
  }

  function updateTabs() {
    const summaryData = netlistSummary(result);
    netTab.textContent = '网络 ' + summaryData.netCount;
    warningTab.textContent = '警告 ' + summaryData.warningCount;
    netTab.classList.toggle('is-active', tab === 'nets');
    warningTab.classList.toggle('is-active', tab === 'warnings');
    netTab.setAttribute('aria-selected', tab === 'nets' ? 'true' : 'false');
    warningTab.setAttribute('aria-selected', tab === 'warnings' ? 'true' : 'false');
  }

  function renderSummary() {
    clear(summary);
    if (!result && errorMessage === '') {
      summary.appendChild(el('span', { class: 'summary-item', text: '点击「生成网表」分析连通性并执行 ERC 检查' }));
      return;
    }
    if (errorMessage !== '') {
      summary.appendChild(el('span', { class: 'summary-item summary-item--error', text: errorMessage }));
      return;
    }
    const data = netlistSummary(result);
    const items = [
      { label: '网络', value: data.netCount },
      { label: '引脚', value: data.pinCount },
      { label: '元件', value: data.componentCount },
      { label: '警告', value: data.warningCount, warn: data.warningCount > 0 },
    ];
    for (const item of items) {
      summary.appendChild(el('span', { class: 'summary-chip' + (item.warn ? ' summary-chip--warn' : '') }, [
        el('span', { class: 'summary-label', text: item.label }),
        el('span', { class: 'summary-value', text: String(item.value) }),
      ]));
    }
    if (stale) summary.appendChild(el('span', { class: 'summary-item summary-item--warn', text: '工程已修改，结果可能过期' }));
  }

  function renderBody() {
    clear(body);
    if (errorMessage !== '') {
      body.appendChild(el('div', { class: 'empty-state empty-state--error' }, [
        iconNode('warning'),
        el('p', { text: '网表生成失败' }),
        el('p', { class: 'empty-detail', text: errorMessage }),
      ]));
      return;
    }
    if (!result) {
      body.appendChild(el('div', { class: 'empty-state' }, [
        iconNode('netlist'),
        el('p', { text: '尚未生成网表' }),
        el('p', { class: 'empty-detail', text: '生成后会列出每个网络包含的引脚，并显示悬空引脚、位号重复等检查结果。' }),
      ]));
      return;
    }
    if (tab === 'warnings') {
      const warnings = currentWarnings();
      if (warnings.length === 0) {
        body.appendChild(el('div', { class: 'empty-state empty-state--ok' }, [
          iconNode('check'),
          el('p', { text: '没有检查警告' }),
        ]));
        return;
      }
      const list = el('div', { class: 'warning-list' });
      for (const warning of warnings) {
        list.appendChild(el('button', {
          class: 'warning-row',
          attrs: { type: 'button', title: '定位到相关对象' },
          on: {
            click: () => onLocate(warningTarget(warning), warning),
          },
        }, [
          el('span', { class: 'warning-code', text: warning.label }),
          el('span', { class: 'warning-message', text: warning.message || warning.code }),
          el('span', { class: 'warning-locate', text: '定位 ›' }),
        ]));
      }
      body.appendChild(list);
      return;
    }

    const nets = currentNets();
    if (nets.length === 0) {
      body.appendChild(el('div', { class: 'empty-state' }, [
        iconNode('netlist'),
        el('p', { text: '没有网络' }),
        el('p', { class: 'empty-detail', text: '放置符号并用导线连接后会形成网络。' }),
      ]));
      return;
    }
    const list = el('div', { class: 'net-list' });
    for (const net of nets) {
      const pins = el('div', { class: 'net-pins' });
      for (const pin of net.pins) {
        pins.appendChild(el('button', {
          class: 'pin-chip',
          attrs: { type: 'button', title: (pin.pinName ? pin.pinName + ' · ' : '') + '定位 ' + pin.label },
          text: pin.label,
          on: {
            click: () => onLocate({ instanceId: pin.instanceId, sheetId: pin.sheetId, wireId: null }, null),
          },
        }));
      }
      list.appendChild(el('div', { class: 'net-card' }, [
        el('div', { class: 'net-head' }, [
          el('span', { class: 'net-dot' }),
          el('span', { class: 'net-name', text: net.name }),
          el('span', {
            class: 'net-class',
            attrs: { title: 'net class：' + net.class },
            text: net.class,
          }),
          el('span', { class: 'net-count', text: net.pins.length + ' 引脚' }),
        ]),
        pins,
      ]));
    }
    body.appendChild(list);
  }

  function refresh() {
    updateTabs();
    renderSummary();
    renderBody();
    stateBadge.textContent = busy ? '分析中…'
      : errorMessage !== '' ? '生成失败'
        : result ? (stale ? '已过期' : '已生成') : '未生成';
    stateBadge.classList.toggle('badge--warn', stale && !busy);
    stateBadge.classList.toggle('badge--error', errorMessage !== '');
    generateButton.disabled = busy;
    exportButton.disabled = !result;
    const label = generateButton.querySelector('span:last-child');
    if (label) label.textContent = busy ? '分析中…' : '生成网表';
  }

  generateButton.addEventListener('click', () => onGenerate());
  exportButton.addEventListener('click', () => onExport());
  netTab.addEventListener('click', () => {
    tab = 'nets';
    refresh();
  });
  warningTab.addEventListener('click', () => {
    tab = 'warnings';
    refresh();
  });

  refresh();

  return {
    element,
    setBusy(value) {
      busy = value === true;
      refresh();
    },
    setResult(next) {
      result = next || null;
      errorMessage = '';
      stale = false;
      busy = false;
      if (result && Array.isArray(result.warnings) && result.warnings.length > 0) tab = 'warnings';
      else if (!result) tab = 'nets';
      refresh();
      if (result) {
        try {
          body.querySelector('.net-card')?.scrollIntoView({ block: 'nearest' });
        } catch {
          // 忽略滚动异常。
        }
      }
    },
    setError(message) {
      result = null;
      errorMessage = message ? String(message) : '未知错误';
      busy = false;
      stale = false;
      refresh();
    },
    setStale(value) {
      const next = value === true;
      if (next === stale) return;
      stale = next;
      if (result) refresh();
    },
    setTab(nextTab) {
      tab = nextTab === 'warnings' ? 'warnings' : 'nets';
      refresh();
    },
    clear() {
      result = null;
      errorMessage = '';
      busy = false;
      stale = false;
      tab = 'nets';
      refresh();
    },
    getResult: () => result,
    focus() {
      try {
        generateButton.focus();
      } catch {
        // 忽略聚焦失败。
      }
    },
    reportError(error) {
      this.setError(messageOf(error));
    },
  };
}
