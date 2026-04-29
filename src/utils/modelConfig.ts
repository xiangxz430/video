import type { ApiConfig } from '../types';

// 模型信息接口
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  capability: 'scriptGeneration' | 'imageGeneration' | 'videoGeneration';
  baseUrl?: string;
  resolutions?: string[]; // 图片模型专用
  formats?: string[]; // 图片模型专用
  price?: string; // 价格信息，如 "$0.04/张" 或 "¥0.08/张"
}

/**
 * 从数据库配置中获取已启用的模型列表
 * @param apiConfigs - 从数据库读取的API配置列表
 * @param capability - 能力类型: scriptGeneration | imageGeneration | videoGeneration
 * @returns 已启用的模型列表（已去重）
 */
export function getEnabledModels(
  apiConfigs: ApiConfig[],
  capability: 'scriptGeneration' | 'imageGeneration' | 'videoGeneration'
): ModelInfo[] {
  const models: ModelInfo[] = [];
  const seenKeys = new Set<string>(); // 用于去重，格式: provider_modelId
  
  apiConfigs.forEach(config => {
    // 检查配置是否属于指定的能力类型
    const nameLower = config.name.toLowerCase();
    const hasCapability = nameLower.includes(capability.toLowerCase());
    
    if (hasCapability && config.model && config.model.trim()) {
      const modelId = config.model || '';
      const uniqueKey = `${config.provider}_${modelId}`;
      
      // 跳过重复的模型 ID（同一 provider 下相同 modelId 只保留一个）
      if (seenKeys.has(uniqueKey)) {
        return;
      }
      seenKeys.add(uniqueKey);
      
      // 提取模型名称(从配置名中解析)
      const parts = config.name.split('_');
      let modelName = config.model || parts[parts.length - 1];
      
      // 尝试从配置名中提取更友好的显示名称
      if (parts.length >= 3) {
        // 新格式: provider_capability_modelId
        modelName = config.model || parts.slice(2).join('_');
      }
      
      // 根据 provider 和 model 设置分辨率等元数据
      const modelInfo: ModelInfo = {
        id: modelId,
        name: getModelDisplayName(config.provider, modelId || modelName),
        provider: config.provider,
        capability,
        baseUrl: config.baseUrl
      };
      
      // 为图片模型添加分辨率信息
      if (capability === 'imageGeneration') {
        modelInfo.resolutions = getModelResolutions(config.provider, modelId || modelName);
        modelInfo.formats = ['png', 'jpeg'];
        modelInfo.price = getModelPrice(config.provider, modelId || modelName);
      }
      
      // 为视频模型添加价格信息
      if (capability === 'videoGeneration') {
        modelInfo.price = getModelPrice(config.provider, modelId || modelName);
      }
      
      models.push(modelInfo);
    }
  });
  
  return models;
}

/**
 * 获取供应商的友好显示名称
 */
export function getProviderDisplayName(provider: string): string {
  const providerMap: Record<string, string> = {
    'volcengine': '火山方舟',
    'deepseek': 'DeepSeek',
    'idealab': 'IdeaLab',
    'openai': 'OpenAI',
    'openrouter': 'OpenRouter',
    'grsai': 'Grsai',
    'anthropic': 'Anthropic',
    'dashscope': '通义千问',
    'tokenplan': '百炼TokenPlan'
  };
  return providerMap[provider] || provider;
}

/**
 * 获取模型下拉框的统一显示文本（包含供应商和备注）
 * 格式: 供应商 - 模型名称 (备注) - 价格
 * 示例: 火山方舟 - Doubao-Seedream-5.0 (性价比高) - ¥0.08/张
 */
export function getModelDisplayText(provider: string, modelId: string): string {
  const providerName = getProviderDisplayName(provider);
  const modelName = getModelDisplayName(provider, modelId);
  const description = getModelDescription(provider, modelId);
  const price = getModelPrice(provider, modelId);
  
  // 如果备注和供应商相同,则不显示备注(避免重复)
  let text = `${providerName} - ${modelName}`;
  if (description !== providerName) {
    text += ` (${description})`;
  }
  
  // 添加价格信息
  if (price) {
    text += ` - ${price}`;
  }
  
  return text;
}

/**
 * 获取模型的友好显示名称
 */
