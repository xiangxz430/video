/**
 * AI 图片生成模块
 * 包含通义万相、火山方舟 Seedream、OpenRouter、Grsai 等图片生成功能
 */
import type { ApiConfig, ImageGenParams } from '../types/index.js';
import { getProviderConfig } from '../config/index.js';
import { recordAICall, sanitizeAICallBody } from './logContext.js';

// ========== 通义万相 - 图片生成 ==========

interface WanxResponse {
  output: {
    task_id: string;
    task_status: string;
    results?: Array<{
      url: string;
    }>;
  };
}

export async function submitWanxTask(config: ApiConfig, prompt: string): Promise<string> {
  const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
  const model = config.model || 'wanx-v1';
  const endpoint = `${baseUrl}/services/aigc/text2image/image-synthesis`;
  const startTime = Date.now();
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify({
        model,
        input: { prompt },
        parameters: {
          size: '768*1024',
          n: 1,
          style: '<auto>'
        }
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`图片生成任务提交失败 (${response.status}): ${errText}`);
    }
    
    const data = await response.json() as WanxResponse;
    const taskId = data.output.task_id;
    
    const reqBody = { model, input: { prompt }, parameters: { size: '768*1024', n: 1, style: '<auto>' } };
    recordAICall({
      provider: 'qwen',
      model,
      endpoint,
      requestTime: Date.now() - startTime,
      status: 'success',
      taskId,
      requestBody: sanitizeAICallBody(reqBody),
      responseBody: sanitizeAICallBody({ taskId, taskStatus: data.output.task_status }),
    });
    
    return taskId;
  } catch (error: any) {
    const reqBody = { model, input: { prompt }, parameters: { size: '768*1024', n: 1, style: '<auto>' } };
    recordAICall({
      provider: 'qwen',
      model,
      endpoint,
      requestTime: Date.now() - startTime,
      status: 'failed',
      errorMessage: error.message || '未知错误',
      requestBody: sanitizeAICallBody(reqBody),
    });
    throw error;
  }
}

