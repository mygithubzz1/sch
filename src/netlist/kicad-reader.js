// KiCad 网表读取：通用 S-表达式词法/语法解析 + KiCad 9（version E）文档投影；纯函数、无 DOM。
//
// 职责边界：本模块只把文本变成「结构化文档」，不构造工程模型（那是 kicad-import.js 的职责）。
// 错误一律以 { line, code, message } 结构化返回（line 为 1-based），绝不抛出异常。
//
// 文档形状（对应 docs/NETLIST_KICAD_SPEC.md §3 与 T4 契约）：
// {
//   version: "E",
//   design: { source, date, tool, sheets: [{ number, name, tstamps, titleBlock }] },
//   components: [{ ref, value, footprint, datasheet?, description?, fields, libsource,
//                  properties, sheetpath, tstamps: string | string[] }],
//   libparts: [{ lib, part, description, docs?, footprints, fields, pins }],
//   libraries: [{ logical, uri }],
//   nets: [{ code, name, class, nodes: [{ ref, pin, pinfunction?, pintype }] }]
// }
// `datasheet` / `description` / `docs` / `pinfunction` 在网表里省略时保持缺键（undefined），
// 以区分「缺 token」与「空串字面量」（§4.4、§8.0）。

const MAX_DEPTH = 256;
const STRING_ESCAPES = Object.freeze({ '\\': '\\', '"': '"', n: '\n', t: '\t' });
const KNOWN_SECTIONS = Object.freeze(['design', 'components', 'libparts', 'libraries', 'nets']);

function diagnostic(line, code, message) {
  return { line, code, message };
}

function isList(node) {
  return Array.isArray(node);
}

/** 列表的结构名（首元素原子），非列表或首元素非原子时返回 null。 */
function headOf(node) {
  if (!isList(node) || typeof node[0] !== 'string') return null;
  return node[0];
}

function isNamed(node, name) {
  return headOf(node) === name;
}

function childLists(node) {
  return isList(node) ? node.filter(isList) : [];
}

function firstChild(node, name) {
  for (const item of childLists(node)) {
    if (isNamed(item, name)) return item;
  }
  return null;
}

function allChildren(node, name) {
  return childLists(node).filter((item) => isNamed(item, name));
}

/**
 * 读取 `(name "value")` 形态子节点的字符串值。
 * 子节点存在但第二个元素缺失（自闭合）时返回 ''；子节点缺失时返回 fallback。
 */
function childText(node, name, fallback = undefined) {
  const child = firstChild(node, name);
  if (!child) return fallback;
  return typeof child[1] === 'string' ? child[1] : '';
}

/**
 * 读取 `(name "a" "b" …)` 形态子节点的全部字符串取值（§3.3.4：KiCad 9 的 comp/tstamps 可多值）。
 * 单值返回字符串（与 childText 行为一致），多值返回按原始顺序的数组，绝不只取首个。
 */
function listTexts(node, name, fallback = undefined) {
  const child = firstChild(node, name);
  if (!child) return fallback;
  const values = [];
  for (let index = 1; index < child.length; index += 1) {
    if (typeof child[index] === 'string') values.push(child[index]);
  }
  if (values.length === 0) return '';
  return values.length === 1 ? values[0] : values;
}

/** 读取 `(field (name "X") "value")` 里紧跟在结构名之后的位置参数字符串。 */
function positionalText(node) {
  for (let index = 1; index < node.length; index += 1) {
    if (typeof node[index] === 'string') return node[index];
  }
  return undefined;
}

/**
 * 词法分析：把文本切成 list-start / list-end / string / atom 记号，并记录 1-based 行号。
 * 字符串支持 `\\` `\"` `\n` `\t` 反转义；未知转义 `\x` 按规范保守保留为 `x`（§2.2）。
 * @param {string} text 输入文本
 * @returns {{ ok: boolean, tokens: object[], errors: object[] }}
 */
