/**
 * AI 剧本拆分模块
 * 包含剧本拆分、角色场景提取、分集拆分等功能
 */
import type { ApiConfig, SplitScriptResult, ScriptGenerationResult } from '../types/index.js';
export declare function splitScriptWithAI(scriptContent: string, config: ApiConfig): Promise<SplitScriptResult>;
export declare function splitScriptWithConfig(scriptContent: string, config: ApiConfig, customInfo?: string, onProgress?: (phase: string, current: number, total: number, message: string) => void, onContentChunk?: (chunk: string) => void): Promise<SplitScriptResult>;
export declare function extractEpisodesFromScript(scriptContent: string, episodeCount: number, config: ApiConfig, onProgress?: (phase: string, current: number, total: number, message: string) => void, onContentChunk?: (chunk: string) => void): Promise<Array<{
    episodeNumber: number;
    title: string;
    content: string;
}>>;
export declare function generateScriptWithFallback(prompt: string, systemPrompt?: string, apiConfigs?: ApiConfig[]): Promise<ScriptGenerationResult>;
