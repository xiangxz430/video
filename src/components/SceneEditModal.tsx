import React, { useState, useEffect } from 'react';
import type { Scene } from '../types';
import { uploadImage, localPathToSrc, saveUrlImage, localImageToBase64, isLocalFilePath, uploadMultipleImages, getImageDimensions, checkImageMeetsMinPixels, exportImageFile } from '../services/fileService';
import { generateImage, generateImageWithVolcEngine, ImageGenParams, buildScenePrompt } from '../services/aiService';
import { getApiConfig, getImageHistory, saveImageHistory, deleteImageHistory, ImageHistory, addGeneratedImageHistory } from '../services/database';
import { getAspectRatioStyle } from '../utils/aspectRatioUtils';
import { getEnabledModels, ModelInfo, getModelDisplayText } from '../utils/modelConfig';
import { useApp } from '../context/AppContext';
import type { ApiConfig } from '../types';

import { getImageConfigForModel } from '../utils/imageConfigUtils';

interface SceneEditModalProps {
  scene: Scene;
  onClose: () => void;
  onSave: (updatedScene: Scene) => void;
}

// 支持的图片生成模型 - 从数据库动态加载
// 此数组仅作为备用,优先使用数据库配置
const IMAGE_MODELS: ModelInfo[] = [];
// 支持的宽高比
const ASPECT_RATIOS = [
  { id: '16:9', name: '16:9 横版' },
  { id: '9:16', name: '9:16 竖版' },
  { id: '1:1', name: '1:1 方形' },
  { id: '4:3', name: '4:3 标准' },
  { id: '3:4', name: '3:4 竖版' }
];

