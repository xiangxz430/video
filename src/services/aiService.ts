/**
 * AI 服务适配层
 * 所有 AI 调用已迁移到服务端，此文件保留以兼容旧代码导入
 * 实际功能通过 serverApiClient 调用服务端 API 实现
 */

import {
  splitScript,
  generateScript,
  generateStoryboard,
  generateImage as serverGenerateImage,
  generateCharacterImage as serverGenerateCharacterImage,
  generateSceneImage as serverGenerateSceneImage,
  generateVideo as serverGenerateVideo,
  type GenerateImageParams,
  type GenerateVideoParams
} from './serverApiClient';

// ========== 提示词构建（保留在客户端，用于参考） ==========
export function buildCharacterPrompt(description: string, referenceMode: boolean = false): string {
  const prefix = referenceMode ? '专业角色设计图，基于参考图片的风格和特征，' : '';
  return `${prefix}${description}
画面布局要求：
1. 主视觉区（上方）：以纯白背景呈现人物正面、侧面、背面三个核心视角，确保五官比例、发型轮廓、服饰结构清晰可见
2. 色彩与细节区（左侧）：包含人物面部特写及专属色卡，标注主色、辅色、点缀色的HEX色值
3. 局部特写区（底部）：放大展示配饰、纹样、身份标识等关键细节，确保纹理精度
4. 比例参照区（右侧）：搭配参照物，与人物身高形成直观对比，辅助动画绑定与3D建模
5. 当要求真人时，确保人物比例符合真实人体解剖结构，头身比例协调（成人7-8头身）。
风格：${referenceMode ? '影视级角色设定图' : '高清细腻，色彩准确，光影自然，布局清晰专业'}`;
}

export function buildScenePrompt(description: string, referenceMode: boolean = false): string {
  const prefix = referenceMode ? '基于参考图片的风格和特征，' : '';
  return `${prefix}${description}
画面布局要求（2×2 网格，同一场景四视角展示）：
1. 左上角 - 正视图（Front View）：正面视角展现场景主体结构与入口布局
2. 右上角 - 侧视图（Side/3-Quarter View）：45度角展现空间纵深与侧立面细节
3. 左下角 - 俯视图（Top-Down/Overhead）：鸟瞰视角展现整体平面布局与动线设计
4. 右下角 - 全景 Establishing Shot：广角展现场景全貌与周围环境关系
5. 确保四图光影一致、材质统一、空间逻辑自洽，可用作3D建模与关卡设计的参考。
风格：影视级场景概念图，环境转台参考表，高清细腻，透视准确，细节丰富`;
}

// ========== 类型定义（兼容旧代码） ==========
export interface ImageGenParams {
  prompt: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  referenceImage?: string | string[];
  /** 参考图元数据（仅用于日志，不参与 AI 调用） */
  referenceImageMeta?: { fileName: string; filePath: string }[];
  provider?: string;
  style?: string;
}

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

// 兼容旧代码的 OpenAI 消息类型
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ========== API 客户端（已废弃，保留空实现以兼容） ==========
export function setIdealabIp(ip: string) { console.log('setIdealabIp deprecated'); }
export function getIdealabIp(): string { return ''; }
export function resolveIdealabIp(): Promise<string> { return Promise.resolve(''); }
export async function callOpenAICompatible(config: any, messages: OpenAIMessage[]): Promise<string> {
  throw new Error('callOpenAICompatible 已废弃，请使用服务端 API');
}
export async function callAI(config: any, prompt: string): Promise<string> {
  throw new Error('callAI 已废弃，请使用服务端 API');
}
export async function callOpenAIStreaming(config: any, messages: OpenAIMessage[], onChunk: (chunk: string) => void): Promise<string> {
  throw new Error('callOpenAIStreaming 已废弃，请使用服务端 API');
}

// ========== 图片生成（适配到服务端） ==========
export async function generateImage(params: ImageGenParams, config?: any): Promise<string> {
  return serverGenerateImage({
    prompt: params.prompt,
    model: params.model,
    provider: params.provider,
    referenceImage: params.referenceImage,
    referenceImageMeta: params.referenceImageMeta,
    aspectRatio: params.aspectRatio,
    size: params.size,
    style: params.style
  });
}

// 兼容旧代码的其他图片生成函数
export async function generateImageWithVolcEngine(params: ImageGenParams, config: any): Promise<string> {
  return generateImage(params, config);
}

export async function generateImageWithOpenRouter(params: ImageGenParams, config: any): Promise<string> {
  return generateImage(params, config);
}

