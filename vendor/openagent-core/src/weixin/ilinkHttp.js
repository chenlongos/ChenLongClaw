/**
 * iLink HTTP 公共头与 GET/POST（对齐 openclaw-weixin src/api/api.ts）
 */
import { randomBytes } from 'crypto';
import {
  WEIXIN_ILINK_APP_ID,
  WEIXIN_ILINK_APP_CLIENT_VERSION,
  WEIXIN_ILINK_CHANNEL_VERSION,
} from './ilinkMeta.js';

export function buildWeixinIlinkBaseInfo() {
  return { channel_version: WEIXIN_ILINK_CHANNEL_VERSION };
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function randomWechatUin() {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32 >>> 0), 'utf-8').toString('base64');
}

export function buildWeixinIlinkCommonHeaders() {
  const headers = {
    'iLink-App-Id': WEIXIN_ILINK_APP_ID,
    'iLink-App-ClientVersion': String(WEIXIN_ILINK_APP_CLIENT_VERSION),
  };
  const tag = process.env.WEIXIN_SK_ROUTE_TAG?.trim();
  if (tag) {
    headers.SKRouteTag = tag;
  }
  return headers;
}

function buildPostHeaders(token, body) {
  const headers = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildWeixinIlinkCommonHeaders(),
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

/**
 * GET（扫码等接口无 Bearer）
 * @param {{ baseUrl: string; endpoint: string; timeoutMs?: number; label?: string }} p
 */
export async function weixinIlinkApiGet(p) {
  const base = ensureTrailingSlash(p.baseUrl);
  const url = new URL(p.endpoint, base).toString();
  const timeoutMs = p.timeoutMs ?? 15_000;
  const label = p.label ?? 'GET';
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: buildWeixinIlinkCommonHeaders(),
      signal: controller.signal,
    });
    clearTimeout(t);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`${label} HTTP ${res.status}: ${rawText.slice(0, 500)}`);
    }
    return rawText;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}

/**
 * POST JSON（带 token 时加 Authorization）
 * @param {{ baseUrl: string; endpoint: string; body: object | string; token?: string; timeoutMs: number; label: string }} p
 */
export async function weixinIlinkApiPost(p) {
  const base = ensureTrailingSlash(p.baseUrl);
  const url = new URL(p.endpoint, base).toString();
  const bodyStr = typeof p.body === 'string' ? p.body : JSON.stringify(p.body);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), p.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildPostHeaders(p.token, bodyStr),
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(t);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`${p.label} HTTP ${res.status}: ${rawText.slice(0, 500)}`);
    }
    return rawText;
  } catch (err) {
    clearTimeout(t);
    throw err;
  }
}
