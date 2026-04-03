/**
 * LangChain / OpenAI / LangGraph 等会在同一 AbortSignal 上叠加较多 abort 监听，
 * Node 对 EventTarget 默认 maxListeners 较低，会触发 MaxListenersExceededWarning。
 * 在其它模块之前 import 本文件（见 weixin-claw.js / repl.js）。
 */
import { EventEmitter, setMaxListeners } from 'node:events';

/** 实测链式调用可达 30+，32 仍不够，留足余量 */
const N = 256;
EventEmitter.defaultMaxListeners = Math.max(EventEmitter.defaultMaxListeners, N);

try {
  setMaxListeners(N, process);
} catch {
  /* ignore */
}

try {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.prototype) {
    setMaxListeners(N, AbortSignal.prototype);
  }
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
