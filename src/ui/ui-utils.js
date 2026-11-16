// UI 通用小工具：错误消息提取与本地文件读取，供组合根与动作模块复用。
export function messageOf(error) {
  return error && typeof error.message === 'string' ? error.message : String(error);
}

export function readFileText(file) {
  if (file && typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result === undefined || reader.result === null ? '' : reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file);
  });
}
