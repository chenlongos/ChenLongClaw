import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

function stateDir() {
  const env = process.env.OPENAGENT_STATE_DIR?.trim();
  if (env) return env;
  return path.join(os.homedir(), '.openagent');
}

export function remindersFilePath() {
  return path.join(stateDir(), 'chenlong-reminders.json');
}

function ensureDir() {
  const d = stateDir();
  fs.mkdirSync(d, { recursive: true });
}

/** @returns {{ reminders: Array<{ id: string, fireAtMs: number, toUserId: string, contextToken: string | null, text: string, label: string | null, createdAtMs: number }> }} */
function readAll() {
  const fp = remindersFilePath();
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.reminders)) return { reminders: data.reminders };
  } catch {
    /* ignore */
  }
  return { reminders: [] };
}

function writeAll(data) {
  ensureDir();
  const fp = remindersFilePath();
  const tmp = `${fp}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

function normText(t) {
  return String(t ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {{ fireAtMs: number, toUserId: string, contextToken?: string | null, text: string, label?: string | null }} p
 */
export function addReminder(p) {
  const now = Date.now();
  let { reminders } = readAll();
  const msgKey = normText(p.text);
  // 同一用户、同一条提醒文案：只保留最新一次（避免模型连续调用两次 weixin_reminder_create 产生两条待发送）
  reminders = reminders.filter((r) => {
    if (r.toUserId !== p.toUserId) return true;
    if (r.fireAtMs <= now) return true;
    if (normText(r.text) !== msgKey) return true;
    return false;
  });
  const id = `r-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const row = {
    id,
    fireAtMs: p.fireAtMs,
    toUserId: p.toUserId,
    contextToken: p.contextToken ?? null,
    text: p.text,
    label: p.label ?? null,
    createdAtMs: Date.now(),
  };
  reminders.push(row);
  reminders.sort((a, b) => a.fireAtMs - b.fireAtMs);
  writeAll({ reminders });
  return row;
}

export function listReminders() {
  return readAll().reminders;
}

export function removeReminder(id) {
  const { reminders } = readAll();
  const next = reminders.filter((r) => r.id !== id);
  writeAll({ reminders: next });
  return reminders.length !== next.length;
}

/** @param {number} nowMs */
export function pullDueReminders(nowMs) {
  const { reminders } = readAll();
  const due = reminders.filter((r) => r.fireAtMs <= nowMs);
  if (due.length === 0) return [];
  const remain = reminders.filter((r) => r.fireAtMs > nowMs);
  writeAll({ reminders: remain });
  return due;
}
