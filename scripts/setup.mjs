#!/usr/bin/env node
/**
 * 显式三步（不依赖你「猜」npm 钩子做了什么）：
 * 1) scripts/vendor-openagent-core.mjs  → 生成 vendor/openagent-core（@openagent/core 的 file: 依赖）
 * 2) npm install --ignore-scripts        → 只装 node_modules，避免本脚本里再跑一遍 preinstall
 * 3) scripts/patch-langgraph-react-agent.mjs → 给 LangGraph 打补丁
 *
 * 若你直接执行 `npm install`（不用 setup），仍会走 package.json 的 preinstall/postinstall，效果等价。
 * 若存在 .env.example 且尚无 .env，则复制一份。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

function run(label, cmd) {
  console.log(`\n${label}\n  → ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', shell: true });
}

console.log('\n======== chenlong-claw · setup ========\n');

run('[1/3] 生成 OpenAgent vendor（与 npm preinstall 同源）', 'node scripts/vendor-openagent-core.mjs');

run(
  '[2/3] 安装 npm 依赖（使用 --ignore-scripts，因步骤 1 已 vendor；补丁在步骤 3 单独执行）',
  'npm install --ignore-scripts'
);

run('[3/3] LangGraph createReactAgent 补丁（与 npm postinstall 同源）', 'node scripts/patch-langgraph-react-agent.mjs');

const envExample = path.join(ROOT, '.env.example');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envExample) && !fs.existsSync(envFile)) {
  fs.copyFileSync(envExample, envFile);
  console.log('\n[setup] 已复制 .env.example → .env，请按需填写。\n');
}

console.log(
  '======== setup 完成 ========\n请编辑 config.json（及 .env）。需要微信：npm run weixin-login。\n'
);