export function tokenizeSExpression(text) {
  const source = typeof text === 'string' ? text : '';
  const tokens = [];
  const errors = [];
  let index = 0;
  let line = 1;
  let atStart = true;

  while (index < source.length) {
    const char = source[index];

    if (char === '\uFEFF' && atStart) {
      index += 1;
      continue;
    }
    atStart = false;

    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      if (char === '\n') line += 1;
      index += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: char === '(' ? 'list-start' : 'list-end', value: char, line });
      index += 1;
      continue;
    }

    if (char === '"') {
      const startLine = line;
      let value = '';
      index += 1;
      let closed = false;
      while (index < source.length) {
        const current = source[index];
        if (current === '"') {
          index += 1;
          closed = true;
          break;
        }
        if (current === '\\') {
          const next = source[index + 1];
          if (next === undefined) {
            errors.push(diagnostic(startLine, 'UNTERMINATED_STRING', '字符串在转义符后意外结束'));
            index += 1;
            break;
          }
          if (next === '\n') line += 1;
          value += Object.prototype.hasOwnProperty.call(STRING_ESCAPES, next)
            ? STRING_ESCAPES[next]
            : next;
          index += 2;
          continue;
        }
        if (current === '\n') line += 1;
        value += current;
        index += 1;
      }
      if (!closed) {
        errors.push(diagnostic(startLine, 'UNTERMINATED_STRING', '字符串缺少结束引号'));
      }
      tokens.push({ type: 'string', value, line: startLine });
      continue;
    }

    // atom：直到空白、括号或引号
    const startLine = line;
    let value = '';
    while (index < source.length) {
      const current = source[index];
      if (current === ' ' || current === '\t' || current === '\r' || current === '\n') break;
      if (current === '(' || current === ')' || current === '"') break;
      value += current;
      index += 1;
    }
    if (value === '') {
      errors.push(diagnostic(startLine, 'INVALID_TOKEN', '无法识别的字符 ' + JSON.stringify(source[index])));
      index += 1;
      continue;
    }
    tokens.push({ type: 'atom', value, line: startLine });
  }

  return { ok: errors.length === 0, tokens, errors };
}

/**
 * 通用 S-表达式解析：返回嵌套数组（列表首元素为结构名原子），列表对象带 `.line`（1-based）。
 * @param {string} text 输入文本
 * @returns {{ ok: boolean, tree: any[]|null, errors: object[] }}
 */
export function parseSExpression(text) {
  if (typeof text !== 'string') {
    return {
      ok: false,
      tree: null,
      errors: [diagnostic(1, 'INVALID_INPUT', '网表输入必须是字符串，实际为 ' + typeof text)],
    };
  }
  if (text.trim() === '') {
    return { ok: false, tree: null, errors: [diagnostic(1, 'EMPTY_INPUT', '网表输入为空')] };
  }

  const lexed = tokenizeSExpression(text);
  if (!lexed.ok) return { ok: false, tree: null, errors: lexed.errors };

  const { tokens } = lexed;
  const errors = [];
  let position = 0;

  function parseList(depth) {
    const open = tokens[position];
    if (depth > MAX_DEPTH) {
      errors.push(diagnostic(open.line, 'DEPTH_EXCEEDED', 'S-表达式嵌套超过 ' + MAX_DEPTH + ' 层'));
      return null;
    }
    position += 1; // 跳过 list-start
    const list = [];
    list.line = open.line;
    while (position < tokens.length) {
      const token = tokens[position];
      if (token.type === 'list-end') {
        position += 1;
        return list;
      }
      if (token.type === 'list-start') {
        const child = parseList(depth + 1);
        if (child === null) return list;
        list.push(child);
        continue;
      }
      list.push(token.value);
      position += 1;
    }
    errors.push(diagnostic(open.line, 'UNTERMINATED_LIST', '列表缺少结束括号'));
    return list;
  }

  if (tokens[0].type !== 'list-start') {
    errors.push(diagnostic(tokens[0].line, 'MISSING_EXPORT', '网表必须以 (export …) 列表开头'));
    return { ok: false, tree: null, errors };
  }

  const tree = parseList(0);
  if (position < tokens.length) {
    const extra = tokens[position];
    errors.push(diagnostic(extra.line, 'TRAILING_TOKEN', '根列表之后出现多余内容'));
  }
  if (errors.length > 0) return { ok: false, tree: null, errors };
  return { ok: true, tree, errors };
}

