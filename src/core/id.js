// 进程内唯一、可读的 ID 生成器：prefix-会话片段-序号，例如 R-1a2b3c-7。
let sequence = 0;
const SESSION = createSessionTag();

function createSessionTag() {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
  return seed.toString(16).padStart(6, '0').slice(-6);
}

/**
 * 生成一个可读且进程内唯一的 ID。
 * @param {string} [prefix] 语义前缀，如 R/Sheet/wire
 * @returns {string} 形如 "R-1a2b3c-7"
 */
export function uid(prefix = 'id') {
  sequence += 1;
  const safePrefix = String(prefix === undefined || prefix === null ? 'id' : prefix).trim() || 'id';
  return safePrefix + '-' + SESSION + '-' + sequence;
}
