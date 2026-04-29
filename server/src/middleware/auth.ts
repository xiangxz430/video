import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { validateApiKey } from '../services/apiKeyService.js';

// 扩展 Express Request 类型，携带认证后的 API Key ID
declare global {
  namespace Express {
    interface Request {
      apiKeyId?: string;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '缺少认证信息' });
  }
  const token = authHeader.slice(7);

  // 先尝试 apiKeyService 验证（返回 keyId）
  const keyId = validateApiKey(token);
  if (keyId) {
    req.apiKeyId = keyId;
    return next();
  }

  // 向后兼容：环境变量 API_KEY 直接匹配
  if (token === config.apiKey) {
    // 环境变量 key 在启动时已被 initializeFromEnv 导入，
    // 此处兜底：按 key 值查找 keyId（确保 req.apiKeyId 一定有值）
    const fallbackId = validateApiKey(token); // 已导入则能找到
    req.apiKeyId = fallbackId || '__env_key__';
    return next();
  }

  return res.status(401).json({ error: '无效的API密钥' });
}

// Admin 认证中间件（用于管理接口）
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const adminKey = req.headers['x-admin-key'];

  if (!adminKey || typeof adminKey !== 'string') {
    return res.status(401).json({ error: '缺少管理员认证信息' });
  }

  if (adminKey !== config.adminKey) {
    return res.status(401).json({ error: '无效的管理员密钥' });
  }

  next();
}