function getModelDisplayName(provider: string, modelId: string): string {
  const displayNameMap: Record<string, string> = {
    // 火山方舟
    'doubao-1-5-pro-32k-250115': 'Doubao-1.5-Pro-32K',
    'doubao-seedream-5-0-260128': 'Doubao-Seedream-5.0-Lite',
    'doubao-seedream-4-5-251128': 'Doubao-Seedream-4.5',
    'doubao-seedream-5-0-260128-full': 'Doubao-Seedream-5.0',
    'doubao-seedance-1-5-pro-251215': 'Seedance 1.5 Pro',
    'doubao-seedance-1-0-pro-250528': 'Seedance 1.0 Pro',
    // Grsai
    'nano-banana-fast': 'Nano-Banana-Fast',
    'nano-banana': 'Nano-Banana',
    'nano-banana-pro': 'Nano-Banana-Pro',
    'nano-banana-pro-vt': 'Nano-Banana-Pro-VT',
    'nano-banana-pro-cl': 'Nano-Banana-Pro-CL',
    'nano-banana-pro-vip': 'Nano-Banana-Pro-VIP',
    'nano-banana-pro-4k-vip': 'Nano-Banana-Pro-4K-VIP',
    'nano-banana-2': 'Nano-Banana-2',
    'nano-banana-2-cl': 'Nano-Banana-2-CL',
    'nano-banana-2-4k-cl': 'Nano-Banana-2-4K-CL',
    'nano-banana-3': 'Nano-Banana-3 (Gemini 3.1 Flash)',
    'grsai-sora-2': 'Sora2',
    // DeepSeek
    'deepseek-v4-pro': 'DeepSeek-V4-Pro',
    'deepseek-chat': 'DeepSeek-Chat',
    // IdeaLab
    'qwen_max': 'Qwen-Max',
    // OpenRouter - 图片
    'google/gemini-3.1-flash-image-preview': 'Nano Banana 2 (Gemini 3.1)',
    'google/gemini-2.5-flash-image': 'Nano Banana (Gemini 2.5)',
    'google/gemini-3-pro-image-preview': 'Gemini 3 Pro Image',
    'openai/gpt-5-image-mini': 'GPT-5 Image Mini',
    'openai/gpt-5-image': 'GPT-5 Image',
    'black-forest-labs/flux.2-pro': 'Flux 2 Pro',
    'black-forest-labs/flux.2-flex': 'Flux 2 Flex',
    'black-forest-labs/flux.2-max': 'Flux 2 Max',
    'black-forest-labs/flux.2-klein-4b': 'Flux 2 Klein 4B',
    'sourceful/riverflow-v2-pro': 'Riverflow 2 Pro',
    'sourceful/riverflow-v2-fast': 'Riverflow 2 Fast',
    'sourceful/riverflow-v2-max-preview': 'Riverflow 2 Max (Preview)',
    'sourceful/riverflow-v2-standard-preview': 'Riverflow 2 Standard',
    'bytedance-seed/seedream-4.5': 'Seedream 4.5',
    // OpenRouter - 视频
    'openai/sora-2-pro': 'Sora 2 Pro (alpha)',
    'google/veo-3.1': 'Veo 3.1 (alpha)',
    'bytedance/seedance-1.5-pro': 'Seedance 1.5 Pro (alpha)',
    'minimax/video-01': 'MiniMax Video 01',
    // Token Plan (百炼包月)
    'qwen3.6-plus': 'Qwen3.6-Plus',
    'glm-5': 'GLM-5',
    'MiniMax-M2.5': 'MiniMax-M2.5',
    'deepseek-v3.2': 'DeepSeek-V3.2',
    'qwen-image-2.0': 'Qwen-Image-2.0',
    'qwen-image-2.0-pro': 'Qwen-Image-2.0-Pro',
    'wan2.7-image': 'Wan2.7-Image',
    'wan2.7-image-pro': 'Wan2.7-Image-Pro',
  };
  
  return displayNameMap[modelId] || modelId;
}

/**
 * 获取模型支持的分辨率
 */
function getModelResolutions(provider: string, modelId: string): string[] {
  // 火山方舟模型
  if (provider === 'volcengine') {
    if (modelId.includes('seedream-5-0-260128') && !modelId.includes('full')) {
      return ['2K', '3K'];
    }
    if (modelId.includes('seedream-4-5') || modelId.includes('seedream-5-0-260128-full')) {
      return ['2K', '4K'];
    }
    return ['2K'];
  }
  
  // Grsai 模型
  if (provider === 'grsai') {
    if (modelId.includes('4k')) {
      return ['4K'];
    }
    if (modelId.includes('pro') && !modelId.includes('fast')) {
      return ['2K', '4K'];
    }
    if (modelId.includes('nano-banana-2') || modelId.includes('nano-banana-3')) {
      return ['2K', '4K'];
    }
    return ['2K'];
  }
  
  // OpenRouter 模型
  if (provider === 'openrouter') {
    if (modelId.includes('gpt-5-image') && !modelId.includes('mini')) {
      return ['1K', '2K', '4K'];
    }
    if (modelId.includes('gemini') || modelId.includes('gpt-5')) {
      return ['1K', '2K'];
    }
    return ['1K', '2K'];
  }
  
  // 默认
  return ['2K'];
}

