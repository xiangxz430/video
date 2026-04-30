import { listApiKeys } from './apiKeyService.js';
import { estimateCallCost, getModelDisplayInfo } from './modelPricing.js';
import { getLogsCollection } from './mongoService.js';
/**
 * 判断日志是否成功
 */
function isSuccess(statusCode) {
    return statusCode >= 200 && statusCode < 300;
}
/**
 * 获取今日开始时间
 */
function getStartOfDay(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
/**
 * 获取本周开始时间（周一）
 */
function getStartOfWeek(date = new Date()) {
    const dayOfWeek = date.getDay();
    const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const startOfWeek = new Date(date.getFullYear(), date.getMonth(), diff);
    startOfWeek.setHours(0, 0, 0, 0);
    return startOfWeek;
}
/**
 * 获取本月开始时间
 */
function getStartOfMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}
/**
 * 获取周数
 */
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
/**
 * 仪表盘概览统计（MongoDB 聚合版）
 * 一次聚合查询完成全部统计，比全量加载到内存再遍历快 10-100x
 */
export async function getOverviewStats() {
    const now = new Date();
    const startOfToday = getStartOfDay(now).toISOString();
    const startOfWeek = getStartOfWeek(now).toISOString();
    const startOfMonth = getStartOfMonth(now).toISOString();
    const collection = getLogsCollection();
    // 拆为 3 个独立聚合（避免 $facet 嵌套 $cond 的 TS 类型推断问题，且 MongoDB 可并行执行）
    const successCond = { $cond: [{ $and: [{ $gte: ['$statusCode', 200] }, { $lt: ['$statusCode', 300] }] }, 1, 0] };
    const failedCond = { $cond: [{ $or: [{ $lt: ['$statusCode', 200] }, { $gte: ['$statusCode', 300] }] }, 1, 0] };
    const groupStage = { _id: null, total: { $sum: 1 }, success: { $sum: successCond }, failed: { $sum: failedCond } };
    const [todayResult, weekResult, monthResult, funcResult, provResult] = await Promise.all([
        collection.aggregate([
            { $match: { timestamp: { $gte: startOfToday } } },
            { $group: groupStage },
        ]).toArray(),
        collection.aggregate([
            { $match: { timestamp: { $gte: startOfWeek } } },
            { $group: groupStage },
        ]).toArray(),
        collection.aggregate([
            { $match: { timestamp: { $gte: startOfMonth } } },
            { $group: groupStage },
        ]).toArray(),
        collection.aggregate([
            { $group: { _id: '$function', count: { $sum: 1 } } },
        ]).toArray(),
        collection.aggregate([
            { $group: { _id: '$provider', count: { $sum: 1 } } },
        ]).toArray(),
    ]);
    const today = todayResult[0] || { total: 0, success: 0, failed: 0 };
    const week = weekResult[0] || { total: 0, success: 0, failed: 0 };
    const month = monthResult[0] || { total: 0, success: 0, failed: 0 };
    const byFunction = {};
    for (const item of funcResult) {
        byFunction[item._id || 'other'] = item.count;
    }
    const byProvider = {};
    for (const item of provResult) {
        byProvider[item._id || 'unknown'] = item.count;
    }
    return {
        today: { total: today.total, success: today.success, failed: today.failed },
        thisWeek: { total: week.total, success: week.success, failed: week.failed },
        thisMonth: { total: month.total, success: month.success, failed: month.failed },
        byFunction,
        byProvider,
    };
}
/**
 * 按时间统计（MongoDB 聚合版 - 用 $bucket 按时间分桶）
 */
export async function getStatsByTime(range) {
    const now = new Date();
    const collection = getLogsCollection();
    if (range === 'day') {
        // 最近 7 天
        const buckets = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const start = getStartOfDay(date);
            const end = new Date(start.getTime() + 86400000);
            buckets.push({ start, end, label: `${start.getMonth() + 1}/${start.getDate()}` });
        }
        const results = await collection.aggregate([
            { $match: { timestamp: { $gte: buckets[0].start.toISOString() } } },
            { $group: {
                    _id: {
                        $let: {
                            vars: { ts: { $dateFromString: { dateString: '$timestamp' } } },
                            in: {
                                $arrayElemAt: buckets.map((b, idx) => ({
                                    $cond: [{ $and: [{ $gte: ['$$ts', b.start] }, { $lt: ['$$ts', b.end] }] }, idx, -1]
                                }), { $cond: [{ $and: [{ $gte: ['$$ts', buckets[0].start] }, { $lt: ['$$ts', buckets[buckets.length - 1].end] }] }, 0, -1] })
                            }
                        }
                    },
                    count: { $sum: 1 },
                } },
        ]).toArray();
        // 简化：用更高效的方式 - 逐桶 countDocuments
        const counts = await Promise.all(buckets.map(b => collection.countDocuments({
            timestamp: { $gte: b.start.toISOString(), $lt: b.end.toISOString() }
        })));
        return { labels: buckets.map(b => b.label), data: counts };
    }
    else if (range === 'week') {
        const buckets = [];
        for (let i = 3; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i * 7);
            const sow = getStartOfWeek(date);
            const startMs = sow.getTime();
            buckets.push({ start: sow, end: new Date(startMs + 7 * 86400000), label: `第${getWeekNumber(sow)}周` });
        }
        const counts = await Promise.all(buckets.map(b => collection.countDocuments({
            timestamp: { $gte: b.start.toISOString(), $lt: b.end.toISOString() }
        })));
        return { labels: buckets.map(b => b.label), data: counts };
    }
    else {
        const buckets = [];
        for (let i = 5; i >= 0; i--) {
            const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
            buckets.push({ start, end, label: `${start.getMonth() + 1}月` });
        }
        const counts = await Promise.all(buckets.map(b => collection.countDocuments({
            timestamp: { $gte: b.start.toISOString(), $lt: b.end.toISOString() }
        })));
        return { labels: buckets.map(b => b.label), data: counts };
    }
}
/**
 * 按 Key 统计（MongoDB 聚合版）
 */
