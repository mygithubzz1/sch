// 应用入口：把 #app 交给 UI 装配层启动，异常时给出可见提示。
import { APP_VERSION, startApp } from './ui/app.js';

export { APP_VERSION };

/**
 * 启动应用。
 * @param {HTMLElement} [root] 挂载容器，默认为 #app
 * @returns {Promise<{ version: string, root: HTMLElement|null, app: object|null }>} 启动结果
 */
export async function bootstrap(root) {
  if (typeof document === 'undefined') {
    return { version: APP_VERSION, root: null, app: null };
  }
  const target = root || document.getElementById('app');
  if (!target) throw new Error('找不到挂载节点 #app');
  const app = await startApp(target);
  console.log('[schematic-studio] v' + APP_VERSION + ' 已启动');
  return { version: APP_VERSION, root: target, app };
}

if (typeof document !== 'undefined') {
  bootstrap().catch((error) => {
    console.error('[schematic-studio] 启动失败', error);
    const target = document.getElementById('app');
    if (target) {
      target.textContent = '应用启动失败：' + (error && error.message ? error.message : String(error));
    }
  });
}
