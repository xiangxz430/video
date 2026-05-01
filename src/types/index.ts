// 自定义角色类型（用户手动定义）
export interface CustomCharacter {
  name: string;
  description: string;
  isMain?: boolean;
}

// 自定义场景类型（用户手动定义）
export interface CustomScene {
  name: string;
  description: string;
}

// 剧本类型
export interface Script {
  id?: number;
  title: string;
  content: string;
  customCharacters?: CustomCharacter[];  // 自定义角色
  customScenes?: CustomScene[];           // 自定义场景
  createdAt?: string;
  updatedAt?: string;
}

// 角色副图类型（角色其他穿着/造型）
export interface CharacterAlternativeImage {
  id: string;           // 唯一标识
  description: string;  // 穿着描述
  imageUrl: string;     // 图片路径
  name?: string;        // 可选的名称，如"便装"、"战袍"等
}

// 角色类型
export interface Character {
  id?: number;
  name: string;
  description: string;
  imageUrl?: string;    // 主图
  alternativeImages?: CharacterAlternativeImage[];  // 副图数组（其他穿着）
  voiceDescription?: string;
  isMain: boolean;
  scriptId: number;
  createdAt?: string;
  updatedAt?: string;
}

// 场景类型
export interface Scene {
  id?: number;
  name: string;
  description: string;
  imageUrl?: string;
  episodes: string; // JSON 数组存储出现的集数
  scriptId: number;
  createdAt?: string;
  updatedAt?: string;
}

// 分集类型
export interface Episode {
  id?: number;
  title: string;
  episodeNumber: number;
  content: string;
  status: 'complete' | 'incomplete' | 'missing';
  duration?: number;
  scriptId: number;
  createdAt?: string;
  updatedAt?: string;
}

// 片段类型
export interface Segment {
  id?: number;
  episodeId: number;
  startTime: number;
  endTime: number;
  content: string;
  characterId?: number;
  sceneId?: number;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

// 专业级分镜脚本类型

// 台词信息
export interface ShotDialogue {
  character: string;  // 说话角色
  line: string;  // 具体台词内容
  emotion: string;  // 情绪：angry/sad/joyful/nervous/calm/whisper/shout
  delivery: string;  // 演绎方式：slow/fast/pause/trembling/laughing
}

// 声音设计
export interface ShotAudio {
  dialogue: string;  // 对白摘要
  sfx: string[];  // 音效：footsteps/door-slam/wind/rain
  ambience: string;  // 环境音：city-birds-office-crowd
  bgm: string;  // 背景音乐：tense-piano/upbeat-orchestral/silence
  volume: string;  // 音量平衡：dialogue-focused/music-dominant/balanced
}

// 视觉连续性
export interface ShotContinuity {
  followsFrom: number | null;  // 前一个镜头编号
  leadsTo: number | null;  // 下一个镜头编号
  axisRule: string;  // 180度轴线规则：maintained/crossed
  eyelineMatch: boolean;  // 视线匹配
}

// 分镜镜头
export interface Shot {
  shotNumber?: number;  // 镜头编号
  duration: number;
  shotType?: string;  // 景别：ELS/LS/MS/CU/ECU/OTS/POV
  cameraAngle?: string;  // 角度：eye-level/low-angle/high-angle/bird-eye
  cameraMovement?: string;  // 运动：static/pan/tilt/dolly/track/handheld/crane/zoom
  lens?: string;  // 镜头：16mm/24mm/35mm/50mm/85mm/135mm
  composition?: string;  // 构图：rule-of-thirds/centered/symmetrical/leading-lines
  lighting?: string;  // 光线：natural/key-light/backlit/silhouette/chiaroscuro
  description: string;  // 详细画面描述
  action?: string;  // 角色动作和表情
  characters: string[];
  scene: string;
  dialogue?: ShotDialogue[] | null;  // 台词系统
  audio?: string | ShotAudio;  // 声音设计（兼容旧格式字符串）
  continuity?: ShotContinuity;  // 视觉连续性
  notes?: string;  // 导演备注
  narrationSource?: string;  // 该镜头对应的原文段落
  
  // 视频生成相关字段
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
  seed?: number;                          // 确定性生成种子
  size?: string;                          // 精确像素尺寸 "WIDTHxHEIGHT"
  callbackUrl?: string;                   // Webhook 回调 URL
  providerOptions?: Record<string, any>;  // Provider 特定透传参数
}

// 分镜场景
export interface StoryboardScene {
  sceneNumber?: number;  // 场景编号
  scene: string;
  description: string;
  mood?: string;  // 场景情绪基调：tense/romantic/melancholy/joyful/mysterious/action-packed
  pacing?: string;  // 节奏：slow/medium/fast
  transition?: string;  // 转场方式：cut/fade-in/fade-out/dissolve/match-cut
  shots: Shot[];
}

// API 配置类型
export interface ApiConfig {
  id?: number;
  name: string; // 配置名称：scriptGeneration, imageGeneration, videoGeneration
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
  description?: string; // 模型备注说明(10个字以内)
  createdAt?: string;
  updatedAt?: string;
}
