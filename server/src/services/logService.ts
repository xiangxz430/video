import { RequestLog, getAllLogs, getLogById as getLogByIdFromMiddleware } from '../middleware/requestLogger.js';

// 分页查询日志参数
export interface QueryLogsParams {
  page?: number;           // 默认 1
  pageSize?: number;       // 默认 20
  endpoint?: string;       // 筛选端点
  function?: string;       // 筛选功能
  provider?: string;       // 筛选 Provider
  statusCode?: number;     // 筛选状态码
  startTime?: string;      // 起始时间 ISO
  endTime?: string;        // 结束时间 ISO
}

// 分页查询结果
export interface QueryLogsResult {
  logs: RequestLog[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 分页查询日志
 */
export function queryLogs(params: QueryLogsParams): QueryLogsResult {
  const {
    page = 1,
    pageSize = 20,
    endpoint,
    function: func,
    provider,
    statusCode,
    startTime,
    endTime,
  } = params;

  // 获取所有日志
  let logs = getAllLogs();

  // 应用筛选条件
  if (endpoint) {
    logs = logs.filter(log => log.endpoint.includes(endpoint));
  }

  if (func) {
    logs = logs.filter(log => log.function === func);
  }

  if (provider) {
    logs = logs.filter(log => log.provider === provider);
  }

  if (statusCode !== undefined) {
    logs = logs.filter(log => log.statusCode === statusCode);
  }

  if (startTime) {
    const start = new Date(startTime).getTime();
    logs = logs.filter(log => new Date(log.timestamp).getTime() >= start);
  }

  if (endTime) {
    const end = new Date(endTime).getTime();
    logs = logs.filter(log => new Date(log.timestamp).getTime() <= end);
  }

  // 按时间倒序排序
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // 计算总数
  const total = logs.length;

  // 分页
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedLogs = logs.slice(startIndex, endIndex);

  return {
    logs: paginatedLogs,
    total,
    page,
    pageSize,
  };
}

/**
 * 获取单条日志详情
 */
export function getLogById(id: string): RequestLog | null {
  return getLogByIdFromMiddleware(id);
}

/**
 * 获取最近的 N 条日志
 */
export function getRecentLogs(count: number = 10): RequestLog[] {
  const logs = getAllLogs();
  return logs
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, count);
}

/**
 * 按功能筛选日志
 */
export function getLogsByFunction(func: string): RequestLog[] {
  const logs = getAllLogs();
  return logs.filter(log => log.function === func);
}

/**
 * 按 Provider 筛选日志
 */
export function getLogsByProvider(provider: string): RequestLog[] {
  const logs = getAllLogs();
  return logs.filter(log => log.provider === provider);
}

/**
 * 按时间范围筛选日志
 */
export function getLogsByTimeRange(startTime: string, endTime: string): RequestLog[] {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const logs = getAllLogs();
  return logs.filter(log => {
    const logTime = new Date(log.timestamp).getTime();
    return logTime >= start && logTime <= end;
  });
}

/**
 * 获取今日日志
 */
export function getTodayLogs(): RequestLog[] {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return getLogsByTimeRange(startOfDay.toISOString(), now.toISOString());
}

/**
 * 获取本周日志
 */
export function getThisWeekLogs(): RequestLog[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // 调整为周一开始
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff);
  startOfWeek.setHours(0, 0, 0, 0);
  return getLogsByTimeRange(startOfWeek.toISOString(), now.toISOString());
}

/**
 * 获取本月日志
 */
export function getThisMonthLogs(): RequestLog[] {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return getLogsByTimeRange(startOfMonth.toISOString(), now.toISOString());
}
