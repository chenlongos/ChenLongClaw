/**
 * 微信 iLink 扫码登录（对齐 @tencent-weixin/openclaw-weixin/src/auth/login-qr.ts）
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { weixinIlinkApiGet } from './ilinkHttp.js';

const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_BOT_TYPE = '3';
const GET_QRCODE_TIMEOUT_MS = 8000;
const QR_POLL_TIMEOUT_MS = 35_000;
const MAX_QR_REFRESH = 3;

export function resolveOpenagentStateDir() {
  const env = process.env.OPENAGENT_STATE_DIR?.trim();
  if (env) return env;
  return path.join(os.homedir(), '.openagent');
}

export function resolveWeixinIlinkCredentialsPath() {
  return path.join(resolveOpenagentStateDir(), 'weixin-ilink.json');
}

/**
 * @returns {{ token?: string, baseUrl?: string, userId?: string, savedAt?: string } | null}
 */
export function readWeixinIlinkCredentials() {
  const fp = resolveWeixinIlinkCredentialsPath();
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf-8');
    const data = JSON.parse(raw);
    if (data && typeof data.token === 'string' && data.token.trim()) return data;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeWeixinIlinkCredentials(data) {
  const dir = resolveOpenagentStateDir();
  fs.mkdirSync(dir, { recursive: true });
  const fp = resolveWeixinIlinkCredentialsPath();
  const payload = {
    ...data,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(fp, JSON.stringify(payload, null, 2), 'utf-8');
  return fp;
}

/**
 * 将已保存凭证写入 process.env
 */
export function applyWeixinIlinkCredentialsToEnv() {
  const saved = readWeixinIlinkCredentials();
  if (!saved?.token) return false;
  if (!process.env.WEIXIN_ILINK_TOKEN?.trim()) {
    process.env.WEIXIN_ILINK_TOKEN = saved.token;
  }
  if (saved.baseUrl && !process.env.WEIXIN_ILINK_BASE_URL?.trim()) {
    process.env.WEIXIN_ILINK_BASE_URL = saved.baseUrl.endsWith('/')
      ? saved.baseUrl
      : `${saved.baseUrl}/`;
  }
  if (saved.userId && !process.env.WEIXIN_DEFAULT_TO_USER_ID?.trim()) {
    process.env.WEIXIN_DEFAULT_TO_USER_ID = saved.userId;
  }
  return true;
}

async function fetchBotQrCode(apiBaseUrl, botType) {
  const raw = await weixinIlinkApiGet({
    baseUrl: apiBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    timeoutMs: GET_QRCODE_TIMEOUT_MS,
    label: 'get_bot_qrcode',
  });
  return JSON.parse(raw);
}

async function pollQrStatus(apiBaseUrl, qrcode) {
  try {
    const raw = await weixinIlinkApiGet({
      baseUrl: apiBaseUrl,
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      timeoutMs: QR_POLL_TIMEOUT_MS,
      label: 'get_qrcode_status',
    });
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'wait' };
    }
    return { status: 'wait' };
  }
}

async function printQrTerminal(qrcodeImgContent) {
  try {
    const qr = await import('qrcode-terminal');
    const fn = qr.default?.generate ?? qr.generate;
    if (typeof fn === 'function') {
      fn(qrcodeImgContent, { small: true });
      return;
    }
  } catch {
    /* fall through */
  }
  console.log('如果终端未显示二维码，请用浏览器打开以下链接扫码：');
  console.log(qrcodeImgContent);
}

/**
 * 交互式扫码登录并写入凭证文件
 * @param {{ timeoutMs?: number, botType?: string }} [opts]
 */
