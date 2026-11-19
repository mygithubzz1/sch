// 属性检查器：编辑符号/导线/结点/标签/文本、图纸与工程属性，以及封装/焊盘/图形属性。
import { PAD_LAYERS, PAD_SHAPES } from '../../library/footprint-library.js';
import { FOOTPRINT_LAYERS } from '../../library/graphic.js';
import { ENTITY_COLLECTIONS, findSheetById } from '../../model/project.js';
import { clear, el } from '../dom.js';
import { iconNode } from '../icons.js';
import {
  formatNumber,
  footprintLabel,
  layerLabel,
  selectionInfo,
  selectionTitle,
} from '../view-model.js';

const ROTATIONS = [0, 90, 180, 270];
const GRID_OPTIONS = [0.635, 1.27, 2.54, 5.08];
const SHAPE_LABELS = Object.freeze({ rect: '矩形', roundrect: '圆角矩形', circle: '圆形', oval: '椭圆' });

function messageOf(error) {
  return error && typeof error.message === 'string' ? error.message : String(error);
}

function numberText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return String(Number(number.toFixed(4)));
}

/**
 * 图纸备注的双形态显示（KiCad 导入可能是 string[9]，手输是 string）。
 * 数组按行连接，避免 textarea 出现 "a,b,c" 或 "[object Object]"；提交时统一写回字符串。
 * @param {string|string[]|undefined|null} comments
 * @returns {string}
 */
export function commentsTextOf(comments) {
  if (Array.isArray(comments)) {
    return comments.map((item) => (item === undefined || item === null ? '' : String(item))).join('\n');
  }
  return typeof comments === 'string' ? comments : '';
}

function optionsFrom(values, labelOf = (value) => String(value)) {
  return values.map((value) => ({ value: String(value), label: labelOf(value) }));
}

/**
 * 创建属性检查器面板。
 * @param {object} config { store, getEditor, getSymbols, getFootprints, getMode, getFootprintEditor,
 *   setFootprintEditor, onSaveFootprint, onExitFootprint, notify }
 * @returns {object} 面板 API
 */
