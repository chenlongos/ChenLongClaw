/**
 * 多轮任务：同一 goal 下重复对话直至 maxRounds（与 OpenAgent task-example 用法兼容）
 * 上游仓库若未包含此文件，由 vendor 脚本在拉取 core 后写入。
 */
export async function runTask({
  agent,
  goal,
  history = [],
  maxRounds = 3,
  onStep,
  trimHistory: trimFn,
  chatOptions = {},
}) {
  const steps = [];
  let working = Array.isArray(history) ? [...history] : [];

  for (let round = 0; round < maxRounds; round++) {
    const h = trimFn ? trimFn(working) : working;
    const { text } = await agent.chat(goal, h, chatOptions);
    const reply = text ?? '';
    steps.push({ round, reply });
    working.push({ role: 'user', content: goal });
    working.push({ role: 'assistant', content: reply });
    if (onStep) onStep({ round, reply });
  }

  const last = steps[steps.length - 1];
  return {
    steps,
    history: working,
    final: { reply: last?.reply ?? '' },
  };
}
