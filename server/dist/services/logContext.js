import { AsyncLocalStorage } from 'node:async_hooks';
export const logStorage = new AsyncLocalStorage();
/**
 * 记录一次 AI API 调用到当前请求的日志上下文
 * 可在任何 AI 服务函数中直接调用，无需传递 res 参数
 */
export function recordAICall(call) {
    const ctx = logStorage.getStore();
    if (ctx) {
        ctx.aiApiCalls.push(call);
    }
}
