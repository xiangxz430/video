/**
 * AI 视频生成模块
 * 包含火山引擎、GRSai、Wan 2.6、OpenRouter 等视频生成功能
 */
import type { ApiConfig, VideoGenParams, VideoGenResult } from '../types/index.js';
import { generateVolcSignature } from './apiClients.js';
import { recordAICall, sanitizeAICallBody } from './logContext.js';

// 视频轮询相关常量
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_MAX_POLL_RETRIES = 120;

// ========== 火山引擎视频生成 ==========

function parseVolcCredentials(apiKey: string): { accessKey: string; secretKey: string } | null {
  if (apiKey.includes(':')) {
    const [accessKey, secretKey] = apiKey.split(':');
    return { accessKey, secretKey };
  }
  return null;
}

const DEFAULT_VOLC_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

async function callVolcEngine(config: ApiConfig, path: string, method: string, body: string, retryCount: number = 2): Promise<any> {
  let authHeader: string;
  
  if (config.apiKey.includes(':')) {
    const parsed = parseVolcCredentials(config.apiKey);
    if (!parsed) throw new Error('火山引擎 API Key 格式错误，请输入：AccessKeyID:SecretAccessKey');
    const query = '';
    authHeader = await generateVolcSignature(parsed.accessKey, parsed.secretKey, method, path, query, body);
  } else {
    authHeader = `Bearer ${config.apiKey}`;
  }

  const baseUrl = config.baseUrl || DEFAULT_VOLC_ARK_BASE_URL;
  const url = `${baseUrl}${path}`;
  console.log(`[VolcEngine] 请求: ${method} ${url}`);
  
  let lastError: any;
  
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      console.log(`[VolcEngine] 第 ${attempt} 次重试...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
    
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: method !== 'GET' ? body : undefined
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`火山引擎 API 请求失败 (${response.status}): ${errText}`);
      }

      return await response.json();
    } catch (error: any) {
      lastError = error;
      console.error(`[VolcEngine] 第 ${attempt + 1} 次请求失败:`, error.message);
      if (!error.message?.includes('error sending request')) {
        throw error;
      }
    }
  }
  
  console.error(`[VolcEngine] 请求失败，已重试 ${retryCount} 次`);
  throw new Error(`网络请求失败，请检查：1.网络连接 2.能否访问 ${baseUrl} 3.防火墙/代理设置`);
}

export async function submitVolcVideoTask(
  params: VideoGenParams,
  config: ApiConfig
): Promise<VideoGenResult> {
  const { prompt, firstFrameImage, lastFrameImage, referenceImages, aspectRatio, duration, enableAudio = true } = params;
  
  const content: any[] = [];
  
  if (prompt) {
    content.push({ type: 'text', text: prompt });
  }
  
  let mode: 'text-to-video' | 'image-to-video' | 'first-last-frame' = 'text-to-video';
  
  if (firstFrameImage && lastFrameImage) {
    mode = 'first-last-frame';
    content.push({ type: 'image_url', image_url: { url: firstFrameImage }, role: 'first_frame' });
    content.push({ type: 'image_url', image_url: { url: lastFrameImage }, role: 'last_frame' });
  } else if (firstFrameImage) {
    mode = 'image-to-video';
    content.push({ type: 'image_url', image_url: { url: firstFrameImage }, role: 'first_frame' });
  } else if (referenceImages && referenceImages.length > 0) {
    mode = 'image-to-video';
    referenceImages.forEach((imgUrl) => {
      content.push({ type: 'image_url', image_url: { url: imgUrl }, role: 'reference_image' });
    });
  }
  
  // 修正模型名：客户端可能传 doubao-seedance-2-0-fast（短横线），实际API需要 doubao-seedance-2.0-fast（点号）
  const rawModel = config.model || 'doubao-seedance-1-5-pro-251215';
  const model = rawModel.replace(/seedance-(\d+)-(\d+)-fast/, 'seedance-$1.$2-fast');
  
  const requestBody: any = {
    model,
    content
  };
  
  if (aspectRatio) requestBody.ratio = aspectRatio;
  
  const MIN_DURATION = 5;
  const MAX_DURATION = 10;
  
  if (duration !== undefined) {
    requestBody.duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, duration));
  } else {
    requestBody.duration = MIN_DURATION;
  }
  
  requestBody.motion_duration = requestBody.duration;
  requestBody.resolution = '720p';
  requestBody.generate_audio = enableAudio;
  requestBody.watermark = false;
  
  const body = JSON.stringify(requestBody);
  console.log(`视频生成请求 [${mode}]：`, JSON.stringify(requestBody, null, 2));

  const data = await callVolcEngine(config, '/contents/generations/tasks', 'POST', body);
  
  return { taskId: data.id || data.task_id || '', mode };
}

export async function queryVolcVideoTask(
  taskId: string,
  config: ApiConfig
): Promise<{ status: string; videoUrl?: string; duration?: number; ratio?: string; resolution?: string; }> {
  const data = await callVolcEngine(config, `/contents/generations/tasks/${taskId}`, 'GET', '');
  const status = data.status || '';
  console.log('视频任务状态:', status, '响应:', data);
  
  if (status === 'succeeded') {
    const videoUrl = data.content?.video_url || 
      data.output?.video_url || 
      (data.output?.videos && data.output.videos[0]?.url) ||
      data.video_url || null;
    return { status: 'finished', videoUrl: videoUrl || undefined, duration: data.duration, ratio: data.ratio, resolution: data.resolution };
  } else if (status === 'failed') {
    throw new Error('视频生成失败: ' + (data.error?.message || '未知错误'));
  } else if (status === 'expired') {
    throw new Error('视频生成任务超时');
  } else if (status === 'cancelled') {
    throw new Error('视频生成任务已取消');
  }
  return { status };
}

export async function waitForVolcVideo(
  taskId: string,
  config: ApiConfig,
  maxRetries = VIDEO_MAX_POLL_RETRIES,
  intervalMs = VIDEO_POLL_INTERVAL_MS,
  onProgress?: (status: string, attempt: number) => void
): Promise<string> {
  console.log(`开始等待视频生成，任务ID: ${taskId}，查询间隔: ${intervalMs/1000}秒`);
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    
    const result = await queryVolcVideoTask(taskId, config);
    
    onProgress?.(result.status, attempt + 1);
    
    if (result.status === 'finished' && result.videoUrl) {
      return result.videoUrl;
    }
    
    console.log(`[VolcVideo] 第 ${attempt + 1}/${maxRetries} 次查询，状态: ${result.status}`);
  }
  
  throw new Error('视频生成超时');
}

export async function generateVideoWithVolcEngine(
  params: VideoGenParams,
  config: ApiConfig
): Promise<string> {
  const startTime = Date.now();
  const rawModel = config.model || 'doubao-seedance-1-5-pro-251215';
  const model = rawModel.replace(/seedance-(\d+)-(\d+)-fast/, 'seedance-$1.$2-fast');
  const baseUrl = config.baseUrl || DEFAULT_VOLC_ARK_BASE_URL;
  let pollAttempts = 0;
  
  try {
    const { taskId } = await submitVolcVideoTask(params, config);
    const videoUrl = await waitForVolcVideo(taskId, config, VIDEO_MAX_POLL_RETRIES, VIDEO_POLL_INTERVAL_MS, (_status, attempt) => {
      pollAttempts = attempt;
    });
    
    recordAICall({
      provider: 'volcengine',
      model,
      endpoint: `${baseUrl}/contents/generations/tasks`,
      requestTime: Date.now() - startTime,
      status: 'success',
      pollAttempts,
      taskId,
      requestBody: sanitizeAICallBody({ prompt: params.prompt?.slice(0, 200), mode: 'volcengine-video', aspectRatio: params.aspectRatio, duration: params.duration }),
      responseBody: sanitizeAICallBody({ videoUrl }),
    });
    
    return videoUrl;
  } catch (error: any) {
    recordAICall({
      provider: 'volcengine',
      model,
      endpoint: `${baseUrl}/contents/generations/tasks`,
      requestTime: Date.now() - startTime,
      status: error.message?.includes('超时') ? 'timeout' : 'failed',
      errorMessage: error.message,
      pollAttempts,
      requestBody: sanitizeAICallBody({ prompt: params.prompt?.slice(0, 200), mode: 'volcengine-video', aspectRatio: params.aspectRatio, duration: params.duration }),
    });
    throw error;
  }
}

// ========== GRSai 视频生成 (Sora2) ==========

interface GRSaiVideoResult {
  id: string;
  results?: Array<{ url: string; removeWatermark: boolean; pid: string; }>;
  progress: number;
  status: 'running' | 'succeeded' | 'failed';
  failure_reason?: string;
  error?: string;
}

async function submitGRSaiVideoTask(params: VideoGenParams, config: ApiConfig): Promise<{ id: string }> {
  const { prompt, firstFrameImage, referenceImages, aspectRatio = '16:9', duration = 10 } = params;
  
  const requestBody: any = {
    model: 'sora-2', prompt, aspectRatio, duration, webHook: '-1', shutProgress: true
  };
  
  if (firstFrameImage) requestBody.url = firstFrameImage;
  else if (referenceImages && referenceImages.length > 0) requestBody.url = referenceImages[0];
  
  const response = await fetch(`${config.baseUrl}/v1/video/sora-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) throw new Error(`GRSai API 请求失败: ${response.status} ${await response.text()}`);
  
  const result = await response.json();
  if (result.code !== 0) throw new Error(`GRSai 错误: ${result.msg}`);
  return { id: result.data.id };
}