export async function getStatsByKey() {
    const collection = getLogsCollection();
    const apiKeys = listApiKeys();
    const results = await collection.aggregate([
        { $group: {
                _id: '$apiKeyMasked',
                totalCalls: { $sum: 1 },
                lastUsedAt: { $max: '$timestamp' },
            } },
    ]).toArray();
    const statsMap = {};
    for (const r of results) {
        statsMap[r._id] = { totalCalls: r.totalCalls, lastUsedAt: r.lastUsedAt };
    }
    return apiKeys.map(key => {
        const stats = statsMap[key.maskedKey] || { totalCalls: 0, lastUsedAt: null };
        return {
            keyId: key.id,
            keyName: key.name,
            maskedKey: key.maskedKey,
            totalCalls: stats.totalCalls,
            lastUsedAt: stats.lastUsedAt,
        };
    });
}
/**
 * 按 Key 详细统计（含模型+功能细分+费用）
 * MongoDB 三级聚合：apiKeyMasked → provider+model → function
 * 费用计算在 JS 侧完成（依赖 estimateCallCost 函数逻辑）
 */
export async function getStatsByKeyDetail() {
    const collection = getLogsCollection();
    const apiKeys = listApiKeys();
    // 三级聚合：先按 maskedKey+provider+model+function 分组，再逐级向上汇总
    const results = await collection.aggregate([
        // 第一级：按 maskedKey + provider + model + function 分组
        {
            $group: {
                _id: {
                    maskedKey: '$apiKeyMasked',
                    provider: '$provider',
                    model: '$model',
                    function: { $ifNull: ['$function', 'other'] },
                },
                total: { $sum: 1 },
                success: { $sum: { $cond: [{ $and: [{ $gte: ['$statusCode', 200] }, { $lt: ['$statusCode', 300] }] }, 1, 0] } },
                failed: { $sum: { $cond: [{ $or: [{ $lt: ['$statusCode', 200] }, { $gte: ['$statusCode', 300] }] }, 1, 0] } },
                lastUsedAt: { $max: '$timestamp' },
            }
        },
        // 第二级：按 maskedKey + provider + model 汇总
        {
            $group: {
                _id: {
                    maskedKey: '$_id.maskedKey',
                    provider: '$_id.provider',
                    model: '$_id.model',
                },
                total: { $sum: '$total' },
                success: { $sum: '$success' },
                failed: { $sum: '$failed' },
                lastUsedAt: { $max: '$lastUsedAt' },
                byFunction: {
                    $push: {
                        function: '$_id.function',
                        total: '$total',
                        success: '$success',
                        failed: '$failed',
                    }
                }
            }
        },
        // 第三级：按 maskedKey 汇总
        {
            $group: {
                _id: '$_id.maskedKey',
                lastUsedAt: { $max: '$lastUsedAt' },
                models: {
                    $push: {
                        provider: '$_id.provider',
                        model: '$_id.model',
                        total: '$total',
                        success: '$success',
                        failed: '$failed',
                        byFunction: '$byFunction',
                    }
                }
            }
        }
    ]).toArray();
    // 构建聚合结果索引
    const statsMap = {};
    for (const r of results) {
        statsMap[r._id] = r;
    }
    // 映射到 KeyDetailStats，费用在 JS 侧计算
    return apiKeys.map(key => {
        const keyData = statsMap[key.maskedKey];
        if (!keyData) {
            return { keyId: key.id, keyName: key.name, maskedKey: key.maskedKey, totalCalls: 0, totalCost: 0, lastUsedAt: null, models: [] };
        }
        const models = [];
        let totalCalls = 0;
        let totalCost = 0;
        for (const modelData of keyData.models) {
            const display = getModelDisplayInfo(modelData.provider, modelData.model);
            let modelCost = 0;
            const byFunctionWithCost = {};
            for (const funcData of modelData.byFunction) {
                const func = funcData.function || 'other';
                const successCost = estimateCallCost(modelData.provider, modelData.model, func, true) * funcData.success;
                const failedCost = estimateCallCost(modelData.provider, modelData.model, func, false) * funcData.failed;
                const funcCost = successCost + failedCost;
                byFunctionWithCost[func] = { total: funcData.total, success: funcData.success, failed: funcData.failed, estimatedCost: funcCost };
                modelCost += funcCost;
            }
            models.push({
                provider: modelData.provider,
                model: modelData.model,
                displayProvider: display.providerName,
                displayModel: display.modelName,
                total: modelData.total,
                success: modelData.success,
                failed: modelData.failed,
                estimatedCost: modelCost,
                byFunction: byFunctionWithCost,
            });
            totalCalls += modelData.total;
            totalCost += modelCost;
        }
        models.sort((a, b) => b.estimatedCost - a.estimatedCost);
        return {
            keyId: key.id,
            keyName: key.name,
            maskedKey: key.maskedKey,
            totalCalls,
            totalCost: Math.round(totalCost * 10000) / 10000,
            lastUsedAt: keyData.lastUsedAt,
            models,
        };
    });
}
/**
 * 按功能统计（MongoDB 聚合版）
 */
