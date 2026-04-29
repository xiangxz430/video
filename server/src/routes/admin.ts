import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { config, getProviderConfig } from '../config/index.js';
import {
  getOverviewStats,
  getStatsByTime,
  getStatsByKey,
  getStatsByKeyDetail,
  getStatsByFunction,
  getStatsByProvider,
  getStatsByModel,
  getSystemInfo,
} from '../services/statsService.js';
import { queryLogs, getLogById } from '../services/logService.js';
import { maskKey } from '../services/apiKeyService.js';

const router = Router();

// ==================== 统计接口 ====================

// GET /api/admin/stats/overview - 仪表盘概览数据
router.get('/stats/overview', async (req, res) => {
  try {
    const data = await getOverviewStats();
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取概览统计失败:', error);
    res.status(500).json({ success: false, error: '获取概览统计失败' });
  }
});

// GET /api/admin/stats/by-time - 按时间统计
router.get('/stats/by-time', async (req, res) => {
  try {
    const range = req.query.range as 'day' | 'week' | 'month';
    if (!range || !['day', 'week', 'month'].includes(range)) {
      return res.status(400).json({
        success: false,
        error: '无效的 range 参数，必须是 day、week 或 month',
      });
    }
    const data = await getStatsByTime(range);
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取时间统计失败:', error);
    res.status(500).json({ success: false, error: '获取时间统计失败' });
  }
});

// GET /api/admin/stats/by-key - 按 Key 统计
router.get('/stats/by-key', async (req, res) => {
  try {
    const data = await getStatsByKey();
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取 Key 统计失败:', error);
    res.status(500).json({ success: false, error: '获取 Key 统计失败' });
  }
});

// GET /api/admin/stats/by-key-detail - 按 Key 详细统计（含模型细分+费用估算）
router.get('/stats/by-key-detail', async (req, res) => {
  try {
    const data = await getStatsByKeyDetail();
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取 Key 详细统计失败:', error);
    res.status(500).json({ success: false, error: '获取 Key 详细统计失败' });
  }
});

// GET /api/admin/stats/by-function - 按功能统计
router.get('/stats/by-function', async (req, res) => {
  try {
    const data = await getStatsByFunction();
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取功能统计失败:', error);
    res.status(500).json({ success: false, error: '获取功能统计失败' });
  }
});

// GET /api/admin/stats/by-provider - 按 Provider 统计
router.get('/stats/by-provider', async (req, res) => {
  try {
    const data = await getStatsByProvider();
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取 Provider 统计失败:', error);
    res.status(500).json({ success: false, error: '获取 Provider 统计失败' });
  }
});

// GET /api/admin/stats/by-model - 按 Provider+Model 统计
router.get('/stats/by-model', async (req, res) => {
  try {
    const data = await getStatsByModel();
    res.json({ success: true, data });
  } catch (error) {
    console.error('获取模型统计失败:', error);
    res.status(500).json({ success: false, error: '获取模型统计失败' });
  }
});

// ==================== 日志接口 ====================

// GET /api/admin/logs - 请求日志列表
router.get('/logs', async (req, res) => {
  try {
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const pageSize = req.query.pageSize
      ? parseInt(req.query.pageSize as string)
      : 20;

    const result = await queryLogs({
      page,
      pageSize,
      endpoint: req.query.endpoint as string | undefined,
      function: req.query.function as string | undefined,
      provider: req.query.provider as string | undefined,
      statusCode: req.query.statusCode
        ? parseInt(req.query.statusCode as string)
        : undefined,
      startTime: req.query.startTime as string | undefined,
      endTime: req.query.endTime as string | undefined,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('获取日志列表失败:', error);
    res.status(500).json({ success: false, error: '获取日志列表失败' });
  }
});

// GET /api/admin/logs/:id - 单条日志详情
router.get('/logs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const log = await getLogById(id);

    if (!log) {
      return res.status(404).json({
        success: false,
        error: '日志不存在',
      });
    }

    res.json({ success: true, data: log });
  } catch (error) {
    console.error('获取日志详情失败:', error);
    res.status(500).json({ success: false, error: '获取日志详情失败' });
  }
});

// ==================== 配置管理接口 ====================

// Provider API Key 脱敏（复用统一脱敏函数）

