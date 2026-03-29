/**
 * 与 OpenAgent 应用层一致：OpenAI 兼容 Provider（火山、Ollama 等）
 */
import { registerProvider } from '@openagent/core';
import { ChatOpenAI } from '@langchain/openai';

registerProvider('volcengine', (options) => {
  const {
    baseURL = 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey,
    temperature = 0.7,
    maxTokens,
  } = options;
  if (!apiKey) throw new Error('volcengine 需要 options.apiKey');
  return {
    chatModel(modelId) {
      return new ChatOpenAI({
        openAIApiKey: apiKey,
        configuration: { baseURL },
        model: modelId,
        temperature,
        ...(maxTokens != null ? { maxTokens } : {}),
      });
    },
  };
});

registerProvider('ollama', (options) => {
  const { baseURL = 'http://localhost:11434/v1', temperature = 0.7, maxTokens } = options;
  return {
    chatModel(modelId) {
      return new ChatOpenAI({
        openAIApiKey: 'ollama',
        configuration: { baseURL },
        model: modelId,
        temperature,
        ...(maxTokens != null ? { maxTokens } : {}),
      });
    },
  };
});
