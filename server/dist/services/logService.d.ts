import { RequestLog } from '../types/index.js';
export interface QueryLogsParams {
    page?: number;
    pageSize?: number;
    endpoint?: string;
    function?: string;
    provider?: string;
    statusCode?: number;
    startTime?: string;
    endTime?: string;
}
export interface QueryLogsResult {
    logs: RequestLog[];
    total: number;
    page: number;
    pageSize: number;
}
/**
 * 分页查询日志
 */
export declare function queryLogs(params: QueryLogsParams): QueryLogsResult;
/**
 * 获取单条日志详情
 */
export declare function getLogById(id: string): RequestLog | null;
/**
 * 获取最近的 N 条日志
 */
export declare function getRecentLogs(count?: number): RequestLog[];
/**
 * 按功能筛选日志
 */
export declare function getLogsByFunction(func: string): RequestLog[];
/**
 * 按 Provider 筛选日志
 */
export declare function getLogsByProvider(provider: string): RequestLog[];
/**
 * 按时间范围筛选日志
 */
export declare function getLogsByTimeRange(startTime: string, endTime: string): RequestLog[];
/**
 * 获取今日日志
 */
export declare function getTodayLogs(): RequestLog[];
/**
 * 获取本周日志
 */
export declare function getThisWeekLogs(): RequestLog[];
/**
 * 获取本月日志
 */
export declare function getThisMonthLogs(): RequestLog[];
