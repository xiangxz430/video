/**
 * 阿里云通义万相 (Qwen Wanx) 图片生成服务
 * 
 * API 端点: POST /api/v1/services/aigc/text2image/image-synthesis (提交)
 *           GET  /api/v1/tasks/{taskId} (查询)
 * 认证方式: Bearer Token (DashScope API Key)
 * 任务模式: 异步 (提交任务 → 轮询状态 → 获取结果)
 * 
 * 参考图片: 不支持
 * 
 * 响应取值: result.output.results[0].url
 * 
 * 注意: 当前 generateImage() 统一入口中未接入此提供商，
 *       函数保留供未来使用
 */
import type { ApiConfig } from '../../types/index.js';
import { recordAICall, sanitizeAICallBody } from '../logContext.js';

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
