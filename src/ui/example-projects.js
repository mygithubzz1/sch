// 示例工程数据：静态导入 examples/*.json，供「文件 → 打开示例」直接使用，不依赖 fetch 路径。
import demoLed from '../../examples/demo-led.json' with { type: 'json' };
import demoMcu from '../../examples/demo-mcu.json' with { type: 'json' };

export const EXAMPLE_PROJECTS = Object.freeze([
  Object.freeze({
    id: 'led',
    label: 'LED 指示灯',
    description: 'VCC → 220Ω → LED → GND 的最小电路（4 个符号 / 3 段导线 / 3 个网络）',
    data: demoLed,
  }),
  Object.freeze({
    id: 'mcu',
    label: 'MCU 最小系统',
    description: 'MCU_16 + 去耦电容 + 晶振 + 测试点，含 +5V / GND 电源网络与自定义封装',
    data: demoMcu,
  }),
]);

/** 按 id 取示例工程，未知 id 返回 null。 */
export function getExampleProject(id) {
  return EXAMPLE_PROJECTS.find((example) => example.id === id) || null;
}

/** 示例工程的 JSON 文本（交给 deserializeProject 做严格校验）。 */
export function exampleProjectText(id) {
  const example = getExampleProject(id);
  return example ? JSON.stringify(example.data) : '';
}
