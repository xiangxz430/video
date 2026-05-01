/**
 * 服务端 API 客户端
 * 封装所有对服务端的 HTTP 请求，替代原来直接调用 AI Provider
 *
 * 使用 Tauri Shell 插件调用 curl 子进程发送 HTTP 请求。
 * curl 作为独立进程运行，不受 macOS 应用内网络限制影响。
 */

import { Command } from '@tauri-apps/plugin-shell';

/**
 * 使用 curl 子进程发送 HTTP 请求。
 * curl 在独立进程中运行，不受 macOS 应用内网络限制影响。
 * -s 静默模式，-w '\n%{http_code}' 在响应体后输出 HTTP 状态码方便解析。
 */
async function curlFetch(url: string, method: string, headers: Record<string, string>, body?: string): Promise<{ status: number; body: string }> {
  const args: string[] = ['-s', '-w', '\n%{http_code}'];

  if (method !== 'GET') {
    args.push('-X', method);
  }

  for (const [key, value] of Object.entries(headers)) {
    if (value) args.push('-H', `${key}: ${value}`);
  }

  if (body) {
    args.push('-d', body);
  }

  args.push('--max-time', '300');
  args.push(url);

  console.log('[curlFetch]', method, url);

  const result = await Command.create('curl', args).execute();

  if (result.code !== 0) {
    throw new Error(`curl 失败 (exit ${result.code}): ${result.stderr}`);
  }

  // 解析输出：最后一行是状态码（-w 输出），前面是响应体
  const output = result.stdout.trimEnd();
  const lines = output.split('\n');
  const statusCode = parseInt(lines.pop() || '0', 10);
  const responseBody = lines.join('\n');

  return { status: statusCode, body: responseBody };
}

// 清理 URL 末尾的斜杠和空白，避免双斜杠导致 404
function cleanUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

// 构建请求 URL，防止双斜杠
function buildApiUrl(serverUrl: string, endpoint: string): string {
  const base = cleanUrl(serverUrl);
  const url = `${base}${endpoint}`;
  // 将路径中的连续斜杠替换为单斜杠（保留 :// 协议部分）
  return url.replace(/([^:\/])\/+/g, '$1/');
}
import { getApiConfig, updateApiConfig } from './database';

// 服务端配置类型
interface ServerConfig {
  serverUrl: string;
  apiKey: string;
}

// 从数据库读取服务端配置
async function getServerConfig(): Promise<ServerConfig> {
  const serverUrlConfig = await getApiConfig('server_url');
  const serverApiKeyConfig = await getApiConfig('server_api_key');
  
  const serverUrl = serverUrlConfig?.apiKey || '';
  const apiKey = serverApiKeyConfig?.apiKey || '';
  
  console.log('[getServerConfig] serverUrlConfig:', JSON.stringify(serverUrlConfig));
  console.log('[getServerConfig] 最终使用 serverUrl:', serverUrl || '(未配置)');
  
  if (!serverUrl) {
    throw new Error('服务端地址未配置，请先在设置页面配置服务端地址');
  }
  
  return { serverUrl, apiKey };
}

// 保存服务端配置到数据库
export async function saveServerConfig(serverUrl: string, apiKey: string): Promise<void> {
  await Promise.all([
    updateApiConfig('server_url', {
      name: 'server_url',
      provider: 'server',
      apiKey: serverUrl,
      model: 'default'
    }),
    updateApiConfig('server_api_key', {
      name: 'server_api_key',
      provider: 'server',
      apiKey: apiKey,
      model: 'default'
    })
  ]);
}

// 默认超时时间（curl --max-time 已设置 300s）
const DEFAULT_TIMEOUT = 300_000;

// 基础请求封装（使用 curl 子进程）
async function serverFetch(endpoint: string, body: any, options?: { timeout?: number }): Promise<any> {
  const { serverUrl, apiKey } = await getServerConfig();
  
  if (!serverUrl) {
    throw new Error('服务端地址未配置，请先在设置页面配置服务端');
  }
  
  const url = buildApiUrl(serverUrl, endpoint);
  
  try {
    const response = await curlFetch(url, 'POST', {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
    }, JSON.stringify(body));
    
    if (response.status < 200 || response.status >= 300) {
      let errorMessage = `服务端错误: ${response.status}`;
      try {
        const errorData = JSON.parse(response.body);
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        if (response.body) errorMessage = response.body;
      }
      throw new Error(errorMessage);
    }
    
    return JSON.parse(response.body);
  } catch (error: any) {
    const msg = error?.message || '';
    console.error('[serverFetch] 请求失败:', url, '错误:', msg, '类型:', error?.constructor?.name);
    if (msg.includes('curl 失败') || msg.includes('无法连接')) {
      throw new Error(`无法连接到服务端，请检查: 1) 服务端 ${serverUrl} 是否运行; 2) 网络是否正常`);
    }
    throw error;
  }
}