async function queryWanxTask(config: ApiConfig, taskId: string): Promise<string | null> {
  const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
  
  const response = await fetch(`${baseUrl}/tasks/${taskId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`查询任务失败 (${response.status})`);
  }
  
  const data = await response.json() as WanxResponse;
  
  if (data.output.task_status === 'SUCCEEDED') {
    return data.output.results?.[0]?.url || null;
  } else if (data.output.task_status === 'FAILED') {
    throw new Error('图片生成失败');
  }
  
  return null;
}

export async function waitForWanxTask(config: ApiConfig, taskId: string, maxRetries = 30): Promise<string> {
  const startTime = Date.now();
  const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
  
  for (let i = 0; i < maxRetries; i++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const url = await queryWanxTask(config, taskId);
    if (url) {
      recordAICall({
        provider: 'qwen',
        model: config.model || 'wanx-v1',
        endpoint: `${baseUrl}/tasks/${taskId}`,
        requestTime: Date.now() - startTime,
        status: 'success',
        pollAttempts: i + 1,
        taskId,
        responseBody: sanitizeAICallBody({ imageUrl: url }),
      });
      return url;
    }
  }
  
  recordAICall({
    provider: 'qwen',
    model: config.model || 'wanx-v1',
    endpoint: `${baseUrl}/tasks/${taskId}`,
    requestTime: Date.now() - startTime,
    status: 'timeout',
    pollAttempts: maxRetries,
    taskId,
    responseBody: sanitizeAICallBody({ maxRetries }),
  });
  
  throw new Error('图片生成超时');
}

// ========== 火山方舟 Seedream - 图片生成 ==========

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

async function generateVolcImage(params: ImageGenParams, config: ApiConfig): Promise<string> {
  const startTime = Date.now();
  const model = params.model || config.model || 'doubao-seedream-5-0-260128';
  const baseUrl = config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3';
  const endpoint = `${baseUrl}/images/generations`;
  
  const requestBody: any = {
    model,
    prompt: params.prompt,
    response_format: 'url'
  };
  
  if (params.referenceImage) {
    const images = Array.isArray(params.referenceImage) ? params.referenceImage : [params.referenceImage];
    
    const validImages = images.filter(img => 
      img.startsWith('http://') || 
      img.startsWith('https://') || 
      img.startsWith('data:image/')
    );
    
    if (validImages.length > 0) {
      requestBody.image = validImages.length === 1 ? validImages[0] : validImages;
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
  return await generateImage(params, config);
}

// ========== OpenRouter 图片生成 ==========

export async function generateImageWithOpenRouter(
  params: ImageGenParams,
  config: ApiConfig
): Promise<string> {
  const { prompt, aspectRatio, size } = params;
  const model = config.model || 'black-forest-labs/flux.2-pro';
  const baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
  const endpoint = `${baseUrl}/chat/completions`;
  const startTime = Date.now();
  
  console.log('OpenRouter 图片生成请求:', { model, promptLength: prompt.length });
  
  const requestBody: any = {
    model: model,
    messages: [
      {
        role: 'user',
        content: prompt
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

// ========== Grsai 图片生成 ==========

interface GrsaiImageParams {
  prompt: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  referenceImage?: string | string[];
  useStream?: boolean;
  onProgress?: (progress: number) => void;
}

export async function generateImageWithGrsai(
  params: GrsaiImageParams,
  apiKey: string,
  baseUrl: string = 'https://grsai.dakka.com.cn'
): Promise<string> {
  const { prompt, model = 'nano-banana-fast', size = '2K', aspectRatio = 'auto', referenceImage, useStream = true, onProgress } = params;
  console.log('Grsai 图片生成请求:', { model, promptLength: prompt.length, size, aspectRatio, useStream, baseUrl });
  
  const requestBody: any = {
    model,
    prompt,
    aspectRatio,
    imageSize: size,
    shutProgress: false
  };
  
  if (referenceImage) {
    requestBody.urls = Array.isArray(referenceImage) ? referenceImage : [referenceImage];
  }
  
  const apiEndpoint = `${baseUrl}/v1/draw/nano-banana`;
  
  console.log('🔑 Grsai API Key:', apiKey ? `${apiKey.substring(0, 10)}...` : '未配置');
  console.log('📡 Grsai API Endpoint:', apiEndpoint);
  
  const startTime = Date.now();
  
  if (useStream) {
    const controller = new AbortController();
    const streamTimeout = setTimeout(() => controller.abort(), 300_000);
    
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const reader = response.body?.getReader();
    if (!reader) {
      clearTimeout(streamTimeout);
      throw new Error('无法获取响应流');
    }
    
    try {
      const decoder = new TextDecoder();
      let buffer = '';
      
      let lastParsedData: any = null;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          let jsonStr = trimmedLine;
          if (jsonStr.startsWith('data:')) {
            jsonStr = jsonStr.substring(5).trim();
          }
          
          if (jsonStr) {
            try {
              const data = JSON.parse(jsonStr);
              lastParsedData = data;
              
              if (data.progress !== undefined && onProgress) {
                onProgress(data.progress);
              }
              
              if (data.status === 'succeeded') {
                // 兼容多种返回格式：results数组 或 直接返回url/content
                let imageUrl: string | null = null;
                
                if (data.results && data.results.length > 0) {
                  const result = data.results[0];
                  imageUrl = result.url || result.content || result.image_url;
                } else if (data.url) {
                  imageUrl = data.url;
                } else if (data.content) {
                  imageUrl = data.content;
                } else if (data.data?.url) {
                  imageUrl = data.data.url;
                } else if (data.data?.results?.[0]) {
                  imageUrl = data.data.results[0].url || data.data.results[0].content;
                }
                
                if (imageUrl) {
                  console.log('Grsai 图片生成成功');
                  recordAICall({
                    provider: 'grsai',
                    model,
                    endpoint: apiEndpoint,
                    requestTime: Date.now() - startTime,
                    status: 'success',
                    requestBody: sanitizeAICallBody({ model, prompt, aspectRatio, imageSize: size, hasReferenceImage: !!referenceImage }),
                    responseBody: sanitizeAICallBody({ imageUrl }),
                  });
                  return imageUrl;
                }
                
                // succeeded 但没有找到图片URL，记录数据以便排查
                console.warn('Grsai 返回 succeeded 但未找到图片URL，响应数据:', JSON.stringify(data).substring(0, 500));
              }
              
              if (data.status === 'failed') {
                const failMsg = data.failure_reason || data.error || data.message || '图片生成失败';
                console.error('Grsai 图片生成失败:', failMsg);
                recordAICall({
                  provider: 'grsai',
                  model,
                  endpoint: apiEndpoint,
                  requestTime: Date.now() - startTime,
                  status: 'failed',
                  errorMessage: failMsg,
                  requestBody: sanitizeAICallBody({ model, prompt, aspectRatio, imageSize: size }),
                });
                throw new Error(failMsg);
              }
            } catch (e) {
              // 区分业务错误和JSON解析错误
              if (e instanceof SyntaxError) {
                // JSON 解析失败，忽略非JSON行
              } else {
                // 业务错误（如 status=failed），向上抛出
                throw e;
              }
            }
          }
        }
      }
      
      // 流结束但未获取到图片，输出最后收到的数据帮助排查
      console.error('Grsai 流式响应结束但未获取到图片，最后收到的数据:', lastParsedData ? JSON.stringify(lastParsedData).substring(0, 500) : '无');
      recordAICall({
        provider: 'grsai',
        model,
        endpoint: apiEndpoint,
        requestTime: Date.now() - startTime,
        status: 'failed',
        errorMessage: '流式响应结束但未获取到图片',
        requestBody: sanitizeAICallBody({ model, prompt, aspectRatio, imageSize: size }),
      });
      throw new Error('流式响应结束但未获取到图片');
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.error('Grsai 流式图片生成超时（300秒）');
        recordAICall({
          provider: 'grsai',
          model,
          endpoint: apiEndpoint,
          requestTime: Date.now() - startTime,
          status: 'timeout',
          errorMessage: '图片生成超时（300秒），模型处理时间过长',
          requestBody: sanitizeAICallBody({ model, prompt, aspectRatio, imageSize: size }),
        });
        throw new Error('图片生成超时（300秒），模型处理时间过长');
      }
      throw e;
    } finally {
      clearTimeout(streamTimeout);
      reader.releaseLock();
    }
  } else {
    const drawResponse = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    if (!drawResponse.ok) {
      const errorText = await drawResponse.text();
      recordAICall({
        provider: 'grsai',
        model,
        endpoint: apiEndpoint,
        requestTime: Date.now() - startTime,
        status: 'failed',
        errorMessage: `HTTP ${drawResponse.status}: ${errorText || drawResponse.statusText}`,
        requestBody: sanitizeAICallBody(requestBody),
      });
      throw new Error(`HTTP ${drawResponse.status}: ${errorText || drawResponse.statusText}`);
    }
    
    const drawData = await drawResponse.json();
    
    if (drawData.error) {
      recordAICall({
        provider: 'grsai',
        model,
        endpoint: apiEndpoint,
        requestTime: Date.now() - startTime,
        status: 'failed',
        errorMessage: `Grsai API 错误: ${drawData.error}`,
        requestBody: sanitizeAICallBody(requestBody),
        responseBody: sanitizeAICallBody({ error: drawData.error }),
      });
      throw new Error(`Grsai API 错误: ${drawData.error}`);
    }
    
    if (drawData.data && (drawData.data.url || drawData.data.content)) {
      const imageUrl = drawData.data.url || drawData.data.content;
      recordAICall({
        provider: 'grsai',
        model,
        endpoint: apiEndpoint,
        requestTime: Date.now() - startTime,
        status: 'success',
        requestBody: sanitizeAICallBody(requestBody),
        responseBody: sanitizeAICallBody({ imageUrl }),
      });
      return imageUrl;
    }
    
    if (drawData.data && drawData.data.results && drawData.data.results.length > 0) {
      const imgResult = drawData.data.results[0];
      const imageUrl = imgResult.url || imgResult.content;
      if (imageUrl) {
        recordAICall({
          provider: 'grsai',
          model,
          endpoint: apiEndpoint,
          requestTime: Date.now() - startTime,
          status: 'success',
          requestBody: sanitizeAICallBody(requestBody),
          responseBody: sanitizeAICallBody({ imageUrl }),
        });
        return imageUrl;
      }
    }
    
    if (drawData.data && typeof drawData.data === 'string' && drawData.data.startsWith('data:')) {
      recordAICall({
        provider: 'grsai',
        model,
        endpoint: apiEndpoint,
        requestTime: Date.now() - startTime,
        status: 'success',
        requestBody: sanitizeAICallBody(requestBody),
      });
      return drawData.data;
    }
    
    if (drawData.url || drawData.content) {
      const imageUrl = drawData.url || drawData.content;
      recordAICall({
        provider: 'grsai',
        model,
        endpoint: apiEndpoint,
        requestTime: Date.now() - startTime,
        status: 'success',
        requestBody: sanitizeAICallBody(requestBody),
        responseBody: sanitizeAICallBody({ imageUrl }),
      });
      return imageUrl;
    }
    
    if (drawData.code !== 0 || !drawData.data || !drawData.data.id) {
      recordAICall({
        provider: 'grsai',
        model,
        endpoint: apiEndpoint,
        requestTime: Date.now() - startTime,
        status: 'failed',
        errorMessage: drawData.msg || drawData.message || drawData.error || '绘画请求失败',
        requestBody: sanitizeAICallBody(requestBody),
        responseBody: sanitizeAICallBody({ msg: drawData.msg, error: drawData.error }),
      });
      throw new Error(drawData.msg || drawData.message || drawData.error || '绘画请求失败');
    }
    
    const taskId = drawData.data.id;
    console.log('Grsai 任务ID:', taskId);
    
    const maxAttempts = 60;
    const interval = 2000;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, interval));
      
      const resultResponse = await fetch(`${baseUrl}/v1/draw/result`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId })
      });
      
      const resultData = await resultResponse.json();
      
      if (resultData.code === 0 && resultData.data) {
        const result = resultData.data;
        
        if (result.progress !== undefined && onProgress) {
          onProgress(result.progress);
        }
        
        if (result.status === 'succeeded' && result.results && result.results.length > 0) {
          const imgResult = result.results[0];
          const imageUrl = imgResult.url || imgResult.content;
          if (imageUrl) {
            console.log('Grsai 图片生成成功');
            recordAICall({
              provider: 'grsai',
              model,
              endpoint: apiEndpoint,
              requestTime: Date.now() - startTime,
              status: 'success',
              pollAttempts: attempt + 1,
              taskId,
              requestBody: sanitizeAICallBody(requestBody),
              responseBody: sanitizeAICallBody({ imageUrl }),
            });
            return imageUrl;
          }
        }
        if (result.status === 'failed') {
          recordAICall({
            provider: 'grsai',
            model,
            endpoint: apiEndpoint,
            requestTime: Date.now() - startTime,
            status: 'failed',
            errorMessage: result.failure_reason || result.error || '图片生成失败',
            pollAttempts: attempt + 1,
            taskId,
            requestBody: sanitizeAICallBody(requestBody),
            responseBody: sanitizeAICallBody({ failure_reason: result.failure_reason, error: result.error }),
          });
          throw new Error(result.failure_reason || result.error || '图片生成失败');
        }
      } else {
        if (resultData.code !== 0) {
          recordAICall({
            provider: 'grsai',
            model,
            endpoint: apiEndpoint,
            requestTime: Date.now() - startTime,
            status: 'failed',
            errorMessage: resultData.msg || resultData.message || 'apikey error',
            pollAttempts: attempt + 1,
            taskId,
            requestBody: sanitizeAICallBody(requestBody),
            responseBody: sanitizeAICallBody({ msg: resultData.msg, code: resultData.code }),
          });
          throw new Error(resultData.msg || resultData.message || 'apikey error');
        }
      }
    }
    
    recordAICall({
      provider: 'grsai',
      model,
      endpoint: apiEndpoint,
      requestTime: Date.now() - startTime,
      status: 'timeout',
      pollAttempts: maxAttempts,
      taskId,
      requestBody: sanitizeAICallBody(requestBody),
    });
    throw new Error('图片生成超时');
  }
}

export async function getGrsaiResult(
  taskId: string,
  apiKey: string,
  baseUrl: string = 'https://grsai.dakka.com.cn'
): Promise<{
  status: string;
  url?: string;
  content?: string;
  progress?: number;
  failureReason?: string;
  error?: string;
}> {
  console.log('Grsai 获取结果:', { taskId, baseUrl });
  
  const response = await fetch(`${baseUrl}/v1/draw/result`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: taskId })
  });
  
  const data = await response.json();
  console.log('Grsai 结果查询响应:', data);
  
  if (data.code !== 0) {
    throw new Error(data.msg || '查询结果失败');
  }
  
  const result = data.data;
  return {
    status: result.status,
    url: result.results?.[0]?.url,
    content: result.results?.[0]?.content,
    progress: result.progress,
    failureReason: result.failure_reason,
    error: result.error
  };
}

// ========== 统一的图片生成 API ==========

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
      referenceImage: params.referenceImage
    }, config.apiKey);
  }
  
  if (provider === 'openrouter') {
    console.log('使用 OpenRouter 图片生成...');
    if (!config.apiKey) {
      throw new Error('OpenRouter API 密钥未配置');
    }
    return await generateImageWithOpenRouter(params, config);
  }
  
  console.log('使用火山方舟图片生成...');
  return await generateVolcImage(params, config);
}
