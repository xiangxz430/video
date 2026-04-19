/**
 * 统一错误处理工具
 * 提供一致的错误格式化和用户友好的错误消息
 */

/**
 * AI 错误类型
 */
export class AIError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: string,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'AIError';
  }
}

/**
 * 视频生成错误
 */
export class VideoGenError extends AIError {
  constructor(message: string, provider: string, isRetryable: boolean = true) {
    super(message, provider, 'VIDEO_GEN_ERROR', isRetryable);
    this.name = 'VideoGenError';
  }
}

/**
 * 图片生成错误
 */
export class ImageGenError extends AIError {
  constructor(message: string, provider: string, isRetryable: boolean = true) {
    super(message, provider, 'IMAGE_GEN_ERROR', isRetryable);
    this.name = 'ImageGenError';
  }
}

/**
 * 剧本生成错误
 */
export class ScriptGenError extends AIError {
  constructor(message: string, provider: string, isRetryable: boolean = true) {
    super(message, provider, 'SCRIPT_GEN_ERROR', isRetryable);
    this.name = 'ScriptGenError';
  }
}

/**
 * 将任意错误规范化为 AIError
 */
export function normalizeError(error: unknown, provider: string = 'unknown'): AIError {
  if (error instanceof AIError) return error;
  
  const message = error instanceof Error ? error.message : String(error);
  const isRetryable = isRetryableError(error);
  
  return new AIError(message, provider, 'UNKNOWN_ERROR', isRetryable);
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AIError) return error.isRetryable;
  
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  
  // 网络错误、超时、临时故障可重试
  const retryablePatterns = [
    'timeout', 'timed out', '超时',
    'network', 'econnrefused', 'eaddrinuse', '网络',
    '503', '502', '429', 'rate limit',
    'temporarily', 'unavailable', '暂时',
  ];
  
  // 明确不可重试的错误
  const nonRetryablePatterns = [
    'api key', 'api_key', '未配置', 'not configured',
    '401', '403', 'invalid', '格式错误',
    'auth', 'unauthorized', '权限',
  ];
  
  for (const pattern of nonRetryablePatterns) {
    if (lowerMessage.includes(pattern)) return false;
  }
  
  for (const pattern of retryablePatterns) {
    if (lowerMessage.includes(pattern)) return true;
  }
  
  return false;
}

/**
 * 格式化错误为用户友好的消息
 */
export function formatErrorForUser(error: unknown): string {
  if (error instanceof AIError) return error.message;
  
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  
  // API Key 相关
  if (lowerMessage.includes('api key') || lowerMessage.includes('api_key') || lowerMessage.includes('未配置')) {
    return 'API Key 未配置或无效，请在设置页面配置 API Key';
  }
  
  // 认证错误
  if (lowerMessage.includes('401') || lowerMessage.includes('403') || lowerMessage.includes('auth') || lowerMessage.includes('unauthorized')) {
    return 'API 认证失败，请检查 API Key 是否正确';
  }
  
  // 超时
  if (lowerMessage.includes('timeout') || lowerMessage.includes('超时')) {
    return '请求超时，请检查网络连接后重试';
  }
  
  // 速率限制
  if (lowerMessage.includes('429') || lowerMessage.includes('rate limit')) {
    return '请求过于频繁，请稍后重试';
  }
  
  // 服务不可用
  if (lowerMessage.includes('503') || lowerMessage.includes('unavailable')) {
    return '服务暂时不可用，请稍后重试';
  }
  
  // 火山引擎特定
  if (lowerMessage.includes('volc') || lowerMessage.includes('火山')) {
    return message.includes('请输入') 
      ? message 
      : `火山引擎错误：${message}`;
  }
  
  // GRSai 特定
  if (lowerMessage.includes('grsai')) {
    return `GRSai 错误：${message}`;
  }
  
  // OpenRouter 特定
  if (lowerMessage.includes('openrouter')) {
    return `OpenRouter 错误：${message}`;
  }
  
  // 默认返回原始消息（去掉技术细节前缀）
  const cleaned = message
    .replace(/^API请求失败.*?:\s*/, '')
    .replace(/^HTTP \d+: /, '')
    .trim();
  
  return cleaned || '发生了未知错误，请重试';
}

/**
 * 带统一错误处理的异步包装器
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  options: {
    provider?: string;
    errorType?: 'video' | 'image' | 'script';
    fallbackValue?: T;
    onError?: (error: AIError) => void;
  } = {}
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    const normalized = normalizeError(error, options.provider);
    
    if (options.onError) {
      options.onError(normalized);
    } else {
      console.error(`[${options.provider || 'AI'}] 错误:`, normalized.message);
    }
    
    return options.fallbackValue;
  }
}