export function createPropertiesPanel(config = {}) {
  const store = config.store;
  if (!store) throw new TypeError('createPropertiesPanel 需要 store');
  const getEditor = typeof config.getEditor === 'function' ? config.getEditor : () => null;
  const getSymbols = typeof config.getSymbols === 'function' ? config.getSymbols : () => [];
  const getFootprints = typeof config.getFootprints === 'function' ? config.getFootprints : () => [];
  const getMode = typeof config.getMode === 'function' ? config.getMode : () => 'schematic';
  const notify = typeof config.notify === 'function' ? config.notify : () => {};
  const onSaveFootprint = typeof config.onSaveFootprint === 'function' ? config.onSaveFootprint : null;
  const onExitFootprint = typeof config.onExitFootprint === 'function' ? config.onExitFootprint : null;

  const badge = el('span', { class: 'badge', text: '未选择' });
  const body = el('div', { class: 'properties-body' });
  const footerHint = el('span', { class: 'panel-hint', text: '修改即时生效 · Ctrl+Z 撤销' });
  const element = el('aside', { class: 'panel properties-panel', attrs: { 'aria-label': '属性检查器' } }, [
    el('header', { class: 'panel-header' }, [
      el('h2', { class: 'panel-title', text: '属性' }),
      badge,
    ]),
    el('div', { class: 'panel-scroll properties-scroll' }, [body]),
    el('footer', { class: 'panel-footer' }, [footerHint]),
  ]);

  let currentSelection = { kind: 'none', count: 0, entity: null, entities: [] };
  let footprintEditor = null;
  let footprintUnsubs = [];
  let editorToken = 0;
  let signature = '';
  let bindings = [];
  let mode = 'schematic';

  function currentMode() {
    try {
      return getMode() === 'footprint' ? 'footprint' : 'schematic';
    } catch {
      return 'schematic';
    }
  }

  function buildSignature() {
    mode = currentMode();
    if (mode === 'footprint') {
      const fstore = footprintEditor ? footprintEditor.getStore() : null;
      const footprint = fstore ? fstore.getFootprint() : null;
      const ids = fstore ? fstore.getSelection().join(',') : '';
      return 'f:' + editorToken + ':' + (footprint ? footprint.id : '') + ':' + ids;
    }
    return 's:' + store.getSheetId() + ':' + store.getSelection().join(',');
  }

  function refresh(force = false) {
    const next = buildSignature();
    if (force || next !== signature) {
      signature = next;
      render();
    } else {
      syncValues();
    }
  }

  function render() {
    bindings = [];
    clear(body);
    if (currentMode() === 'footprint') renderFootprint();
    else renderSchematic();
  }

  function registerBinding(input, read) {
    bindings.push({ input, read });
    return input;
  }

  function syncValues() {
    for (const binding of bindings) {
      const input = binding.input;
      if (!input) continue;
      if (typeof document !== 'undefined' && document.activeElement === input) continue;
      let value = null;
      try {
        value = binding.read();
      } catch {
        value = null;
      }
      if (input.type === 'checkbox') {
        input.checked = value === true;
      } else {
        const text = value === null || value === undefined ? '' : String(value);
        if (input.value !== text) input.value = text;
      }
    }
  }

  function field(labelText, control, hint) {
    return el('label', { class: 'field' }, [
      el('span', { class: 'field-label', text: labelText }),
      control,
      hint ? el('span', { class: 'field-hint', text: hint }) : null,
    ]);
  }

  function grid(children) {
    return el('div', { class: 'field-grid' }, children);
  }

  function section(title, children, actions) {
    return el('section', { class: 'prop-section' }, [
      el('div', { class: 'prop-section-head' }, [
        el('h3', { class: 'prop-section-title', text: title }),
        actions || null,
      ]),
      ...children,
    ]);
  }

  function textField(labelText, options = {}) {
    const input = el('input', {
      class: 'input',
      attrs: { type: 'text', placeholder: options.placeholder || '', autocomplete: 'off' },
    });
    let initial = '';
    try {
      initial = options.read();
    } catch {
      initial = '';
    }
    input.value = initial === null || initial === undefined ? '' : String(initial);
    input.addEventListener('change', () => {
      try {
        options.commit(input.value);
      } catch (error) {
        notify('修改失败：' + messageOf(error), 'error');
        syncValues();
      }
    });
    registerBinding(input, options.read);
    return field(labelText, input, options.hint);
  }

  function textAreaField(labelText, options = {}) {
    const input = el('textarea', { class: 'input', attrs: { rows: options.rows || 3 } });
    let initial = '';
    try {
      initial = options.read();
    } catch {
      initial = '';
    }
    input.value = initial === null || initial === undefined ? '' : String(initial);
    input.addEventListener('change', () => {
      try {
        options.commit(input.value);
      } catch (error) {
        notify('修改失败：' + messageOf(error), 'error');
        syncValues();
      }
    });
    registerBinding(input, options.read);
    return field(labelText, input, options.hint);
  }

  function numberField(labelText, options = {}) {
    const input = el('input', {
      class: 'input',
      attrs: { type: 'number', step: String(options.step === undefined ? 0.01 : options.step) },
    });
    let initial = null;
    try {
      initial = options.read();
    } catch {
      initial = null;
    }
    input.value = numberText(initial);
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        syncValues();
        return;
      }
      try {
        options.commit(value);
      } catch (error) {
        notify('修改失败：' + messageOf(error), 'error');
        syncValues();
      }
    });
    registerBinding(input, () => numberText(options.read()));
    return field(labelText, input, options.hint);
  }

  function selectField(labelText, options, settings = {}) {
    const select = el('select', { class: 'input' }, options.map((option) => el('option', {
      attrs: { value: option.value },
      text: option.label,
    })));
    let initial = '';
    try {
      initial = settings.read();
    } catch {
      initial = '';
    }
    select.value = initial === null || initial === undefined ? '' : String(initial);
    select.addEventListener('change', () => {
      try {
        settings.commit(select.value);
      } catch (error) {
        notify('修改失败：' + messageOf(error), 'error');
        syncValues();
      }
    });
    registerBinding(select, () => {
      const value = settings.read();
      return value === null || value === undefined ? '' : String(value);
    });
    return field(labelText, select, settings.hint);
  }

  function checkboxField(labelText, options = {}) {
    const input = el('input', { attrs: { type: 'checkbox' } });
    let initial = false;
    try {
      initial = options.read() === true;
    } catch {
      initial = false;
    }
    input.checked = initial;
    input.addEventListener('change', () => {
      try {
        options.commit(input.checked);
      } catch (error) {
        notify('修改失败：' + messageOf(error), 'error');
        syncValues();
      }
    });
    registerBinding(input, () => options.read() === true);
    return el('label', { class: 'field field--inline' }, [
      el('span', { class: 'field-label', text: labelText }),
      el('span', { class: 'checkbox-wrap' }, [input, el('span', { class: 'checkbox-text', text: options.text || '启用' })]),
    ]);
  }

  function actionButton(label, handler, options = {}) {
    const button = el('button', {
      class: 'btn btn-sm ' + (options.danger ? 'btn-danger' : 'btn-ghost'),
      attrs: { type: 'button', title: options.title || label },
      on: {
        click: () => {
          try {
            handler();
          } catch (error) {
            notify(options.errorPrefix || label + '失败：' + messageOf(error), 'error');
          }
        },
      },
    }, [options.icon ? iconNode(options.icon) : null, el('span', { text: label })]);
    if (options.disabled) button.disabled = true;
    return button;
  }

  function actionsRow(buttons) {
    return el('div', { class: 'properties-actions' }, buttons.filter(Boolean));
  }

  function infoList(rows) {
    return el('dl', { class: 'prop-info' }, rows.flatMap(([label, value]) => [
      el('dt', { text: label }),
      el('dd', { text: value === undefined || value === null ? '—' : String(value) }),
    ]));
  }

  function readSheetEntity(id) {
    const sheet = store.getSheet();
    if (!sheet || typeof id !== 'string') return null;
    for (const kind of ENTITY_COLLECTIONS) {
      const list = Array.isArray(sheet[kind]) ? sheet[kind] : [];
      const found = list.find((item) => item && item.id === id);
      if (found) return found;
    }
    return null;
  }

  function runEditor(label, fn) {
    const editor = getEditor();
    if (!editor) {
      notify('编辑器未就绪', 'error');
      return;
    }
    try {
      fn(editor);
    } catch (error) {
      notify(label + '失败：' + messageOf(error), 'error');
    }
  }

  function commitEntity(id, patch, label) {
    runEditor(label, (editor) => {
      editor.getCommands().setEntityProps(store.getSheetId(), id, patch, { label });
    });
  }

  function deleteSelection() {
    runEditor('删除', (editor) => editor.deleteSelection());
  }

  function rotateSelection(delta) {
    runEditor('旋转符号', (editor) => {
      editor.getCommands().rotateSymbols(store.getSheetId(), store.getSelection(), delta, { label: '旋转符号 90°' });
    });
  }

  function mirrorSelection() {
    runEditor('镜像符号', (editor) => {
      editor.getCommands().mirrorSymbols(store.getSheetId(), store.getSelection(), undefined, { label: '镜像符号' });
    });
  }

  function footprintOptions() {
    const list = getFootprints()
      .filter((item) => item && typeof item.id === 'string')
      .map((item) => ({ value: item.id, label: (item.name || item.id) + ' (' + item.id + ')' }))
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN'));
    return [{ value: '', label: '（无封装）' }, ...list];
  }

  function symbolDefFor(entity) {
    const list = getSymbols();
    return list.find((symbol) => symbol && symbol.id === entity.symbolId) || null;
  }

  function renderSchematic() {
    const sheet = store.getSheet();
    const info = selectionInfo(sheet, store.getSelection());
    currentSelection = info;
    badge.textContent = info.count === 0 ? '图纸' : info.count + ' 项';
    footerHint.textContent = '修改即时生效 · Ctrl+Z 撤销';
    if (!sheet) {
      body.appendChild(el('div', { class: 'empty-state' }, [
        iconNode('info'),
        el('p', { text: '没有打开的图纸' }),
      ]));
      return;
    }
    if (info.count === 0) {
      renderSheetProperties(sheet);
      return;
    }
    const heroSub = heroSubtitle(info);
    body.appendChild(el('div', { class: 'prop-hero' }, [
      el('span', { class: 'prop-hero-title', text: selectionTitle(info) }),
      el('span', { class: 'prop-hero-sub', text: heroSub }),
    ]));
    if (info.kind === 'multi') {
      renderMultiSelection(info);
      return;
    }
    if (info.kind === 'symbols') renderSymbol(info.entity);
    else if (info.kind === 'wires') renderWire(info.entity);
    else if (info.kind === 'junctions') renderJunction(info.entity);
    else if (info.kind === 'labels') renderLabel(info.entity);
    else if (info.kind === 'texts') renderText(info.entity);
    const hasSymbol = info.entities.some((entry) => entry.kind === 'symbols');
    body.appendChild(actionsRow([
      actionButton('旋转 90°', () => rotateSelection(90), {
        icon: 'rotate', disabled: !hasSymbol, title: '旋转所选符号（R）',
      }),
      actionButton('镜像', () => mirrorSelection(), {
        icon: 'mirror', disabled: !hasSymbol, title: '镜像所选符号（X）',
      }),
      actionButton('删除', () => deleteSelection(), {
        icon: 'trash', danger: true, title: '删除所选对象（Delete）',
      }),
    ]));
  }

  function heroSubtitle(info) {
    if (info.kind === 'symbols') {
      const def = symbolDefFor(info.entity);
      return (def ? def.name + ' · ' : '') + (info.entity.symbolId || '未知符号');
    }
    if (info.kind === 'wires') {
      return (Array.isArray(info.entity.points) ? info.entity.points.length : 0) + ' 个折点 · 宽 ' +
        formatNumber(info.entity.width) + ' mm';
    }
    if (info.kind === 'junctions') return '结点 (' + formatNumber(info.entity.x) + ', ' + formatNumber(info.entity.y) + ')';
    if (info.kind === 'labels') return (info.entity.kind === 'global' ? '全局标签' : '局部标签');
    if (info.kind === 'texts') return '字号 ' + formatNumber(info.entity.size) + ' mm';
    return '';
  }

  function renderSymbol(entity) {
    const id = entity.id;
    const read = () => readSheetEntity(id) || entity;
    const commit = (patch, label) => commitEntity(id, patch, label);
    const def = symbolDefFor(entity);
    body.appendChild(section('元件属性', [
      grid([
        textField('位号', { read: () => read().designator, commit: (value) => commit({ designator: value }, '修改位号') }),
        textField('值', { read: () => read().value, commit: (value) => commit({ value }, '修改值') }),
      ]),
      selectField('封装', footprintOptions(), {
        read: () => read().footprintId || '',
        commit: (value) => commit({ footprintId: value === '' ? null : value }, '修改封装'),
        hint: '封装库来自工程库，可在左侧面板新建/编辑',
      }),
      grid([
        numberField('X (mm)', { read: () => read().x, commit: (value) => commit({ x: value }, '移动符号') }),
        numberField('Y (mm)', { read: () => read().y, commit: (value) => commit({ y: value }, '移动符号') }),
      ]),
      grid([
        selectField('旋转', optionsFrom(ROTATIONS, (value) => value + '°'), {
          read: () => String(read().rotation || 0),
          commit: (value) => commit({ rotation: Number(value) }, '旋转符号'),
        }),
        checkboxField('镜像', {
          read: () => read().mirror === true,
          commit: (value) => commit({ mirror: value }, '镜像符号'),
          text: '水平镜像',
        }),
      ]),
    ]));
    body.appendChild(section('符号信息', [
      infoList([
        ['符号 ID', read().symbolId],
        ['符号名称', def ? def.name : '（库中缺失）'],
        ['引脚数', def && Array.isArray(def.pins) ? def.pins.length : '—'],
        ['位号前缀', def ? def.refPrefix : '—'],
        ['描述', def && def.description ? def.description : '—'],
      ]),
    ]));
  }

  function renderWire(entity) {
    const id = entity.id;
    const read = () => readSheetEntity(id) || entity;
    const points = Array.isArray(read().points) ? read().points : [];
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }
    body.appendChild(section('导线属性', [
      grid([
        numberField('线宽 (mm)', {
          read: () => read().width,
          commit: (value) => commitEntity(id, { width: Math.max(0.01, value) }, '修改线宽'),
          step: 0.01,
        }),
      ]),
      infoList([
        ['折点数', points.length],
        ['起点', points[0] ? '(' + formatNumber(points[0].x) + ', ' + formatNumber(points[0].y) + ')' : '—'],
        ['终点', points[points.length - 1]
          ? '(' + formatNumber(points[points.length - 1].x) + ', ' + formatNumber(points[points.length - 1].y) + ')'
          : '—'],
        ['总长度', formatNumber(length) + ' mm'],
      ]),
    ]));
  }

  function renderJunction(entity) {
    const id = entity.id;
    const read = () => readSheetEntity(id) || entity;
    body.appendChild(section('结点属性', [
      grid([
        numberField('X (mm)', { read: () => read().x, commit: (value) => commitEntity(id, { x: value }, '移动结点') }),
        numberField('Y (mm)', { read: () => read().y, commit: (value) => commitEntity(id, { y: value }, '移动结点') }),
      ]),
      infoList([['提示', '结点用于明确导线的电气连接，可删除后自动重算。']]),
    ]));
  }

  function renderLabel(entity) {
    const id = entity.id;
    const read = () => readSheetEntity(id) || entity;
    const commit = (patch, label) => commitEntity(id, patch, label);
    body.appendChild(section('网络标签', [
      textField('文本', { read: () => read().text, commit: (value) => commit({ text: value }, '修改标签文本') }),
      selectField('类型', [{ value: 'local', label: '局部标签' }, { value: 'global', label: '全局标签' }], {
        read: () => (read().kind === 'global' ? 'global' : 'local'),
        commit: (value) => commit({ kind: value }, '修改标签类型'),
      }),
      grid([
        numberField('X (mm)', { read: () => read().x, commit: (value) => commit({ x: value }, '移动标签') }),
        numberField('Y (mm)', { read: () => read().y, commit: (value) => commit({ y: value }, '移动标签') }),
      ]),
      selectField('旋转', optionsFrom(ROTATIONS, (value) => value + '°'), {
        read: () => String(read().rotation || 0),
        commit: (value) => commit({ rotation: Number(value) }, '旋转标签'),
      }),
    ]));
  }

  function renderText(entity) {
    const id = entity.id;
    const read = () => readSheetEntity(id) || entity;
    const commit = (patch, label) => commitEntity(id, patch, label);
    body.appendChild(section('文本注释', [
      textAreaField('内容', { read: () => read().text, commit: (value) => commit({ text: value }, '修改文本') }),
      grid([
        numberField('字号 (mm)', {
          read: () => read().size,
          commit: (value) => commit({ size: Math.max(0.1, value) }, '修改字号'),
          step: 0.1,
        }),
        selectField('旋转', optionsFrom(ROTATIONS, (value) => value + '°'), {
          read: () => String(read().rotation || 0),
          commit: (value) => commit({ rotation: Number(value) }, '旋转文本'),
        }),
      ]),
      grid([
        numberField('X (mm)', { read: () => read().x, commit: (value) => commit({ x: value }, '移动文本') }),
        numberField('Y (mm)', { read: () => read().y, commit: (value) => commit({ y: value }, '移动文本') }),
      ]),
    ]));
  }

  function renderMultiSelection(info) {
    const symbols = info.entities.filter((entry) => entry.kind === 'symbols');
    body.appendChild(section('多选', [
      el('p', { class: 'empty-detail', text: '已选择 ' + info.count + ' 个对象，可批量移动、旋转、镜像或删除。' }),
      infoList([
        ['符号', symbols.length],
        ['其他对象', info.count - symbols.length],
        ['位号', symbols.map((entry) => entry.entity.designator || '?').slice(0, 8).join('、') || '—'],
      ]),
    ]));
    body.appendChild(actionsRow([
      actionButton('旋转 90°', () => rotateSelection(90), {
        icon: 'rotate', disabled: symbols.length === 0, title: '批量旋转符号',
      }),
      actionButton('镜像', () => mirrorSelection(), {
        icon: 'mirror', disabled: symbols.length === 0, title: '批量镜像符号',
      }),
      actionButton('删除所选', () => deleteSelection(), { icon: 'trash', danger: true }),
    ]));
  }

  function renderSheetProperties(sheet) {
    const sheetId = store.getSheetId();
    const readSheet = () => findSheetById(store.getProject(), sheetId) || sheet;
    const readProject = () => store.getProject();
    const updateSheet = (label, mutator) => {
      try {
        store.update((draft) => mutator(draft), { label });
      } catch (error) {
        notify(label + '失败：' + messageOf(error), 'error');
      }
    };
    const updateProject = (label, mutator) => {
      try {
        store.update((draft, project) => mutator(project, draft), { label });
      } catch (error) {
        notify(label + '失败：' + messageOf(error), 'error');
      }
    };

    body.appendChild(section('图纸', [
      textField('图纸名称', {
        read: () => readSheet().name,
        commit: (value) => updateSheet('重命名图纸', (draft) => {
          draft.name = value.trim() === '' ? draft.name : value.trim();
        }),
        hint: '标签页上双击也可重命名',
      }),
      grid([
        textField('标题', {
          read: () => readSheet().title && readSheet().title.title,
          commit: (value) => updateSheet('修改图纸标题', (draft) => {
            draft.title.title = value;
          }),
        }),
        textField('公司', {
          read: () => readSheet().title && readSheet().title.company,
          commit: (value) => updateSheet('修改公司', (draft) => {
            draft.title.company = value;
          }),
        }),
      ]),
      grid([
        textField('版本', {
          read: () => readSheet().title && readSheet().title.rev,
          commit: (value) => updateSheet('修改版本', (draft) => {
            draft.title.rev = value;
          }),
        }),
        textField('日期', {
          read: () => readSheet().title && readSheet().title.date,
          commit: (value) => updateSheet('修改日期', (draft) => {
            draft.title.date = value;
          }),
        }),
      ]),
      textAreaField('备注', {
        read: () => commentsTextOf(readSheet().title && readSheet().title.comments),
        commit: (value) => updateSheet('修改备注', (draft) => {
          // 导入工程的 comments 可能是 string[]；编辑后按单字符串写回（模型/导出器都接受双形态）。
          draft.title.comments = value;
        }),
      }),
    ]));

    body.appendChild(section('工程', [
      textField('工程名称', {
        read: () => readProject().name,
        commit: (value) => updateProject('重命名工程', (project) => {
          project.name = value.trim() === '' ? project.name : value.trim();
        }),
      }),
      selectField('网格 (mm)', optionsFrom(GRID_OPTIONS, (value) => String(value)), {
        read: () => String(readProject().grid),
        commit: (value) => {
          updateProject('修改网格', (project) => {
            project.grid = Number(value);
          });
          const editor = getEditor();
          if (editor && typeof editor.setGrid === 'function') {
            try {
              editor.setGrid(0);
            } catch {
              // 网格刷新失败不影响数据修改。
            }
          }
        },
        hint: '网格吸附可在工具栏切换（G）',
      }),
      infoList([
        ['图纸数', readProject().sheets.length],
        ['符号库', readProject().library.symbols.length],
        ['封装库', readProject().library.footprints.length],
      ]),
      el('p', { class: 'empty-detail', text: '未选择对象时显示图纸与工程属性；在画布上选中器件即可编辑位号、值与封装。' }),
    ]));
  }

  // ---- 封装编辑模式 ----

  function readFootprint() {
    const fstore = footprintEditor ? footprintEditor.getStore() : null;
    return fstore ? fstore.getFootprint() : null;
  }

  function readPad(id) {
    const footprint = readFootprint();
    const pads = footprint && Array.isArray(footprint.pads) ? footprint.pads : [];
    return pads.find((pad) => pad && pad.id === id) || null;
  }

  function readGraphic(id) {
    const footprint = readFootprint();
    const graphics = footprint && Array.isArray(footprint.graphics) ? footprint.graphics : [];
    return graphics.find((graphic) => graphic && graphic.id === id) || null;
  }

  function runFootprint(label, fn) {
    if (!footprintEditor) {
      notify('封装编辑器未启动', 'error');
      return;
    }
    try {
      fn(footprintEditor);
    } catch (error) {
      notify(label + '失败：' + messageOf(error), 'error');
    }
  }

  function footprintMetaSection() {
    const fstore = footprintEditor ? footprintEditor.getStore() : null;
    const footprint = readFootprint();
    if (!fstore || !footprint) return null;
    const update = (label, mutator) => {
      try {
        fstore.update((draft) => mutator(draft), { label });
      } catch (error) {
        notify(label + '失败：' + messageOf(error), 'error');
      }
    };
    return section('封装信息', [
      textField('名称', {
        read: () => (readFootprint() ? readFootprint().name : ''),
        commit: (value) => update('修改封装名称', (draft) => {
          draft.name = value.trim() === '' ? draft.name : value.trim();
        }),
      }),
      textField('描述', {
        read: () => (readFootprint() ? readFootprint().description : ''),
        commit: (value) => update('修改封装描述', (draft) => {
          draft.description = value;
        }),
      }),
      infoList([
        ['封装 ID', footprint.id],
        ['焊盘数', Array.isArray(footprint.pads) ? footprint.pads.length : 0],
        ['图形数', Array.isArray(footprint.graphics) ? footprint.graphics.length : 0],
      ]),
    ]);
  }

  function renderFootprint() {
    const fstore = footprintEditor ? footprintEditor.getStore() : null;
    if (!fstore) {
      badge.textContent = '封装';
      body.appendChild(el('div', { class: 'empty-state' }, [
        iconNode('footprint'),
        el('p', { text: '封装编辑器未启动' }),
      ]));
      return;
    }
    const footprint = fstore.getFootprint();
    const ids = fstore.getSelection();
    const pads = footprint && Array.isArray(footprint.pads) ? footprint.pads : [];
    const graphics = footprint && Array.isArray(footprint.graphics) ? footprint.graphics : [];
    const pad = ids.length === 1 ? pads.find((item) => item && item.id === ids[0]) : null;
    const graphic = ids.length === 1 && !pad ? graphics.find((item) => item && item.id === ids[0]) : null;
    badge.textContent = ids.length === 0 ? '封装' : ids.length + ' 项';
    footerHint.textContent = '封装修改需点击「保存到工程库」写入工程';
    body.appendChild(el('div', { class: 'prop-hero' }, [
      el('span', { class: 'prop-hero-title', text: footprintLabel(footprint) }),
      el('span', { class: 'prop-hero-sub', text: '封装编辑 · ' + pads.length + ' 焊盘 · ' + graphics.length + ' 图形' }),
    ]));
    if (ids.length > 1) {
      body.appendChild(section('多选', [
        el('p', { class: 'empty-detail', text: '已选择 ' + ids.length + ' 个焊盘/图形。' }),
      ]));
      body.appendChild(actionsRow([
        actionButton('删除所选', () => runFootprint('删除', (editor) => editor.deleteSelection()), {
          icon: 'trash', danger: true,
        }),
      ]));
    } else if (pad) {
      renderPad(pad);
    } else if (graphic) {
      renderGraphic(graphic);
    } else {
      const meta = footprintMetaSection();
      if (meta) body.appendChild(meta);
      body.appendChild(el('p', {
        class: 'empty-detail',
        text: '选择焊盘或图形可编辑属性；使用左侧工具放置焊盘、绘制丝印与 Courtyard。',
      }));
    }
    const exitActions = [];
    if (onSaveFootprint) {
      exitActions.push(actionButton('保存到工程库', () => onSaveFootprint(), { icon: 'save' }));
    }
    if (onExitFootprint) {
      exitActions.push(actionButton('返回原理图', () => onExitFootprint(), { icon: 'select' }));
    }
    if (exitActions.length > 0) body.appendChild(actionsRow(exitActions));
  }

  function renderPad(pad) {
    const id = pad.id;
    const read = () => readPad(id) || pad;
    const commit = (patch, label) => runFootprint(label, (editor) => {
      editor.getCommands().updatePad(id, patch, { label });
    });
    body.appendChild(section('焊盘属性', [
      grid([
        textField('编号', { read: () => read().number, commit: (value) => commit({ number: value }, '修改焊盘编号') }),
        selectField('形状', optionsFrom(PAD_SHAPES, (value) => SHAPE_LABELS[value] || value), {
          read: () => read().shape,
          commit: (value) => commit({ shape: value }, '修改焊盘形状'),
        }),
      ]),
      grid([
        numberField('X (mm)', { read: () => read().x, commit: (value) => commit({ x: value }, '移动焊盘') }),
        numberField('Y (mm)', { read: () => read().y, commit: (value) => commit({ y: value }, '移动焊盘') }),
      ]),
      grid([
        numberField('宽 (mm)', {
          read: () => read().w, step: 0.05, commit: (value) => commit({ w: Math.max(0.01, value) }, '修改焊盘宽度'),
        }),
        numberField('高 (mm)', {
          read: () => read().h, step: 0.05, commit: (value) => commit({ h: Math.max(0.01, value) }, '修改焊盘高度'),
        }),
      ]),
      grid([
        selectField('层', [
          { value: 'top', label: '顶层 (SMD)' },
          { value: 'bottom', label: '底层 (SMD)' },
          { value: 'tht', label: '通孔 (THT)' },
        ], { read: () => read().layer, commit: (value) => commit({ layer: value }, '修改焊盘层') }),
        numberField('旋转 (°)', { read: () => read().rotation, step: 90, commit: (value) => commit({ rotation: value }, '旋转焊盘') }),
      ]),
      grid([
        numberField('钻孔 (mm)', {
          read: () => read().drill, step: 0.05, commit: (value) => commit({ drill: Math.max(0, value) }, '修改钻孔'),
          hint: 'SMD 焊盘为 0',
        }),
      ]),
    ]));
    body.appendChild(actionsRow([
      actionButton('删除焊盘', () => runFootprint('删除', (editor) => editor.deleteSelection()), {
        icon: 'trash', danger: true,
      }),
    ]));
  }

  function renderGraphic(graphic) {
    const id = graphic.id;
    const read = () => readGraphic(id) || graphic;
    const commit = (patch, label) => runFootprint(label, (editor) => {
      editor.getCommands().updateGraphic(id, patch, { label });
    });
    const type = read().type || 'line';
    const children = [
      grid([
        selectField('图层', optionsFrom(FOOTPRINT_LAYERS, layerLabel), {
          read: () => read().layer || 'silkscreen',
          commit: (value) => commit({ layer: value }, '修改图层'),
        }),
        numberField('线宽 (mm)', {
          read: () => read().width, step: 0.05, commit: (value) => commit({ width: Math.max(0.01, value) }, '修改线宽'),
        }),
      ]),
      checkboxField('填充', {
        read: () => read().fill === true,
        commit: (value) => commit({ fill: value }, '修改填充'),
        text: '使用主题填充色',
      }),
    ];
    if (type === 'rect') {
      children.push(grid([
        numberField('X (mm)', { read: () => read().x, commit: (value) => commit({ x: value }, '移动图形') }),
        numberField('Y (mm)', { read: () => read().y, commit: (value) => commit({ y: value }, '移动图形') }),
      ]));
      children.push(grid([
        numberField('宽 (mm)', { read: () => read().w, commit: (value) => commit({ w: Math.max(0, value) }, '修改宽度') }),
        numberField('高 (mm)', { read: () => read().h, commit: (value) => commit({ h: Math.max(0, value) }, '修改高度') }),
      ]));
    } else if (type === 'text') {
      children.push(textField('文本', { read: () => read().text, commit: (value) => commit({ text: value }, '修改文本') }));
      children.push(grid([
        numberField('字号 (mm)', { read: () => read().size, step: 0.1, commit: (value) => commit({ size: value }, '修改字号') }),
        numberField('旋转 (°)', { read: () => read().rotation, step: 90, commit: (value) => commit({ rotation: value }, '旋转文本') }),
      ]));
    } else if (type === 'circle' || type === 'arc') {
      children.push(infoList([
        ['圆心', '(' + formatNumber(read().cx) + ', ' + formatNumber(read().cy) + ')'],
        ['半径', formatNumber(read().r) + ' mm'],
        ['说明', '圆形/圆弧几何暂为只读，可修改图层与线宽后重新绘制。'],
      ]));
    } else {
      const points = Array.isArray(read().points) ? read().points : [];
      children.push(infoList([
        ['折点数', points.length],
        ['起点', points[0] ? '(' + formatNumber(points[0].x) + ', ' + formatNumber(points[0].y) + ')' : '—'],
        ['终点', points[points.length - 1]
          ? '(' + formatNumber(points[points.length - 1].x) + ', ' + formatNumber(points[points.length - 1].y) + ')'
          : '—'],
        ['说明', '选择工具可直接拖动图形。'],
      ]));
    }
    body.appendChild(section('图形属性 · ' + type, children));
    body.appendChild(actionsRow([
      actionButton('删除图形', () => runFootprint('删除', (editor) => editor.deleteSelection()), {
        icon: 'trash', danger: true,
      }),
    ]));
  }

  // ---- 事件订阅 ----

  const offs = [];
  offs.push(store.on('selection', () => refresh(true)));
  offs.push(store.on('changed', () => refresh()));
  offs.push(store.on('sheet', () => refresh(true)));

  /**
   * 切换当前封装编辑器（进入/退出封装模式时由 app 调用）。
   * @param {object|null} editor createFootprintEditor 实例
   */
  function setFootprintEditor(editor) {
    for (const off of footprintUnsubs) {
      if (typeof off === 'function') off();
    }
    footprintUnsubs = [];
    footprintEditor = editor || null;
    editorToken += 1;
    if (footprintEditor) {
      const fstore = footprintEditor.getStore();
      if (fstore && typeof fstore.on === 'function') {
        footprintUnsubs.push(fstore.on('selection', () => refresh(true)));
        footprintUnsubs.push(fstore.on('changed', () => refresh()));
      }
      if (typeof footprintEditor.on === 'function') {
        footprintUnsubs.push(footprintEditor.on('tool', () => refresh(true)));
      }
    }
    refresh(true);
  }

  setFootprintEditor(null);

  return {
    element,
    refresh,
    setFootprintEditor,
    getFootprintEditor: () => footprintEditor,
    getCurrentSelection: () => currentSelection,
    destroy() {
      for (const off of offs) {
        if (typeof off === 'function') off();
      }
      for (const off of footprintUnsubs) {
        if (typeof off === 'function') off();
      }
      offs.length = 0;
      footprintUnsubs = [];
      bindings = [];
      clear(body);
    },
  };
}
