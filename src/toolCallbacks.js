import { inspect } from 'node:util';

/**
 * 与 Agent onToolStart/onToolEnd 配合：打印「正在执行命令 [name]，执行结果 OK { ... }」
 * 其中 `{ ... }` 为模型传入工具的参数（拆解后的命令参数）。
 */
export function createClawToolCallbacks() {
  const stack = [];

  function popArgsForTool(name) {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === name) {
        const [entry] = stack.splice(i, 1);
        return entry.args;
      }
    }
    return {};
  }

  return {
    onToolStart(name, args) {
      stack.push({ name, args: args && typeof args === 'object' ? { ...args } : {} });
    },
    onToolEnd(name, result) {
      const args = popArgsForTool(name);
      const argsStr = inspect(args, {
        colors: false,
        depth: 6,
        breakLength: Infinity,
        compact: true,
      });
      const resultStr = typeof result === 'string' ? result : String(result);
      const failed = resultStr.startsWith('Error:');
      const tag = failed ? '失败' : 'OK';
      console.log(`正在执行命令 [${name}]，执行结果 ${tag} ${argsStr}`);
      if (failed) {
        console.log(`  详情: ${resultStr}`);
      }
    },
  };
}
