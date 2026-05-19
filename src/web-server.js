/**
 * 小车 Web 面板 + 微信 Bot
 * 启动: node src/web-server.js  或  npm run web
 *
 * 流程：打开页面 → 扫码登录 → 绑定小车 → 智能体对话
 */
import './bootstrapNode.js';
import 'dotenv/config';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { URL } from 'node:url';
import {
  ToolRegistry,
  createAgent,
  trimHistory,
  sendTextMessage,
  defaultBaseUrl,
  ensureWeixinIlinkLogin,
  weixinIlinkApiGet,
} from '@openagent/core';
import { createModelFromConfig } from './createModel.js';
import { clawTools } from './clawTools.js';
import { startWeixinInboundPoller } from './weixinInbound.js';
import { startReminderScheduler } from './reminderScheduler.js';
import { CLAW_SYSTEM_PROMPT, CLAW_WEIXIN_SYSTEM_PROMPT } from './systemPrompt.js';
import {
  createWeixinToolCallbacks,
  mergeWeixinReplyAfterReminders,
  extractReminderSuccessesFromAgentState,
} from './reminderReplyFix.js';
import { saveBinding, getBinding } from './bindStore.js';
import { blue } from './cliColors.js';

const PORT = parseInt(process.env.WEB_PORT || '3456', 10);

const FIXED_ILINK_BASE = 'https://ilinkai.weixin.qq.com';
const BOT_TYPE = '3';
const QRCODE_TIMEOUT_MS = 8000;
const QR_POLL_TIMEOUT_MS = 35_000;

// ---- 智能体 ----
const { model } = createModelFromConfig(process.cwd());

const registry = new ToolRegistry();
registry.registerAll(clawTools);

const agent = createAgent({
  model,
  getTools: () => registry.getTools(),
  systemPrompt: CLAW_SYSTEM_PROMPT,
  maxSteps: 18,
});

const agentWeixin = createAgent({
  model,
  getTools: () => registry.getTools(),
  systemPrompt: CLAW_WEIXIN_SYSTEM_PROMPT,
  maxSteps: 18,
});

/** Web 聊天会话: sessionId -> { history, userId, carUrl } */
const sessions = new Map();
function getSession(sid) {
  if (!sessions.has(sid)) sessions.set(sid, { history: [], userId: null, carUrl: null });
  return sessions.get(sid);
}

/** 微信用户对话历史 */
const wxHistories = new Map();

// 微信服务状态（HTTP handler 引用，必须声明在 handler 之前）
let stopReminders = () => {};
let stopInbound = () => {};
let weixinServicesStarted = false;
let currentServiceToken = null;

function startWeixinServices() {
  const token = process.env.WEIXIN_ILINK_TOKEN?.trim();
  if (!token || weixinServicesStarted) return;
  weixinServicesStarted = true;
  currentServiceToken = token;

  stopReminders = startReminderScheduler(async (row) => {
    sendTextMessage({
      baseUrl: defaultBaseUrl(),
      token,
      toUserId: row.toUserId,
      text: row.text,
      contextToken: row.contextToken || undefined,
    }).catch(() => {});
  });
  console.log('[reminder] 定时提醒已启用');

  stopInbound = startWeixinInboundPoller({
    onUserTextMessage: handleWeixinInbound,
    onTokenExpired: async () => {
      // 如果 token 已被 Web 扫码刷新，忽略旧服务的过期回调
      if (process.env.WEIXIN_ILINK_TOKEN?.trim() !== currentServiceToken) {
        console.log('[微信] 旧凭证过期回调，但 token 已刷新，忽略。');
        return;
      }
      weixinServicesStarted = false;
      currentServiceToken = null;
      stopReminders();
      stopInbound();
      stopReminders = () => {};
      stopInbound = () => {};
      delete process.env.WEIXIN_ILINK_TOKEN;
      const credFile = path.join(os.homedir(), '.openagent', 'weixin-ilink.json');
      try { fs.unlinkSync(credFile); } catch {}
      console.log('[微信] 凭证已过期，请通过 Web 页面重新扫码。');
    },
  });
  console.log('微信入站：文本将经 Agent 处理后自动发回微信。');
}

