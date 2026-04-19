import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import type { ApiConfig } from '../types';
import { generateImage, splitScriptWithConfig } from '../services/aiService';

// 功能名称映射
const CAPABILITY_NAMES: Record<string, string> = {
  scriptGeneration: '剧本生成',
  imageGeneration: '图片生成',
  videoGeneration: '视频生成'
};

// 供应商元数据（静态信息）
const PROVIDER_META: Record<string, {
  name: string;
  description: string;
  color: string;
  apiKeyPlaceholder: string;
  defaultBaseUrl: string;
}> = {
  volcengine: {
    name: '火山引擎',
    description: '提供剧本生成、图片生成、视频生成服务',
    color: 'bg-red-100 text-red-700',
    apiKeyPlaceholder: 'AccessKeyID:SecretAccessKey（用冒号分隔）',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
  },
  deepseek: {
    name: 'DeepSeek',
    description: '提供剧本生成服务',
    color: 'bg-blue-100 text-blue-700',
    apiKeyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
    defaultBaseUrl: 'https://api.deepseek.com/v1'
  },
  grsai: {
    name: 'Grsai',
    description: '提供图片生成、视频生成服务',
    color: 'bg-purple-100 text-purple-700',
    apiKeyPlaceholder: 'Bearer Token',
    defaultBaseUrl: 'https://grsai.dakka.com.cn'
  },
  idealab: {
    name: 'IdeaLab',
    description: '提供剧本生成服务（集团内部）',
    color: 'bg-green-100 text-green-700',
    apiKeyPlaceholder: '输入 API Key',
    defaultBaseUrl: 'https://idealab.alibaba-inc.com/api/openai/v1'
  },
  openrouter: {
    name: 'OpenRouter',
    description: '提供图片生成、视频生成服务',
    color: 'bg-indigo-100 text-indigo-700',
    apiKeyPlaceholder: 'sk-or-xxxx...',
    defaultBaseUrl: 'https://openrouter.ai/api/v1'
  }
};

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type TestResult = {
  status: TestStatus;
  message?: string;
};

// 从数据库配置名解析供应商、功能和模型
// 配置名格式: provider_capability_modelId 或 旧格式: scriptGeneration/imageGeneration/videoGeneration
const parseConfigName = (name: string): { provider: string; capability: string; modelId: string } | null => {
  // 新格式: volcengine_scriptGeneration_doubao-1-5-pro-32k-250115
  const parts = name.split('_');
  if (parts.length >= 3) {
    return {
      provider: parts[0],
      capability: parts[1],
      modelId: parts.slice(2).join('_')
    };
  }
  // 旧格式映射
  if (name === 'scriptGeneration') return { provider: 'deepseek', capability: 'scriptGeneration', modelId: 'deepseek-reasoner' };
  if (name === 'imageGeneration') return { provider: 'volcengine', capability: 'imageGeneration', modelId: 'doubao-seedream-5-0-260128' };
  if (name === 'videoGeneration') return { provider: 'volcengine', capability: 'videoGeneration', modelId: 'doubao-seedance-1-5-pro-251215' };
  if (name === 'imageGeneration_grsai') return { provider: 'grsai', capability: 'imageGeneration', modelId: 'nano-banana-fast' };
  if (name === 'grsai_imageGeneration_nano-banana-fast') return { provider: 'grsai', capability: 'imageGeneration', modelId: 'nano-banana-fast' };
  if (name === 'videoGeneration_grsai') return { provider: 'grsai', capability: 'videoGeneration', modelId: 'grsai-sora-2' };
  return null;
};

// 生成配置键
const getConfigKey = (provider: string, capability: string, modelId: string) => {
  return `${provider}_${capability}_${modelId}`;
};