const SceneEditModal: React.FC<SceneEditModalProps> = ({ scene, onClose, onSave }) => {
  const { apiConfigs } = useApp();
  const [name, setName] = useState(scene.name);
  const [description, setDescription] = useState(scene.description || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState(scene.imageUrl || '');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedSize, setSelectedSize] = useState('2K');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('16:9');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  
  // 动态加载可用的图片模型
  useEffect(() => {
    console.log('🔍 SceneEditModal - apiConfigs:', apiConfigs);
    if (apiConfigs && apiConfigs.length > 0) {
      const models = getEnabledModels(apiConfigs, 'imageGeneration');
      console.log('🔍 SceneEditModal - 加载到的图片模型:', models);
      setAvailableModels(models);
      // 设置默认选中的模型(只在还没有选中模型且模型列表不为空时设置)
      if (models.length > 0 && !selectedModel) {
        setSelectedModel(models[0].id);
        if (models[0].resolutions && models[0].resolutions.length > 0) {
          setSelectedSize(models[0].resolutions[0]);
        }
      }
    }
  }, [apiConfigs]);
  
  // 日志状态
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };
  const clearLogs = () => setLogs([]);
  
  // 参考图片生图状态
  const [showRefImageSection, setShowRefImageSection] = useState(false);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [refPrompt, setRefPrompt] = useState('');
  const [isGeneratingFromRef, setIsGeneratingFromRef] = useState(false);
  
  // 图片尺寸状态
  const [mainImageDimensions, setMainImageDimensions] = useState<{ width: number; height: number; pixels: number } | null>(null);
  
  // 图片历史状态
  const [imageHistoryList, setImageHistoryList] = useState<ImageHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  
  // 出现集数解析
  const [episodesText, setEpisodesText] = useState(() => {
    try {
      const arr = JSON.parse(scene.episodes || '[]');
      return arr.join(', ');
    } catch {
      return '';
    }
  });

  // 加载图片历史
  const loadImageHistory = async () => {
    if (!scene.id) return;
    setIsLoadingHistory(true);
    try {
      const history = await getImageHistory('scene', scene.id);
      setImageHistoryList(history);
    } catch (error) {
      console.error('加载图片历史失败:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };
  
  // 组件加载时获取历史图片
  React.useEffect(() => {
    loadImageHistory();
  }, [scene.id]);

  const handleUploadImage = async () => {
    setIsUploading(true);
    try {
      const path = await uploadImage('scenes');
      if (path) {
        setImageUrl(path);
      }
    } finally {
      setIsUploading(false);
    }
  };
  
  // 加载主图尺寸
  React.useEffect(() => {
    if (imageUrl && isLocalFilePath(imageUrl)) {
      getImageDimensions(imageUrl).then(dim => {
        setMainImageDimensions(dim);
      });
    } else {
      setMainImageDimensions(null);
    }
  }, [imageUrl]);

  const handleGenerate = async () => {
    if (!description) return;
    
    // 在生成新图前，先把当前主图存入历史（如果有的话）
    if (imageUrl && scene.id) {
      const alreadyInHistory = imageHistoryList.some(
        h => (h.localPath || h.imageUrl) === imageUrl
      );
      if (!alreadyInHistory) {
        try {
          await saveImageHistory('scene', scene.id, name, imageUrl, imageUrl, description);
          await loadImageHistory();
          console.log('旧主图已保存到历史');
        } catch (e) {
          console.error('保存旧主图到历史失败:', e);
        }
      }
    }

    setIsGenerating(true);
    clearLogs();
    
    try {
      addLog('🚀 开始生成场景图片...');
      addLog(`📝 场景名称: ${name}`);
      addLog(`📄 场景描述: ${description}`);
      addLog(`🤖 模型: ${availableModels.find(m => m.id === selectedModel)?.name || selectedModel}`);
      addLog(`📐 分辨率: ${selectedSize}`);
      addLog(`📏 比例: ${selectedAspectRatio}`);
      
      const imageConfig = await getImageConfigForModel(selectedModel, availableModels);
      // 服务端代理架构：API Key 由服务端管理，无需客户端校验
      const provider = imageConfig?.provider || 'unknown';
      
      // 根据 provider 选择不同的 API
      let apiName = '火山方舟 API';
      if (provider === 'grsai') {
        apiName = 'Grsai API';
      } else if (provider === 'openrouter') {
        apiName = 'OpenRouter API';
      }
      addLog(`📤 发送请求到 ${apiName}...`);
      
      // configWithModel 已包含正确的 provider 和 model
      const configWithModel = imageConfig || {
        name: `${provider}_imageGeneration`,
        provider,
        model: selectedModel || '',
        apiKey: '',
        baseUrl: ''
      };
      
      // 场景图提示词（使用统一构建函数，四视角转台图）
      const scenePrompt = buildScenePrompt(description);
      
      const params: ImageGenParams = { 
        prompt: scenePrompt,
        model: selectedModel,
        size: selectedSize,
        aspectRatio: selectedAspectRatio
      };
      const generatedImageUrl = await generateImage(params, configWithModel);
      addLog(`✅ 生成成功！`);
      addLog(`🔗 图片URL: ${generatedImageUrl}`);
      
      // 下载到本地
      addLog('💾 开始下载图片到本地...');
      try {
        const localPath = await saveUrlImage(generatedImageUrl, 'scenes');
        if (localPath) {
          addLog(`✅ 下载成功！本地路径: ${localPath}`);
          setImageUrl(localPath);
          
          // 保存到图片历史
          if (scene.id) {
            try {
              await saveImageHistory('scene', scene.id, name, generatedImageUrl, localPath, description);
              addLog('📸 已保存到图片历史');
              // 刷新历史列表
              loadImageHistory();
              
              // 同时保存到首页生成历史，方便在首页"从历史选择"中使用
              await addGeneratedImageHistory(localPath, description, selectedModel, selectedSize, selectedAspectRatio, 'scene', scene.id);
              addLog('📸 已保存到首页生成历史');
            } catch (historyError) {
              console.error('保存图片历史失败:', historyError);
              addLog('⚠️ 保存图片历史失败');
            }
          }
          
          alert('图片生成成功！');
        } else {
          addLog('❌ 下载失败: 返回路径为空');
          alert('图片下载失败: 返回路径为空');
        }
      } catch (downloadError: any) {
        const downloadErrorMsg = downloadError?.message || String(downloadError);
        addLog(`❌ 下载失败: ${downloadErrorMsg}`);
        alert(`图片下载失败: ${downloadErrorMsg}`);
      }
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      addLog(`❌ 错误: ${errorMsg}`);
      console.error('生成失败:', error);
      
      // 友好的错误提示
      if (errorMsg.includes('output_moderation') || errorMsg.includes('SensitiveContentDetected') || errorMsg.includes('敏感')) {
        addLog('⚠️ 内容审核未通过');
        alert('生成失败: 图片内容审核未通过\n\n可能原因：\n1. 提示词包含敏感词汇\n2. 场景描述涉及敏感内容\n\n建议：修改场景描述后重试');
      } else {
        alert(`生成失败: ${errorMsg}`);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // 上传参考图片
  const handleUploadRefImages = async () => {
    const paths = await uploadMultipleImages(3, 'scenes');
    if (paths.length > 0) {
      setRefImages(prev => [...prev, ...paths].slice(0, 3));
    }
  };

  // 删除参考图片
  const handleRemoveRefImage = (index: number) => {
    setRefImages(prev => prev.filter((_, i) => i !== index));
  };

  // 参考图片生图
  const handleGenerateFromRef = async () => {
    if (refImages.length === 0 || !refPrompt) {
      alert('请上传参考图片并输入提示词');
      return;
    }

    // 在生成新图前，先把当前主图存入历史（如果有的话）
    if (imageUrl && scene.id) {
      const alreadyInHistory = imageHistoryList.some(
        h => (h.localPath || h.imageUrl) === imageUrl
      );
      if (!alreadyInHistory) {
        try {
          await saveImageHistory('scene', scene.id, name, imageUrl, imageUrl, description);
          await loadImageHistory();
          console.log('旧主图已保存到历史（参考图模式）');
        } catch (e) {
          console.error('保存旧主图到历史失败:', e);
        }
      }
    }

    setIsGeneratingFromRef(true);
    try {
      const imageConfig = await getImageConfigForModel(selectedModel, availableModels);
      // 服务端代理架构：API Key 由服务端管理
      
      // 获取选中的模型信息
      const selectedModelInfo = availableModels.find(m => m.id === selectedModel);
      
      // configWithModel 已包含正确的 provider 和 model
      const configWithModel = imageConfig;

      // 将本地图片转为Base64
      const refImageBase64List: string[] = [];
      const refImageMetaList: { fileName: string; filePath: string }[] = [];
      for (const imgPath of refImages) {
        if (isLocalFilePath(imgPath)) {
          const base64 = await localImageToBase64(imgPath);
          if (base64) {
            refImageBase64List.push(base64);
            refImageMetaList.push({ fileName: imgPath.split('/').pop() || imgPath, filePath: imgPath });
          }
        } else {
          refImageBase64List.push(imgPath);
          refImageMetaList.push({ fileName: imgPath.split('/').pop() || imgPath, filePath: imgPath });
        }
      }

      if (refImageBase64List.length === 0) {
        alert('无法处理参考图片');
        return;
      }

      // 构建提示词（参考图模式，使用统一构建函数）
      const scenePrompt = buildScenePrompt(refPrompt, true);

      const params: ImageGenParams = {
        prompt: scenePrompt,
        model: selectedModel,
        size: selectedSize,
        aspectRatio: selectedAspectRatio,
        referenceImages: refImageBase64List,
        referenceImageMeta: refImageMetaList.length > 0 ? refImageMetaList : undefined,
      };

      const generatedImageUrl = await generateImage(params, configWithModel);

      // 下载到本地
      const localPath = await saveUrlImage(generatedImageUrl, 'scenes');
      if (localPath) {
        setImageUrl(localPath);
        
        // 保存到图片历史
        if (scene.id) {
          try {
            await saveImageHistory('scene', scene.id, name, generatedImageUrl, localPath, refPrompt);
            // 刷新历史列表
            loadImageHistory();
            // 也保存到统一历史
            await addGeneratedImageHistory(localPath, refPrompt, selectedModel, selectedSize, selectedAspectRatio, 'scene', scene.id);
          } catch (historyError) {
            console.error('保存图片历史失败:', historyError);
          }
        }
        
        // 清空参考图
        setRefImages([]);
        setRefPrompt('');
        setShowRefImageSection(false);
        alert('图片生成成功！');
      }
    } catch (error: any) {
      console.error('生成失败:', error);
      
      // 友好的错误提示
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes('SensitiveContentDetected') || errorMsg.includes('敏感')) {
        alert('生成失败: 图片内容审核未通过\n\n可能原因：\n1. 提示词包含敏感词汇\n2. 参考图片包含敏感内容\n\n建议：修改提示词或更换参考图片后重试');
      } else {
        alert(`生成失败: ${errorMsg}`);
      }
    } finally {
      setIsGeneratingFromRef(false);
    }
  };

  const handleSave = () => {
    // 将出现集数文本转为 JSON 数组
    const episodesArr = episodesText
      .split(/[,，\s]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    
    const updatedScene: Scene = {
      ...scene,
      name,
      description,
      imageUrl: imageUrl || undefined,
      episodes: JSON.stringify(episodesArr)
    };
    onSave(updatedScene);
  };

  const imageSrc = localPathToSrc(imageUrl);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">编辑场景</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">场景名称</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="请输入场景名称"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">出现集数</label>
                <input
                  type="text"
                  value={episodesText}
                  onChange={(e) => setEpisodesText(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="例如: 1, 2, 3（用逗号分隔）"
                />
                <p className="text-xs text-gray-500 mt-1">输入该场景出现的集数，用逗号分隔</p>
              </div>

              {/* 模型选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">选择模型</label>
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    const model = availableModels.find(m => m.id === e.target.value);
                    setSelectedModel(e.target.value);
                    if (model && model.resolutions && model.resolutions.length > 0) {
                      setSelectedSize(model.resolutions[0]);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {getModelDisplayText(model.provider, model.id)}
                    </option>
                  ))}
                </select>
              </div>

              {/* 分辨率选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">分辨率</label>
                <div className="flex space-x-2">
                  {availableModels.find(m => m.id === selectedModel)?.resolutions?.map((res) => (
                    <button
                      key={res}
                      onClick={() => setSelectedSize(res)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                        selectedSize === res
                          ? 'bg-black text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>

              {/* 宽高比选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">宽高比</label>
                <div className="flex flex-wrap gap-2">
                  {ASPECT_RATIOS.map((ratio) => (
                    <button
                      key={ratio.id}
                      onClick={() => setSelectedAspectRatio(ratio.id)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                        selectedAspectRatio === ratio.id
                          ? 'bg-black text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {ratio.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">场景描述 / 生成提示词</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={10}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  placeholder="请输入场景描述提示词，AI将根据提示词生成场景图片..."
                />
                <p className="text-xs text-gray-500 mt-1">详细描述场景的环境、光线、氛围等要素</p>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={handleUploadImage}
                  disabled={isUploading}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition flex items-center justify-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>{isUploading ? '上传中...' : '上传图片'}</span>
                </button>
                <button
                  onClick={() => setShowRefImageSection(!showRefImageSection)}
                  className={`flex-1 px-4 py-2 rounded-lg transition flex items-center justify-center space-x-2 ${
                    showRefImageSection
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'border border-purple-300 text-purple-600 hover:bg-purple-50'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                  </svg>
                  <span>参考图生图</span>
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={!description || isGenerating}
                  className={`flex-1 px-4 py-2 rounded-lg transition flex items-center justify-center space-x-2 ${
                    description && !isGenerating
                      ? 'bg-black text-white hover:bg-gray-800'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      <span>生成中...</span>
                    </>
                  ) : (
                    <span>AI 生成图片</span>
                  )}
                </button>
              </div>

              {/* 生成日志面板 */}
              {logs.length > 0 && (
                <div className="bg-gray-900 rounded-lg p-3 max-h-48 overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-400">生成日志</span>
                    <button
                      onClick={clearLogs}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >
                      清除
                    </button>
                  </div>
                  <div className="space-y-1 font-mono text-xs">
                    {logs.map((log, index) => (
                      <div key={index} className="text-gray-300 whitespace-pre-wrap">
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 参考图片生图区域 */}
              {showRefImageSection && (
                <div className="border border-purple-200 rounded-lg p-4 bg-purple-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-700">参考图片生图</h4>
                    <button
                      onClick={() => setShowRefImageSection(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* 参考图片列表 */}
                  <div className="flex gap-2 flex-wrap">
                    {refImages.map((imgPath, index) => (
                      <div key={index} className="relative w-20 h-20 bg-gray-100 rounded-lg overflow-hidden">
                        <img 
                          src={localPathToSrc(imgPath) || ''} 
                          alt={`参考图${index + 1}`} 
                          className="w-full h-full object-cover" 
                        />
                        <button
                          onClick={() => handleRemoveRefImage(index)}
                          className="absolute top-1 right-1 p-0.5 bg-red-500 text-white rounded-full hover:bg-red-600"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    {refImages.length < 3 && (
                      <button
                        onClick={handleUploadRefImages}
                        className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-purple-400 hover:text-purple-400 transition"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-xs mt-1">上传</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">最多上传3张参考图片</p>
                  
                  {/* 提示词输入 */}
                  <textarea
                    value={refPrompt}
                    onChange={(e) => setRefPrompt(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                    placeholder="描述想要生成的场景，AI将基于参考图片的风格生成..."
                  />
                  
                  <button
                    onClick={handleGenerateFromRef}
                    disabled={refImages.length === 0 || !refPrompt || isGeneratingFromRef}
                    className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center space-x-2 ${
                      refImages.length > 0 && refPrompt && !isGeneratingFromRef
                        ? 'bg-purple-600 text-white hover:bg-purple-700'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {isGeneratingFromRef ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        <span>生成中...</span>
                      </>
                    ) : (
                      <span>生成场景图</span>
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-gray-100 rounded-lg overflow-hidden relative flex items-center justify-center" style={getAspectRatioStyle(selectedAspectRatio)}>
              {imageSrc ? (
                <>
                  <img src={imageSrc} alt={name} className="max-w-full max-h-full object-contain" />
                  {/* 图片尺寸标签 */}
                  {mainImageDimensions && (
                    <div className={`absolute bottom-2 right-2 px-2 py-1 rounded text-xs font-medium ${
                      checkImageMeetsMinPixels(mainImageDimensions.pixels).valid 
                        ? 'bg-green-500/80 text-white' 
                        : 'bg-red-500/80 text-white'
                    }`}>
                      {mainImageDimensions.width}×{mainImageDimensions.height}
                      {!checkImageMeetsMinPixels(mainImageDimensions.pixels).valid && (
                        <span className="ml-1" title={`差 ${(checkImageMeetsMinPixels(mainImageDimensions.pixels).diff / 1000).toFixed(0)}K 像素`}>⚠️</span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setImageUrl('');
                      setMainImageDimensions(null);
                    }}
                    className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </>
              ) : (
                <div
                  className="w-full h-full flex flex-col items-center justify-center text-gray-400 min-h-[400px] cursor-pointer hover:bg-gray-200 transition"
                  onClick={handleUploadImage}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm">暂无图片</p>
                  <p className="text-xs mt-2">点击上传或使用 AI 生成</p>
                </div>
              )}
            </div>
            {/* 下载按钮 */}
            {imageUrl && isLocalFilePath(imageUrl) && (
              <button
                onClick={() => {
                  if (imageUrl) {
                    exportImageFile(imageUrl);
                  }
                }}
                className="w-full mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center justify-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>下载到本地</span>
              </button>
            )}
            
            {/* 图片历史记录 */}
            {imageHistoryList.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">历史图片 ({imageHistoryList.length})</label>
                <p className="text-xs text-gray-500 mb-2">点击图片可设为主图</p>
                <div className="grid grid-cols-4 gap-2">
                  {imageHistoryList.map((item) => {
                    const imgSrc = item.localPath ? localPathToSrc(item.localPath) : item.imageUrl;
                    const isCurrentMain = item.localPath === imageUrl || item.imageUrl === imageUrl;
                    return (
                      <div 
                        key={item.id} 
                        className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition ${
                          isCurrentMain ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent hover:border-gray-300'
                        }`}
                        onClick={() => {
                          if (!isCurrentMain) {
                            const path = item.localPath || item.imageUrl;
                            setImageUrl(path);
                            alert('已设置为主图');
                          }
                        }}
                      >
                        <div className="bg-gray-100 flex items-center justify-center" style={getAspectRatioStyle(selectedAspectRatio)}>
                          {imgSrc && (
                            <img 
                              src={imgSrc} 
                              alt="历史图片" 
                              className="max-w-full max-h-full object-contain"
                            />
                          )}
                        </div>
                        {isCurrentMain && (
                          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded">
                            当前主图
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 opacity-0 group-hover:opacity-100 transition">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('确定删除这张历史图片吗？')) {
                              deleteImageHistory(item.id).then(() => {
                                loadImageHistory();
                              });
                            }
                          }}
                          className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition hover:bg-red-600"
                          title="删除"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end space-x-4 p-6 border-t border-gray-200">
          <button onClick={onClose} className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name}
            className={`px-6 py-2 rounded-lg transition ${
              name ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default SceneEditModal;

