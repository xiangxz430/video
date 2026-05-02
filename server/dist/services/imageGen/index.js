import { generateImageWithGrsai } from './grsai.js';
import { generateImageWithOpenRouter } from './openRouter.js';
import { generateVolcImage } from './volcEngine.js';
import { generateWanxImage } from './wanx.js';
import { generateTokenPlanImage } from './tokenPlan.js';
export async function generateImage(params, config) {
    const provider = config.provider?.toLowerCase() || '';
    if (provider === 'grsai') {
        console.log('使用 Grsai 图片生成...');
        if (!config.apiKey) {
            throw new Error('Grsai API 密钥未配置');
        }
        return await generateImageWithGrsai({
            prompt: params.prompt,
            model: config.model || 'nano-banana-fast',
            size: params.size || '2K',
            aspectRatio: params.aspectRatio || 'auto',
            referenceImages: params.referenceImages
        }, config.apiKey);
    }
    if (provider === 'openrouter') {
        console.log('使用 OpenRouter 图片生成...');
        if (!config.apiKey) {
            throw new Error('OpenRouter API 密钥未配置');
        }
        return await generateImageWithOpenRouter(params, config);
    }
    // 百炼 TokenPlan 包月（OpenAI-compatible 图片生成，独立于 DashScope 原生 API）
    if (provider === 'tokenplan') {
        console.log('使用 TokenPlan 图片生成...');
        if (!config.apiKey) {
            throw new Error('TokenPlan API 密钥未配置');
        }
        return await generateTokenPlanImage(config, params);
    }
    // 阿里百炼 / DashScope / Wan2.7-Image
    if (provider === 'dashscope' || provider === 'alibaba' || provider === 'bailian') {
        console.log('使用阿里百炼 Wan2.7-Image 图片生成...');
        if (!config.apiKey) {
            throw new Error('阿里百炼 API 密钥未配置');
        }
        return await generateWanxImage(config, params);
    }
    console.log('使用火山方舟图片生成...');
    return await generateVolcImage(params, config);
}
// 重新导出所有提供商函数，保持外部引用兼容
export { generateImageWithOpenRouter } from './openRouter.js';
export { generateImageWithVolcEngine, generateVolcImage } from './volcEngine.js';
export { generateImageWithGrsai, getGrsaiResult } from './grsai.js';
export { generateWanxImage, submitWanxTask, waitForWanxTask } from './wanx.js';
export { generateTokenPlanImage } from './tokenPlan.js';
