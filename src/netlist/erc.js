// ERC：基于连通性分析结果执行规则检查，输出带定位信息的告警（不修改工程数据）。
import { analyzeProject } from './connectivity.js';

export const ERC_CODES = Object.freeze([
  'FLOATING_PIN',
  'SINGLE_PIN_NET',
  'DUPLICATE_DESIGNATOR',
  'MISSING_FOOTPRINT',
  'UNCONNECTED_WIRE',
  'POWER_OUT_CONFLICT',
]);

/** 位号占位符（含 ?）表示尚未标注，不参与重复位号检查。 */
function isAnnotated(designator) {
  return typeof designator === 'string' && designator.trim() !== '' && !designator.includes('?');
}

function pinRef(pin, net) {
  return {
    sheetId: pin.sheetId || null,
    designator: pin.designator,
    instanceId: pin.instanceId,
    pinNumber: pin.pinNumber,
    netName: net.name,
    x: pin.x,
    y: pin.y,
  };
}

function checkNets(analysis, warnings) {
  for (const net of analysis.nets) {
    if (net.pins.length === 0) {
      for (const wire of net.wires) {
        const first = wire.points && wire.points.length > 0 ? wire.points[0] : null;
        warnings.push({
          code: 'UNCONNECTED_WIRE',
          message: '导线未连接到任何引脚（网络 ' + net.name + '）',
          ref: {
            sheetId: wire.sheetId || (net.sheetIds && net.sheetIds[0]) || null,
            wireId: wire.id || null,
            netName: net.name,
            x: first ? first.x : undefined,
            y: first ? first.y : undefined,
          },
        });
      }
      continue;
    }

    if (net.pins.length === 1) {
      const pin = net.pins[0];
      // 电源/地符号的引脚天生只连一个网络，不应算作悬空或单脚网络。
      if (pin.power === true) continue;
      const isolated = net.wires.length === 0 && net.labels.length === 0;
      warnings.push({
        code: isolated ? 'FLOATING_PIN' : 'SINGLE_PIN_NET',
        message: isolated
          ? '引脚 ' + pin.designator + '-' + pin.pinNumber + ' 未连接任何导线'
          : '网络 ' + net.name + ' 只有 1 个引脚（' + pin.designator + '-' + pin.pinNumber + '），可能是悬空导线',
        ref: pinRef(pin, net),
      });
    }

    const powerOutPins = net.pins.filter((pin) => pin.electricalType === 'power_out');
    if (powerOutPins.length > 1) {
      warnings.push({
        code: 'POWER_OUT_CONFLICT',
        message:
          '网络 ' + net.name + ' 上有 ' + powerOutPins.length + ' 个 power_out 引脚（' +
          powerOutPins.map((pin) => pin.designator + '-' + pin.pinNumber).join('、') +
          '），电源输出冲突',
        ref: {
          sheetId: powerOutPins[0].sheetId || null,
          netName: net.name,
          designators: powerOutPins.map((pin) => pin.designator),
          x: powerOutPins[0].x,
          y: powerOutPins[0].y,
        },
      });
    }
  }
}

/** 判断实例是否必须有 PCB 封装：电源/地、虚拟器件（socket、测试点）不需要。 */
function needsFootprint(component) {
  if (component.power) return false;
  if (component.virtual) return false;
  const refPrefix = typeof component.refPrefix === 'string' ? component.refPrefix.trim().toUpperCase() : '';
  if (refPrefix.startsWith('#')) return false;
  if (refPrefix === 'TP') return false;
  return true;
}

function checkComponents(analysis, warnings) {
  const byDesignator = new Map();
  for (const component of analysis.components) {
    if (component.power) continue;
    if (!isAnnotated(component.designator)) continue;
    if (!byDesignator.has(component.designator)) byDesignator.set(component.designator, []);
    byDesignator.get(component.designator).push(component);
  }

  for (const [designator, list] of byDesignator) {
    if (list.length < 2) continue;
    for (const component of list) {
      warnings.push({
        code: 'DUPLICATE_DESIGNATOR',
        message: '位号 ' + designator + ' 重复出现 ' + list.length + ' 次',
        ref: {
          sheetId: component.sheetId || null,
          designator,
          instanceId: component.instanceId,
          x: component.x,
          y: component.y,
        },
      });
    }
  }

  for (const component of analysis.components) {
    if (!needsFootprint(component)) continue;
    const footprint = typeof component.footprintId === 'string' ? component.footprintId.trim() : '';
    if (footprint !== '') continue;
    warnings.push({
      code: 'MISSING_FOOTPRINT',
      message: '位号 ' + component.designator + ' 未指定封装，无法生成 PCB 网表',
      ref: {
        sheetId: component.sheetId || null,
        designator: component.designator,
        instanceId: component.instanceId,
        x: component.x,
        y: component.y,
      },
    });
  }
}

/**
 * 执行电气规则检查。
 * @param {object} project 工程数据
 * @param {object} options { analysis?, symbols?, tolerance? } —— 传入已算好的 analysis 可避免重复计算
 * @returns {{ ok: boolean, warnings: object[] }} ok 表示无告警
 */
export function runERC(project, options = {}) {
  const analysis = options.analysis || analyzeProject(project, options);
  const warnings = [];
  checkNets(analysis, warnings);
  checkComponents(analysis, warnings);
  return { ok: warnings.length === 0, warnings };
}

/** 兼容别名：直接返回告警数组。 */
export function ercWarnings(project, options = {}) {
  return runERC(project, options).warnings;
}