export async function runWeixinIlinkQrLogin(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 480_000;
  const botType = opts.botType ?? DEFAULT_BOT_TYPE;
  const deadline = Date.now() + timeoutMs;

  let apiBase = FIXED_BASE_URL;
  let qrRefresh = 0;

  const qr1 = await fetchBotQrCode(apiBase, botType);
  if (!qr1.qrcode || !qr1.qrcode_img_content) {
    throw new Error('未获取到二维码，请检查网络或 iLink 服务状态');
  }

  let qrcode = qr1.qrcode;
  let qrcodeUrl = qr1.qrcode_img_content;

  console.log('\n请使用微信扫描下方二维码完成登录（与 OpenClaw 微信插件同流程）\n');
  await printQrTerminal(qrcodeUrl);
  console.log('\n若二维码无法显示，请复制链接到浏览器打开：');
  console.log(qrcodeUrl);
  console.log('');

  let scannedPrinted = false;

  while (Date.now() < deadline) {
    const status = await pollQrStatus(apiBase, qrcode);

    switch (status.status) {
      case 'wait':
        break;
      case 'scaned':
        if (!scannedPrinted) {
          console.log('\n已扫码，请在手机上确认授权…\n');
          scannedPrinted = true;
        }
        break;
      case 'scaned_but_redirect': {
        const host = status.redirect_host;
        if (host) {
          apiBase = `https://${host}`;
          console.log(`\n已切换接入点: ${apiBase}\n`);
        }
        break;
      }
      case 'expired': {
        qrRefresh += 1;
        if (qrRefresh > MAX_QR_REFRESH) {
          throw new Error('二维码多次过期，请重新运行');
        }
        console.log(`\n二维码已过期，正在刷新 (${qrRefresh}/${MAX_QR_REFRESH})…\n`);
        const qrNew = await fetchBotQrCode(FIXED_BASE_URL, botType);
        qrcode = qrNew.qrcode;
        qrcodeUrl = qrNew.qrcode_img_content;
        scannedPrinted = false;
        await printQrTerminal(qrcodeUrl);
        console.log(qrcodeUrl);
        break;
      }
      case 'confirmed': {
        const token = status.bot_token;
        if (!token) throw new Error('登录成功但未返回 bot_token');
        const baseUrl = status.baseurl
          ? (status.baseurl.endsWith('/') ? status.baseurl : `${status.baseurl}/`)
          : `${FIXED_BASE_URL}/`;
        const userId = status.ilink_user_id || status.userId;
        writeWeixinIlinkCredentials({
          token,
          baseUrl,
          userId,
        });
        process.env.WEIXIN_ILINK_TOKEN = token;
        process.env.WEIXIN_ILINK_BASE_URL = baseUrl;
        if (userId) process.env.WEIXIN_DEFAULT_TO_USER_ID = userId;
        console.log(`\n登录成功，凭证已保存: ${resolveWeixinIlinkCredentialsPath()}\n`);
        return { token, baseUrl, userId };
      }
      default:
        break;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error('登录超时，请重试');
}

/**
 * 环境变量有 token → 用；否则读文件；否则在 TTY 下扫码。
 * @param {{ skipInteractive?: boolean }} [opts]
 * @returns {Promise<{ source: 'env' | 'file' | 'qr' | 'none' }>}
 */
export async function ensureWeixinIlinkLogin(opts = {}) {
  if (process.env.WEIXIN_ILINK_TOKEN?.trim()) {
    return { source: 'env' };
  }

  if (applyWeixinIlinkCredentialsToEnv() && process.env.WEIXIN_ILINK_TOKEN?.trim()) {
    return { source: 'file' };
  }

  if (opts.skipInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
    return { source: 'none' };
  }

  await runWeixinIlinkQrLogin({});
  return { source: 'qr' };
}

/** @deprecated 使用 runWeixinIlinkQrLogin */
export const runInteractiveQrLogin = runWeixinIlinkQrLogin;
/** @deprecated 使用 ensureWeixinIlinkLogin */
export const ensureWeixinLogin = ensureWeixinIlinkLogin;
/** @deprecated 使用 applyWeixinIlinkCredentialsToEnv */
export const applyCredentialsToEnv = applyWeixinIlinkCredentialsToEnv;
/** @deprecated 使用 readWeixinIlinkCredentials */
export const readCredentialsFile = readWeixinIlinkCredentials;
/** @deprecated 使用 writeWeixinIlinkCredentials */
export const writeCredentialsFile = writeWeixinIlinkCredentials;
/** @deprecated 使用 resolveWeixinIlinkCredentialsPath */
export const resolveCredentialsPath = resolveWeixinIlinkCredentialsPath;
