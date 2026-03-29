/**
 * iLink：getupdates / sendmessage（与 openclaw-weixin src/api/api.ts 对齐）
 */
import { buildWeixinIlinkBaseInfo, weixinIlinkApiPost } from './ilinkHttp.js';

const DEFAULT_LONG_POLL_MS = 35_000;
const DEFAULT_API_MS = 15_000;

/**
 * @param {{ baseUrl: string; token?: string; get_updates_buf?: string; timeoutMs?: number }} p
 */
export async function getUpdates(p) {
  const timeoutMs = p.timeoutMs ?? DEFAULT_LONG_POLL_MS;
  const payload = {
    get_updates_buf: p.get_updates_buf ?? '',
    base_info: buildWeixinIlinkBaseInfo(),
  };
  try {
    const rawText = await weixinIlinkApiPost({
      baseUrl: p.baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: payload,
      token: p.token,
      timeoutMs,
      label: 'getUpdates',
    });
    return JSON.parse(rawText);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ret: 0, msgs: [], get_updates_buf: p.get_updates_buf };
    }
    throw err;
  }
}

/**
 * @param {{ baseUrl: string; token?: string; toUserId: string; text: string; contextToken?: string; clientId?: string; timeoutMs?: number }} p
 */
export async function sendTextMessage(p) {
  const cid =
    p.clientId ||
    `openagent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const body = {
    msg: {
      from_user_id: '',
      to_user_id: p.toUserId,
      client_id: cid,
      message_type: 2,
      message_state: 2,
      item_list: p.text ? [{ type: 1, text_item: { text: p.text } }] : [],
      context_token: p.contextToken ?? undefined,
    },
    base_info: buildWeixinIlinkBaseInfo(),
  };

  await weixinIlinkApiPost({
    baseUrl: p.baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body,
    token: p.token,
    timeoutMs: p.timeoutMs ?? DEFAULT_API_MS,
    label: 'sendMessage',
  });
}

export function defaultBaseUrl() {
  return (
    process.env.WEIXIN_ILINK_BASE_URL?.trim() || 'https://ilinkai.weixin.qq.com/'
  );
}

export function defaultToken() {
  return process.env.WEIXIN_ILINK_TOKEN?.trim() || '';
}
