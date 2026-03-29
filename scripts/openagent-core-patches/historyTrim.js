/**
 * 裁剪对话历史，控制上下文长度（与 OpenAgent 文档约定一致）
 * 上游仓库若未包含此文件，由 vendor 脚本在拉取 core 后写入。
 */
function approxMessageChars(m) {
  const c = m?.content;
  if (typeof c === 'string') return c.length;
  return JSON.stringify(c ?? '').length;
}

export function trimHistory(messages, opts = {}) {
  const maxMessages = opts.maxMessages ?? 50;
  const maxApproxChars = opts.maxApproxChars ?? 12000;
  if (!Array.isArray(messages) || messages.length === 0) return [];

  let slice = messages.slice(-maxMessages);
  let total = slice.reduce((s, m) => s + approxMessageChars(m), 0);
  while (total > maxApproxChars && slice.length > 2) {
    slice = slice.slice(1);
    total = slice.reduce((s, m) => s + approxMessageChars(m), 0);
  }
  return slice;
}
