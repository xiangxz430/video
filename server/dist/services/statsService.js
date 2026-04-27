import { getAllLogs } from '../middleware/requestLogger.js';
import { listApiKeys } from './apiKeyService.js';
import { estimateCallCost, getModelDisplayInfo } from './modelPricing.js';
/**
 * 判断日志是否成功
 */
function isSuccess(log) {
    return log.statusCode >= 200 && log.statusCode < 300;
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
 * 仪表盘概览统计
 */
export function getOverviewStats() {
    const logs = getAllLogs();
    const now = new Date();
    const startOfToday = getStartOfDay(now);
    const startOfWeek = getStartOfWeek(now);
    const startOfMonth = getStartOfMonth(now);
    const todayLogs = logs.filter(log => new Date(log.timestamp) >= startOfToday);
    const weekLogs = logs.filter(log => new Date(log.timestamp) >= startOfWeek);
    const monthLogs = logs.filter(log => new Date(log.timestamp) >= startOfMonth);
    // 按功能统计
    const byFunction = {};
    logs.forEach(log => {
        byFunction[log.function] = (byFunction[log.function] || 0) + 1;
    });
    // 按 Provider 统计
    const byProvider = {};
    logs.forEach(log => {
        byProvider[log.provider] = (byProvider[log.provider] || 0) + 1;
    });
    return {
        today: {
            total: todayLogs.length,
            success: todayLogs.filter(isSuccess).length,
            failed: todayLogs.filter(log => !isSuccess(log)).length,
        },
        thisWeek: {
            total: weekLogs.length,
            success: weekLogs.filter(isSuccess).length,
            failed: weekLogs.filter(log => !isSuccess(log)).length,
        },
        thisMonth: {
            total: monthLogs.length,
            success: monthLogs.filter(isSuccess).length,
            failed: monthLogs.filter(log => !isSuccess(log)).length,
        },
        byFunction,
        byProvider,
    };
}
/**
 * 按时间统计（最近N天/周的趋势）
 */
export function getStatsByTime(range) {
    const logs = getAllLogs();
    const now = new Date();
    const labels = [];
    const data = [];
    if (range === 'day') {
        // 最近 7 天
        for (let i = 6; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const startOfDay = getStartOfDay(date);
            const endOfDay = new Date(startOfDay);
            endOfDay.setDate(endOfDay.getDate() + 1);
            const count = logs.filter(log => {
                const logDate = new Date(log.timestamp);
                return logDate >= startOfDay && logDate < endOfDay;
            }).length;
            labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
            data.push(count);
        }
    }
    else if (range === 'week') {
        // 最近 4 周
        for (let i = 3; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i * 7);
            const startOfWeek = getStartOfWeek(date);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(endOfWeek.getDate() + 7);
            const count = logs.filter(log => {
                const logDate = new Date(log.timestamp);
                return logDate >= startOfWeek && logDate < endOfWeek;
            }).length;
            labels.push(`第${getWeekNumber(startOfWeek)}周`);
            data.push(count);
        }
    }
    else if (range === 'month') {
        // 最近 6 个月
        for (let i = 5; i >= 0; i--) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
            const count = logs.filter(log => {
                const logDate = new Date(log.timestamp);
                return logDate >= startOfMonth && logDate < endOfMonth;
            }).length;
            labels.push(`${date.getMonth() + 1}月`);
            data.push(count);
        }
    }
    return { labels, data };
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
 * 按 Key 统计
 */
export function getStatsByKey() {
    const logs = getAllLogs();
    const apiKeys = listApiKeys();
    // 统计每个 maskedKey 的调用次数
    const keyStatsMap = {};
    logs.forEach(log => {
        const maskedKey = log.apiKeyMasked;
        if (!keyStatsMap[maskedKey]) {
            keyStatsMap[maskedKey] = { count: 0, lastUsedAt: null };
        }
        keyStatsMap[maskedKey].count++;
        if (!keyStatsMap[maskedKey].lastUsedAt || log.timestamp > keyStatsMap[maskedKey].lastUsedAt) {
            keyStatsMap[maskedKey].lastUsedAt = log.timestamp;
        }
    });
    // 合并 API Key 信息和统计
    return apiKeys.map(key => {
        const stats = keyStatsMap[key.maskedKey] || { count: 0, lastUsedAt: null };
        return {
            keyId: key.id,
            keyName: key.name,
            maskedKey: key.maskedKey,
            totalCalls: stats.count,
            lastUsedAt: stats.lastUsedAt,
        };
    });
}
/**
 * 按 Key 详细统计（含按模型+功能细分、费用估算）
 */
