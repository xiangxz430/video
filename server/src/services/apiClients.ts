/**
 * AI API 客户端模块
 * 包含所有 AI 服务的底层 API 调用逻辑
 */
import type { ApiConfig, OpenAIMessage } from '../types/index.js';
import { getProviderConfig } from '../config/index.js';

// ========== 多 Provider 自动切换配置 ==========

interface ProviderConfig {
  name: string;
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

// 脚本生成 Provider 优先级列表（按优先级排序）
export const SCRIPT_PROVIDERS: ProviderConfig[] = [
  {
    name: 'IdeaLab',
    provider: 'idealab',
    apiKey: '',
    model: 'qwen_max',
    baseUrl: ''
  },
  {
    name: 'DeepSeek',
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-v4-pro',
    baseUrl: ''
  },
  {
    name: '火山方舟',
    provider: 'volcengine',
    apiKey: '',
    model: 'doubao-1-5-pro-32k-250115',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
  }
];

// ========== 火山引擎签名 ==========

export async function generateVolcSignature(
  accessKey: string,
  secretKey: string,
  method: string,
  path: string,
  query: string,
  body: string
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = Math.random().toString(36).substring(2, 10);
  
  const decodedSecret = Uint8Array.from(atob(secretKey), c => c.charCodeAt(0));
  const bodyBytes = new TextEncoder().encode(body);
  const signedStr = `${timestamp}\n${nonce}\n${method}\n${path}\n${query}\n${bodyBytes.byteLength}\n`;
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    decodedSecret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(signedStr));
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  return `HMAC-SHA256 AccessKey=${accessKey}, Signature=${sigBase64}, Timestamp=${timestamp}, Nonce=${nonce}`;
}

// ========== 通义千问 - 文本生成 ==========

interface QwenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callQwen(config: ApiConfig, messages: QwenMessage[]): Promise<string> {
  const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model || 'qwen-max',
      messages,
      stream: false
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API请求失败 (${response.status}): ${errText}`);
  }
  
  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

// ========== IdeaLab 专用调用 ==========

export async function callIdealab(
  config: ApiConfig,
  messages: OpenAIMessage[]
): Promise<string> {
  const baseUrl = config.baseUrl || 'https://idealab.alibaba-inc.com/api/openai/v1';
  
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  
  const model = config.model || 'qwen_max';
  
  console.log('IdeaLab calling:', baseUrl);
  
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      stream: false
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    let errorMsg = `IdeaLab API请求失败 (${response.status}): ${errText}`;
    try {
      const errData = JSON.parse(errText) as any;
      if (errData.error?.message) {
        errorMsg = `IdeaLab API错误: ${errData.error.message}`;
      }
    } catch {}
    throw new Error(errorMsg);
  }
  
  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

// ========== DeepSeek / OpenAI 兼容 API ==========

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
    type: string;
  };
}

export async function callOpenAICompatible(
  config: ApiConfig,
  messages: OpenAIMessage[],
  retryCount: number = 2
): Promise<string> {
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new Error(`${config.provider || 'API'} API 密钥未配置`);
  }
  
  if (config.provider === 'idealab') {
    return callIdealab(config, messages);
  }
  
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      const delayMs = 1000 * attempt;
      console.log(`[callOpenAICompatible] 第 ${attempt} 次重试，等待 ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    try {
      return await callOpenAICompatibleOnce(config, messages);
    } catch (error: any) {
      lastError = error;
      const isNetworkError = error.message?.includes('error sending request') || 
                             error.message?.includes('network') ||
                             error.message?.includes('connect') ||
                             error.message?.includes('timeout');
      
      if (!isNetworkError) {
        throw error;
      }
      
      console.warn(`[callOpenAICompatible] 网络错误 (尝试 ${attempt + 1}/${retryCount + 1}):`, error.message);
    }
  }
  
  throw lastError || new Error(`${config.provider || 'API'} 调用失败`);
}

