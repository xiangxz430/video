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
 * 仪表盘概览统计（MongoDB 聚合版）
 * 一次聚合查询完成全部统计，比全量加载到内存再遍历快 10-100x
 */
export declare function getOverviewStats(): Promise<OverviewStats>;
/**
 * 按时间统计（MongoDB 聚合版 - 用 $bucket 按时间分桶）
 */
export declare function getStatsByTime(range: 'day' | 'week' | 'month'): Promise<TimeStats>;
/**
 * 按 Key 统计（MongoDB 聚合版）
 */
export declare function getStatsByKey(): Promise<KeyStats[]>;
/**
 * 按 Key 详细统计（含模型+功能细分+费用）
 * MongoDB 三级聚合：apiKeyMasked → provider+model → function
 * 费用计算在 JS 侧完成（依赖 estimateCallCost 函数逻辑）
 */
export declare function getStatsByKeyDetail(): Promise<KeyDetailStats[]>;
/**
 * 按功能统计（MongoDB 聚合版）
 */
export declare function getStatsByFunction(): Promise<Record<string, FunctionStats>>;
/**
 * 按 Provider 统计（MongoDB 聚合版）
 */
export declare function getStatsByProvider(): Promise<Record<string, ProviderStats>>;
/**
 * 按 Provider+Model 统计（MongoDB 聚合版）
 */
export declare function getStatsByModel(): Promise<Record<string, ModelStats>>;
export declare function getSystemInfo(): SystemInfo;
