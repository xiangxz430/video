/**
 * AI 分镜脚本生成模块
 * 生成扁平的镜头列表(每个镜头 = 一个分镜/segment)
 */
import type { ApiConfig, Shot, StoryboardProgressCallback } from '../types/index.js';
export declare function generateStoryboardScript(episodeContent: string, characters: Array<{
    name: string;
    description: string;
}>, scenes: Array<{
    name: string;
    description: string;
}>, config: ApiConfig, onProgress?: StoryboardProgressCallback, onContentStream?: (content: string) => void): Promise<Shot[]>;
export declare function deduplicateShots(shots: Shot[], config: ApiConfig, episodeContent: string, onContentStream?: (content: string) => void): Promise<Shot[]>;
export declare function splitShotsSimple(episodeContent: string, characterInfo: string, sceneInfo: string, config: ApiConfig, onContentStream?: (chunk: string) => void): Promise<Shot[]>;
export declare function enrichEachShot(shots: Shot[], episodeContent: string, characterInfo: string, sceneInfo: string, config: ApiConfig, onProgress?: StoryboardProgressCallback, onContentStream?: (content: string) => void, startIndex?: number, endIndex?: number, existingUsedContents?: string[]): Promise<{
    enrichedShots: Shot[];
    usedContents: string[];
}>;