// SSE 事件解析逻辑（复用）
function createSSEProcessor<T>(callbacks: {
  onProgress?: (data: any) => void;
  onContent?: (chunk: string) => void;
  onError?: (error: string) => void;
}) {
  let currentEvent = '';
  let result: T | null = null;
  let serverError: string | null = null;

  function processLine(line: string) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      const dataStr = line.slice(6);
      try {
        const data = JSON.parse(dataStr);
        switch (currentEvent) {
          case 'progress':
            callbacks.onProgress?.(data);
            break;
          case 'content':
            callbacks.onContent?.(data.chunk || data.content || '');
            break;
          case 'done':
            result = data;
            break;
          case 'error': {
            const msg = data.message || data.error || '未知错误';
            callbacks.onError?.(msg);
            serverError = msg;
            break;
          }
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  return { processLine, getResult: () => result, getError: () => serverError };
}

// 使用 curl 子进程实现 SSE 流式读取（-N 不缓冲，实时输出 SSE 数据）
async function curlSSE<T>(
  url: string,
  body: any,
  apiKey: string,
  callbacks: {
    onProgress?: (data: any) => void;
    onContent?: (chunk: string) => void;
    onError?: (error: string) => void;
  },
  _timeoutMs: number = DEFAULT_TIMEOUT
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const args: string[] = ['-s', '-N', '-X', 'POST'];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
    };

    for (const [key, value] of Object.entries(headers)) {
      if (value) args.push('-H', `${key}: ${value}`);
    }

    args.push('-d', JSON.stringify(body));
    args.push('--max-time', '300');
    args.push(url);

    console.log('[curlSSE] POST', url);

    const cmd = Command.create('curl', args);
    const { processLine, getResult, getError } = createSSEProcessor<T>(callbacks);
    let buffer = '';
    let streamError: string | null = null;
    let settled = false;

    // 监听 curl stdout 输出（-N 不缓冲，实时输出 SSE 数据）
    cmd.stdout.on('data', (data: string) => {
      buffer += data;
      const lines = buffer.split('\n');
      // 保留最后一个可能不完整的行
      buffer = lines.pop() || '';
      for (const line of lines) {
        processLine(line);
      }
    });

    cmd.stderr.on('data', (data: string) => {
      console.error('[curlSSE] stderr:', data);
    });

    cmd.on('close', (data: { code: number }) => {
      if (settled) return;

      // 处理剩余缓冲
      if (buffer.trim()) {
        const remainingLines = buffer.split('\n');
        for (const line of remainingLines) {
          processLine(line);
        }
      }

      const result = getResult();
      const error = getError() || streamError;

      if (data.code !== 0 && !result) {
        settled = true;
        reject(new Error(`curl 进程异常退出: code ${data.code}`));
        return;
      }

      if (error) {
        settled = true;
        reject(new Error(error));
      } else if (result) {
        settled = true;
        resolve(result);
      } else {
        settled = true;
        reject(new Error('服务端未返回完整结果'));
      }
    });

    cmd.on('error', (error: string) => {
      if (settled) return;
      settled = true;
      streamError = error;
      reject(new Error(`curl 错误: ${error}`));
    });

    cmd.spawn().catch((err) => {
      if (settled) return;
      settled = true;
      reject(new Error(`curl 启动失败: ${err}`));
    });
  });
}

// SSE 流式请求封装（使用 curl 子进程）
async function serverSSE<T>(
  endpoint: string,
  body: any,
  callbacks: {
    onProgress?: (data: any) => void;
    onContent?: (chunk: string) => void;
    onError?: (error: string) => void;
  }
): Promise<T> {
  const { serverUrl, apiKey } = await getServerConfig();

  if (!serverUrl) {
    throw new Error('服务端地址未配置，请先在设置页面配置服务端');
  }

  const url = buildApiUrl(serverUrl, endpoint);
  return curlSSE<T>(url, body, apiKey, callbacks, DEFAULT_TIMEOUT);
}

// ========== 脚本相关 API ==========

export interface SplitScriptResult {
  characters: any[];
  scenes: any[];
  episodes: any[];
}

export async function splitScript(params: {
  script: string;
  episodeCount?: number;
  provider?: string;
  model?: string;
}): Promise<SplitScriptResult> {
  return serverFetch('/api/script/split', params);
}

export async function splitScriptStream(
  params: {
    script: string;
    episodeCount?: number;
    provider?: string;
    model?: string;
  },
  callbacks: {
    onProgress?: (data: any) => void;
    onContent?: (chunk: string) => void;
  }
): Promise<SplitScriptResult> {
  return serverSSE<SplitScriptResult>('/api/script/split', params, {
    onProgress: callbacks.onProgress,
    onContent: callbacks.onContent
  });
}

export interface GenerateScriptResult {
  content: string;
  provider: string;
}

export async function generateScript(
  prompt: string,
  provider?: string,
  model?: string
): Promise<GenerateScriptResult> {
  return serverFetch('/api/script/generate', { prompt, provider, model });
}

// ========== 分镜相关 API ==========

export interface StoryboardOptions {
  shotCount?: number;
  durationPerShot?: number;
}

export interface GenerateStoryboardParams {
  episodeContent: string;
  characters: any[];
  scenes: any[];
  options?: StoryboardOptions;
  provider?: string;
  model?: string;
}