export function getStatsByKeyDetail() {
    const logs = getAllLogs();
    const apiKeys = listApiKeys();
    // 数据结构: keyStatsMap[maskedKey] = { models: { "provider::model": { total, success, failed, byFunction: { func: {total, success, failed} } } }, lastUsedAt }
    const keyStatsMap = {};
    logs.forEach(log => {
        const maskedKey = log.apiKeyMasked;
        const modelKey = `${log.provider}::${log.model}`;
        const func = log.function || 'other';
        const success = log.statusCode >= 200 && log.statusCode < 300;
        if (!keyStatsMap[maskedKey]) {
            keyStatsMap[maskedKey] = { lastUsedAt: null, models: {} };
        }
        const keyData = keyStatsMap[maskedKey];
        // 更新最后使用时间
        if (!keyData.lastUsedAt || log.timestamp > keyData.lastUsedAt) {
            keyData.lastUsedAt = log.timestamp;
        }
        // 按模型聚合
        if (!keyData.models[modelKey]) {
            keyData.models[modelKey] = {
                provider: log.provider,
                model: log.model,
                total: 0,
                success: 0,
                failed: 0,
                byFunction: {},
            };
        }
        const modelData = keyData.models[modelKey];
        modelData.total++;
        if (success) {
            modelData.success++;
        }
        else {
            modelData.failed++;
        }
        // 按功能聚合
        if (!modelData.byFunction[func]) {
            modelData.byFunction[func] = { total: 0, success: 0, failed: 0 };
        }
        modelData.byFunction[func].total++;
        if (success) {
            modelData.byFunction[func].success++;
        }
        else {
            modelData.byFunction[func].failed++;
        }
    });
    // 转换为输出格式，计算费用
    return apiKeys.map(key => {
        const keyData = keyStatsMap[key.maskedKey];
        if (!keyData) {
            return {
                keyId: key.id,
                keyName: key.name,
                maskedKey: key.maskedKey,
                totalCalls: 0,
                totalCost: 0,
                lastUsedAt: null,
                models: [],
            };
        }
        const models = [];
        let totalCalls = 0;
        let totalCost = 0;
        for (const [, modelData] of Object.entries(keyData.models)) {
            const display = getModelDisplayInfo(modelData.provider, modelData.model);
            let modelCost = 0;
            // 按功能计算费用
            const byFunctionWithCost = {};
            for (const [func, funcData] of Object.entries(modelData.byFunction)) {
                // 成功和失败调用分别计算费用
                const successCost = estimateCallCost(modelData.provider, modelData.model, func, true) * funcData.success;
                const failedCost = estimateCallCost(modelData.provider, modelData.model, func, false) * funcData.failed;
                const funcCost = successCost + failedCost;
                byFunctionWithCost[func] = {
                    ...funcData,
                    estimatedCost: funcCost,
                };
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
        // 按费用降序排列模型
        models.sort((a, b) => b.estimatedCost - a.estimatedCost);
        return {
            keyId: key.id,
            keyName: key.name,
            maskedKey: key.maskedKey,
            totalCalls,
            totalCost: Math.round(totalCost * 10000) / 10000, // 保留4位小数
            lastUsedAt: keyData.lastUsedAt,
            models,
        };
    });
}
/**
 * 按功能统计
 */
export function getStatsByFunction() {
    const logs = getAllLogs();
    const statsMap = {};
    logs.forEach(log => {
        const func = log.function;
        if (!statsMap[func]) {
            statsMap[func] = { total: 0, success: 0, failed: 0, totalDuration: 0 };
        }
        statsMap[func].total++;
        statsMap[func].totalDuration += log.duration;
        if (isSuccess(log)) {
            statsMap[func].success++;
        }
        else {
            statsMap[func].failed++;
        }
    });
    const result = {};
    for (const [func, data] of Object.entries(statsMap)) {
        result[func] = {
            total: data.total,
            success: data.success,
            failed: data.failed,
            avgDuration: data.total > 0 ? Math.round(data.totalDuration / data.total) : 0,
        };
    }
    return result;
}
/**
 * 按 Provider 统计
 */
export function getStatsByProvider() {
    const logs = getAllLogs();
    const statsMap = {};
    logs.forEach(log => {
        const provider = log.provider;
        if (!statsMap[provider]) {
            statsMap[provider] = { total: 0, success: 0, failed: 0, totalDuration: 0 };
        }
        statsMap[provider].total++;
        statsMap[provider].totalDuration += log.duration;
        if (isSuccess(log)) {
            statsMap[provider].success++;
        }
        else {
            statsMap[provider].failed++;
        }
    });
    const result = {};
    for (const [provider, data] of Object.entries(statsMap)) {
        result[provider] = {
            total: data.total,
            success: data.success,
            failed: data.failed,
            avgDuration: data.total > 0 ? Math.round(data.totalDuration / data.total) : 0,
        };
    }
    return result;
}
/**
 * 按 Provider+Model 统计
 */
export function getStatsByModel() {
    const logs = getAllLogs();
    const statsMap = {};
    logs.forEach(log => {
        const key = `${log.provider}::${log.model}`;
        if (!statsMap[key]) {
            statsMap[key] = { provider: log.provider, model: log.model, total: 0, success: 0, failed: 0, totalDuration: 0 };
        }
        statsMap[key].total++;
        statsMap[key].totalDuration += log.duration;
        if (isSuccess(log)) {
            statsMap[key].success++;
        }
        else {
            statsMap[key].failed++;
        }
    });
    const result = {};
    for (const [key, data] of Object.entries(statsMap)) {
        result[key] = {
            provider: data.provider,
            model: data.model,
            total: data.total,
            success: data.success,
            failed: data.failed,
            avgDuration: data.total > 0 ? Math.round(data.totalDuration / data.total) : 0,
        };
    }
    return result;
}
/**
 * 系统信息
 */
export function getSystemInfo() {
    const memUsage = process.memoryUsage();
    // 计算 CPU 使用率（简化版，基于当前进程）
    const cpuUsage = process.cpuUsage();
    // 将微秒转换为百分比（简化计算）
    const cpuPercent = Math.min(100, Math.round((cpuUsage.user + cpuUsage.system) / 1000000));
    return {
        uptime: Math.round(process.uptime()),
        memoryUsage: {
            rss: Math.round(memUsage.rss / 1024 / 1024), // MB
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        },
        nodeVersion: process.version,
        platform: process.platform,
        cpuUsage: cpuPercent,
    };
}
