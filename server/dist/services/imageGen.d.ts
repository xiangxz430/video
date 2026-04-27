/**
 * AI 图片生成模块
 * 包含通义万相、火山方舟 Seedream、OpenRouter、Grsai 等图片生成功能
 */
import type { ApiConfig, ImageGenParams } from '../types/index.js';
export declare function submitWanxTask(config: ApiConfig, prompt: string): Promise<string>;
export declare function waitForWanxTask(config: ApiConfig, taskId: string, maxRetries?: number): Promise<string>;
export declare function generateImageWithVolcEngine(params: ImageGenParams, config: ApiConfig): Promise<string>;
export declare function generateImageWithOpenRouter(params: ImageGenParams, config: ApiConfig): Promise<string>;
interface GrsaiImageParams {
    prompt: string;
    model?: string;
    size?: string;
    aspectRatio?: string;
    referenceImage?: string | string[];
    useStream?: boolean;
    onProgress?: (progress: number) => void;
}
export declare function generateImageWithGrsai(params: GrsaiImageParams, apiKey: string, baseUrl?: string): Promise<string>;
export declare function getGrsaiResult(taskId: string, apiKey: string, baseUrl?: string): Promise<{
    status: string;
    url?: string;
    content?: string;
    progress?: number;
    failureReason?: string;
    error?: string;
}>;
export declare function generateImage(params: ImageGenParams, config: ApiConfig): Promise<string>;
export {};
