import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const LOGS_FILE = path.join(DATA_DIR, 'request-logs.json');
const MAX_LOGS = 1000;

export interface RequestLog {
  id: string;
  timestamp: string;
  method: string;
  endpoint: string;        // 如 /api/image/generate
  function: string;        // 功能分类: script/storyboard/image/video
  provider: string;        // 从请求体 body.provider 提取
  model: string;           // 从请求体 body.model 提取
  apiKeyMasked: string;    // 脱敏的 API Key
  statusCode: number;
  duration: number;        // 耗时(ms)
  error: string | null;    // 错误信息
  requestSummary: string;  // 请求摘要（如 prompt 的前100字）
}

interface LogsData {
  logs: RequestLog[];
}

// 确保 data 目录和文件存在
function ensureDataFile(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOGS_FILE)) {
      fs.writeFileSync(LOGS_FILE, JSON.stringify({ logs: [] }, null, 2), 'utf-8');
    }
  } catch (error) {
    console.error('[RequestLogger] 初始化日志文件失败:', error);
  }
}

// 读取所有日志
function loadLogs(): LogsData {
  try {
    ensureDataFile();
    const content = fs.readFileSync(LOGS_FILE, 'utf-8');
    return JSON.parse(content) as LogsData;
  } catch (error) {
    console.error('[RequestLogger] 读取日志文件失败:', error);
    return { logs: [] };
  }
}

// 保存日志
function saveLogs(data: LogsData): void {
  try {
    ensureDataFile();
    fs.writeFileSync(LOGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('[RequestLogger] 保存日志文件失败:', error);
  }
}

// 脱敏 API Key
function maskApiKey(key: string): string {
  if (!key) return 'unknown';
  if (key.length <= 8) {
    return key.slice(0, 3) + '***' + key.slice(-3);
  }
  return key.slice(0, 6) + '****' + key.slice(-6);
}

// 从路径提取功能分类
function extractFunctionFromPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length >= 2 && segments[0] === 'api') {
    const func = segments[1];
    if (['script', 'storyboard', 'image', 'video'].includes(func)) {
      return func;
    }
  }
  return 'other';
}

// 根据 endpoint 推断默认 provider（与各路由的默认值保持一致）
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
  
  let summary = '';
  if (body.prompt && typeof body.prompt === 'string') {
    summary = body.prompt.slice(0, 100);
  } else if (body.script && typeof body.script === 'string') {
    summary = body.script.slice(0, 100);
  } else if (body.content && typeof body.content === 'string') {
    summary = body.content.slice(0, 100);
  } else if (body.text && typeof body.text === 'string') {
    summary = body.text.slice(0, 100);
  }
  
  return summary;
}

// 从 Authorization 头提取 API Key
function extractApiKey(req: Request): string {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return 'unknown';
  }
  return authHeader.slice(7);
}

// 请求日志中间件
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  // 判断是否需要记录
  const path = req.path || req.url;
  
  // 排除 /api/admin/* 和 /api/health
  if (path.startsWith('/api/admin/') || path === '/api/health') {
    return next();
  }
  
  // 只记录 /api/* 请求
  if (!path.startsWith('/api/')) {
    return next();
  }
  
  // 监听响应完成事件
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    try {
      const apiKey = extractApiKey(req);
      const apiKeyMasked = maskApiKey(apiKey);
      const func = extractFunctionFromPath(path);
      const body = req.body || {};
      
      // 提取错误信息
      let error: string | null = null;
      if (res.statusCode >= 400) {
        // 尝试从响应中获取错误信息（通过 res.locals）
        error = (res.locals as any).errorMessage || `HTTP ${res.statusCode}`;
      }
      
      const logEntry: RequestLog = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        method: req.method,
        endpoint: path,
        function: func,
        provider: body.provider || inferDefaultProvider(path) || 'unknown',
        model: body.model || 'unknown',
        apiKeyMasked,
        statusCode: res.statusCode,
        duration,
        error,
        requestSummary: extractRequestSummary(body),
      };
      
      // 读取现有日志
      const data = loadLogs();
      
      // 添加新日志
      data.logs.push(logEntry);
      
      // 保留最近 1000 条
      if (data.logs.length > MAX_LOGS) {
        data.logs = data.logs.slice(-MAX_LOGS);
      }
      
      // 保存日志
      saveLogs(data);
    } catch (error) {
      // 日志写入失败不能影响主请求
      console.error('[RequestLogger] 记录日志失败:', error);
    }
  });
  
  next();
}

// 导出供其他服务使用的日志操作方法
export function getAllLogs(): RequestLog[] {
  return loadLogs().logs;
}

export function getLogById(id: string): RequestLog | null {
  const logs = loadLogs().logs;
  return logs.find(log => log.id === id) || null;
}
