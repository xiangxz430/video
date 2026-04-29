import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { generateImage, generateVideo } from '../services/serverApiClient';
import { getApiConfig, getAllImageHistoryByDate, addGeneratedImageHistory, deleteGeneratedImageHistory, type GeneratedImageHistory, type ImageHistoryByDate, addHomeVideoHistory, getHomeVideoHistoryByDate, deleteHomeVideoHistory, importLocalVideosToHistory, type HomeVideoHistory, type VideoHistoryByDate } from '../services/database';
import { uploadImage, saveUrlImage, localImageToBase64, isLocalFilePath, localPathToSrc, exportImageFile, downloadVideo, localVideoPathToSrc, scanLocalVideos } from '../services/fileService';
import { useApp } from '../context/AppContext';
import { getEnabledModels, ModelInfo, getModelDisplayText } from '../utils/modelConfig';

// 支持的图片生成模型 - 从数据库动态加载
// 此数组仅作为备用,优先使用数据库配置
const IMAGE_MODELS: ModelInfo[] = [];

// 支持的视频生成模型 - 从数据库动态加载
// 此数组仅作为备用,优先使用数据库配置
const VIDEO_MODELS: ModelInfo[] = [];

const ASPECT_RATIOS = [
  { id: '16:9', name: '16:9 横版' },
  { id: '9:16', name: '9:16 竖版' },
  { id: '1:1', name: '1:1 方形' },
  { id: '4:3', name: '4:3 标准' },
  { id: '3:4', name: '3:4 竖版' }
];

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { apiConfigs } = useApp();
  const [activeTab, setActiveTab] = useState<'image' | 'video' | 'episodes'>('image');

  // 基于 apiConfigs 动态获取已启用的图片/视频模型
  const enabledImageModels = React.useMemo(() => {
    if (apiConfigs && apiConfigs.length > 0) {
      const models = getEnabledModels(apiConfigs, 'imageGeneration');
      return models.length > 0 ? models : IMAGE_MODELS;
    }
    return IMAGE_MODELS;
  }, [apiConfigs]);

  const enabledVideoModels = React.useMemo(() => {
    if (apiConfigs && apiConfigs.length > 0) {
      const models = getEnabledModels(apiConfigs, 'videoGeneration');
      return models.length > 0 ? models : VIDEO_MODELS;
    }
    return VIDEO_MODELS;
  }, [apiConfigs]);

  // 图片生成状态
  const [imagePrompt, setImagePrompt] = useState('');
  const [selectedImageModel, setSelectedImageModel] = useState('nano-banana-fast');
  const [selectedImageSize, setSelectedImageSize] = useState('2K');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('16:9');
  const [refImages, setRefImages] = useState<string[]>([]);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [imageLogs, setImageLogs] = useState<string[]>([]);
  const [imageHistoryByDate, setImageHistoryByDate] = useState<ImageHistoryByDate[]>([]);
  const [showImageHistory, setShowImageHistory] = useState(false);
  const [historySelectorTarget, setHistorySelectorTarget] = useState<'imageRef' | 'videoFirst' | 'videoLast' | 'videoRef' | null>(null);

  // 视频生成状态
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoMode, setVideoMode] = useState<'text-to-video' | 'first-frame' | 'first-last-frame' | 'reference'>('first-frame');
  const [selectedVideoModel, setSelectedVideoModel] = useState('doubao-seedance-1-5-pro-251215');
  const [selectedVideoResolution, setSelectedVideoResolution] = useState('1080');
  const [selectedVideoDuration, setSelectedVideoDuration] = useState(5);
  const [selectedVideoAspectRatio, setSelectedVideoAspectRatio] = useState('16:9');
  const [enableVideoAudio, setEnableVideoAudio] = useState(false); // 默认无声视频，节省一半费用
  const [firstFrameImage, setFirstFrameImage] = useState<string | null>(null);
  const [lastFrameImage, setLastFrameImage] = useState<string | null>(null);
  const [videoRefImages, setVideoRefImages] = useState<string[]>([]);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [localVideoPath, setLocalVideoPath] = useState<string | null>(null); // 本地视频路径
  const [videoLogs, setVideoLogs] = useState<string[]>([]);
  const [videoHistoryByDate, setVideoHistoryByDate] = useState<VideoHistoryByDate[]>([]); // 视频历史
  const [expandedImageDates, setExpandedImageDates] = useState<Set<string>>(new Set()); // 展开的图片日期
  const [expandedVideoDates, setExpandedVideoDates] = useState<Set<string>>(new Set()); // 展开的视频日期

  // 切换图片日期折叠状态
  const toggleImageDate = (date: string) => {
    setExpandedImageDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(date)) {
        newSet.delete(date);
      } else {
        newSet.add(date);
      }
      return newSet;
    });
  };

  // 切换视频日期折叠状态
  const toggleVideoDate = (date: string) => {
    setExpandedVideoDates(prev => {
      const newSet = new Set(prev);
      if (newSet.has(date)) {
        newSet.delete(date);
      } else {
        newSet.add(date);
      }
      return newSet;
    });
  };

  const addImageLog = (message: string) => {
    setImageLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const addVideoLog = (message: string) => {
    setVideoLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  // 加载图片历史（按日期分组）
  const loadImageHistory = async () => {
    try {
      const history = await getAllImageHistoryByDate(10);
      setImageHistoryByDate(history);
    } catch (error) {
      console.error('加载图片历史失败:', error);
    }
  };

  // 加载视频历史（按日期分组）
  const loadVideoHistory = useCallback(async () => {
    try {
      console.log('[Home] 开始加载视频历史...');
      const history = await getHomeVideoHistoryByDate(10);
      console.log('[Home] 加载到视频历史:', history.length, '组');
      setVideoHistoryByDate(history);
    } catch (error) {
      console.error('加载视频历史失败:', error);
    }
  }, []);

  // 扫描并导入本地视频到历史记录
  const importExistingVideos = async () => {
    try {
      const localVideos = await scanLocalVideos();
      if (localVideos.length === 0) return;
      
      // 获取数据库中已有的视频
      const existingHistory = await getHomeVideoHistoryByDate(100);
      const existingPaths = new Set(
        existingHistory.flatMap(g => g.videos.map(v => v.localPath)).filter(Boolean)
      );
      
      // 导入新视频
      let imported = 0;
      for (const videoPath of localVideos) {
        if (!existingPaths.has(videoPath)) {
          await importLocalVideosToHistory(videoPath, undefined, undefined, undefined, false);
          imported++;
        }
      }
      
      if (imported > 0) {
        console.log(`导入了 ${imported} 个本地视频到历史记录`);
        await loadVideoHistory();
      }
    } catch (error) {
      console.error('导入本地视频失败:', error);
    }
  };

  useEffect(() => {
    loadImageHistory();
    loadVideoHistory();
    importExistingVideos();
  }, []);

  // 页面可见时刷新历史（解决返回首页不刷新的问题）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadVideoHistory();
        loadImageHistory();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // 从历史选择图片
  const handleSelectFromHistory = (item: GeneratedImageHistory) => {
    if (!historySelectorTarget) return;
    
    switch (historySelectorTarget) {
      case 'imageRef':
        setRefImages(prev => [...prev, item.localPath]);
        break;
      case 'videoFirst':
        setFirstFrameImage(item.localPath);
        break;
      case 'videoLast':
        setLastFrameImage(item.localPath);
        break;
      case 'videoRef':
        setVideoRefImages(prev => [...prev, item.localPath]);
        break;
    }
    setShowImageHistory(false);
    setHistorySelectorTarget(null);
  };

  // 下载历史图片
  const handleDownloadHistoryImage = async (item: GeneratedImageHistory) => {
    try {
      await exportImageFile(item.localPath);
    } catch (error) {
      console.error('下载图片失败:', error);
      alert('下载失败');
    }
  };

  // 图片生成
  const handleGenerateImage = async () => {
    if (!imagePrompt && refImages.length === 0) {
      alert('请输入提示词或上传参考图');
      return;
    }

    setIsGeneratingImage(true);
    setImageLogs([]);
    addImageLog('🚀 开始生成图片...');

    try {
      const modelInfo = enabledImageModels.find(m => m.id === selectedImageModel);
      let configName = 'imageGeneration';
      
      if (modelInfo?.provider === 'grsai') {
        configName = 'imageGeneration_grsai';
      } else if (modelInfo?.provider === 'openrouter') {
        configName = 'imageGeneration_openrouter';
      }
      
      // 服务端代理架构：API Key 由服务端管理，无需客户端校验
      // 直接获取配置信息即可
      const imageConfig = await getApiConfig(configName);

      addImageLog(`🤖 使用模型: ${modelInfo?.name}`);
      addImageLog(`📐 分辨率: ${selectedImageSize}`);
      addImageLog(`📏 比例: ${selectedAspectRatio}`);

      // 处理参考图
      let referenceImage: string | string[] | undefined;
      if (refImages.length > 0) {
        addImageLog(`📷 处理 ${refImages.length} 张参考图...`);
        const base64Images = await Promise.all(
          refImages.map(async (img) => {
            if (isLocalFilePath(img)) {
              const base64 = await localImageToBase64(img);
              return base64?.split(',')[1] || base64 || '';
            }
            return img;
          })
        );
        const validImages = base64Images.filter(img => img !== '');
        referenceImage = validImages.length === 1 ? validImages[0] : validImages;
        addImageLog('✅ 参考图处理完成');
      }

      addImageLog('📤 发送请求...');
      const imageUrl = await generateImage({
        prompt: imagePrompt,
        provider: modelInfo?.provider,
        model: selectedImageModel,
        aspectRatio: selectedAspectRatio,
        referenceImage
      });

      addImageLog('✅ 图片生成成功!');
      addImageLog(`🔗 ${imageUrl}`);

      // 下载到本地
      addImageLog('💾 下载到本地...');
      const localPath = await saveUrlImage(imageUrl, 'generated');
      if (localPath) {
        addImageLog(`✅ 已保存: ${localPath}`);
        setGeneratedImageUrl(localPath);
        
        // 保存到历史记录
        await addGeneratedImageHistory(
          localPath,
          imagePrompt,
          selectedImageModel,
          selectedImageSize,
          selectedAspectRatio
        );
        
        // 刷新历史列表
        await loadImageHistory();
      }
    } catch (error: any) {
      const errorMsg = error?.message || error?.toString() || '未知错误';
      console.error('图片生成错误:', error);
      addImageLog(`❌ 错误: ${errorMsg}`);
      alert(`生成失败: ${errorMsg}`);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // 视频生成
  const handleGenerateVideo = async () => {
    // 验证输入
    if (videoMode === 'text-to-video' && !videoPrompt.trim()) {
      alert('请输入视频生成提示词');
      return;
    }
    if (videoMode === 'first-frame' && !firstFrameImage) {
      alert('请上传首帧图片');
      return;
    }
    if (videoMode === 'first-last-frame' && (!firstFrameImage || !lastFrameImage)) {
      alert('请上传首帧和尾帧图片');
      return;
    }
    if (videoMode === 'reference' && videoRefImages.length === 0) {
      alert('请上传至少一张参考图');
      return;
    }

    setIsGeneratingVideo(true);
    setVideoLogs([]);
    addVideoLog('🚀 开始生成视频...');

    try {
      const modelInfo = enabledVideoModels.find(m => m.id === selectedVideoModel);
      const provider = modelInfo?.provider || 'volcengine';
      
      // 获取 API 配置
      let videoConfig = null;
      
      if (provider === 'grsai') {
        // GRSai: 优先获取视频配置，否则获取图片配置（共享同一个 API Key）
        videoConfig = await getApiConfig('videoGeneration_grsai');
        if (!videoConfig?.model) {
          videoConfig = await getApiConfig('imageGeneration_grsai');
        }
      } else if (provider === 'openrouter') {
        // OpenRouter: 优先获取视频配置，否则获取图片配置
        videoConfig = await getApiConfig('videoGeneration_openrouter');
        if (!videoConfig?.model) {
          videoConfig = await getApiConfig('imageGeneration_openrouter');
        }
      } else {
        videoConfig = await getApiConfig('videoGeneration');
      }
      
      // 服务端代理架构：API Key 由服务端管理，无需客户端校验

      // 使用选择的模型
      const configWithModel = { ...videoConfig, model: selectedVideoModel, provider };
      addVideoLog(`🤖 使用模型: ${modelInfo?.name || selectedVideoModel}`);
      addVideoLog(`🎬 模式: ${videoMode === 'text-to-video' ? '文生视频' : videoMode === 'first-frame' ? '首帧生视频' : videoMode === 'first-last-frame' ? '首尾帧生视频' : '参考图生视频'}`);
      addVideoLog(`📐 分辨率: ${selectedVideoResolution}`);
      addVideoLog(`⏱️ 时长: ${selectedVideoDuration}秒`);

      // 处理图片
      let preparedFirstFrame: string | undefined;
      let preparedLastFrame: string | undefined;
      let preparedRefImages: string[] | undefined;

      const prepareImage = async (img: string): Promise<string | undefined> => {
        // 远程URL直接返回
        if (img.startsWith('http://') || img.startsWith('https://')) {
          addVideoLog(`  ✅ 远程URL图片: ${img}`);
          return img;
        }
        // 本地文件路径转换为Base64
        if (isLocalFilePath(img)) {
          addVideoLog(`  🔄 本地图片转Base64: ${img}`);
          const base64 = await localImageToBase64(img);
          if (base64) {
            addVideoLog(`  ✅ Base64转换成功 (长度: ${base64.length}字符)`);
            return base64;
          }
          addVideoLog(`  ❌ Base64转换失败`);
          return undefined;
        }
        return img;
      };

      if (firstFrameImage) {
        addVideoLog(`📷 首帧图片原始路径: ${firstFrameImage}`);
        addVideoLog('🔄 处理首帧图片...');
        preparedFirstFrame = await prepareImage(firstFrameImage);
        if (preparedFirstFrame) {
          addVideoLog(`  ✅ 首帧处理完成 (${preparedFirstFrame.length}字符)`);
        } else {
          addVideoLog(`  ❌ 首帧处理失败`);
        }
      }
      if (lastFrameImage) {
        addVideoLog('🔄 处理尾帧图片...');
        preparedLastFrame = await prepareImage(lastFrameImage);
      }
      if (videoRefImages.length > 0) {
        addVideoLog(`🔄 处理 ${videoRefImages.length} 张参考图...`);
        const processedImages = await Promise.all(videoRefImages.map(prepareImage));
        preparedRefImages = processedImages.filter((img): img is string => img !== undefined);
      }

      addVideoLog('📤 发送请求到服务端...');
      addVideoLog(`🔊 音频模式: ${enableVideoAudio ? '有声' : '无声（节省一半费用）'}`);
      
      const videoModelInfo = enabledVideoModels.find(m => m.id === selectedVideoModel);
      const videoUrl = await generateVideo({
        prompt: videoPrompt,
        provider: videoModelInfo?.provider,
        model: selectedVideoModel,
        firstFrameImage: preparedFirstFrame,
        lastFrameImage: preparedLastFrame,
        referenceImages: preparedRefImages,
        aspectRatio: selectedVideoAspectRatio,
        duration: selectedVideoDuration,
        enableAudio: enableVideoAudio
      });

      addVideoLog('✅ 视频生成成功!');
      addVideoLog(`🔗 远程URL: ${videoUrl}`);

      // 下载视频到本地
      addVideoLog('💾 下载视频到本地...');
      let downloadedPath: string | null = null;
      try {
        downloadedPath = await downloadVideo(videoUrl, 'home_videos');
        if (downloadedPath) {
          addVideoLog(`✅ 已保存到: ${downloadedPath}`);
          setLocalVideoPath(downloadedPath);
        }
      } catch (downloadError: any) {
        addVideoLog(`⚠️ 下载失败: ${downloadError.message}，使用远程URL播放`);
      }

      // 保存到视频历史记录
      await addHomeVideoHistory(
        downloadedPath || undefined,
        videoUrl,
        videoPrompt,
        selectedVideoModel,
        selectedVideoDuration,
        enableVideoAudio
      );
      
      // 刷新视频历史列表
      addVideoLog('🔄 刷新视频历史列表...');
      await loadVideoHistory();
      addVideoLog('✅ 视频历史列表已刷新');

      setGeneratedVideoUrl(videoUrl);
    } catch (error: any) {
      const errorMsg = error?.message || error?.toString() || '未知错误';
      console.error('视频生成错误:', error);
      addVideoLog(`❌ 错误: ${errorMsg}`);
      alert(`生成失败: ${errorMsg}`);
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  // 上传图片
  const handleUploadImage = async (setter: (url: string) => void) => {
    const path = await uploadImage('temp');
    if (path) setter(path);
  };

  const handleUploadMultiple = async (setter: React.Dispatch<React.SetStateAction<string[]>>, max: number) => {
    const path = await uploadImage('temp');
    if (path) {
      setter(prev => [...prev, path].slice(0, max));
    }
  };

  const currentModel = enabledImageModels.find(m => m.id === selectedImageModel);

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      {/* 标题 */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">AI 创作中心</h1>
        <p className="text-gray-600">一站式 AI 图片和视频生成平台</p>
      </div>

      {/* 三大功能卡片 */}
      <div className="grid grid-cols-3 gap-6 mb-10">
        <button
          onClick={() => setActiveTab('image')}
          className={`p-6 rounded-2xl border-2 transition-all text-left ${
            activeTab === 'image'
              ? 'border-blue-500 bg-blue-50 shadow-lg'
              : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-md'
          }`}
        >
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">生成图片</h3>
          <p className="text-sm text-gray-500">文生图、图生图，支持多种模型</p>
        </button>

        <button
          onClick={() => setActiveTab('video')}
          className={`p-6 rounded-2xl border-2 transition-all text-left ${
            activeTab === 'video'
              ? 'border-purple-500 bg-purple-50 shadow-lg'
              : 'border-gray-200 bg-white hover:border-purple-300 hover:shadow-md'
          }`}
        >
          <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">图生视频</h3>
          <p className="text-sm text-gray-500">首帧、首尾帧、多图参考生成</p>
        </button>

        <button
          onClick={() => navigate('/scripts')}
          className="p-6 rounded-2xl border-2 border-gray-200 bg-white hover:border-green-300 hover:shadow-md transition-all text-left"
        >
          <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">剧集生成</h3>
          <p className="text-sm text-gray-500">管理剧本、查看剧集列表</p>
        </button>
      </div>

      {/* 图片生成区域 */}
      {activeTab === 'image' && (
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">生成图片</h2>
            <div className="flex items-center space-x-4">
              {/* 模型选择 */}
              <select
                value={selectedImageModel}
                onChange={(e) => {
                  setSelectedImageModel(e.target.value);
                  const model = enabledImageModels.find(m => m.id === e.target.value);
                  if (model && model.resolutions && model.resolutions.length > 0) {
                    setSelectedImageSize(model.resolutions[0]);
                  }
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                {enabledImageModels.map(m => (
                  <option key={m.id} value={m.id}>{getModelDisplayText(m.provider, m.id)}</option>
                ))}
              </select>
              {/* 分辨率 */}
              <div className="flex space-x-1">
                {currentModel?.resolutions?.map(res => (
                  <button
                    key={res}
                    onClick={() => setSelectedImageSize(res)}
                    className={`px-3 py-1 text-sm rounded ${
                      selectedImageSize === res ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
              {/* 比例 */}
              <select
                value={selectedAspectRatio}
                onChange={(e) => setSelectedAspectRatio(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {ASPECT_RATIOS.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 参考图 */}
          <div className="mb-4">
            <div className="flex items-center space-x-2 mb-2">
              <span className="text-sm font-medium text-gray-700">参考图（可选）</span>
              <button
                onClick={() => handleUploadMultiple(setRefImages, 4)}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                + 上传图片
              </button>
              <button
                onClick={() => {
                  setHistorySelectorTarget('imageRef');
                  loadImageHistory();
                  setShowImageHistory(true);
                }}
                className="px-3 py-1 text-sm bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
              >
                从历史选择
              </button>
            </div>
            {refImages.length > 0 && (
              <div className="flex gap-2">
                {refImages.map((img, idx) => (
                  <div key={idx} className="relative w-20 h-20">
                    <img src={isLocalFilePath(img) ? (localPathToSrc(img) || undefined) : img} className="w-full h-full object-cover rounded-lg" />
                    <button
                      onClick={() => setRefImages(prev => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 提示词 */}
          <textarea
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            placeholder="输入图片生成提示词..."
            rows={4}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl resize-none focus:ring-2 focus:ring-blue-500 mb-4"
          />

          {/* 生成按钮 */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleGenerateImage}
              disabled={isGeneratingImage}
              className="px-8 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-2"
            >
              {isGeneratingImage ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>生成中...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>生成图片</span>
                </>
              )}
            </button>
          </div>

          {/* 日志和结果 */}
          <div className="mt-6 grid grid-cols-2 gap-6">
            {imageLogs.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-4 max-h-48 overflow-y-auto">
                <div className="text-xs text-gray-400 mb-2">生成日志</div>
                {imageLogs.map((log, idx) => (
                  <div key={idx} className="text-xs text-gray-300 font-mono">{log}</div>
                ))}
              </div>
            )}
            {generatedImageUrl && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-gray-700">生成结果</div>
                  <button
                    onClick={async () => {
                      try {
                        if (isLocalFilePath(generatedImageUrl)) {
                          await exportImageFile(generatedImageUrl);
                        } else {
                          // 如果是URL，需要先保存到本地再下载
                          const localPath = await saveUrlImage(generatedImageUrl);
                          if (localPath) {
                            await exportImageFile(localPath);
                          }
                        }
                      } catch (error) {
                        console.error('下载图片失败:', error);
                        alert('下载失败');
                      }
                    }}
                    className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    下载
                  </button>
                </div>
                <img
                  src={isLocalFilePath(generatedImageUrl) ? (localPathToSrc(generatedImageUrl) || undefined) : generatedImageUrl}
                  className="w-full rounded-lg"
                  alt="Generated"
                />
              </div>
            )}
          </div>

          {/* 图片历史列表 - 按日期分组 */}
          {imageHistoryByDate.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3">生成历史（最近10天）</h3>
              <div className="space-y-2">
                {imageHistoryByDate.map((group) => (
                  <div key={group.date} className="bg-gray-50 rounded-lg overflow-hidden">
                    <div 
                      className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-100 transition"
                      onClick={() => toggleImageDate(group.date)}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`transition-transform ${expandedImageDates.has(group.date) ? 'rotate-90' : ''}`}>
                          ▶
                        </span>
                        <span className="text-sm font-medium text-gray-600">{group.date}</span>
                        <span className="text-xs text-gray-400">({group.images.length}张)</span>
                      </div>
                    </div>
                    {expandedImageDates.has(group.date) && (
                      <div className="px-3 pb-3">
                        <div className="grid grid-cols-6 gap-2">
                          {group.images.map((item) => (
                            <div key={item.id} className="relative group">
                              <img
                                src={localPathToSrc(item.localPath) || undefined}
                                className="w-full h-20 object-cover rounded-lg cursor-pointer hover:ring-2 hover:ring-blue-400"
                                alt={item.prompt || 'History'}
                                onClick={() => handleDownloadHistoryImage(item)}
                                title="点击下载"
                              />
                              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 视频生成区域 */}
      {activeTab === 'video' && (
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">视频生成</h2>
            <div className="flex items-center space-x-4">
              {/* 模型选择 */}
              <select
                value={selectedVideoModel}
                onChange={(e) => {
                  setSelectedVideoModel(e.target.value);
                  const model = enabledVideoModels.find(m => m.id === e.target.value);
                  if (model) {
                    if (model.resolutions && model.resolutions.length > 0) {
                      setSelectedVideoResolution(model.resolutions[model.resolutions.length - 1]);
                    }
                    if ('durations' in model && Array.isArray((model as any).durations) && (model as any).durations.length > 0) {
                      setSelectedVideoDuration((model as any).durations[0]);
                    }
                  }
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
              >
                                {enabledVideoModels.map(m => (
                  <option key={m.id} value={m.id}>{getModelDisplayText(m.provider, m.id)}</option>
                ))}
              </select>
              {/* 分辨率选择 */}
              <div className="flex space-x-1">
                {enabledVideoModels.find(m => m.id === selectedVideoModel)?.resolutions?.map(res => (
                  <button
                    key={res}
                    onClick={() => setSelectedVideoResolution(res)}
                    className={`px-3 py-1 text-sm rounded ${
                      selectedVideoResolution === res ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {selectedVideoModel.startsWith('grsai') ? (res === 'small' ? '标清' : '高清') : res}
                  </button>
                ))}
              </div>
              {/* 时长选择 */}
              <select
                value={selectedVideoDuration}
                onChange={(e) => setSelectedVideoDuration(Number(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
              >
                {((enabledVideoModels.find(m => m.id === selectedVideoModel) as any)?.durations || [5, 10]).map((dur: number) => (
                  <option key={dur} value={dur}>{dur}s</option>
                ))}
              </select>
              {/* 宽高比选择 */}
              <select
                value={selectedVideoAspectRatio}
                onChange={(e) => setSelectedVideoAspectRatio(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                {ASPECT_RATIOS.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              {/* 声音选择 */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEnableVideoAudio(true)}
                  className={`px-3 py-1 text-sm rounded ${enableVideoAudio ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                  title="生成带声音的视频"
                >
                  🔊 有声
                </button>
                <button
                  onClick={() => setEnableVideoAudio(false)}
                  className={`px-3 py-1 text-sm rounded ${!enableVideoAudio ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                  title="无声视频节省一半费用"
                >
                  🔇 无声
                </button>
              </div>
              {!enableVideoAudio && (
                <span className="text-xs text-green-600 ml-1">节省一半费用</span>
              )}
            </div>
          </div>

          {/* 模式选择 */}
          <div className="flex space-x-2 bg-gray-100 p-1 rounded-lg mb-6">
            <button
              onClick={() => setVideoMode('text-to-video')}
              className={`px-4 py-2 text-sm rounded-md transition ${
                videoMode === 'text-to-video' ? 'bg-white shadow text-purple-600' : 'text-gray-600'
              }`}
            >
              文生视频
            </button>
            <button
              onClick={() => setVideoMode('first-frame')}
              className={`px-4 py-2 text-sm rounded-md transition ${
                videoMode === 'first-frame' ? 'bg-white shadow text-purple-600' : 'text-gray-600'
              }`}
            >
              首帧生视频
            </button>
            <button
              onClick={() => setVideoMode('first-last-frame')}
              className={`px-4 py-2 text-sm rounded-md transition ${
                videoMode === 'first-last-frame' ? 'bg-white shadow text-purple-600' : 'text-gray-600'
              }`}
            >
              首尾帧生视频
            </button>
            <button
              onClick={() => setVideoMode('reference')}
              className={`px-4 py-2 text-sm rounded-md transition ${
                videoMode === 'reference' ? 'bg-white shadow text-purple-600' : 'text-gray-600'
              }`}
            >
              参考图生视频
            </button>
          </div>

          {/* 图片上传区域 - 文生视频模式下隐藏 */}
          {videoMode !== 'text-to-video' && (
            <div className={`grid gap-6 mb-6 ${videoMode === 'reference' ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {/* 首帧 - 仅在非参考图模式下显示 */}
              {videoMode !== 'reference' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    首帧图片 <span className="text-red-500">*</span>
                  </label>
                  {firstFrameImage ? (
                    <div className="relative aspect-video bg-gray-100 rounded-xl overflow-hidden">
                      <img src={isLocalFilePath(firstFrameImage) ? (localPathToSrc(firstFrameImage) || undefined) : firstFrameImage} className="w-full h-full object-cover" />
                      <button
                        onClick={() => setFirstFrameImage(null)}
                        className="absolute top-2 right-2 w-8 h-8 bg-red-500 text-white rounded-full"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleUploadImage(setFirstFrameImage)}
                        className="w-full aspect-video border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:border-purple-400 hover:text-purple-500"
                      >
                        <svg className="w-8 h-8 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-xs">上传图片</span>
                      </button>
                      <button
                        onClick={() => {
                          setHistorySelectorTarget('videoFirst');
                          loadImageHistory();
                          setShowImageHistory(true);
                        }}
                        className="w-full aspect-video border-2 border-dashed border-blue-300 rounded-xl flex flex-col items-center justify-center text-blue-400 hover:border-blue-400 hover:text-blue-500"
                      >
                        <svg className="w-8 h-8 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-xs">从历史选择</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              {/* 尾帧 */}
              {videoMode === 'first-last-frame' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    尾帧图片 <span className="text-red-500">*</span>
                  </label>
                  {lastFrameImage ? (
                    <div className="relative aspect-video bg-gray-100 rounded-xl overflow-hidden">
                      <img src={isLocalFilePath(lastFrameImage) ? (localPathToSrc(lastFrameImage) || undefined) : lastFrameImage} className="w-full h-full object-cover" />
                      <button
                        onClick={() => setLastFrameImage(null)}
                        className="absolute top-2 right-2 w-8 h-8 bg-red-500 text-white rounded-full"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleUploadImage(setLastFrameImage)}
                        className="w-full aspect-video border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:border-purple-400 hover:text-purple-500"
                      >
                        <svg className="w-8 h-8 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-xs">上传图片</span>
                      </button>
                      <button
                        onClick={() => {
                          setHistorySelectorTarget('videoLast');
                          loadImageHistory();
                          setShowImageHistory(true);
                        }}
                        className="w-full aspect-video border-2 border-dashed border-blue-300 rounded-xl flex flex-col items-center justify-center text-blue-400 hover:border-blue-400 hover:text-blue-500"
                      >
                        <svg className="w-8 h-8 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-xs">从历史选择</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              {/* 参考图 */}
              {videoMode === 'reference' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    参考图片 <span className="text-red-500">*</span> (1-4张，提示词中用 @图1、@图2 引用)
                  </label>
                  <div className="grid grid-cols-4 gap-3">
                    {videoRefImages.map((img, idx) => (
                      <div key={idx} className="relative">
                        <div className="aspect-video bg-gray-100 rounded-xl overflow-hidden">
                          <img src={isLocalFilePath(img) ? (localPathToSrc(img) || undefined) : img} className="w-full h-full object-cover" />
                        </div>
                        <div className="absolute bottom-1 left-1 px-2 py-0.5 bg-black/60 text-white text-xs rounded">
                          图{idx + 1}
                        </div>
                        <button
                          onClick={() => setVideoRefImages(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {videoRefImages.length < 4 && (
                      <>
                        <button
                          onClick={() => handleUploadMultiple(setVideoRefImages, 4)}
                          className="aspect-video border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:border-purple-400"
                        >
                          <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span className="text-xs">上传</span>
                        </button>
                        <button
                          onClick={() => {
                            setHistorySelectorTarget('videoRef');
                            loadImageHistory();
                            setShowImageHistory(true);
                          }}
                          className="aspect-video border-2 border-dashed border-blue-300 rounded-xl flex flex-col items-center justify-center text-blue-400 hover:border-blue-400"
                        >
                          <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-xs">历史</span>
                        </button>
                      </>
                    )}
                  </div>
                  {/* 图片标签快捷插入 */}
                  {videoRefImages.length > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-gray-500">点击插入：</span>
                      {videoRefImages.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setVideoPrompt(prev => prev + `@图${idx + 1}`)}
                          className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                        >
                          @图{idx + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* 提示词 */}
          <textarea
            value={videoPrompt}
            onChange={(e) => setVideoPrompt(e.target.value)}
            placeholder="输入视频生成提示词（可选）..."
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl resize-none focus:ring-2 focus:ring-purple-500 mb-4"
          />

          {/* 生成按钮 */}
          <button
            onClick={handleGenerateVideo}
            disabled={isGeneratingVideo}
            className="w-full py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            {isGeneratingVideo ? (
              <>
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>生成视频中...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>生成视频</span>
              </>
            )}
          </button>

          {/* 日志和结果 */}
          <div className="mt-6 grid grid-cols-2 gap-6">
            {videoLogs.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-4 max-h-48 overflow-y-auto">
                <div className="text-xs text-gray-400 mb-2">生成日志</div>
                {videoLogs.map((log, idx) => (
                  <div key={idx} className="text-xs text-gray-300 font-mono">{log}</div>
                ))}
              </div>
            )}
            {generatedVideoUrl && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-gray-700">生成结果</div>
                </div>
                <video 
                  src={localVideoPath ? localVideoPathToSrc(localVideoPath) || generatedVideoUrl : generatedVideoUrl} 
                  controls 
                  className="w-full rounded-lg" 
                />
                {localVideoPath && (
                  <div className="text-xs text-gray-500 mt-2 truncate" title={localVideoPath}>
                    📁 {localVideoPath}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 视频历史列表 */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700">视频历史</h3>
              <span className="text-xs text-gray-400">共 {videoHistoryByDate.reduce((sum, g) => sum + g.videos.length, 0)} 个视频</span>
            </div>
            {videoHistoryByDate.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-xl">
                暂无视频历史
              </div>
            ) : (
              <div className="space-y-2">
                {videoHistoryByDate.map((group) => (
                  <div key={group.date} className="bg-gray-50 rounded-lg overflow-hidden">
                    <div 
                      className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-100 transition"
                      onClick={() => toggleVideoDate(group.date)}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`transition-transform ${expandedVideoDates.has(group.date) ? 'rotate-90' : ''}`}>
                          ▶
                        </span>
                        <span className="text-sm font-medium text-gray-600">{group.date}</span>
                        <span className="text-xs text-gray-400">({group.videos.length}个)</span>
                      </div>
                    </div>
                    {expandedVideoDates.has(group.date) && (
                      <div className="px-3 pb-3">
                        <div className="grid grid-cols-2 gap-3">
                          {group.videos.map((video) => (
                            <div key={video.id} className="bg-white rounded-lg p-3 hover:shadow transition">
                              <div className="relative aspect-video bg-black rounded overflow-hidden mb-2">
                                <video 
                                  src={video.localPath ? localVideoPathToSrc(video.localPath) || undefined : video.remoteUrl || undefined}
                                  controls
                                  className="w-full h-full object-contain"
                                />
                                {video.hasAudio && (
                                  <div className="absolute top-1 right-1 bg-purple-500 text-white text-xs px-1.5 py-0.5 rounded">
                                    🔊
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="text-xs text-gray-500 truncate flex-1" title={video.prompt || '无提示词'}>
                                  {video.prompt || '无提示词'}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={async () => {
                                      try {
                                        if (video.localPath) {
                                          await invoke('open_local_file', { path: video.localPath });
                                        } else if (video.remoteUrl) {
                                          window.open(video.remoteUrl, '_blank');
                                        } else {
                                          alert('没有可播放的视频');
                                        }
                                      } catch (err: any) {
                                        const errorMsg = err?.message || err?.toString() || '未知错误';
                                        alert(`打开失败: ${errorMsg}`);
                                      }
                                    }}
                                    className="px-2 py-1 text-[10px] bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition"
                                  >
                                    ▶ 播放器
                                  </button>
                                  {video.localPath && (
                                    <button
                                      onClick={async () => {
                                        try {
                                          await exportImageFile(video.localPath!, `视频_${video.id}_${Date.now()}.mp4`);
                                        } catch (err: any) {
                                          const errorMsg = err?.message || err?.toString() || '未知错误';
                                          alert(`下载失败: ${errorMsg}`);
                                        }
                                      }}
                                      className="px-2 py-1 text-[10px] bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition"
                                    >
                                    ⬇️ 下载
                                    </button>
                                  )}
                                  <button
                                    onClick={async () => {
                                      const confirmed = confirm('确定删除此视频记录？');
                                      if (!confirmed) return;
                                      await deleteHomeVideoHistory(video.id);
                                      await loadVideoHistory();
                                    }}
                                    className="ml-1 text-xs text-red-400 hover:text-red-600"
                                  >
                                    🗑
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 图片历史选择器弹窗 */}
      {showImageHistory && historySelectorTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">选择历史图片</h3>
              <button
                onClick={() => {
                  setShowImageHistory(false);
                  setHistorySelectorTarget(null);
                }}
                className="w-8 h-8 text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            {imageHistoryByDate.length === 0 ? (
              <div className="text-center py-8 text-gray-500">暂无历史图片</div>
            ) : (
              <div className="space-y-4">
                {imageHistoryByDate.map((group) => (
                  <div key={group.date}>
                    <div className="text-sm font-medium text-gray-600 mb-2">
                      {group.date} ({group.images.length}张)
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {group.images.map((item) => (
                        <div
                          key={item.id}
                          className="cursor-pointer hover:ring-2 hover:ring-blue-400 rounded-lg overflow-hidden"
                          onClick={() => handleSelectFromHistory(item)}
                        >
                          <img
                            src={localPathToSrc(item.localPath) || ''}
                            className="w-full h-28 object-cover"
                            alt={item.prompt || 'History'}
                          />
                          <div className="p-2 bg-gray-50">
                            <div className="text-xs text-gray-600 truncate">
                              {item.prompt || '无提示词'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
