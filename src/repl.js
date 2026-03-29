/**
 * 仅终端 REPL，不启微信入站（便于无凭证调试工具）
 */
import './bootstrapNode.js';
import 'dotenv/config';
import { createInterface } from 'readline';
import { ToolRegistry, createAgent } from '@openagent/core';
import { createModelFromConfig } from './createModel.js';
import { clawTools } from './clawTools.js';
import { CLAW_SYSTEM_PROMPT } from './systemPrompt.js';
import { createClawToolCallbacks } from './toolCallbacks.js';

const { model } = createModelFromConfig(process.cwd());

const registry = new ToolRegistry();
registry.registerAll(clawTools);

const agent = createAgent({
  model,
  getTools: () => registry.getTools(),
  systemPrompt: CLAW_SYSTEM_PROMPT,
  maxSteps: 10,
});

const history = [];
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log('ChenLong Claw REPL（无微信）');
console.log('工具:', registry.listNames().join(', '));
console.log('/tools 列出工具，exit 退出。\n');

function ask() {
  rl.question('\n你: ', async (line) => {
    const input = line.trim();
    if (!input) {
      ask();
      return;
    }
    if (input === 'exit' || input === 'quit') {
      rl.close();
      process.exit(0);
    }
    if (input === '/tools') {
      console.log(registry.listNames().join(', '));
      ask();
      return;
    }
    try {
      console.log(`收到命令：${input}，正在拆解执行`);
      const { text } = await agent.chat(input, history, {
        toolRetries: 1,
        ...createClawToolCallbacks(),
      });
      console.log('\nAgent:', text || '（无回复）');
      history.push({ role: 'user', content: input });
      history.push({ role: 'assistant', content: text || '' });
    } catch (err) {
      console.error('错误:', err instanceof Error ? err.message : err);
    }
    ask();
  });
}

process.once('SIGINT', () => {
  try {
    rl.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
});

ask();
