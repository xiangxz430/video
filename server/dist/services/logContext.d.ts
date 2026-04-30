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
/**
 * 脱敏 AI API 调用的请求/响应体
 * - 截断超长字符串（如 base64 图片、完整剧本）
 * - 递归处理嵌套对象和数组
 * - 保留结构便于调试
 */
export declare function sanitizeAICallBody(body: any, depth?: number): any;
