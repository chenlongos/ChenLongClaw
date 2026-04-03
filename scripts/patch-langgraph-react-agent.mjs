/**
 * 修复 @langchain/langgraph createReactAgent 的 shouldContinue：
 * 末条消息非 AIMessage 时不应路由到 ToolNode，否则会报
 * "ToolNode only accepts AIMessages as input."
 * 在 npm install 后由 postinstall 执行，langgraph 升级后若补丁失效需人工核对。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const target = path.join(root, 'node_modules/@langchain/langgraph/dist/prebuilt/react_agent_executor.js');

const OLD = `    const shouldContinue = (state) => {
        const { messages } = state;
        const lastMessage = messages[messages.length - 1];
        if (isAIMessage(lastMessage) &&
            (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0)) {
            return responseFormat != null ? "generate_structured_response" : END;
        }
        else {
            return "continue";
        }
    };`;

const NEW = `    const shouldContinue = (state) => {
        const { messages } = state;
        const lastMessage = messages[messages.length - 1];
        if (!isAIMessage(lastMessage)) {
            return END;
        }
        if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
            return responseFormat != null ? "generate_structured_response" : END;
        }
        return "continue";
    };`;

if (!fs.existsSync(target)) {
  console.warn('[patch-langgraph-react-agent] skip: not found', target);
  process.exit(0);
}

let s = fs.readFileSync(target, 'utf8');
if (s.includes('if (!isAIMessage(lastMessage))')) {
  console.log('[patch-langgraph-react-agent] already applied');
  process.exit(0);
}
if (!s.includes('else {\n            return "continue"')) {
  console.warn('[patch-langgraph-react-agent] pattern mismatch; langgraph may have changed. Skip.');
  process.exit(0);
}
if (!s.includes(OLD)) {
  console.warn('[patch-langgraph-react-agent] exact block not found; skip.');
  process.exit(0);
}
s = s.replace(OLD, NEW);
fs.writeFileSync(target, s);
console.log('[patch-langgraph-react-agent] patched createReactAgent shouldContinue');
