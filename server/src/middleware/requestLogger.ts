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
  'firstFrameImage', 'lastFrameImage',
  'firstFrameRefImage', 'lastFrameRefImage',
  'image', 'imageUrl', 'videoUrl', 'url',
]);
// referenceImage 由 stripBase64FromReferenceImage 单独处理，不在此截断

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
 * 将 referenceImage 中的 base64 数据替换为可读占位符，避免日志溢出。
 * 支持多种 referenceImage 格式：
 *   - string: 直接 base64 字符串
 *   - string[]: 多张 base64 字符串
 *   - object with `data` field: { data: base64, ... }
 *   - array of objects: [{ data: base64, ... }, ...]
 * - 有 referenceImageMeta 时：用文件名替换，便于定位原始文件
 * - 无 referenceImageMeta 时：用占位提示替换，标明图片数量
 */
function stripBase64FromReferenceImage(body: Record<string, any>): Record<string, any> {
  if (!body || !body.referenceImage) return body;

  const ref = body.referenceImage;

  if (body.referenceImageMeta && Array.isArray(body.referenceImageMeta) && body.referenceImageMeta.length > 0) {
    // 有 meta 信息，用文件名替换 base64 内容
    body.referenceImage = body.referenceImageMeta.map(m => `[${m.fileName}]`);
  } else if (typeof ref === 'string') {
    // 单张图 base64 字符串
    body.referenceImage = '[base64 image, see referenceImageMeta]';
  } else if (Array.isArray(ref)) {
    // 数组：判断元素是字符串还是对象
    const count = ref.length;
    if (count > 0 && typeof ref[0] === 'object' && ref[0] !== null && 'data' in ref[0]) {
      // 数组中是含 data 字段的对象 → 保留其他字段，替换 data
      body.referenceImage = ref.map((item: any, idx: number) => ({
        ...item,
        data: `[base64 image #${idx + 1}, see referenceImageMeta]`,
      }));
    } else {
      // 数组中是纯 base64 字符串
      body.referenceImage = [`[base64 image x ${count}, see referenceImageMeta]`];
    }
  } else if (typeof ref === 'object' && ref !== null && 'data' in ref) {
    // 单个含 data 字段的对象 → 保留其他字段，替换 data
    body.referenceImage = { ...ref, data: '[base64 image, see referenceImageMeta]' };
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
  const requestBody = stripBase64FromReferenceImage(requestBodyRaw);

  // 拦截 res.json() 捕获响应体
  const originalJson = res.json.bind(res);
  res.json = function(data: any) {
    (res as any)._responseBody = data;
    return originalJson(data);
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
