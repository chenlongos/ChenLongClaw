/**
 * 微信 iLink + Claw 工具 Agent（工具桩为 console.log）
 *
 * 运行：npm start
 * 仅本地 REPL、不要微信轮询：npm run repl
 * 扫码：npm run weixin-login 或首次启动不带 --no-weixin-login
 */
import './bootstrapNode.js';
import 'dotenv/config';
import { createInterface } from 'readline';
import {
  ToolRegistry,
  createAgent,
  trimHistory,
  sendTextMessage,
  defaultBaseUrl,
  ensureWeixinIlinkLogin,
} from '@openagent/core';
import { startReminderScheduler } from './reminderScheduler.js';
import { createModelFromConfig } from './createModel.js';
import { clawTools } from './clawTools.js';
import { startWeixinInboundPoller } from './weixinInbound.js';
import { CLAW_SYSTEM_PROMPT, CLAW_WEIXIN_SYSTEM_PROMPT } from './systemPrompt.js';
import {
  createWeixinToolCallbacks,
  mergeWeixinReplyAfterReminders,
  extractReminderSuccessesFromAgentState,
} from './reminderReplyFix.js';
import { blue } from './cliColors.js';

const skipWeixinQr = process.argv.includes('--no-weixin-login');
const skipWeixinInbound = process.argv.includes('--no-weixin-inbound');
const skipWeixinAutoReply = process.argv.includes('--no-weixin-auto-reply');

(async function main() {
  const cwd = process.cwd();
  const { model } = createModelFromConfig(cwd);

  const wx = await ensureWeixinIlinkLogin({ skipInteractive: skipWeixinQr || !process.stdin.isTTY });
  if (wx.source === 'none' && !process.env.WEIXIN_ILINK_TOKEN?.trim()) {
    console.log(
      '\n提示：未检测到微信凭证。可设置 WEIXIN_ILINK_TOKEN，或去掉 --no-weixin-login 后重新运行以扫码；或执行 npm run weixin-login\n'
    );
  } else if (wx.source === 'file' || wx.source === 'qr') {
    console.log(`\n微信 iLink：已加载凭证（来源: ${wx.source === 'qr' ? '本次扫码' : '本地文件'}）\n`);
  }

  const registry = new ToolRegistry();
  registry.registerAll(clawTools);

  const agent = createAgent({
    model,
    getTools: () => registry.getTools(),
    systemPrompt: CLAW_SYSTEM_PROMPT,
    maxSteps: 18,
  });

  const agentWeixin = createAgent({
    model,
    getTools: () => registry.getTools(),
    systemPrompt: CLAW_WEIXIN_SYSTEM_PROMPT,
    maxSteps: 18,
  });

  const wxHistories = new Map();

  let stopReminders = () => {};
  if (process.env.WEIXIN_ILINK_TOKEN?.trim()) {
    stopReminders = startReminderScheduler(async (row) => {
      await sendTextMessage({
        baseUrl: defaultBaseUrl(),
        token: process.env.WEIXIN_ILINK_TOKEN,
        toUserId: row.toUserId,
        text: row.text,
        contextToken: row.contextToken || undefined,
      });
    });
    console.log('[reminder] 定时提醒已启用（数据 ~/.openagent/chenlong-reminders.json）\n');
  }

  async function handleWeixinInbound({ text, fromUserId, contextToken }) {
    try {
      let hist = wxHistories.get(fromUserId) || [];
      hist = trimHistory(hist, { maxMessages: 24, maxApproxChars: 12000 });
      const userLine = text;
      console.log(blue(`收到命令：${userLine}，正在拆解执行`));
      const { reminderSuccesses, callbacks } = createWeixinToolCallbacks();
      let lastStateReminders = [];
      const { text: reply } = await agentWeixin.chat(userLine, hist, {
        toolRetries: 1,
        ...callbacks,
        onStep: (state) => {
          lastStateReminders = extractReminderSuccessesFromAgentState(state);
        },
      });
      const mergedReminders = [...reminderSuccesses, ...lastStateReminders];
      const out = mergeWeixinReplyAfterReminders(reply, mergedReminders);
      hist.push({ role: 'user', content: userLine });
      hist.push({ role: 'assistant', content: out });
      wxHistories.set(fromUserId, hist);

      await sendTextMessage({
        baseUrl: defaultBaseUrl(),
        token: process.env.WEIXIN_ILINK_TOKEN,
        toUserId: fromUserId,
        text: out,
        contextToken,
      });
      console.log(`\n[微信] 已自动发回 (${out.length} 字): ${out.slice(0, 300)}${out.length > 300 ? '…' : ''}\n`);
    } catch (e) {
      console.error('\n[微信] Agent 回复或发送失败:', e instanceof Error ? e.message : e);
    }
  }

  let stopInbound = () => {};
  if (!skipWeixinInbound && process.env.WEIXIN_ILINK_TOKEN?.trim()) {
    stopInbound = startWeixinInboundPoller(
      skipWeixinAutoReply
        ? {}
        : {
            onUserTextMessage: handleWeixinInbound,
          }
    );
    console.log(
      skipWeixinAutoReply
        ? '微信入站：仅打印消息（--no-weixin-auto-reply）。\n'
        : '微信入站：文本将经 Agent 处理后自动发回微信。\n'
    );
  } else if (!skipWeixinInbound && !process.env.WEIXIN_ILINK_TOKEN?.trim()) {
    console.log('（未配置 WEIXIN_ILINK_TOKEN，已跳过入站轮询）\n');
  }

  const history = [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  function ask() {
    rl.question('\n你: ', async (line) => {
      const input = line.trim();
      if (!input) {
        ask();
        return;
      }
      if (input === 'exit' || input === 'quit') {
        stopInbound();
        stopReminders();
        rl.close();
        process.exit(0);
      }
      if (input === '/tools') {
        console.log(registry.listNames().join(', '));
        ask();
        return;
      }
      try {
        console.log(blue(`收到命令：${input}，正在拆解执行`));
        const { reminderSuccesses, callbacks } = createWeixinToolCallbacks();
        let lastStateReminders = [];
        const { text } = await agent.chat(input, history, {
          toolRetries: 1,
          ...callbacks,
          onStep: (state) => {
            lastStateReminders = extractReminderSuccessesFromAgentState(state);
          },
        });
        const merged = mergeWeixinReplyAfterReminders(text, [...reminderSuccesses, ...lastStateReminders]);
        console.log('\nAgent:', merged || '（无回复）');
        history.push({ role: 'user', content: input });
        history.push({ role: 'assistant', content: merged || '' });
      } catch (err) {
        console.error('错误:', err instanceof Error ? err.message : err);
      }
      ask();
    });
  }

  console.log('已注册工具:', registry.listNames().join(', '));
  console.log('凭证：~/.openagent/weixin-ilink.json；输入 /tools 列出工具，exit 退出。\n');

  process.once('SIGINT', () => {
    stopInbound();
    stopReminders();
    try {
      rl.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });

  ask();
})();
