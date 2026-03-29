/**
 * Provider 封装：根据配置创建聊天模型
 * 默认无内置 provider，需通过 registerProvider 注册后才可使用
 */
/** 仅包含已注册的 provider 工厂 */
const PROVIDERS = {};

/**
 * 注册 provider（应用或插件在启动时调用）
 * @param {string} name - config 中使用的 provider key
 * @param {(options: object) => { chatModel: (id: string) => import('@langchain/core/language_models/chat_models').BaseChatModel }} factory - 接收 options，返回 provider（含 chatModel）
 */
export function registerProvider(name, factory) {
  PROVIDERS[name] = factory;
}

/**
 * 从配置创建 provider（config 中的一项）
 * @param {object} config - { name, options }
 * @returns 返回已注册的 provider 实例
 */
export function createProvider(config) {
  const { name, options = {} } = config;
  const factory = PROVIDERS[name];
  if (!factory) {
    const registered = Object.keys(PROVIDERS);
    throw new Error(
      `未注册的 provider: ${name}。已注册: ${registered.length ? registered.join(', ') : '（无）' }。请先调用 registerProvider。`
    );
  }
  return factory(options);
}

export { PROVIDERS };
