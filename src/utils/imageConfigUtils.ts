/**
 * 图片生成配置获取工具
 * 统一根据模型 ID 获取正确的 API 配置
 */
import type { ApiConfig } from '../types';
import type { ModelInfo } from './modelConfig';
import { getBestConfig } from './modelConfig';

/**
 * 根据图片生成模型 ID 获取对应的 API 配置
 * 支持 grsai / openrouter / volcengine 等 provider
 */
export async function getImageConfigForModel(
  modelId: string,
  availableModels: ModelInfo[]
): Promise<ApiConfig | null> {
  const modelInfo = availableModels.find(m => m.id === modelId);
  if (!modelInfo) return null;

  // 获取所有配置（动态导入避免循环依赖）
  const db = await import('../services/database');
  const allConfigs = await db.getApiConfigs();

  // GRSai 模型
  if (modelInfo.provider === 'grsai') {
    const grsaiConfig = allConfigs.find(c => c.name === 'imageGeneration_grsai');
    if (grsaiConfig && grsaiConfig.model?.trim()) {
      return { ...grsaiConfig, provider: 'grsai', model: modelId };
    }
    // 回退：找任何 grsai 配置
    const anyGrsai = allConfigs.find(c => c.provider === 'grsai' && c.model?.trim());
    if (anyGrsai) return { ...anyGrsai, provider: 'grsai', model: modelId };
  }

  // OpenRouter 模型
  if (modelInfo.provider === 'openrouter') {
    const openrouterConfigs = allConfigs.filter(c =>
      c.provider === 'openrouter' &&
      c.name.toLowerCase().includes('imagegeneration') &&
      c.model?.trim()
    );
    if (openrouterConfigs.length > 0) {
      return { ...openrouterConfigs[0], provider: 'openrouter', model: modelId };
    }
  }

  // 通用图片配置（volcengine / wanx / seedream 等）
  const config = getBestConfig(allConfigs, 'imageGeneration');
  if (config) {
    return { ...config, provider: modelInfo.provider || config.provider, model: modelId };
  }

  return null;
}
