import React, { useState, useEffect } from 'react';
import type { Character, CharacterAlternativeImage } from '../types';
import { uploadImage, localPathToSrc, saveUrlImage, localImageToBase64, isLocalFilePath, uploadMultipleImages, getImageDimensions, checkImageMeetsMinPixels } from '../services/fileService';
import { generateImage, generateImageWithVolcEngine, ImageGenParams, buildCharacterPrompt } from '../services/aiService';
import { getApiConfig, getImageHistory, saveImageHistory, deleteImageHistory, ImageHistory, addGeneratedImageHistory } from '../services/database';
import { getImageConfigForModel } from '../utils/imageConfigUtils';
import { getEnabledModels, ModelInfo, getModelDisplayText } from '../utils/modelConfig';
import { useApp } from '../context/AppContext';

interface CharacterEditModalProps {
  character: Character;
  onClose: () => void;
  onSave: (updatedCharacter: Character) => void;
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

const CharacterEditModal: React.FC<CharacterEditModalProps> = ({ character, onClose, onSave }) => {
  const { apiConfigs } = useApp();
  const [name, setName] = useState(character.name);
  const [description, setDescription] = useState(character.description || '');
  const [voiceDescription, setVoiceDescription] = useState(character.voiceDescription || '');
  const [isMain, setIsMain] = useState(character.isMain || false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState(character.imageUrl || '');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedSize, setSelectedSize] = useState('2K');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('16:9');
  const [logs, setLogs] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  
  // 动态加载可用的图片模型
  useEffect(() => {
    if (apiConfigs && apiConfigs.length > 0) {
      const models = getEnabledModels(apiConfigs, 'imageGeneration');
      setAvailableModels(models);
      // 设置默认选中的模型
      if (models.length > 0 && !selectedModel) {
        setSelectedModel(models[0].id);
        if (models[0].resolutions && models[0].resolutions.length > 0) {
          setSelectedSize(models[0].resolutions[0]);
        }
      }
    }
  }, [apiConfigs]);
  
  // 副图相关状态
  const [alternativeImages, setAlternativeImages] = useState<CharacterAlternativeImage[]>(character.alternativeImages || []);
  const [newAltDescription, setNewAltDescription] = useState('');
  const [newAltName, setNewAltName] = useState('');
  const [isAddingAlt, setIsAddingAlt] = useState(false);
  const [isGeneratingAlt, setIsGeneratingAlt] = useState(false);
  const [generatingAltIndex, setGeneratingAltIndex] = useState<number | null>(null);
  
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

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };
  
  // 加载图片历史
  const loadImageHistory = async () => {
    if (!character.id) return;
    setIsLoadingHistory(true);
    try {
      console.log('加载图片历史, characterId:', character.id);
      const history = await getImageHistory('character', character.id);
      console.log('加载到历史图片数量:', history.length);
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
  }, [character.id]);
  
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

