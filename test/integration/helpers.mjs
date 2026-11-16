// 集成测试共享工具：模块枚举、注释剥离、import 说明符解析/解析目标与浏览器全局清单（仅供测试使用）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SRC = path.join(ROOT, 'src');

/** 禁止在零 DOM 层出现的浏览器全局（与各层 purity 测试保持同一清单）。 */
export const DOM_GLOBALS = Object.freeze([
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLImageElement',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'CanvasRenderingContext2D',
  'getComputedStyle',
  'globalThis',
]);

/** 递归列出目录下指定扩展名的文件（按路径排序，保证断言信息稳定）。 */
export function listFiles(directory, extension) {
  const result = [];
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(full, extension));
    } else if (entry.isFile() && (extension === undefined || entry.name.endsWith(extension))) {
      result.push(full);
    }
  }
  return result.sort();
}

/** 相对仓库根的 POSIX 路径，用于稳定的失败信息。 */
export function relativeToRoot(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

/** 根据上一个记号判断 / 是正则字面量起始还是除号。 */
function regexAllowed(previousToken) {
  if (previousToken === '') return true;
  if (/^[A-Za-z0-9_$]+$/.test(previousToken)) return REGEX_KEYWORDS.has(previousToken);
  return ['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '~', '<', '>'].includes(
    previousToken,
  );
}

/**
 * 去掉块注释与行注释，同时保留字符串、模板字符串与正则字面量原文
 * （示例工程 import 说明符里的 .json 不能被注释正则误删）。
 */
export function stripComments(source) {
  let output = '';
  let index = 0;
  let previousToken = '';
  const length = source.length;

  while (index < length) {
    const character = source[index];

    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      output += character;
      index += 1;
      while (index < length) {
        const current = source[index];
        output += current;
        index += 1;
        if (current === '\\') {
          if (index < length) {
            output += source[index];
            index += 1;
          }
          continue;
        }
        if (current === quote) break;
      }
      previousToken = 'value';
      continue;
    }

    if (character === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index = Math.min(length, index + 2);
      continue;
    }

    if (character === '/' && source[index + 1] === '/') {
      while (index < length && source[index] !== '\n') index += 1;
      continue;
    }

    if (character === '/' && regexAllowed(previousToken)) {
      output += character;
      index += 1;
      let inClass = false;
      while (index < length) {
        const current = source[index];
        if (current === '\\') {
          output += current;
          index += 1;
          if (index < length) {
            output += source[index];
            index += 1;
          }
          continue;
        }
        output += current;
        index += 1;
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        else if (current === '/' && !inClass) break;
        else if (current === '\n') break;
      }
      while (index < length && /[a-z]/i.test(source[index])) {
        output += source[index];
        index += 1;
      }
      previousToken = 'value';
      continue;
    }

    if (/[A-Za-z0-9_$]/.test(character)) {
      let word = '';
      while (index < length && /[A-Za-z0-9_$.]/.test(source[index])) {
        word += source[index];
        output += source[index];
        index += 1;
      }
      previousToken = word;
      continue;
    }

    output += character;
    if (!/\s/.test(character)) previousToken = character;
    index += 1;
  }

  return output;
}

function isWordChar(character) {
  return typeof character === 'string' && /[A-Za-z0-9_$]/.test(character);
}

/** import/export 关键字是否位于语句起始（行首或 ; } 之后），避免匹配字符串/注释里的单词。 */
function isStatementStart(code, index) {
  let cursor = index - 1;
  while (cursor >= 0 && (code[cursor] === ' ' || code[cursor] === '\t' || code[cursor] === '\r')) cursor -= 1;
  if (cursor < 0) return true;
  return code[cursor] === '\n' || code[cursor] === ';' || code[cursor] === '}';
}

function readString(code, quoteIndex) {
  const quote = code[quoteIndex];
  let cursor = quoteIndex + 1;
  let value = '';
  while (cursor < code.length && code[cursor] !== quote) {
    value += code[cursor];
    cursor += 1;
  }
  return value;
}

/** 从 import/export 关键字之后读取模块说明符；非导入语句返回 null。 */
function readSpecifierAfter(code, start, keyword) {
  let depth = 0;
  let cursor = start;
  while (cursor < code.length) {
    const character = code[cursor];
    if (character === '{') {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (character === '}') {
      depth = Math.max(0, depth - 1);
      cursor += 1;
      continue;
    }
    if (depth === 0) {
      if (character === ';' || character === '\n' || character === '=' || character === '.') return null;
      if (
        character === 'f' &&
        code.startsWith('from', cursor) &&
        !isWordChar(code[cursor - 1]) &&
        !isWordChar(code[cursor + 4])
      ) {
        let next = cursor + 4;
        while (next < code.length && /\s/.test(code[next])) next += 1;
        const quote = code[next];
        return quote === '"' || quote === "'" ? readString(code, next) : null;
      }
      if (keyword === 'import' && (character === '"' || character === "'")) {
        return readString(code, cursor);
      }
      if (keyword === 'import' && character === '(') {
        let next = cursor + 1;
        while (next < code.length && /\s/.test(code[next])) next += 1;
        const quote = code[next];
        return quote === '"' || quote === "'" ? readString(code, next) : null;
      }
    }
    cursor += 1;
  }
  return null;
}

/**
 * 结构化解析模块级 import/export 说明符（支持跨行 import、再导出、副作用导入与动态 import 字面量）。
 * @param {string} source 模块源码
 * @returns {string[]} 说明符数组（可能重复）
 */
export function extractImportSpecifiers(source) {
  const code = stripComments(source);
  const specifiers = [];
  const keywordPattern = /\b(import|export)\b/g;
  let match = keywordPattern.exec(code);
  while (match) {
    const keyword = match[1];
    if (isStatementStart(code, match.index)) {
      const specifier = readSpecifierAfter(code, match.index + keyword.length, keyword);
      if (specifier !== null) specifiers.push(specifier);
    }
    match = keywordPattern.exec(code);
  }
  const dynamicPattern = /import\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  let dynamicMatch = dynamicPattern.exec(code);
  while (dynamicMatch) {
    specifiers.push(dynamicMatch[2]);
    dynamicMatch = dynamicPattern.exec(code);
  }
  return specifiers;
}

/** 宽松扫描（正则）得到的说明符集合，用于交叉校验结构化解析的完整性。 */
export function looseSpecifiers(source) {
  const code = stripComments(source);
  const found = new Set();
  const pattern = /(?:from\s*|import\s*\(\s*|import\s+)(['"])([^'"]+)\1/g;
  let match = pattern.exec(code);
  while (match) {
    found.add(match[2]);
    match = pattern.exec(code);
  }
  return found;
}

/** 解析相对说明符到磁盘文件；依次尝试精确路径、.js、.json、index.js。 */
export function resolveSpecifier(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, base + '.js', base + '.json', path.join(base, 'index.js')];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  return null;
}

/** 收集 src 下全部模块的 { file, specifiers, edges } 导入图。 */
export function buildImportGraph(files = listFiles(SRC, '.js')) {
  const graph = new Map();
  for (const file of files) {
    const specifiers = extractImportSpecifiers(fs.readFileSync(file, 'utf8'));
    const edges = [];
    for (const specifier of new Set(specifiers)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveSpecifier(file, specifier);
      if (resolved) edges.push(resolved);
    }
    graph.set(file, { specifiers, edges });
  }
  return graph;
}
