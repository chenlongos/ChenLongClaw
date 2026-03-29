/**
 * Agent：绑定 LangChain 模型 + 动态 tools，执行对话与多轮 tool 调用
 * 支持步骤回调、工具调用回调、工具重试、流式状态
 */
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * 将通用消息格式转为 LangChain 消息数组
 */
function toLangChainMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'user') return new HumanMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    if (m.role === 'system') return new SystemMessage(m.content);
    return new HumanMessage(m.content);
  });
}

/**
 * 从 state 中提取最后一条 AI 文本回复
 */
function extractFinalText(result) {
  if (!result?.messages?.length) return '';
  const last = result.messages[result.messages.length - 1];
  if (!last?.content) return '';
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) return last.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  return '';
}

/**
 * 为工具包装 onToolStart/onToolEnd 与重试
 */
function wrapToolsWithCallbacks(tools, opts = {}) {
  const { onToolStart, onToolEnd, toolRetries = 0 } = opts;
  if (!onToolStart && !onToolEnd && toolRetries <= 0) return tools;

  return tools.map((tool) => {
    if (!tool.schema) return tool;
    const name = tool.name;
    const description = tool.description ?? '';
    const schema = tool.schema;
    const originalInvoke = tool.invoke.bind(tool);

    const func = async (args) => {
      const doOne = async () => {
        onToolStart?.(name, args);
        try {
          const out = await originalInvoke(args);
          onToolEnd?.(name, typeof out === 'string' ? out : JSON.stringify(out));
          return out;
        } catch (e) {
          const errMsg = e?.message ?? String(e);
          onToolEnd?.(name, `Error: ${errMsg}`);
          throw e;
        }
      };

      if (toolRetries <= 0) return doOne();
      let lastErr;
      for (let i = 0; i <= toolRetries; i++) {
        try {
          return await doOne();
        } catch (e) {
          lastErr = e;
          if (i < toolRetries) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
        }
      }
      throw lastErr;
    };

    return new DynamicStructuredTool({ name, description, schema, func });
  });
}

/**
 * 创建 Agent 运行器（基于 LangGraph ReAct Agent）
 * @param {object} opts
 * @param {import('@langchain/core/language_models/chat_models').BaseChatModel} opts.model
 * @param {() => import('@langchain/core/tools').StructuredToolInterface[]} opts.getTools
 * @param {string} [opts.systemPrompt]
 * @param {number} [opts.maxSteps=5]
 */
export function createAgent({ model, getTools, systemPrompt = '', maxSteps = 5 }) {
  const recursionLimit = Math.max(50, maxSteps * 12);

  return {
    /**
     * 执行一轮对话（可含多次 tool 调用）
     * @param {Array<{ role: 'user' | 'assistant' | 'system', content: string }>} messages
     * @param {{ onStep?: (state: any) => void, onToolStart?: (name: string, args: any) => void, onToolEnd?: (name: string, result: string) => void, toolRetries?: number }} [options]
     * @returns {Promise<{ text: string, finishReason?: string }>}
     */
    async run(messages, options = {}) {
      const { onStep, onToolStart, onToolEnd, toolRetries = 0 } = options;
      const rawTools = getTools();
      const tools = wrapToolsWithCallbacks(rawTools, { onToolStart, onToolEnd, toolRetries });

      const agent = createReactAgent({ llm: model, tools });
      const full = [
        ...(systemPrompt ? [new SystemMessage(systemPrompt)] : []),
        ...toLangChainMessages(messages),
      ];

      if (onStep) {
        let lastState;
        const stream = await agent.stream(
          { messages: full },
          { recursionLimit, streamMode: 'values' }
        );
        for await (const chunk of stream) {
          lastState = chunk;
          onStep(chunk);
        }
        const text = extractFinalText(lastState);
        return { text: text ?? '', finishReason: undefined };
      }

      const result = await agent.invoke({ messages: full }, { recursionLimit });
      const text = extractFinalText(result);
      return { text: text ?? '', finishReason: undefined };
    },

    /**
     * 便捷：用户输入 + 历史，返回助手回复（可传 run 的 options）
     */
    async chat(userInput, history = [], options = {}) {
      const messages = [...history, { role: 'user', content: userInput }];
      return this.run(messages, options);
    },
  };
}
