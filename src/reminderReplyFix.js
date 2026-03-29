import { createClawToolCallbacks } from './toolCallbacks.js';

/**
 * 工具 weixin_reminder_create 已在本地落盘成功时，最终发微信的文案应以「已设置」为准，
 * 不依赖模型是否编造「格式问题」「请问几号」等。
 */

/** @param {string} text */
function stripReminderContradictions(text) {
  const badLine =
    /格式问题|时间格式|请问.*几号|今天是几号|现在是几点|无法.*设置|准确设置|设置时遇到|需要知道|请告诉我|明天的日期|或者请直接|几号才能|还是\s*\*\*|遇到.*问题|我来帮你设置|我需要确认|立刻帮您|关于明天|确认.*日期|请告诉我.*日期|才能准确|比如是.*吗|明天早上.*吗/;
  return text
    .split(/\n+/)
    .filter((line) => line.trim() && !badLine.test(line))
    .join('\n')
    .trim();
}

/** 去重（按 id，无 id 则都保留） */
function dedupeReminders(arr) {
  const seen = new Set();
  const out = [];
  for (const r of arr) {
    const id = typeof r.id === 'string' ? r.id : null;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(r);
  }
  return out;
}

/** 同一轮里模型多次 create 成功：按提醒正文保留最后一条（展示用） */
function dedupeReminderJsonByMessage(arr) {
  const byMsg = new Map();
  for (const r of arr) {
    const key = typeof r.message === 'string' ? r.message.trim().replace(/\s+/g, ' ') : '';
    byMsg.set(key, r);
  }
  return [...byMsg.values()];
}

/**
 * 从 LangGraph 最终 state.messages 里解析 ToolMessage（与 onToolEnd 双保险）
 * @param {unknown} state
 */
export function extractReminderSuccessesFromAgentState(state) {
  const out = [];
  const msgs = state?.messages;
  if (!Array.isArray(msgs)) return out;
  for (const m of msgs) {
    const name = m?.name ?? m?.tool_name;
    if (name !== 'weixin_reminder_create') continue;
    let content = m?.content;
    if (Array.isArray(content)) {
      content = content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('');
    }
    if (typeof content !== 'string') continue;
    const tryParse = (s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    };
    const j = tryParse(content);
    if (j && j.ok === true) out.push(j);
  }
  return dedupeReminders(out);
}

/**
 * @param {string} modelReply
 * @param {Array<Record<string, unknown>>} reminderOkJson
 */
export function mergeWeixinReplyAfterReminders(modelReply, reminderOkJson) {
  const list = dedupeReminderJsonByMessage(dedupeReminders(reminderOkJson));
  if (!list.length) {
    const t = (modelReply || '').trim();
    return t || '…';
  }
  const header = list
    .map((r) => {
      const when = r.fire_at_local_zh || r.fire_at_iso || '';
      const msg = typeof r.message === 'string' ? r.message : '';
      return `【定时提醒已设置】${when} 到点将用微信提醒您：${msg}`;
    })
    .join('\n');
  let body = stripReminderContradictions(modelReply || '');
  const stillBad =
    /需要知道|请告诉我|请问.*几号|几号才能|明天的日期|我需要确认|立刻帮您|关于明天|确认.*日期|今天是几号|才能准确/;
  if (stillBad.test(body)) {
    body = stripReminderContradictions(body);
  }
  if (stillBad.test(body)) {
    body = '';
  }
  if (!body) return header;
  return `${header}\n\n${body}`;
}

/**
 * 包装工具回调：收集 weixin_reminder_create 的成功返回 JSON（供 mergeWeixinReplyAfterReminders 使用）
 */
export function createWeixinToolCallbacks() {
  /** @type {Array<Record<string, unknown>>} */
  const reminderSuccesses = [];
  const base = createClawToolCallbacks();
  return {
    reminderSuccesses,
    callbacks: {
      onToolStart: base.onToolStart,
      onToolEnd(name, result) {
        base.onToolEnd(name, result);
        const n = typeof name === 'string' ? name : '';
        if (n !== 'weixin_reminder_create') return;
        try {
          const s = typeof result === 'string' ? result : JSON.stringify(result);
          let j = JSON.parse(s);
          if (typeof j === 'string') j = JSON.parse(j);
          if (j && j.ok === true) reminderSuccesses.push(j);
        } catch {
          /* ignore */
        }
      },
    },
  };
}