/**
 * 获取模型的备注说明(10个字以内,包含供应商信息)
 */
export function getModelDescription(provider: string, modelId: string): string {
  // 火山方舟
  if (provider === 'volcengine') {
    const volcDesc: Record<string, string> = {
      'doubao-seedream-5-0-260128': '火山-性价比高',
      'doubao-seedream-4-5-251128': '火山-质量均衡',
      'doubao-seedream-5-0-260128-full': '火山-高质量贵',
      'doubao-seedance-1-5-pro-251215': '火山-性价比高',
      'doubao-seedance-1-0-pro-250528': '火山-稳定快速',
    };
    return volcDesc[modelId] || '火山方舟';
  }
  
  // Grsai
  if (provider === 'grsai') {
    const grsaiDesc: Record<string, string> = {
      'nano-banana-fast': 'Grsai-快速便宜',
      'nano-banana': 'Grsai-标准速度',
      'nano-banana-pro': 'Grsai-高质量',
      'nano-banana-pro-vt': 'Grsai-可变尺寸',
      'nano-banana-pro-cl': 'Grsai-清晰度高',
      'nano-banana-pro-vip': 'Grsai-VIP优先',
      'nano-banana-pro-4k-vip': 'Grsai-4K超清',
      'nano-banana-2': 'Grsai-二代模型',
      'nano-banana-2-cl': 'Grsai-二代高清',
      'nano-banana-2-4k-cl': 'Grsai-二代4K',
      'nano-banana-3': 'Grsai-Gemini3.1',
      'grsai-sora-2': 'Grsai-Sora2视频',
    };
    return grsaiDesc[modelId] || 'Grsai';
  }
  
  // OpenRouter
  if (provider === 'openrouter') {
    const orDesc: Record<string, string> = {
      'google/gemini-3.1-flash-image-preview': 'OR-Gemini3.1',
      'google/gemini-2.5-flash-image': 'OR-Gemini2.5',
      'google/gemini-3-pro-image-preview': 'OR-高质量贵',
      'openai/gpt-5-image-mini': 'OR-GPT5轻量',
      'openai/gpt-5-image': 'OR-GPT5高质量',
      'black-forest-labs/flux.2-pro': 'OR-Flux专业版',
      'black-forest-labs/flux.2-flex': 'OR-Flux灵活版',
      'black-forest-labs/flux.2-max': 'OR-Flux最高质',
      'black-forest-labs/flux.2-klein-4b': 'OR-Flux轻量',
      'sourceful/riverflow-v2-pro': 'OR-Riverflow专业',
      'sourceful/riverflow-v2-fast': 'OR-Riverflow快',
      'sourceful/riverflow-v2-max-preview': 'OR-Riverflow预览',
      'sourceful/riverflow-v2-standard-preview': 'OR-Riverflow标准',
      'bytedance-seed/seedream-4.5': 'OR-字节Seedream',
      'openai/sora-2-pro': 'OR-Sora2专业版',
      'google/veo-3.1': 'OR-Veo3.1视频',
      'bytedance/seedance-1.5-pro': 'OR-字节视频',
      'minimax/video-01': 'OR-MiniMax视频',
    };
    return orDesc[modelId] || 'OpenRouter';
  }
  
  // DeepSeek
  if (provider === 'deepseek') {
    return 'DeepSeek-便宜快速';
  }
  
  // IdeaLab
  if (provider === 'idealab') {
    return 'IdeaLab-国内稳定';
  }
  
  // Token Plan (百炼包月)
  if (provider === 'tokenplan') {
    const tpDesc: Record<string, string> = {
      'qwen3.6-plus': 'TP-Qwen3.6',
      'glm-5': 'TP-GLM-5',
      'MiniMax-M2.5': 'TP-MiniMax',
      'deepseek-v3.2': 'TP-DeepSeek',
      'qwen-image-2.0': 'TP-图片快速',
      'qwen-image-2.0-pro': 'TP-图片高清',
      'wan2.7-image': 'TP-Wan图片',
      'wan2.7-image-pro': 'TP-Wan高清',
    };
    return tpDesc[modelId] || '百炼TokenPlan';
  }
  
  return provider;
}

