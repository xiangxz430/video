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
  
  const model = config.model || 'doubao-seedance-1-5-pro-251215';
  
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
  const model = config.model || 'doubao-seedance-1-5-pro-251215';
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

  const bodyStr = JSON.stringify(requestBody);
  console.log(`[GRSai] 提交视频任务, body大小: ${(bodyStr.length / 1024).toFixed(1)}KB`);

  const SUBMIT_TIMEOUT_MS = 120_000;
  const MAX_RETRIES = 2;
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = 2000 * attempt;
      console.log(`[GRSai] 第 ${attempt} 次重试提交，等待 ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

      const response = await fetch(`${config.baseUrl}/v1/video/sora-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
        body: bodyStr,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`GRSai API 请求失败: ${response.status} ${await response.text()}`);

      const result = await response.json();
      if (result.code !== 0) throw new Error(`GRSai 错误: ${result.msg}`);
      return { id: result.data.id };
    } catch (error: any) {
      lastError = error;
      const msg = error?.message || '';
      console.error(`[GRSai] 第 ${attempt + 1} 次提交失败:`, msg);

      const isNetworkError = msg.includes('fetch failed') ||
                             msg.includes('AbortError') ||
                             msg.includes('network') ||
                             msg.includes('connect') ||
                             msg.includes('timeout') ||
                             msg.includes('ECONN');
      if (!isNetworkError) throw error;
    }
  }

  throw new Error(`GRSai 网络请求失败（已重试${MAX_RETRIES}次）: ${lastError?.message || '未知错误'}。请检查网络连接或稍后重试`);
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
  const { prompt, firstFrameImage, lastFrameImage, referenceImages, aspectRatio = '16:9', duration = 5, seed, size, callbackUrl, providerOptions } = params;
  const baseUrl = 'https://openrouter.ai/api/v1';
  const model = config.model || 'alibaba/wan-2.6';

  const requestBody: any = { model, prompt: prompt || '' };
  if (duration) requestBody.duration = duration;
  if (size) {
    requestBody.size = size;
  } else {
    if (aspectRatio) requestBody.aspect_ratio = aspectRatio;
    if (params.resolution) requestBody.resolution = params.resolution;
  }
  if (seed !== undefined) requestBody.seed = seed;
  if (callbackUrl) requestBody.callback_url = callbackUrl;
  if (providerOptions) requestBody.provider = providerOptions;

  // 图片转视频：首帧/尾帧 → frame_images
  if (firstFrameImage) {
    const frameImages: any[] = [
      { type: 'image_url', image_url: { url: firstFrameImage }, frame_type: 'first_frame' }
    ];
    if (lastFrameImage) {
      frameImages.push({ type: 'image_url', image_url: { url: lastFrameImage }, frame_type: 'last_frame' });
    }
    requestBody.frame_images = frameImages;
  } else if (referenceImages?.length) {
    // 参考图转视频 → input_references
    requestBody.input_references = referenceImages.map((url) => ({
      type: 'image_url',
      image_url: { url }
    }));
  }

  const bodyStr = JSON.stringify(requestBody);
  console.log(`[Wan2.6] 提交请求 → POST ${baseUrl}/videos, model: ${model}`);

  // 提交任务（带超时和重试）
  const SUBMIT_TIMEOUT_MS = 120_000; // 2分钟超时
  const MAX_RETRIES = 2;
  let lastError: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = 2000 * attempt;
      console.log(`[Wan2.6] 第 ${attempt} 次重试提交，等待 ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

      const submitResponse = await fetch(`${baseUrl}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}`, 'HTTP-Referer': 'https://video-generator.app', 'X-Title': 'Video Generator' },
        body: bodyStr,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!submitResponse.ok) {
        const errText = await submitResponse.text();
        throw new Error(`Wan 2.6 提交失败: ${submitResponse.status} ${errText}`);
      }
      const submitResult = await submitResponse.json();
      if (submitResult.error) throw new Error(`Wan 2.6 错误: ${submitResult.error.message || JSON.stringify(submitResult.error)}`);
      const pollingUrl: string = submitResult.polling_url;
      if (!pollingUrl) throw new Error('Wan 2.6 返回缺少 polling_url');

      try {
        const videoUrl = await waitForWan26Video(pollingUrl, config.apiKey, 600000, onProgress);

        recordAICall({
          provider: 'openrouter',
          model,
          endpoint: `${baseUrl}/videos`,
          requestTime: Date.now() - startTime,
          status: 'success',
          taskId: submitResult.id,
          requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), aspectRatio, duration }),
          responseBody: sanitizeAICallBody({ videoUrl }),
        });

        return videoUrl;
      } catch (error: any) {
        recordAICall({
          provider: 'openrouter',
          model,
          endpoint: `${baseUrl}/videos`,
          requestTime: Date.now() - startTime,
          status: error.message?.includes('超时') ? 'timeout' : 'failed',
          errorMessage: error.message,
          taskId: submitResult.id,
          requestBody: sanitizeAICallBody({ model, prompt: params.prompt?.slice(0, 200), aspectRatio, duration }),
        });
        throw error;
      }
    } catch (error: any) {
      lastError = error;
      const msg = error?.message || '';
      console.error(`[Wan2.6] 第 ${attempt + 1} 次提交失败:`, msg);

      // 非网络错误（如 API 返回的业务错误）不重试
      const isNetworkError = msg.includes('fetch failed') ||
                             msg.includes('AbortError') ||
                             msg.includes('network') ||
                             msg.includes('connect') ||
                             msg.includes('timeout') ||
                             msg.includes('ECONN');
      if (!isNetworkError) throw error;
    }
  }

  console.error(`[Wan2.6] 提交失败，已重试 ${MAX_RETRIES} 次`);
  throw new Error(`Wan 2.6 网络请求失败（已重试${MAX_RETRIES}次）: ${lastError?.message || '未知错误'}。请检查网络连接或稍后重试`);
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
  const { prompt, firstFrameImage, lastFrameImage, referenceImages, aspectRatio = '16:9', duration, seed, size, callbackUrl, providerOptions } = params;
  const baseUrl = config.baseUrl || 'https://openrouter.ai/api/v1';
  const model = config.model || 'kwaivgi/kling-v3.0-std';
  
  // 构建符合 OpenRouter Video API 规范的请求体
  const requestBody: any = { model, prompt };
  
  // 图片转视频：首帧/尾帧 → frame_images
  if (firstFrameImage) {
    const frameImages: any[] = [
      { type: 'image_url', image_url: { url: firstFrameImage }, frame_type: 'first_frame' }
    ];
    if (lastFrameImage) {
      frameImages.push({ type: 'image_url', image_url: { url: lastFrameImage }, frame_type: 'last_frame' });
    }
    requestBody.frame_images = frameImages;
  } else if (referenceImages?.length) {
    // 参考图转视频 → input_references
    requestBody.input_references = referenceImages.map((url) => ({
      type: 'image_url',
      image_url: { url }
    }));
  }
  
  if (duration) requestBody.duration = duration;
  if (size) {
    requestBody.size = size;
  } else {
    if (aspectRatio) requestBody.aspect_ratio = aspectRatio;
    if (params.resolution) requestBody.resolution = params.resolution;
  }
  if (params.enableAudio !== undefined) requestBody.generate_audio = params.enableAudio;
  if (seed !== undefined) requestBody.seed = seed;
  if (callbackUrl) requestBody.callback_url = callbackUrl;
  if (providerOptions) requestBody.provider = providerOptions;

  const sanitizedBody = sanitizeAICallBody(requestBody);
  const bodyStr = JSON.stringify(requestBody);
  console.log(`[OpenRouter] 提交视频请求 → POST ${baseUrl}/videos, model: ${model}, body: ${JSON.stringify(sanitizedBody)}`);

  // 提交任务（带超时和重试）
  const SUBMIT_TIMEOUT_MS = 120_000;
  const MAX_RETRIES = 2;
  let lastError: any;
  let result: any;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = 2000 * attempt;
      console.log(`[OpenRouter] 第 ${attempt} 次重试提交，等待 ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

      const response = await fetch(`${baseUrl}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}`, 'HTTP-Referer': 'https://video-generator.app', 'X-Title': 'Video Generator' },
        body: bodyStr,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[OpenRouter] API 返回错误: ${response.status} ${errText}`);
        throw new Error(`OpenRouter 视频API请求失败: ${response.status} ${errText}`);
      }
      result = await response.json();
      console.log(`[OpenRouter] 提交响应: id=${result.id}, status=${result.status}, polling_url=${result.polling_url}`);
      if (result.error) throw new Error(`OpenRouter 错误: ${result.error.message || JSON.stringify(result.error)}`);
      break; // 成功，跳出重试循环
    } catch (error: any) {
      lastError = error;
      const msg = error?.message || '';
      console.error(`[OpenRouter] 第 ${attempt + 1} 次提交失败:`, msg);

      const isNetworkError = msg.includes('fetch failed') ||
                             msg.includes('AbortError') ||
                             msg.includes('network') ||
                             msg.includes('connect') ||
                             msg.includes('timeout') ||
                             msg.includes('ECONN');
      if (!isNetworkError) throw error;
    }
  }

  if (!result) {
    throw new Error(`OpenRouter 网络请求失败（已重试${MAX_RETRIES}次）: ${lastError?.message || '未知错误'}。请检查网络连接或稍后重试`);
  }
  
  // 使用 API 返回的 polling_url 进行轮询
  const pollingUrl: string = result.polling_url;
  const jobId: string = result.id;
  if (!pollingUrl) {
    recordAICall({
      provider: 'openrouter',
      model,
      endpoint: `${baseUrl}/videos`,
      requestTime: Date.now() - startTime,
      status: 'failed',
      errorMessage: 'OpenRouter 返回缺少 polling_url',
      requestBody: sanitizedBody,
    });
    throw new Error('OpenRouter 返回缺少 polling_url');
  }
  
  try {
    const videoUrl = await waitForOpenRouterVideo(pollingUrl, config.apiKey, undefined, onProgress);
    
    recordAICall({
      provider: 'openrouter',
      model,
      endpoint: `${baseUrl}/videos`,
      requestTime: Date.now() - startTime,
      status: 'success',
      taskId: jobId,
      requestBody: sanitizedBody,
      responseBody: sanitizeAICallBody({ videoUrl }),
    });
    
    return videoUrl;
  } catch (error: any) {
    recordAICall({
      provider: 'openrouter',
      model,
      endpoint: `${baseUrl}/videos`,
      requestTime: Date.now() - startTime,
      status: error.message?.includes('超时') ? 'timeout' : 'failed',
      errorMessage: error.message,
      taskId: jobId,
      requestBody: sanitizedBody,
    });
    throw error;
  }
}

async function waitForOpenRouterVideo(
  pollingUrl: string,
  apiKey: string,
  maxWaitTime = 600000,
  onProgress?: (status: string) => void
): Promise<string> {
  const startTime = Date.now();
  // 指数退避：初始 3s，每次增长 1.5x，上限 20s
  let intervalMs = 3000;
  const maxIntervalMs = 20000;
  const backoffFactor = 1.5;

  while (Date.now() - startTime < maxWaitTime) {
    const response = await fetch(pollingUrl, {
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
    console.log(`[OpenRouter] 轮询状态: ${result.status}`);
    
    // 视频生成完成，从 unsigned_urls 获取视频地址
    if (result.status === 'completed' && result.unsigned_urls?.length) {
      return result.unsigned_urls[0];
    }
    if (result.status === 'failed') {
      throw new Error(`OpenRouter 视频生成失败: ${result.error?.message || result.error || '未知错误'}`);
    }
    if (result.status === 'cancelled') {
      throw new Error('OpenRouter 视频生成任务已取消');
    }
    if (result.status === 'expired') {
      throw new Error('OpenRouter 视频生成任务已过期');
    }

    // 任务仍在进行，递增退避间隔
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    intervalMs = Math.min(intervalMs * backoffFactor, maxIntervalMs);
  }
  throw new Error('OpenRouter 视频生成超时（超过 10 分钟）');
}

// ========== 统一入口：根据 provider 自动路由 ==========

// Seedance 模型名映射：OpenRouter ID → 火山引擎模型名
const SEEDANCE_OR_TO_VOLC: Record<string, string> = {
  'bytedance/seedance-1.5-pro': 'doubao-seedance-1-5-pro-251215',
  'bytedance/seedance-1-5-pro': 'doubao-seedance-1-5-pro-251215',
  'bytedance/seedance-2.0': 'doubao-seedance-2-0-260128',
  'bytedance/seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
};

export async function generateVideo(
  params: VideoGenParams,
  config: ApiConfig,
  onProgress?: (progress: number | string) => void
): Promise<string> {
  const provider = (config.provider || '').toLowerCase();
  const model = (config.model || '').toLowerCase();
  
  console.log(`[generateVideo] provider=${provider}, model=${model}, prompt=${params.prompt?.substring(0, 50)}...`);
  
  // Seedance 模型必须直连火山引擎，禁止通过 OpenRouter 中转
  if (model.includes('seedance') && (provider === 'openrouter' || !provider)) {
    console.log(`[generateVideo] Seedance 模型自动路由到火山引擎: ${model}`);
    const volcModel = SEEDANCE_OR_TO_VOLC[config.model || ''] || 'doubao-seedance-1-5-pro-251215';
    const { createApiConfig } = await import('./apiClients.js');
    const volcConfig = createApiConfig('volcengine', volcModel);
    return generateVideoWithVolcEngine(params, volcConfig);
  }
  
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
