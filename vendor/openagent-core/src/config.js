/**
 * 从 config 文件加载配置，支持多 provider，env 可覆盖
 * 仅读取 config.json（及可选 openagent.config.json）；provider 由用户配置决定（如 ollama、volcengine 等）
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_FILES = ['config.json', 'openagent.config.json'];

/** providerKey -> 环境变量前缀，仅当用户在 config 中选用该 key 时使用 */
const ENV_PREFIX = {
  openai: 'OPENAI',
  volcengine: 'VOLCENGINE',
  ollama: 'OLLAMA',
};

/**
 * 从指定路径读取 JSON 配置，若不存在返回 null
 * @param {string} filePath - 绝对或相对 cwd 的路径
 * @param {string} [cwd=process.cwd()]
 * @returns {object | null}
 */
export function loadConfigFile(filePath, cwd = process.cwd()) {
  const full = filePath.startsWith('/') ? filePath : join(cwd, filePath);
  if (!existsSync(full)) return null;
  try {
    const raw = readFileSync(full, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 在目录下按顺序尝试多个文件名，返回第一个成功解析的配置对象
 * @param {string[]} [filenames] - 默认 ['config.json', 'openagent.config.json']
 * @param {string} [cwd=process.cwd()]
 * @returns {{ data: object, path: string } | null}
 */
export function loadConfig(filenames = DEFAULT_FILES, cwd = process.cwd()) {
  for (const name of filenames) {
    const full = join(cwd, name);
    if (!existsSync(full)) continue;
    const data = loadConfigFile(full, cwd);
    if (data != null) return { data, path: full };
  }
  return null;
}

/**
 * 返回 provider 对应的环境变量前缀（用于读取 API_KEY、BASE_URL、MODEL 等）
 * @param {string} providerKey - config 中的 provider key
 * @returns {string | undefined}
 */
export function getEnvPrefix(providerKey) {
  return ENV_PREFIX[providerKey];
}

/**
 * 从已加载的 config 中取某个 provider 的配置（不读 env）
 */
function getBlock(data, providerKey) {
  const block = data[providerKey] ?? data.providers?.[providerKey];
  if (!block) return null;
  return {
    name: block.name ?? providerKey,
    options: block.options ?? {},
    models: block.models ?? {},
  };
}

/**
 * 获取指定 provider 的配置，并合并环境变量（env 优先）
 * @param {string} providerKey - config 中的 provider key（由用户配置决定）
 * @param {string} [cwd=process.cwd()]
 * @returns {{ providerConfig: { name: string, options: object }, modelId: string | null } | null}
 */
export function getProviderConfig(providerKey, cwd = process.cwd()) {
  const loaded = loadConfig(undefined, cwd);
  if (!loaded) return null;

  const block = getBlock(loaded.data, providerKey);
  if (!block) return null;

  const options = { ...block.options };
  const prefix = ENV_PREFIX[providerKey];
  if (prefix) {
    if (process.env[`${prefix}_API_KEY`]) options.apiKey = process.env[`${prefix}_API_KEY`];
    if (process.env[`${prefix}_BASE_URL`]) options.baseURL = process.env[`${prefix}_BASE_URL`];
  }

  const modelKeys = Object.keys(block.models);
  const modelEnv = prefix ? process.env[`${prefix}_MODEL`] : undefined;
  const modelId = modelEnv || (modelKeys.length > 0 ? modelKeys[0] : null);

  return {
    providerConfig: { name: block.name, options },
    modelId,
  };
}

/**
 * 获取 config 文件中出现的第一个 provider key（用作默认 provider）
 * @param {string} [cwd=process.cwd()]
 * @returns {string | null}
 */
export function getFirstProviderKey(cwd = process.cwd()) {
  const loaded = loadConfig(undefined, cwd);
  if (!loaded) return null;
  const data = loaded.data;
  const top = data.providers ?? data;
  for (const k of Object.keys(top)) {
    if (getBlock(data, k)) return k;
  }
  return null;
}
