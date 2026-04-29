import { AsyncLocalStorage } from 'node:async_hooks';
import { AIApiCall } from '../types/index.js';

export interface LogContext {
  aiApiCalls: AIApiCall[];
}

export const logStorage = new AsyncLocalStorage<LogContext>();

/**
 * 记录一次 AI API 调用到当前请求的日志上下文
 * 可在任何 AI 服务函数中直接调用，无需传递 res 参数
 */
export function recordAICall(call: AIApiCall): void {
  const ctx = logStorage.getStore();
  if (ctx) {
    ctx.aiApiCalls.push(call);
  }
}

// ========== AI 调用请求/响应体脱敏工具 ==========

const AI_TRUNCATABLE_FIELDS = new Set([
  'script', 'content', 'episodeContent', 'prompt',
  'referenceImage', 'firstFrameImage', 'lastFrameImage',
  'firstFrameRefImage', 'lastFrameRefImage',
  'image', 'imageUrl', 'videoUrl', 'url',
]);

const AI_TRUNCATE_LIMIT = 300;
const AI_ARRAY_LIMIT = 5;

/**
 * 脱敏 AI API 调用的请求/响应体
 * - 截断超长字符串（如 base64 图片、完整剧本）
 * - 递归处理嵌套对象和数组
 * - 保留结构便于调试
 */
export function sanitizeAICallBody(body: any, depth: number = 0): any {
  if (depth > 5) return '[max-depth]';
  if (body === null || body === undefined) return body;
  if (typeof body === 'number' || typeof body === 'boolean') return body;
  if (typeof body === 'string') {
    return body.length > AI_TRUNCATE_LIMIT
      ? body.slice(0, AI_TRUNCATE_LIMIT) + '...[truncated]'
      : body;
  }
  if (Array.isArray(body)) {
    if (body.length > AI_ARRAY_LIMIT) {
      const items = body.slice(0, AI_ARRAY_LIMIT).map(item => sanitizeAICallBody(item, depth + 1));
      items.push(`...[${body.length - AI_ARRAY_LIMIT} more items]`);
      return items;
    }
    return body.map(item => sanitizeAICallBody(item, depth + 1));
  }
  if (typeof body === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(body)) {
      const value = body[key];
      if (typeof value === 'string' && AI_TRUNCATABLE_FIELDS.has(key) && value.length > AI_TRUNCATE_LIMIT) {
        result[key] = value.slice(0, AI_TRUNCATE_LIMIT) + '...[truncated]';
      } else {
        result[key] = sanitizeAICallBody(value, depth + 1);
      }
    }
    return result;
  }
  return body;
}
