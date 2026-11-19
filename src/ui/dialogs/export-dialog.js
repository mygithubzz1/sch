// 网表导出对话框：格式选择、内容预览、一键复制与下载。
import { downloadText } from '../../io/project-io.js';
import { EXPORTER_LIST, buildNetlist, getExporter } from '../../netlist/index.js';
import { el } from '../dom.js';
import { exportFileName } from '../project-setup.js';
import { netlistSummary } from '../view-model.js';
import { openModal } from './modal.js';

/** KiCad 格式的版本说明（format E 即 KiCad 9 网表格式）。 */
export const FORMAT_NOTES = Object.freeze({
  kicad: 'KiCad 9 (version E)',
});

function messageOf(error) {
  return error && typeof error.message === 'string' ? error.message : String(error);
}

/**
 * 复制文本到剪贴板：优先 Clipboard API，失败时回退到临时 textarea。
 * @param {string} text 文本
 * @returns {Promise<boolean>} 是否成功
 */
export async function copyToClipboard(text) {
  const content = typeof text === 'string' ? text : String(text === undefined || text === null ? '' : text);
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(content);
      return true;
    }
  } catch {
    // 继续尝试回退方案。
  }
  if (typeof document === 'undefined') return false;
  try {
    const area = document.createElement('textarea');
    area.value = content;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') === true : false;
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 打开网表导出对话框。
 * @param {object} config { root, project, sheetName, initialFormat, notify }
 * @returns {object} 模态句柄
 */
export function openExportDialog(config = {}) {
  const project = config.project;
  const sheetName = typeof config.sheetName === 'string' ? config.sheetName : '';
  const notify = typeof config.notify === 'function' ? config.notify : () => {};
  let formatId = getExporter(config.initialFormat) ? config.initialFormat : 'json';
  let currentText = '';

  const stats = el('div', { class: 'export-stats' });
  const preview = el('pre', {
    class: 'code-preview',
    attrs: { tabindex: '0', 'aria-label': '网表预览' },
  });
  const fileLabel = el('span', { class: 'export-filename' });
  const formatGrid = el('div', { class: 'format-grid', attrs: { role: 'radiogroup', 'aria-label': '网表格式' } });
  const formatNote = el('p', { class: 'format-note', attrs: { 'aria-live': 'polite' } });

  const buttons = EXPORTER_LIST.map((exporter) => {
    const input = el('input', {
      class: 'format-radio',
      attrs: { type: 'radio', name: 'netlist-format', value: exporter.id },
    });
    input.checked = exporter.id === formatId;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      formatId = exporter.id;
      render();
    });
    return el('label', { class: 'format-card' }, [
      input,
      el('span', { class: 'format-name', text: exporter.label }),
      el('span', { class: 'format-ext', text: '.' + exporter.extension }),
      FORMAT_NOTES[exporter.id]
        ? el('span', { class: 'format-card-note', text: FORMAT_NOTES[exporter.id] })
        : null,
    ]);
  });
  formatGrid.append(...buttons);

  function summaryText() {
    try {
      const result = buildNetlist(project);
      const summary = netlistSummary(result);
      return '网络 ' + summary.netCount + ' · 引脚 ' + summary.pinCount + ' · 元件 ' + summary.componentCount +
        ' · 警告 ' + summary.warningCount;
    } catch (error) {
      return '网表统计不可用：' + messageOf(error);
    }
  }

  function render() {
    const exporter = getExporter(formatId);
    if (!exporter) return;
    try {
      currentText = exporter.generate(project);
      preview.textContent = currentText;
      preview.classList.remove('code-preview--error');
    } catch (error) {
      currentText = '';
      preview.textContent = '生成失败：' + messageOf(error);
      preview.classList.add('code-preview--error');
    }
    stats.textContent = summaryText();
    fileLabel.textContent = exportFileName(project, sheetName, exporter.extension) + ' · ' + exporter.mime;
    formatNote.textContent = FORMAT_NOTES[formatId]
      ? FORMAT_NOTES[formatId] + '：S-表达式网表，UTF-8 无 BOM、CRLF 行尾。'
      : '';
  }

  const copyButton = el('button', {
    class: 'btn btn-ghost',
    attrs: { type: 'button' },
    text: '复制',
    on: {
      click: async () => {
        if (currentText === '') return;
        const ok = await copyToClipboard(currentText);
        copyButton.textContent = ok ? '已复制' : '复制失败';
        notify(ok ? '网表已复制到剪贴板' : '复制失败，请手动选择预览文本', ok ? 'success' : 'error');
        setTimeout(() => {
          copyButton.textContent = '复制';
        }, 1600);
      },
    },
  });

  const downloadButton = el('button', {
    class: 'btn btn-primary',
    attrs: { type: 'button' },
    text: '下载文件',
    on: {
      click: () => {
        const exporter = getExporter(formatId);
        if (!exporter || currentText === '') return;
        try {
          const name = exportFileName(project, sheetName, exporter.extension);
          downloadText(name, currentText, exporter.mime + ';charset=utf-8');
          notify('已导出 ' + name, 'success');
        } catch (error) {
          notify('下载失败：' + messageOf(error), 'error');
        }
      },
    },
  });

  const body = el('div', { class: 'export-dialog' }, [
    formatGrid,
    formatNote,
    stats,
    preview,
    el('p', { class: 'export-file', attrs: { 'aria-live': 'polite' } }, [fileLabel]),
  ]);

  render();

  return openModal({
    root: config.root,
    title: '导出网表',
    subtitle: '选择格式后预览，可复制或下载；网表由连通性分析与 ERC 结果生成。',
    body,
    width: 720,
    className: 'modal--wide',
    actions: [
      { label: '关闭', kind: 'ghost' },
      copyButton,
      downloadButton,
    ],
  });
}
