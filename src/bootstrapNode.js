/**
 * LangChain / OpenAI 等在单次请求里可能对同一 AbortSignal 注册多个 abort 监听，
 * Node 对 EventTarget 默认 maxListeners=10，会触发 MaxListenersExceededWarning。
 * 在其它模块之前 import 本文件（见 weixin-claw.js / repl.js）。
 */
import { EventEmitter, setMaxListeners } from 'node:events';

const N = Math.max(EventEmitter.defaultMaxListeners, 32);
EventEmitter.defaultMaxListeners = N;

try {
  setMaxListeners(N, process);
} catch {
  /* ignore */
}

const G = globalThis;
const Original = G.AbortController;
if (typeof Original === 'function' && !G.__chenlongClawAbortControllerPatched) {
  G.__chenlongClawAbortControllerPatched = true;
  G.AbortController = class extends Original {
    constructor() {
      super();
      try {
        setMaxListeners(N, this.signal);
      } catch {
        /* ignore */
      }
    }
  };
}

const AS = G.AbortSignal;
if (AS && typeof AS === 'function' && !G.__chenlongClawAbortSignalStaticsPatched) {
  G.__chenlongClawAbortSignalStaticsPatched = true;
  if (typeof AS.any === 'function') {
    const anyOrig = AS.any.bind(AS);
    AS.any = function patchedAny(signals) {
      const s = anyOrig(signals);
      try {
        setMaxListeners(N, s);
      } catch {
        /* ignore */
      }
      return s;
    };
  }
  if (typeof AS.timeout === 'function') {
    const timeoutOrig = AS.timeout.bind(AS);
    AS.timeout = function patchedTimeout(ms) {
      const s = timeoutOrig(ms);
      try {
        setMaxListeners(N, s);
      } catch {
        /* ignore */
      }
      return s;
    };
  }
}
