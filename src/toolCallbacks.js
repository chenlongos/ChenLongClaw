import { inspect } from 'node:util';
import { blue, dim } from './cliColors.js';

/**
 * 与 Agent onToolStart/onToolEnd 配合：每步带「步骤 N · 中文说明」分隔行；
 * 仅「正在执行命令 … 执行结果 OK/失败」为蓝色；参数、moves、分批说明等为默认色。
 */
function tryParseToolResultJson(result) {
  if (typeof result !== 'string') return null;
  try {
    let j = JSON.parse(result);
    if (typeof j === 'string') j = JSON.parse(j);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

/** 与 Agent 回复里分步说明类似，便于扫一眼看懂在干什么 */
const TOOL_STEP_LABEL = {
  camera_capture: '拍照取图',
  vision_recognize_remote: '视觉识别',
  car_move: '底盘移动（小车）',
  car_navigate_to: '导航到目标位姿',
  arm_move_to: '机械臂移动到点',
  arm_pick: '夹爪抓取',
  arm_place: '夹爪放置',
  arm_grasp: '夹爪开合',
  weixin_reminder_create: '微信定时提醒',
  weixin_reminder_list: '列出定时提醒',
  weixin_reminder_cancel: '取消定时提醒',
};

function stepLabel(name) {
  return TOOL_STEP_LABEL[name] ?? name;
}

/** 人类可读的一段底盘动作摘要（英文 → 中文），便于与 Agent 分步说明对照 */
function carMoveSummaryLine(moves) {
  if (!Array.isArray(moves) || moves.length === 0) return '';
  const enToZh = { up: '前进', down: '后退', left: '左转', right: '右转' };
  return moves
    .map((m) => {
      const raw = m && typeof m === 'object' ? m.action : '';
      const ms = m && typeof m === 'object' ? m.duration_ms : '';
      const s = String(raw ?? '').trim();
      const lower = s.toLowerCase();
      const zh = enToZh[lower] ?? s;
      return `${zh} ${ms}ms`;
    })
    .join(' → ');
}

export function createClawToolCallbacks() {
  const stack = [];
  let step = 0;

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
      step += 1;
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

      console.log('');
      console.log(dim(`━━ 步骤 ${step} · ${stepLabel(name)} ━━`));

      const head = blue(`正在执行命令 [${name}]，执行结果 ${tag}`);

      if (name === 'car_move' && args && Array.isArray(args.moves) && args.moves.length > 0) {
        console.log(head);
        const summary = carMoveSummaryLine(args.moves);
        if (summary) {
          console.log(`  动作摘要：${summary}`);
        }
        console.log(`  moves（共 ${args.moves.length} 段）：`);
        args.moves.forEach((m, i) => {
          const a = m && typeof m === 'object' ? m.action : m;
          const ms = m && typeof m === 'object' ? m.duration_ms : '';
          console.log(`    { action: ${JSON.stringify(a)}, duration_ms: ${ms} }`);
        });
        if (args.speed != null && args.speed !== '') {
          console.log(`  speed: ${args.speed}`);
        }
      } else {
        console.log(argsStr ? `${head} ${argsStr}` : head);
      }

      const parsed = tryParseToolResultJson(resultStr);
      if (parsed && Array.isArray(parsed.batch_lines) && parsed.batch_lines.length > 0) {
        console.log('');
        console.log('  分批下发说明（按执行顺序）：');
        for (const line of parsed.batch_lines) {
          console.log(`    ${line}`);
        }
      }
      if (failed) {
        console.log(`  详情: ${resultStr}`);
      }
    },
  };
}