// ---- 微信消息处理 ----
async function handleWeixinInbound({ text, fromUserId, contextToken }) {
  try {
    const binding = getBinding(fromUserId);
    if (!binding) {
      await sendTextMessage({
        baseUrl: defaultBaseUrl(),
        token: process.env.WEIXIN_ILINK_TOKEN,
        toUserId: fromUserId,
        text: '你尚未绑定小车。请访问 Web 面板绑定。',
        contextToken,
      });
      return;
    }

    const prevCarUrl = process.env.CAR_HTTP_BASE_URL;
    process.env.CAR_HTTP_BASE_URL = binding.carUrl;

    try {
      let hist = wxHistories.get(fromUserId) || [];
      hist = trimHistory(hist, { maxMessages: 24, maxApproxChars: 12000 });
      console.log(blue(`收到命令：${text}，正在拆解执行`));
      const { reminderSuccesses, callbacks } = createWeixinToolCallbacks();
      let lastStateReminders = [];
      const { text: reply } = await agentWeixin.chat(text, hist, {
        toolRetries: 1,
        ...callbacks,
        onStep: (state) => {
          lastStateReminders = extractReminderSuccessesFromAgentState(state);
        },
      });
      const merged = [...reminderSuccesses, ...lastStateReminders];
      const out = mergeWeixinReplyAfterReminders(reply, merged);
      hist.push({ role: 'user', content: text });
      hist.push({ role: 'assistant', content: out });
      wxHistories.set(fromUserId, hist);

      await sendTextMessage({
        baseUrl: defaultBaseUrl(),
        token: process.env.WEIXIN_ILINK_TOKEN,
        toUserId: fromUserId,
        text: out,
        contextToken,
      });
      console.log(`[微信] 已自动发回 (${out.length} 字): ${out.slice(0, 300)}${out.length > 300 ? '…' : ''}`);
    } finally {
      if (prevCarUrl !== undefined) {
        process.env.CAR_HTTP_BASE_URL = prevCarUrl;
      } else {
        delete process.env.CAR_HTTP_BASE_URL;
      }
    }
  } catch (e) {
    console.error('[微信] Agent 回复或发送失败:', e instanceof Error ? e.message : e);
  }
}

