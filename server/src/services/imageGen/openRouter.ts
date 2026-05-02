/**
 * OpenRouter 图片生成服务
 * 
 * API 端点: POST https://openrouter.ai/api/v1/chat/completions
 * 认证方式: Bearer Token (OpenRouter API Key)
 * 任务模式: 同步返回
 * 
 * 参考图片格式 (vision 格式，与其他提供商完全不同):
 *   messages[].content = [
 *     { type: 'text', text: prompt },
 *     { type: 'image_url', image_url: { url: 'base64或URL' } }
 *   ]
 *   注意: content 必须是数组格式，不能是纯字符串
 * 
 * 响应取值: result.choices[0].message.images[0].image_url.url
 * 
 * 注意:
 *   - 不要与火山方舟的 requestBody.images 或 Grsai 的 requestBody.urls 混淆
 *   - 默认模型: black-forest-labs/flux.2-pro
 *   - 支持 image_config 配置宽高比和尺寸
 */
import type { ApiConfig, ImageGenParams } from '../../types/index.js';
import { recordAICall, sanitizeAICallBody } from '../logContext.js';

export async function generateImageWithOpenRouter(
  params: ImageGenParams,
  config: ApiConfig
): Promise<string> {
  const { prompt, aspectRatio, size, referenceImages } = params;
  const model = config.model || 'black-forest-labs/flux.2-pro';
  const baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
  const endpoint = `${baseUrl}/chat/completions`;
  const startTime = Date.now();
  
  console.log('OpenRouter 图片生成请求:', { model, promptLength: prompt.length });
  
  // 构建 content 数组
  const content: any[] = [{ type: 'text', text: prompt }];

  // 添加参考图片（统一数组格式）
  if (referenceImages?.length) {
    for (const img of referenceImages) {
      if (img) {
        content.push({
          type: 'image_url',
          image_url: { url: img }
        });
      }
    }
  }

  const requestBody: any = {
    model: model,
    messages: [
      {
        role: 'user',
        content: content
      }
    ],
    modalities: ['image']
  };
  
  if (aspectRatio || size) {
    requestBody.image_config = {};
    if (aspectRatio) {
      requestBody.image_config.aspect_ratio = aspectRatio;
    }
    if (size) {
      requestBody.image_config.image_size = size;
    }
  }
  
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'https://video-generator.app',
      'X-Title': 'Video Generator'
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API 请求失败: ${response.status} ${errorText}`);
  }
  
  const result = await response.json();
  console.log('OpenRouter 图片生成结果:', result);
  
  if (result.error) {
    throw new Error(`OpenRouter 错误: ${result.error.message || JSON.stringify(result.error)}`);
  }
  
  if (result.choices?.[0]?.message?.images && result.choices[0].message.images.length > 0) {
    const imageUrl = result.choices[0].message.images[0]?.image_url?.url;
    if (imageUrl) {
      console.log('OpenRouter 图片生成成功');
      recordAICall({
        provider: 'openrouter',
        model,
        endpoint,
        requestTime: Date.now() - startTime,
        status: 'success',
        requestBody: sanitizeAICallBody({ model, prompt: prompt.slice(0, 200), modalities: ['image'] }),
        responseBody: sanitizeAICallBody({ hasImage: true }),
      });
      return imageUrl;
    }
  }
  
  recordAICall({
    provider: 'openrouter',
    model,
    endpoint,
    requestTime: Date.now() - startTime,
    status: 'failed',
    errorMessage: 'OpenRouter 返回格式错误,未找到生成的图片',
    requestBody: sanitizeAICallBody({ model, prompt: prompt.slice(0, 200), modalities: ['image'] }),
  });
  throw new Error('OpenRouter 返回格式错误,未找到生成的图片');
}