  const handleUploadImage = async () => {
    setIsUploading(true);
    try {
      const path = await uploadImage('characters');
      if (path) {
        // 先把当前主图存入历史
        if (imageUrl && character.id) {
          const alreadyInHistory = imageHistoryList.some(
            h => (h.localPath || h.imageUrl) === imageUrl
          );
          if (!alreadyInHistory) {
            try {
              await saveImageHistory('character', character.id, name, imageUrl, imageUrl, description);
              await loadImageHistory();
            } catch (e) {
              console.error('保存旧主图到历史失败:', e);
            }
          }
        }
        setImageUrl(path);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!description) return;
    
    // 在生成新图前，先把当前主图存入历史（如果有的话）
    if (imageUrl && character.id) {
      const alreadyInHistory = imageHistoryList.some(
        h => (h.localPath || h.imageUrl) === imageUrl
      );
      if (!alreadyInHistory) {
        try {
          await saveImageHistory('character', character.id, name, imageUrl, imageUrl, description);
          await loadImageHistory();
          console.log('旧主图已保存到历史');
        } catch (e) {
          console.error('保存旧主图到历史失败:', e);
        }
      }
    }

    setIsGenerating(true);
    setLogs([]);
    try {
      // 角色图提示词（使用统一构建函数）
      const characterPrompt = buildCharacterPrompt(description);
      addLog('🚀 开始生成角色主图...');
      addLog(`📝 提示词: ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`);
      addLog(`📋 专业角色设计模板: 已应用（主视觉区、色彩细节区、局部特写区、比例参照区）`);
      addLog(`🤖 模型: ${availableModels.find(m => m.id === selectedModel)?.name || selectedModel}`);
      addLog(`📐 分辨率: ${selectedSize}`);
      addLog(`📏 比例: ${selectedAspectRatio}`);
      
      const imageConfig = await getImageConfigForModel(selectedModel, availableModels);
      
      // 获取选中的模型信息
      const selectedModelInfo = availableModels.find(m => m.id === selectedModel);
      
      // 服务端代理架构：API Key 由服务端管理，无需客户端校验
      
      // configWithModel 已包含正确的 provider 和 model
      const configWithModel = imageConfig || {
        name: `${selectedModelInfo?.provider || 'unknown'}_imageGeneration`,
        provider: selectedModelInfo?.provider || 'unknown',
        model: selectedModel || '',
        apiKey: '',
        baseUrl: selectedModelInfo?.baseUrl || ''
      };
      
      addLog(`⚙️ API配置: ${configWithModel.provider}, ${configWithModel.model}`);
      
      const params: ImageGenParams = { 
        prompt: characterPrompt,
        model: selectedModel,
        size: selectedSize,
        aspectRatio: selectedAspectRatio
      };
      
      // 根据 provider 选择不同的 API
      let apiName = '火山方舟 API';
      if (configWithModel.provider === 'grsai') {
        apiName = 'Grsai API';
      } else if (configWithModel.provider === 'openrouter') {
        apiName = 'OpenRouter API';
      }
      addLog(`📤 发送请求到 ${apiName}...`);
      
      const generatedImageUrl = await generateImage(params, configWithModel);
      addLog(`✅ 生成成功！`);
      addLog(`🔗 图片URL: ${generatedImageUrl}`);
      
      // 下载到本地
      addLog('💾 开始下载图片到本地...');
      try {
        const localPath = await saveUrlImage(generatedImageUrl, 'characters');
        if (localPath) {
          addLog(`✅ 下载成功！本地路径: ${localPath}`);
          setImageUrl(localPath);
          
          // 保存到图片历史
          if (character.id) {
            try {
              console.log('保存图片历史:', { characterId: character.id, name, generatedImageUrl, localPath });
              const historyId = await saveImageHistory('character', character.id, name, generatedImageUrl, localPath, description);
              console.log('保存图片历史成功, ID:', historyId);
              addLog('📸 已保存到图片历史');
              // 也保存到统一历史
              await addGeneratedImageHistory(localPath, description, selectedModel, selectedSize, selectedAspectRatio, 'character', character.id);
              addLog('📸 已保存到统一历史');
              // 刷新历史列表
              await loadImageHistory();
              
              // 同时保存到首页生成历史，方便在首页"从历史选择"中使用
              await addGeneratedImageHistory(localPath, description, selectedModel, selectedSize, selectedAspectRatio, 'character', character.id);
              console.log('已保存到首页生成历史');
            } catch (historyError) {
              console.error('保存图片历史失败:', historyError);
              addLog(`❌ 保存历史失败: ${historyError}`);
            }
          } else {
            console.log('未保存历史: character.id 为空');
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
      if (errorMsg.includes('SensitiveContentDetected') || errorMsg.includes('敏感')) {
        alert('生成失败: 图片内容审核未通过\n\n可能原因：\n1. 提示词包含敏感词汇\n2. 参考图片包含敏感内容\n\n建议：修改提示词或更换参考图片后重试');
      } else {
        alert(`生成失败: ${errorMsg}`);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // 添加新的副图输入框
  const handleAddAlternative = () => {
    setIsAddingAlt(true);
    setNewAltDescription('');
    setNewAltName('');
  };

  // 取消添加副图
  const handleCancelAddAlternative = () => {
    setIsAddingAlt(false);
    setNewAltDescription('');
    setNewAltName('');
  };

  // 生成副图（图+文模式，以主图为参考）
  const handleGenerateAlternative = async () => {
    if (!newAltDescription || !imageUrl) {
      alert('请先确保角色主图已生成，并填写穿着描述');
      return;
    }

    setIsGeneratingAlt(true);
    setLogs([]);
    try {
      const imageConfig = await getImageConfigForModel(selectedModel, availableModels);
      // 服务端代理架构：API Key 由服务端管理
      
      // 获取选中的模型信息
      const selectedModelInfo = availableModels.find(m => m.id === selectedModel);
      
      // configWithModel 已包含正确的 provider 和 model
      const configWithModel = imageConfig;

      addLog('🚀 开始生成角色副图（其他穿着）...');
      addLog(`📝 穿着描述: ${newAltDescription}`);
      addLog(`📷 参考图: 角色主图`);
      addLog(`🤖 模型: ${selectedModelInfo?.name || selectedModel}`);

      // 准备参考图片（主图）
      let referenceImage: string | undefined;
      if (imageUrl) {
        if (isLocalFilePath(imageUrl)) {
          addLog('🔄 将本地主图转换为Base64...');
          const base64 = await localImageToBase64(imageUrl);
          if (base64) {
            referenceImage = base64;
            addLog(`✅ Base64转换成功 (${base64.length}字符)`);
          }
        } else {
          referenceImage = imageUrl;
          addLog(`✅ 使用远程URL作为参考图`);
        }
      }

      if (!referenceImage) {
        alert('无法处理角色主图，请确保主图格式正确');
        return;
      }

      // 构建副图提示词
      const altPrompt = `专业角色设计图，基于参考图中角色的面部特征和体型，${newAltDescription}。
画面要求：
1. 保持与参考图相同的角色面部特征、发型、肤色
2. 展示新的服装穿着效果
3. 在同一图中展示角色的正视面部特写、正视全身图、侧视图和背视图
4. 背景简洁干净，突出角色主体
风格：影视级角色设定图，高清细腻，色彩准确，光影自然`;

      addLog(`📤 调用图生图API...`);
      addLog(`📋 模式: 🖼️ 图生图`);

      const params: ImageGenParams = {
        prompt: altPrompt,
        model: selectedModel,
        size: selectedSize,
        aspectRatio: selectedAspectRatio,
        referenceImage: referenceImage,
        referenceImageMeta: [{ fileName: imageUrl.split('/').pop() || imageUrl, filePath: imageUrl }],
      };

      const generatedImageUrl = await generateImage(params, configWithModel);
      addLog(`✅ 生成成功！`);

      // 下载到本地
      addLog('💾 开始下载图片到本地...');
      const localPath = await saveUrlImage(generatedImageUrl, 'characters');
      if (localPath) {
        addLog(`✅ 下载成功！本地路径: ${localPath}`);
        
        // 保存到图片历史
        if (character.id) {
          try {
            await saveImageHistory('character', character.id, name, generatedImageUrl, localPath, newAltDescription);
            addLog('📸 已保存到图片历史');
            // 也保存到统一历史
            await addGeneratedImageHistory(localPath, newAltDescription, selectedModel, selectedSize, selectedAspectRatio, 'character', character.id);
            addLog('📸 已保存到统一历史');
            // 刷新历史列表
            loadImageHistory();
          } catch (historyError) {
            console.error('保存图片历史失败:', historyError);
          }
        }
        
        // 添加到副图列表
        const newAlt: CharacterAlternativeImage = {
          id: `alt_${Date.now()}`,
          name: newAltName || `穿着 ${alternativeImages.length + 1}`,
          description: newAltDescription,
          imageUrl: localPath
        };
        setAlternativeImages(prev => [...prev, newAlt]);
        
        // 清空输入
        setIsAddingAlt(false);
        setNewAltDescription('');
        setNewAltName('');
        
        alert('副图生成成功！');
      } else {
        alert('图片下载失败');
      }
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      addLog(`❌ 错误: ${errorMsg}`);
      
      // 友好的错误提示
      if (errorMsg.includes('SensitiveContentDetected') || errorMsg.includes('敏感')) {
        alert('生成失败: 图片内容审核未通过\n\n可能原因：\n1. 提示词包含敏感词汇\n2. 参考图片包含敏感内容\n\n建议：修改提示词或更换参考图片后重试');
      } else {
        alert(`生成失败: ${errorMsg}`);
      }
    } finally {
      setIsGeneratingAlt(false);
    }
  };

  // 删除副图
  const handleDeleteAlternative = (id: string) => {
    setAlternativeImages(prev => prev.filter(alt => alt.id !== id));
  };

  // 重新生成副图
  const handleRegenerateAlternative = async (index: number) => {
    const alt = alternativeImages[index];
    if (!alt || !imageUrl) {
      alert('缺少必要的数据');
      return;
    }

    setGeneratingAltIndex(index);
    setLogs([]);
    try {
      const imageConfig = await getImageConfigForModel(selectedModel, availableModels);
      // 服务端代理架构：API Key 由服务端管理
      
      // 获取选中的模型信息
      const selectedModelInfo = availableModels.find(m => m.id === selectedModel);
      
      // configWithModel 已包含正确的 provider 和 model
      const configWithModel = imageConfig;

      addLog(`🚀 重新生成副图: ${alt.name}`);
      addLog(`📝 穿着描述: ${alt.description}`);
      addLog(`🤖 模型: ${selectedModelInfo?.name || selectedModel}`);

      // 准备参考图片
      let referenceImage: string | undefined;
      if (isLocalFilePath(imageUrl)) {
        const base64 = await localImageToBase64(imageUrl);
        if (base64) referenceImage = base64;
      } else {
        referenceImage = imageUrl;
      }

      if (!referenceImage) {
        alert('无法处理角色主图');
        return;
      }

      const altPrompt = `人物写实参考图，基于参考图中人物的面部特征和体型，${alt.description}。
画面要求：
1. 保持与参考图相同的面部特征、发型、肤色
2. 展示新的服装穿着效果
3. 在同一图中展示正视面部特写、正视全身图、侧视图和背视图
4. 背景简洁干净，突出人物主体
风格：高清细腻，色彩准确，光影自然`;

      const params: ImageGenParams = {
        prompt: altPrompt,
        model: selectedModel,
        size: selectedSize,
        aspectRatio: selectedAspectRatio,
        referenceImage,
        referenceImageMeta: [{ fileName: imageUrl.split('/').pop() || imageUrl, filePath: imageUrl }],
      };

      const generatedImageUrl = await generateImage(params, configWithModel);
      // 下载到本地
      const localPath = await saveUrlImage(generatedImageUrl, 'characters');

      if (localPath) {
        // 保存到图片历史
        if (character.id) {
          try {
            await saveImageHistory('character', character.id, name, generatedImageUrl, localPath, alt.description);
            addLog('📸 已保存到图片历史');
            // 也保存到统一历史
            await addGeneratedImageHistory(localPath, alt.description, selectedModel, selectedSize, selectedAspectRatio, 'character', character.id);
            addLog('📸 已保存到统一历史');
            // 刷新历史列表
            loadImageHistory();
          } catch (historyError) {
            console.error('保存图片历史失败:', historyError);
          }
        }
        
        // 更新副图
        setAlternativeImages(prev => prev.map((item, i) => 
          i === index ? { ...item, imageUrl: localPath } : item
        ));
        addLog(`✅ 副图重新生成成功！`);
        alert('副图重新生成成功！');
      }
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      
      // 友好的错误提示
      if (errorMsg.includes('SensitiveContentDetected') || errorMsg.includes('敏感')) {
        alert('生成失败: 图片内容审核未通过\n\n可能原因：\n1. 提示词包含敏感词汇\n2. 参考图片包含敏感内容\n\n建议：修改提示词或更换参考图片后重试');
      } else {
        alert(`生成失败: ${errorMsg}`);
      }
    } finally {
      setGeneratingAltIndex(null);
    }
  };

  // 上传参考图片
  const handleUploadRefImages = async () => {
    const paths = await uploadMultipleImages(3, 'characters');
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
    if (imageUrl && character.id) {
      const alreadyInHistory = imageHistoryList.some(
        h => (h.localPath || h.imageUrl) === imageUrl
      );
      if (!alreadyInHistory) {
        try {
          await saveImageHistory('character', character.id, name, imageUrl, imageUrl, description);
          await loadImageHistory();
          console.log('旧主图已保存到历史（参考图模式）');
        } catch (e) {
          console.error('保存旧主图到历史失败:', e);
        }
      }
    }

    setIsGeneratingFromRef(true);
    setLogs([]);
    try {
      const imageConfig = await getImageConfigForModel(selectedModel, availableModels);
      // 服务端代理架构：API Key 由服务端管理
      
      // 获取选中的模型信息
      const selectedModelInfo = availableModels.find(m => m.id === selectedModel);
      
      // configWithModel 已包含正确的 provider 和 model
      const configWithModel = imageConfig;

      addLog('🚀 开始参考图生图...');
      addLog(`📷 参考图片: ${refImages.length}张`);
      addLog(`📝 提示词: ${refPrompt.substring(0, 50)}${refPrompt.length > 50 ? '...' : ''}`);
      addLog(`🤖 模型: ${selectedModelInfo?.name || selectedModel}`);

      // 将本地图片转为Base64
      const refImageBase64List: string[] = [];
      const refImageMetaList: { fileName: string; filePath: string }[] = [];
      for (const imgPath of refImages) {
        if (isLocalFilePath(imgPath)) {
          addLog(`🔄 转换参考图: ${imgPath.split('/').pop()}`);
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

      addLog(`✅ 成功转换 ${refImageBase64List.length} 张参考图`);

      // 构建提示词（参考图模式，使用统一构建函数）
      const characterPrompt = buildCharacterPrompt(refPrompt, true);

      addLog(`📤 调用图生图API...`);
      addLog(`📋 模式: 🖼️ 多图生图 (${refImageBase64List.length}张参考图)`);

      const params: ImageGenParams = {
        prompt: characterPrompt,
        model: selectedModel,
        size: selectedSize,
        aspectRatio: selectedAspectRatio,
        referenceImage: refImageBase64List.length === 1 ? refImageBase64List[0] : refImageBase64List,
        referenceImageMeta: refImageMetaList.length > 0 ? refImageMetaList : undefined,
      };

      const generatedImageUrl = await generateImage(params, configWithModel);
      addLog(`✅ 生成成功！`);

      // 下载到本地
      addLog('💾 开始下载图片到本地...');
      const localPath = await saveUrlImage(generatedImageUrl, 'characters');
      if (localPath) {
        addLog(`✅ 下载成功！本地路径: ${localPath}`);
        setImageUrl(localPath);
        // 清空参考图
        setRefImages([]);
        setRefPrompt('');
        setShowRefImageSection(false);
        alert('图片生成成功！');
      } else {
        addLog('❌ 下载失败: 返回路径为空');
        alert('图片下载失败');
      }
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      addLog(`❌ 错误: ${errorMsg}`);
      
      // 友好的错误提示
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
    const updatedCharacter: Character = {
      ...character,
      name,
      description,
      voiceDescription,
      isMain,
      imageUrl: imageUrl || character.imageUrl || undefined,
      alternativeImages
    };
    console.log('handleSave: 保存角色，imageUrl:', updatedCharacter.imageUrl, 'alternativeImages:', alternativeImages.length);
    onSave(updatedCharacter);
  };

  const imageSrc = localPathToSrc(imageUrl);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">编辑角色</h2>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">角色名称</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="请输入角色名称"
                />
              </div>

              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="isMain"
                  checked={isMain}
                  onChange={(e) => setIsMain(e.target.checked)}
                  className="h-4 w-4 text-blue-600 rounded"
                />
                <label htmlFor="isMain" className="text-sm font-medium text-gray-700">主角</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">角色描述 / 形象提示词</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  placeholder="请输入角色形象描述提示词，AI将根据提示词生成角色图片..."
                />
                <p className="text-xs text-gray-500 mt-1">详细描述角色的年龄、服装、发型、表情、姿态等特征</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">音色描述</label>
                <textarea
                  value={voiceDescription}
                  onChange={(e) => setVoiceDescription(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  placeholder="描述角色的声音特点，如：男声、低沉、沉稳..."
                />
              </div>

              {/* 主图按钮 */}
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
                    <span>AI 生成主图</span>
                  )}
                </button>
                {/* 添加副图按钮 */}
                <button
                  onClick={handleAddAlternative}
                  disabled={!imageUrl}
                  className={`px-4 py-2 rounded-lg transition flex items-center justify-center ${
                    imageUrl
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                  title="添加其他穿着/造型"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

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
                    placeholder="描述想要生成的角色形象，AI将基于参考图片的风格生成..."
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
                      <span>生成角色图</span>
                    )}
                  </button>
                </div>
              )}

              {/* 添加副图输入区域 */}
              {isAddingAlt && (
                <div className="border border-blue-200 rounded-lg p-4 bg-blue-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-700">添加其他穿着/造型</h4>
                    <button
                      onClick={handleCancelAddAlternative}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={newAltName}
                    onChange={(e) => setNewAltName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="穿着名称（如：便装、战袍、礼服）"
                  />
                  <textarea
                    value={newAltDescription}
                    onChange={(e) => setNewAltDescription(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                    placeholder="描述这个穿着的特点，AI将基于角色主图生成新穿着的图片..."
                  />
                  <button
                    onClick={handleGenerateAlternative}
                    disabled={!newAltDescription || isGeneratingAlt}
                    className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition flex items-center justify-center space-x-2 ${
                      newAltDescription && !isGeneratingAlt
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {isGeneratingAlt ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        <span>生成中...</span>
                      </>
                    ) : (
                      <span>生成副图</span>
                    )}
                  </button>
                </div>
              )}

              {/* 日志显示区域 */}
              {logs.length > 0 && (
                <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-xs max-h-48 overflow-y-auto">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-400">调用日志</span>
                    <button 
                      onClick={() => setLogs([])}
                      className="text-gray-500 hover:text-gray-300"
                    >
                      清除
                    </button>
                  </div>
                  {logs.map((log, index) => (
                    <div key={index} className="mb-1 break-all">{log}</div>
                  ))}
                </div>
              )}
            </div>

            {/* 右侧图片区域 */}
            <div className="space-y-4">
              {/* 主图 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">角色主图</label>
                <div className="bg-gray-100 rounded-lg overflow-hidden relative aspect-[3/4] flex items-center justify-center">
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
                      className="w-full h-full flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-200 transition"
                      onClick={handleUploadImage}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <p className="text-sm">暂无主图</p>
                      <p className="text-xs mt-2">点击上传或使用 AI 生成</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 副图列表 */}
              {alternativeImages.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">其他穿着/造型 ({alternativeImages.length})</label>
                  <div className="grid grid-cols-3 gap-3">
                    {alternativeImages.map((alt, index) => (
                      <div key={alt.id} className="relative group">
                        <div className="bg-gray-100 rounded-lg overflow-hidden aspect-[3/4] flex items-center justify-center">
                          <img 
                            src={localPathToSrc(alt.imageUrl) || ''} 
                            alt={alt.name} 
                            className="max-w-full max-h-full object-contain" 
                          />
                          {generatingAltIndex === index && (
                            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                              <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                              </svg>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-1 truncate">{alt.name}</p>
                        <div className="absolute top-1 right-1 flex space-x-1 opacity-0 group-hover:opacity-100 transition">
                          <button
                            onClick={() => handleRegenerateAlternative(index)}
                            className="p-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                            title="重新生成"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteAlternative(alt.id)}
                            className="p-1 bg-red-500 text-white rounded hover:bg-red-600"
                            title="删除"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
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
                      console.log('历史图片:', { id: item.id, localPath: item.localPath, imageUrl: item.imageUrl, imgSrc });
                      return (
                        <div 
                          key={item.id} 
                          className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition ${
                            isCurrentMain ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent hover:border-gray-300'
                          }`}
                          onClick={async () => {
                            if (!isCurrentMain) {
                              const path = item.localPath || item.imageUrl;
                              // 先把当前主图存入历史（如果还没在历史里）
                              if (imageUrl && character.id) {
                                const alreadyInHistory = imageHistoryList.some(
                                  h => (h.localPath || h.imageUrl) === imageUrl
                                );
                                if (!alreadyInHistory) {
                                  try {
                                    await saveImageHistory('character', character.id, name, imageUrl, imageUrl, description);
                                    await loadImageHistory();
                                  } catch (e) {
                                    console.error('保存旧主图到历史失败:', e);
                                  }
                                }
                              }
                              setImageUrl(path);
                              alert('已设置为主图');
                            }
                          }}
                        >
                          <div className="aspect-[3/4] bg-gray-100 flex items-center justify-center">
                            {imgSrc ? (
                              <img 
                                src={imgSrc} 
                                alt="历史图片" 
                                className="max-w-full max-h-full object-contain"
                                onError={(e) => {
                                  console.error('图片加载失败:', imgSrc);
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <span className="text-xs text-gray-400">无图片</span>
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

export default CharacterEditModal;
