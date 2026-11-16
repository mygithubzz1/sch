// 示例工程数据：按需动态导入 examples/*.json（JSON 数据导入白名单），旧浏览器加载失败时给出可读错误而不白屏。
const EXAMPLE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'led',
    label: 'LED 指示灯',
    description: 'VCC → 220Ω → LED → GND 的最小电路（4 个符号 / 3 段导线 / 3 个网络）',
    load: () => import('../../examples/demo-led.json', { with: { type: 'json' } }),
  }),
  Object.freeze({
    id: 'mcu',
    label: 'MCU 最小系统',
    description: 'MCU_16 + 去耦电容 + 晶振 + 测试点，含 +5V / GND 电源网络与自定义封装',
    load: () => import('../../examples/demo-mcu.json', { with: { type: 'json' } }),
  }),
]);

/** 示例工程元数据（不含工程数据，可安全用于渲染菜单）。 */
export const EXAMPLE_PROJECTS = Object.freeze(
  EXAMPLE_DEFINITIONS.map((definition) => Object.freeze({
    id: definition.id,
    label: definition.label,
    description: definition.description,
  })),
);

/** 示例元数据列表副本。 */
export function exampleProjects() {
  return EXAMPLE_PROJECTS.slice();
}

/** 按 id 取示例元数据；未知 id 返回 null。 */
export function getExampleMetadata(id) {
  return EXAMPLE_PROJECTS.find((example) => example.id === id) || null;
}

/**
 * 动态载入示例工程数据；失败时以结构化错误返回，调用方负责提示（不抛异常）。
 * @param {string} id 示例 id
 * @returns {Promise<{id: string, label: string, data: object|null, error: string|null}>}
 */
export async function loadExampleProject(id) {
  const definition = EXAMPLE_DEFINITIONS.find((example) => example.id === id) || null;
  if (!definition) {
    return { id, label: '', data: null, error: '找不到示例工程：' + String(id) };
  }
  try {
    const module = await definition.load();
    const data = module && module.default && typeof module.default === 'object' ? module.default : null;
    if (!data) {
      return { id, label: definition.label, data: null, error: '示例工程数据格式无效：' + definition.id };
    }
    return { id, label: definition.label, data, error: null };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return {
      id,
      label: definition.label,
      data: null,
      error: '无法加载示例工程，需要支持 JSON 模块的浏览器（Chrome/Edge 123+）。原因：' + message,
    };
  }
}
