/**
 * 剧本拆分模块
 * 
 * ⚠️ 已迁移到服务端
 * 剧本拆分功能已迁移到 server/src/routes/script.ts
 * 
 * 客户端请使用: src/services/serverApiClient.ts
 * - splitScript()
 * - generateScript()
 * 
 * 此文件保留以避免 import 错误，但所有功能已废弃
 */

// 已废弃的函数
export async function splitScriptWithAI(script: string, systemPrompt?: string): Promise<any> {
  throw new Error('splitScriptWithAI 已废弃，请使用 serverApiClient.splitScript()');
}

export async function splitScriptWithConfig(script: string, config: any, customInfo?: string): Promise<any> {
  throw new Error('splitScriptWithConfig 已废弃，请使用 serverApiClient.splitScript()');
}

export async function extractEpisodesFromScript(script: string): Promise<any[]> {
  throw new Error('extractEpisodesFromScript 已废弃，请使用 serverApiClient.splitScript()');
}

export async function generateScriptWithFallback(
  prompt: string,
  systemPrompt: string,
  configs: any[]
): Promise<{ content: string; provider: string }> {
  throw new Error('generateScriptWithFallback 已废弃，请使用 serverApiClient.generateScript()');
}
