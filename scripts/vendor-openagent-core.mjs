#!/usr/bin/env node
/**
 * 从官方仓库拉取 OpenAgent 的 packages/core，生成 vendor/openagent-core，
 * 并写入本仓库自带的补丁（historyTrim / taskRunner，上游可能未随仓库提供）。
 *
 * 环境变量：
 * - OPENAGENT_REPO_URL  默认 https://github.com/asmcos/OpenAgent.git
 * - OPENAGENT_REF       默认 main
 * - OPENAGENT_FORCE_VENDOR=1  强制重新 git clone / 覆盖 vendor
 * - OPENAGENT_SKIP_VENDOR=1   跳过（如无 git/网络）
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'openagent-upstream');
const DEST = path.join(ROOT, 'vendor', 'openagent-core');
const PATCH_DIR = path.join(ROOT, 'scripts', 'openagent-core-patches');

const REPO = process.env.OPENAGENT_REPO_URL || 'https://github.com/asmcos/OpenAgent.git';
const REF = process.env.OPENAGENT_REF || 'main';

function sh(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', encoding: 'utf8', ...opts });
}

function ensureUpstream() {
  fs.mkdirSync(path.dirname(CACHE_DIR), { recursive: true });
  if (!fs.existsSync(path.join(CACHE_DIR, '.git'))) {
    console.log(`[vendor:openagent] git clone --depth 1 ${REPO} (${REF}) → .cache/openagent-upstream`);
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    sh(`git clone --depth 1 --branch "${REF}" "${REPO}" "${CACHE_DIR}"`);
    return;
  }
  if (process.env.OPENAGENT_FORCE_VENDOR === '1') {
    console.log('[vendor:openagent] OPENAGENT_FORCE_VENDOR=1，重新 clone');
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    sh(`git clone --depth 1 --branch "${REF}" "${REPO}" "${CACHE_DIR}"`);
    return;
  }
  try {
    console.log('[vendor:openagent] 更新 .cache/openagent-upstream (git fetch + reset)');
    sh(`git -C "${CACHE_DIR}" fetch --depth 1 origin "${REF}"`, { stdio: 'pipe' });
    sh(`git -C "${CACHE_DIR}" reset --hard "origin/${REF}"`);
  } catch {
    console.warn('[vendor:openagent] git 更新失败，将重新完整 clone');
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    sh(`git clone --depth 1 --branch "${REF}" "${REPO}" "${CACHE_DIR}"`);
  }
}

function copyCore() {
  const src = path.join(CACHE_DIR, 'packages', 'core');
  if (!fs.existsSync(path.join(src, 'package.json'))) {
    throw new Error(`未找到 ${src}，请确认 OpenAgent 仓库含 packages/core`);
  }
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.cpSync(src, DEST, { recursive: true });
  console.log(`[vendor:openagent] 已复制 → ${path.relative(ROOT, DEST)}`);
}

function applyPatches() {
  for (const name of ['historyTrim.js', 'taskRunner.js']) {
    const from = path.join(PATCH_DIR, name);
    const to = path.join(DEST, 'src', name);
    if (!fs.existsSync(from)) {
      throw new Error(`缺少补丁文件: ${from}`);
    }
    fs.copyFileSync(from, to);
    console.log(`[vendor:openagent] 补丁: src/${name}`);
  }
}

function main() {
  if (process.env.OPENAGENT_SKIP_VENDOR === '1') {
    console.log('[vendor:openagent] 已跳过（OPENAGENT_SKIP_VENDOR=1）');
    return;
  }

  const force = process.env.OPENAGENT_FORCE_VENDOR === '1';
  const destReady =
    fs.existsSync(path.join(DEST, 'package.json')) &&
    fs.existsSync(path.join(DEST, 'src', 'index.js'));

  if (destReady && !force) {
    const hasPatch = fs.existsSync(path.join(DEST, 'src', 'historyTrim.js'));
    if (hasPatch) {
      if (process.env.VERBOSE_VENDOR === '1') {
        console.log('[vendor:openagent] 已存在，跳过（OPENAGENT_FORCE_VENDOR=1 可刷新）');
      }
      return;
    }
  }

  try {
    execSync('git --version', { stdio: 'pipe' });
  } catch {
    console.error('[vendor:openagent] 需要本机已安装 git，且能访问 GitHub。也可设置 OPENAGENT_SKIP_VENDOR=1 并手动拷贝 packages/core。');
    process.exit(1);
  }

  ensureUpstream();
  copyCore();
  applyPatches();
  console.log('[vendor:openagent] 完成。依赖指向 package.json 中的 "file:./vendor/openagent-core"。');
}

main();
