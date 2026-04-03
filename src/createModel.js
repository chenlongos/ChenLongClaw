import './providers/register.js';
import { createProvider, getProviderConfig, getFirstProviderKey, getEnvPrefix } from '@openagent/core';

//const DEFAULT_PROVIDER = 'ollama';
//const DEFAULT_MODEL = 'kimi-k2.5:cloud';

const DEFAULT_PROVIDER = 'volcengine';
const DEFAULT_MODEL = 'deepseek-v3.2';
/**
 * 从项目根 config.json + 环境变量解析 Chat 模型（与 OpenAgent 示例一致）
 */
export function createModelFromConfig(cwd = process.cwd()) {
  const providerKey =
    process.env.OPENAGENT_PROVIDER?.trim() || DEFAULT_PROVIDER || getFirstProviderKey(cwd);
  const cfg = providerKey ? getProviderConfig(providerKey, cwd) : null;

  if (!providerKey || !cfg) {
    throw new Error('请在 config.json 中配置 provider，或设置 OPENAGENT_PROVIDER');
  }

  const prefix = providerKey ? getEnvPrefix(providerKey) : undefined;
  const apiKeyFromEnv = prefix ? process.env[`${prefix}_API_KEY`] : process.env.OPENAGENT_API_KEY;
  const apiKey = apiKeyFromEnv || cfg?.providerConfig?.options?.apiKey;
  const needsApiKey = providerKey !== 'ollama';

  if (needsApiKey && !apiKey && !cfg.providerConfig?.options?.apiKey) {
    throw new Error('请配置 API Key（.env 或 config.json）');
  }

  cfg.providerConfig.options.apiKey =
    apiKey || cfg.providerConfig.options.apiKey || (providerKey === 'ollama' ? 'ollama' : undefined);
  if (prefix && process.env[`${prefix}_BASE_URL`]) {
    cfg.providerConfig.options.baseURL = process.env[`${prefix}_BASE_URL`];
  }

  const provider = createProvider(cfg.providerConfig);
  const modelId =
    (prefix ? process.env[`${prefix}_MODEL`] : null) ||
    process.env.OPENAGENT_MODEL ||
    (providerKey === DEFAULT_PROVIDER ? DEFAULT_MODEL : null) ||
    cfg?.modelId;

  if (!modelId) {
    throw new Error('请配置模型 ID 或 OPENAGENT_MODEL');
  }

  const model = provider.chatModel(modelId);
  return { model, modelId, providerKey };
}
