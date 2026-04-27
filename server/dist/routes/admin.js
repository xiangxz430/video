import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { config, getProviderConfig } from '../config/index.js';
import { getOverviewStats, getStatsByTime, getStatsByKey, getStatsByKeyDetail, getStatsByFunction, getStatsByProvider, getStatsByModel, getSystemInfo, } from '../services/statsService.js';
import { queryLogs, getLogById } from '../services/logService.js';
const router = Router();
// ==================== 统计接口 ====================
// GET /api/admin/stats/overview - 仪表盘概览数据
router.get('/stats/overview', (req, res) => {
    try {
        const data = getOverviewStats();
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('获取概览统计失败:', error);
        res.status(500).json({ success: false, error: '获取概览统计失败' });
    }
});
// GET /api/admin/stats/by-time - 按时间统计
router.get('/stats/by-time', (req, res) => {
    try {
        const range = req.query.range;
        if (!range || !['day', 'week', 'month'].includes(range)) {
            return res.status(400).json({
                success: false,
                error: '无效的 range 参数，必须是 day、week 或 month',
            });
        }
        const data = getStatsByTime(range);
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('获取时间统计失败:', error);
        res.status(500).json({ success: false, error: '获取时间统计失败' });
    }
});
// GET /api/admin/stats/by-key - 按 Key 统计
router.get('/stats/by-key', (req, res) => {
    try {
        const data = getStatsByKey();
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('获取 Key 统计失败:', error);
        res.status(500).json({ success: false, error: '获取 Key 统计失败' });
    }
});
// GET /api/admin/stats/by-key-detail - 按 Key 详细统计（含模型细分+费用估算）
router.get('/stats/by-key-detail', (req, res) => {
    try {
        const data = getStatsByKeyDetail();
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('获取 Key 详细统计失败:', error);
        res.status(500).json({ success: false, error: '获取 Key 详细统计失败' });
    }
});
// GET /api/admin/stats/by-function - 按功能统计
router.get('/stats/by-function', (req, res) => {
    try {
        const data = getStatsByFunction();
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('获取功能统计失败:', error);
        res.status(500).json({ success: false, error: '获取功能统计失败' });
    }
});
// GET /api/admin/stats/by-provider - 按 Provider 统计
router.get('/stats/by-provider', (req, res) => {
    try {
        const data = getStatsByProvider();
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('获取 Provider 统计失败:', error);
        res.status(500).json({ success: false, error: '获取 Provider 统计失败' });
    }
});
// GET /api/admin/stats/by-model - 按 Provider+Model 统计
router.get('/stats/by-model', (req, res) => {
    try {
        const data = getStatsByModel();
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('获取模型统计失败:', error);
        res.status(500).json({ success: false, error: '获取模型统计失败' });
    }
});
// ==================== 日志接口 ====================
// GET /api/admin/logs - 请求日志列表
router.get('/logs', (req, res) => {
    try {
        const page = req.query.page ? parseInt(req.query.page) : 1;
        const pageSize = req.query.pageSize
            ? parseInt(req.query.pageSize)
            : 20;
        const result = queryLogs({
            page,
            pageSize,
            endpoint: req.query.endpoint,
            function: req.query.function,
            provider: req.query.provider,
            statusCode: req.query.statusCode
                ? parseInt(req.query.statusCode)
                : undefined,
            startTime: req.query.startTime,
            endTime: req.query.endTime,
        });
        res.json({ success: true, data: result });
    }
    catch (error) {
        console.error('获取日志列表失败:', error);
        res.status(500).json({ success: false, error: '获取日志列表失败' });
    }
});
// GET /api/admin/logs/:id - 单条日志详情
router.get('/logs/:id', (req, res) => {
    try {
        const { id } = req.params;
        const log = getLogById(id);
        if (!log) {
            return res.status(404).json({
                success: false,
                error: '日志不存在',
            });
        }
        res.json({ success: true, data: log });
    }
    catch (error) {
        console.error('获取日志详情失败:', error);
        res.status(500).json({ success: false, error: '获取日志详情失败' });
    }
});
// ==================== 配置管理接口 ====================
// API Key 脱敏函数：显示前6位 + **** + 后4位
function maskApiKey(key) {
    if (!key || key.length < 10) {
        return key ? '****' : '';
    }
    return key.slice(0, 6) + '****' + key.slice(-4);
}
// GET /api/admin/config/providers - 获取所有 Provider 配置（密钥脱敏）
router.get('/config/providers', (req, res) => {
    try {
        const providers = config.providers;
        const result = Object.entries(providers).map(([name, cfg]) => ({
            name,
            apiKey: maskApiKey(cfg.apiKey),
            baseUrl: cfg.baseUrl,
            hasKey: !!cfg.apiKey && cfg.apiKey.length > 0,
        }));
        res.json({ success: true, data: result });
    }
    catch (error) {
        console.error('获取 Provider 配置失败:', error);
        res.status(500).json({ success: false, error: '获取 Provider 配置失败' });
    }
});
// PUT /api/admin/config/providers - 更新 Provider 配置
router.put('/config/providers', async (req, res) => {
    try {
        const { provider, apiKey, baseUrl } = req.body;
        if (!provider || typeof provider !== 'string') {
            return res.status(400).json({
                success: false,
                error: '缺少 provider 参数',
            });
        }
        // 检查 provider 是否有效
        const validProviders = Object.keys(config.providers);
        if (!validProviders.includes(provider)) {
            return res.status(400).json({
                success: false,
                error: `无效的 provider，必须是以下之一: ${validProviders.join(', ')}`,
            });
        }
        // 更新 .env 文件
        const envPath = path.join(process.cwd(), '.env');
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf-8');
        }
        // 构建环境变量名
        const providerUpper = provider.toUpperCase();
        const apiKeyEnvName = `${providerUpper}_API_KEY`;
        const baseUrlEnvName = `${providerUpper}_BASE_URL`;
        // 更新或添加 API Key
        if (apiKey !== undefined) {
            const apiKeyRegex = new RegExp(`^${apiKeyEnvName}=.*$`, 'm');
            if (apiKeyRegex.test(envContent)) {
                envContent = envContent.replace(apiKeyRegex, `${apiKeyEnvName}=${apiKey}`);
            }
            else {
                envContent += `\n${apiKeyEnvName}=${apiKey}`;
            }
            // 更新内存中的配置
            config.providers[provider].apiKey = apiKey;
        }
        // 更新或添加 Base URL
        if (baseUrl !== undefined) {
            const baseUrlRegex = new RegExp(`^${baseUrlEnvName}=.*$`, 'm');
            if (baseUrlRegex.test(envContent)) {
                envContent = envContent.replace(baseUrlRegex, `${baseUrlEnvName}=${baseUrl}`);
            }
            else {
                envContent += `\n${baseUrlEnvName}=${baseUrl}`;
            }
            // 更新内存中的配置
            config.providers[provider].baseUrl = baseUrl;
        }
        // 写回 .env 文件
        fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
        res.json({
            success: true,
            message: `Provider ${provider} 配置已更新`,
        });
    }
    catch (error) {
        console.error('更新 Provider 配置失败:', error);
        res.status(500).json({ success: false, error: '更新 Provider 配置失败' });
    }
});
// POST /api/admin/config/test/:provider - 测试 Provider 连通性
router.post('/config/test/:provider', async (req, res) => {
    const startTime = Date.now();
    const { provider } = req.params;
    try {
        const providerConfig = getProviderConfig(provider);
        if (!providerConfig.apiKey) {
            return res.status(400).json({
                success: false,
                message: `Provider ${provider} 未配置 API Key`,
                latency: Date.now() - startTime,
            });
        }
        let testResult;
        switch (provider) {
            case 'deepseek':
                testResult = await testDeepseek(providerConfig.apiKey, providerConfig.baseUrl);
                break;
            case 'volcengine':
                testResult = await testVolcengine(providerConfig.apiKey, providerConfig.baseUrl);
                break;
            case 'openrouter':
                testResult = await testOpenRouter(providerConfig.apiKey, providerConfig.baseUrl);
                break;
            case 'qwen':
                testResult = await testQwen(providerConfig.apiKey, providerConfig.baseUrl);
                break;
            case 'grsai':
                testResult = await testGrsai(providerConfig.apiKey, providerConfig.baseUrl);
                break;
            case 'idealab':
                testResult = await testIdealab(providerConfig.apiKey, providerConfig.baseUrl);
                break;
            case 'tokenplan':
                testResult = await testTokenplan(providerConfig.apiKey, providerConfig.baseUrl);
                break;
            default:
                return res.status(400).json({
                    success: false,
                    message: `不支持的 Provider: ${provider}`,
                    latency: Date.now() - startTime,
                });
        }
        res.json({
            success: testResult.success,
            message: testResult.message,
            latency: Date.now() - startTime,
        });
    }
    catch (error) {
        console.error(`测试 Provider ${provider} 连通性失败:`, error);
        res.json({
            success: false,
            message: `测试失败: ${error.message || '未知错误'}`,
            latency: Date.now() - startTime,
        });
    }
});
// 测试 Deepseek 连通性
async function testDeepseek(apiKey, baseUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 1,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
            return { success: true, message: '连接成功' };
        }
        else {
            const error = await response.text();
            return { success: false, message: `API 错误: ${response.status} ${error}` };
        }
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            return { success: false, message: '连接超时' };
        }
        return { success: false, message: `请求失败: ${error.message}` };
    }
}
// 测试 Volcengine 连通性
async function testVolcengine(apiKey, baseUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'doubao-1.5-pro-32k-250115',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 1,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
            return { success: true, message: '连接成功' };
        }
        else {
            const error = await response.text();
            return { success: false, message: `API 错误: ${response.status} ${error}` };
        }
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            return { success: false, message: '连接超时' };
        }
        return { success: false, message: `请求失败: ${error.message}` };
    }
}
// 测试 OpenRouter 连通性
async function testOpenRouter(apiKey, baseUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'openai/gpt-3.5-turbo',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 1,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
            return { success: true, message: '连接成功' };
        }
        else {
            const error = await response.text();
            return { success: false, message: `API 错误: ${response.status} ${error}` };
        }
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            return { success: false, message: '连接超时' };
        }
        return { success: false, message: `请求失败: ${error.message}` };
    }
}
// 测试 Qwen 连通性
async function testQwen(apiKey, baseUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'qwen-turbo',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 1,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
            return { success: true, message: '连接成功' };
        }
        else {
            const error = await response.text();
            return { success: false, message: `API 错误: ${response.status} ${error}` };
        }
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            return { success: false, message: '连接超时' };
        }
        return { success: false, message: `请求失败: ${error.message}` };
    }
}
// 测试 GRSai 连通性
async function testGrsai(apiKey, baseUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        // GRSai 是图像生成服务，发送一个简单的 GET 请求检查连通性
        const response = await fetch(`${baseUrl}/health`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
            return { success: true, message: '连接成功' };
        }
        else {
            // 如果 /health 不存在，尝试发送一个简单的 POST 请求
            const postResponse = await fetch(`${baseUrl}/v1/images/generations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    prompt: 'test',
                    n: 1,
                    size: '256x256',
                }),
                signal: controller.signal,
            });
            // 即使返回 400 或 401，只要服务器响应了，就说明连通性正常
            if (postResponse.status !== 0) {
                return { success: true, message: '连接成功' };
            }
            const error = await response.text();
            return { success: false, message: `API 错误: ${response.status} ${error}` };
        }
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            return { success: false, message: '连接超时' };
        }
        return { success: false, message: `请求失败: ${error.message}` };
    }
}
// 测试 Idealab 连通性
async function testIdealab(apiKey, baseUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        // Idealab 是图像生成服务，尝试发送一个简单的请求
        const response = await fetch(baseUrl || 'https://api.idealab.com/v1', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        // 只要服务器有响应，就认为连通性正常
        if (response.status !== 0) {
            return { success: true, message: '连接成功' };
        }
        return { success: false, message: '无法连接到服务器' };
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            return { success: false, message: '连接超时' };
        }
        return { success: false, message: `请求失败: ${error.message}` };
    }
}
// 测试 TokenPlan 连通性
async function testTokenplan(apiKey, baseUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'qwen3.6-plus',
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 1,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
            return { success: true, message: '连接成功' };
        }
        else {
            const error = await response.text();
            return { success: false, message: `API 错误: ${response.status} ${error}` };
        }
    }
    catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            return { success: false, message: '连接超时' };
        }
        return { success: false, message: `请求失败: ${error.message}` };
    }
}
// ==================== 系统信息接口 ====================
// GET /api/admin/system - 系统运行信息
router.get('/system', (req, res) => {
    try {
        const data = getSystemInfo();
        res.json({ success: true, data });
    }
    catch (error) {
        console.error('获取系统信息失败:', error);
        res.status(500).json({ success: false, error: '获取系统信息失败' });
    }
});
export { router as adminRouter };
