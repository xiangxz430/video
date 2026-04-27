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
