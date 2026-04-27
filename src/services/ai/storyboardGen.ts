/**
 * 分镜生成模块
 * 
 * ⚠️ 已迁移到服务端
 * 分镜生成功能已迁移到 server/src/routes/storyboard.ts
 * 
 * 客户端请使用: src/services/serverApiClient.ts
 * - generateStoryboard()
 * 
 * 此文件保留以避免 import 错误，但所有功能已废弃
 */

// 已废弃的函数
export async function generateStoryboardScript(
  episodeContent: string,
  characters: any[],
  scenes: any[],
  config?: any,
  onProgress?: (message: string, step?: number, totalSteps?: number) => void,
  onContentStream?: (chunk: string) => void
): Promise<any[]> {
  throw new Error('generateStoryboardScript 已废弃，请使用 serverApiClient.generateStoryboard()');
}
