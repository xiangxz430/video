import { Router, Request, Response } from 'express';
import { getStatsByKey, getStatsByKeyDetail, KeyDetailStats } from '../services/statsService.js';
import { getAllLogs } from '../middleware/requestLogger.js';
import { estimateCallCost, getModelDisplayInfo } from '../services/modelPricing.js';

const router = Router();

/**
 * GET /api/stats/usage - 获取当前 API Key 的调用统计
 * 根据请求头中的 Authorization 提取 API Key，返回该 Key 的调用量
 */
router.get('/usage', (req: Request, res: Response) => {
  try {
    // 从请求头提取 API Key
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        error: '缺少认证信息' 
      });
    }
    const apiKey = authHeader.slice(7);
    
    // 脱敏 API Key（前6位 + **** + 后6位）
    const maskedKey = maskApiKey(apiKey);
    
    // 获取所有统计
    const allKeyStats = getStatsByKey();
    
    // 找到当前 Key 的统计
    const currentKeyStats = allKeyStats.find(stats => stats.maskedKey === maskedKey);
    
    // 获取所有日志
    const allLogs = getAllLogs();
    
    // 过滤出当前 Key 的日志
    const keyLogs = allLogs.filter(log => log.apiKeyMasked === maskedKey);
    
    // 按功能分类统计
    const statsByFunction: Record<string, { total: number; success: number; failed: number }> = {};
    keyLogs.forEach(log => {
      const func = log.function;
      if (!statsByFunction[func]) {
        statsByFunction[func] = { total: 0, success: 0, failed: 0 };
      }
      statsByFunction[func].total++;
      if (log.statusCode >= 200 && log.statusCode < 300) {
        statsByFunction[func].success++;
      } else {
        statsByFunction[func].failed++;
      }
    });
    
    // 按 Provider 分类统计
    const statsByProvider: Record<string, { total: number; success: number; failed: number }> = {};
    keyLogs.forEach(log => {
      const provider = log.provider;
      if (!statsByProvider[provider]) {
        statsByProvider[provider] = { total: 0, success: 0, failed: 0 };
      }
      statsByProvider[provider].total++;
      if (log.statusCode >= 200 && log.statusCode < 300) {
        statsByProvider[provider].success++;
      } else {
        statsByProvider[provider].failed++;
      }
    });
    
    // 按 Provider+Model 分类统计（含费用估算）
    const statsByModel: Record<string, {
      provider: string;
      model: string;
      displayProvider: string;
      displayModel: string;
      total: number;
      success: number;
      failed: number;
      estimatedCost: number;
    }> = {};
    let totalCost = 0;
    
    keyLogs.forEach(log => {
      const modelKey = `${log.provider}::${log.model}`;
      const func = log.function || 'other';
      const isSuccess = log.statusCode >= 200 && log.statusCode < 300;
    
      if (!statsByModel[modelKey]) {
        const display = getModelDisplayInfo(log.provider, log.model);
        statsByModel[modelKey] = {
          provider: log.provider,
          model: log.model,
          displayProvider: display.providerName,
          displayModel: display.modelName,
          total: 0,
          success: 0,
          failed: 0,
          estimatedCost: 0,
        };
      }
      statsByModel[modelKey].total++;
      if (isSuccess) {
        statsByModel[modelKey].success++;
      } else {
        statsByModel[modelKey].failed++;
      }
    
      // 逐条计算费用
      const callCost = estimateCallCost(log.provider, log.model, func, isSuccess);
      statsByModel[modelKey].estimatedCost += callCost;
      totalCost += callCost;
    });
    
    // 四舍五入费用
    for (const key of Object.keys(statsByModel)) {
      statsByModel[key].estimatedCost = Math.round(statsByModel[key].estimatedCost * 10000) / 10000;
    }
    totalCost = Math.round(totalCost * 10000) / 10000;
    
    // 计算成功率
    const totalCalls = keyLogs.length;
    const successCalls = keyLogs.filter(log => log.statusCode >= 200 && log.statusCode < 300).length;
    const failedCalls = totalCalls - successCalls;
    const successRate = totalCalls > 0 ? ((successCalls / totalCalls) * 100).toFixed(1) : '0';
    
    // 获取最后使用时间
    const lastUsedAt = currentKeyStats?.lastUsedAt || null;
    
    res.json({
      success: true,
      data: {
        apiKey: maskedKey,
        totalCalls,
        successCalls,
        failedCalls,
        successRate: `${successRate}%`,
        totalCost,
        lastUsedAt,
        byFunction: statsByFunction,
        byProvider: statsByProvider,
        byModel: statsByModel,
      }
    });
  } catch (error) {
    console.error('获取调用统计失败:', error);
    res.status(500).json({ 
      success: false, 
      error: '获取调用统计失败' 
    });
  }
});

/**
 * 脱敏 API Key
 */
function maskApiKey(key: string): string {
  if (!key) return 'unknown';
  if (key.length <= 12) {
    return key.slice(0, 3) + '***' + key.slice(-3);
  }
  return key.slice(0, 6) + '****' + key.slice(-6);
}

export { router as clientStatsRouter };
