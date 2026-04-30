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
  'firstFrameRefImage', 'lastFrameRefImage',
  'image', 'imageUrl', 'videoUrl', 'url',
]);
// firstFrameImage / lastFrameImage / referenceImage / referenceImages 由下方逻辑单独处理（完全替换为占位符，不截断）

const AI_TRUNCATE_LIMIT = 300;
const AI_ARRAY_LIMIT = 5;

/** 判断字符串是否为 base64 图片数据（以 data:image/ 开头或超长字符串） */
function isBase64Image(value: string): boolean {
  return value.startsWith('data:image/') || value.length > 10000;
}

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
      if (key === 'firstFrameImage') {
        // 首帧图片 base64 → 替换为占位符
        result[key] = (typeof value === 'string' && isBase64Image(value))
          ? '[base64 firstFrameImage omitted]'
          : sanitizeAICallBody(value, depth + 1);
      } else if (key === 'lastFrameImage') {
        // 尾帧图片 base64 → 替换为占位符
        result[key] = (typeof value === 'string' && isBase64Image(value))
          ? '[base64 lastFrameImage omitted]'
          : sanitizeAICallBody(value, depth + 1);
      } else if (key === 'referenceImages') {
        // 参考图片数组 → 替换为占位符
        if (Array.isArray(value)) {
          const count = value.length;
          if (count > 0) {
            const first = value[0];
            if (typeof first === 'object' && first !== null && 'data' in first) {
              result[key] = value.map((item: any, idx: number) => ({
                ...item,
                data: `[base64 referenceImage #${idx + 1} omitted]`,
              }));
            } else {
              result[key] = [`[base64 referenceImages x ${count} omitted]`];
            }
          } else {
            result[key] = value;
          }
        } else {
          result[key] = sanitizeAICallBody(value, depth + 1);
        }
      } else if (key === 'referenceImage') {
        // 完全替换 base64 内容，不保留任何 base64 数据
        if (typeof value === 'string') {
          result[key] = '[base64 image, see referenceImageMeta]';
        } else if (Array.isArray(value)) {
          if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'data' in value[0]) {
            // 数组中是含 data 字段的对象 → 保留其他字段，替换 data
            result[key] = value.map((item: any, idx: number) => ({
              ...item,
              data: `[base64 image #${idx + 1}, see referenceImageMeta]`,
            }));
          } else {
            result[key] = [`[base64 image x ${value.length}, see referenceImageMeta]`];
          }
        } else if (typeof value === 'object' && value !== null && 'data' in value) {
          // 单个含 data 字段的对象 → 保留其他字段，替换 data
          result[key] = { ...value, data: '[base64 image, see referenceImageMeta]' };
        } else {
          result[key] = sanitizeAICallBody(value, depth + 1);
        }
      } else if (typeof value === 'string' && AI_TRUNCATABLE_FIELDS.has(key) && value.length > AI_TRUNCATE_LIMIT) {
        result[key] = value.slice(0, AI_TRUNCATE_LIMIT) + '...[truncated]';
      } else {
        result[key] = sanitizeAICallBody(value, depth + 1);
      }
    }
    return result;
  }
  return body;
}