export async function getStatsByFunction() {
    const collection = getLogsCollection();
    const results = await collection.aggregate([
        { $group: {
                _id: '$function',
                total: { $sum: 1 },
                success: { $sum: { $cond: [{ $and: [{ $gte: ['$statusCode', 200] }, { $lt: ['$statusCode', 300] }] }, 1, 0] } },
                failed: { $sum: { $cond: [{ $or: [{ $lt: ['$statusCode', 200] }, { $gte: ['$statusCode', 300] }] }, 1, 0] } },
                totalDuration: { $sum: '$duration' },
            } },
    ]).toArray();
    const result = {};
    for (const r of results) {
        result[r._id || 'other'] = {
            total: r.total,
            success: r.success,
            failed: r.failed,
            avgDuration: r.total > 0 ? Math.round(r.totalDuration / r.total) : 0,
        };
    }
    return result;
}
/**
 * 按 Provider 统计（MongoDB 聚合版）
 */
export async function getStatsByProvider() {
    const collection = getLogsCollection();
    const results = await collection.aggregate([
        { $group: {
                _id: '$provider',
                total: { $sum: 1 },
                success: { $sum: { $cond: [{ $and: [{ $gte: ['$statusCode', 200] }, { $lt: ['$statusCode', 300] }] }, 1, 0] } },
                failed: { $sum: { $cond: [{ $or: [{ $lt: ['$statusCode', 200] }, { $gte: ['$statusCode', 300] }] }, 1, 0] } },
                totalDuration: { $sum: '$duration' },
            } },
    ]).toArray();
    const result = {};
    for (const r of results) {
        result[r._id || 'unknown'] = {
            total: r.total,
            success: r.success,
            failed: r.failed,
            avgDuration: r.total > 0 ? Math.round(r.totalDuration / r.total) : 0,
        };
    }
    return result;
}
/**
 * 按 Provider+Model 统计（MongoDB 聚合版）
 */
export async function getStatsByModel() {
    const collection = getLogsCollection();
    const results = await collection.aggregate([
        { $group: {
                _id: { provider: '$provider', model: '$model' },
                total: { $sum: 1 },
                success: { $sum: { $cond: [{ $and: [{ $gte: ['$statusCode', 200] }, { $lt: ['$statusCode', 300] }] }, 1, 0] } },
                failed: { $sum: { $cond: [{ $or: [{ $lt: ['$statusCode', 200] }, { $gte: ['$statusCode', 300] }] }, 1, 0] } },
                totalDuration: { $sum: '$duration' },
            } },
    ]).toArray();
    const result = {};
    for (const r of results) {
        const key = `${r._id.provider}::${r._id.model}`;
        result[key] = {
            provider: r._id.provider,
            model: r._id.model,
            total: r.total,
            success: r.success,
            failed: r.failed,
            avgDuration: r.total > 0 ? Math.round(r.totalDuration / r.total) : 0,
        };
    }
    return result;
}
/**
 * 系统信息（纯本地计算，不涉及 MongoDB）
 */
let lastCpuSample = { cpuUsage: process.cpuUsage(), timestamp: Date.now() };
export function getSystemInfo() {
    const memUsage = process.memoryUsage();
    const now = Date.now();
    const currentCpu = process.cpuUsage();
    const elapsedWallMs = now - lastCpuSample.timestamp;
    let cpuPercent = 0;
    if (elapsedWallMs > 0) {
        const elapsedCpuUs = (currentCpu.user - lastCpuSample.cpuUsage.user)
            + (currentCpu.system - lastCpuSample.cpuUsage.system);
        cpuPercent = Math.min(100, Math.round(elapsedCpuUs / 1000 / elapsedWallMs * 100));
    }
    lastCpuSample = { cpuUsage: currentCpu, timestamp: now };
    return {
        uptime: Math.round(process.uptime()),
        memoryUsage: {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        },
        nodeVersion: process.version,
        platform: process.platform,
        cpuUsage: cpuPercent,
    };
}