function emptyDesign() {
  return { source: '', date: '', tool: '', sheets: [] };
}

function emptyTitleBlock() {
  return { title: '', company: '', rev: '', date: '', source: '', comments: new Array(9).fill('') };
}

/** 把 title_block 投影为 9 槽评论 + 5 个标量（§3.2.2）。 */
function readTitleBlock(node) {
  const block = emptyTitleBlock();
  if (!isList(node)) return block;
  block.title = childText(node, 'title', '');
  block.company = childText(node, 'company', '');
  block.rev = childText(node, 'rev', '');
  block.date = childText(node, 'date', '');
  block.source = childText(node, 'source', '');
  const comments = new Array(9).fill('');
  for (const comment of allChildren(node, 'comment')) {
    const raw = childText(comment, 'number', '');
    const slot = Number.parseInt(raw, 10);
    const value = childText(comment, 'value', '');
    if (Number.isInteger(slot) && slot >= 1 && slot <= 9) comments[slot - 1] = value;
  }
  block.comments = comments;
  return block;
}

function readSheet(node) {
  return {
    number: childText(node, 'number', ''),
    name: childText(node, 'name', '/'),
    tstamps: childText(node, 'tstamps', '/'),
    titleBlock: readTitleBlock(firstChild(node, 'title_block')),
  };
}

/** `(fields (field (name "X") ?"value"))` → [{ name, value? }]，保序（§3.3.1）。 */
function readFieldEntries(node) {
  const entries = [];
  for (const field of allChildren(node, 'field')) {
    const name = childText(field, 'name', '');
    if (name === '') continue;
    const entry = { name };
    const value = positionalText(field);
    if (value !== undefined) entry.value = value;
    entries.push(entry);
  }
  return entries;
}

/** `(property (name "X") ?(value "Y"))` → [{ name, value? }]，保序（§3.3.2）。 */
function readProperties(node, errors) {
  const entries = [];
  for (const property of allChildren(node, 'property')) {
    const name = childText(property, 'name', '');
    if (name === '') {
      errors.push(diagnostic(property.line || 1, 'MISSING_PROPERTY_NAME', 'property 缺少 name'));
      continue;
    }
    const entry = { name };
    const value = childText(property, 'value', undefined);
    if (value !== undefined) entry.value = value;
    entries.push(entry);
  }
  return entries;
}

function readLibsource(node) {
  const libsource = firstChild(node, 'libsource');
  return {
    lib: libsource ? childText(libsource, 'lib', '') : '',
    part: libsource ? childText(libsource, 'part', '') : '',
    description: libsource ? childText(libsource, 'description', '') : '',
  };
}

function readSheetPath(node) {
  const sheetpath = firstChild(node, 'sheetpath');
  return {
    names: sheetpath ? childText(sheetpath, 'names', '/') : '/',
    tstamps: sheetpath ? childText(sheetpath, 'tstamps', '/') : '/',
  };
}

