/**
 * 定时扫描到期提醒并回调发送（与 Agent 解耦，不依赖提示词）
 */
import { pullDueReminders } from './reminderStore.js';

const DEFAULT_INTERVAL_MS = 2000;

/**
 * @param {(row: { id: string, fireAtMs: number, toUserId: string, contextToken: string | null, text: string }) => Promise<void>} onSend
 * @returns {() => void} stop
 */
export function startReminderScheduler(onSend, intervalMs = DEFAULT_INTERVAL_MS) {
  const timer = setInterval(async () => {
    const due = pullDueReminders(Date.now());
    for (const row of due) {
      try {
        console.log(`[reminder] 到期发送 → ${row.toUserId}: ${row.text.slice(0, 80)}${row.text.length > 80 ? '…' : ''}`);
        await onSend(row);
      } catch (e) {
        console.error('[reminder] 发送失败:', e instanceof Error ? e.message : e);
      }
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
