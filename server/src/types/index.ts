// ========== API 配置类型 ==========

export interface ApiConfig {
  id?: number;
  name: string;
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ========== 角色和场景类型 ==========

export interface CustomCharacter {
  name: string;
  description: string;
  isMain?: boolean;
}

export interface CustomScene {
  name: string;
  description: string;
}

// ========== 分镜相关类型 ==========

export interface ShotDialogue {
  character: string;
  line: string;
  emotion: string;
  delivery: string;
}

export interface ShotAudio {
  dialogue: string;
  sfx: string[];
  ambience: string;
  bgm: string;
  volume: string;
}

export interface ShotContinuity {
  followsFrom: number | null;
  leadsTo: number | null;
  axisRule: string;
  eyelineMatch: boolean;
}

export interface Shot {
  shotNumber?: number;
  duration: number;
  shotType?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  lens?: string;
  composition?: string;
  lighting?: string;
  description: string;
  action?: string;
  characters: string[];
  scene: string;
  dialogue?: ShotDialogue[] | null;
  audio?: string | ShotAudio;
  continuity?: ShotContinuity;
  notes?: string;
  narrationSource?: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  videoUrl?: string;
  firstFrameRefImage?: string;
  lastFrameRefImage?: string;
  firstFrameRefMode?: 'only-ref' | 'ref-with-scene-char';
  lastFrameRefMode?: 'only-ref' | 'ref-with-scene-char';
  firstFramePrompt?: string;
  lastFramePrompt?: string;
  aspectRatio?: string;
  videoGenMode?: 'text-to-video' | 'image-to-video' | 'first-last-frame';
  referenceImages?: string[];
  referenceImagePrompt?: string;
}

export interface StoryboardScene {
  sceneNumber?: number;
  scene: string;
  description: string;
  mood?: string;
  pacing?: string;
  transition?: string;
  shots: Shot[];
}

/**
 * 图片生成统一参数
 * 
 * 生成模式由参数组合自动推断:
 *   - 文生图: 仅 prompt
 *   - 图生图: prompt + referenceImages (单张)
 *   - 多图生图: prompt + referenceImages (多张)
 * 
 * 各提供商参考图片格式转换:
 *   - 火山方舟: referenceImages → requestBody.images (顶级数组)
 *   - OpenRouter: referenceImages → messages[].content 中 image_url 对象 (vision格式)
 *   - Grsai: referenceImages → requestBody.urls (顶级数组)
 *   - 通义万相: 不支持参考图
 */
export interface ImageGenParams {
  prompt: string;                    // 提示词（必需）
  referenceImages?: string[];        // 参考图片数组 (URL 或 base64)，空/无 = 文生图
  referenceImageMeta?: { fileName: string; filePath: string }[];  // 参考图元数据（日志用）
  aspectRatio?: string;              // 宽高比: "16:9" | "9:16" | "1:1" | "4:3" | "3:4"
  resolution?: string;              // 分辨率: "1K" | "2K" | "4K"
  size?: string;                    // 精确像素尺寸 "WIDTHxHEIGHT"，与 resolution+aspectRatio 互斥
  model?: string;                   // 模型名称
}

/**
 * 视频生成统一参数
 * 
 * 生成模式由参数组合自动推断:
 *   - 文生视频: 仅 prompt
 *   - 图生视频(首帧): prompt + firstFrameImage
 *   - 图生视频(首尾帧): prompt + firstFrameImage + lastFrameImage
 *   - 多图生视频(参考): prompt + referenceImages
 * 
 * 各提供商图片参数格式转换:
 *   - 火山引擎: content 数组 + role 标记 (first_frame/last_frame/reference_image)
 *   - OpenRouter/Wan: frame_images[] (含 frame_type) 或 input_references[]
 *   - GRSai: url 字段 (仅单张首帧)
 */
export interface VideoGenParams {
  prompt: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  referenceImages?: string[];
  aspectRatio?: string;
  duration?: number;
  enableAudio?: boolean;
  resolution?: string;
  inputVideo?: string;                    // 输入视频URL（video-edit模式必需）
  audioSetting?: 'auto' | 'origin';       // 声音控制（video-edit模式可选）
  seed?: number;                          // 确定性生成种子
  size?: string;                          // 精确像素尺寸 "WIDTHxHEIGHT"，与 resolution+aspect_ratio 互斥
  callbackUrl?: string;                   // Webhook 回调 URL（必须 HTTPS）
  providerOptions?: Record<string, any>;  // Provider 特定透传参数
}

export interface VideoGenResult {
  taskId: string;
  mode: 'text-to-video' | 'image-to-video' | 'first-last-frame';
}

// ========== 消息类型 ==========

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ========== 剧本拆分结果 ==========

export interface SplitScriptResult {
  characters: Array<{ name: string; description: string; isMain: boolean; voiceDescription?: string }>;
  scenes: Array<{ name: string; description: string; episodes: string[] }>;
  episodes: Array<{ title: string; episodeNumber: number; content: string }>;
}

// ========== 脚本生成结果 ==========

export interface ScriptGenerationResult {
  content: string;
  provider: string;
  providerName: string;
}

// ========== 分镜进度回调 ==========

export type StoryboardProgressCallback = (message: string, step?: number, totalSteps?: number) => void;

// ========== AI API 调用详情 ==========

export interface AIApiCall {
  provider: string;       // AI服务提供商
  model: string;          // 模型名称
  endpoint: string;       // 调用的API端点URL
  requestTime: number;    // 单次调用耗时(ms)
  tokenUsage?: {
    prompt: number;       // 输入token
    completion: number;   // 输出token
    total: number;        // 总token
  };
  status: 'success' | 'failed' | 'timeout';
  errorMessage?: string;
  // 轮询类任务（图片/视频生成）的额外信息
  pollAttempts?: number;  // 轮询次数
  taskId?: string;        // 异步任务ID
  // AI API调用详情
  requestBody?: Record<string, any>;    // 发送给AI的请求体（脱敏截断后）
  responseBody?: Record<string, any>;   // AI返回的响应体（脱敏截断后）
}

// ========== 请求日志 ==========

export interface RequestLog {
  id: string;
  keyId?: string;           // API Key ID（按用户分区键，用于 MongoDB 查询）
  timestamp: string;
  method: string;
  endpoint: string;        // 如 /api/image/generate
  function: string;        // 功能分类: script/storyboard/image/video
  provider: string;        // 从请求体 body.provider 提取
  model: string;           // 从请求体 body.model 提取
  apiKeyMasked: string;    // 脱敏的 API Key
  statusCode: number;
  duration: number;        // 耗时(ms)
  error: string | null;    // 错误信息
  requestSummary: string;  // 请求摘要（如 prompt 的前100字）
  requestBody?: Record<string, any>;    // 完整请求体（脱敏后）
  responseBody?: Record<string, any>;   // 完整响应体
  aiApiCalls?: AIApiCall[];             // AI API调用详情列表
  connectionInterrupted?: boolean;       // 连接中断标记（客户端超时/断开等）
}
