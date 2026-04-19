/**
 * AI 服务主入口
 * 统一导出所有 AI 相关功能
 */

// ========== 提示词构建 ==========
export function buildCharacterPrompt(description: string, referenceMode: boolean = false): string {
  const prefix = referenceMode ? '专业角色设计图，基于参考图片的风格和特征，' : '';
  return `${prefix}${description}
画面布局要求：
1. 主视觉区（上方）：以纯白背景呈现人物正面、侧面、背面三个核心视角，确保五官比例、发型轮廓、服饰结构清晰可见
2. 色彩与细节区（左侧）：包含人物面部特写及专属色卡，标注主色、辅色、点缀色的HEX色值
3. 局部特写区（底部）：放大展示配饰、纹样、身份标识等关键细节，确保纹理精度
4. 比例参照区（右侧）：搭配参照物，与人物身高形成直观对比，辅助动画绑定与3D建模
5. 当要求真人时，确保人物比例符合真实人体解剖结构，头身比例协调（成人7-8头身）。
风格：${referenceMode ? '影视级角色设定图' : '高清细腻，色彩准确，光影自然，布局清晰专业'}`;
}

export function buildScenePrompt(description: string, referenceMode: boolean = false): string {
  const prefix = referenceMode ? '基于参考图片的风格和特征，' : '';
  return `${prefix}${description}
画面布局要求（2×2 网格，同一场景四视角展示）：
1. 左上角 - 正视图（Front View）：正面视角展现场景主体结构与入口布局
2. 右上角 - 侧视图（Side/3-Quarter View）：45度角展现空间纵深与侧立面细节
3. 左下角 - 俯视图（Top-Down/Overhead）：鸟瞰视角展现整体平面布局与动线设计
4. 右下角 - 全景 Establishing Shot：广角展现场景全貌与周围环境关系
5. 确保四图光影一致、材质统一、空间逻辑自洽，可用作3D建模与关卡设计的参考。
风格：影视级场景概念图，环境转台参考表，高清细腻，透视准确，细节丰富`;
}

// ========== API 客户端 ==========
export { setIdealabIp, getIdealabIp, resolveIdealabIp, callOpenAICompatible, callAI, callOpenAIStreaming } from './ai/apiClients';
export type { OpenAIMessage } from './ai/apiClients';

// ========== 图片生成 ==========
export type { ImageGenParams } from './ai/imageGen';
export { generateImage, generateImageWithVolcEngine, generateImageWithOpenRouter, generateImageWithGrsai, getGrsaiResult } from './ai/imageGen';

// ========== 分镜生成 ==========
export { generateStoryboardScript } from './ai/storyboardGen';

// ========== 视频生成 ==========
export type { VideoGenParams, VideoGenResult } from './ai/videoGen';
export { submitVolcVideoTask, queryVolcVideoTask, waitForVolcVideo, generateVideoWithVolcEngine, generateVideoWithGRSai, generateVideoWithWan26, generateVideoWithOpenRouter, generateVideoFromText, generateVideoFromImage, generateVideoFromFirstLastFrame, generateVideoFromReferenceImages, generateVideo } from './ai/videoGen';

// ========== 剧本拆分 ==========
export { splitScriptWithAI, splitScriptWithConfig, extractEpisodesFromScript, generateScriptWithFallback } from './ai/scriptSplitting';

// ========== 角色和场景图片生成（便捷方法） ==========
import { submitWanxTask, waitForWanxTask } from './ai/imageGen';

export async function generateCharacterImage(description: string, config: any): Promise<string> {
  const taskId = await submitWanxTask(config, description);
  return await waitForWanxTask(config, taskId);
}

export async function generateSceneImage(description: string, config: any): Promise<string> {
  const taskId = await submitWanxTask(config, description);
  return await waitForWanxTask(config, taskId);
}
