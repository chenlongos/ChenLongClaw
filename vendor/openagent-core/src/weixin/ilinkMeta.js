/**
 * iLink 请求元数据：与 @tencent-weixin/openclaw-weixin 的 package.json 对齐（若已安装）。
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/** @type {{ version?: string; ilink_appid?: string }} */
let pkg = {};
try {
  pkg = require('@tencent-weixin/openclaw-weixin/package.json');
} catch {
  pkg = { version: '2.1.1', ilink_appid: 'bot' };
}

export const WEIXIN_ILINK_CHANNEL_VERSION = pkg.version ?? '2.1.1';
export const WEIXIN_ILINK_APP_ID = pkg.ilink_appid ?? 'bot';

export function buildIlinkClientVersion(version) {
  const parts = String(version)
    .split('.')
    .map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

export const WEIXIN_ILINK_APP_CLIENT_VERSION = buildIlinkClientVersion(WEIXIN_ILINK_CHANNEL_VERSION);
