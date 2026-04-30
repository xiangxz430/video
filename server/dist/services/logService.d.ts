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
 * 分页查询日志（MongoDB 查询版）
 * 利用索引 + MongoDB 原生 filter + sort + skip + limit
 */
export declare function queryLogs(params: QueryLogsParams): Promise<QueryLogsResult>;
/**
 * 获取单条日志详情
 */
export declare function getLogById(id: string): Promise<RequestLog | null>;
/**
 * 删除单条日志
 */
export declare function deleteLog(id: string): Promise<boolean>;
/**
 * 获取最近的 N 条日志
 */
export declare function getRecentLogs(count?: number): Promise<RequestLog[]>;
/**
 * 按功能筛选日志
 */
export declare function getLogsByFunction(func: string): Promise<RequestLog[]>;
/**
 * 按 Provider 筛选日志
 */
export declare function getLogsByProvider(provider: string): Promise<RequestLog[]>;
/**
 * 按时间范围筛选日志
 */
export declare function getLogsByTimeRange(startTime: string, endTime: string): Promise<RequestLog[]>;
/**
 * 获取今日日志
 */
export declare function getTodayLogs(): Promise<RequestLog[]>;
/**
 * 获取本周日志
 */
export declare function getThisWeekLogs(): Promise<RequestLog[]>;
/**
 * 获取本月日志
 */
export declare function getThisMonthLogs(): Promise<RequestLog[]>;
