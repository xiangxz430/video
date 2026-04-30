import { getLogsCollection } from '../services/mongoService.js';
/**
 * 分页查询日志（MongoDB 查询版）
 * 利用索引 + MongoDB 原生 filter + sort + skip + limit
 */
export async function queryLogs(params) {
    const { page = 1, pageSize = 20, endpoint, function: func, provider, statusCode, startTime, endTime, } = params;
    // 构建 MongoDB 查询条件
    const filter = {};
    if (endpoint)
        filter.endpoint = { $regex: endpoint, $options: 'i' };
    if (func)
        filter.function = func;
    if (provider)
        filter.provider = provider;
    if (statusCode !== undefined)
        filter.statusCode = statusCode;
    if (startTime || endTime) {
        filter.timestamp = {};
        if (startTime)
            filter.timestamp.$gte = startTime;
        if (endTime)
            filter.timestamp.$lte = endTime;
    }
    const collection = getLogsCollection();
    // 并行执行 count 和 find（MongoDB 自动利用索引）
    // 使用 projection 排除大字段，加速列表查询
    const [total, logs] = await Promise.all([
        collection.countDocuments(filter),
        collection.find(filter)
            .project({
            requestBody: 0,
            responseBody: 0,
            'aiApiCalls.requestBody': 0,
            'aiApiCalls.responseBody': 0,
        })
            .sort({ timestamp: -1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize)
            .toArray(),
    ]);
    return { logs, total, page, pageSize };
}
/**
 * 获取单条日志详情
 */
export async function getLogById(id) {
    return getLogsCollection().findOne({ id });
}
/**
 * 删除单条日志
 */
export async function deleteLog(id) {
    const result = await getLogsCollection().deleteOne({ id });
    return result.deletedCount === 1;
}
/**
 * 获取最近的 N 条日志
 */
export async function getRecentLogs(count = 10) {
    return getLogsCollection()
        .find()
        .sort({ timestamp: -1 })
        .limit(count)
        .toArray();
}
/**
 * 按功能筛选日志
 */
export async function getLogsByFunction(func) {
    return getLogsCollection()
        .find({ function: func })
        .sort({ timestamp: -1 })
        .limit(500)
        .toArray();
}
/**
 * 按 Provider 筛选日志
 */
export async function getLogsByProvider(provider) {
    return getLogsCollection()
        .find({ provider })
        .sort({ timestamp: -1 })
        .limit(500)
        .toArray();
}
/**
 * 按时间范围筛选日志
 */
export async function getLogsByTimeRange(startTime, endTime) {
    return getLogsCollection()
        .find({ timestamp: { $gte: startTime, $lte: endTime } })
        .sort({ timestamp: -1 })
        .limit(500)
        .toArray();
}
/**
 * 获取今日日志
 */
export async function getTodayLogs() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return getLogsByTimeRange(startOfDay.toISOString(), now.toISOString());
}
/**
 * 获取本周日志
 */
export async function getThisWeekLogs() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff);
    startOfWeek.setHours(0, 0, 0, 0);
    return getLogsByTimeRange(startOfWeek.toISOString(), now.toISOString());
}
/**
 * 获取本月日志
 */
export async function getThisMonthLogs() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return getLogsByTimeRange(startOfMonth.toISOString(), now.toISOString());
}
