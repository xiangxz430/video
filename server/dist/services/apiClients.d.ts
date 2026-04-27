/**
 * AI API 客户端模块
 * 包含所有 AI 服务的底层 API 调用逻辑
 */
import type { ApiConfig, OpenAIMessage } from '../types/index.js';
interface ProviderConfig {
    name: string;
    provider: string;
    apiKey: string;
    model: string;
    baseUrl: string;
}
export declare const SCRIPT_PROVIDERS: ProviderConfig[];
export declare function generateVolcSignature(accessKey: string, secretKey: string, method: string, path: string, query: string, body: string): Promise<string>;
export declare function callIdealab(config: ApiConfig, messages: OpenAIMessage[]): Promise<string>;
export declare function callOpenAICompatible(config: ApiConfig, messages: OpenAIMessage[], retryCount?: number): Promise<string>;
export declare function callAI(config: ApiConfig, messages: any[]): Promise<string>;
export declare function callOpenAIStreaming(config: ApiConfig, messages: OpenAIMessage[], onChunk: (chunk: string) => void, retryCount?: number): Promise<string>;
export declare function createApiConfig(provider: string, model?: string): ApiConfig;
export {};
