/**
 * API 客户端模块
 * 
 * ⚠️ 已迁移到服务端
 * 所有 AI Provider 调用已迁移到 server/src/routes/ 目录下的服务端路由
 * 
 * 客户端请使用: src/services/serverApiClient.ts
 * 
 * 此文件保留以避免 import 错误，但所有功能已废弃
 */

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// 已废弃的函数
export function setIdealabIp(ip: string) {
  console.warn('setIdealabIp 已废弃，请使用服务端 API');
}

export function getIdealabIp(): string {
  console.warn('getIdealabIp 已废弃，请使用服务端 API');
  return '';
}

export function resolveIdealabIp(): Promise<string> {
  console.warn('resolveIdealabIp 已废弃，请使用服务端 API');
  return Promise.resolve('');
}

export async function callOpenAICompatible(config: any, messages: OpenAIMessage[]): Promise<string> {
  throw new Error('callOpenAICompatible 已废弃，请使用 serverApiClient');
}

export async function callAI(config: any, prompt: string): Promise<string> {
  throw new Error('callAI 已废弃，请使用 serverApiClient');
}

export async function callOpenAIStreaming(
  config: any,
  messages: OpenAIMessage[],
  onChunk: (chunk: string) => void
): Promise<string> {
  throw new Error('callOpenAIStreaming 已废弃，请使用 serverApiClient');
}
