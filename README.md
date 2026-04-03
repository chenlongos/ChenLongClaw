# ChenLong Claw

基于 [OpenAgent](https://github.com/asmcos/OpenAgent) 的 Node.js 示例：微信 iLink 文本对话 + LangChain 工具控制小车、机械臂、摄像头与远程识图。**工具实现为桩**：成功路径用 `console.log` 打印，便于后续替换为真实 HTTP/串口。

## 依赖

- Node.js ≥ 20
- 已配置的 LLM（本地 **Ollama** 或 `config.json` 中其它 OpenAI 兼容端点）

## 配置

- 首次进入仓库先执行 **`npm run setup`**（安装依赖并生成 vendor、打补丁；若已有 `.env.example` 会复制为 `.env`）。
- 按需编辑 `.env`（`OPENAGENT_PROVIDER`、`OPENAGENT_MODEL` 等）；若 `setup` 未生成 `.env`，可手动复制 `.env.example`。
- 根目录 `config.json` 与 OpenAgent 约定一致：`provider` → `name` / `options` / `models`。

## 命令

| 命令 | 说明 |
|------|------|
| **`npm run setup`** | **推荐首次克隆后执行**：脚本里**按顺序显式执行** `scripts/vendor-openagent-core.mjs` → `npm install --ignore-scripts` → `scripts/patch-langgraph-react-agent.mjs`（见 `scripts/setup.mjs` 注释）；若存在 `.env.example` 且无 `.env` 会复制一份 |
| `npm install` | 不跑 setup 时可用：会走 `package.json` 的 **`preinstall`**（同 vendor 脚本）与 **`postinstall`**（同补丁脚本），需要 **git** 与网络 |
| `npm run vendor:openagent` | 仅重新生成 `vendor/openagent-core`（与 `preinstall` 同源；可设 `OPENAGENT_FORCE_VENDOR=1`） |
| `npm run repl` | 仅终端对话（不启微信入站） |
| `npm start` | 微信凭证 + 入站轮询 + 本地 REPL |
| `npm run weixin-login` | 仅扫码，写入 `~/.openagent/weixin-ilink.json` |

微信与 OpenAgent 文档一致：需 `WEIXIN_ILINK_TOKEN`（扫码后自动生成）。启动参数：`--no-weixin-login`、`--no-weixin-inbound`、`--no-weixin-auto-reply`。

`vendor/openagent-core` 的来源：`package.json` 里 `"@openagent/core": "file:./vendor/openagent-core"` 指向该目录；**不要手改目录名**。更新上游 core 时执行 `OPENAGENT_FORCE_VENDOR=1 npm run vendor:openagent`。无 git 或离线时可设置 `OPENAGENT_SKIP_VENDOR=1` 并自行从 OpenAgent 仓库拷贝 `packages/core` 到 `vendor/openagent-core`，再复制 `scripts/openagent-core-patches/*.js` 到 `vendor/openagent-core/src/`。

## 说明

上游 `packages/core` 的 `index.js` 会引用 `historyTrim.js`、`taskRunner.js`，但仓库里可能未包含这两文件；vendor 脚本在拉取 core 后，会用本仓库 `scripts/openagent-core-patches/` 下的同名文件覆盖写入。若上游已补齐，补丁内容与官方行为一致即可。若日后改为 npm 官方包依赖，可删除 `vendor/` 与相关脚本。

## 工具（桩）

- `car_move`：开环，`moves: [{ action, duration_ms }]` → `/api/control`（`CAR_HTTP_BASE_URL`）  
- `car_navigate_to`：目标位姿（`CAR_NAVIGATE_PATH`）；拍照、识图请再调 `camera_capture`、`vision_recognize_remote`  
- `arm_grasp`：抓取 / 松开  
- `camera_capture`：取图（返回占位 URL）  
- `vision_recognize_remote`：远程识图（占位结果）

真机对接时只需改 `src/clawTools.js` 中各 `func`，保留 `name` / `schema` 即可。
