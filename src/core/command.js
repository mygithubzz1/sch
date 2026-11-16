// 撤销/重做命令栈：execute 入栈并清空 redo，undo/redo 维护双栈，状态变化后通知监听者。
export class CommandStack {
  /**
   * @param {*} [state] 传给命令 this.state 的上下文（通常由 store 提供）
   * @param {{ maxDepth?: number }} [options] maxDepth 限制历史深度，默认不限制
   */
  constructor(state = null, options = {}) {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    const limit = Number(options.maxDepth);
    this.maxDepth = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity;
  }

  /** 执行命令并入栈；do 抛错时不污染栈。返回被执行的命令。 */
  execute(command) {
    assertCommand(command);
    command.do();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    this.redoStack.length = 0;
    this.notify('execute', command);
    return command;
  }

  /** 撤销最近一条命令，返回命令或 null。 */
  undo() {
    const command = this.undoStack.pop();
    if (!command) return null;
    command.undo();
    this.redoStack.push(command);
    this.notify('undo', command);
    return command;
  }

  /** 重做最近一次撤销，返回命令或 null。 */
  redo() {
    const command = this.redoStack.pop();
    if (!command) return null;
    command.do();
    this.undoStack.push(command);
    this.notify('redo', command);
    return command;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  /** 订阅状态变化，返回取消订阅函数。 */
  onChange(handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('onChange 需要函数');
    }
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** 清空双栈并通知监听者。 */
  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.notify('clear', null);
  }

  /** 查看下一条可撤销命令（不修改状态）。 */
  peekUndo() {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1] : null;
  }

  /** 查看下一条可重做命令（不修改状态）。 */
  peekRedo() {
    return this.redoStack.length ? this.redoStack[this.redoStack.length - 1] : null;
  }

  notify(type, command) {
    const info = {
      type,
      label: command && command.label ? command.label : '',
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    };
    for (const handler of [...this.listeners]) {
      handler(info);
    }
  }
}

function assertCommand(command) {
  if (!command || typeof command.do !== 'function' || typeof command.undo !== 'function') {
    throw new TypeError('命令必须是 { label, do(), undo() } 对象');
  }
}