async function waitForGRSaiVideo(
  id: string,
  config: ApiConfig,
  maxWaitTime = 300000,
  onProgress?: (progress: number) => void
): Promise<string> {
  const startTime = Date.now();
  // 指数退避：初始 2s，每次增长 1.5x，上限 15s
  let intervalMs = 2000;
  const maxIntervalMs = 15000;
  const backoffFactor = 1.5;

  while (Date.now() - startTime < maxWaitTime) {
    const response = await fetch(`${config.baseUrl}/v1/video/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({ id })
    });
    if (!response.ok) {
      // 请求失败时也使用退避间隔
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
      continue;
    }
    const result: GRSaiVideoResult = await response.json();
    
    if (result.progress !== undefined) {
      onProgress?.(result.progress);
    }
    
    if (result.status === 'succeeded' && result.results?.length) return result.results[0].url;
    if (result.status === 'failed') throw new Error(`GRSai 视频生成失败: ${result.failure_reason || result.error || '未知错误'}`);

    // 任务仍在进行，按退避间隔等待
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
  }
  throw new Error('GRSai 视频生成超时');
}

export async function generateVideoWithGRSai(
  params: VideoGenParams,
  config: ApiConfig,
  onProgress?: (progress: number) => void
): Promise<string> {
  const startTime = Date.now();
  const model = 'sora-2';
  const baseUrl = config.baseUrl || 'https://grsai.dakka.com.cn';
  
  try {
    const { id } = await submitGRSaiVideoTask(params, config);
    const videoUrl = await waitForGRSaiVideo(id, config, 300000, onProgress);
    
    recordAICall({
      provider: 'grsai',
      model,
      endpoint: `${baseUrl}/v1/video/sora-video`,
      requestTime: Date.now() - startTime,
      status: 'success',
      taskId: id,
      requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), aspectRatio: params.aspectRatio, duration: params.duration }),
      responseBody: sanitizeAICallBody({ videoUrl }),
    });
    
    return videoUrl;
  } catch (error: any) {
    recordAICall({
      provider: 'grsai',
      model,
      endpoint: `${baseUrl}/v1/video/sora-video`,
      requestTime: Date.now() - startTime,
      status: error.message?.includes('超时') ? 'timeout' : 'failed',
      errorMessage: error.message,
      requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), aspectRatio: params.aspectRatio, duration: params.duration }),
    });
    throw error;
  }
}

// ========== Wan 2.6 视频生成 ==========

export async function generateVideoWithWan26(
  params: VideoGenParams,
  config: ApiConfig,
  onProgress?: (status: string) => void
): Promise<string> {
  const startTime = Date.now();
  const { prompt, firstFrameImage, lastFrameImage, referenceImages, aspectRatio = '16:9', duration = 5 } = params;
  const alphaBaseUrl = 'https://openrouter.ai/api/alpha';
  const model = config.model || 'alibaba/wan-2.6';

  const requestBody: any = { model, prompt: prompt || '', aspect_ratio: aspectRatio, duration, resolution: '720p' };
  const refImages: { type: string; image_url: { url: string } }[] = [];
  if (firstFrameImage) refImages.push({ type: 'image_url', image_url: { url: firstFrameImage } });
  if (lastFrameImage && refImages.length < 2) refImages.push({ type: 'image_url', image_url: { url: lastFrameImage } });
  if (refImages.length === 0 && referenceImages?.length) refImages.push({ type: 'image_url', image_url: { url: referenceImages[0] } });
  if (refImages.length) requestBody.input_references = refImages;

  const submitResponse = await fetch(`${alphaBaseUrl}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}`, 'HTTP-Referer': 'https://video-generator.app', 'X-Title': 'Video Generator' },
    body: JSON.stringify(requestBody)
  });
  if (!submitResponse.ok) throw new Error(`Wan 2.6 提交失败: ${submitResponse.status} ${await submitResponse.text()}`);
  const submitResult = await submitResponse.json();
  if (submitResult.error) throw new Error(`Wan 2.6 错误: ${submitResult.error.message || JSON.stringify(submitResult.error)}`);
  const pollingUrl: string = submitResult.polling_url;
  if (!pollingUrl) throw new Error('Wan 2.6 返回缺少 polling_url');
  
  try {
    const videoUrl = await waitForWan26Video(pollingUrl, config.apiKey, 600000, onProgress);
    
    recordAICall({
      provider: 'openrouter',
      model,
      endpoint: `${alphaBaseUrl}/videos`,
      requestTime: Date.now() - startTime,
      status: 'success',
      requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), aspect_ratio: aspectRatio, duration }),
      responseBody: sanitizeAICallBody({ videoUrl }),
    });
    
    return videoUrl;
  } catch (error: any) {
    recordAICall({
      provider: 'openrouter',
      model,
      endpoint: `${alphaBaseUrl}/videos`,
      requestTime: Date.now() - startTime,
      status: error.message?.includes('超时') ? 'timeout' : 'failed',
      errorMessage: error.message,
      requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), aspect_ratio: aspectRatio, duration }),
    });
    throw error;
  }
}

async function waitForWan26Video(
  pollingUrl: string,
  apiKey: string,
  maxWaitMs = 600000,
  onProgress?: (status: string) => void
): Promise<string> {
  const startTime = Date.now();
  // 指数退避：初始 3s，每次增长 1.5x，上限 20s
  let intervalMs = 3000;
  const maxIntervalMs = 20000;
  const backoffFactor = 1.5;

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    const pollResponse = await fetch(pollingUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://video-generator.app', 'X-Title': 'Video Generator' }
    });
    if (!pollResponse.ok) {
      intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
      continue;
    }
    const pollResult = await pollResponse.json();
    
    onProgress?.(pollResult.status);
    
    if (pollResult.status === 'completed' && pollResult.unsigned_urls?.length) return pollResult.unsigned_urls[0];
    if (['failed', 'cancelled', 'expired'].includes(pollResult.status)) throw new Error(`Wan 2.6 视频生成失败: ${pollResult.error || pollResult.status}`);

    // 任务仍在进行，递增退避间隔
    intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
  }
  throw new Error('Wan 2.6 视频生成超时（超过 10 分钟）');
}

// ========== OpenRouter 视频生成 ==========

export async function generateVideoWithOpenRouter(
  params: VideoGenParams,
  config: ApiConfig,
  onProgress?: (status: string) => void
): Promise<string> {
  const startTime = Date.now();
  const { prompt, firstFrameImage, referenceImages, aspectRatio = '16:9', duration = 10 } = params;
  const baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
  const model = config.model || 'minimax/video-01';
  
  const requestBody: any = { model, messages: [{ role: 'user', content: prompt }], modalities: ['video'] };
  if (firstFrameImage) requestBody.first_frame = firstFrameImage;
  if (referenceImages?.length) requestBody.images = referenceImages;
  if (duration) requestBody.duration = duration;
  if (aspectRatio) requestBody.aspect_ratio = aspectRatio;
  
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}`, 'HTTP-Referer': 'https://video-generator.app', 'X-Title': 'Video Generator' },
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) throw new Error(`OpenRouter 视频API请求失败: ${response.status} ${await response.text()}`);
  const result = await response.json();
  if (result.error) throw new Error(`OpenRouter 错误: ${result.error.message || JSON.stringify(result.error)}`);
  
  const taskId = result.id || result.data?.id;
  if (!taskId) {
    if (result.data?.url) {
      recordAICall({
        provider: 'openrouter',
        model,
        endpoint: `${baseUrl}/chat/completions`,
        requestTime: Date.now() - startTime,
        status: 'success',
        requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), modalities: ['video'] }),
        responseBody: sanitizeAICallBody({ videoUrl: result.data.url }),
      });
      return result.data.url;
    }
    recordAICall({
      provider: 'openrouter',
      model,
      endpoint: `${baseUrl}/chat/completions`,
      requestTime: Date.now() - startTime,
      status: 'failed',
      errorMessage: 'OpenRouter 返回缺少任务 ID',
      requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), modalities: ['video'] }),
    });
    throw new Error('OpenRouter 返回缺少任务 ID');
  }
  
  try {
    const videoUrl = await waitForOpenRouterVideo(taskId, baseUrl, config.apiKey, duration, onProgress);
    
    recordAICall({
      provider: 'openrouter',
      model,
      endpoint: `${baseUrl}/chat/completions`,
      requestTime: Date.now() - startTime,
      status: 'success',
      taskId,
      requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), modalities: ['video'] }),
      responseBody: sanitizeAICallBody({ videoUrl }),
    });
    
    return videoUrl;
  } catch (error: any) {
    recordAICall({
      provider: 'openrouter',
      model,
      endpoint: `${baseUrl}/chat/completions`,
      requestTime: Date.now() - startTime,
      status: error.message?.includes('超时') ? 'timeout' : 'failed',
      errorMessage: error.message,
      taskId,
      requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), modalities: ['video'] }),
    });
    throw error;
  }
}