// ---- HTML ----
const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>小车助手</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f0f1a; color: #e0e0e0; min-height: 100vh;
    display: flex; justify-content: center;
  }
  .app { width: 100%; max-width: 480px; height: 100vh; display: flex; flex-direction: column; }

  /* ===== 登录页 ===== */
  .login-page {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100%; gap: 24px; padding: 32px;
  }
  .login-page .logo { font-size: 2rem; }
  .login-page h1 { font-size: 1.3rem; font-weight: 600; color: #e94560; letter-spacing: 2px; }
  .login-page .sub { color: #666; font-size: 0.85rem; }

  .qr-placeholder {
    width: 260px; height: 260px; border-radius: 16px;
    background: #1a1a30; border: 2px dashed #2a2a4a;
    display: flex; align-items: center; justify-content: center;
  }
  .qr-placeholder img { width: 100%; height: 100%; border-radius: 16px; object-fit: contain; }
  .status-text { font-size: 0.85rem; margin-top: 6px; text-align: center; }
  .status-text.waiting { color: #a0a0c0; }
  .status-text.scanned { color: #4ecca3; }
  .status-text.failed { color: #e94560; }

  .field { width: 100%; max-width: 300px; }
  .field label { display: block; font-size: 0.8rem; color: #777; margin-bottom: 6px; }
  .field input {
    width: 100%; padding: 10px 14px; border-radius: 10px;
    border: 1px solid #2a2a4a; background: #1a1a30; color: #ccc; font-size: 0.95rem;
    transition: border-color 0.2s;
  }
  .field input:focus { outline: none; border-color: #e94560; }

  /* ===== 聊天页 ===== */
  .chat-page { display: none; flex-direction: column; height: 100%; }
  .chat-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; background: #12122a; border-bottom: 1px solid #1e1e3a;
    flex-shrink: 0;
  }
  .chat-header h1 { font-size: 1rem; font-weight: 600; color: #e94560; }
  .car-badge {
    font-size: 0.75rem; color: #4ecca3; background: rgba(78,204,163,0.1);
    padding: 4px 10px; border-radius: 20px; cursor: pointer;
    max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    border: 1px solid rgba(78,204,163,0.2); transition: background 0.15s;
  }
  .car-badge:hover { background: rgba(78,204,163,0.2); }

  .chat { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 80%; padding: 10px 14px; border-radius: 14px; font-size: 0.9rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  .msg.user { align-self: flex-end; background: #e94560; color: #fff; border-bottom-right-radius: 6px; }
  .msg.agent { align-self: flex-start; background: #1e1e3a; color: #ccc; border-bottom-left-radius: 6px; }
  .msg .time { font-size: 0.65rem; color: rgba(255,255,255,0.4); margin-top: 4px; }

  .chat-input-row { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #1e1e3a; background: #12122a; flex-shrink: 0; }
  .chat-input-row input {
    flex: 1; padding: 10px 16px; border-radius: 22px;
    border: 1px solid #2a2a4a; background: #1a1a30; color: #ccc; font-size: 0.9rem;
    transition: border-color 0.2s;
  }
  .chat-input-row input:focus { outline: none; border-color: #e94560; }
  .chat-input-row button {
    width: 42px; height: 42px; border-radius: 50%; border: none;
    background: #e94560; color: #fff; font-size: 1.1rem; cursor: pointer; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; transition: background 0.15s;
  }
  .chat-input-row button:disabled { background: #3a3a5a; }
  .thinking { color: #666; font-size: 0.8rem; padding: 2px 14px; font-style: italic; }

  /* ===== 弹窗 ===== */
  .modal-overlay {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    z-index: 100; justify-content: center; align-items: center;
  }
  .modal-overlay.show { display: flex; }
  .modal {
    background: #1a1a30; border: 1px solid #2a2a4a; border-radius: 16px; padding: 24px;
    width: 90%; max-width: 340px; display: flex; flex-direction: column; gap: 14px;
  }
  .modal h2 { font-size: 1rem; font-weight: 600; color: #ccc; text-align: center; }
  .modal input {
    width: 100%; padding: 10px 14px; border-radius: 10px;
    border: 1px solid #2a2a4a; background: #12122a; color: #ccc; font-size: 0.9rem;
  }
  .modal input:focus { outline: none; border-color: #e94560; }
  .btn { padding: 10px; border-radius: 10px; border: none; font-size: 0.9rem; cursor: pointer; font-weight: 500; transition: background 0.15s; }
  .btn.primary { background: #e94560; color: #fff; }
  .btn.primary:active { background: #c73b52; }
  .btn.ghost { background: transparent; color: #888; border: 1px solid #333; }
</style>
</head>
<body>
<div class="app">
  <!-- 登录页 -->
  <div class="login-page" id="loginPage">
    <div class="logo">🤖</div>
    <h1>小车助手</h1>
    <p class="sub">微信扫码登录后开始对话</p>
    <div class="qr-placeholder" id="qrcodeWrap">
      <span class="status-text waiting">加载中…</span>
    </div>
    <div class="field">
      <label>小车地址</label>
      <input id="carUrlInput" type="text" placeholder="http://172.16.203.173">
    </div>
  </div>

  <!-- 聊天页 -->
  <div class="chat-page" id="chatPage">
    <div class="chat-header">
      <h1>小车助手</h1>
      <span class="car-badge" id="carUrlLabel" onclick="openSettings()" title="点击修改"></span>
    </div>
    <div class="chat" id="chat"></div>
    <div class="chat-input-row">
      <input id="input" type="text" placeholder="输入指令…" onkeydown="if(event.key==='Enter')send()">
      <button id="sendBtn" onclick="send()">↑</button>
    </div>
  </div>
</div>

<!-- 设置弹窗 -->
<div class="modal-overlay" id="settingsModal">
  <div class="modal">
    <h2>修改小车地址</h2>
    <input id="settingsCarUrl" type="text" placeholder="http://172.16.203.173">
    <button class="btn primary" onclick="saveSettings()">保存</button>
    <button class="btn ghost" onclick="closeSettings()">取消</button>
  </div>
</div>

<script>
  const $ = (id) => document.getElementById(id);
  const SID = 's' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  let currentUserId = null;

  // ---- 小车地址 localStorage ----
  function getCarUrl() {
    let u = $('carUrlInput').value.trim();
    if (!u) u = localStorage.getItem('claw_car_url') || '';
    if (!u) u = 'http://172.16.203.173';
    return u.replace(/\\/+$/, '');
  }

  (function () {
    const saved = localStorage.getItem('claw_car_url');
    if (saved) $('carUrlInput').value = saved;
    $('carUrlInput').addEventListener('input', function () {
      localStorage.setItem('claw_car_url', this.value.trim());
    });
  })();

  // ---- 扫码登录 ----
  let bindPollTimer = null;

  async function generateQR() {
    try {
      const resp = await fetch('/api/qrcode/generate');
      const data = await resp.json();
      if (!data.qrcode) {
        const oldStatus = $('bindStatus'); if (oldStatus) oldStatus.remove();
        $('qrcodeWrap').innerHTML = '<div class="status-text failed">获取二维码失败，请刷新重试</div>';
        return;
      }

      // 清理旧的状态文本
      const oldStatus = $('bindStatus');
      if (oldStatus) oldStatus.remove();

      // 用 canvas 本地生成二维码
      $('qrcodeWrap').innerHTML = '<canvas id="qrCanvas" style="width:260px;height:260px;border-radius:16px;"></canvas>';
      $('qrcodeWrap').insertAdjacentHTML('afterend', '<div class="status-text waiting" id="bindStatus">等待扫码…</div>');
      drawQR(data.qrcode_img_content);

      const qrcode = data.qrcode;
      bindPollTimer = setInterval(async () => {
        try {
          const sr = await fetch('/api/qrcode/status?qrcode=' + encodeURIComponent(qrcode));
          const sd = await sr.json();
          const el = $('bindStatus');
          if (!el) { clearInterval(bindPollTimer); return; }

          if (sd.status === 'scaned') {
            el.textContent = '已扫码，请在手机上确认授权…';
          } else if (sd.status === 'confirmed' && sd.ilink_user_id) {
            clearInterval(bindPollTimer);
            el.textContent = '登录成功！';
            el.className = 'status-text scanned';

            currentUserId = sd.ilink_user_id;
            const carUrl = getCarUrl();

            // 保存绑定和 session（不阻塞页面跳转）
            fetch('/api/bind', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: sd.ilink_user_id, carUrl }),
            }).catch(function(){});

            fetch('/api/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: SID, userId: sd.ilink_user_id, carUrl }),
            }).catch(function(){});

            // 切换到聊天页
            setTimeout(function() {
              $('loginPage').style.display = 'none';
              $('chatPage').style.display = 'flex';
              $('carUrlLabel').textContent = carUrl;
              loadHistory();
              startHistoryPolling();
            }, 800);
          } else if (sd.status === 'expired') {
            clearInterval(bindPollTimer);
            el.textContent = '二维码已过期，正在刷新…';
            el.className = 'status-text waiting';
            setTimeout(generateQR, 1000);
          }
        } catch (e) { /* ignore */ }
      }, 1500);
    } catch (e) {
      const oldStatus = $('bindStatus'); if (oldStatus) oldStatus.remove();
      $('qrcodeWrap').innerHTML = '<div class="status-text failed">请求异常: ' + e.message + '</div>';
    }
  }

  // 用 canvas 画 QR 码（fallback: 服务端代理）
  function drawQR(text) {
    const canvas = $('qrCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 260;
    canvas.width = size * 2;
    canvas.height = size * 2;
    ctx.scale(2, 2);

    // 尝试加载服务端生成的 QR 图
    const img = new Image();
    img.onload = function () {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
    };
    img.onerror = function () {
      // 完全失败时显示提示
      ctx.fillStyle = '#1a1a30';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#e94560';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('二维码加载失败', size / 2, size / 2 - 10);
      ctx.fillText('请刷新重试', size / 2, size / 2 + 14);
    };
    img.src = '/api/qrcode/img?data=' + encodeURIComponent(text);
  }

  generateQR();

  // ---- 聊天 ----
  let serverMsgCount = 0;

  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    $('chat').appendChild(div);
    $('chat').scrollTop = $('chat').scrollHeight;
  }

  function clearChat() {
    $('chat').innerHTML = '';
    serverMsgCount = 0;
  }

  async function loadHistory() {
    try {
      const resp = await fetch('/api/history?sessionId=' + SID);
      const data = await resp.json();
      clearChat();
      if (data.tokenAlive === false) {
        addMsg('agent', '微信凭证已过期，请刷新页面重新扫码登录。');
        return;
      }
      if (!data.messages || data.messages.length === 0) {
        addMsg('agent', '你好！输入指令控制小车，比如「前进 2 秒」「左转 1500」「走正方形」等。');
      } else {
        for (const m of data.messages) {
          addMsg(m.role, m.content);
        }
        serverMsgCount = data.messages.length;
      }
    } catch (e) { console.error('loadHistory error:', e); }
  }

  let historyPollTimer = null;
  function startHistoryPolling() {
    if (historyPollTimer) clearInterval(historyPollTimer);
    historyPollTimer = setInterval(async () => {
      try {
        const resp = await fetch('/api/history?sessionId=' + SID);
        const data = await resp.json();
        // Token 过期：退回登录页重新扫码
        if (data.tokenAlive === false) {
          clearInterval(historyPollTimer);
          addMsg('agent', '微信凭证已过期，请刷新页面重新扫码登录。');
          return;
        }
        if (data.messages && data.messages.length > serverMsgCount) {
          for (let i = serverMsgCount; i < data.messages.length; i++) {
            addMsg(data.messages[i].role, data.messages[i].content);
          }
          serverMsgCount = data.messages.length;
        }
      } catch (e) { console.error('poll error:', e); }
    }, 1000);
  }

  async function syncMsgCount() {
    try {
      const resp = await fetch('/api/history?sessionId=' + SID);
      const data = await resp.json();
      if (data.messages) serverMsgCount = data.messages.length;
    } catch (e) { console.error('syncMsgCount error:', e); }
  }

  function addThinking() {
    const d = document.createElement('div');
    d.className = 'thinking'; d.id = 'thinking'; d.textContent = '思考中…';
    $('chat').appendChild(d); $('chat').scrollTop = $('chat').scrollHeight;
  }
  function removeThinking() { const e = $('thinking'); if (e) e.remove(); }

  async function send() {
    const input = $('input');
    const text = input.value.trim();
    if (!text) return;
    addMsg('user', text);
    input.value = '';
    $('sendBtn').disabled = true;
    addThinking();
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sessionId: SID }),
      });
      const data = await resp.json();
      removeThinking();
      addMsg('agent', data.text || '（无回复）');
      syncMsgCount();
    } catch (e) {
      removeThinking();
      addMsg('agent', '错误: ' + e.message);
    }
    $('sendBtn').disabled = false;
    input.focus();
  }

  // ---- 设置 ----
  function openSettings() {
    $('settingsCarUrl').value = getCarUrl();
    $('settingsModal').classList.add('show');
  }
  function closeSettings() {
    $('settingsModal').classList.remove('show');
  }
  async function saveSettings() {
    const newUrl = $('settingsCarUrl').value.trim();
    if (!newUrl) return;
    localStorage.setItem('claw_car_url', newUrl);
    $('carUrlInput').value = newUrl;
    $('carUrlLabel').textContent = newUrl;

    if (currentUserId) {
      await fetch('/api/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, carUrl: newUrl }),
      });
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SID, userId: currentUserId, carUrl: newUrl }),
      });
    }
    closeSettings();
  }
</script>
</body>
</html>`;

// ---- HTTP server ----
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const json = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    // 页面
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }

    // 智能体对话
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { text, sessionId } = JSON.parse(body);
        if (!text) { json(400, { ok: false, message: '缺少 text' }); return; }

        const sess = sessionId ? getSession(sessionId) : { history: [], carUrl: null };

        // 已绑定用户：与微信共享同一份历史记录
        let hist;
        if (sess.userId) {
          if (!wxHistories.has(sess.userId)) wxHistories.set(sess.userId, []);
          hist = wxHistories.get(sess.userId);
        } else {
          hist = sess.history;
        }

        const prevCarUrl = process.env.CAR_HTTP_BASE_URL;
        if (sess.carUrl) process.env.CAR_HTTP_BASE_URL = sess.carUrl;

        try {
          const result = await agent.chat(text, hist, { toolRetries: 1 });
          hist.push({ role: 'user', content: text });
          hist.push({ role: 'assistant', content: result.text || '' });
          if (hist.length > 30) hist.splice(0, hist.length - 30);
          json(200, { ok: true, text: result.text || '' });
        } finally {
          if (prevCarUrl !== undefined) {
            process.env.CAR_HTTP_BASE_URL = prevCarUrl;
          } else {
            delete process.env.CAR_HTTP_BASE_URL;
          }
        }
      } catch (err) {
        json(500, { ok: false, text: '错误: ' + (err instanceof Error ? err.message : String(err)) });
      }
      return;
    }

    // 绑定 session 到 userId
    if (url.pathname === '/api/session' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { sessionId, userId, carUrl } = JSON.parse(body);
        const sess = getSession(sessionId);
        sess.userId = userId;
        sess.carUrl = carUrl;
        json(200, { ok: true });
      } catch (err) {
        json(400, { ok: false });
      }
      return;
    }

    // 获取共享历史记录
    if (url.pathname === '/api/history' && req.method === 'GET') {
      const sid = url.searchParams.get('sessionId');
      if (!sid) { json(400, { ok: false }); return; }
      const sess = sessions.get(sid);
      if (!sess?.userId) { json(200, { ok: true, messages: [] }); return; }
      const hist = wxHistories.get(sess.userId) || [];
      const tokenAlive = !!process.env.WEIXIN_ILINK_TOKEN?.trim();
      json(200, { ok: true, tokenAlive, messages: hist.map((m) => ({ role: m.role, content: m.content })) });
      return;
    }

    // 二维码图片代理（解决外部服务不可达问题）
    if (url.pathname === '/api/qrcode/img' && req.method === 'GET') {
      const data = url.searchParams.get('data');
      if (!data) { json(400, { ok: false }); return; }

      // 尝试多个 QR 码生成服务
      const services = [
        `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(data)}`,
        `https://chart.googleapis.com/chart?chs=260x260&cht=qr&chl=${encodeURIComponent(data)}`,
      ];

      for (const svc of services) {
        try {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 5000);
          const r = await fetch(svc, { signal: controller.signal });
          clearTimeout(t);
          if (r.ok) {
            const buf = await r.arrayBuffer();
            const ct = r.headers.get('content-type') || 'image/png';
            res.writeHead(200, { 'Content-Type': ct, 'Content-Length': buf.byteLength });
            res.end(Buffer.from(buf));
            return;
          }
        } catch (e) { /* try next */ }
      }

      // 全部失败，返回占位图
      json(502, { ok: false, message: '无法生成二维码' });
      return;
    }

    // 获取二维码
    if (url.pathname === '/api/qrcode/generate' && req.method === 'GET') {
      try {
        const raw = await weixinIlinkApiGet({
          baseUrl: FIXED_ILINK_BASE,
          endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(BOT_TYPE)}`,
          timeoutMs: QRCODE_TIMEOUT_MS,
          label: 'get_bot_qrcode',
        });
        const data = JSON.parse(raw);
        if (!data.qrcode) { json(502, { ok: false, message: '未获取到二维码' }); return; }
        json(200, { ok: true, qrcode: data.qrcode, qrcode_img_content: data.qrcode_img_content });
      } catch (err) {
        json(502, { ok: false, message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // 轮询扫码状态
    if (url.pathname === '/api/qrcode/status' && req.method === 'GET') {
      const qrcode = url.searchParams.get('qrcode');
      if (!qrcode) { json(400, { status: 'error' }); return; }
      try {
        const raw = await weixinIlinkApiGet({
          baseUrl: FIXED_ILINK_BASE,
          endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
          timeoutMs: QR_POLL_TIMEOUT_MS,
          label: 'get_qrcode_status',
        });
        const data = JSON.parse(raw);
        // 确认登录时保存 bot_token 并启动微信服务
        // 注意：文件操作不能影响 API 响应，否则前端收不到 confirmed 状态
        if (data.status === 'confirmed' && data.bot_token) {
          console.log('[qr] 扫码确认，刷新凭证...');
          // 停掉旧的过期服务，准备用新 token 重启
          stopReminders();
          stopInbound();
          stopReminders = () => {};
          stopInbound = () => {};
          weixinServicesStarted = false;
          currentServiceToken = null;

          process.env.WEIXIN_ILINK_TOKEN = data.bot_token;
          if (data.baseurl) {
            process.env.WEIXIN_ILINK_BASE_URL = data.baseurl.endsWith('/') ? data.baseurl : data.baseurl + '/';
          }
          try {
            const credDir = path.join(os.homedir(), '.openagent');
            fs.mkdirSync(credDir, { recursive: true });
            fs.writeFileSync(path.join(credDir, 'weixin-ilink.json'), JSON.stringify({
              token: data.bot_token,
              baseUrl: data.baseurl || FIXED_ILINK_BASE,
              userId: data.ilink_user_id,
              savedAt: new Date().toISOString(),
            }, null, 2));
          } catch { /* 文件写入失败不影响登录流程 */ }
          startWeixinServices();
        }
        json(200, { status: data.status, ilink_user_id: data.ilink_user_id || data.userId || null });
      } catch (err) {
        console.error('[qr status]', err instanceof Error ? err.message : err);
        json(200, { status: 'wait' });
      }
      return;
    }

    // 保存绑定
    if (url.pathname === '/api/bind' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const { userId, carUrl } = JSON.parse(body);
        if (!userId || !carUrl) { json(400, { ok: false }); return; }
        json(200, { ok: true, ...saveBinding({ userId, carUrl }) });
      } catch (err) {
        json(400, { ok: false, message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    json(404, { ok: false, message: 'Not found' });
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }));
    }
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function getNetworkUrls(port) {
  const ifaces = os.networkInterfaces();
  const urls = [];
  for (const [, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) urls.push(`http://${addr.address}:${port}`);
    }
  }
  return urls;
}

// ---- 启动 ----
(async function main() {
  // 先启动 Web 服务，不阻塞
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('端口 ' + PORT + ' 已被占用，请先关闭占用进程或设置 WEB_PORT 环境变量。');
    } else {
      console.error('服务器启动失败:', err.message);
    }
    process.exit(1);
  });

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log('');
  console.log('小车助手已启动:');
  console.log('  本地: http://localhost:' + PORT);
  const nets = getNetworkUrls(PORT);
  if (nets.length) {
    console.log('  局域网: ' + nets[0]);
    nets.slice(1).forEach((u) => console.log('          ' + u));
  }
  console.log('已注册工具: ' + registry.listNames().join(', '));
  console.log('');

  // 尝试从缓存文件加载已有 token，有则启动
  async function tryLoadCachedToken() {
    const wx = await ensureWeixinIlinkLogin({ skipInteractive: true });
    if (wx.source !== 'none') {
      console.log('微信 iLink：已加载凭证（来源: ' + (wx.source === 'file' ? '本地文件' : wx.source) + '）');
      startWeixinServices();
    } else {
      console.log('提示：未检测到微信凭证，请通过 Web 页面扫码登录。');
    }
  }

  tryLoadCachedToken();

  process.once('SIGINT', () => {
    stopInbound();
    stopReminders();
    server.close();
    process.exit(0);
  });
})();
