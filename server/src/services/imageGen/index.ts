/**
 * 图片生成统一入口
 * 
 * 根据 provider 参数路由到对应提供商:
 *   - 'grsai'                            → Grsai (流式+轮询)
 *   - 'openrouter'                       → OpenRouter (chat/completions + vision)
 *   - 'dashscope'/'alibaba'/'bailian'    → 阿里百炼通义万相 (异步任务+轮询)
 *   - 'tokenplan'                        → 百炼TokenPlan (同通义万相，包月路由)
 *   - 默认                               → 火山方舟 Seedream (同步)
 * 
 * 各提供商实现已隔离到独立文件，修改某个提供商时
 * 只需编辑对应文件，不会影响其他提供商
 */
import type { ApiConfig, ImageGenParams } from '../../types/index.js';
import { generateImageWithGrsai } from './grsai.js';
import { generateImageWithOpenRouter } from './openRouter.js';
import { generateVolcImage } from './volcEngine.js';
import { submitWanxTask, waitForWanxTask } from './wanx.js';

export async function generateImage(
  params: ImageGenParams,
  config: ApiConfig
): Promise<string> {
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
  
  // 阿里百炼 / DashScope / 通义万相（含 TokenPlan 包月路由）
  if (provider === 'dashscope' || provider === 'alibaba' || provider === 'bailian' || provider === 'tokenplan') {
    console.log('使用阿里百炼通义万相图片生成...');
    if (!config.apiKey) {
      throw new Error('阿里百炼 API 密钥未配置');
    }
    const taskId = await submitWanxTask(config, params.prompt);
    const imageUrl = await waitForWanxTask(config, taskId);
    return imageUrl;
  }
  
  console.log('使用火山方舟图片生成...');
  return await generateVolcImage(params, config);
}

// 重新导出所有提供商函数，保持外部引用兼容
export { generateImageWithOpenRouter } from './openRouter.js';
export { generateImageWithVolcEngine, generateVolcImage } from './volcEngine.js';
export { generateImageWithGrsai, getGrsaiResult } from './grsai.js';
export { submitWanxTask, waitForWanxTask } from './wanx.js';
