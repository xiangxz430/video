/**
 * 图片生成统一入口
 *
 * 根据 provider 参数路由到对应提供商:
 *   - 'grsai'                            → Grsai (流式+轮询)
 *   - 'openrouter'                       → OpenRouter (chat/completions + vision)
 *   - 'dashscope'/'alibaba'/'bailian'    → 阿里百炼 Wan2.7-Image (同步)
 *   - 'tokenplan'                        → TokenPlan (OpenAI-compatible /images/generations)
 *   - 默认                               → 火山方舟 Seedream (同步)
 *
 * 各提供商实现已隔离到独立文件，修改某个提供商时
 * 只需编辑对应文件，不会影响其他提供商
 */
import type { ApiConfig, ImageGenParams } from '../../types/index.js';
export declare function generateImage(params: ImageGenParams, config: ApiConfig): Promise<string>;
export { generateImageWithOpenRouter } from './openRouter.js';
export { generateImageWithVolcEngine, generateVolcImage } from './volcEngine.js';
export { generateImageWithGrsai, getGrsaiResult } from './grsai.js';
export { generateWanxImage, submitWanxTask, waitForWanxTask } from './wanx.js';
export { generateTokenPlanImage } from './tokenPlan.js';