export async function generateImageWithGrsai(params: ImageGenParams, config: any): Promise<string> {
  return generateImage(params, config);
}

export async function getGrsaiResult(taskId: string, config: any): Promise<string> {
  throw new Error('getGrsaiResult 已废弃，请使用服务端 API');
}

// 内部使用的 wanx 函数（已废弃）
export async function submitWanxTask(config: any, prompt: string): Promise<string> {
  throw new Error('submitWanxTask 已废弃，请使用服务端 API');
}

export async function waitForWanxTask(config: any, taskId: string): Promise<string> {
  throw new Error('waitForWanxTask 已废弃，请使用服务端 API');
}

// ========== 分镜生成（适配到服务端） ==========
export async function generateStoryboardScript(
  episodeContent: string,
  characters: any[],
  scenes: any[],
  config?: any,
  onProgress?: (message: string, step?: number, totalSteps?: number) => void,
  onContentStream?: (chunk: string) => void
): Promise<any[]> {
  const result = await generateStoryboard(
    { episodeContent, characters, scenes, provider: config?.provider, model: config?.model },
    onProgress ? (data) => onProgress(data.message, data.step, data.totalSteps) : undefined,
    onContentStream
  );
  return result?.shots || [];
}

// ========== 视频生成（适配到服务端） ==========
export async function generateVideo(params: VideoGenParams, config?: any, onProgress?: (data: any) => void): Promise<string> {
  return serverGenerateVideo(params, onProgress);
}

// 兼容旧代码的其他视频生成函数
export async function generateVideoWithVolcEngine(params: VideoGenParams, config: any): Promise<string> {
  return generateVideo(params, config);
}

export async function generateVideoWithGRSai(params: VideoGenParams, config: any): Promise<string> {
  return generateVideo(params, config);
}

export async function generateVideoWithWan26(params: VideoGenParams, config: any): Promise<string> {
  return generateVideo(params, config);
}

export async function generateVideoWithOpenRouter(params: VideoGenParams, config: any): Promise<string> {
  return generateVideo(params, config);
}

export async function generateVideoFromText(prompt: string, config: any): Promise<string> {
  return generateVideo({ prompt }, config);
}

export async function generateVideoFromImage(prompt: string, imageUrl: string, config: any): Promise<string> {
  return generateVideo({ prompt, firstFrameImage: imageUrl }, config);
}

export async function generateVideoFromFirstLastFrame(prompt: string, firstFrame: string, lastFrame: string, config: any): Promise<string> {
  return generateVideo({ prompt, firstFrameImage: firstFrame, lastFrameImage: lastFrame }, config);
}

export async function generateVideoFromReferenceImages(prompt: string, referenceImages: string[], config: any): Promise<string> {
  return generateVideo({ prompt, referenceImages }, config);
}

// 已废弃的火山视频任务函数
export async function submitVolcVideoTask(config: any, prompt: string, imageUrl?: string): Promise<string> {
  throw new Error('submitVolcVideoTask 已废弃，请使用服务端 API');
}

export async function queryVolcVideoTask(config: any, taskId: string): Promise<any> {
  throw new Error('queryVolcVideoTask 已废弃，请使用服务端 API');
}

export async function waitForVolcVideo(config: any, taskId: string, onProgress?: (status: string) => void): Promise<string> {
  throw new Error('waitForVolcVideo 已废弃，请使用服务端 API');
}

// ========== 剧本拆分（适配到服务端） ==========
export async function splitScriptWithAI(script: string, systemPrompt?: string): Promise<any> {
  return splitScript({ script });
}

export async function splitScriptWithConfig(script: string, config: any, customInfo?: string): Promise<any> {
  // customInfo 是系统提示词信息，不应拼接到脚本内容
  // 服务端 /api/script/split 暂不支持 customInfo，仅传递脚本内容
  return splitScript({ script });
}

export async function extractEpisodesFromScript(script: string): Promise<any[]> {
  const result = await splitScript({ script });
  return result.episodes || [];
}

export async function generateScriptWithFallback(prompt: string, systemPrompt: string, configs: any[]): Promise<{ content: string; provider: string }> {
  return generateScript(prompt);
}

// ========== 角色和场景图片生成（适配到服务端） ==========
export async function generateCharacterImage(description: string, config?: any): Promise<string> {
  return serverGenerateCharacterImage(description, false, config?.provider, config?.model);
}

export async function generateSceneImage(description: string, config?: any): Promise<string> {
  return serverGenerateSceneImage(description, false, config?.provider, config?.model);
}