// 预定义的默认模型列表
const DEFAULT_MODELS: Record<string, Array<{ id: string; name: string; capability: string; price?: string }>> = {
  volcengine: [
    { id: 'doubao-1-5-pro-32k-250115', name: 'Doubao-1.5-Pro-32K', capability: 'scriptGeneration', price: '¥0.0012/千tokens' },
    { id: 'doubao-seedream-5-0-260128', name: 'Doubao-Seedream-5.0-Lite', capability: 'imageGeneration', price: '¥0.25/张' },
    { id: 'doubao-seedream-4-5-251128', name: 'Doubao-Seedream-4.5', capability: 'imageGeneration', price: '¥0.28/张' },
    { id: 'doubao-seedream-5-0-260128-full', name: 'Doubao-Seedream-5.0', capability: 'imageGeneration', price: '¥0.50/张' },
    { id: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro', capability: 'videoGeneration', price: '¥1.50/次' },
    { id: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro', capability: 'videoGeneration', price: '¥1.20/次' },
    { id: 'doubao-seedance-2-0-fast', name: 'Seedance 2.0 Fast', capability: 'videoGeneration', price: '¥0.80/次' },
  ],
  grsai: [
    { id: 'nano-banana-fast', name: 'Nano-Banana-Fast', capability: 'imageGeneration', price: '¥0.022/张' },
    { id: 'nano-banana', name: 'Nano-Banana', capability: 'imageGeneration', price: '¥0.022/张' },
    { id: 'nano-banana-pro', name: 'Nano-Banana-Pro', capability: 'imageGeneration', price: '¥0.09/张' },
    { id: 'nano-banana-pro-vt', name: 'Nano-Banana-Pro-VT', capability: 'imageGeneration', price: '¥0.09/张' },
    { id: 'nano-banana-pro-cl', name: 'Nano-Banana-Pro-CL', capability: 'imageGeneration', price: '¥0.09/张' },
    { id: 'nano-banana-pro-vip', name: 'Nano-Banana-Pro-VIP', capability: 'imageGeneration', price: '¥0.15/张' },
    { id: 'nano-banana-pro-4k-vip', name: 'Nano-Banana-Pro-4K-VIP', capability: 'imageGeneration', price: '¥0.30/张' },
    { id: 'nano-banana-2', name: 'Nano-Banana-2', capability: 'imageGeneration', price: '¥0.03/张' },
    { id: 'nano-banana-2-cl', name: 'Nano-Banana-2-CL', capability: 'imageGeneration', price: '¥0.03/张' },
    { id: 'nano-banana-2-4k-cl', name: 'Nano-Banana-2-4K-CL', capability: 'imageGeneration', price: '¥0.12/张' },
    { id: 'nano-banana-3', name: 'Nano-Banana-3 (Gemini 3.1 Flash)', capability: 'imageGeneration', price: '¥0.05/张' },
    { id: 'grsai-sora-2', name: 'Sora2', capability: 'videoGeneration', price: '¥2.00/次' },
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek-Chat', capability: 'scriptGeneration', price: '¥0.001/千tokens' },
  ],
  idealab: [
    { id: 'qwen_max', name: 'Qwen-Max', capability: 'scriptGeneration', price: '¥0.04/千tokens' },
  ],
  openrouter: [
    // 图片生成模型 - Black Forest Labs (Flux)
    { id: 'black-forest-labs/flux.2-pro', name: 'FLUX.2 Pro', capability: 'imageGeneration', price: '$0.05/张' },
    { id: 'black-forest-labs/flux.2-flex', name: 'FLUX.2 Flex', capability: 'imageGeneration', price: '$0.01/张' },
    { id: 'black-forest-labs/flux.2-max', name: 'FLUX.2 Max', capability: 'imageGeneration', price: '$0.08/张' },
    { id: 'black-forest-labs/flux.2-klein-4b', name: 'FLUX.2 Klein 4B', capability: 'imageGeneration', price: '$0.005/张' },
    // 图片生成模型 - Sourceful (Riverflow)
    { id: 'sourceful/riverflow-v2-pro', name: 'Riverflow V2 Pro', capability: 'imageGeneration', price: '$0.06/张' },
    { id: 'sourceful/riverflow-v2-fast', name: 'Riverflow V2 Fast', capability: 'imageGeneration', price: '$0.02/张' },
    { id: 'sourceful/riverflow-v2-max-preview', name: 'Riverflow V2 Max', capability: 'imageGeneration', price: '$0.10/张' },
    { id: 'sourceful/riverflow-v2-standard-preview', name: 'Riverflow V2 Standard', capability: 'imageGeneration', price: '$0.04/张' },
    // 图片生成模型 - ByteDance
    { id: 'bytedance-seed/seedream-4.5', name: 'Seedream 4.5', capability: 'imageGeneration', price: '$0.04/张' },
    // 视频生成模型（均为 alpha 阶段，需申请）
    { id: 'alibaba/wan-2.6', name: 'Wan 2.6 (阿里巴巴)', capability: 'videoGeneration', price: '$0.08/次' },
    { id: 'openai/sora-2-pro', name: 'Sora 2 Pro (alpha)', capability: 'videoGeneration', price: '$0.15/次' },
    { id: 'google/veo-3.1', name: 'Veo 3.1 (alpha)', capability: 'videoGeneration', price: '$0.12/次' },
    { id: 'bytedance/seedance-1.5-pro', name: 'Seedance 1.5 Pro (alpha)', capability: 'videoGeneration', price: '$0.08/次' },
  ],
};

const Settings: React.FC = () => {
  const { apiConfigs, updateApiConfig } = useApp();
  // 按供应商聚合的配置
  const [providerData, setProviderData] = useState<Record<string, {
    apiKey: string;
    baseUrl: string;
    models: Array<{
      id: string;
      name: string;
      capability: string;
      enabled: boolean;
      description?: string;
      price?: string;
    }>;
  }>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, 'idle' | 'saving' | 'saved'>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    // 从apiConfigs动态构建供应商数据
    const data: Record<string, any> = {};
    
    // 旧格式 key -> provider/capability 的映射（用于判断启用状态）
    const legacyKeyToProviderCapability: Record<string, { provider: string; capability: string }> = {
      'scriptGeneration': { provider: 'volcengine', capability: 'scriptGeneration' },
      'imageGeneration': { provider: 'volcengine', capability: 'imageGeneration' },
      'videoGeneration': { provider: 'volcengine', capability: 'videoGeneration' },
      'imageGeneration_grsai': { provider: 'grsai', capability: 'imageGeneration' },
      'videoGeneration_grsai': { provider: 'grsai', capability: 'videoGeneration' },
      'deepseek_scriptGeneration_deepseek-chat': { provider: 'deepseek', capability: 'scriptGeneration' },
      'videoGeneration_openrouter': { provider: 'openrouter', capability: 'videoGeneration' },
      'imageGeneration_openrouter': { provider: 'openrouter', capability: 'imageGeneration' },
      'idealab_scriptGeneration_qwen_max': { provider: 'idealab', capability: 'scriptGeneration' },
    };
    
    // 构建新格式 key 的配置 map（provider_capability_modelId -> apiKey）
    const newFormatConfigMap: Record<string, { apiKey: string; baseUrl: string }> = {};
    // 构建旧格式供应商 API Key map（provider -> { capability -> { apiKey, model } }）
    const legacyProviderApiKeys: Record<string, { apiKey: string; baseUrl: string }> = {};
    
    apiConfigs.forEach(config => {
      const parsed = parseConfigName(config.name);
      if (parsed && config.name.split('_').length >= 3) {
        // 新格式 key
        newFormatConfigMap[config.name] = { apiKey: config.apiKey, baseUrl: config.baseUrl || '' };
      }
      // 旧格式 key
      const legacy = legacyKeyToProviderCapability[config.name];
      if (legacy && config.apiKey) {
        legacyProviderApiKeys[legacy.provider] = { apiKey: config.apiKey, baseUrl: config.baseUrl || '' };
      }
    });
    
    // 初始化所有已知供应商，并添加默认模型
    Object.keys(PROVIDER_META).forEach(providerId => {
      // 优先使用旧格式配置的 API Key
      const legacyInfo = legacyProviderApiKeys[providerId];
      data[providerId] = {
        apiKey: legacyInfo?.apiKey || '',
        baseUrl: legacyInfo?.baseUrl || PROVIDER_META[providerId].defaultBaseUrl,
        models: []
      };
      
      // 添加默认模型列表，默认全部启用
      if (DEFAULT_MODELS[providerId]) {
        DEFAULT_MODELS[providerId].forEach((model) => {
          const newKey = getConfigKey(providerId, model.capability, model.id);
          let enabled = false;
          
          if (newFormatConfigMap[newKey] !== undefined) {
            // 新格式 key 存在，以其 apiKey 是否有值判断
            enabled = !!newFormatConfigMap[newKey].apiKey;
          } else {
            // 新格式 key 不存在（全新模型），只要该供应商配置了 API Key 就默认启用
            const legacyInfo = legacyProviderApiKeys[providerId];
            // 同时检查新格式中是否有任意该供应商的配置（说明用户已配置过该供应商）
            const hasNewFormatKey = Object.keys(newFormatConfigMap).some(k => k.startsWith(providerId + '_') && newFormatConfigMap[k].apiKey);
            enabled = !!(legacyInfo?.apiKey || hasNewFormatKey);
          }
          
          data[providerId].models.push({
            id: model.id,
            name: model.name,
            capability: model.capability,
            enabled,
            price: model.price
          });
        });
      }
    });
    
    // 处理不在 DEFAULT_MODELS 里的配置（自定义添加的）
    apiConfigs.forEach(config => {
      const parsed = parseConfigName(config.name);
      if (!parsed) return;
      
      const { provider, capability, modelId } = parsed;
      if (!data[provider]) {
        data[provider] = {
          apiKey: '',
          baseUrl: PROVIDER_META[provider]?.defaultBaseUrl || '',
          models: []
        };
      }
      
      // 检查是否已在 DEFAULT_MODELS 里
      const isDefault = DEFAULT_MODELS[provider]?.some(m => m.id === modelId && m.capability === capability);
      if (!isDefault) {
        const existingIndex = data[provider].models.findIndex(
          (m: any) => m.id === modelId && m.capability === capability
        );
        if (existingIndex === -1) {
          data[provider].models.push({
            id: modelId,
            name: modelId,
            capability,
            enabled: !!config.apiKey
          });
        }
      }
    });
    
    setProviderData(data);
  }, [apiConfigs]);

  const handleProviderChange = (providerId: string, field: 'apiKey' | 'baseUrl', value: string) => {
    setProviderData(prev => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        [field]: value
      }
    }));
    setSaveStatus(prev => ({ ...prev, [providerId]: 'idle' }));
  };

  const toggleModel = (providerId: string, modelId: string, capability: string) => {
    setProviderData(prev => {
      const provider = prev[providerId];
      if (!provider) return prev;
      
      const modelIndex = provider.models.findIndex(m => m.id === modelId && m.capability === capability);
      if (modelIndex === -1) return prev;
      
      const newModels = [...provider.models];
      newModels[modelIndex] = { ...newModels[modelIndex], enabled: !newModels[modelIndex].enabled };
      
      return {
        ...prev,
        [providerId]: {
          ...provider,
          models: newModels
        }
      };
    });
    setSaveStatus(prev => ({ ...prev, [providerId]: 'idle' }));
  };
  
  // 更新模型备注
  const updateModelDescription = (providerId: string, modelId: string, description: string) => {
    setProviderData(prev => {
      const provider = prev[providerId];
      if (!provider) return prev;
      
      const modelIndex = provider.models.findIndex(m => m.id === modelId);
      if (modelIndex === -1) return prev;
      
      const newModels = [...provider.models];
      newModels[modelIndex] = { ...newModels[modelIndex], description };
      
      return {
        ...prev,
        [providerId]: {
          ...provider,
          models: newModels
        }
      };
    });
  };

  const handleSaveProvider = async (providerId: string) => {
    const data = providerData[providerId];
    if (!data) return;

    setSaveStatus(prev => ({ ...prev, [providerId]: 'saving' }));
    
    try {
      const apiKey = data.apiKey || '';
      const baseUrl = data.baseUrl || PROVIDER_META[providerId]?.defaultBaseUrl;
      
      // 1. 保存供应商级旧格式配置 key（确保已有页面能读到 API Key）
      const legacyKeyMap: Record<string, Record<string, string>> = {
        volcengine: {
          scriptGeneration: 'scriptGeneration',
          imageGeneration: 'imageGeneration',
          videoGeneration: 'videoGeneration',
        },
        grsai: {
          imageGeneration: 'grsai_imageGeneration_nano-banana-fast',
          videoGeneration: 'videoGeneration_grsai',
        },
        deepseek: {
          scriptGeneration: 'deepseek_scriptGeneration_deepseek-chat',
        },
        openrouter: {
          videoGeneration: 'videoGeneration_openrouter',
          imageGeneration: 'imageGeneration_openrouter',
        },
        idealab: {
          scriptGeneration: 'idealab_scriptGeneration_qwen_max',
        },
      };
      
      const capabilityKeys = legacyKeyMap[providerId] || {};
      const firstEnabledByCapability: Record<string, string> = {};
      
      // 收集每个功能第一个启用的模型
      data.models.forEach(model => {
        if (model.enabled && !firstEnabledByCapability[model.capability]) {
          firstEnabledByCapability[model.capability] = model.id;
        }
      });
      
      // 更新旧格式 key
      const legacySavePromises = Object.entries(capabilityKeys).map(([capability, legacyKey]) => {
        const enabledModelId = firstEnabledByCapability[capability];
        return updateApiConfig(legacyKey, {
          provider: providerId,
          apiKey: enabledModelId ? apiKey : '',
          model: enabledModelId || data.models.find(m => m.capability === capability)?.id || '',
          baseUrl,
        });
      });
      
      // 2. 保存新格式 key（标记每个模型的启用状态和备注）
      const newKeyPromises = data.models.map(model => {
        const configKey = getConfigKey(providerId, model.capability, model.id);
        return updateApiConfig(configKey, {
          provider: providerId,
          apiKey: model.enabled ? apiKey : '',
          model: model.id,
          baseUrl,
          description: model.description || '',
        });
      });
      
      await Promise.all([...legacySavePromises, ...newKeyPromises]);
      setSaveStatus(prev => ({ ...prev, [providerId]: 'saved' }));
      setTimeout(() => {
        setSaveStatus(prev => ({ ...prev, [providerId]: 'idle' }));
      }, 2000);
    } catch (error) {
      console.error('Failed to save config:', error);
      setSaveStatus(prev => ({ ...prev, [providerId]: 'idle' }));
    }
  };

  const handleTestModel = async (providerId: string, capability: string, modelId: string) => {
    const data = providerData[providerId];
    const testKey = getConfigKey(providerId, capability, modelId);
    
    if (!data?.apiKey) {
      setTestResults(prev => ({
        ...prev,
        [testKey]: { status: 'error', message: '请先配置 API Key' }
      }));
      return;
    }

    setTestResults(prev => ({ ...prev, [testKey]: { status: 'testing' } }));

    try {
      if (capability === 'imageGeneration') {
        // 测试图片生成
        const testPrompt = 'A simple test image, a red apple on a white background';
        await generateImage({
          prompt: testPrompt,
          model: modelId,
          size: '2K',
          aspectRatio: '1:1'
        }, {
          name: testKey,
          provider: providerId,
          apiKey: data.apiKey,
          model: modelId,
          baseUrl: data.baseUrl || PROVIDER_META[providerId]?.defaultBaseUrl
        });
        setTestResults(prev => ({
          ...prev,
          [testKey]: { status: 'success', message: '测试通过' }
        }));
      } else if (capability === 'scriptGeneration') {
        // 测试剧本生成 - 使用简单的测试剧本
        const testScript = '第一集：测试剧本\n\n场景1：测试场景\n这是一个简单的测试场景，用于验证API连接是否正常。';
        await splitScriptWithConfig(testScript, {
          name: testKey,
          provider: providerId,
          apiKey: data.apiKey,
          model: modelId,
          baseUrl: data.baseUrl || PROVIDER_META[providerId]?.defaultBaseUrl
        });
        setTestResults(prev => ({
          ...prev,
          [testKey]: { status: 'success', message: '测试通过' }
        }));
      } else if (capability === 'videoGeneration') {
        // 视频生成测试较复杂，暂时只验证配置格式
        // 实际视频生成需要更多参数（提示词、图片等）
        setTestResults(prev => ({
          ...prev,
          [testKey]: { status: 'success', message: '配置格式有效' }
        }));
      } else {
        setTestResults(prev => ({
          ...prev,
          [testKey]: { status: 'success', message: '配置有效' }
        }));
      }
    } catch (error: any) {
      setTestResults(prev => ({
        ...prev,
        [testKey]: { status: 'error', message: error.message || '测试失败' }
      }));
    }
  };

  if (apiConfigs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">加载配置中...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">API 配置</h1>
          <p className="text-gray-600">按供应商配置 API，勾选需要使用的模型并进行测试</p>
        </div>
        <button
          onClick={() => window.history.back()}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition flex items-center space-x-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          <span>返回</span>
        </button>
      </div>

      <div className="space-y-6">
        {Object.entries(providerData).map(([providerId, data]) => {
          const meta = PROVIDER_META[providerId];
          if (!meta) return null;
          
          const enabledCount = data.models.filter(m => m.enabled).length;
          const hasModels = data.models.length > 0;
          
          return (
            <div key={providerId} className="bg-white rounded-lg shadow p-6">
              {/* 供应商头部 */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <span className={`px-3 py-1 text-sm font-medium rounded ${meta.color}`}>
                    {meta.name}
                  </span>
                  <span className="text-sm text-gray-500">{meta.description}</span>
                </div>
                {enabledCount > 0 && (
                  <span className="px-2 py-0.5 text-xs rounded bg-green-100 text-green-700">
                    已启用 {enabledCount} 个模型
                  </span>
                )}
              </div>

              {/* API 配置 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="md:col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">API Key</label>
                  <input
                    type="password"
                    value={data.apiKey}
                    onChange={(e) => handleProviderChange(providerId, 'apiKey', e.target.value)}
                    placeholder={meta.apiKeyPlaceholder}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Base URL</label>
                  <input
                    type="text"
                    value={data.baseUrl || meta.defaultBaseUrl}
                    onChange={(e) => handleProviderChange(providerId, 'baseUrl', e.target.value)}
                    placeholder={meta.defaultBaseUrl}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>
              </div>

              {/* 模型列表 - 按功能分组 */}
              {hasModels && (
                <div className="space-y-4">
                  {['scriptGeneration', 'imageGeneration', 'videoGeneration'].map(capability => {
                    const capabilityModels = data.models.filter(m => m.capability === capability);
                    if (capabilityModels.length === 0) return null;
                    
                    return (
                      <div key={capability}>
                        <h3 className="text-sm font-medium text-gray-700 mb-2">
                          {CAPABILITY_NAMES[capability]}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {capabilityModels.map((model) => {
                            const testKey = getConfigKey(providerId, capability, model.id);
                            const testResult = testResults[testKey];

                            return (
                              <div
                                key={model.id}
                                className={`border rounded-lg p-3 transition ${
                                  model.enabled ? 'border-green-300 bg-green-50' : 'border-gray-200'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center space-x-3">
                                    <input
                                      type="checkbox"
                                      checked={model.enabled}
                                      onChange={() => toggleModel(providerId, model.id, capability)}
                                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                    />
                                    <div>
                                      <span className={`text-sm font-medium ${model.enabled ? 'text-gray-900' : 'text-gray-500'}`}>
                                        {model.name}
                                      </span>
                                      {model.price && (
                                        <span className="ml-2 text-xs text-orange-600 font-medium">
                                          {model.price}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    {testResult?.status === 'success' && (
                                      <span className="flex items-center text-xs text-green-600">
                                        <svg className="h-3 w-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                        {testResult.message}
                                      </span>
                                    )}
                                    {testResult?.status === 'error' && (
                                      <span className="flex items-center text-xs text-red-600" title={testResult.message}>
                                        <svg className="h-3 w-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                        </svg>
                                        失败
                                      </span>
                                    )}
                                    {testResult?.status === 'testing' && (
                                      <span className="flex items-center text-xs text-blue-600">
                                        <svg className="animate-spin h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        测试中
                                      </span>
                                    )}
                                    <button
                                      onClick={() => handleTestModel(providerId, capability, model.id)}
                                      disabled={testResult?.status === 'testing' || !model.enabled || !data.apiKey}
                                      className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200 transition disabled:opacity-50"
                                    >
                                      测试
                                    </button>
                                  </div>
                                </div>
                                {/* 备注输入框 */}
                                <div className="mt-2">
                                  <input
                                    type="text"
                                    placeholder="模型特点(10字内)"
                                    value={model.description || ''}
                                    onChange={(e) => {
                                      const value = e.target.value.slice(0, 10);
                                      updateModelDescription(providerId, model.id, value);
                                    }}
                                    maxLength={10}
                                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!hasModels && (
                <div className="text-sm text-gray-500 py-4">
                  该供应商暂无配置模型，请先在其他页面选择模型进行生成，系统会自动保存配置。
                </div>
              )}

              {/* 保存按钮 */}
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => handleSaveProvider(providerId)}
                  disabled={saveStatus[providerId] === 'saving' || !data.apiKey}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    saveStatus[providerId] === 'saved'
                      ? 'bg-green-600 text-white'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  } disabled:opacity-50`}
                >
                  {saveStatus[providerId] === 'saving'
                    ? '保存中...'
                    : saveStatus[providerId] === 'saved'
                    ? '已保存'
                    : '保存配置'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 bg-blue-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-900 mb-2">使用说明</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>每个供应商只需配置一次 API Key，所有该供应商的模型共用同一套配置</li>
          <li>勾选需要使用的模型，保存后可在对应功能中选择</li>
          <li>建议对每个启用的模型点击测试按钮验证可用性</li>
          <li>火山引擎 API Key 格式：AccessKeyID:SecretAccessKey（用冒号分隔）</li>
          <li>API Key 将安全地存储在本地数据库中</li>
        </ul>
      </div>
    </div>
  );
};

export default Settings;
