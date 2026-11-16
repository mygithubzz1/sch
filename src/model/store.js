// 应用状态仓库：工程、当前图纸、选择集、悬浮与撤销栈，无 DOM 依赖。
import { CommandStack } from '../core/command.js';
import { createBus } from '../core/event-bus.js';
import {
  ENTITY_COLLECTIONS,
  clone,
  findSheetById,
  normalizeProject,
  nowIso,
} from './project.js';

/**
 * 创建应用状态仓库。
 * @param {object} [initialProject] 初始工程，缺省时生成空白工程
 * @returns {object} store API
 */
export function createStore(initialProject) {
  const bus = createBus();
  const state = {
    project: normalizeProject(initialProject),
    sheetId: null,
    selection: [],
    hover: null,
    view: null,
  };
  state.sheetId = firstSheetId(state.project);

  let commands = null;
  let lastNotifiedSheetId = state.sheetId;

  function firstSheetId(project) {
    return project && Array.isArray(project.sheets) && project.sheets[0] ? project.sheets[0].id : null;
  }

  function getSheet() {
    return findSheetById(state.project, state.sheetId) || state.project.sheets[0] || null;
  }

  function getProject() {
    return state.project;
  }

  function syncSheetId() {
    if (!findSheetById(state.project, state.sheetId)) {
      state.sheetId = firstSheetId(state.project);
    }
  }

  function getSheetId() {
    return state.sheetId;
  }

  function setSheetId(id) {
    if (typeof id !== 'string' || id === '') return false;
    const sheet = findSheetById(state.project, id);
    if (!sheet) return false;
    if (state.sheetId !== id) {
      state.sheetId = id;
      lastNotifiedSheetId = id;
      state.selection = [];
      state.hover = null;
      bus.emit('sheet', { sheetId: id, sheet });
      bus.emit('selection', { ids: [] });
    }
    return true;
  }

  function getSelection() {
    return [...state.selection];
  }

  function setSelection(ids) {
    const next = Array.isArray(ids)
      ? [...new Set(ids.filter((id) => typeof id === 'string' && id !== ''))]
      : [];
    if (sameIds(state.selection, next)) return [...state.selection];
    state.selection = next;
    bus.emit('selection', { ids: [...next] });
    return [...state.selection];
  }

  function getHover() {
    return state.hover;
  }

  function setHover(id) {
    const next = typeof id === 'string' && id !== '' ? id : null;
    if (state.hover === next) return state.hover;
    state.hover = next;
    bus.emit('hover', { id: next });
    return state.hover;
  }

  function getView() {
    return state.view;
  }

  function setView(view) {
    state.view = view;
    bus.emit('view', view);
    return state.view;
  }

  function on(eventName, handler) {
    return bus.on(eventName, handler);
  }

  function emit(eventName, payload) {
    return bus.emit(eventName, payload);
  }

  /** 通过命令栈执行一次可撤销修改。mutator(sheet, project) 原地修改草稿。 */
  function update(mutator, options = {}) {
    if (typeof mutator !== 'function') {
      throw new TypeError('store.update 需要 mutator(sheet, project) 函数');
    }
    const targetSheetId = state.sheetId;
    const label = options.label || '编辑';
    const before = clone(state.project);
    let after = null;

    commands.execute({
      label,
      do() {
        if (!after) {
          const draft = clone(before);
          const sheet = findSheetById(draft, targetSheetId) || draft.sheets[0] || null;
          mutator(sheet, draft);
          draft.meta = { ...draft.meta, modified: nowIso() };
          after = draft;
        }
        state.project = clone(after);
      },
      undo() {
        state.project = clone(before);
      },
    });

    return getSheet();
  }

  /** 替换工程；history 为 true 时进入撤销栈，否则视为新文档并清空历史。 */
  function setProject(nextProject, options = {}) {
    const normalized = normalizeProject(nextProject);
    if (options.history === true) {
      const before = clone(state.project);
      const beforeSheetId = state.sheetId;
      commands.execute({
        label: options.label || '加载工程',
        do() {
          state.project = clone(normalized);
          syncSheetId();
        },
        undo() {
          state.project = clone(before);
          state.sheetId = beforeSheetId;
        },
      });
    } else {
      state.project = normalized;
      state.selection = [];
      state.hover = null;
      syncSheetId();
      lastNotifiedSheetId = state.sheetId;
      commands.clear();
      bus.emit('selection', { ids: [] });
    }
    return state.project;
  }

  function undo() {
    return commands.undo();
  }

  function redo() {
    return commands.redo();
  }

  function canUndo() {
    return commands.canUndo();
  }

  function canRedo() {
    return commands.canRedo();
  }

  function pruneSelection() {
    if (state.selection.length === 0) return;
    const sheet = getSheet();
    const alive = new Set();
    if (sheet) {
      for (const kind of ENTITY_COLLECTIONS) {
        const collection = sheet[kind];
        if (!Array.isArray(collection)) continue;
        for (const entity of collection) {
          if (entity && typeof entity.id === 'string') alive.add(entity.id);
        }
      }
    }
    const next = state.selection.filter((id) => alive.has(id));
    if (next.length === state.selection.length) return;
    state.selection = next;
    bus.emit('selection', { ids: [...next] });
  }

  const api = {
    getProject,
    setProject,
    getSheet,
    getSheetId,
    setSheetId,
    update,
    undo,
    redo,
    canUndo,
    canRedo,
    getSelection,
    setSelection,
    getHover,
    setHover,
    getView,
    setView,
    on,
    emit,
    commands: null,
    get project() {
      return state.project;
    },
    set project(value) {
      state.project = normalizeProject(value);
      syncSheetId();
    },
    get sheetId() {
      return state.sheetId;
    },
    get selection() {
      return [...state.selection];
    },
    get hover() {
      return state.hover;
    },
  };

  commands = new CommandStack(api);
  api.commands = commands;

  commands.onChange((info) => {
    syncSheetId();
    if (state.sheetId !== lastNotifiedSheetId) {
      lastNotifiedSheetId = state.sheetId;
      bus.emit('sheet', { sheetId: state.sheetId, sheet: getSheet() });
    }
    pruneSelection();
    bus.emit('changed', {
      project: state.project,
      sheet: getSheet(),
      reason: info.type,
      label: info.label,
    });
  });

  return api;
}

function sameIds(a, b) {
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}
