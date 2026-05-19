/**
 * 用户-小车绑定存储：WeChat userId → carUrl
 * 文件路径：~/.openagent/chenlong-bindings.json
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

function stateDir() {
  const env = process.env.OPENAGENT_STATE_DIR?.trim();
  if (env) return env;
  return path.join(os.homedir(), '.openagent');
}

function filePath() {
  return path.join(stateDir(), 'chenlong-bindings.json');
}

function ensureDir() {
  fs.mkdirSync(stateDir(), { recursive: true });
}

function readAll() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.bindings)) return { bindings: data.bindings };
  } catch {
    /* ignore */
  }
  return { bindings: [] };
}

function writeAll(data) {
  ensureDir();
  const fp = filePath();
  const tmp = `${fp}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

/**
 * @param {{ userId: string, carUrl: string, label?: string }} p
 */
export function saveBinding({ userId, carUrl, label }) {
  const { bindings } = readAll();
  const idx = bindings.findIndex((b) => b.userId === userId);
  const entry = {
    userId,
    carUrl: carUrl.replace(/\/+$/, ''),
    label: label || null,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) {
    bindings[idx] = entry;
  } else {
    bindings.push(entry);
  }
  writeAll({ bindings });
  return entry;
}

/**
 * @param {string} userId
 * @returns {{ userId: string, carUrl: string, label: string | null, updatedAt: string } | null}
 */
export function getBinding(userId) {
  const { bindings } = readAll();
  return bindings.find((b) => b.userId === userId) ?? null;
}

/** @returns {Array<{ userId: string, carUrl: string, label: string | null, updatedAt: string }>} */
export function listBindings() {
  return readAll().bindings;
}

/**
 * @param {string} userId
 * @returns {boolean}
 */
export function removeBinding(userId) {
  const { bindings } = readAll();
  const next = bindings.filter((b) => b.userId !== userId);
  if (next.length === bindings.length) return false;
  writeAll({ bindings: next });
  return true;
}
