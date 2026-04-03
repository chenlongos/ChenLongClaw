/** 命令/工具日志用色；非 TTY（管道重定向）时不加 ANSI，避免乱码 */

export const isStdoutTTY = process.stdout.isTTY;

const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

/** 整行蓝色，便于与普通日志区分 */
export function blue(text) {
  return isStdoutTTY ? `${BLUE}${text}${RESET}` : text;
}

const DIM = '\x1b[2m';

/** 步骤分隔标题用淡色，不抢正文 */
export function dim(text) {
  return isStdoutTTY ? `${DIM}${text}${RESET}` : text;
}