async function waitForOpenRouterVideo(
  taskId: string,
  baseUrl: string,
  apiKey: string,
  maxWaitTime = 300000,
  onProgress?: (status: string) => void
): Promise<string> {
  const startTime = Date.now();
  // 指数退避：初始 3s，每次增长 1.5x，上限 15s
  let intervalMs = 3000;
  const maxIntervalMs = 15000;
  const backoffFactor = 1.5;

  while (Date.now() - startTime < maxWaitTime) {
    const response = await fetch(`${baseUrl}/video/generations/${taskId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://video-generator.app', 'X-Title': 'Video Generator' }
    });
    if (!response.ok) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
      continue;
    }
    const result = await response.json();
    
    onProgress?.(result.status);
    
    if (result.status === 'completed' && result.data?.url) return result.data.url;
    if (result.status === 'failed') throw new Error(`OpenRouter 视频生成失败: ${result.error?.message || '未知错误'}`);

    // 任务仍在进行，递增退避间隔
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
  }
  throw new Error('OpenRouter 视频生成超时');
}

// ========== 统一入口：根据 provider 自动路由 ==========

export async function generateVideo(
  params: VideoGenParams,
  config: ApiConfig,
  onProgress?: (progress: number | string) => void
): Promise<string> {
  const provider = (config.provider || '').toLowerCase();
  const model = (config.model || '').toLowerCase();
  
  console.log(`[generateVideo] provider=${provider}, model=${model}, prompt=${params.prompt?.substring(0, 50)}...`);
  
  switch (provider) {
    case 'volcengine':
    case 'volc':
    case 'ark':
      return generateVideoWithVolcEngine(params, config);
    
    case 'grsai':
      return generateVideoWithGRSai(params, config, onProgress);
    
    case 'openrouter':
      if (model.includes('wan-2.6') || model.includes('wan-2.7')) {
        return generateVideoWithWan26(params, config, onProgress);
      }
      return generateVideoWithOpenRouter(params, config, onProgress);
    
    default:
      throw new Error(`不支持的视频生成 provider: ${config.provider}。支持的 provider: volcengine, grsai, openrouter`);
  }
}

// ========== 便捷方法 ==========

export async function generateVideoFromText(prompt: string, config: ApiConfig): Promise<string> {
  return generateVideo({ prompt }, config);
}

export async function generateVideoFromImage(
  prompt: string,
  firstFrameImage: string,
  config: ApiConfig
): Promise<string> {
  return generateVideo({ prompt, firstFrameImage }, config);
}

export async function generateVideoFromFirstLastFrame(
  prompt: string,
  firstFrameImage: string,
  lastFrameImage: string,
  config: ApiConfig
): Promise<string> {
  return generateVideo({ prompt, firstFrameImage, lastFrameImage }, config);
}

export async function generateVideoFromReferenceImages(
  prompt: string,
  referenceImages: string[],
  config: ApiConfig
): Promise<string> {
  return generateVideo({ prompt, referenceImages }, config);
}
