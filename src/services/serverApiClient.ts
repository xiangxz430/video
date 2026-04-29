/**
 * 服务端 API 客户端
 * 封装所有对服务端的 HTTP 请求，替代原来直接调用 AI Provider
 */

// 使用全局 fetch（通过 WebView 网络栈，绕过 Tauri HTTP 插件的 scope 限制）
const httpFetch = globalThis.fetch.bind(globalThis);

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
  
  return {
    serverUrl: serverUrlConfig?.apiKey || 'http://localhost:3000',
    apiKey: serverApiKeyConfig?.apiKey || ''
  };
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

// 默认超时时间（5分钟，图片/视频生成耗时长）
const DEFAULT_TIMEOUT = 300_000;

// 基础请求封装
async function serverFetch(endpoint: string, body: any, options?: { timeout?: number }): Promise<any> {
  const { serverUrl, apiKey } = await getServerConfig();
  
  if (!serverUrl) {
    throw new Error('服务端地址未配置，请先在设置页面配置服务端');
  }
  
  const url = buildApiUrl(serverUrl, endpoint);
  const timeout = options?.timeout || DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await httpFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey ? `Bearer ${apiKey}` : ''
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `服务端错误: ${response.status}`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        if (errorText) errorMessage = errorText;
      }
      throw new Error(errorMessage);
    }
    
    return response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`请求超时（${timeout / 1000}秒），服务端处理时间过长`);
    }
    if (error.message?.includes('fetch')) {
      throw new Error(`无法连接到服务端: ${serverUrl}，请检查服务端是否运行`);
    }
    throw error;
  }
}

// SSE 流式请求封装（用于分镜生成和视频生成）
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  
  const response = await httpFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey ? `Bearer ${apiKey}` : ''
    },
    body: JSON.stringify(body),
    signal: controller.signal
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `服务端错误: ${response.status}`;
    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      if (errorText) errorMessage = errorText;
    }
    throw new Error(errorMessage);
  }
  
  // 读取 SSE 流
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | null = null;
  let serverError: string | null = null;
  
  if (!reader) {
    throw new Error('无法读取响应流');
  }
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      let currentEvent = '';
      for (const line of lines) {
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
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
    clearTimeout(timeoutId);
  }
  
  if (!result) {
    throw new Error(serverError || '服务端未返回完整结果');
  }
  
  return result;
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
    const response = await httpFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': apiKey ? `Bearer ${apiKey}` : ''
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `服务端错误: ${response.status}`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorData.message || errorMessage;
      } catch {
        if (errorText) errorMessage = errorText;
      }
      throw new Error(errorMessage);
    }
    
    const result = await response.json();
    return result.data;
  } catch (error: any) {
    if (error.message?.includes('fetch')) {
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
      // 使用调用方传入的值（用于 Settings 页面测试连接）
      serverUrl = serverUrlOverride;
      apiKey = apiKeyOverride || '';
    } else {
      const config = await getServerConfig();
      serverUrl = config.serverUrl;
      apiKey = config.apiKey;
    }
    
    if (!serverUrl) return { ok: false, error: '服务端地址未配置' };
    
    const response = await httpFetch(buildApiUrl(serverUrl, '/api/health'), {
      method: 'GET',
      headers: {
        'Authorization': apiKey ? `Bearer ${apiKey}` : ''
      }
    });
    
    if (!response.ok) {
      return { ok: false, error: `服务端返回状态码: ${response.status}` };
    }
    
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message || e?.toString() || '未知错误';
    return { ok: false, error: msg };
  }
}

// 获取当前服务端配置（用于 Settings 页面显示）
export async function getCurrentServerConfig(): Promise<{ serverUrl: string; apiKey: string }> {
  return getServerConfig();
}
