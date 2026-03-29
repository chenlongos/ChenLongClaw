/**
 * 微信 iLink（ClawBot 协议）子模块入口，也可从 @openagent/core 主入口按需 import。
 */
export {
  WEIXIN_ILINK_CHANNEL_VERSION,
  WEIXIN_ILINK_APP_ID,
  buildIlinkClientVersion,
  WEIXIN_ILINK_APP_CLIENT_VERSION,
} from './ilinkMeta.js';

export {
  buildWeixinIlinkBaseInfo,
  buildWeixinIlinkCommonHeaders,
  weixinIlinkApiGet,
  weixinIlinkApiPost,
} from './ilinkHttp.js';

/** 与历史示例文件名对齐的别名 */
export { buildWeixinIlinkBaseInfo as buildBaseInfo, weixinIlinkApiGet as apiGetFetch } from './ilinkHttp.js';

export { getUpdates, sendTextMessage, defaultBaseUrl, defaultToken } from './ilinkClient.js';

export {
  resolveOpenagentStateDir,
  resolveWeixinIlinkCredentialsPath,
  readWeixinIlinkCredentials,
  writeWeixinIlinkCredentials,
  applyWeixinIlinkCredentialsToEnv,
  runWeixinIlinkQrLogin,
  ensureWeixinIlinkLogin,
  runInteractiveQrLogin,
  ensureWeixinLogin,
  applyCredentialsToEnv,
  readCredentialsFile,
  writeCredentialsFile,
  resolveCredentialsPath,
} from './ilinkLogin.js';
