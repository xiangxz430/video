import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import AssetLibrary from '../components/AssetLibrary';
import ScriptEditor from '../components/ScriptEditor';
import VideoEditModal from '../components/VideoEditModal';

import { generateVideo, VideoGenParams, generateImage, ImageGenParams, generateStoryboardScript, buildCharacterPrompt, generateSceneImage } from '../services/aiService';
import { generateVideo as serverGenerateVideo, type GenerateVideoParams } from '../services/serverApiClient';
import { checkFFmpeg, mergeVideos } from '../services/videoService';
import { downloadVideo, localVideoPathToSrc, saveUrlImage, localPathToSrc, localImageToBase64, isLocalFilePath, uploadImage } from '../services/fileService';
import { saveImageHistory, getImageHistory, ImageHistory, getScript, getGeneratedImageHistory, getAllImageHistoryByDate, addGeneratedImageHistory, GeneratedImageHistory, ImageHistoryByDate, saveEpisodeCharacterOutfit, getEpisodeCharacterOutfits, deleteSegment as dbDeleteSegment, createSegment as dbCreateSegment, getSegmentsByEpisode, getScenesByScript, getCharactersByScript } from '../services/database';
import { getEnabledModels, ModelInfo, findApiConfigForModel, getBestConfig } from '../utils/modelConfig';
import { getImageConfigForModel } from '../utils/imageConfigUtils';
import { parseSegmentContent } from '../utils/segmentUtils';
import { getAspectRatioStyle } from '../utils/aspectRatioUtils';
import { DEFAULT_SHOT_DURATION } from '../constants';
import type { ApiConfig } from '../types';

// 前端本地分镜类型（兼容旧代码 + 新扁平结构）
interface LocalSegment {
  id: number;                    // 前端序号
  dbId?: number;                 // 数据库ID
  duration: number;              // 时长
  scene?: string;                // 场景名
  description?: string;          // 描述
  shots?: any[];                 // 兼容旧代码，包装成数组 [shot]
  status?: string;               // 状态
  // Shot 的所有字段（可选）
  [key: string]: any;            // 允许任意字段
}

/**
 * 辅助函数：从 localSegment 中提取 shots 数组（兼容扁平结构）
 * 优先使用 segment.shots（兼容包装），其次解析 content
 */
function extractShotsFromSegment(segment: LocalSegment): any[] {
  // 优先使用已解析的 shots 数组（兼容包装）
  if (segment.shots && segment.shots.length > 0) {
    return [...segment.shots];
  }
  // 如果有 content 字段，尝试解析
  if (segment.content) {
    const segmentData = parseSegmentContent(segment.content);
    if (segmentData.shots && segmentData.shots.length > 0) {
      return [...segmentData.shots];
    }
    return [segmentData];
  }
  // 都没有，返回 segment 本身
  return [{ ...segment, shots: undefined, id: undefined, dbId: undefined }];
}

/**
 * 辅助函数：构建保存到数据库的 content JSON
 * 扁平结构下，shot 字段展开到顶层，同时保留 shots 数组兼容
 */
function buildSegmentContent(segmentData: any, updatedShots: any[], shotIndex: number): string {
  return JSON.stringify({
    ...segmentData,
    ...updatedShots[shotIndex],  // 展开 shot 字段到顶层
    shots: updatedShots          // 保留 shots 数组兼容旧代码
  });
}

