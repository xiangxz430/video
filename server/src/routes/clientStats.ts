import { Router, Request, Response } from 'express';
import { getLogsByUser } from '../middleware/requestLogger.js';
import { estimateCallCost, getModelDisplayInfo } from '../services/modelPricing.js';
import { maskKey } from '../services/apiKeyService.js';

const router = Router();

/**
 * GET /api/stats/usage - 获取当前 API Key 的调用统计
 * 根据请求头中的 Authorization 提取 API Key，返回该 Key 的调用量
 */
router.get('/usage', async (req: Request, res: Response) => {
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
    const maskedKey = maskKey(apiKey);
    
    // 从 MongoDB 获取当前用户的日志（走 keyId 索引，0 跨用户开销）
    const keyId = req.apiKeyId;
    const keyLogs = keyId ? await getLogsByUser(keyId) : [];
    
    // 单遍遍历：同时计算 byFunction / byProvider / byModel / 成功率 / 最后使用时间
    const statsByFunction: Record<string, { total: number; success: number; failed: number }> = {};
    const statsByProvider: Record<string, { total: number; success: number; failed: number }> = {};
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
    let successCalls = 0;
    let lastUsedAt: string | null = null;
    
    for (const log of keyLogs) {
      const isOk = log.statusCode >= 200 && log.statusCode < 300;
      if (isOk) successCalls++;
      
      // byFunction
      const func = log.function;
      if (!statsByFunction[func]) statsByFunction[func] = { total: 0, success: 0, failed: 0 };
      statsByFunction[func].total++;
      isOk ? statsByFunction[func].success++ : statsByFunction[func].failed++;
      
      // byProvider
      const prov = log.provider;
      if (!statsByProvider[prov]) statsByProvider[prov] = { total: 0, success: 0, failed: 0 };
      statsByProvider[prov].total++;
      isOk ? statsByProvider[prov].success++ : statsByProvider[prov].failed++;
      
      // byModel + 费用
      const modelKey = `${prov}::${log.model}`;
      const logFunc = func || 'other';
      if (!statsByModel[modelKey]) {
        const display = getModelDisplayInfo(prov, log.model);
        statsByModel[modelKey] = {
          provider: prov, model: log.model,
          displayProvider: display.providerName, displayModel: display.modelName,
          total: 0, success: 0, failed: 0, estimatedCost: 0,
        };
      }
      statsByModel[modelKey].total++;
      isOk ? statsByModel[modelKey].success++ : statsByModel[modelKey].failed++;
      const callCost = estimateCallCost(prov, log.model, logFunc, isOk);
      statsByModel[modelKey].estimatedCost += callCost;
      totalCost += callCost;
      
      // 最后使用时间
      if (!lastUsedAt || log.timestamp > lastUsedAt) lastUsedAt = log.timestamp;
    }
    
    // 四舍五入费用
    for (const key of Object.keys(statsByModel)) {
      statsByModel[key].estimatedCost = Math.round(statsByModel[key].estimatedCost * 10000) / 10000;
    }
    totalCost = Math.round(totalCost * 10000) / 10000;
    
    // 成功率
    const totalCalls = keyLogs.length;
    const failedCalls = totalCalls - successCalls;
    const successRate = totalCalls > 0 ? ((successCalls / totalCalls) * 100).toFixed(1) : '0';
    
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

export { router as clientStatsRouter };
