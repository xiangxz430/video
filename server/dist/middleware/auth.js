import { config } from '../config/index.js';
import { validateApiKey } from '../services/apiKeyService.js';
export function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '缺少认证信息' });
    }
    const token = authHeader.slice(7);
    // 向后兼容：先检查环境变量 API_KEY，再检查 apiKeyService
    if (token === config.apiKey || validateApiKey(token)) {
        return next();
    }
    return res.status(401).json({ error: '无效的API密钥' });
}
// Admin 认证中间件（用于管理接口）
export function adminAuthMiddleware(req, res, next) {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || typeof adminKey !== 'string') {
        return res.status(401).json({ error: '缺少管理员认证信息' });
    }
    if (adminKey !== config.adminKey) {
        return res.status(401).json({ error: '无效的管理员密钥' });
    }
    next();
}
