/**
 * AI 视频生成模块
 * 包含火山引擎、GRSai、Wan 2.6、OpenRouter 等视频生成功能
 */
import type { ApiConfig, VideoGenParams, VideoGenResult } from '../types/index.js';
export declare function submitVolcVideoTask(params: VideoGenParams, config: ApiConfig): Promise<VideoGenResult>;
export declare function queryVolcVideoTask(taskId: string, config: ApiConfig): Promise<{
    status: string;
    videoUrl?: string;
    duration?: number;
    ratio?: string;
    resolution?: string;
}>;
export declare function waitForVolcVideo(taskId: string, config: ApiConfig, maxRetries?: number, intervalMs?: number, onProgress?: (status: string, attempt: number) => void): Promise<string>;
export declare function generateVideoWithVolcEngine(params: VideoGenParams, config: ApiConfig): Promise<string>;
export declare function generateVideoWithGRSai(params: VideoGenParams, config: ApiConfig, onProgress?: (progress: number) => void): Promise<string>;
export declare function generateVideoWithWan26(params: VideoGenParams, config: ApiConfig, onProgress?: (status: string) => void): Promise<string>;
export declare function generateVideoWithOpenRouter(params: VideoGenParams, config: ApiConfig, onProgress?: (status: string) => void): Promise<string>;
export declare function generateVideo(params: VideoGenParams, config: ApiConfig, onProgress?: (progress: number | string) => void): Promise<string>;
export declare function generateVideoFromText(prompt: string, config: ApiConfig): Promise<string>;
export declare function generateVideoFromImage(prompt: string, firstFrameImage: string, config: ApiConfig): Promise<string>;
export declare function generateVideoFromFirstLastFrame(prompt: string, firstFrameImage: string, lastFrameImage: string, config: ApiConfig): Promise<string>;
export declare function generateVideoFromReferenceImages(prompt: string, referenceImages: string[], config: ApiConfig): Promise<string>;
export declare function generateVideoWithDashScope(params: VideoGenParams, config: ApiConfig, onProgress?: (status: string) => void): Promise<string>;
export declare function waitForDashScopeVideo(taskId: string, apiKey: string, baseUrl: string, maxWaitMs?: number, onProgress?: (status: string) => void): Promise<string>;
