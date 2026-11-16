// IO 层测试夹具：合法工程 + 特殊字符 + 旋转符号 + 缺失符号。
import {
  createJunction,
  createLabel,
  createProject,
  createSymbolInstance,
  createText,
  createWire,
} from '../../src/model/project.js';
import { builtinSymbols } from '../../src/library/builtin-symbols.js';

export function createIoFixture() {
  const project = createProject('IO 测试工程');
  const sheet = project.sheets[0];
  sheet.name = '主图';
  sheet.title = {
    title: 'IO 与导出验证',
    company: 'Schematic <Studio> & Co',
    rev: 'A',
    date: '2026-11-16',
    comments: '首版 <beta> & "quoted"',
  };

  const symbols = builtinSymbols();
  const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  for (const id of ['R', 'LED', 'GND', 'C_POL']) {
    const def = byId.get(id);
    if (def) project.library.symbols.push(def);
  }

  sheet.symbols.push(createSymbolInstance({
    id: 'sym-r1',
    symbolId: 'R',
    designator: 'R1',
    value: '220',
    x: 30,
    y: 30,
    rotation: 0,
    mirror: false,
    footprintId: 'R_0603',
    fields: { note: '<b>&' },
  }));
  sheet.symbols.push(createSymbolInstance({
    id: 'sym-led',
    symbolId: 'LED',
    designator: 'D1',
    value: 'LED <red>',
    x: 30,
    y: 50,
    rotation: 90,
    mirror: false,
    footprintId: null,
    fields: {},
  }));
  sheet.symbols.push(createSymbolInstance({
    id: 'sym-gnd',
    symbolId: 'GND',
    designator: 'GND1',
    value: 'GND',
    x: 30,
    y: 70,
    rotation: 0,
    mirror: false,
    footprintId: null,
    fields: {},
  }));
  sheet.symbols.push(createSymbolInstance({
    id: 'sym-cpol',
    symbolId: 'C_POL',
    designator: 'C1',
    value: '10u',
    x: 60,
    y: 60,
    rotation: 0,
    mirror: false,
    footprintId: 'C_0603',
    fields: {},
  }));
  sheet.symbols.push(createSymbolInstance({
    id: 'sym-missing',
    symbolId: 'NOT_IN_LIB',
    designator: 'U9',
    value: '?',
    x: 80,
    y: 30,
    rotation: 0,
    mirror: false,
    footprintId: null,
    fields: {},
  }));

  sheet.wires.push(createWire([{ x: 30, y: 35.08 }, { x: 30, y: 44.92 }]));
  sheet.wires.push(createWire([{ x: 30, y: 55.08 }, { x: 30, y: 65 }]));
  sheet.junctions.push(createJunction(30, 40));
  sheet.labels.push(createLabel({
    id: 'lbl-global', x: 30, y: 35.08, rotation: 0, text: '+5V & <VCC>', kind: 'global',
  }));
  sheet.labels.push(createLabel({
    id: 'lbl-local', x: 45, y: 40, rotation: 0, text: 'OUT', kind: 'local',
  }));
  sheet.texts.push(createText({
    id: 'txt-note', x: 10, y: 15, rotation: 90, text: '注释 <script>alert("x")</script> & \'q\'', size: 2,
  }));

  return { project, sheet };
}

export function createEmptyProject(name = '空工程') {
  const project = createProject(name);
  project.sheets[0].name = '空白图纸';
  return { project, sheet: project.sheets[0] };
}
