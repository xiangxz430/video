/**
 * 视频生成模块
 * 
 * ⚠️ 已迁移到服务端
 * 所有视频生成功能已迁移到 server/src/routes/video.ts
 * 
 * 客户端请使用: src/services/serverApiClient.ts
 * - generateVideo()
 * 
 * 此文件保留以避免 import 错误，但所有功能已废弃
 */

export interface VideoGenParams {
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

export interface VideoGenResult {
  videoUrl: string;
  taskId?: string;
  provider?: string;
}

// 已废弃的函数
export async function generateVideo(params: VideoGenParams, config?: any, onProgress?: (data: any) => void): Promise<string> {
  throw new Error('generateVideo 已废弃，请使用 serverApiClient.generateVideo()');
}

export async function generateVideoWithVolcEngine(params: VideoGenParams, config: any): Promise<string> {
  throw new Error('generateVideoWithVolcEngine 已废弃，请使用 serverApiClient');
}

export async function generateVideoWithWan26(params: VideoGenParams, config: any): Promise<string> {
  throw new Error('generateVideoWithWan26 已废弃，请使用 serverApiClient');
}

export async function generateVideoWithOpenRouter(params: VideoGenParams, config: any): Promise<string> {
  throw new Error('generateVideoWithOpenRouter 已废弃，请使用 serverApiClient');
}

export async function generateVideoFromText(prompt: string, config: any): Promise<string> {
  throw new Error('generateVideoFromText 已废弃，请使用 serverApiClient');
}

export async function generateVideoFromImage(prompt: string, imageUrl: string, config: any): Promise<string> {
  throw new Error('generateVideoFromImage 已废弃，请使用 serverApiClient');
}

export async function generateVideoFromFirstLastFrame(prompt: string, firstFrame: string, lastFrame: string, config: any): Promise<string> {
  throw new Error('generateVideoFromFirstLastFrame 已废弃，请使用 serverApiClient');
}

export async function generateVideoFromReferenceImages(prompt: string, referenceImages: string[], config: any): Promise<string> {
  throw new Error('generateVideoFromReferenceImages 已废弃，请使用 serverApiClient');
}

export async function submitVolcVideoTask(config: any, prompt: string, imageUrl?: string): Promise<string> {
  throw new Error('submitVolcVideoTask 已废弃，请使用 serverApiClient');
}

export async function queryVolcVideoTask(config: any, taskId: string): Promise<any> {
  throw new Error('queryVolcVideoTask 已废弃，请使用 serverApiClient');
}

export async function waitForVolcVideo(config: any, taskId: string, onProgress?: (status: string) => void): Promise<string> {
  throw new Error('waitForVolcVideo 已废弃，请使用 serverApiClient');
}