async function callOpenAICompatibleOnce(
  config: ApiConfig,
  messages: OpenAIMessage[]
): Promise<string> {
  
  let baseUrl = config.baseUrl;
  
  if (!baseUrl) {
    switch (config.provider) {
      case 'deepseek':
        baseUrl = 'https://api.deepseek.com/v1';
        break;
      case 'volcengine':
        baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
        break;
      case 'openai':
        baseUrl = 'https://api.openai.com/v1';
        break;
      case 'anthropic':
        baseUrl = 'https://api.anthropic.com/v1';
        break;
      case 'tokenplan':
        baseUrl = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
        break;
      default:
        baseUrl = 'https://api.deepseek.com/v1';
    }
  }
  
  const model = config.model || 'deepseek-v4-pro';
  
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000);
  
  try {
    console.log(`\n========== AI 调用开始 ==========`);
    console.log(`🤖 模型: ${config.provider}/${model}`);
    console.log(`🌐 API地址: ${baseUrl}/chat/completions`);
    console.log(`📝 消息数量: ${messages.length}`);
    
    const requestBody = {
      model,
      messages,
      stream: false
    };
    
    console.log(`📦 请求体大小: ${JSON.stringify(requestBody).length} 字节`);
    console.log(`\n⏳ 等待 AI 响应...\n`);
    
    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    const responseTime = Date.now() - startTime;
    clearTimeout(timeoutId);
    
    console.log(`📥 AI 响应 received!`);
    console.log(`⏱️  响应时间: ${responseTime}ms (${(responseTime / 1000).toFixed(1)}秒)`);
    console.log(` 响应状态: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errText = await response.text();
      console.error(`❌ 错误响应:`, errText);
      let errorMsg = `API请求失败 (${response.status}): ${errText}`;
      try {
        const errData = JSON.parse(errText) as OpenAIResponse;
        if (errData.error?.message) {
          errorMsg = `API错误: ${errData.error.message}`;
        }
      } catch {}
      throw new Error(errorMsg);
    }
    
    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    
    console.log(`\n📊 响应数据:`);
    console.log(`  总 token 数: ${data.usage?.total_tokens || 'N/A'}`);
    console.log(`  输入 token: ${data.usage?.prompt_tokens || 'N/A'}`);
    console.log(`  输出 token: ${data.usage?.completion_tokens || 'N/A'}`);
    console.log(`  返回内容长度: ${content.length} 字符`);
    console.log(`\n========== AI 调用完成 ==========\n`);
    
    return content;
  } catch (error: any) {
    clearTimeout(timeoutId);
    console.error('\n❌ AI 调用失败:', error);
    if (error.name === 'AbortError') {
      throw new Error(`${config.provider || 'API'} 请求超时（300秒）`);
    }
    const errorMessage = error?.message || error?.toString() || '未知错误';
    throw new Error(`${config.provider || 'API'} 调用失败: ${errorMessage}`);
  }
}

export async function callAI(config: ApiConfig, messages: any[]): Promise<string> {
  switch (config.provider) {
    case 'deepseek':
    case 'openai':
    case 'anthropic':
    case 'custom':
    case 'volcengine':
    case 'idealab':
    case 'tokenplan':
      return callOpenAICompatible(config, messages);
    case 'dashscope':
    default:
      return callQwen(config, messages);
  }
}

// ========== 流式调用支持 ==========

export async function callOpenAIStreaming(
  config: ApiConfig,
  messages: OpenAIMessage[],
  onChunk: (chunk: string) => void,
  retryCount: number = 2
): Promise<string> {
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new Error(`${config.provider || 'API'} API 密钥未配置`);
  }
  
  if (config.provider === 'idealab') {
    console.warn('[callOpenAIStreaming] IdeaLab 不支持流式，使用普通调用');
    return callOpenAICompatible(config, messages);
  }
  
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    if (attempt > 0) {
      const delayMs = 1000 * attempt;
      console.log(`[callOpenAIStreaming] 第 ${attempt} 次重试，等待 ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    try {
      return await callOpenAIStreamingOnce(config, messages, onChunk);
    } catch (error: any) {
      lastError = error;
      const isNetworkError = error.message?.includes('error sending request') || 
                             error.message?.includes('network') ||
                             error.message?.includes('connect') ||
                             error.message?.includes('timeout');
      
      if (!isNetworkError) {
        throw error;
      }
      
      console.warn(`[callOpenAIStreaming] 网络错误 (尝试 ${attempt + 1}/${retryCount + 1}):`, error.message);
    }
  }
  
  throw lastError || new Error(`${config.provider || 'API'} 调用失败`);
}