const EpisodeEdit: React.FC = () => {
  const navigate = useNavigate();
  const { episodeId } = useParams();
  const { 
    episodes, 
    characters, 
    scenes, 
    segments, 
    loadSegments, 
    updateSegment, 
    updateEpisode, 
    updateCharacter,
    updateScene,
    apiConfigs,
    currentScript,
    loadEpisodes
  } = useApp();
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0);
  const [localSegments, setLocalSegments] = useState<LocalSegment[]>([]);
  const isUpdatingFromDb = useRef(false); // 使用 ref 来同步跟踪数据库更新状态
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [merging, setMerging] = useState(false);
  
  // 切换分镜时重置 shotIndex，避免越界
  const handleSelectSegment = (index: number) => {
    setSelectedSegmentIndex(index);
    // 检查新segment是否有shots，如果没有则设置为-1
    const newSegment = localSegments[index];
    const segData = newSegment ? parseSegmentContent(newSegment.content || '{}') : null;
    const hasShots = segData?.shots && segData.shots.length > 0;
    setSelectedShotIndex(hasShots ? 0 : -1);
  };
  const [mergedVideoPath, setMergedVideoPath] = useState<string | null>(null);
  
  // 视频生成模式: 'text' | 'first-frame' | 'first-last-frame'
  const [videoGenMode, setVideoGenMode] = useState<'text' | 'first-frame' | 'first-last-frame'>('first-frame');
  const [selectedFirstFrame, setSelectedFirstFrame] = useState<string | null>(null);
  const [selectedLastFrame, setSelectedLastFrame] = useState<string | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState('16:9');
  const [enableVideoAudio, setEnableVideoAudio] = useState(true); // 视频是否生成声音
  
  // 图片生成状态
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generatingType, setGeneratingType] = useState<'character' | 'scene' | null>(null);
  
  // 分镜视频生成状态
  const [generatingShotIndex, setGeneratingShotIndex] = useState<number | null>(null);
  // 选中的分镜索引用于视频预览
  const [selectedShotIndex, setSelectedShotIndex] = useState(0);
  // 帧图片生成状态
  const [generatingFrameShotIndex, setGeneratingFrameShotIndex] = useState<number | null>(null);
  const [generatingFrameType, setGeneratingFrameType] = useState<'first' | 'last' | null>(null);
  
  // 重新生成分镜状态
  const [regeneratingStoryboard, setRegeneratingStoryboard] = useState(false);
  const [storyboardProgress, setStoryboardProgress] = useState('');
  const [storyboardContent, setStoryboardContent] = useState('');  // 流式内容
  
  // 图片生成模型选择状态
  const [selectedImageModel, setSelectedImageModel] = useState('');
  const [selectedImageSize, setSelectedImageSize] = useState('2K');
  const [availableImageModels, setAvailableImageModels] = useState<ModelInfo[]>([]);
  
  // 动态加载可用的图片模型
  useEffect(() => {
    if (apiConfigs && apiConfigs.length > 0) {
      const models = getEnabledModels(apiConfigs, 'imageGeneration');
      setAvailableImageModels(models);
      // 设置默认选中的模型
      if (models.length > 0 && !selectedImageModel) {
        setSelectedImageModel(models[0].id);
        if (models[0].resolutions && models[0].resolutions.length > 0) {
          setSelectedImageSize(models[0].resolutions[0]);
        }
      }
    }
  }, [apiConfigs]);
  
  // 视频生成模型选择状态
  const [selectedVideoModel, setSelectedVideoModel] = useState('');
  const [availableVideoModels, setAvailableVideoModels] = useState<ModelInfo[]>([]);
  
  // 备用视频生成模型列表（确保百炼等硬编码模型始终可见）
  const VIDEO_MODELS_FALLBACK: ModelInfo[] = [
    { id: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro', provider: 'volcengine', capability: 'videoGeneration' },
    { id: 'dashscope/wan2.7', name: 'Wan 2.7 (百炼直连)', provider: 'dashscope', capability: 'videoGeneration' },
    { id: 'dashscope/happyhorse-1.0', name: 'HappyHorse 1.0 (百炼)', provider: 'dashscope', capability: 'videoGeneration' },
    { id: 'dashscope/happyhorse-1.0-video-edit', name: 'HappyHorse 视频编辑', provider: 'dashscope', capability: 'videoGeneration' },
  ];

  // 动态加载可用的视频模型（与硬编码备用列表合并）
  useEffect(() => {
    if (apiConfigs && apiConfigs.length > 0) {
      const configModels = getEnabledModels(apiConfigs, 'videoGeneration');
      if (configModels.length > 0) {
        // 合并：apiConfigs 中的模型 + 备用列表中不重复的模型
        const configModelIds = new Set(configModels.map(m => m.id));
        const extraModels = VIDEO_MODELS_FALLBACK.filter(m => !configModelIds.has(m.id));
        setAvailableVideoModels([...configModels, ...extraModels]);
      } else {
        setAvailableVideoModels(VIDEO_MODELS_FALLBACK);
      }
      // 设置默认选中的模型
      if (configModels.length > 0 && !selectedVideoModel) {
        setSelectedVideoModel(configModels[0].id);
      } else if (!selectedVideoModel) {
        setSelectedVideoModel(VIDEO_MODELS_FALLBACK[0].id);
      }
    } else {
      setAvailableVideoModels(VIDEO_MODELS_FALLBACK);
      if (!selectedVideoModel) {
        setSelectedVideoModel(VIDEO_MODELS_FALLBACK[0].id);
      }
    }
  }, [apiConfigs]);
  
  // 选择图片状态
  const [selectingFrameShotIndex, setSelectingFrameShotIndex] = useState<number | null>(null);
  const [selectingFrameType, setSelectingFrameType] = useState<'first' | 'last' | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  
  // 历史生成图片状态
  const [generatedImageHistory, setGeneratedImageHistory] = useState<GeneratedImageHistory[]>([]);
  const [imageHistoryByDate, setImageHistoryByDate] = useState<ImageHistoryByDate[]>([]);
  const [imagePickerTab, setImagePickerTab] = useState<'character' | 'scene' | 'history'>('character');
  
  // 角色穿着选择状态（characterId -> outfitIndex，null表示主图）
  const [selectedOutfits, setSelectedOutfits] = useState<{ [characterId: number]: number | null }>({});
  
  // 生成日志状态
  const [generationLogs, setGenerationLogs] = useState<string[]>([]);
  const [showGenerationLogs, setShowGenerationLogs] = useState(false);
  const [logsCollapsed, setLogsCollapsed] = useState(true); // 日志默认折叠
  const logsContainerRef = useRef<HTMLDivElement>(null); // 日志容器引用
  const shouldAutoScrollRef = useRef(true); // 是否应该自动滚动

  // 参考图预览确认弹窗状态
  const [refPreviewModal, setRefPreviewModal] = useState<{
    show: boolean;
    title: string;
    items: Array<{ name: string; path: string }>;
    prompt?: string;
  } | null>(null);
  const refPreviewResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  
  // 视频编辑弹窗状态
  const [videoEditModalOpen, setVideoEditModalOpen] = useState(false);
  const [editingVideoUrl, setEditingVideoUrl] = useState<string | undefined>(undefined);
  const [isVideoEditing, setIsVideoEditing] = useState(false);

  // 处理视频编辑提交
  const handleVideoEditSubmit = async (params: {
    inputVideo: string;
    prompt: string;
    referenceImages?: string[];
    resolution: '720P' | '1080P';
    audioSetting: 'auto' | 'origin';
  }) => {
    setIsVideoEditing(true);
    try {
      const videoUrl = await serverGenerateVideo({
        prompt: params.prompt,
        provider: 'dashscope',
        model: 'happyhorse-1.0-video-edit',
        inputVideo: params.inputVideo,
        referenceImages: params.referenceImages,
        size: params.resolution === '720P' ? '720p' : '1080p',
        audioSetting: params.audioSetting === 'origin' ? { mode: 'preserve' } : { mode: 'auto' },
      });

      console.log('视频编辑成功，URL:', videoUrl);

      // 下载视频到本地
      let localVideoPath: string | null = null;
      try {
        localVideoPath = await downloadVideo(videoUrl, 'edited');
        console.log('编辑视频下载成功，本地路径:', localVideoPath);
      } catch (downloadError: any) {
        console.error('编辑视频下载失败:', downloadError.message);
      }

      const finalVideoUrl = localVideoPath ? localVideoPathToSrc(localVideoPath) : videoUrl;
      alert('视频编辑成功！');
      setVideoEditModalOpen(false);
      setEditingVideoUrl(undefined);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      console.error('视频编辑失败:', error);
      alert(`视频编辑失败: ${errorMsg}`);
    } finally {
      setIsVideoEditing(false);
    }
  };

  // 打开视频编辑弹窗（从已有视频入口）
  const handleOpenVideoEdit = (videoUrl?: string) => {
    setEditingVideoUrl(videoUrl);
    setVideoEditModalOpen(true);
  };
  
  // 添加日志
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setGenerationLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    console.log(message);
    
    // 自动滚动到底部（延迟执行以确保 DOM 已更新）
    setTimeout(() => {
      if (logsContainerRef.current && shouldAutoScrollRef.current) {
        logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
      }
    }, 50);
  };
  
  // 清除日志
  const clearLogs = () => {
    setGenerationLogs([]);
  };

  // 获取视频生成配置（使用统一函数）
  const videoConfig = getBestConfig(apiConfigs, 'videoGeneration');

  // 当前集的信息
  const currentEpisode = episodes.find(e => e.id === Number(episodeId));

  // 生成角色图片
  const handleGenerateCharacterImage = async (characterId: number, characterName: string) => {
    const character = characters.find(c => c.id === characterId);
    if (!character || !character.description) {
      alert('该角色没有描述信息，无法生成图片');
      return;
    }
    
    setGeneratingId(characterId);
    setGeneratingType('character');
    
    try {
      const imageConfig = await getImageConfigForModel(selectedImageModel, availableImageModels);
      // 服务端代理架构：API Key 由服务端管理
      addLog(`🤖 使用模型: ${availableImageModels.find((m: any) => m.id === selectedImageModel)?.name}`);
      addLog(`🔧 Provider: ${imageConfig?.provider || 'unknown'}`);
      
      // 角色图提示词（使用统一构建函数）
      const characterPrompt = buildCharacterPrompt(character.description);
      
      const params: ImageGenParams = {
        prompt: characterPrompt,
        model: selectedImageModel,
        size: selectedImageSize,
        aspectRatio: '16:9'
      };
      
      console.log('生成角色图片，提示词:', characterPrompt);
      const imageUrl = await generateImage(params, imageConfig);
      console.log('角色图片生成成功:', imageUrl);
      
      // 下载图片到本地
      let localPath: string | null = null;
      try {
        localPath = await saveUrlImage(imageUrl, 'characters');
        if (!localPath) {
          throw new Error('保存返回空路径');
        }
        console.log('角色图片保存成功:', localPath);
      } catch (saveError: any) {
        console.error('角色图片保存失败:', saveError.message);
        alert(`图片生成成功但保存失败: ${saveError.message}\n图片URL: ${imageUrl}\n请手动下载保存`);
        return; // 保存失败则不更新数据库
      }
      
      // 保存到图片历史记录
      await saveImageHistory('character', characterId, characterName, imageUrl, localPath, characterPrompt);
      console.log('角色图片已保存到历史记录');
      
      // 也保存到统一历史
      await addGeneratedImageHistory(localPath, characterPrompt, selectedImageModel, selectedImageSize, '16:9', 'character', characterId);
      console.log('角色图片已保存到统一历史记录');
      
      // 更新角色当前图片
      if (localPath) {
        await updateCharacter(characterId, { imageUrl: localPath });
        console.log('角色图片已更新到数据库');
      }
    } catch (error: any) {
      console.error('生成角色图片失败:', error);
      const errorMsg = error?.message || error?.toString() || '未知错误';
      alert(`生成失败: ${errorMsg}`);
    } finally {
      setGeneratingId(null);
      setGeneratingType(null);
    }
  };

  // 生成场景图片
  const handleGenerateSceneImage = async (sceneId: number, sceneName: string) => {
    const scene = scenes.find(s => s.id === sceneId);
    if (!scene || !scene.description) {
      alert('该场景没有描述信息，无法生成图片');
      return;
    }
    
    setGeneratingId(sceneId);
    setGeneratingType('scene');
    
    try {
      const imageConfig = await getImageConfigForModel(selectedImageModel, availableImageModels);
      // 服务端代理架构：API Key 由服务端管理
      addLog(`🤖 使用模型: ${availableImageModels.find((m: any) => m.id === selectedImageModel)?.name}`);
      addLog(`🔧 Provider: ${imageConfig?.provider || 'unknown'}`);
      
      // 场景图生成（服务端自动构建四视角转台图提示词）
      console.log('生成场景图片，描述:', scene.description);
      const imageUrl = await generateSceneImage(scene.description, imageConfig);
      console.log('场景图片生成成功:', imageUrl);
      
      // 下载图片到本地
      let localPath: string | null = null;
      try {
        localPath = await saveUrlImage(imageUrl, 'scenes');
        if (!localPath) {
          throw new Error('保存返回空路径');
        }
        console.log('场景图片保存成功:', localPath);
      } catch (saveError: any) {
        console.error('场景图片保存失败:', saveError.message);
        alert(`图片生成成功但保存失败: ${saveError.message}\n图片URL: ${imageUrl}\n请手动下载保存`);
        return; // 保存失败则不更新数据库
      }
      
      // 保存到图片历史记录
      await saveImageHistory('scene', sceneId, sceneName, imageUrl, localPath, scene.description);
      console.log('场景图片已保存到历史记录');
      
      // 也保存到统一历史
      await addGeneratedImageHistory(localPath, scene.description, selectedImageModel, selectedImageSize, '16:9', 'scene', sceneId);
      console.log('场景图片已保存到统一历史记录');
      
      // 更新场景当前图片
      if (localPath) {
        await updateScene(sceneId, { imageUrl: localPath });
        console.log('场景图片已更新到数据库');
      }
    } catch (error: any) {
      console.error('生成场景图片失败:', error);
      const errorMsg = error?.message || error?.toString() || '未知错误';
      alert(`生成失败: ${errorMsg}`);
    } finally {
      setGeneratingId(null);
      setGeneratingType(null);
    }
  };

  // 加载分集
  useEffect(() => {
    if (episodeId) {
      loadSegments(Number(episodeId));
      // 预加载历史图片数据
      loadGeneratedImageHistory();
      // 加载角色穿着选择
      loadCharacterOutfits();
    }
  }, [episodeId, loadSegments]);
  
  // 加载角色穿着选择
  const loadCharacterOutfits = async () => {
    if (!episodeId) return;
    try {
      const outfits = await getEpisodeCharacterOutfits(Number(episodeId));
      const outfitsMap: { [characterId: number]: number | null } = {};
      outfits.forEach(outfit => {
        outfitsMap[outfit.characterId] = outfit.outfitIndex;
      });
      setSelectedOutfits(outfitsMap);
    } catch (error) {
      console.error('加载角色穿着选择失败:', error);
    }
  };

  // 将数据库 segments 转换为 UI 需要的格式
  useEffect(() => {
    // 如果正在从本地更新保存到数据库，不要重置 localSegments
    if (isUpdatingFromDb.current) {
      isUpdatingFromDb.current = false;
      return;
    }
    
    if (segments.length > 0) {
      // 新的扁平结构：每个 segment 就是一个 shot
      // parseSegmentContent 已经将 shot 包装成 shots 数组
      const mapped = segments.map((seg, i) => {
        const shot = parseSegmentContent(seg.content);
        return {
          id: i + 1,
          dbId: seg.id,
          content: seg.content,  // 保留原始 content，用于数据库保存时读取
          duration: shot.duration || seg.endTime - seg.startTime || DEFAULT_SHOT_DURATION,
          status: shot.status || 'generated',
          ...shot  // 包含 scene, description, shots 等所有字段
        };
      });
      setLocalSegments(mapped);
    } else {
      // 没有数据时显示一个空占位符
      setLocalSegments([{ id: 1, duration: 0, status: 'pending' }]);
    }
  }, [segments]);  // isUpdatingFromDb 是 ref，不应作为依赖

  // 处理生成单个分镜
  const handleGenerateSegment = async (segmentId: number) => {
    // 找到对应的分镜
    const segment = localSegments.find(s => s.id === segmentId);
    if (!segment) return;

    // 更新状态为生成中
    setLocalSegments(prev =>
      prev.map(seg =>
        seg.id === segmentId ? { ...seg, status: 'generating', videoUrl: undefined, error: undefined } : seg
      )
    );

    try {
      // 检查是否有视频生成配置
      if (!videoConfig) {
        throw new Error('未找到视频生成配置，请在服务端管理后台检查 Provider 配置');
      }

      // 构建提示词：结合分镜描述和角色信息
      const segmentCharacters = characters.filter(c => 
        segment.shots?.some((shot: any) => shot.characters?.includes(c.name))
      );
      const characterNames = segmentCharacters.map(c => c.name).join('、');
      const promptText = `${segment.description}${characterNames ? '，角色：' + characterNames : ''}`;

      // 根据用户选择的模式构建视频生成参数
      const params: VideoGenParams = {
        prompt: promptText,
        aspectRatio: videoAspectRatio
      };

      if (videoGenMode === 'first-frame' && selectedFirstFrame) {
        // 图生视频-首帧模式
        params.firstFrameImage = selectedFirstFrame;
      } else if (videoGenMode === 'first-last-frame' && selectedFirstFrame && selectedLastFrame) {
        // 图生视频-首尾帧模式
        params.firstFrameImage = selectedFirstFrame;
        params.lastFrameImage = selectedLastFrame;
      }
      // 'text' 模式不需要额外的图片参数

      // 添加音频设置
      params.enableAudio = enableVideoAudio;

      // 调用统一视频生成 API（自动根据 provider 路由）
      const videoUrl = await generateVideo(params, videoConfig);
      console.log('视频生成成功，URL:', videoUrl);

      // 下载视频到本地保存
      let localVideoPath: string | null = null;
      const episodeFolder = `episode_${episodeId || 'unknown'}`;
      try {
        localVideoPath = await downloadVideo(videoUrl, episodeFolder);
        console.log('视频下载成功，本地路径:', localVideoPath);
      } catch (downloadError: any) {
        console.error('视频下载失败，使用远程URL:', downloadError.message);
        // 下载失败不影响整体流程，继续使用远程 URL
      }
      
      // 使用本地路径（优先）或远程 URL
      const finalVideoUrl = localVideoPath || videoUrl;
      const finalVideoSrc = localVideoPath ? localVideoPathToSrc(localVideoPath) : finalVideoUrl;

      // 更新分镜状态和视频 URL
      setLocalSegments(prev =>
        prev.map(seg =>
          seg.id === segmentId ? { ...seg, status: 'generated', videoUrl: finalVideoSrc, localVideoPath } : seg
        )
      );

      // 保存到数据库
      if (segment.dbId) {
        isUpdatingFromDb.current = true
        const segmentData = parseSegmentContent(segment.content || '{}');
        await updateSegment(segment.dbId, {
          content: JSON.stringify({
            ...segmentData,
            status: 'generated',
            videoUrl: finalVideoSrc,
            localVideoPath
          })
        });
      }
    } catch (error: any) {
      console.error('视频生成失败:', error);
      // 更新状态为失败
      setLocalSegments(prev =>
        prev.map(seg =>
          seg.id === segmentId ? { ...seg, status: 'failed', error: error.message || '生成失败' } : seg
        )
      );
    }
  };

  const handleRetrySegment = (segmentId: number) => {
    handleGenerateSegment(segmentId);
  };

  // 生成分镜首帧图片
  const handleGenerateFirstFrame = async (shotIndex: number) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) {
      alert('分镜数据不存在');
      return;
    }

    const imageConfig = await getImageConfigForModel(selectedImageModel, availableImageModels);
    // 服务端代理架构：API Key 由服务端管理

    // 清除旧日志，显示日志面板
    clearLogs();
    setShowGenerationLogs(true);
    
    addLog('🚀 开始生成首帧图片...');
    addLog(`📷 分镜索引: ${shotIndex + 1}`);
    addLog(`🤖 使用模型: ${availableImageModels.find(m => m.id === selectedImageModel)?.name || selectedImageModel}`);
    addLog(`🔧 API配置: ${imageConfig?.provider || 'unknown'}, 模型: ${imageConfig?.model || selectedImageModel}`);

    // 获取剧本名用于图片存储路径（优先使用内存中的 currentScript，避免重复查询数据库）
    let scriptName = currentScript?.title || '未命名剧本';
    if (currentEpisode?.scriptId && !currentScript?.title) {
      const script = await getScript(currentEpisode.scriptId);
      if (script?.title) {
        scriptName = script.title;
      }
    }
    if (scriptName !== '未命名剧本') {
      addLog(`📖 剧本名: ${scriptName}`);
    }

    const shot = segment.shots[shotIndex];
    setGeneratingFrameShotIndex(shotIndex);
    setGeneratingFrameType('first');

    try {
      // 收集参考图片（场景图片+角色图片，支持多图输入）
      const referenceImages: string[] = [];
      const referenceImageNames: string[] = []; // 用于日志显示
      let sceneDescription = '';
      let characterDescriptions: string[] = [];
      
      // 辅助函数：将图片路径转换为API可用的格式（URL或Base64）
      const prepareImageForApi = async (url: string): Promise<string | undefined> => {
        // 远程URL直接返回
        if (url.startsWith('http://') || url.startsWith('https://')) {
          addLog(`  ✅ 远程URL图片: ${url}`);
          return url;
        }
        // 本地文件路径转换为Base64
        if (isLocalFilePath(url)) {
          addLog(`  🔄 本地图片转Base64: ${url}`);
          const base64 = await localImageToBase64(url);
          if (base64) {
            addLog(`  ✅ Base64转换成功 (长度: ${base64.length}字符)`);
            return base64;
          }
          addLog(`  ❌ Base64转换失败`);
        }
        return undefined;
      };
      
      addLog('');
      addLog('📥 收集参考图片...');
      
      // 判断是否使用分镜自己的参考图
      const hasShotRefImage = shot.firstFrameRefImage && shot.firstFrameRefImage.trim();
      const refMode = shot.firstFrameRefMode || 'ref-with-scene-char';
      
      // 同步收集原始路径，用于预览确认
      const previewItems: Array<{ name: string; path: string }> = [];
      
      // 1. 如果有分镜参考图且是 only-ref 模式，只使用参考图
      if (hasShotRefImage && refMode === 'only-ref') {
        addLog('📷 参考模式: 只看参考图');
        previewItems.push({ name: '分镜参考图', path: shot.firstFrameRefImage! });
        const preparedImage = await prepareImageForApi(shot.firstFrameRefImage!);
        if (preparedImage) {
          referenceImages.push(preparedImage);
          referenceImageNames.push('分镜参考图');
          addLog('✅ 已添加分镜参考图');
        } else {
          addLog('❌ 分镜参考图处理失败');
        }
      } else {
        // 2. 否则收集场景和角色图片
        addLog('📷 参考模式: 同时参考角色和场景');
        
        // 1.1 获取场景信息和图片
        if (shot.scene) {
          const scene = scenes.find(s => s.name === shot.scene);
          if (scene) {
            addLog(`🎬 场景: ${scene.name}`);
            // 添加场景图片到参考图片列表
            if (scene.imageUrl) {
              addLog(`  📷 场景图片路径: ${scene.imageUrl}`);
              previewItems.push({ name: `场景图[${scene.name}]`, path: scene.imageUrl });
              const preparedImage = await prepareImageForApi(scene.imageUrl);
              if (preparedImage) {
                referenceImages.push(preparedImage);
                referenceImageNames.push(`场景图[${scene.name}]`);
                addLog(`  ✅ 已添加场景图片到参考列表`);
              } else {
                addLog(`  ❌ 场景图片处理失败`);
              }
            } else {
              addLog(`  ⚠️ 场景没有图片`);
            }
            if (scene.description) {
              sceneDescription = scene.description;
            }
          } else {
            addLog(`  ⚠️ 未找到场景: ${shot.scene}`);
          }
        } else {
          addLog(`  ℹ️ 分镜未指定场景`);
        }
        
        // 1.2 获取角色信息和图片（添加所有角色的图片）
        if (shot.characters && shot.characters.length > 0) {
          addLog('');
          addLog(`👥 角色列表: ${shot.characters.join(', ')}`);
          for (const charName of shot.characters) {
            const character = characters.find(c => c.name === charName);
            if (character) {
              // 获取角色当前选中的图片（主图或副图）
              const characterImage = getCharacterCurrentImage(character.id || 0);
              const outfitIndex = selectedOutfits[character.id || 0];
              const outfitName = outfitIndex !== null && character.alternativeImages?.[outfitIndex]
                ? character.alternativeImages[outfitIndex].name
                : '主图';
              
              // 添加角色图片到参考图片列表
              if (characterImage) {
                addLog(`  📷 角色[${charName}]穿着: ${outfitName}`);
                addLog(`  📷 图片路径: ${characterImage}`);
                previewItems.push({ name: `角色图[${charName}-${outfitName}]`, path: characterImage });
                const preparedImage = await prepareImageForApi(characterImage);
                if (preparedImage) {
                  referenceImages.push(preparedImage);
                  referenceImageNames.push(`角色图[${charName}-${outfitName}]`);
                  addLog(`  ✅ 已添加角色图片到参考列表`);
                } else {
                  addLog(`  ❌ 角色图片处理失败`);
                }
              } else {
                addLog(`  ⚠️ 角色[${charName}]没有图片`);
              }
              if (character.description) {
                characterDescriptions.push(`${charName}：${character.description}`);
              }
            } else {
              addLog(`  ⚠️ 未找到角色: ${charName}`);
            }
          }
        } else {
          addLog(`  ℹ️ 分镜未指定角色`);
        }
        
        // 1.3 如果有分镜参考图，也添加到参考列表
        if (hasShotRefImage) {
          addLog('');
          addLog('📷 额外添加分镜参考图');
          previewItems.push({ name: '分镜参考图', path: shot.firstFrameRefImage! });
          const preparedImage = await prepareImageForApi(shot.firstFrameRefImage!);
          if (preparedImage) {
            referenceImages.push(preparedImage);
            referenceImageNames.push('分镜参考图');
            addLog('✅ 已添加分镜参考图');
          } else {
            addLog('❌ 分镜参考图处理失败');
          }
        }
      }
      
      addLog('');
      addLog(`📊 参考图片统计: ${referenceImages.length}张`);
      if (referenceImageNames.length > 0) {
        addLog(`📋 参考图片列表: ${referenceImageNames.join(', ')}`);
      }

      // ---- 弹出参考图预览确认 ----
      if (previewItems.length > 0) {
        const confirmed = await new Promise<boolean>((resolve) => {
          refPreviewResolveRef.current = resolve;
          setRefPreviewModal({
            show: true,
            title: `首帧生成 - 分镜 ${shotIndex + 1} 参考图确认`,
            items: previewItems,
          });
        });
        if (!confirmed) {
          setGeneratingFrameShotIndex(null);
          setGeneratingFrameType(null);
          return;
        }
      }
      
      // 3. 构建结构化的首帧提示词
      const promptParts: string[] = [];
      
      // 首先是原有分镜脚本内容（核心描述）
      if (shot.description) {
        promptParts.push(shot.description);
      }
      
      // 提示词中标注参考图片
      if (referenceImages.length > 0) {
        promptParts.push('请参考附带的素材图片生成画面。');
      }
      
      // 场景描述
      if (sceneDescription) {
        promptParts.push(`场景：${sceneDescription}`);
      } else if (shot.scene) {
        promptParts.push(`场景：${shot.scene}`);
      }
      
      // 角色描述
      if (characterDescriptions.length > 0) {
        promptParts.push(`角色：${characterDescriptions.join('；')}`);
      } else if (shot.characters && shot.characters.length > 0) {
        promptParts.push(`角色：${shot.characters.join('、')}`);
      }
      
      // 风格、情绪、画面类型
      promptParts.push('风格：电影级质感，影视构图，光影层次分明');
      promptParts.push('情绪：故事开场感，有视觉张力');
      promptParts.push('画面类型：视频首帧静帧画面');
      
      // 首帧补充提示词
      if (shot.firstFramePrompt && shot.firstFramePrompt.trim()) {
        promptParts.push(`补充要求：${shot.firstFramePrompt.trim()}`);
      }
      
      const prompt = promptParts.join('\n');

      addLog('');
      addLog('📝 提示词:');
      addLog('─'.repeat(50));
      prompt.split('\n').forEach(line => addLog(`  ${line}`));
      addLog('─'.repeat(50));
      
      addLog('');
      addLog(`📐 宽高比: ${shot.aspectRatio || videoAspectRatio}`);
      addLog(`📏 分辨率: ${selectedImageSize}`);

      const params: ImageGenParams = {
        prompt,
        model: selectedImageModel,
        size: selectedImageSize,
        aspectRatio: shot.aspectRatio || videoAspectRatio,
        // 支持多图输入，如果没有参考图片则不传
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        referenceImageMeta: referenceImages.length > 0
          ? referenceImageNames.map((name, idx) => ({
              fileName: name,
              filePath: `第 ${shotIndex + 1} 分镜参考图 [${idx + 1}] ${name}`
            }))
          : undefined
      };

      addLog('');
      addLog('📤 调用图片生成API...');
      addLog(`  接口: POST /images/generations`);
      addLog(`  模式: ${referenceImages.length > 0 ? '🖼️ 图生图' : '📝 文生图'}`);
      addLog(`  参考图片数: ${referenceImages.length}`);
      
      // 输出详细的API请求体
      addLog('');
      addLog('📋 API请求体:');
      addLog('─'.repeat(50));
      addLog(`  model: ${imageConfig?.model || selectedImageModel}`);
      addLog(`  prompt: ${prompt}`);
      addLog(`  size: ${shot.aspectRatio || videoAspectRatio}`);
      if (referenceImages.length > 0) {
        addLog(`  image: [${referenceImages.length}张图片]`);
        referenceImages.forEach((img, idx) => {
          addLog(`    [${idx + 1}] ${img} (${img.length}字符)`);
        });
      }
      addLog('─'.repeat(50));
      addLog('');
      
      const imageUrl = await generateImage(params, imageConfig);
      addLog(`✅ 图片生成成功!`);
      addLog(`🔗 图片URL: ${imageUrl}`);

      // 下载图片到本地（必须成功，Grsai 图片需要 API Key）
      // 路径结构: images/剧本名/frames/
      const imageSubfolder = `${scriptName}/frames`;
      addLog('');
      addLog(`💾 保存图片到: images/${imageSubfolder}/`);
      let localPath: string | null = null;
      try {
        localPath = await saveUrlImage(imageUrl, imageSubfolder);
        if (!localPath) {
          throw new Error('保存返回空路径');
        }
        addLog(`✅ 图片保存成功: ${localPath}`);
      } catch (saveError: any) {
        addLog(`❌ 图片保存失败: ${saveError.message}`);
        alert(`图片生成成功但保存失败: ${saveError.message}\n图片URL: ${imageUrl}\n请手动下载保存`);
      }

      // 更新分镜数据（通过 dbId 定位，避免异步期间 selectedSegmentIndex 错位）
      const targetDbId = segment.dbId;
      setLocalSegments(prev => {
        const segIdx = prev.findIndex(s => s.dbId === targetDbId);
        if (segIdx === -1) return prev;
        const updatedShots = [...(prev[segIdx].shots || [])];
        updatedShots[shotIndex] = {
          ...(updatedShots[shotIndex] || {}),
          firstFrameImage: imageUrl,
          firstFrameLocalPath: localPath
        };
        return prev.map((seg, idx) =>
          idx === segIdx ? { ...seg, shots: updatedShots } : seg
        );
      });

      // 保存到数据库
      if (segment.dbId) {
        isUpdatingFromDb.current = true;
        const dbShots = extractShotsFromSegment(segment);
        dbShots[shotIndex] = {
          ...(dbShots[shotIndex] || {}),
          firstFrameImage: imageUrl,
          firstFrameLocalPath: localPath
        };
        const segmentData = parseSegmentContent(segment.content || '{}');
        await updateSegment(segment.dbId, {
          content: buildSegmentContent(segmentData, dbShots, shotIndex)
        });
      }

      // 保存到历史图片记录
      if (localPath) {
        try {
          await addGeneratedImageHistory(localPath, prompt, selectedImageModel, selectedImageSize, shot.aspectRatio || videoAspectRatio);
          addLog('✅ 已保存到历史图片');
        } catch (e) {
          console.error('保存到历史图片失败:', e);
        }
      }

      console.log(`分镜 ${shotIndex + 1} 首帧已保存`);
    } catch (error: any) {
      console.error('首帧图片生成失败:', error);
      const errorMsg = error?.message || error?.toString() || '未知错误';
      alert(`生成失败: ${errorMsg}`);
    } finally {
      setGeneratingFrameShotIndex(null);
      setGeneratingFrameType(null);
    }
  };

  // 生成分镜尾帧图片
  const handleGenerateLastFrame = async (shotIndex: number) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) {
      alert('分镜数据不存在');
      return;
    }

    const imageConfig = await getImageConfigForModel(selectedImageModel, availableImageModels);
    // 服务端代理架构：API Key 由服务端管理

    // 清除旧日志，显示日志面板
    clearLogs();
    setShowGenerationLogs(true);
    
    addLog('🚀 开始生成尾帧图片...');
    addLog(`📷 分镜索引: ${shotIndex + 1}`);
    addLog(`🤖 使用模型: ${availableImageModels.find(m => m.id === selectedImageModel)?.name || selectedImageModel}`);
    addLog(`🔧 API配置: ${imageConfig?.provider || 'unknown'}, 模型: ${imageConfig?.model || selectedImageModel}`);

    // 获取剧本名用于图片存储路径（优先使用内存中的 currentScript，避免重复查询数据库）
    let scriptName = currentScript?.title || '未命名剧本';
    if (currentEpisode?.scriptId && !currentScript?.title) {
      const script = await getScript(currentEpisode.scriptId);
      if (script?.title) {
        scriptName = script.title;
      }
    }
    if (scriptName !== '未命名剧本') {
      addLog(`📖 剧本名: ${scriptName}`);
    }

    const shot = segment.shots[shotIndex];
    
    // 检查是否有首帧图片（用于图生图参考）
    const firstFrameImage = shot.firstFrameImage || shot.firstFrameLocalPath;
    if (!firstFrameImage) {
      addLog('❌ 错误: 请先生成首帧图片');
      alert('请先生成首帧图片，尾帧将以首帧为参考生成');
      return;
    }
    
    addLog('');
    addLog('📥 收集参考图片...');
    
    // 辅助函数：将图片路径转换为API可用的格式（URL或Base64）
    const prepareImageForApi = async (url: string): Promise<string | undefined> => {
      // 远程URL直接返回
      if (url.startsWith('http://') || url.startsWith('https://')) {
        addLog(`  ✅ 远程URL图片: ${url}`);
        return url;
      }
      // 本地文件路径转换为Base64
      if (isLocalFilePath(url)) {
        addLog(`  🔄 本地图片转Base64: ${url}`);
        const base64 = await localImageToBase64(url);
        if (base64) {
          addLog(`  ✅ Base64转换成功 (长度: ${base64.length}字符)`);
          return base64;
        }
        addLog(`  ❌ Base64转换失败`);
      }
      return undefined;
    };
    
    // 收集参考图片
    const referenceImages: string[] = [];
    const referenceImageNames: string[] = []; // 用于日志显示
    
    // 获取场景和角色描述
    let sceneDescription = '';
    let characterDescriptions: string[] = [];
    
    // 判断是否使用分镜自己的参考图
    const hasShotRefImage = shot.lastFrameRefImage && shot.lastFrameRefImage.trim();
    const refMode = shot.lastFrameRefMode || 'ref-with-scene-char';
    
    // 同步收集原始路径，用于预览确认
    const previewItems: Array<{ name: string; path: string }> = [];
    
    // 尾帧必须以首帧图片为第一参考
    addLog('📷 首帧图片路径: ${firstFrameImage}');
    
    // 1. 如果有分镜参考图且是 only-ref 模式，只使用首帧+参考图
    if (hasShotRefImage && refMode === 'only-ref') {
      addLog('📷 参考模式: 只看参考图');
      // 添加首帧图片
      previewItems.push({ name: '首帧图片', path: firstFrameImage });
      const preparedFirstFrame = await prepareImageForApi(firstFrameImage);
      if (preparedFirstFrame) {
        referenceImages.push(preparedFirstFrame);
        referenceImageNames.push('首帧图片');
        addLog(`  ✅ 首帧图片已添加`);
      }
      // 添加分镜参考图
      addLog('📷 添加分镜参考图');
      previewItems.push({ name: '分镜参考图', path: shot.lastFrameRefImage! });
      const preparedRef = await prepareImageForApi(shot.lastFrameRefImage!);
      if (preparedRef) {
        referenceImages.push(preparedRef);
        referenceImageNames.push('分镜参考图');
        addLog('✅ 分镜参考图已添加');
      }
    } else {
      // 2. 否则收集首帧+场景+角色图片
      addLog('📷 参考模式: 同时参考角色和场景');
      
      // 1.1 添加首帧图片
      addLog('📌 添加首帧图片作为参考...');
      previewItems.push({ name: '首帧图片', path: firstFrameImage });
      const preparedFirstFrame = await prepareImageForApi(firstFrameImage);
      if (preparedFirstFrame) {
        referenceImages.push(preparedFirstFrame);
        referenceImageNames.push('首帧图片');
        addLog(`  ✅ 首帧图片已添加`);
      } else {
        addLog(`  ❌ 首帧图片处理失败`);
        alert('无法处理首帧图片，请确保图片格式正确');
        return;
      }
      
      // 1.2 获取场景信息和图片
      if (shot.scene) {
        const scene = scenes.find(s => s.name === shot.scene);
        if (scene) {
          addLog('');
          addLog(`🎬 场景: ${scene.name}`);
          // 添加场景图片到参考图片列表
          if (scene.imageUrl) {
            addLog(`  📷 场景图片路径: ${scene.imageUrl}`);
            previewItems.push({ name: `场景图[${scene.name}]`, path: scene.imageUrl });
            const preparedImage = await prepareImageForApi(scene.imageUrl);
            if (preparedImage) {
              referenceImages.push(preparedImage);
              referenceImageNames.push(`场景图[${scene.name}]`);
              addLog(`  ✅ 已添加场景图片到参考列表`);
            } else {
              addLog(`  ❌ 场景图片处理失败`);
            }
          } else {
            addLog(`  ⚠️ 场景没有图片`);
          }
          if (scene.description) {
            sceneDescription = scene.description;
          }
        }
      }
      
      // 1.3 获取角色信息和图片
      if (shot.characters && shot.characters.length > 0) {
        addLog('');
        addLog(`👥 角色列表: ${shot.characters.join(', ')}`);
        for (const charName of shot.characters) {
          const character = characters.find(c => c.name === charName);
          if (character) {
            // 获取角色当前选中的图片（主图或副图）
            const characterImage = getCharacterCurrentImage(character.id || 0);
            const outfitIndex = selectedOutfits[character.id || 0];
            const outfitName = outfitIndex !== null && character.alternativeImages?.[outfitIndex]
              ? character.alternativeImages[outfitIndex].name
              : '主图';
            
            // 添加角色图片到参考图片列表
            if (characterImage) {
              addLog(`  📷 角色[${charName}]穿着: ${outfitName}`);
              addLog(`  📷 图片路径: ${characterImage}`);
              previewItems.push({ name: `角色图[${charName}-${outfitName}]`, path: characterImage });
              const preparedImage = await prepareImageForApi(characterImage);
              if (preparedImage) {
                referenceImages.push(preparedImage);
                referenceImageNames.push(`角色图[${charName}-${outfitName}]`);
                addLog(`  ✅ 已添加角色图片到参考列表`);
              } else {
                addLog(`  ❌ 角色图片处理失败`);
              }
            } else {
              addLog(`  ⚠️ 角色[${charName}]没有图片`);
            }
            if (character.description) {
              characterDescriptions.push(`${charName}：${character.description}`);
            }
          }
        }
      }
      
      // 1.4 如果有分镜参考图，也添加到参考列表
      if (hasShotRefImage) {
        addLog('');
        addLog('📷 额外添加分镜参考图');
        previewItems.push({ name: '分镜参考图', path: shot.lastFrameRefImage! });
        const preparedRef = await prepareImageForApi(shot.lastFrameRefImage!);
        if (preparedRef) {
          referenceImages.push(preparedRef);
          referenceImageNames.push('分镜参考图');
          addLog('✅ 分镜参考图已添加');
        } else {
          addLog('❌ 分镜参考图处理失败');
        }
      }
    }
    
    setGeneratingFrameShotIndex(shotIndex);
    setGeneratingFrameType('last');

    try {
      
      addLog('');
      addLog(`📊 参考图片统计: ${referenceImages.length}张`);
      addLog(`📋 参考图片列表: ${referenceImageNames.join(', ')}`);

      // ---- 弹出参考图预览确认 ----
      if (previewItems.length > 0) {
        const confirmed = await new Promise<boolean>((resolve) => {
          refPreviewResolveRef.current = resolve;
          setRefPreviewModal({
            show: true,
            title: `尾帧生成 - 分镜 ${shotIndex + 1} 参考图确认`,
            items: previewItems,
          });
        });
        if (!confirmed) {
          setGeneratingFrameShotIndex(null);
          setGeneratingFrameType(null);
          return;
        }
      }
      
      // 3. 构建结构化的尾帧提示词
      const promptParts: string[] = [];
      
      // 首先是原有分镜脚本内容（核心描述）
      if (shot.description) {
        promptParts.push(shot.description);
      }
      
      // 提示词中标注参考图片
      promptParts.push('请参考附带的素材图片生成画面，首帧图片为第一张。');
      
      // 场景描述
      if (sceneDescription) {
        promptParts.push(`场景：${sceneDescription}`);
      } else if (shot.scene) {
        promptParts.push(`场景：${shot.scene}`);
      }
      
      // 角色描述
      if (characterDescriptions.length > 0) {
        promptParts.push(`角色：${characterDescriptions.join('；')}`);
      } else if (shot.characters && shot.characters.length > 0) {
        promptParts.push(`角色：${shot.characters.join('、')}`);
      }
      
      // 增量提示词：风格、情绪、画面类型
      promptParts.push('风格：电影级质感，影视构图，光影层次分明');
      promptParts.push('情绪：故事收尾感，余韵悠长');
      promptParts.push('画面类型：视频尾帧静帧画面');
      promptParts.push('要求：与首帧风格保持一致，呈现动作结束状态');
      
      // 尾帧补充提示词
      if (shot.lastFramePrompt && shot.lastFramePrompt.trim()) {
        promptParts.push(`补充要求：${shot.lastFramePrompt.trim()}`);
      }
      
      const prompt = promptParts.join('\n');

      addLog('');
      addLog('📝 提示词:');
      addLog('─'.repeat(50));
      prompt.split('\n').forEach(line => addLog(`  ${line}`));
      addLog('─'.repeat(50));
      
      addLog('');
      addLog(`📐 宽高比: ${shot.aspectRatio || videoAspectRatio}`);
      addLog(`📏 分辨率: ${selectedImageSize}`);

      const params: ImageGenParams = {
        prompt,
        model: selectedImageModel,
        size: selectedImageSize,
        aspectRatio: shot.aspectRatio || videoAspectRatio,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined, // 使用多图输入（首帧+场景+角色）
        referenceImageMeta: referenceImages.length > 0
          ? referenceImageNames.map((name, idx) => ({
              fileName: name,
              filePath: `第 ${shotIndex + 1} 分镜参考图 [${idx + 1}] ${name}`
            }))
          : undefined
      };

      addLog('');
      addLog('📤 调用图片生成API...');
      addLog(`  接口: POST /images/generations`);
      addLog(`  模式: 🖼️ 图生图`);
      addLog(`  参考图片数: ${referenceImages.length}`);
      
      // 输出详细的API请求体
      addLog('');
      addLog('📋 API请求体:');
      addLog('─'.repeat(50));
      addLog(`  model: ${imageConfig?.model || selectedImageModel}`);
      addLog(`  prompt: ${prompt}`);
      addLog(`  size: ${shot.aspectRatio || videoAspectRatio}`);
      addLog(`  image: [${referenceImages.length}张图片]`);
      referenceImages.forEach((img, idx) => {
        addLog(`    [${idx + 1}] ${img} (${img.length}字符)`);
      });
      addLog('─'.repeat(50));
      addLog('');
      
      const imageUrl = await generateImage(params, imageConfig);
      addLog(`✅ 图片生成成功!`);
      addLog(`🔗 图片URL: ${imageUrl}`);

      // 下载图片到本地（必须成功，Grsai 图片需要 API Key）
      // 路径结构: images/剧本名/frames/
      const imageSubfolder = `${scriptName}/frames`;
      addLog('');
      addLog(`💾 保存图片到: images/${imageSubfolder}/`);
      let localPath: string | null = null;
      try {
        localPath = await saveUrlImage(imageUrl, imageSubfolder);
        if (!localPath) {
          throw new Error('保存返回空路径');
        }
        addLog(`✅ 图片保存成功: ${localPath}`);
      } catch (saveError: any) {
        addLog(`❌ 图片保存失败: ${saveError.message}`);
        alert(`图片生成成功但保存失败: ${saveError.message}\n图片URL: ${imageUrl}\n请手动下载保存`);
      }

      // 更新分镜数据（通过 dbId 定位，避免异步期间 selectedSegmentIndex 错位）
      const targetDbId = segment.dbId;
      setLocalSegments(prev => {
        const segIdx = prev.findIndex(s => s.dbId === targetDbId);
        if (segIdx === -1) return prev;
        const updatedShots = [...(prev[segIdx].shots || [])];
        updatedShots[shotIndex] = {
          ...(updatedShots[shotIndex] || {}),
          lastFrameImage: imageUrl,
          lastFrameLocalPath: localPath
        };
        return prev.map((seg, idx) =>
          idx === segIdx ? { ...seg, shots: updatedShots } : seg
        );
      });

      // 保存到数据库
      if (segment.dbId) {
        isUpdatingFromDb.current = true;
        const segmentData = parseSegmentContent(segment.content || '{}');
        const dbShots = extractShotsFromSegment(segment);
        dbShots[shotIndex] = {
          ...(dbShots[shotIndex] || {}),
          lastFrameImage: imageUrl,
          lastFrameLocalPath: localPath
        };
        await updateSegment(segment.dbId, {
          content: buildSegmentContent(segmentData, dbShots, shotIndex)
        });
      }

      // 保存到历史图片记录
      if (localPath) {
        try {
          await addGeneratedImageHistory(localPath, prompt, selectedImageModel, selectedImageSize, shot.aspectRatio || videoAspectRatio);
          addLog('✅ 已保存到历史图片');
        } catch (e) {
          console.error('保存到历史图片失败:', e);
        }
      }

      addLog('');
      addLog(`✅ 尾帧生成完成!`);
    } catch (error: any) {
      const errorMsg = error?.message || error?.toString() || '未知错误';
      addLog(`❌ 生成失败: ${errorMsg}`);
      alert(`生成失败: ${errorMsg}`);
    } finally {
      setGeneratingFrameShotIndex(null);
      setGeneratingFrameType(null);
    }
  };

  // 处理分镜视频生成模式变化
  const handleShotModeChange = async (shotIndex: number, mode: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      videoGenMode: mode
    };
    const targetDbId = segment.dbId;

    // 更新 localSegments
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true; // 标记正在从本地更新保存
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
  };

  // 处理分镜宽高比变化
  const handleShotAspectRatioChange = async (shotIndex: number, ratio: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      aspectRatio: ratio
    };
    const targetDbId = segment.dbId;

    // 更新 localSegments
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true; // 标记正在从本地更新保存
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
  };

  // 处理首帧补充提示词变更
  const handleFirstFramePromptChange = async (shotIndex: number, prompt: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      firstFramePrompt: prompt
    };
    const targetDbId = segment.dbId;

    // 更新 localSegments
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
  };

  // 处理尾帧补充提示词变更
  const handleLastFramePromptChange = async (shotIndex: number, prompt: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      lastFramePrompt: prompt
    };
    const targetDbId = segment.dbId;

    // 更新 localSegments
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
  };

  // 处理参考图补充提示词变更
  const handleReferenceImagePromptChange = async (shotIndex: number, prompt: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      referenceImagePrompt: prompt
    };
    const targetDbId = segment.dbId;

    // 更新 localSegments
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
  };

  // 打开选择首帧图片
  const handleSelectFirstFrame = (shotIndex: number) => {
    setSelectingFrameShotIndex(shotIndex);
    setSelectingFrameType('first');
    setImagePickerTab('character');
    // 加载历史生成图片
    loadGeneratedImageHistory();
    setShowImagePicker(true);
  };

  // 打开选择尾帧图片
  const handleSelectLastFrame = (shotIndex: number) => {
    setSelectingFrameShotIndex(shotIndex);
    setSelectingFrameType('last');
    setImagePickerTab('character');
    // 加载历史生成图片
    loadGeneratedImageHistory();
    setShowImagePicker(true);
  };

  // 加载历史生成图片（带防抖，避免短时间内重复查询数据库）
  const lastImageHistoryLoadRef = useRef(0);
  const IMAGE_HISTORY_LOAD_INTERVAL = 5000; // 5秒内不重复加载
  const loadGeneratedImageHistory = async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && now - lastImageHistoryLoadRef.current < IMAGE_HISTORY_LOAD_INTERVAL) {
      return; // 5秒内不重复加载
    }
    lastImageHistoryLoadRef.current = now;
    try {
      const history = await getGeneratedImageHistory(100);
      setGeneratedImageHistory(history);
      // 加载统一历史图片（合并角色、场景、首尾帧等所有生成的图片）
      const historyByDate = await getAllImageHistoryByDate(10);
      setImageHistoryByDate(historyByDate);
    } catch (error) {
      console.error('加载历史生成图片失败:', error);
    }
  };

  // 处理上传图片替换首帧
  const handleUploadFirstFrame = async (shotIndex: number, localPath: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      firstFrameImage: null,
      firstFrameLocalPath: localPath
    };
    const targetDbId = segment.dbId;

    // 更新 localSegments
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
    
    console.log(`分镜 ${shotIndex + 1} 首帧已通过上传替换`);
  };

  // 处理上传图片替换尾帧
  const handleUploadLastFrame = async (shotIndex: number, localPath: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      lastFrameImage: null,
      lastFrameLocalPath: localPath
    };
    const targetDbId = segment.dbId;

    // 更新 localSegments
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
    
    console.log(`分镜 ${shotIndex + 1} 尾帧已通过上传替换`);
  };

  // 处理上传首帧图片作为主图
  const handleUploadFirstFrameImage = async (shotIndex: number, localPath: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      firstFrameImage: localPath, // 使用本地路径作为首帧
      firstFrameLocalPath: localPath
    };
    const targetDbId = segment.dbId;

    // 更新 localSegments
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
    
    console.log(`分镜 ${shotIndex + 1} 首帧图片已上传`);
  };

  // 处理上传尾帧图片作为主图
  const handleUploadLastFrameImage = async (shotIndex: number, localPath: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      lastFrameImage: localPath, // 使用本地路径作为尾帧
      lastFrameLocalPath: localPath
    };
    const targetDbId = segment.dbId;

    // 更新 localSegments
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
    
    console.log(`分镜 ${shotIndex + 1} 尾帧图片已上传`);
  };

  // 处理上传首帧参考图
  const handleUploadFirstFrameRef = async (shotIndex: number, localPath: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      firstFrameRefImage: localPath,
      firstFrameRefMode: shot.firstFrameRefMode || 'ref-with-scene-char'
    };
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
    
    console.log(`分镜 ${shotIndex + 1} 首帧参考图已上传`);
  };

  // 处理上传尾帧参考图
  const handleUploadLastFrameRef = async (shotIndex: number, localPath: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      lastFrameRefImage: localPath,
      lastFrameRefMode: shot.lastFrameRefMode || 'ref-with-scene-char'
    };
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
    
    console.log(`分镜 ${shotIndex + 1} 尾帧参考图已上传`);
  };

  // 处理选择历史图片作为首帧参考图
  const handleSelectFirstFrameHistoryRef = async (shotIndex: number, localPath: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      firstFrameRefImage: localPath,
      firstFrameRefMode: shot.firstFrameRefMode || 'ref-with-scene-char'
    };
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
    
    console.log(`分镜 ${shotIndex + 1} 首帧参考图已从历史图片选择`);
  };

  // 处理选择历史图片作为尾帧参考图
  const handleSelectLastFrameHistoryRef = async (shotIndex: number, localPath: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      lastFrameRefImage: localPath,
      lastFrameRefMode: shot.lastFrameRefMode || 'ref-with-scene-char'
    };
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
    
    console.log(`分镜 ${shotIndex + 1} 尾帧参考图已从历史图片选择`);
  };

  // 处理上传参考图（参考图模式）
  const handleUploadReferenceImage = async (shotIndex: number) => {
    try {
      const segment = localSegments[selectedSegmentIndex];
      if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

      const shot = segment.shots[shotIndex];
      const currentImages = shot.referenceImages || [];
      
      if (currentImages.length >= 4) {
        alert('最多只能上传4张参考图');
        return;
      }
      
      // 使用 uploadImage 上传图片
      const localPath = await uploadImage('frames');
      if (!localPath) return;
      
      const updatedShots = [...segment.shots];
      updatedShots[shotIndex] = {
        ...shot,
        referenceImages: [...currentImages, localPath]
      };
      const targetDbId = segment.dbId;

      setLocalSegments(prev => {
        const segIdx = prev.findIndex(s => s.dbId === targetDbId);
        if (segIdx === -1) return prev;
        const updated = [...prev];
        updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
        return updated;
      });

      if (segment.dbId) {
        isUpdatingFromDb.current = true;
        const segmentData = parseSegmentContent(segment.content || '{}');
        await updateSegment(segment.dbId, {
          content: buildSegmentContent(segmentData, updatedShots, shotIndex)
        });
      }
      
      console.log(`分镜 ${shotIndex + 1} 参考图已上传，当前 ${currentImages.length + 1} 张`);
    } catch (error) {
      console.error('上传参考图失败:', error);
      alert('上传参考图失败');
    }
  };

  // 处理删除参考图
  const handleRemoveReferenceImage = async (shotIndex: number, imgIndex: number) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const currentImages = shot.referenceImages || [];
    
    if (imgIndex < 0 || imgIndex >= currentImages.length) return;
    
    const updatedImages = currentImages.filter((_: string, idx: number) => idx !== imgIndex);
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      referenceImages: updatedImages
    };
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
    
    console.log(`分镜 ${shotIndex + 1} 参考图已删除`);
  };


  // 处理首帧参考模式变更
  const handleFirstFrameRefModeChange = async (shotIndex: number, mode: 'only-ref' | 'ref-with-scene-char') => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      firstFrameRefMode: mode
    };
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
  };

  // 处理尾帧参考模式变更
  const handleLastFrameRefModeChange = async (shotIndex: number, mode: 'only-ref' | 'ref-with-scene-char') => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const shot = segment.shots[shotIndex];
    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...shot,
      lastFrameRefMode: mode
    };
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
  };

  // 选择图片后更新分镜数据
  const handleSelectImage = async (imageUrl: string | null, localPath: string | null) => {
    if (selectingFrameShotIndex === null || selectingFrameType === null) return;
    
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots) return;

    const updatedShots = [...segment.shots];
    const shot = updatedShots[selectingFrameShotIndex];
    
    // 使用 localPath 作为图片路径（角色和场景图片都是本地路径）
    const imagePath = localPath || imageUrl;
    
    if (selectingFrameType === 'first') {
      updatedShots[selectingFrameShotIndex] = {
        ...shot,
        firstFrameImage: imageUrl,
        firstFrameLocalPath: imagePath
      };
    } else {
      updatedShots[selectingFrameShotIndex] = {
        ...shot,
        lastFrameImage: imageUrl,
        lastFrameLocalPath: imagePath
      };
    }

    const targetDbId = segment.dbId;

    // 更新 localSegments
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, selectingFrameShotIndex)
      });
    }
    setShowImagePicker(false);
    setSelectingFrameShotIndex(null);
    setSelectingFrameType(null);
  };

  // 生成分镜视频
  const handleGenerateShotVideo = async (shotIndex: number) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) {
      alert('分镜数据不存在');
      return;
    }

    if (!videoConfig) {
      alert('未找到视频生成配置，请在服务端管理后台检查 Provider 配置');
      return;
    }

    // 从数据库读取最新的 scenes/characters，避免闭包使用旧数据
    const scriptId = currentEpisode?.scriptId || 0;
    const [latestScenes, latestCharacters] = await Promise.all([
      getScenesByScript(scriptId),
      getCharactersByScript(scriptId)
    ]);

    const shot = segment.shots[shotIndex];
    const videoGenMode = shot.videoGenMode || 'first-frame'; // 默认首帧模式
    
    // 辅助函数：将图片路径转换为API可用的格式（URL或Base64）
    const prepareImageForApi = async (url: string): Promise<string | undefined> => {
      // 远程URL直接返回
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      // 本地文件路径转换为Base64
      if (isLocalFilePath(url)) {
        const base64 = await localImageToBase64(url);
        if (base64) {
          console.log('本地图片转换为Base64成功');
        }
        return base64 || undefined;
      }
      return undefined;
    };
    
    // 预览项收集辅助变量
    let previewName = '';
    
    // 根据模式检查是否需要首帧图片
    const firstFrameImage = shot.firstFrameImage || shot.firstFrameLocalPath;
    const lastFrameImage = shot.lastFrameImage || shot.lastFrameLocalPath;
    
    // 准备图片参数
    let preparedFirstFrame: string | undefined;
    let preparedLastFrame: string | undefined;
    
    if (videoGenMode === 'first-frame' || videoGenMode === 'first-last-frame') {
      if (!firstFrameImage) {
        alert('请先生成首帧图片');
        return;
      }
      preparedFirstFrame = await prepareImageForApi(firstFrameImage);
      if (!preparedFirstFrame) {
        alert('无法处理首帧图片，请确保图片格式正确');
        return;
      }
    }
    
    if (videoGenMode === 'first-last-frame') {
      if (!lastFrameImage) {
        alert('请先生成尾帧图片');
        return;
      }
      preparedLastFrame = await prepareImageForApi(lastFrameImage);
      if (!preparedLastFrame) {
        alert('无法处理尾帧图片，请确保图片格式正确');
        return;
      }
    }
    
    // 参考图模式或文+角色+场景模式：准备参考图列表
    let preparedReferenceImages: string[] | undefined;
    // 同步收集原始路径，用于预览确认
    const videoPreviewItems: Array<{ name: string; path: string }> = [];
    
    if (videoGenMode === 'reference-image') {
      const referenceImages = shot.referenceImages || [];
      if (referenceImages.length === 0) {
        alert('请先上传参考图片（1-4张）');
        return;
      }
      if (referenceImages.length > 4) {
        alert('最多只能使用4张参考图片');
        return;
      }
      
      // 依次转换每张图片
      const preparedImages: string[] = [];
      for (const img of referenceImages) {
        previewName = `参考图${referenceImages.indexOf(img) + 1}`;
        videoPreviewItems.push({ name: previewName, path: img });
        const prepared = await prepareImageForApi(img);
        if (!prepared) {
          alert('无法处理参考图片，请确保图片格式正确');
          return;
        }
        preparedImages.push(prepared);
      }
      preparedReferenceImages = preparedImages;
    } else if (videoGenMode === 'text') {
      // 文+角色+场景模式：收集该分镜关联的角色和场景图片作为参考图
      const refImages: string[] = [];
      
      // 添加场景图片
      if (shot.scene) {
        const scene = latestScenes.find(s => s.name === shot.scene);
        if (scene?.imageUrl) {
          videoPreviewItems.push({ name: `场景图[${scene.name}]`, path: scene.imageUrl });
          const prepared = await prepareImageForApi(scene.imageUrl);
          if (prepared) refImages.push(prepared);
        }
      }
      
      // 添加角色图片
      if (shot.characters && shot.characters.length > 0) {
        for (const charName of shot.characters) {
          const character = latestCharacters.find(c => c.name === charName);
          if (character) {
            // 从 latestCharacters 获取角色当前选中的图片（主图或副图），不用闭包里的 getCharacterCurrentImage
            const outfitIndex = selectedOutfits[character.id || 0];
            const characterImage = (outfitIndex !== null && character.alternativeImages?.[outfitIndex])
              ? character.alternativeImages[outfitIndex].imageUrl
              : character.imageUrl || null;
            const outfitName = outfitIndex !== null && character.alternativeImages?.[outfitIndex]
              ? character.alternativeImages[outfitIndex].name
              : '主图';
            if (characterImage) {
              videoPreviewItems.push({ name: `角色图[${charName}-${outfitName}]`, path: characterImage });
              const prepared = await prepareImageForApi(characterImage);
              if (prepared) refImages.push(prepared);
            }
          }
        }
      }
      
      if (refImages.length > 0) {
        preparedReferenceImages = refImages;
      }
    }
    
    
    // 收集首帧/尾帧预览图
    if (videoGenMode === 'first-frame' || videoGenMode === 'first-last-frame') {
      if (firstFrameImage) {
        videoPreviewItems.unshift({ name: '首帧图', path: firstFrameImage });
      }
      if (videoGenMode === 'first-last-frame' && lastFrameImage) {
        videoPreviewItems.unshift({ name: '尾帧图', path: lastFrameImage });
      }
    }
    
    setGeneratingShotIndex(shotIndex);

    // ---- 提前组装 prompt 用于确认弹窗展示 ----
    let previewPrompt = shot.description || '';
    if (shot.scene) previewPrompt = `场景：${shot.scene}。${previewPrompt}`;
    if (shot.characters && shot.characters.length > 0) previewPrompt = `角色：${shot.characters.join('、')}。${previewPrompt}`;
    // 动态拼接摄影参数关键词（从字段读取，不依赖description里的旧内容）
    const aiKeywords: string[] = ['cinematic', 'film grain'];
    if (shot.shotType) aiKeywords.push(`${shot.shotType} shot`);
    if (shot.lens) aiKeywords.push(shot.lens);
    if (shot.lighting) aiKeywords.push(shot.lighting);
    if (shot.cameraAngle) aiKeywords.push(shot.cameraAngle);
    if (shot.cameraMovement) aiKeywords.push(`camera movement: ${shot.cameraMovement}`);
    previewPrompt = `${previewPrompt} (${aiKeywords.join(', ')})`;

    // ---- 弹出确认（有图或无图都弹出，展示 prompt + 图片） ----
    {
      const confirmed = await new Promise<boolean>((resolve) => {
        refPreviewResolveRef.current = resolve;
        let modeLabel = videoGenMode === 'first-frame' ? '首帧模式' :
          videoGenMode === 'first-last-frame' ? '首尾帧模式' :
          videoGenMode === 'reference-image' ? '参考图模式' : '文生视频模式';
        
        
        setRefPreviewModal({
          show: true,
          title: `视频生成 - 分镜 ${shotIndex + 1} 发送内容确认 (${modeLabel})`,
          items: videoPreviewItems,
          prompt: previewPrompt
        });
      });
      if (!confirmed) {
        setGeneratingShotIndex(null);
        return;
      }
    }

    try {
      // 构建视频生成提示词（与 previewPrompt 保持一致）
      let prompt = shot.description || '';
      if (shot.scene) {
        prompt = `场景：${shot.scene}。${prompt}`;
      }
      if (shot.characters && shot.characters.length > 0) {
        prompt = `角色：${shot.characters.join('、')}。${prompt}`;
      }
      // 动态拼接摄影参数关键词（从字段读取，与确认弹窗保持完全一致）
      const sendKeywords: string[] = ['cinematic', 'film grain'];
      if (shot.shotType) sendKeywords.push(`${shot.shotType} shot`);
      if (shot.lens) sendKeywords.push(shot.lens);
      if (shot.lighting) sendKeywords.push(shot.lighting);
      if (shot.cameraAngle) sendKeywords.push(shot.cameraAngle);
      if (shot.cameraMovement) sendKeywords.push(`camera movement: ${shot.cameraMovement}`);
      prompt = `${prompt} (${sendKeywords.join(', ')})`;

      // 使用分镜自己的宽高比，如果没有则使用全局设置
      const aspectRatio = shot.aspectRatio || videoAspectRatio;

      // 生成视频参数
      const params: VideoGenParams = {
        prompt,
        firstFrameImage: (videoGenMode === 'first-frame' || videoGenMode === 'first-last-frame') ? preparedFirstFrame : undefined,
        lastFrameImage: videoGenMode === 'first-last-frame' ? preparedLastFrame : undefined,
        referenceImages: (videoGenMode === 'reference-image' || videoGenMode === 'text') ? preparedReferenceImages : undefined,
        aspectRatio,
        duration: shot.duration,
        enableAudio: enableVideoAudio
      };

      console.log(`生成分镜 ${shotIndex + 1} 视频，模式: ${videoGenMode}，参数:`, params);
      
      // 构建视频配置：使用选中的视频模型
      const videoConfigWithModel = {
        ...videoConfig,
        model: selectedVideoModel || videoConfig.model
      };
      console.log(`🎬 使用视频模型: ${videoConfigWithModel.model}`);
      console.log(`🎬 视频 Provider: ${videoConfigWithModel.provider}`);
      
      // 使用统一视频生成入口（自动根据 provider 路由到 volcengine / grsai / wan-2.6 / openrouter）
      const videoUrl: string = await generateVideo(params, videoConfigWithModel);
      
      console.log('视频生成成功:', videoUrl);

      // 下载视频到本地
      let localVideoPath: string | null = null;
      try {
        localVideoPath = await downloadVideo(videoUrl, 'shots');
        if (localVideoPath) {
          console.log('✅ 视频下载成功，本地路径:', localVideoPath);
        } else {
          console.log('⚠️ 视频下载失败，将使用远程URL:', videoUrl);
        }
      } catch (downloadError: any) {
        console.error('⚠️ 视频下载异常:', downloadError.message, '使用远程URL:', videoUrl);
        localVideoPath = null;
      }

      // 创建视频历史记录
      const videoHistoryEntry = {
        id: `video_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        videoUrl,
        localVideoPath: localVideoPath || undefined,
        generatedAt: new Date().toISOString()
      };

      // 获取现有历史记录并添加新记录（保留所有历史）
      const existingHistory = shot.videoHistory || [];
      const updatedVideoHistory = [...existingHistory, videoHistoryEntry];

      // 更新分镜数据
      const updatedShots = [...segment.shots];
      updatedShots[shotIndex] = {
        ...shot,
        status: 'generated',
        videoUrl,
        localVideoPath,
        videoHistory: updatedVideoHistory
      };
      const targetDbId = segment.dbId;

      // 更新 localSegments
      setLocalSegments(prev => {
        const segIdx = prev.findIndex(s => s.dbId === targetDbId);
        if (segIdx === -1) return prev;
        const updated = [...prev];
        updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
        return updated;
      });

      // 保存到数据库
      if (segment.dbId) {
        isUpdatingFromDb.current = true
        const segmentData = parseSegmentContent(segment.content || '{}');
        await updateSegment(segment.dbId, {
          content: buildSegmentContent(segmentData, updatedShots, shotIndex)
        });
      }

      console.log(`分镜 ${shotIndex + 1} 视频已保存`);
    } catch (error: any) {
      console.error('分镜视频生成失败:', error);
      const errorMsg = error?.message || error?.toString() || '未知错误';
      alert(`生成失败: ${errorMsg}`);
    } finally {
      setGeneratingShotIndex(null);
    }
  };

  // 批量生成所有待生成的分镜
  const handleBatchGenerate = async () => {
    // 获取所有待生成的分镜
    const pendingSegments = localSegments.filter(s => s.status === 'pending' || s.status === 'failed');
    if (pendingSegments.length === 0) {
      alert('没有待生成的分镜');
      return;
    }

    if (!videoConfig) {
      alert('未找到视频生成配置，请在服务端管理后台检查 Provider 配置');
      return;
    }

    setBatchGenerating(true);
    setBatchProgress({ current: 0, total: pendingSegments.length });

    // 逐个生成
    for (let i = 0; i < pendingSegments.length; i++) {
      const segment = pendingSegments[i];
      setBatchProgress({ current: i + 1, total: pendingSegments.length });

      // 设置当前为生成中
      setLocalSegments(prev =>
        prev.map(seg =>
          seg.id === segment.id ? { ...seg, status: 'generating', videoUrl: undefined, error: undefined } : seg
        )
      );

      try {
        // 构建视频生成参数
        const sceneImages = scenes.filter(s => s.name === segment.scene).map(s => s.imageUrl).filter(Boolean);
        const firstFrameImage = sceneImages[0];

        const segmentCharacters = characters.filter(c =>
          segment.shots?.some((shot: any) => shot.characters?.includes(c.name))
        );
        const characterNames = segmentCharacters.map(c => c.name).join('、');
        const promptText = `${segment.description}${characterNames ? '，角色：' + characterNames : ''}`;

        const params: VideoGenParams = { prompt: promptText, enableAudio: enableVideoAudio };
        if (firstFrameImage) {
          params.firstFrameImage = firstFrameImage;
        }

        // 使用统一视频生成 API（自动根据 provider 路由）
        const videoUrl = await generateVideo(params, videoConfig);

        // 下载视频到本地
        let batchLocalPath: string | null = null;
        try {
          batchLocalPath = await downloadVideo(videoUrl, `episode_${episodeId || 'unknown'}`);
        } catch (dlErr: any) {
          console.error('视频下载失败，使用远程URL:', dlErr.message);
        }
        const batchFinalUrl = batchLocalPath ? localVideoPathToSrc(batchLocalPath) : videoUrl;

        // 更新分镜状态
        setLocalSegments(prev =>
          prev.map(seg =>
            seg.id === segment.id ? { ...seg, status: 'generated', videoUrl: batchFinalUrl, localVideoPath: batchLocalPath } : seg
          )
        );

        // 保存到数据库
        if (segment.dbId) {
          isUpdatingFromDb.current = true
          const segmentData = parseSegmentContent(segment.content || '{}');
          await updateSegment(segment.dbId, {
            content: JSON.stringify({
              ...segmentData,
              status: 'generated',
              videoUrl: batchFinalUrl,
              localVideoPath: batchLocalPath
            })
          });
        }
      } catch (error: any) {
        console.error('视频生成失败:', error);
        setLocalSegments(prev =>
          prev.map(seg =>
            seg.id === segment.id ? { ...seg, status: 'failed', error: error.message || '生成失败' } : seg
          )
        );
      }

      // 生成完一个后稍作延迟，避免请求过快
      if (i < pendingSegments.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setBatchGenerating(false);
    setBatchProgress({ current: 0, total: 0 });
  };

  // 合成全集
  const handleMergeAll = async () => {
    // 获取所有已生成的视频
    const generatedSegments = localSegments.filter(s => s.status === 'generated' && (s.videoUrl || s.localVideoPath));
    
    if (generatedSegments.length === 0) {
      alert('没有可合并的视频，请先生成视频');
      return;
    }

    // 检查 FFmpeg
    const hasFFmpeg = await checkFFmpeg();
    if (!hasFFmpeg) {
      alert('FFmpeg 未安装。\n\n请在终端运行以下命令安装：\nbrew install ffmpeg');
      return;
    }

    setMerging(true);
    setMergedVideoPath(null);

    try {
      // 优先使用本地路径，否则使用远程 URL
      const videoUrls = generatedSegments.map(s => 
        s.localVideoPath || s.videoUrl || ''
      ).filter(Boolean);
      
      if (videoUrls.length === 0) {
        alert('没有可用的视频文件');
        return;
      }
      
      const result = await mergeVideos(videoUrls);

      if (result.success && result.output_path) {
        setMergedVideoPath(result.output_path);
        alert(`视频合并成功！\n保存位置: ${result.output_path}`);
      } else {
        alert(`合并失败: ${result.error}`);
      }
    } catch (error) {
      alert(`合并失败: ${error}`);
    } finally {
      setMerging(false);
    }
  };

  // 处理分镜排序
  const handleSegmentReorder = (fromIndex: number, toIndex: number) => {
    setLocalSegments(prev => {
      const newSegments = [...prev];
      const [movedSegment] = newSegments.splice(fromIndex, 1);
      newSegments.splice(toIndex, 0, movedSegment);
      return newSegments;
    });
  };

  // 构建资产库数据（使用真实的角色和场景）
  const assets = {
    characters: characters.map(c => ({
      id: c.id || 0,
      name: c.name,
      type: c.isMain ? '主角' : '配角',
      image: c.imageUrl ? localPathToSrc(c.imageUrl) : null,
      description: c.description,
      alternativeImages: c.alternativeImages || []
    })),
    scenes: scenes.map(s => ({
      id: s.id || 0,
      name: s.name,
      image: s.imageUrl ? localPathToSrc(s.imageUrl) : null,
      description: s.description
    }))
  };

  // 处理角色穿着切换（自动保存到数据库）
  const handleCharacterOutfitChange = async (characterId: number, outfitIndex: number | null) => {
    // 更新本地状态
    setSelectedOutfits(prev => ({
      ...prev,
      [characterId]: outfitIndex
    }));
    
    // 保存到数据库
    if (episodeId) {
      try {
        await saveEpisodeCharacterOutfit(Number(episodeId), characterId, outfitIndex);
      } catch (error) {
        console.error('保存角色穿着选择失败:', error);
      }
    }
  };

  // 处理分镜内容更新（保存到数据库）
  const handleSegmentUpdate = async (updatedSegment: any) => {
    // 使用函数式更新确保获取最新状态，并在回调内完成数据库保存
    setLocalSegments(prev => {
      const currentSeg = prev[selectedSegmentIndex];
      if (!currentSeg || !currentSeg.dbId) return prev;
      
      const segmentDbId = currentSeg.dbId;
      const updated = prev.map((seg) =>
        seg.dbId === segmentDbId ? { ...seg, ...updatedSegment } : seg
      );
      
      // 立即保存数据库（使用更新后的数据）
      const segToUpdate = updated.find(s => s.dbId === segmentDbId);
      if (segToUpdate) {
        isUpdatingFromDb.current = true;
        const segmentData = parseSegmentContent(segToUpdate.content || '{}');
        const contentToSave = {
          ...segmentData,
          scene: updatedSegment.scene ?? segToUpdate.scene ?? '',
          description: updatedSegment.description ?? segToUpdate.description ?? '',
          shots: updatedSegment.shots ?? segToUpdate.shots ?? [],
          ...(updatedSegment.shots?.[0] || segToUpdate.shots?.[0] || {}),
          status: segToUpdate.status
        };
        
        updateSegment(segmentDbId, { content: JSON.stringify(contentToSave) }).catch(err => {
          console.error('保存分镜内容失败:', err);
        });
      }
      
      return updated;
    });
  };

  // 重新生成分镜脚本
  const handleRegenerateStoryboard = async () => {
    const currentEpisode = episodes.find(e => e.id === Number(episodeId));
    if (!currentEpisode) {
      alert('未找到当前剧集');
      return;
    }

    // 使用统一配置获取（自动多级回退）
    let apiConfig: any = null;
    if (!apiConfig?.model) {
      apiConfig = getBestConfig(apiConfigs, 'scriptGeneration');
    }
    if (!apiConfig) {
      alert('未找到可用的剧本生成配置，请在服务端管理后台检查 Provider 配置');
      return;
    }
    
    console.log(`[重新生成分镜] 使用配置: ${apiConfig.provider} - ${apiConfig.model}`);

    const charData = characters.map(c => ({ name: c.name, description: c.description }));
    const sceneData = scenes.map(s => ({ name: s.name, description: s.description }));

    // 设置生成中状态
    setRegeneratingStoryboard(true);
    setStoryboardProgress('正在初始化...');
    setStoryboardContent('');  // 清空流式内容

    try {
      // 直接使用 episode.content（重新分集后已是原文）
      // 不再额外调用 extractEpisodesFromScript，避免浪费 token
      const episodeContent = currentEpisode.content;
      
      if (!episodeContent) {
        setRegeneratingStoryboard(false);
        setStoryboardProgress('');
        setStoryboardContent('');
        alert('当前剧集内容为空，请先进行分集');
        return;
      }
      
      console.log(`[重新生成分镜] 使用内容长度: ${episodeContent.length} 字符，前100字: ${episodeContent.substring(0, 100)}`);
      
      // 定义进度回调函数
      const handleProgress = (message: string, step?: number, totalSteps?: number) => {
        console.log(`[分镜进度] ${message}`);
        setStoryboardProgress(message);
      };
      
      // 定义流式内容回调函数
      const handleContentStream = (chunk: string) => {
        setStoryboardContent(prev => prev + chunk);
      };
      
      const storyboard = await generateStoryboardScript(
        episodeContent, 
        charData, 
        sceneData, 
        undefined, 
        handleProgress,
        handleContentStream
      );
      
      console.log(`[重新生成分镜] AI 返回了 ${storyboard.length} 个镜头`);
      storyboard.forEach((shot, idx) => {
        console.log(`  镜头 ${idx + 1}: ${shot.scene} - ${shot.description?.substring(0, 30)}...`);
      });

      setStoryboardProgress(`AI 生成了 ${storyboard.length} 个镜头，正在保存到数据库...`);

      // 先删除旧的所有 segments
      for (const seg of localSegments) {
        if (seg.dbId) {
          await dbDeleteSegment(seg.dbId);
        }
      }

      // 重新创建所有 segments（扁平结构：每个镜头一个 segment）
      for (let i = 0; i < storyboard.length; i++) {
        const shot = storyboard[i];
        await dbCreateSegment({
          episodeId: Number(episodeId),
          startTime: 0,
          endTime: shot.duration || DEFAULT_SHOT_DURATION,
          content: JSON.stringify(shot),
          order: i
        });
      }

      setStoryboardProgress('正在重新加载分集数据...');

      // 重新加载 segments
      if (episodeId) {
        await loadSegments(Number(episodeId));
      }
      const scriptId = currentScript?.id;
      if (scriptId) {
        await loadEpisodes(scriptId);
      }

      // 重置选中索引为第一个
      setSelectedSegmentIndex(0);

      console.log('分镜脚本已重新生成并保存');
      setStoryboardProgress('分镜脚本已重新生成并保存');
      
      // 延迟关闭提示
      setTimeout(() => {
        setRegeneratingStoryboard(false);
        setStoryboardProgress('');
        setStoryboardContent('');  // 清空流式内容
      }, 2000);
    } catch (err: any) {
      console.error('重新生成分镜脚本失败:', err);
      console.error('错误详情:', {
        message: err?.message,
        stack: err?.stack,
        name: err?.name,
        response: err?.response,
        toString: err?.toString?.()
      });
      
      // 添加页面调试日志
      setStoryboardProgress(`错误: ${err?.message || '未知错误'}`);
      
      const errorMessage = err?.message || err?.toString?.() || '未知错误';
      const errorDetails = `错误信息: ${errorMessage}\n\n请检查：\n1. API Key 是否配置正确\n2. 网络连接是否正常\n3. 分集内容是否为空`;
      
      alert(`重新生成分镜失败:\n${errorDetails}`);
      
      // 延迟关闭遮罩
      setTimeout(() => {
        setRegeneratingStoryboard(false);
        setStoryboardProgress('');
        setStoryboardContent('');  // 清空流式内容
      }, 3000);
    }
  };

  // 处理分镜角色选择（支持多选）
  const handleCharactersChange = async (shotIndex: number, characterNames: string[]) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...updatedShots[shotIndex],
      characters: characterNames
    };
    const targetDbId = segment.dbId;

    // 更新本地状态
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
      console.log('分镜角色已更新:', characterNames);
    }
  };

  // 更新分镜时长
  const handleShotDurationChange = async (shotIndex: number, duration: number) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...updatedShots[shotIndex],
      duration
    };
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
  };

  // 更新分镜景别
  const handleShotTypeChange = async (shotIndex: number, shotType: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...updatedShots[shotIndex],
      shotType
    };
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
  };

  // 更新分镜镜头运动
  const handleCameraMovementChange = async (shotIndex: number, cameraMovement: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...updatedShots[shotIndex],
      cameraMovement
    };
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
    }
  };

  // 处理分镜内容更新
  const handleShotContentChange = async (shotIndex: number, content: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...updatedShots[shotIndex],
      description: content
    };
    const targetDbId = segment.dbId;

    // 更新本地状态
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
      console.log('分镜内容已保存:', shotIndex);
    }
  };

  // 删除分镜
  const handleDeleteShot = async (shotIndex: number) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.dbId) return;

    const updatedShots = segment.shots.filter((_: any, idx: number) => idx !== shotIndex);
    const targetDbId = segment.dbId;

    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 调整选中索引
    if (selectedShotIndex >= updatedShots.length) {
      setSelectedShotIndex(Math.max(0, updatedShots.length - 1));
    }

    isUpdatingFromDb.current = true;
    const segmentData = parseSegmentContent(segment.content || '{}');
    await updateSegment(targetDbId, {
      content: buildSegmentContent(segmentData, updatedShots, shotIndex)
    });
  };

  // 处理分镜场景选择
  const handleSceneChange = async (shotIndex: number, sceneName: string) => {
    const segment = localSegments[selectedSegmentIndex];
    if (!segment || !segment.shots || !segment.shots[shotIndex]) return;

    const updatedShots = [...segment.shots];
    updatedShots[shotIndex] = {
      ...updatedShots[shotIndex],
      scene: sceneName
    };
    const targetDbId = segment.dbId;

    // 更新本地状态
    setLocalSegments(prev => {
      const segIdx = prev.findIndex(s => s.dbId === targetDbId);
      if (segIdx === -1) return prev;
      const updated = [...prev];
      updated[segIdx] = { ...updated[segIdx], shots: updatedShots };
      return updated;
    });

    // 保存到数据库
    if (segment.dbId) {
      isUpdatingFromDb.current = true;
      const segmentData = parseSegmentContent(segment.content || '{}');
      await updateSegment(segment.dbId, {
        content: buildSegmentContent(segmentData, updatedShots, shotIndex)
      });
      console.log('分镜场景已更新:', sceneName);
    }
  };

  // 获取角色的当前图片（根据穿着选择）
  const getCharacterCurrentImage = (characterId: number): string | null => {
    const character = characters.find(c => c.id === characterId);
    if (!character) return null;
    
    const outfitIndex = selectedOutfits[characterId];
    if (outfitIndex !== null && character.alternativeImages?.[outfitIndex]) {
      return character.alternativeImages[outfitIndex].imageUrl;
    }
    return character.imageUrl || null;
  };

  const currentSegment = localSegments[selectedSegmentIndex] || localSegments[0];
  
  // 如果没有分镜数据，显示空状态
  if (localSegments.length === 0) {
    return (
      <div className="fixed inset-0 bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/episodes')}
              className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                {currentEpisode?.title || '编辑分集'}
              </h1>
              <p className="text-sm text-slate-500">暂无分镜数据</p>
            </div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-300 mb-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
            </svg>
            <p className="text-gray-500 text-lg mb-2">暂无分镜内容</p>
            <p className="text-gray-400 text-sm mb-4">请返回分集列表，点击“生成”按钮创建分镜</p>
            <button
              onClick={() => navigate('/episodes')}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              返回分集列表
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/episodes')}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-slate-900">
            {currentEpisode ? `第${currentEpisode.episodeNumber}集：${currentEpisode.title}` : `第${episodeId}集`}
          </h1>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-sm text-slate-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span>{localSegments.length} 个分镜</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <AssetLibrary 
          assets={assets} 
          generatingId={generatingId}
          generatingType={generatingType}
          onCharacterOutfitChange={handleCharacterOutfitChange}
          selectedOutfits={selectedOutfits}
          onUpdateCharacter={updateCharacter}
          onUpdateScene={updateScene}
        />
        
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex-1 overflow-hidden min-h-0">
            <ScriptEditor 
              segment={{
                // 传递所有 localSegments 作为 shots
                shots: localSegments.map((seg, idx) => {
                  const segData = parseSegmentContent(seg.content || '{}');
                  return {
                    id: seg.dbId || seg.id,
                    shotNumber: idx + 1,
                    shotType: segData.shotType,
                    cameraAngle: segData.cameraAngle,
                    lens: segData.lens,
                    description: segData.description,
                    action: segData.action,
                    scene: segData.scene,
                    characters: segData.characters,
                    duration: segData.duration || 5,
                    dialogue: segData.dialogue,
                    soundEffect: segData.soundEffect,
                    cameraMovement: segData.cameraMovement,
                    imagePrompt: segData.imagePrompt,
                    videoUrl: segData.videoUrl,
                    localVideoPath: segData.localVideoPath,
                    firstFrameImage: segData.firstFrameImage,
                    lastFrameImage: segData.lastFrameImage,
                    firstFrameLocalPath: segData.firstFrameLocalPath,
                    lastFrameLocalPath: segData.lastFrameLocalPath,
                    status: segData.status,
                    videoGenMode: segData.videoGenMode,
                    firstFramePrompt: segData.firstFramePrompt,
                    lastFramePrompt: segData.lastFramePrompt,
                    firstFrameRefMode: segData.firstFrameRefMode,
                    referenceImages: segData.referenceImages,
                    referenceImagePrompt: segData.referenceImagePrompt,
                    videoHistory: segData.videoHistory
                  };
                })
              }}
              episodeTitle={currentEpisode?.title || ''}
              episodeContent={currentEpisode?.content || ''}
              onSegmentUpdate={handleSegmentUpdate}
              onGenerateShotVideo={handleGenerateShotVideo}
              generatingShotIndex={generatingShotIndex}
              selectedShotIndex={selectedShotIndex}
              onSelectShot={setSelectedShotIndex}
              onGenerateFirstFrame={handleGenerateFirstFrame}
              onGenerateLastFrame={handleGenerateLastFrame}
              generatingFrameShotIndex={generatingFrameShotIndex}
              generatingFrameType={generatingFrameType}
              onShotModeChange={handleShotModeChange}
              videoAspectRatio={videoAspectRatio}
              onAspectRatioChange={handleShotAspectRatioChange}
              onSelectFirstFrame={handleSelectFirstFrame}
              onSelectLastFrame={handleSelectLastFrame}
              onFirstFramePromptChange={handleFirstFramePromptChange}
              onLastFramePromptChange={handleLastFramePromptChange}
              onUploadFirstFrame={handleUploadFirstFrame}
              onUploadLastFrame={handleUploadLastFrame}
              onUploadFirstFrameImage={handleUploadFirstFrameImage}
              onUploadLastFrameImage={handleUploadLastFrameImage}
              onUploadFirstFrameRef={handleUploadFirstFrameRef}
              onUploadLastFrameRef={handleUploadLastFrameRef}
              onFirstFrameRefModeChange={handleFirstFrameRefModeChange}
              onLastFrameRefModeChange={handleLastFrameRefModeChange}
              onUploadReferenceImage={handleUploadReferenceImage}
              onRemoveReferenceImage={handleRemoveReferenceImage}
              onReferenceImagePromptChange={handleReferenceImagePromptChange}
              selectedImageModel={selectedImageModel}
              selectedImageSize={selectedImageSize}
              onImageModelChange={setSelectedImageModel}
              onImageSizeChange={setSelectedImageSize}
              availableVideoModels={availableVideoModels}
              selectedVideoModel={selectedVideoModel}
              onVideoModelChange={setSelectedVideoModel}
              characters={characters.map(c => ({ id: c.id || 0, name: c.name, imageUrl: c.imageUrl }))}
              scenes={scenes.map(s => ({ id: s.id || 0, name: s.name, imageUrl: s.imageUrl }))}
              onCharactersChange={handleCharactersChange}
              onSceneChange={handleSceneChange}
              onSelectFirstFrameHistoryRef={handleSelectFirstFrameHistoryRef}
              onSelectLastFrameHistoryRef={handleSelectLastFrameHistoryRef}
              imageHistoryByDate={imageHistoryByDate}
              onShotDurationChange={handleShotDurationChange}
              onShotTypeChange={handleShotTypeChange}
              onCameraMovementChange={handleCameraMovementChange}
              onDeleteShot={handleDeleteShot}
              onShotContentChange={handleShotContentChange}
              onRegenerateStoryboard={handleRegenerateStoryboard}
              regeneratingStoryboard={regeneratingStoryboard}
              storyboardProgress={storyboardProgress}
              storyboardContent={storyboardContent}
              onVideoEdit={handleOpenVideoEdit}
            />
          </div>
        </div>
      </div>

      {/* 图片选择器模态框 */}
      {showImagePicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold">
                选择{selectingFrameType === 'first' ? '首帧' : '尾帧'}图片
              </h3>
              <button
                onClick={() => {
                  setShowImagePicker(false);
                  setSelectingFrameShotIndex(null);
                  setSelectingFrameType(null);
                }}
                className="p-2 text-gray-400 hover:text-gray-600 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {/* Tab切换 */}
              <div className="flex items-center space-x-4 mb-4 border-b border-gray-200">
                <button
                  onClick={() => setImagePickerTab('character')}
                  className={`pb-2 px-1 text-sm font-medium border-b-2 transition ${
                    imagePickerTab === 'character'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  角色图片 ({characters.filter(c => c.imageUrl).length})
                </button>
                <button
                  onClick={() => setImagePickerTab('scene')}
                  className={`pb-2 px-1 text-sm font-medium border-b-2 transition ${
                    imagePickerTab === 'scene'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  场景图片 ({scenes.filter(s => s.imageUrl).length})
                </button>
                <button
                  onClick={() => setImagePickerTab('history')}
                  className={`pb-2 px-1 text-sm font-medium border-b-2 transition ${
                    imagePickerTab === 'history'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  历史生成 ({generatedImageHistory.length})
                </button>
              </div>

              {/* 角色图片 */}
              {imagePickerTab === 'character' && (
                <div className="grid grid-cols-4 gap-3">
                  {characters.filter(c => c.imageUrl).map(character => (
                    <div
                      key={character.id}
                      onClick={() => handleSelectImage(null, character.imageUrl || null)}
                      className="cursor-pointer border-2 border-transparent hover:border-primary rounded-lg overflow-hidden transition"
                    >
                      <img 
                        src={localPathToSrc(character.imageUrl) || ''} 
                        alt={character.name}
                        className="w-full object-contain bg-slate-100"
                      />
                      <div className="p-2 text-xs text-center truncate">{character.name}</div>
                    </div>
                  ))}
                  {characters.filter(c => c.imageUrl).length === 0 && (
                    <div className="col-span-4 text-center text-gray-400 py-8">暂无角色图片</div>
                  )}
                </div>
              )}

              {/* 场景图片 */}
              {imagePickerTab === 'scene' && (
                <div className="grid grid-cols-4 gap-3">
                  {scenes.filter(s => s.imageUrl).map(scene => (
                    <div
                      key={scene.id}
                      onClick={() => handleSelectImage(null, scene.imageUrl || null)}
                      className="cursor-pointer border-2 border-transparent hover:border-primary rounded-lg overflow-hidden transition"
                    >
                      <img 
                        src={localPathToSrc(scene.imageUrl) || ''} 
                        alt={scene.name}
                        className="w-full object-contain bg-slate-100"
                      />
                      <div className="p-2 text-xs text-center truncate">{scene.name}</div>
                    </div>
                  ))}
                  {scenes.filter(s => s.imageUrl).length === 0 && (
                    <div className="col-span-4 text-center text-gray-400 py-8">暂无场景图片</div>
                  )}
                </div>
              )}

              {/* 历史生成图片 */}
              {imagePickerTab === 'history' && (
                <div className="grid grid-cols-4 gap-3">
                  {generatedImageHistory.map(item => (
                    <div
                      key={item.id}
                      onClick={() => handleSelectImage(null, item.localPath)}
                      className="cursor-pointer border-2 border-transparent hover:border-primary rounded-lg overflow-hidden transition"
                    >
                      <img 
                        src={localPathToSrc(item.localPath) || ''}
                        alt={item.prompt || '历史图片'}
                        className="w-full object-contain bg-slate-100"
                      />
                      <div className="p-2 text-xs text-center truncate">
                        {item.prompt || '无提示词'}
                      </div>
                      <div className="text-xs text-center text-gray-400">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                  {generatedImageHistory.length === 0 && (
                    <div className="col-span-4 text-center text-gray-400 py-8">暂无历史生成图片</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 生成日志面板 */}
      {showGenerationLogs && generationLogs.length > 0 && (
        <div className="fixed bottom-4 right-4 w-[500px] bg-gray-900 rounded-lg shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
            <h3 className="text-sm font-medium text-white">📋 生成日志</h3>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setLogsCollapsed(!logsCollapsed)}
                className="text-xs text-gray-400 hover:text-white transition"
              >
                {logsCollapsed ? `展开 (${generationLogs.length})` : '折叠'}
              </button>
              <button
                onClick={clearLogs}
                className="text-xs text-gray-400 hover:text-white transition"
              >
                清除
              </button>
              <button
                onClick={() => setShowGenerationLogs(false)}
                className="p-1 text-gray-400 hover:text-white transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div 
            ref={logsContainerRef}
            className={`p-3 overflow-y-auto font-mono text-xs ${logsCollapsed ? 'max-h-[80px]' : 'max-h-[340px]'}`}
            onScroll={(e) => {
              const container = e.currentTarget;
              const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
              shouldAutoScrollRef.current = isAtBottom;
            }}
          >
            {(logsCollapsed ? generationLogs.slice(-3) : generationLogs).map((log, index) => (
              <div 
                key={index} 
                className={`py-0.5 ${
                  log.includes('✅') ? 'text-green-400' :
                  log.includes('❌') ? 'text-red-400' :
                  log.includes('⚠️') ? 'text-yellow-400' :
                  log.includes('📊') || log.includes('📋') ? 'text-blue-400' :
                  'text-gray-300'
                }`}
              >
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 参考图预览确认弹窗 */}
      {refPreviewModal?.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-xl shadow-2xl w-[640px] max-h-[85vh] flex flex-col">
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h3 className="font-semibold text-slate-800">{refPreviewModal.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">以下内容将发送给 AI，请确认后再生成</p>
              </div>
              <button
                onClick={() => {
                  setRefPreviewModal(null);
                  if (refPreviewResolveRef.current) {
                    refPreviewResolveRef.current(false);
                    refPreviewResolveRef.current = null;
                  }
                }}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* 内容区 */}
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Prompt 文字展示 */}
              {refPreviewModal.prompt && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1.5">📝 发送的 Prompt</div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                    {refPreviewModal.prompt}
                  </div>
                </div>
              )}

              {/* 参考图列表 */}
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1.5">
                  🖼️ 参考图片 ({refPreviewModal.items.length} 张)
                </div>
                {refPreviewModal.items.length === 0 ? (
                  <div className="text-center text-slate-400 py-4 bg-slate-50 rounded-lg">
                    <p className="text-sm">无参考图，仅使用文字 Prompt 生成</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    {refPreviewModal.items.map((item, idx) => (
                      <div key={idx} className="flex flex-col gap-1">
                        <div className="relative bg-slate-100 rounded-lg overflow-hidden" style={getAspectRatioStyle(videoAspectRatio)}>
                          <img
                            src={localPathToSrc(item.path) || ''}
                            alt={item.name}
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                          <div className="absolute top-1 left-1 bg-slate-900/70 text-white text-xs px-1.5 py-0.5 rounded">
                            {idx + 1}
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 truncate text-center px-1">{item.name}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-3 px-5 py-4 border-t bg-slate-50 rounded-b-xl">
              <button
                onClick={() => {
                  setRefPreviewModal(null);
                  if (refPreviewResolveRef.current) {
                    refPreviewResolveRef.current(false);
                    refPreviewResolveRef.current = null;
                  }
                }}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setRefPreviewModal(null);
                  if (refPreviewResolveRef.current) {
                    refPreviewResolveRef.current(true);
                    refPreviewResolveRef.current = null;
                  }
                }}
                className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                确认发送{refPreviewModal.items.length > 0 ? `（${refPreviewModal.items.length} 张图）` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 视频编辑弹窗 */}
      <VideoEditModal
        isOpen={videoEditModalOpen}
        onClose={() => {
          setVideoEditModalOpen(false);
          setEditingVideoUrl(undefined);
        }}
        initialVideoUrl={editingVideoUrl}
        onSubmit={handleVideoEditSubmit}
        isGenerating={isVideoEditing}
      />
    </div>
  );
};

class EpisodeEditErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('EpisodeEdit 渲染错误:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-slate-50 flex items-center justify-center">
          <div className="text-center p-8">
            <div className="text-6xl mb-4">⚠</div>
            <h1 className="text-xl font-bold text-slate-800 mb-2">页面加载出错</h1>
            <p className="text-slate-500 mb-1 text-sm">错误信息：{this.state.error?.message}</p>
            <p className="text-slate-400 mb-6 text-xs">如反复出现此问题，可能是分镜数据异常</p>
            <div className="flex items-center justify-center space-x-3">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm"
              >
                重试
              </button>
              <button
                onClick={() => window.location.href = '/episodes'}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition text-sm"
              >
                返回分集列表
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function EpisodeEditWithErrorBoundary() {
  return (
    <EpisodeEditErrorBoundary>
      <EpisodeEdit />
    </EpisodeEditErrorBoundary>
  );
}

export default EpisodeEditWithErrorBoundary;
