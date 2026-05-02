/**
 * 图片生成模块
 * 
 * ⚠️ 已迁移到服务端
 * 所有图片生成功能已迁移到 server/src/routes/image.ts
 * 
 * 客户端请使用: src/services/serverApiClient.ts
 * - generateImage()
 * - generateCharacterImage()
 * - generateSceneImage()
 * 
 * 此文件保留以避免 import 错误，但所有功能已废弃
 */

export interface ImageGenParams {
  prompt: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  referenceImages?: string[];
  referenceImageMeta?: { fileName: string; filePath: string }[];
  provider?: string;
  style?: string;
}

// 已废弃的函数
export async function generateImage(params: ImageGenParams, config?: any): Promise<string> {
  throw new Error('generateImage 已废弃，请使用 serverApiClient.generateImage()');
}

export async function generateImageWithVolcEngine(params: ImageGenParams, config: any): Promise<string> {
  throw new Error('generateImageWithVolcEngine 已废弃，请使用 serverApiClient');
}

export async function generateImageWithOpenRouter(params: ImageGenParams, config: any): Promise<string> {
  throw new Error('generateImageWithOpenRouter 已废弃，请使用 serverApiClient');
}

export async function generateImageWithGrsai(params: ImageGenParams, config: any): Promise<string> {
  throw new Error('generateImageWithGrsai 已废弃，请使用 serverApiClient');
}

export async function getGrsaiResult(taskId: string, config: any): Promise<string> {
  throw new Error('getGrsaiResult 已废弃，请使用 serverApiClient');
}

export async function submitWanxTask(config: any, prompt: string): Promise<string> {
  throw new Error('submitWanxTask 已废弃，请使用 serverApiClient');
}

export async function waitForWanxTask(config: any, taskId: string): Promise<string> {
  throw new Error('waitForWanxTask 已废弃，请使用 serverApiClient');
}
