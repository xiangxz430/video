import { AsyncLocalStorage } from 'node:async_hooks';
import { AIApiCall } from '../types/index.js';
export interface LogContext {
    aiApiCalls: AIApiCall[];
}
export declare const logStorage: AsyncLocalStorage<LogContext>;
/**
 * 记录一次 AI API 调用到当前请求的日志上下文
 * 可在任何 AI 服务函数中直接调用，无需传递 res 参数
 */
export declare function recordAICall(call: AIApiCall): void;