function readComponent(node, errors, warnings) {
  const ref = childText(node, 'ref', '');
  if (ref === '') {
    errors.push(diagnostic(node.line || 1, 'MISSING_COMP_REF', 'comp 缺少 ref'));
  }
  const component = {
    ref,
    value: childText(node, 'value', ''),
    footprint: childText(node, 'footprint', ''),
    fields: readFieldEntries(firstChild(node, 'fields')),
    libsource: readLibsource(node),
    properties: readProperties(node, errors),
    sheetpath: readSheetPath(node),
    tstamps: listTexts(node, 'tstamps', ''),
  };
  const datasheet = childText(node, 'datasheet', undefined);
  if (datasheet !== undefined) component.datasheet = datasheet;
  const description = childText(node, 'description', undefined);
  if (description !== undefined) component.description = description;
  if (component.libsource.lib === '' && component.libsource.part === '') {
    warnings.push({ code: 'COMP_LIBSOURCE_MISSING', message: 'comp ' + ref + ' 缺少 libsource' });
  }
  if (component.tstamps === '') {
    warnings.push({ code: 'COMP_TSTAMPS_MISSING', message: 'comp ' + ref + ' 缺少 tstamps' });
  }
  return component;
}

function readLibpartPin(node, errors) {
  const num = childText(node, 'num', '');
  if (num === '') {
    errors.push(diagnostic(node.line || 1, 'MISSING_PIN_NUM', 'libpart pin 缺少 num'));
  }
  const type = childText(node, 'type', '');
  if (type === '') {
    errors.push(diagnostic(node.line || 1, 'MISSING_PIN_TYPE', 'libpart pin ' + num + ' 缺少 type'));
  }
  return { num, name: childText(node, 'name', ''), type: type === '' ? 'passive' : type };
}

function readLibpart(node, errors) {
  const lib = childText(node, 'lib', '');
  const part = childText(node, 'part', '');
  if (lib === '' || part === '') {
    errors.push(diagnostic(node.line || 1, 'MISSING_LIBPART_KEY', 'libpart 缺少 lib 或 part'));
  }
  const footprintsNode = firstChild(node, 'footprints');
  const footprints = footprintsNode
    ? allChildren(footprintsNode, 'fp')
        .map((fp) => (typeof fp[1] === 'string' ? fp[1] : ''))
        .filter((value) => value !== '')
    : [];
  const pinsNode = firstChild(node, 'pins');
  // 0 引脚符号（如 Fiducial）合法：没有 pins 段时 pins 为空数组（§3.4）。
  const pins = pinsNode ? allChildren(pinsNode, 'pin').map((pin) => readLibpartPin(pin, errors)) : [];
  const libpart = {
    lib,
    part,
    description: childText(node, 'description', ''),
    footprints,
    fields: readFieldEntries(firstChild(node, 'fields')),
    pins,
  };
  const docs = childText(node, 'docs', undefined);
  if (docs !== undefined) libpart.docs = docs;
  return libpart;
}

function readLibrary(node, errors) {
  const logical = childText(node, 'logical', '');
  if (logical === '') {
    errors.push(diagnostic(node.line || 1, 'MISSING_LIBRARY_LOGICAL', 'library 缺少 logical'));
  }
  return { logical, uri: childText(node, 'uri', '') };
}

function readNode(node, errors) {
  const ref = childText(node, 'ref', '');
  const pin = childText(node, 'pin', '');
  if (ref === '' || pin === '') {
    errors.push(diagnostic(node.line || 1, 'MISSING_NODE_KEY', 'node 缺少 ref 或 pin'));
  }
  const entry = { ref, pin };
  const pinfunction = childText(node, 'pinfunction', undefined);
  if (pinfunction !== undefined) entry.pinfunction = pinfunction;
  entry.pintype = childText(node, 'pintype', 'passive');
  return entry;
}

function readNet(node, errors) {
  const name = childText(node, 'name', '');
  if (name === '') {
    errors.push(diagnostic(node.line || 1, 'MISSING_NET_NAME', 'net 缺少 name'));
  }
  return {
    code: childText(node, 'code', ''),
    name,
    class: childText(node, 'class', 'Default'),
    nodes: allChildren(node, 'node').map((item) => readNode(item, errors)),
  };
}