export async function generateStoryboard(
  params: GenerateStoryboardParams,
  onProgress?: (data: any) => void,
  onContent?: (chunk: string) => void
): Promise<any> {
  return serverSSE('/api/storyboard/generate', params, {
    onProgress,
    onContent
  });
}

// ========== 图片生成相关 API ==========

export interface GenerateImageParams {
  prompt: string;
  provider?: string;
  model?: string;
  referenceImage?: string | string[];
  /** 参考图元数据（仅用于日志，不参与 AI 调用） */
  referenceImageMeta?: { fileName: string; filePath: string }[];
  aspectRatio?: string;
  style?: string;
  size?: string;
}

export async function generateImage(params: GenerateImageParams): Promise<string> {
  const result = await serverFetch('/api/image/generate', params);
  return result.imageUrl;
}

export async function generateCharacterImage(
  description: string,
  referenceMode?: boolean,
  provider?: string,
  model?: string
): Promise<string> {
  const result = await serverFetch('/api/image/character', {
    description,
    referenceMode,
    provider,
    model
  });
  return result.imageUrl;
}

export async function generateSceneImage(
  description: string,
  referenceMode?: boolean,
  provider?: string,
  model?: string
): Promise<string> {
  const result = await serverFetch('/api/image/scene', {
    description,
    referenceMode,
    provider,
    model
  });
  return result.imageUrl;
}

// ========== 视频生成相关 API ==========

export interface GenerateVideoParams {
  prompt: string;
  provider?: string;
  model?: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  referenceImages?: string[];
  aspectRatio?: string;
  duration?: number;
  enableAudio?: boolean;
  seed?: number;                          // 确定性生成种子
  size?: string;                          // 精确像素尺寸 "WIDTHxHEIGHT"
  callbackUrl?: string;                   // Webhook 回调 URL
  providerOptions?: Record<string, any>;  // Provider 特定透传参数
}

export async function generateVideo(
  params: GenerateVideoParams,
  onProgress?: (data: any) => void
): Promise<string> {
  const result = await serverSSE<{ videoUrl: string }>('/api/video/generate', params, { onProgress });
  return result?.videoUrl || '';
}

// ========== 健康检查 ==========

/**
 * 获取当前 API Key 的调用统计
 */
export async function getApiUsageStats(): Promise<{
  apiKey: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  successRate: string;
  totalCost: number;
  lastUsedAt: string | null;
  byFunction: Record<string, { total: number; success: number; failed: number }>;
  byProvider: Record<string, { total: number; success: number; failed: number }>;
  byModel: Record<string, {
    provider: string;
    model: string;
    displayProvider: string;
    displayModel: string;
    total: number;
    success: number;
    failed: number;
    estimatedCost: number;
  }>;
}> {
  const { serverUrl, apiKey } = await getServerConfig();
  
  if (!serverUrl) {
    throw new Error('服务端地址未配置');
  }
  
  const url = buildApiUrl(serverUrl, '/api/stats/usage');
  
  try {
    const response = await curlFetch(url, 'GET', {
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
    });
    
    if (response.status < 200 || response.status >= 300) {
      let errorMessage = `服务端错误: ${response.status}`;
      try {
        const errorData = JSON.parse(response.body);
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        if (response.body) errorMessage = response.body;
      }
      throw new Error(errorMessage);
    }
    
    const result = JSON.parse(response.body);
    return result.data;
  } catch (error: any) {
    if (error.message?.includes('curl 失败') || error.message?.includes('curl 错误')) {
      throw new Error(`无法连接到服务端: ${serverUrl}`);
    }
    throw error;
  }
}

export async function checkHealth(serverUrlOverride?: string, apiKeyOverride?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    let serverUrl: string;
    let apiKey: string;
    
    if (serverUrlOverride) {
      serverUrl = serverUrlOverride;
      apiKey = apiKeyOverride || '';
    } else {
      const config = await getServerConfig();
      serverUrl = config.serverUrl;
      apiKey = config.apiKey;
    }
    
    if (!serverUrl) return { ok: false, error: '服务端地址未配置' };
    
    const url = buildApiUrl(serverUrl, '/api/health');
    console.log('[checkHealth] 请求URL:', url);
    
    try {
      const response = await curlFetch(url, 'GET', {
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
      });
      
      console.log('[checkHealth] curlFetch 响应状态:', response.status);
      
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, error: `服务端返回状态码: ${response.status}` };
      }
      
      const data = JSON.parse(response.body);
      console.log('[checkHealth] 响应数据:', JSON.stringify(data));
      return { ok: true };
    } catch (fetchError: any) {
      const fetchMsg = fetchError?.message || fetchError?.toString() || '未知错误';
      console.error('[checkHealth] curlFetch 异常:', fetchMsg);
      return { ok: false, error: fetchMsg };
    }
  } catch (e: any) {
    const msg = e?.message || e?.toString() || '未知错误';
    console.error('[checkHealth] 外层异常:', e);
    return { ok: false, error: msg };
  }
}

// 获取当前服务端配置（用于 Settings 页面显示）
export async function getCurrentServerConfig(): Promise<{ serverUrl: string; apiKey: string }> {
  return getServerConfig();
}
