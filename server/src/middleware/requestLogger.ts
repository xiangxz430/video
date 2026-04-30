import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { RequestLog, AIApiCall } from '../types/index.js';
import { logStorage, LogContext } from '../services/logContext.js';
import { maskKey } from '../services/apiKeyService.js';
import { getLogsCollection } from '../services/mongoService.js';

// ========== 请求日志中间件（MongoDB 存储版） ==========
// 核心变化：
//   - 日志写入 MongoDB（异步 fire-and-forget，不阻塞请求）
//   - 读取全部走 MongoDB 查询（索引加速，不再全量加载到内存）
//   - 管理 MongoDB 连接由 mongoService.ts 管理

// ========== 脱敏 & 辅助函数 ==========

// 从路径提取功能分类
function extractFunctionFromPath(urlPath: string): string {
  const segments = urlPath.split('/').filter(Boolean);
  if (segments.length >= 2 && segments[0] === 'api') {
    const func = segments[1];
    if (['script', 'storyboard', 'image', 'video'].includes(func)) {
      return func;
    }
  }
  return 'other';
}

// 根据 endpoint 推断默认 provider
function inferDefaultProvider(endpoint: string): string {
  if (endpoint.startsWith('/api/script/')) return 'deepseek';
  if (endpoint === '/api/image/generate') return 'volcengine';
  if (endpoint === '/api/image/character') return 'qwen';
  if (endpoint === '/api/image/scene') return 'qwen';
  if (endpoint === '/api/video/generate') return 'volcengine';
  if (endpoint.startsWith('/api/video/')) return 'volcengine';
  if (endpoint.startsWith('/api/storyboard/')) return 'deepseek';
  return '';
}

// 提取请求摘要
function extractRequestSummary(body: any): string {
  if (!body || typeof body !== 'object') return '';
  if (body.prompt && typeof body.prompt === 'string') return body.prompt.slice(0, 100);
  if (body.script && typeof body.script === 'string') return body.script.slice(0, 100);
  if (body.content && typeof body.content === 'string') return body.content.slice(0, 100);
  if (body.text && typeof body.text === 'string') return body.text.slice(0, 100);
  return '';
}

// 需要截断的超长字段名（与 logContext.ts 的 AI_TRUNCATABLE_FIELDS 保持同步）
const TRUNCATABLE_FIELDS = new Set([
  'script', 'content', 'prompt', 'description',
  'episodeContent',
  'firstFrameRefImage', 'lastFrameRefImage',
  'image', 'imageUrl', 'videoUrl', 'url',
]);
// firstFrameImage / lastFrameImage / referenceImage / referenceImages 由 stripBase64ImageFields 单独处理，不在此截断

const TRUNCATE_LIMIT = 200;
const ARRAY_ELEMENT_LIMIT = 10;
const MAX_SANITIZE_DEPTH = 4;

