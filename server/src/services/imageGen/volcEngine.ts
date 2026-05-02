/**
 * 火山方舟 Seedream (Volcengine) 图片生成服务
 * 
 * API 端点: POST {baseUrl}/images/generations
 * 认证方式: Bearer Token (火山方舟 ark- 前缀 API Key)
 * 任务模式: 同步返回
 * 
 * 参考图片格式 (顶级 images 数组):
 *   requestBody.images = ["https://...", "data:image/jpeg;base64,..."]
 *   支持 http/https URL 和 base64 data URL
 * 
 * 宽高比映射:
 *   16:9 → 2560x1440, 9:16 → 1440x2560, 1:1 → 1920x1920
 *   4:3 → 2400x1800, 3:4 → 1800x2400
 * 
 * 响应取值: result.data[0].url
 * 
 * 注意: 
 *   - 有敏感内容检测 (InputImageSensitiveContentDetected)
 *   - 分辨率 1K 会自动升级到 2K
 *   - 不要与 OpenRouter 的 vision 格式或 Grsai 的 urls 字段混淆
 */
import type { ApiConfig, ImageGenParams } from '../../types/index.js';
import { recordAICall, sanitizeAICallBody } from '../logContext.js';

async function callVolcImageAPI(config: ApiConfig, path: string, method: string, body: string): Promise<any> {
  const baseUrl = config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3';
  
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: method !== 'GET' ? body : undefined
  });
  
  if (!response.ok) {
    const errText = await response.text();
    
    let errorMessage = `火山方舟 API 请求失败 (${response.status}): ${errText}`;
    try {
      const errorData = JSON.parse(errText);
      const errorCode = errorData.error?.code;
      const errorMsg = errorData.error?.message;
      
      if (errorCode === 'InputImageSensitiveContentDetected') {
        errorMessage = `参考图片包含敏感内容，火山方舟拒绝处理。\n\n错误详情：${errorMsg}\n\n建议：\n1. 更换参考图片，避免包含暴力、色情、政治敏感等内容\n2. 尝试使用其他图片生成模型（如 Grsai 或 OpenRouter）`;
      } else if (errorCode) {
        errorMessage = `火山方舟错误 (${errorCode}): ${errorMsg}`;
      }
    } catch (e) {
      // 如果解析失败，使用原始错误信息
    }
    
    throw new Error(errorMessage);
  }
  
  return await response.json();
}

export async function generateVolcImage(params: ImageGenParams, config: ApiConfig): Promise<string> {
  const startTime = Date.now();
  const model = params.model || config.model || 'doubao-seedream-5-0-260128';
  const baseUrl = config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3';
  const endpoint = `${baseUrl}/images/generations`;
  
  const requestBody: any = {
    model,
    prompt: params.prompt,
    response_format: 'url'
  };
  
  if (params.referenceImages?.length) {
    const validImages = params.referenceImages.filter(img =>
      img.startsWith('http://') ||
      img.startsWith('https://') ||
      img.startsWith('data:image/')
    );

    if (validImages.length > 0) {
      requestBody.images = validImages;
      console.log('火山方舟图生图模式，参考图片数:', validImages.length);
    } else {
      console.warn('⚠️ 参考图片格式无效，将使用文生图模式');
    }
  }
  
  if (params.size) {
    if (params.size.toLowerCase() === '1k') {
      requestBody.size = '2k';
      console.log('⚠️ 1K 分辨率不满足最小像素要求，自动升级到 2K');
    } else {
      requestBody.size = params.size;
    }
  } else if (params.aspectRatio) {
    const ratioMap: Record<string, string> = {
      '16:9': '2560x1440',
      '9:16': '1440x2560',
      '1:1': '1920x1920',
      '4:3': '2400x1800',
      '3:4': '1800x2400'
    };
    const size = ratioMap[params.aspectRatio];
    if (size) {
      requestBody.size = size;
    } else {
      requestBody.size = '2k';
    }
  } else {
    requestBody.size = '2k';
    console.log('⚠️ 未指定分辨率，默认使用 2K');
  }
  
  console.log('火山方舟图片生成请求:', JSON.stringify(requestBody, null, 2));
  
  const data = await callVolcImageAPI(
    config,
    '/images/generations',
    'POST',
    JSON.stringify(requestBody)
  );
  
  if (data.data && data.data.length > 0 && data.data[0].url) {
    console.log('火山方舟图片生成成功，URL:', data.data[0].url);
    recordAICall({
      provider: 'volcengine',
      model,
      endpoint,
      requestTime: Date.now() - startTime,
      status: 'success',
      requestBody: sanitizeAICallBody(requestBody),
      responseBody: sanitizeAICallBody({ imageUrl: data.data[0].url }),
    });
    return data.data[0].url;
  }
  
  recordAICall({
    provider: 'volcengine',
    model,
    endpoint,
    requestTime: Date.now() - startTime,
    status: 'failed',
    errorMessage: '图片生成失败：响应中未找到图片 URL',
    requestBody: sanitizeAICallBody(requestBody),
  });
  throw new Error('图片生成失败：响应中未找到图片 URL');
}

export async function generateImageWithVolcEngine(
  params: ImageGenParams,
  config: ApiConfig
): Promise<string> {
  // 延迟导入避免循环依赖：index.ts 导入本模块，本模块也导入 index.ts
  const { generateImage } = await import('./index.js');
  return await generateImage(params, config);
}
