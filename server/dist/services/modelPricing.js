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
// 按功能类型的平均 token 估算
const FUNCTION_TOKEN_ESTIMATE = {
    script: { input: 3000, output: 2000 }, // 剧本生成：prompt + 长文本输出
    storyboard: { input: 2000, output: 1500 }, // 分镜生成：结构化输出
    image: { input: 200, output: 100 }, // 图片 prompt 生成
    video: { input: 300, output: 100 }, // 视频 prompt 生成
    other: { input: 1000, output: 500 },
};
// 单位: USD / 1K tokens
const MODEL_PRICES = {
    // ========== DeepSeek ==========
    'deepseek:deepseek-chat': { inputPrice: 0.00014, outputPrice: 0.00028 },
    'deepseek:deepseek-reasoner': { inputPrice: 0.00055, outputPrice: 0.00219 },
    'deepseek:*': { inputPrice: 0.00014, outputPrice: 0.00028 },
    // ========== Volcengine (豆包) ==========
    'volcengine:doubao-1.5-pro-32k-250115': { inputPrice: 0.00011, outputPrice: 0.00011 },
    'volcengine:doubao-1.5-lite-32k-250115': { inputPrice: 0.00004, outputPrice: 0.00004 },
    'volcengine:doubao-seed-1.6-250615': { inputPrice: 0.00011, outputPrice: 0.00011 },
    'volcengine:*': { inputPrice: 0.00011, outputPrice: 0.00011 },
    // ========== Qwen (DashScope/百炼) ==========
    'qwen:qwen-turbo': { inputPrice: 0.0003, outputPrice: 0.0006 },
    'qwen:qwen-plus': { inputPrice: 0.0008, outputPrice: 0.002 },
    'qwen:qwen-max': { inputPrice: 0.003, outputPrice: 0.006 },
    'qwen:qwen-vl-plus': { inputPrice: 0.0015, outputPrice: 0.0045 },
    'qwen:qwen-vl-max': { inputPrice: 0.003, outputPrice: 0.012 },
    'qwen:*': { inputPrice: 0.0003, outputPrice: 0.0006 },
    // ========== Token Plan (百炼包月) ==========
    // Token Plan 按 Credits 计费，无法精确折算为 USD/1K tokens
    // 使用 Credits 估算：约 $0.0028/Credit，约 $0.0056/1K tokens
    'tokenplan:qwen3.6-plus': { inputPrice: 0.001, outputPrice: 0.002 },
    'tokenplan:glm-5': { inputPrice: 0.001, outputPrice: 0.002 },
    'tokenplan:miniMax-M2.5': { inputPrice: 0.001, outputPrice: 0.002 },
    'tokenplan:deepseek-v3.2': { inputPrice: 0.0005, outputPrice: 0.001 },
    'tokenplan:*': { inputPrice: 0.001, outputPrice: 0.002 },
    // ========== OpenRouter ==========
    'openrouter:*': { inputPrice: 0.001, outputPrice: 0.002 },
    // ========== GRSai (图片生成) ==========
    'grsai:*': { inputPrice: 0, outputPrice: 0, perCallPrice: 0.02 },
    // ========== Idealab (图片生成) ==========
    'idealab:*': { inputPrice: 0, outputPrice: 0, perCallPrice: 0.03 },
    // ========== 默认兜底 ==========
    '*:*': { inputPrice: 0.001, outputPrice: 0.002 },
};
/**
 * 查找模型定价
 * 优先级: provider:model > provider:* > *:*
 */
export function getModelPrice(provider, model) {
    const exactKey = `${provider}:${model}`;
    const providerKey = `${provider}:*`;
    const defaultKey = '*:*';
    return MODEL_PRICES[exactKey] || MODEL_PRICES[providerKey] || MODEL_PRICES[defaultKey];
}
/**
 * 计算单次调用的估计费用
 * @param provider AI 提供商
 * @param model 模型名称
 * @param func 功能类型 (script/storyboard/image/video/other)
 * @param isSuccess 是否成功（失败调用也可能产生部分费用）
 * @returns 估计费用（USD）
 */
export function estimateCallCost(provider, model, func, isSuccess) {
    const price = getModelPrice(provider, model);
    // 如果有固定每次调用价格，直接使用
    if (price.perCallPrice !== undefined && price.perCallPrice > 0) {
        // 失败调用不计费（或计一半）
        return isSuccess ? price.perCallPrice : 0;
    }
    // 基于 token 估算
    const funcKey = func in FUNCTION_TOKEN_ESTIMATE ? func : 'other';
    const estimate = FUNCTION_TOKEN_ESTIMATE[funcKey];
    // 失败调用只计算 input tokens（输出为 0）
    const inputCost = (estimate.input / 1000) * price.inputPrice;
    const outputCost = isSuccess ? (estimate.output / 1000) * price.outputPrice : 0;
    return inputCost + outputCost;
}
/**
 * 获取模型显示名称
 */
export function getModelDisplayInfo(provider, model) {
    const providerNames = {
        deepseek: 'DeepSeek',
        volcengine: '火山引擎',
        qwen: '通义千问',
        openrouter: 'OpenRouter',
        grsai: 'GRSai',
        idealab: 'Idealab',
        tokenplan: '百炼TokenPlan',
        unknown: '未知',
    };
    return {
        providerName: providerNames[provider] || provider,
        modelName: model === 'unknown' ? '未指定' : model,
    };
}
export { FUNCTION_TOKEN_ESTIMATE, MODEL_PRICES };
