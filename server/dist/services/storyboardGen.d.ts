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
