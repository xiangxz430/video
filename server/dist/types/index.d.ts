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
export interface CustomCharacter {
    name: string;
    description: string;
    isMain?: boolean;
}
export interface CustomScene {
    name: string;
    description: string;
}
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
export interface ImageGenParams {
    prompt: string;
    referenceImage?: string | string[];
    referenceImageMeta?: {
        fileName: string;
        filePath: string;
    }[];
    aspectRatio?: string;
    model?: string;
    size?: string;
}
export interface VideoGenParams {
    prompt: string;
    firstFrameImage?: string;
    lastFrameImage?: string;
    referenceImages?: string[];
    aspectRatio?: string;
    duration?: number;
    enableAudio?: boolean;
    resolution?: string;
    seed?: number;
    size?: string;
    callbackUrl?: string;
    providerOptions?: Record<string, any>;
}
export interface VideoGenResult {
    taskId: string;
    mode: 'text-to-video' | 'image-to-video' | 'first-last-frame';
}
export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface SplitScriptResult {
    characters: Array<{
        name: string;
        description: string;
        isMain: boolean;
        voiceDescription?: string;
    }>;
    scenes: Array<{
        name: string;
        description: string;
        episodes: string[];
    }>;
    episodes: Array<{
        title: string;
        episodeNumber: number;
        content: string;
    }>;
}
export interface ScriptGenerationResult {
    content: string;
    provider: string;
    providerName: string;
}
export type StoryboardProgressCallback = (message: string, step?: number, totalSteps?: number) => void;
export interface AIApiCall {
    provider: string;
    model: string;
    endpoint: string;
    requestTime: number;
    tokenUsage?: {
        prompt: number;
        completion: number;
        total: number;
    };
    status: 'success' | 'failed' | 'timeout';
    errorMessage?: string;
    pollAttempts?: number;
    taskId?: string;
    requestBody?: Record<string, any>;
    responseBody?: Record<string, any>;
}
export interface RequestLog {
    id: string;
    keyId?: string;
    timestamp: string;
    method: string;
    endpoint: string;
    function: string;
    provider: string;
    model: string;
    apiKeyMasked: string;
    statusCode: number;
    duration: number;
    error: string | null;
    requestSummary: string;
    requestBody?: Record<string, any>;
    responseBody?: Record<string, any>;
    aiApiCalls?: AIApiCall[];
}