// GET /api/admin/config/providers - 获取所有 Provider 配置（密钥脱敏）
router.get('/config/providers', (req, res) => {
  try {
    const providers = config.providers;
    const result = Object.entries(providers).map(([name, cfg]) => ({
      name,
      apiKey: maskKey(cfg.apiKey),
      baseUrl: cfg.baseUrl,
      hasKey: !!cfg.apiKey && cfg.apiKey.length > 0,
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('获取 Provider 配置失败:', error);
    res.status(500).json({ success: false, error: '获取 Provider 配置失败' });
  }
});

// .env 文件写入互斥锁（防止并发写入导致文件损坏）
let envWriteLock: Promise<void> = Promise.resolve();

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

    // 先更新内存配置（立即生效，不阻塞响应）
    if (apiKey !== undefined) {
      (config.providers as any)[provider].apiKey = apiKey;
    }
    if (baseUrl !== undefined) {
      (config.providers as any)[provider].baseUrl = baseUrl;
    }

    // 异步串行写入 .env 文件（互斥锁防止并发损坏）
    envWriteLock = envWriteLock.then(async () => {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';

      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
      }

      const providerUpper = provider.toUpperCase();
      const apiKeyEnvName = `${providerUpper}_API_KEY`;
      const baseUrlEnvName = `${providerUpper}_BASE_URL`;

      if (apiKey !== undefined) {
        const apiKeyRegex = new RegExp(`^${apiKeyEnvName}=.*$`, 'm');
        if (apiKeyRegex.test(envContent)) {
          envContent = envContent.replace(apiKeyRegex, `${apiKeyEnvName}=${apiKey}`);
        } else {
          envContent += `\n${apiKeyEnvName}=${apiKey}`;
        }
      }

      if (baseUrl !== undefined) {
        const baseUrlRegex = new RegExp(`^${baseUrlEnvName}=.*$`, 'm');
        if (baseUrlRegex.test(envContent)) {
          envContent = envContent.replace(baseUrlRegex, `${baseUrlEnvName}=${baseUrl}`);
        } else {
          envContent += `\n${baseUrlEnvName}=${baseUrl}`;
        }
      }

      fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
    }).catch(err => {
      console.error('[admin] .env 异步写入失败:', err);
    });

    res.json({
      success: true,
      message: `Provider ${provider} 配置已更新`,
    });
  } catch (error) {
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

    let testResult: { success: boolean; message: string };

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
  } catch (error: any) {
    console.error(`测试 Provider ${provider} 连通性失败:`, error);
    res.json({
      success: false,
      message: `测试失败: ${error.message || '未知错误'}`,
      latency: Date.now() - startTime,
    });
  }
});

// 测试 Deepseek 连通性
async function testDeepseek(apiKey: string, baseUrl: string): Promise<{ success: boolean; message: string }> {
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
    } else {
      const error = await response.text();
      return { success: false, message: `API 错误: ${response.status} ${error}` };
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, message: '连接超时' };
    }
    return { success: false, message: `请求失败: ${error.message}` };
  }
}

// 测试 Volcengine 连通性
async function testVolcengine(apiKey: string, baseUrl: string): Promise<{ success: boolean; message: string }> {
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
    } else {
      const error = await response.text();
      return { success: false, message: `API 错误: ${response.status} ${error}` };
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, message: '连接超时' };
    }
    return { success: false, message: `请求失败: ${error.message}` };
  }
}

// 测试 OpenRouter 连通性
async function testOpenRouter(apiKey: string, baseUrl: string): Promise<{ success: boolean; message: string }> {
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
    } else {
      const error = await response.text();
      return { success: false, message: `API 错误: ${response.status} ${error}` };
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, message: '连接超时' };
    }
    return { success: false, message: `请求失败: ${error.message}` };
  }
}

// 测试 Qwen 连通性
async function testQwen(apiKey: string, baseUrl: string): Promise<{ success: boolean; message: string }> {
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
    } else {
      const error = await response.text();
      return { success: false, message: `API 错误: ${response.status} ${error}` };
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, message: '连接超时' };
    }
    return { success: false, message: `请求失败: ${error.message}` };
  }
}

// 测试 GRSai 连通性
async function testGrsai(apiKey: string, baseUrl: string): Promise<{ success: boolean; message: string }> {
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
    } else {
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
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, message: '连接超时' };
    }
    return { success: false, message: `请求失败: ${error.message}` };
  }
}

// 测试 Idealab 连通性
async function testIdealab(apiKey: string, baseUrl: string): Promise<{ success: boolean; message: string }> {
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
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, message: '连接超时' };
    }
    return { success: false, message: `请求失败: ${error.message}` };
  }
}

// 测试 TokenPlan 连通性
async function testTokenplan(apiKey: string, baseUrl: string): Promise<{ success: boolean; message: string }> {
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
    } else {
      const error = await response.text();
      return { success: false, message: `API 错误: ${response.status} ${error}` };
    }
  } catch (error: any) {
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
  } catch (error) {
    console.error('获取系统信息失败:', error);
    res.status(500).json({ success: false, error: '获取系统信息失败' });
  }
});

export { router as adminRouter };