/**
 * 读取 KiCad 9 网表文本，投影为结构化文档。
 * 成功时返回的顶层对象即为文档（含 ok/errors/warnings 元信息）；失败时 ok:false，各文档字段为空壳。
 * @param {string} text 网表文本（允许 CRLF，不要求结尾换行）
 * @returns {{ ok: boolean, version: string|null, design: object|null, components: object[],
 *             libparts: object[], libraries: object[], nets: object[], errors: object[], warnings: object[] }}
 */
export function readKiCadNetlist(text) {
  const parsed = parseSExpression(text);
  if (!parsed.ok) {
    return {
      ok: false,
      version: null,
      design: null,
      components: [],
      libparts: [],
      libraries: [],
      nets: [],
      errors: parsed.errors,
      warnings: [],
    };
  }

  const errors = [];
  const warnings = [];
  const root = parsed.tree;
  if (headOf(root) !== 'export') {
    errors.push(
      diagnostic(root.line || 1, 'MISSING_EXPORT', '根列表必须是 (export …)，实际为 ' + String(headOf(root))),
    );
    return {
      ok: false,
      version: null,
      design: null,
      components: [],
      libparts: [],
      libraries: [],
      nets: [],
      errors,
      warnings,
    };
  }

  const version = childText(root, 'version', '');
  if (version === '') {
    errors.push(diagnostic(root.line || 1, 'MISSING_VERSION', 'export 缺少 version'));
  } else if (version !== 'E') {
    warnings.push({
      code: 'UNEXPECTED_VERSION',
      message: '网表 version 为 "' + version + '"，本导入器按 KiCad 9（version E）规范解析',
    });
  }

  const designNode = firstChild(root, 'design');
  if (!designNode) {
    errors.push(diagnostic(root.line || 1, 'MISSING_SECTION', '缺少 design 段'));
  }
  const componentsNode = firstChild(root, 'components');
  if (!componentsNode) {
    errors.push(diagnostic(root.line || 1, 'MISSING_SECTION', '缺少 components 段'));
  }
  const netsNode = firstChild(root, 'nets');
  if (!netsNode) {
    errors.push(diagnostic(root.line || 1, 'MISSING_SECTION', '缺少 nets 段'));
  }
  const libpartsNode = firstChild(root, 'libparts');
  if (!libpartsNode) warnings.push({ code: 'MISSING_LIBPARTS', message: '网表没有 libparts 段' });
  const librariesNode = firstChild(root, 'libraries');
  if (!librariesNode) warnings.push({ code: 'MISSING_LIBRARIES', message: '网表没有 libraries 段' });

  for (const section of childLists(root)) {
    const head = headOf(section);
    if (head === null || head === 'version' || head === 'export') continue;
    if (!KNOWN_SECTIONS.includes(head)) {
      warnings.push({ code: 'UNKNOWN_SECTION', message: '忽略未知顶层段 ' + String(head) });
    }
  }

  const design = emptyDesign();
  if (designNode) {
    design.source = childText(designNode, 'source', '');
    design.date = childText(designNode, 'date', '');
    design.tool = childText(designNode, 'tool', '');
    design.sheets = allChildren(designNode, 'sheet').map(readSheet);
    if (design.sheets.length === 0) {
      errors.push(diagnostic(designNode.line || 1, 'MISSING_SHEET', 'design 段没有任何 sheet'));
    }
  }

  const components = componentsNode
    ? allChildren(componentsNode, 'comp').map((node) => readComponent(node, errors, warnings))
    : [];
  const libparts = libpartsNode
    ? allChildren(libpartsNode, 'libpart').map((node) => readLibpart(node, errors))
    : [];
  const libraries = librariesNode
    ? allChildren(librariesNode, 'library').map((node) => readLibrary(node, errors))
    : [];
  const nets = netsNode ? allChildren(netsNode, 'net').map((node) => readNet(node, errors)) : [];

  if (errors.length > 0) {
    return {
      ok: false,
      version: version === '' ? null : version,
      design,
      components,
      libparts,
      libraries,
      nets,
      errors,
      warnings,
    };
  }
  return { ok: true, version, design, components, libparts, libraries, nets, errors, warnings };
}