/**
 * 获取模型的价格信息
 */
export function getModelPrice(provider: string, modelId: string): string | undefined {
  // 火山方舟 - 人民币计价
  if (provider === 'volcengine') {
    const volcPrice: Record<string, string> = {
      'doubao-seedream-5-0-260128': '¥0.08/张',
      'doubao-seedream-4-5-251128': '¥0.12/张',
      'doubao-seedream-5-0-260128-full': '¥0.28/张',
      'doubao-seedance-1-5-pro-251215': '¥0.50/秒',
      'doubao-seedance-1-0-pro-250528': '¥0.68/秒',
    };
    return volcPrice[modelId];
  }
  
  // Grsai - 人民币计价
  if (provider === 'grsai') {
    const grsaiPrice: Record<string, string> = {
      'nano-banana-fast': '¥0.02-0.04/张',
      'nano-banana': '¥0.03-0.06/张',
      'nano-banana-pro': '¥0.09-0.18/张',
      'nano-banana-pro-vt': '¥0.10-0.20/张',
      'nano-banana-pro-cl': '¥0.10-0.20/张',
      'nano-banana-pro-vip': '¥0.12-0.24/张',
      'nano-banana-pro-4k-vip': '¥0.18-0.36/张',
      'nano-banana-2': '¥0.03-0.06/张',
      'nano-banana-2-cl': '¥0.10-0.20/张',
      'nano-banana-2-4k-cl': '¥0.18-0.36/张',
      'nano-banana-3': '¥0.04-0.08/张',
      'grsai-sora-2': '¥0.08/秒',
    };
    return grsaiPrice[modelId];
  }
  
  // OpenRouter - 美元计价
  if (provider === 'openrouter') {
    const orPrice: Record<string, string> = {
      'google/gemini-3.1-flash-image-preview': '$0.02/张',
      'google/gemini-2.5-flash-image': '$0.03/张',
      'google/gemini-3-pro-image-preview': '$0.10/张',
      'openai/gpt-5-image-mini': '$0.05/张',
      'openai/gpt-5-image': '$0.10/张',
      'black-forest-labs/flux.2-pro': '$0.04/张',
      'black-forest-labs/flux.2-flex': '$0.02/张',
      'black-forest-labs/flux.2-max': '$0.08/张',
      'black-forest-labs/flux.2-klein-4b': '$0.01/张',
      'sourceful/riverflow-v2-pro': '$0.04/张',
      'sourceful/riverflow-v2-fast': '$0.02/张',
      'sourceful/riverflow-v2-max-preview': '$0.06/张',
      'sourceful/riverflow-v2-standard-preview': '$0.03/张',
      'bytedance-seed/seedream-4.5': '$0.08/张',
      'openai/sora-2-pro': '$0.15/秒',
      'google/veo-3.1': '$0.12/秒',
      'bytedance/seedance-1.5-pro': '$0.08/秒',
      'minimax/video-01': '$0.10/秒',
    };
    return orPrice[modelId];
  }
  
  // Token Plan (百炼包月) - Credits 折算
  if (provider === 'tokenplan') {
    const tpPrice: Record<string, string> = {
      'qwen3.6-plus': '包月-Credits',
      'glm-5': '包月-Credits',
      'MiniMax-M2.5': '包月-Credits',
      'deepseek-v3.2': '包月-Credits',
      'qwen-image-2.0': '包月-Credits',
      'qwen-image-2.0-pro': '包月-Credits',
      'wan2.7-image': '包月-Credits',
      'wan2.7-image-pro': '包月-Credits',
    };
    return tpPrice[modelId];
  }
  
  return undefined;
}

/**
 * 根据模型ID查找对应的API配置
 */
export function findApiConfigForModel(
  apiConfigs: ApiConfig[],
  modelId: string
): ApiConfig | null {
  return apiConfigs.find(config => config.model === modelId) || null;
}

/**
 * 获取默认的图片模型配置
 */
export function getDefaultImageConfig(apiConfigs: ApiConfig[]): ApiConfig | null {
  // 优先查找 imageGeneration 配置
  const imageConfig = apiConfigs.find(c => c.name === 'imageGeneration');
  if (imageConfig && imageConfig.apiKey) {
    return imageConfig;
  }
  
  // 查找第一个有 API Key 的图片生成配置
  const firstImageConfig = apiConfigs.find(c => 
    c.name.toLowerCase().includes('imagegeneration') && c.apiKey
  );
  
  return firstImageConfig || null;
}

