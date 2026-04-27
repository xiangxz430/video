/**
 * 模型定价配置
 *
 * 定价策略：
 * - 文本模型：按每 1K tokens 输入/输出定价，由于日志不记录 token 数，
 *   使用按调用次数估算：根据 function 类型估算每次调用的平均 tokens
 * - 图片模型：按每次生成定价
 * - 视频模型：按每秒/每次生成定价
 *
 * 所有价格单位为美元 (USD)
 */
declare const FUNCTION_TOKEN_ESTIMATE: Record<string, {
    input: number;
    output: number;
}>;
/**
 * 模型定价表
 * key 格式: "provider:model" 或 "provider:*" 作为该 provider 的默认定价
 * 单位: USD / 1K tokens
 */
interface ModelPrice {
    inputPrice: number;
    outputPrice: number;
    perCallPrice?: number;
}
declare const MODEL_PRICES: Record<string, ModelPrice>;
/**
 * 查找模型定价
 * 优先级: provider:model > provider:* > *:*
 */
export declare function getModelPrice(provider: string, model: string): ModelPrice;
/**
 * 计算单次调用的估计费用
 * @param provider AI 提供商
 * @param model 模型名称
 * @param func 功能类型 (script/storyboard/image/video/other)
 * @param isSuccess 是否成功（失败调用也可能产生部分费用）
 * @returns 估计费用（USD）
 */
export declare function estimateCallCost(provider: string, model: string, func: string, isSuccess: boolean): number;
/**
 * 获取模型显示名称
 */
export declare function getModelDisplayInfo(provider: string, model: string): {
    providerName: string;
    modelName: string;
};
export { FUNCTION_TOKEN_ESTIMATE, MODEL_PRICES };