async function callOpenAIStreamingOnce(
  config: ApiConfig,
  messages: OpenAIMessage[],
  onChunk: (chunk: string) => void
): Promise<string> {
  let baseUrl = config.baseUrl;
  
  if (!baseUrl) {
    switch (config.provider) {
      case 'deepseek':
        baseUrl = 'https://api.deepseek.com/v1';
        break;
      case 'volcengine':
        baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
        break;
      case 'openai':
        baseUrl = 'https://api.openai.com/v1';
        break;
      case 'anthropic':
        baseUrl = 'https://api.anthropic.com/v1';
        break;
      case 'tokenplan':
        baseUrl = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
        break;
      default:
        baseUrl = 'https://api.deepseek.com/v1';
    }
  }
  
  const model = config.model || 'deepseek-v4-pro';
  
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream'
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000);
  
  try {
    console.log(`\n========== AI 流式调用开始 ==========`);
    console.log(`🤖 模型: ${config.provider}/${model}`);
    console.log(`🌐 API地址: ${baseUrl}/chat/completions`);
    
    const requestBody = {
      model,
      messages,
      stream: true
    };
    
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    
    if (!response.ok) {
      clearTimeout(timeoutId);
      const errText = await response.text();
      throw new Error(`API请求失败 (${response.status}): ${errText}`);
    }
    
    console.log(`📥 开始接收流式响应...`);
    
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }
    
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    let chunkCount = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (!trimmedLine || trimmedLine.startsWith(':')) {
          continue;
        }
        
        if (trimmedLine.startsWith('data: ')) {
          const dataStr = trimmedLine.slice(6);
          
          if (dataStr === '[DONE]') {
            console.log(`\n🏁 流式响应完成`);
            continue;
          }
          
          try {
            const data = JSON.parse(dataStr);
            const content = data.choices?.[0]?.delta?.content || '';
            
            if (content) {
              fullContent += content;
              chunkCount++;
              onChunk(content);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }
    
    clearTimeout(timeoutId);
    
    console.log(`📊 接收 chunk 数: ${chunkCount}`);
    console.log(`📝 返回内容长度: ${fullContent.length} 字符`);
    console.log(`\n========== AI 流式调用完成 ==========\n`);
    
    return fullContent;
  } catch (error: any) {
    clearTimeout(timeoutId);
    console.error('\n❌ AI 流式调用失败:', error);
    if (error.name === 'AbortError') {
      throw new Error(`${config.provider || 'API'} 请求超时（300秒）`);
    }
    const errorMessage = error?.message || error?.toString() || '未知错误';
    throw new Error(`${config.provider || 'API'} 调用失败: ${errorMessage}`);
  }
}

// ========== 辅助函数：根据 provider 和 model 创建 ApiConfig ==========

export function createApiConfig(provider: string, model?: string): ApiConfig {
  const providerConfig = getProviderConfig(provider);
  
  const defaultModels: Record<string, string> = {
    deepseek: 'deepseek-v4-pro',
    volcengine: 'doubao-1-5-pro-32k-250115',
    grsai: 'nano-banana-fast',
    openrouter: 'black-forest-labs/flux.2-pro',
    idealab: 'qwen_max',
    qwen: 'qwen-max',
    tokenplan: 'qwen3.6-plus'
  };
  
  return {
    name: `${provider}_generation`,
    provider,
    apiKey: providerConfig.apiKey,
    model: model || defaultModels[provider] || '',
    baseUrl: providerConfig.baseUrl
  };
}
