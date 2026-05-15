/**
 * DeepSeek（含 deepseek-v4-flash）思考模式：API 要求多轮对话时把上一条 assistant 的
 * `reasoning_content` 原样带回，否则返回 400。
 * @langchain/openai 的 ChatOpenAI 未读写该字段，在 npm install 后由 postinstall 修补。
 * 升级 @langchain/openai 后若补丁失效或上游已支持，可删除本脚本及 package.json 中的调用。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const MARKER = 'completionParam.reasoning_content = message.additional_kwargs.reasoning_content';

function patchJs() {
  const target = path.join(root, 'node_modules/@langchain/openai/dist/chat_models.js');
  if (!fs.existsSync(target)) {
    console.warn('[patch-langchain-openai-reasoning] skip: not found', target);
    return;
  }
  let s = fs.readFileSync(target, 'utf8');
  if (s.includes(MARKER)) {
    console.log('[patch-langchain-openai-reasoning] chat_models.js already applied');
    return;
  }

  const blocks = [
    [
      `            if (message.audio) {
                additional_kwargs.audio = message.audio;
            }
            return new AIMessage({`,
      `            if (message.audio) {
                additional_kwargs.audio = message.audio;
            }
            if (message.reasoning_content != null) {
                additional_kwargs.reasoning_content = message.reasoning_content;
            }
            return new AIMessage({`,
    ],
    [
      `    if (delta.audio) {
        additional_kwargs.audio = {
            ...delta.audio,
            index: rawResponse.choices[0].index,
        };
    }
    const response_metadata = { usage: { ...rawResponse.usage } };`,
      `    if (delta.audio) {
        additional_kwargs.audio = {
            ...delta.audio,
            index: rawResponse.choices[0].index,
        };
    }
    if (delta.reasoning_content != null) {
        additional_kwargs.reasoning_content = delta.reasoning_content;
    }
    const response_metadata = { usage: { ...rawResponse.usage } };`,
    ],
    [
      `        }
        if (message.additional_kwargs.audio &&
            typeof message.additional_kwargs.audio === "object" &&
            "id" in message.additional_kwargs.audio) {`,
      `        }
        if (isAIMessage(message) && message.additional_kwargs?.reasoning_content != null) {
            completionParam.reasoning_content = message.additional_kwargs.reasoning_content;
        }
        if (message.additional_kwargs.audio &&
            typeof message.additional_kwargs.audio === "object" &&
            "id" in message.additional_kwargs.audio) {`,
    ],
  ];

  for (const [from, to] of blocks) {
    if (!s.includes(from)) {
      console.warn('[patch-langchain-openai-reasoning] pattern mismatch in chat_models.js; skip.');
      return;
    }
    s = s.replace(from, to);
  }
  fs.writeFileSync(target, s);
  console.log('[patch-langchain-openai-reasoning] patched chat_models.js');
}

function patchCjs() {
  const target = path.join(root, 'node_modules/@langchain/openai/dist/chat_models.cjs');
  if (!fs.existsSync(target)) {
    console.warn('[patch-langchain-openai-reasoning] skip: not found', target);
    return;
  }
  let s = fs.readFileSync(target, 'utf8');
  if (s.includes(MARKER)) {
    console.log('[patch-langchain-openai-reasoning] chat_models.cjs already applied');
    return;
  }

  const blocks = [
    [
      `            if (message.audio) {
                additional_kwargs.audio = message.audio;
            }
            return new messages_1.AIMessage({`,
      `            if (message.audio) {
                additional_kwargs.audio = message.audio;
            }
            if (message.reasoning_content != null) {
                additional_kwargs.reasoning_content = message.reasoning_content;
            }
            return new messages_1.AIMessage({`,
    ],
    [
      `    if (delta.audio) {
        additional_kwargs.audio = {
            ...delta.audio,
            index: rawResponse.choices[0].index,
        };
    }
    const response_metadata = { usage: { ...rawResponse.usage } };`,
      `    if (delta.audio) {
        additional_kwargs.audio = {
            ...delta.audio,
            index: rawResponse.choices[0].index,
        };
    }
    if (delta.reasoning_content != null) {
        additional_kwargs.reasoning_content = delta.reasoning_content;
    }
    const response_metadata = { usage: { ...rawResponse.usage } };`,
    ],
    [
      `        }
        if (message.additional_kwargs.audio &&
            typeof message.additional_kwargs.audio === "object" &&
            "id" in message.additional_kwargs.audio) {`,
      `        }
        if ((0, messages_1.isAIMessage)(message) && message.additional_kwargs?.reasoning_content != null) {
            completionParam.reasoning_content = message.additional_kwargs.reasoning_content;
        }
        if (message.additional_kwargs.audio &&
            typeof message.additional_kwargs.audio === "object" &&
            "id" in message.additional_kwargs.audio) {`,
    ],
  ];

  for (const [from, to] of blocks) {
    if (!s.includes(from)) {
      console.warn('[patch-langchain-openai-reasoning] pattern mismatch in chat_models.cjs; skip.');
      return;
    }
    s = s.replace(from, to);
  }
  fs.writeFileSync(target, s);
  console.log('[patch-langchain-openai-reasoning] patched chat_models.cjs');
}

patchJs();
patchCjs();