/**
 * 获取默认的视频模型配置
 */
export function getDefaultVideoConfig(apiConfigs: ApiConfig[]): ApiConfig | null {
  // 优先查找 videoGeneration 配置
  const videoConfig = apiConfigs.find(c => c.name === 'videoGeneration');
  if (videoConfig && videoConfig.apiKey) {
    return videoConfig;
  }
  
  // 查找第一个有 API Key 的视频生成配置
  const firstVideoConfig = apiConfigs.find(c => 
    c.name.toLowerCase().includes('videogeneration') && c.apiKey
  );
  
  return firstVideoConfig || null;
}

// ========== 统一配置获取 ==========

export type Capability = 'scriptGeneration' | 'imageGeneration' | 'videoGeneration';

/**
 * 统一获取最优 API 配置
 * 
 * @param apiConfigs - 所有可用配置
 * @param capability - 能力类型
 * @param modelId - 可选，指定模型 ID（会覆盖配置的 model 字段）
 * @returns 匹配的 ApiConfig 或 null
 * 
 * @example
 * // 获取分镜生成的默认配置
 * const config = getBestConfig(apiConfigs, 'scriptGeneration');
 * 
 * // 获取指定视频模型的配置
 * const config = getBestConfig(apiConfigs, 'videoGeneration', 'doubao-seedance-1-5-pro');
 */
export function getBestConfig(
  apiConfigs: ApiConfig[],
  capability: Capability,
  modelId?: string
): ApiConfig | null {
  if (!apiConfigs || apiConfigs.length === 0) return null;

  if (capability === 'scriptGeneration') {
    // 剧本/分镜生成：优先 DeepSeek-V4-Pro（最新旗舰）→ DeepSeek-Chat（快，稳定）→ DeepSeek-Reasoner（备选）→ 旧配置
    const fallbacks = [
      'deepseek_scriptGeneration_deepseek-v4-pro',     // ← 优先使用 V4 Pro（最新旗舰模型）
      'deepseek_scriptGeneration_deepseek-chat',       // ← chat（快，稳定）
      'deepseek_scriptGeneration_deepseek-reasoner',   // ← reasoner 作为备选
      'scriptGeneration',
    ];
    for (const name of fallbacks) {
      const config = apiConfigs.find(c => c.name === name && c.model?.trim());
      if (config) {
        if (modelId) return { ...config, model: modelId };
        return config;
      }
    }
    // 回退：找任何有 model 的脚本相关配置
    const anyScriptConfig = apiConfigs.find(c => 
      (c.name.toLowerCase().includes('script') || c.name.toLowerCase().includes('generation')) &&
      c.model?.trim()
    );
    if (anyScriptConfig) {
      if (modelId) return { ...anyScriptConfig, model: modelId };
      return anyScriptConfig;
    }
  }

  if (capability === 'imageGeneration') {
    // 图片生成：优先 imageGeneration → any image generation config
    if (modelId) {
      // 优先找指定模型
      const modelConfig = apiConfigs.find(c => c.model === modelId && c.model?.trim());
      if (modelConfig) return { ...modelConfig, model: modelId };
    }
    const config = apiConfigs.find(c => c.name === 'imageGeneration' && c.model?.trim());
    if (config) {
      return modelId ? { ...config, model: modelId } : config;
    }
    const anyImageConfig = apiConfigs.find(c => 
      c.name.toLowerCase().includes('imagegeneration') && c.model?.trim()
    );
    if (anyImageConfig) {
      return modelId ? { ...anyImageConfig, model: modelId } : anyImageConfig;
    }
  }

  if (capability === 'videoGeneration') {
    // 视频生成：优先 videoGeneration → any video generation config
    if (modelId) {
      const modelConfig = apiConfigs.find(c => c.model === modelId && c.model?.trim());
      if (modelConfig) return { ...modelConfig, model: modelId };
    }
    const config = apiConfigs.find(c => c.name === 'videoGeneration' && c.model?.trim());
    if (config) {
      return modelId ? { ...config, model: modelId } : config;
    }
    const anyVideoConfig = apiConfigs.find(c => 
      c.name.toLowerCase().includes('videogeneration') && c.model?.trim()
    );
    if (anyVideoConfig) {
      return modelId ? { ...anyVideoConfig, model: modelId } : anyVideoConfig;
    }
  }

  return null;
}