function sanitizeBody(body: any, depth: number = 0): Record<string, any> {
  if (depth > MAX_SANITIZE_DEPTH) return { _truncated: '[max-depth]' };
  if (!body || typeof body !== 'object') return {};

  if (Array.isArray(body)) {
    return body.slice(0, ARRAY_ELEMENT_LIMIT).map(item => {
      if (typeof item === 'string' && item.length > TRUNCATE_LIMIT) {
        return item.slice(0, TRUNCATE_LIMIT) + '...[truncated]';
      }
      return typeof item === 'object' && item !== null ? sanitizeBody(item, depth + 1) : item;
    }) as any;
  }

  const result: Record<string, any> = {};
  for (const key of Object.keys(body)) {
    const value = body[key];
    if (typeof value === 'string' && TRUNCATABLE_FIELDS.has(key) && value.length > TRUNCATE_LIMIT) {
      result[key] = value.slice(0, TRUNCATE_LIMIT) + '...[truncated]';
    } else if (Array.isArray(value)) {
      result[key] = value.slice(0, ARRAY_ELEMENT_LIMIT).map(item => {
        if (typeof item === 'string' && TRUNCATABLE_FIELDS.has(key) && item.length > TRUNCATE_LIMIT) {
          return item.slice(0, TRUNCATE_LIMIT) + '...[truncated]';
        }
        return typeof item === 'object' && item !== null ? sanitizeBody(item, depth + 1) : item;
      });
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeBody(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// 从 Authorization 头提取 API Key
function extractApiKey(req: Request): string {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return 'unknown';
  return authHeader.slice(7);
}

// ========== 请求日志中间件 ==========

/**
 * 判断字符串是否为 base64 图片数据（以 data:image/ 开头或超长字符串）
 */
function isBase64Image(value: string): boolean {
  return value.startsWith('data:image/') || value.length > 10000;
}

/**
 * 将请求体中所有 base64 图片字段替换为可读占位符，避免日志溢出。
 * 处理字段：
 *   - firstFrameImage / lastFrameImage：首帧/尾帧图片 base64
 *   - referenceImages：参考图片数组，每个元素是 base64
 *   - referenceImage：原有参考图片（支持多种格式）
 */
function stripBase64ImageFields(body: Record<string, any>): Record<string, any> {
  if (!body) return body;

  // ---- firstFrameImage ----
  if (body.firstFrameImage != null) {
    if (typeof body.firstFrameImage === 'string' && isBase64Image(body.firstFrameImage)) {
      body.firstFrameImage = '[base64 firstFrameImage omitted]';
    }
  }

  // ---- lastFrameImage ----
  if (body.lastFrameImage != null) {
    if (typeof body.lastFrameImage === 'string' && isBase64Image(body.lastFrameImage)) {
      body.lastFrameImage = '[base64 lastFrameImage omitted]';
    }
  }

  // ---- referenceImages (数组) ----
  if (body.referenceImages && Array.isArray(body.referenceImages)) {
    const count = body.referenceImages.length;
    if (count > 0) {
      // 判断元素是含 data 字段的对象还是纯 base64 字符串
      const first = body.referenceImages[0];
      if (typeof first === 'object' && first !== null && 'data' in first) {
        body.referenceImages = body.referenceImages.map((item: any, idx: number) => ({
          ...item,
          data: `[base64 referenceImage #${idx + 1} omitted]`,
        }));
      } else {
        body.referenceImages = [`[base64 referenceImages x ${count} omitted]`];
      }
    }
  }

  // ---- referenceImage (原有逻辑) ----
  if (body.referenceImage) {
    const ref = body.referenceImage;

    if (body.referenceImageMeta && Array.isArray(body.referenceImageMeta) && body.referenceImageMeta.length > 0) {
      // 有 meta 信息，用文件名替换 base64 内容
      body.referenceImage = body.referenceImageMeta.map(m => `[${m.fileName}]`);
    } else if (typeof ref === 'string') {
      body.referenceImage = '[base64 image, see referenceImageMeta]';
    } else if (Array.isArray(ref)) {
      const count = ref.length;
      if (count > 0 && typeof ref[0] === 'object' && ref[0] !== null && 'data' in ref[0]) {
        body.referenceImage = ref.map((item: any, idx: number) => ({
          ...item,
          data: `[base64 image #${idx + 1}, see referenceImageMeta]`,
        }));
      } else {
        body.referenceImage = [`[base64 image x ${count}, see referenceImageMeta]`];
      }
    } else if (typeof ref === 'object' && ref !== null && 'data' in ref) {
      body.referenceImage = { ...ref, data: '[base64 image, see referenceImageMeta]' };
    }
  }

  return body;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const reqPath = req.path || req.url;

  // 排除 /api/admin/* 和 /api/health
  if (reqPath.startsWith('/api/admin/') || reqPath === '/api/health') {
    return next();
  }
  // 只记录 /api/* 请求
  if (!reqPath.startsWith('/api/')) {
    return next();
  }

  const requestBodyRaw = sanitizeBody(req.body);
  const requestBody = stripBase64ImageFields(requestBodyRaw);

  // 拦截 res.json() 捕获响应体
  const originalJson = res.json.bind(res);
  res.json = function(data: any) {
    (res as any)._responseBody = data;
    return originalJson(data);
  };

  // 拦截 res.write() 捕获 SSE 流式响应
  const originalWrite = res.write.bind(res);
  res.write = function(chunk: any, ...args: any[]) {
    try {
      const str = typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString()
          : chunk?.toString?.();
      if (str && str.includes('event: done')) {
        const dataMatch = str.match(/event:\s*done\ndata:\s*(.+)/);
        if (dataMatch) {
          try {
            (res as any)._responseBody = JSON.parse(dataMatch[1]);
          } catch {}
        }
      }
    } catch {}
    return originalWrite(chunk, ...args);
  };

  // AsyncLocalStorage 包裹，下游可记录 AI 调用
  const logCtx: LogContext = { aiApiCalls: [] };
  logStorage.run(logCtx, () => { next(); });

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    try {
      const apiKey = extractApiKey(req);
      const apiKeyMasked = maskKey(apiKey);
      const func = extractFunctionFromPath(reqPath);
      const keyId = req.apiKeyId || apiKeyMasked;

      let error: string | null = null;
      if (res.statusCode >= 400) {
        error = (res.locals as any).errorMessage || `HTTP ${res.statusCode}`;
      }

      const responseBody = sanitizeBody((res as any)._responseBody);
      const aiApiCalls: AIApiCall[] | undefined = logCtx.aiApiCalls.length > 0 ? logCtx.aiApiCalls : undefined;

      const logEntry: RequestLog = {
        id: crypto.randomUUID(),
        keyId,
        timestamp: new Date().toISOString(),
        method: req.method,
        endpoint: reqPath,
        function: func,
        provider: req.body?.provider || inferDefaultProvider(reqPath) || 'unknown',
        model: req.body?.model || 'unknown',
        apiKeyMasked,
        statusCode: res.statusCode,
        duration,
        error,
        requestSummary: extractRequestSummary(req.body),
        requestBody,
        responseBody,
        ...(aiApiCalls ? { aiApiCalls } : {}),
      };

      // 异步写入 MongoDB（fire-and-forget，不阻塞请求）
      getLogsCollection().insertOne(logEntry).catch((err: Error) => {
        console.error('[RequestLogger] 写入 MongoDB 失败:', err.message);
      });
    } catch (error) {
      console.error('[RequestLogger] 记录日志失败:', error);
    }
  });
}

// ========== 导出 API（全部异步） ==========

/** 获取指定用户的日志（客户端统计用，走 keyId 索引，0 跨用户开销） */
export async function getLogsByUser(keyId: string): Promise<RequestLog[]> {
  return getLogsCollection()
    .find({ keyId })
    .sort({ timestamp: -1 })
    .limit(500)
    .toArray();
}

/** 获取所有用户的日志（管理后台用） */
export async function getAllLogs(): Promise<RequestLog[]> {
  return getLogsCollection()
    .find()
    .sort({ timestamp: -1 })
    .limit(2000)
    .toArray();
}

/** 按 ID 查找日志（管理后台日志详情用） */
export async function getLogById(id: string): Promise<RequestLog | null> {
  return getLogsCollection().findOne({ id });
}
