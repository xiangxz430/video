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

// ========== 图片生成参数 ==========

export interface ImageGenParams {
  prompt: string;
  referenceImage?: string | string[];
  aspectRatio?: string;
  model?: string;
  size?: string;
}

// ========== 视频生成参数 ==========

export interface VideoGenParams {
  prompt: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  referenceImages?: string[];
  aspectRatio?: string;
  duration?: number;
  enableAudio?: boolean;
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
}

// ========== 请求日志 ==========

export interface RequestLog {
  id: string;
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
}
