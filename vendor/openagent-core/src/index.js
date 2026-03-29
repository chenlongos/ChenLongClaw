/**
 * @openagent/core
 * 库入口：Provider 封装、动态 Tool 注册表、Agent 运行器、config 加载
 */
export { createProvider, registerProvider, PROVIDERS } from './provider.js';
export { ToolRegistry } from './registry.js';
export { createAgent } from './agent.js';
export { loadConfigFile, loadConfig, getProviderConfig, getFirstProviderKey, getEnvPrefix } from './config.js';
export { trimHistory } from './historyTrim.js';
export { runTask } from './taskRunner.js';

/** 微信 iLink：扫码登录、凭证、getupdates/sendmessage（详见 docs/WEIXIN_ILINK_RESEARCH.md） */
export * from './weixin/index.js';
