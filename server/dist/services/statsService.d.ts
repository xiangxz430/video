export interface OverviewStats {
    today: {
        total: number;
        success: number;
        failed: number;
    };
    thisWeek: {
        total: number;
        success: number;
        failed: number;
    };
    thisMonth: {
        total: number;
        success: number;
        failed: number;
    };
    byFunction: Record<string, number>;
    byProvider: Record<string, number>;
}
export interface TimeStats {
    labels: string[];
    data: number[];
}
export interface KeyStats {
    keyId: string;
    keyName: string;
    maskedKey: string;
    totalCalls: number;
    lastUsedAt: string | null;
}
export interface FunctionStats {
    total: number;
    success: number;
    failed: number;
    avgDuration: number;
}
export interface ProviderStats {
    total: number;
    success: number;
    failed: number;
    avgDuration: number;
}
export interface ModelStats {
    provider: string;
    model: string;
    total: number;
    success: number;
    failed: number;
    avgDuration: number;
}
export interface KeyDetailStats {
    keyId: string;
    keyName: string;
    maskedKey: string;
    totalCalls: number;
    totalCost: number;
    lastUsedAt: string | null;
    models: KeyModelBreakdown[];
}
export interface KeyModelBreakdown {
    provider: string;
    model: string;
    displayProvider: string;
    displayModel: string;
    total: number;
    success: number;
    failed: number;
    estimatedCost: number;
    byFunction: Record<string, {
        total: number;
        success: number;
        failed: number;
        estimatedCost: number;
    }>;
}
export interface SystemInfo {
    uptime: number;
    memoryUsage: {
        rss: number;
        heapUsed: number;
        heapTotal: number;
    };
    nodeVersion: string;
    platform: string;
    cpuUsage: number;
}
/**
 * 仪表盘概览统计
 */
export declare function getOverviewStats(): OverviewStats;
/**
 * 按时间统计（最近N天/周的趋势）
 */
export declare function getStatsByTime(range: 'day' | 'week' | 'month'): TimeStats;
/**
 * 按 Key 统计
 */
export declare function getStatsByKey(): KeyStats[];
/**
 * 按 Key 详细统计（含按模型+功能细分、费用估算）
 */
export declare function getStatsByKeyDetail(): KeyDetailStats[];
/**
 * 按功能统计
 */
export declare function getStatsByFunction(): Record<string, FunctionStats>;
/**
 * 按 Provider 统计
 */
export declare function getStatsByProvider(): Record<string, ProviderStats>;
/**
 * 按 Provider+Model 统计
 */
export declare function getStatsByModel(): Record<string, ModelStats>;
/**
 * 系统信息
 */
export declare function getSystemInfo(): SystemInfo;
