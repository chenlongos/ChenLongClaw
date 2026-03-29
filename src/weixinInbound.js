/**
 * 微信 iLink 入站长轮询（逻辑与 OpenAgent openclaw-weixin-example 一致）
 */
import { getUpdates, defaultBaseUrl } from '@openagent/core';

export function extractInboundPreview(msg) {
  const items = msg?.item_list;
  if (!Array.isArray(items) || items.length === 0) return '(无 item_list)';
  const lines = [];
  for (const it of items) {
    const t = it?.type;
    if (t === 1 && it.text_item?.text) lines.push(it.text_item.text);
    else if (t === 2) lines.push('[图片]');
    else if (t === 3) lines.push('[语音]');
    else if (t === 4) lines.push('[文件]');
    else if (t === 5) lines.push('[视频]');
    else lines.push(`[类型 ${t}]`);
  }
  return lines.join('\n') || '(空内容)';
}

export function extractInboundTextOnly(msg) {
  const items = msg?.item_list;
  if (!Array.isArray(items)) return '';
  const parts = [];
  for (const it of items) {
    if (it?.type === 1 && it.text_item?.text) parts.push(it.text_item.text);
  }
  return parts.join('\n').trim();
}

export function startWeixinInboundPoller(options = {}) {
  const token = process.env.WEIXIN_ILINK_TOKEN?.trim();
  if (!token) return () => {};

  let buf = '';
  let stopped = false;
  const baseUrl = defaultBaseUrl();
  const timeoutMs = options.timeoutMs ?? 38_000;
  let chain = Promise.resolve();
  const enqueue = (fn) => {
    chain = chain
      .then(fn)
      .catch((e) => console.error('\n[微信] 自动回复队列错误:', e instanceof Error ? e.message : e));
  };

  const loop = async () => {
    while (!stopped) {
      try {
        const resp = await getUpdates({
          baseUrl,
          token,
          get_updates_buf: buf,
          timeoutMs,
        });
        if (resp.errcode === -14) {
          console.error('\n[微信] 会话过期 (errcode -14)，请重新运行本程序并扫码。\n');
          break;
        }
        if (typeof resp.ret === 'number' && resp.ret !== 0 && resp.errcode !== undefined && resp.errcode !== 0) {
          console.error('\n[微信] getUpdates 异常:', JSON.stringify(resp).slice(0, 300));
        }
        buf = resp.get_updates_buf ?? buf;
        const msgs = resp.msgs || [];
        for (const msg of msgs) {
          if (msg.message_type === 2) continue;
          const preview = extractInboundPreview(msg);
          const from = msg.from_user_id || '?';
          if (msg.context_token) process.env.WEIXIN_DEFAULT_CONTEXT_TOKEN = msg.context_token;
          if (msg.from_user_id) process.env.WEIXIN_DEFAULT_TO_USER_ID = msg.from_user_id;
          console.log('\n──────── 微信入站 ────────');
          console.log(`来自: ${from}`);
          console.log(`内容: ${preview}`);
          if (msg.context_token) console.log('(已缓存 context_token，可用于自动回复)');
          console.log('────────────────────────\n');
          options.onMessage?.(msg);
          const textOnly = extractInboundTextOnly(msg);
          const ctx = msg.context_token;
          const uid = msg.from_user_id;
          if (options.onUserTextMessage && textOnly && ctx && uid) {
            enqueue(() =>
              Promise.resolve(options.onUserTextMessage({ msg, text: textOnly, fromUserId: uid, contextToken: ctx }))
            );
          } else if (options.onUserTextMessage && textOnly && (!ctx || !uid)) {
            console.warn('[微信] 本条缺少 context_token 或 from_user_id，跳过自动回复');
          }
        }
      } catch (e) {
        if (stopped) break;
        console.error('\n[微信] getUpdates 错误:', e instanceof Error ? e.message : e);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  loop();
  return () => {
    stopped = true;
  };
}
