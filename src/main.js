// 应用入口：挂载占位骨架并触发启动流程（最终版由 UI 任务定稿）。
export const APP_VERSION = '0.1.0';

/**
 * 启动应用。
 * @param {HTMLElement} [root] 挂载容器，默认为 #app
 * @returns {Promise<{ version: string, root: HTMLElement | null }>} 启动结果
 */
export async function bootstrap(root) {
  const target = root || (typeof document === 'undefined' ? null : document.getElementById('app'));
  const message = `原理图工作室 v${APP_VERSION} · 脚手架就绪，等待 UI 模块加载`;

  if (target) {
    target.textContent = message;
  }
  console.log(`[schematic-studio] ${message}`);

  return { version: APP_VERSION, root: target || null };
}

if (typeof document !== 'undefined') {
  bootstrap(document.getElementById('app'));
}
