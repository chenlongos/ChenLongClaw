/**
 * 微信定时提醒工具：写入 ~/.openagent/chenlong-reminders.json，由 reminderScheduler 到期发送
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { addReminder, listReminders, removeReminder } from './reminderStore.js';

const createSchema = z
  .object({
    fire_at_iso: z.string().optional().nullable().describe('触发时间 ISO8601，如 2026-03-29T15:00:00+08:00'),
    delay_minutes: z.number().positive().optional().nullable().describe('从当前起延后分钟数'),
    message: z.string().min(1).describe('到点发给用户的微信文本'),
    label: z.string().optional().nullable().describe('可选备注，仅本地记录'),
  })
  .refine((d) => Boolean(d.fire_at_iso?.trim()) || d.delay_minutes != null, {
    message: '必须提供 fire_at_iso 或 delay_minutes 之一',
  });

const weixinReminderCreate = new DynamicStructuredTool({
  name: 'weixin_reminder_create',
  description:
    '创建定时提醒：到指定时间向**当前微信用户**发一条消息。同一用户请求只调用本工具一次；若已调用勿重复。返回 ok:true 即已落盘。',
  schema: createSchema,
  func: async ({ fire_at_iso, delay_minutes, message, label }) => {
    const toUserId = process.env.WEIXIN_DEFAULT_TO_USER_ID?.trim();
    const contextToken = process.env.WEIXIN_DEFAULT_CONTEXT_TOKEN?.trim() || null;
    if (!toUserId) {
      return JSON.stringify({
        ok: false,
        error: '无当前微信用户（请在微信里对话创建提醒，或设置 WEIXIN_DEFAULT_TO_USER_ID）',
      });
    }
    let fireAtMs;
    if (delay_minutes != null) {
      fireAtMs = Date.now() + Math.round(delay_minutes * 60_000);
    } else if (fire_at_iso?.trim()) {
      const t = Date.parse(fire_at_iso.trim());
      if (Number.isNaN(t)) {
        return JSON.stringify({ ok: false, error: 'fire_at_iso 无法解析为时间' });
      }
      fireAtMs = t;
    } else {
      return JSON.stringify({ ok: false, error: '需要 delay_minutes 或 fire_at_iso' });
    }
    if (fireAtMs <= Date.now()) {
      return JSON.stringify({ ok: false, error: '触发时间须晚于当前时间' });
    }
    const row = addReminder({
      fireAtMs,
      toUserId,
      contextToken,
      text: message,
      label: label ?? null,
    });
    const fireAtIso = new Date(row.fireAtMs).toISOString();
    const localDisplay = new Date(row.fireAtMs).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return JSON.stringify({
      ok: true,
      id: row.id,
      fire_at_iso: fireAtIso,
      fire_at_local_zh: `${localDisplay}（东八区）`,
      message: row.text,
      storage: '~/.openagent/chenlong-reminders.json',
      assistant_reply_hint:
        `提醒已成功写入定时任务，触发时间：${localDisplay}（东八区）。请在回复中明确告知用户「已设置好该时间点的微信提醒」，不要索要「今天几号」或声称无法设置日期。`,
    });
  },
});

const weixinReminderList = new DynamicStructuredTool({
  name: 'weixin_reminder_list',
  description: '列出尚未触发的定时提醒（id、触发时间、摘要）。',
  schema: z.object({}),
  func: async () => {
    const all = listReminders();
    const now = Date.now();
    const pending = all.filter((r) => r.fireAtMs > now);
    return JSON.stringify({
      ok: true,
      count: pending.length,
      reminders: pending.map((r) => ({
        id: r.id,
        fire_at_iso: new Date(r.fireAtMs).toISOString(),
        text_preview: r.text.slice(0, 120),
        label: r.label,
      })),
    });
  },
});

const weixinReminderCancel = new DynamicStructuredTool({
  name: 'weixin_reminder_cancel',
  description: '按 id 取消一条待发送的提醒。',
  schema: z.object({
    id: z.string().min(1).describe('weixin_reminder_create 或列表返回的 id'),
  }),
  func: async ({ id }) => {
    const ok = removeReminder(id);
    return JSON.stringify({ ok, id, message: ok ? '已取消' : '未找到该 id' });
  },
});

export const reminderTools = {
  weixin_reminder_create: weixinReminderCreate,
  weixin_reminder_list: weixinReminderList,
  weixin_reminder_cancel: weixinReminderCancel,
};
