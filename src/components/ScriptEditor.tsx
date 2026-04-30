import React, { useState, useRef, useEffect } from 'react';
import ScriptEditModal from './ScriptEditModal';
import { localPathToSrc, exportImageFile, uploadImage } from '../services/fileService';
import { useApp } from '../context/AppContext';
import { getEnabledModels, ModelInfo, getModelDisplayText } from '../utils/modelConfig';
import { getAspectRatioStyle } from '../utils/aspectRatioUtils';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

// 视频生成模式类型
type VideoGenMode = 'text' | 'first-frame' | 'first-last-frame' | 'reference-image';

// 支持的图片生成模型 - 从数据库动态加载
// 此数组仅作为备用,优先使用数据库配置
const IMAGE_MODELS: ModelInfo[] = [];

// 图片预览状态
interface ImagePreviewState {
  visible: boolean;
  url: string | null;
  localPath: string | null;  // 原始本地路径，用于导出
  title: string;
  shotIndex: number | null;  // 分镜索引
  frameType: 'first' | 'last' | null;  // 首帧还是尾帧
}

interface ScriptEditorProps {
  segment: any;
  episodeTitle: string;
  episodeContent?: string;  // 分集原文内容
  onSegmentUpdate?: (segment: any) => void;
  onGenerateShotVideo?: (shotIndex: number) => void;
  generatingShotIndex?: number | null;
  selectedShotIndex?: number;
  onSelectShot?: (index: number) => void;
  onGenerateFirstFrame?: (shotIndex: number) => void;
  onGenerateLastFrame?: (shotIndex: number) => void;
  generatingFrameShotIndex?: number | null;
  generatingFrameType?: 'first' | 'last' | null;
  onShotModeChange?: (shotIndex: number, mode: VideoGenMode) => void;
  videoAspectRatio?: string;
  onAspectRatioChange?: (shotIndex: number, ratio: string) => void;
  // 选择图片库图片
  onSelectFirstFrame?: (shotIndex: number) => void;
  onSelectLastFrame?: (shotIndex: number) => void;
  // 更新首帧/尾帧补充提示词
  onFirstFramePromptChange?: (shotIndex: number, prompt: string) => void;
  onLastFramePromptChange?: (shotIndex: number, prompt: string) => void;
  // 上传图片替换首帧/尾帧
  onUploadFirstFrame?: (shotIndex: number, localPath: string) => void;
  onUploadLastFrame?: (shotIndex: number, localPath: string) => void;
  // 上传首帧/尾帧图片作为主图
  onUploadFirstFrameImage?: (shotIndex: number, localPath: string) => void;
  onUploadLastFrameImage?: (shotIndex: number, localPath: string) => void;
  // 上传参考图
  onUploadFirstFrameRef?: (shotIndex: number, localPath: string) => void;
  onUploadLastFrameRef?: (shotIndex: number, localPath: string) => void;
  // 更新参考模式
  onFirstFrameRefModeChange?: (shotIndex: number, mode: 'only-ref' | 'ref-with-scene-char') => void;
  onLastFrameRefModeChange?: (shotIndex: number, mode: 'only-ref' | 'ref-with-scene-char') => void;
  // 参考图模式回调
  onUploadReferenceImage?: (shotIndex: number) => void;
  onRemoveReferenceImage?: (shotIndex: number, imgIndex: number) => void;
  onReferenceImagePromptChange?: (shotIndex: number, prompt: string) => void;
  // 图片生成模型选择
  selectedImageModel?: string;
  selectedImageSize?: string;
  onImageModelChange?: (model: string) => void;
  onImageSizeChange?: (size: string) => void;
  // 视频生成模型选择
  availableVideoModels?: ModelInfo[];
  selectedVideoModel?: string;
  onVideoModelChange?: (model: string) => void;
  // 角色和场景数据
  characters?: Array<{ id: number; name: string; imageUrl?: string }>;
  scenes?: Array<{ id: number; name: string; imageUrl?: string }>;
  // 角色和场景选择回调（支持多选）
  onCharactersChange?: (shotIndex: number, characterNames: string[]) => void;
  onSceneChange?: (shotIndex: number, sceneName: string) => void;
  // 选择历史图片作为参考图
  onSelectFirstFrameHistoryRef?: (shotIndex: number, localPath: string) => void;
  onSelectLastFrameHistoryRef?: (shotIndex: number, localPath: string) => void;
  // 历史图片数据（按日期分组）
  imageHistoryByDate?: Array<{ date: string; images: Array<{ id: number; localPath: string; prompt?: string; createdAt: string }> }>;
  // 更新分镜属性
  onShotDurationChange?: (shotIndex: number, duration: number) => void;
  onShotTypeChange?: (shotIndex: number, shotType: string) => void;
  onCameraMovementChange?: (shotIndex: number, cameraMovement: string) => void;
  // 删除分镜
  onDeleteShot?: (shotIndex: number) => void;
  // 更新分镜内容
  onShotContentChange?: (shotIndex: number, content: string) => void;
  // 重新生成分镜脚本
  onRegenerateStoryboard?: () => Promise<void>;
  // 重新生成分镜状态
  regeneratingStoryboard?: boolean;
  storyboardProgress?: string;
  storyboardContent?: string;  // 流式内容
}

// 备用视频生成模型列表
const VIDEO_MODELS: ModelInfo[] = [
  { id: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro', provider: 'volcengine', capability: 'videoGeneration' },
];

const ScriptEditor: React.FC<ScriptEditorProps> = ({ 
  segment, 
  episodeTitle,
  episodeContent,
  onSegmentUpdate,
  onGenerateShotVideo,
  generatingShotIndex,
  selectedShotIndex,
  onSelectShot,
  onGenerateFirstFrame,
  onGenerateLastFrame,
  generatingFrameShotIndex,
  generatingFrameType,
  onShotModeChange,
  videoAspectRatio,
  onAspectRatioChange,
  onSelectFirstFrame,
  onSelectLastFrame,
  onFirstFramePromptChange,
  onLastFramePromptChange,
  onUploadFirstFrame,
  onUploadLastFrame,
  onUploadFirstFrameImage,
  onUploadLastFrameImage,
  onUploadFirstFrameRef,
  onUploadLastFrameRef,
  onFirstFrameRefModeChange,
  onLastFrameRefModeChange,
  onUploadReferenceImage,
  onRemoveReferenceImage,
  onReferenceImagePromptChange,
  selectedImageModel,
  selectedImageSize,
  onImageModelChange,
  onImageSizeChange,
  availableVideoModels,
  selectedVideoModel,
  onVideoModelChange,
  characters,
  scenes,
  onCharactersChange,
  onSceneChange,
  onSelectFirstFrameHistoryRef,
  onSelectLastFrameHistoryRef,
  imageHistoryByDate,
  onShotDurationChange,
  onShotTypeChange,
  onCameraMovementChange,
  onDeleteShot,
  onShotContentChange,
  onRegenerateStoryboard,
  regeneratingStoryboard,
  storyboardProgress,
  storyboardContent
}) => {
  const { apiConfigs } = useApp();
  
  // 基于 apiConfigs 动态获取已启用的图片模型
  const enabledImageModels = React.useMemo(() => {
    if (apiConfigs && apiConfigs.length > 0) {
      const models = getEnabledModels(apiConfigs, 'imageGeneration');
      return models.length > 0 ? models : IMAGE_MODELS;
    }
    return IMAGE_MODELS;
  }, [apiConfigs]);

  // 安全地将任意值转换为字符串（用于 React 渲染）
  const safeValue = (value: any): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      try {
        // 如果是场景对象，优先返回 name 字段
        if (value.name) return String(value.name);
        return JSON.stringify(value);
      } catch {
        return '[数据异常]';
      }
    }
    return String(value);
  };

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreviewState>({
    visible: false,
    url: null,
    localPath: null,
    title: '',
    shotIndex: null,
    frameType: null
  });
  // 角色和场景下拉框展开状态
  const [openCharDropdown, setOpenCharDropdown] = useState<number | null>(null);
  const [openSceneDropdown, setOpenSceneDropdown] = useState<number | null>(null);
  // 历史图片选择器状态
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
  const [historyPickerShotIndex, setHistoryPickerShotIndex] = useState<number | null>(null);
  const [historyPickerType, setHistoryPickerType] = useState<'first' | 'last' | null>(null);
  
  // 分镜内容内联编辑状态
  const [editingShotIndex, setEditingShotIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  // 分镜折叠状态（默认展开第一个或选中的分镜）
  const [expandedShotIndex, setExpandedShotIndex] = useState<number>(selectedShotIndex ?? 0);
  
  // 当 selectedShotIndex 变化时，同步更新 expandedShotIndex
  useEffect(() => {
    if (selectedShotIndex !== null && selectedShotIndex !== undefined) {
      setExpandedShotIndex(selectedShotIndex);
    }
  }, [selectedShotIndex]);

  // 打开图片预览
  const openImagePreview = (url: string, localPath: string | null, title: string, shotIndex: number, frameType: 'first' | 'last') => {
    setImagePreview({ visible: true, url, localPath, title, shotIndex, frameType });
  };

  // 关闭图片预览
  const closeImagePreview = () => {
    setImagePreview({ visible: false, url: null, localPath: null, title: '', shotIndex: null, frameType: null });
  };

  // 保存图片
  const handleSaveImage = async () => {
    if (!imagePreview.localPath) {
      alert('无法保存：缺少本地文件路径');
      return;
    }
    
    try {
      const result = await exportImageFile(
        imagePreview.localPath,
        `${imagePreview.title}_${Date.now()}.png`
      );
      
      if (result) {
        alert(`图片已保存到: ${result}`);
      }
    } catch (error) {
      console.error('保存图片失败:', error);
      alert('保存图片失败');
    }
  };

  // 上传图片替换当前帧
  const handleUploadImage = async () => {
    if (imagePreview.shotIndex === null || !imagePreview.frameType) {
      return;
    }
    
    try {
      const localPath = await uploadImage('frames');
      if (!localPath) {
        return; // 用户取消选择
      }
      
      // 更新预览
      setImagePreview(prev => ({
        ...prev,
        url: localPathToSrc(localPath) || '',
        localPath: localPath
      }));
      
      // 调用回调函数更新数据
      if (imagePreview.frameType === 'first' && onUploadFirstFrame) {
        onUploadFirstFrame(imagePreview.shotIndex, localPath);
      } else if (imagePreview.frameType === 'last' && onUploadLastFrame) {
        onUploadLastFrame(imagePreview.shotIndex, localPath);
      }
      
      console.log(`已上传图片替换${imagePreview.frameType === 'first' ? '首帧' : '尾帧'}，路径: ${localPath}`);
    } catch (error) {
      console.error('上传图片失败:', error);
      alert('上传图片失败');
    }
  };

  // 上传首帧参考图
  const handleUploadFirstFrameRef = async (shotIndex: number) => {
    try {
      const localPath = await uploadImage('frames');
      if (!localPath) return;
      onUploadFirstFrameRef?.(shotIndex, localPath);
    } catch (error) {
      console.error('上传首帧参考图失败:', error);
      alert('上传参考图失败');
    }
  };

  // 上传尾帧参考图
  const handleUploadLastFrameRef = async (shotIndex: number) => {
    try {
      const localPath = await uploadImage('frames');
      if (!localPath) return;
      onUploadLastFrameRef?.(shotIndex, localPath);
    } catch (error) {
      console.error('上传尾帧参考图失败:', error);
      alert('上传参考图失败');
    }
  };

  // 上传首帧图片作为主图
  const handleUploadFirstFrameImage = async (shotIndex: number) => {
    try {
      const localPath = await uploadImage('frames');
      if (!localPath) return;
      onUploadFirstFrameImage?.(shotIndex, localPath);
    } catch (error) {
      console.error('上传首帧图片失败:', error);
      alert('上传首帧图片失败');
    }
  };

  // 上传尾帧图片作为主图
  const handleUploadLastFrameImage = async (shotIndex: number) => {
    try {
      const localPath = await uploadImage('frames');
      if (!localPath) return;
      onUploadLastFrameImage?.(shotIndex, localPath);
    } catch (error) {
      console.error('上传尾帧图片失败:', error);
      alert('上传尾帧图片失败');
    }
  };

  // 上传参考图（参考图模式）
  const handleUploadReferenceImage = async (shotIndex: number) => {
    try {
      const segmentData = segment;
      const shot = segmentData?.shots?.[shotIndex];
      const currentImages = shot?.referenceImages || [];
      
      if (currentImages.length >= 4) {
        alert('最多只能上传4张参考图');
        return;
      }
      
      const localPath = await uploadImage('frames');
      if (!localPath) return;
      
      // 通过回调更新父组件
      onUploadReferenceImage?.(shotIndex);
      // 实际路径更新由父组件处理
    } catch (error) {
      console.error('上传参考图失败:', error);
      alert('上传参考图失败');
    }
  };

  // 兼容扁平结构：segment 本身可能是 shot，或者包含 shots 数组
  const shots = (Array.isArray(segment?.shots) && segment.shots.length > 0) 
    ? segment.shots 
    : (segment?.description ? [segment] : []);
  
  // 调试信息
  console.log('[ScriptEditor] segment:', segment);
  console.log('[ScriptEditor] shots:', shots);
  console.log('[ScriptEditor] shots.length:', shots?.length);
  
  if (!segment || !shots || shots.length === 0) {
    return (
      <div className="flex-1 bg-white p-6 overflow-y-auto">
        <div className="text-center text-slate-400 py-12">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto mb-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
          </svg>
          <p className="text-lg mb-2">暂无分镜内容</p>
          <p className="text-sm">请先生成分镜脚本</p>
          {!segment && <p className="text-xs mt-2 text-red-500">segment 为 null</p>}
          {segment && !shots && <p className="text-xs mt-2 text-orange-500">segment.shots 为 undefined</p>}
        </div>
      </div>
    );
  }

  // 处理拖拽
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const assetData = e.dataTransfer.getData('asset');
    if (assetData) {
      try {
        const asset = JSON.parse(assetData);
        const insertText = asset.type === 'character' ? `[${asset.name}]` : `[场景:${asset.name}]`;
        
        // 显示提示
        if (onSegmentUpdate) {
          onSegmentUpdate({
            ...segment,
            description: segment.description + '\n\n' + insertText
          });
        }
        
        // 打开编辑弹窗让用户编辑
        setIsEditModalOpen(true);
      } catch (err) {
        console.error('解析拖拽数据失败:', err);
      }
    }
  };

  return (
    <div 
      ref={dropRef}
      className={`h-full flex-1 bg-white border-r border-slate-200 flex flex-col transition-colors relative ${
        isDragOver ? 'bg-blue-50' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 重新生成分镜遮罩层 */}
      {regeneratingStoryboard && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">
            {/* 标题和加载动画 */}
            <div className="text-center mb-6">
              <div className="mb-3">
                <svg className="animate-spin h-10 w-10 mx-auto text-orange-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">正在生成分镜脚本</h3>
              <p className="text-sm text-slate-600">AI 导演正在为您创建专业的分镜脚本</p>
            </div>

            {/* 步骤列表 */}
            <div className="bg-slate-50 rounded-xl p-4 mb-4">
              <div className="space-y-3">
                {/* 步骤 1 */}
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {storyboardProgress?.includes('✅ 划分完成') || storyboardProgress?.includes('第 1') ? (
                      <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : storyboardProgress?.includes('步骤 1') ? (
                      <div className="w-6 h-6 rounded-full border-2 border-orange-500 border-t-transparent animate-spin"></div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-slate-300"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${storyboardProgress?.includes('✅ 划分完成') || storyboardProgress?.includes('第 1') ? 'text-green-700' : 'text-slate-700'}`}>
                      划分镜头结构
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      正在分析剧本并划分镜头...
                    </p>
                  </div>
                </div>

                {/* 步骤 2 */}
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {storyboardProgress?.includes('✅ 所有镜头设计完成') || storyboardProgress?.includes('镜头设计完成') ? (
                      <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : storyboardProgress?.includes('步骤 2') || storyboardProgress?.includes('正在设计第') ? (
                      <div className="w-6 h-6 rounded-full border-2 border-orange-500 border-t-transparent animate-spin"></div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-slate-300"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${storyboardProgress?.includes('✅ 所有镜头设计完成') || storyboardProgress?.includes('镜头设计完成') ? 'text-green-700' : 'text-slate-700'}`}>
                      完善镜头设计
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      正在逐个镜头完善设计(添加摄影参数、台词、声音等)...
                    </p>
                  </div>
                </div>

                {/* 当前进度文本 */}
                {storyboardProgress && !storyboardProgress.includes('重新加载') && !storyboardProgress.includes('保存到数据库') && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <p className="text-xs text-orange-600 font-medium">{storyboardProgress}</p>
                  </div>
                )}
              </div>
            </div>

            {/* 进度条 */}
            <div className="w-full bg-slate-200 rounded-full h-2 mb-3">
              <div 
                className="bg-orange-500 h-2 rounded-full transition-all duration-500" 
                style={{
                  width: storyboardProgress?.includes('✅ 所有镜头') ? '100%' : 
                         storyboardProgress?.includes('✅ 划分完成') ? '50%' : 
                         storyboardProgress?.includes('步骤 2') || storyboardProgress?.includes('正在设计第') ? '75%' : '25%'
                }}
              ></div>
            </div>

            {/* 流式内容显示区 */}
            {storyboardContent && (
              <div className="bg-gray-900 rounded-lg p-3 mb-3 max-h-40 overflow-y-auto">
                <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap break-all">
                  {storyboardContent}
                </pre>
              </div>
            )}

            {/* 提示信息 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start space-x-2">
                <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <p className="text-xs text-blue-700">
                  这个过程可能需要 2-5 分钟，AI 会逐个镜头精心设计，请耐心等待。
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* 拖拽提示 */}
      {isDragOver && (
        <div className="absolute inset-0 bg-blue-50 bg-opacity-90 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
            </svg>
            <p className="text-blue-600 font-medium">松开鼠标添加到脚本</p>
          </div>
        </div>
      )}
      
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-800">
            分集 {segment.order !== undefined ? segment.order + 1 : segment.id}
          </h2>
          {onRegenerateStoryboard && (
            <button
              onClick={async () => {
                if (confirm('确定要重新生成分镜吗？这将覆盖当前分镜内容。')) {
                  await onRegenerateStoryboard();
                }
              }}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm flex items-center space-x-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
              <span>重新生成分镜</span>
            </button>
          )}
        </div>
        <p className="text-sm text-slate-500 mb-3">
          分集时长调整限制4~15s，输入"@"可快速选择镜头长、引用角色、场景、素材
        </p>
        <div className="bg-slate-50 rounded-lg p-3 max-h-48 overflow-y-auto">
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
            {safeValue(episodeContent || segment.description)}
          </p>
        </div>
        <div className="mt-3 flex items-center space-x-4 text-sm">
          <div className="flex items-center space-x-2">
            <span className="text-slate-500">本分集场景设定在：</span>
            <span className="px-2 py-1 bg-slate-700 text-white rounded-lg text-xs">
              {safeValue(segment.scene)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
        {shots.map((shot: any, index: number) => {
          try {
            // getSafeDescription 内联函数：统一将 shot.description 转为安全字符串
            const getSafeDescription = (desc: any): string => {
              if (typeof desc === 'string') {
                return desc;
              }
              if (typeof desc === 'object' && desc !== null) {
                try {
                  return JSON.stringify(desc);
                } catch {
                  return '[内容解析异常]';
                }
              }
              return '';
            };

            const safeDescription = getSafeDescription(shot.description);
            const isSelected = index === (selectedShotIndex ?? 0);
            const isExpanded = index === expandedShotIndex;  // 只有展开的分镜才显示详细内容
            const hasVideo = shot.status === 'generated' && (shot.videoUrl || shot.localVideoPath);
            const hasFirstFrame = shot.firstFrameImage || shot.firstFrameLocalPath;
            const hasLastFrame = shot.lastFrameImage || shot.lastFrameLocalPath;
            const canGenerateVideo = hasFirstFrame;

            return (
            <div
              key={shot.id || index}
              className={`border rounded-lg transition ${
                isExpanded
                  ? 'border-indigo-200 bg-indigo-50/50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
              }`}
            >
              {/* 分镜标题栏 - 始终显示 */}
              <div
                className="p-3 cursor-pointer flex items-start justify-between"
                onClick={() => {
                  onSelectShot?.(index);
                  setExpandedShotIndex(isExpanded ? -1 : index);  // 切换展开/折叠
                }}
              >
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <svg
                      className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    <span className={`text-sm font-medium ${isExpanded ? 'text-indigo-700' : 'text-slate-800'}`}>
                      {shot.shotNumber ? `镜头 ${safeValue(shot.shotNumber)}` : `分镜 ${index + 1}`}
                    </span>
                    <span className="text-xs text-slate-500">{safeValue(shot.duration || 5)}s</span>
                    {shot.shotType && (
                      <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                        {safeValue(shot.shotType)}
                      </span>
                    )}
                    {shot.cameraMovement && (
                      <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded">
                        {safeValue(shot.cameraMovement)}
                      </span>
                    )}
                  </div>
                  {/* 折叠时显示内容摘要 - 使用 safeDescription */}
                  {!isExpanded && safeDescription && (
                    <p className="text-xs text-slate-600 line-clamp-2 ml-6">
                      {safeDescription.length > 100 ? safeDescription.substring(0, 100) + '...' : safeDescription}
                    </p>
                  )}
                </div>

                {/* 状态图标 */}
                <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                  {hasVideo && <span className="text-xs text-emerald-600 whitespace-nowrap">✓ 视频</span>}
                  {hasFirstFrame && !hasVideo && <span className="text-xs text-indigo-600 whitespace-nowrap">✓ 首帧</span>}
                </div>
              </div>

              {/* 展开的详细内容 */}
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-slate-200 pt-3 space-y-3">
                  {/* 分镜内容 - 可内联编辑 */}
              {editingShotIndex === index ? (
                <div className="mb-3">
                  <textarea
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    className="w-full text-sm text-slate-700 leading-relaxed border border-indigo-400 rounded-lg px-2 py-1 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                    rows={3}
                    autoFocus
                    onBlur={() => {
                      // 保存编辑
                      onShotContentChange?.(index, editingContent);
                      setEditingShotIndex(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditingShotIndex(null);
                      } else if (e.key === 'Enter' && e.ctrlKey) {
                        // Ctrl+Enter 保存
                        onShotContentChange?.(index, editingContent);
                        setEditingShotIndex(null);
                      }
                    }}
                  />
                  <div className="text-xs text-slate-400 mt-1">按 Ctrl+Enter 或点击外部保存，Esc 取消</div>
                </div>
              ) : (
                <p
                  className="text-sm text-slate-700 leading-relaxed mb-3 whitespace-pre-wrap cursor-pointer hover:bg-slate-50 px-2 py-1 rounded-lg border border-transparent hover:border-slate-300 transition"
                  onClick={() => {
                    setEditingShotIndex(index);
                    setEditingContent(safeDescription);
                  }}
                  title="点击编辑内容"
                >
                                  {safeDescription}
                </p>
              )}
            
            {/* 角色动作描述 */}
            {shot.action && (
              <div className="mb-3 p-2 bg-amber-50/80 border-l-2 border-amber-400 rounded text-xs text-slate-700">
                <span className="font-medium text-amber-700">🎭 动作/表情：</span>
                {safeValue(shot.action)}
              </div>
            )}
            
            {/* 台词显示 */}
            {shot.dialogue && shot.dialogue.length > 0 && (
              <div className="mb-3 space-y-2">
                {shot.dialogue.map((d: any, idx: number) => (
                  <div key={idx} className="p-2 bg-blue-50/80 border-l-2 border-blue-400 rounded">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-xs font-medium text-blue-700">{safeValue(d.character)}</span>
                      {d.emotion && (
                        <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                          {safeValue(d.emotion)}
                        </span>
                      )}
                      {d.delivery && (
                        <span className="text-xs px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">
                          {safeValue(d.delivery)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-800 italic">"{safeValue(d.line)}"</p>
                  </div>
                ))}
              </div>
            )}

            {/* 角色选择 - 自定义多选下拉框 */}
            <div className="flex items-center space-x-2 mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              {characters && characters.length > 0 ? (
                <div className="relative flex-1">
                  {/* 下拉框触发按钮 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenCharDropdown(openCharDropdown === index ? null : index);
                      setOpenSceneDropdown(null);
                    }}
                    className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white text-left flex items-center justify-between hover:border-indigo-400"
                  >
                    <span className="text-slate-500">
                      {shot.characters && shot.characters.length > 0 
                        ? `已选 ${shot.characters.length} 个角色` 
                        : '选择角色...'}
                    </span>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 text-slate-400 transition-transform ${openCharDropdown === index ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                  
                  {/* 下拉选项列表 */}
                  {openCharDropdown === index && (
                    <div 
                      className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {characters.map((char) => {
                        const isSelected = shot.characters?.includes(char.name);
                        return (
                          <label
                            key={char.id}
                            className="flex items-center px-3 py-2 hover:bg-slate-50 cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                e.stopPropagation();
                                const currentChars = shot.characters || [];
                                const newChars = isSelected
                                  ? currentChars.filter((c: string) => c !== char.name)
                                  : [...currentChars, char.name];
                                onCharactersChange?.(index, newChars);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="mr-2 h-3 w-3 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                            />
                            <span className="text-xs text-slate-700">{char.name}</span>
                          </label>
                        );
                      })}
                      {/* 确认按钮 */}
                      <div className="px-3 py-2 border-t border-slate-100 bg-slate-50">
                        <button
                          onClick={() => setOpenCharDropdown(null)}
                          className="w-full text-xs bg-indigo-600 text-white py-1.5 rounded-lg hover:bg-indigo-700 transition"
                        >
                          确认
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-xs text-slate-400">暂无角色可选</span>
              )}
              {/* 显示已选角色标签 */}
              {shot.characters && shot.characters.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {shot.characters.map((char: string, idx: number) => (
                    <span key={idx} className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">
                      {safeValue(char)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 场景选择 - 自定义下拉单选 */}
            <div className="flex items-center space-x-2 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              {scenes && scenes.length > 0 ? (
                <div className="relative flex-1">
                  {/* 下拉框触发按钮 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenSceneDropdown(openSceneDropdown === index ? null : index);
                      setOpenCharDropdown(null);
                    }}
                    className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white text-left flex items-center justify-between hover:border-emerald-400"
                  >
                    <span className={shot.scene ? 'text-slate-800' : 'text-slate-500'}>
                      {shot.scene ? safeValue(shot.scene) : '选择场景...'}
                    </span>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 text-slate-400 transition-transform ${openSceneDropdown === index ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                  
                  {/* 下拉选项列表 */}
                  {openSceneDropdown === index && (
                    <div 
                      className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {scenes.map((scene) => (
                        <button
                          key={scene.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSceneChange?.(index, scene.name);
                            setOpenSceneDropdown(null);
                          }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${shot.scene === scene.name ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700'}`}
                        >
                          {scene.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-xs text-slate-400">暂无场景可选</span>
              )}
              {/* 显示已选场景 */}
              {shot.scene && (
                <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded">
                  {safeValue(shot.scene)}
                </span>
              )}
            </div>
            
            {shot.audio && (
              <div className="mb-3 p-2 bg-slate-50 rounded text-xs text-slate-600">
                {typeof shot.audio === 'string' ? (
                  <>🎵 {safeValue(shot.audio)}</>
                ) : (
                  <div className="space-y-1">
                    <div className="font-medium text-slate-700 mb-1">🎵 声音设计</div>
                    {shot.audio.dialogue && (
                      <div><span className="text-slate-500">对白：</span>{safeValue(shot.audio.dialogue)}</div>
                    )}
                    {shot.audio.ambience && (
                      <div><span className="text-slate-500">环境音：</span>{safeValue(shot.audio.ambience)}</div>
                    )}
                    {shot.audio.sfx && shot.audio.sfx.length > 0 && (
                      <div><span className="text-slate-500">音效：</span>{shot.audio.sfx.map((s: any) => safeValue(s)).join('、')}</div>
                    )}
                    {shot.audio.bgm && (
                      <div><span className="text-slate-500">背景音乐：</span>{safeValue(shot.audio.bgm)}</div>
                    )}
                    {shot.audio.volume && (
                      <div><span className="text-slate-500">音量平衡：</span>{safeValue(shot.audio.volume)}</div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {/* 导演备注 */}
            {shot.notes && (
              <div className="mb-3 p-2 bg-emerald-50/80 border-l-2 border-emerald-400 rounded text-xs text-slate-700">
                <span className="font-medium text-emerald-700">🎬 导演备注：</span>
                {safeValue(shot.notes)}
              </div>
            )}

            {/* 视频播放区域 */}
            {hasVideo && (
              <div className="mb-4">
                <div className="relative bg-slate-900 rounded-lg overflow-hidden" style={getAspectRatioStyle(shot.aspectRatio || videoAspectRatio)}>
                  <video
                    src={(() => {
                      // 优先使用本地路径
                      if (shot.localVideoPath) {
                        return convertFileSrc(shot.localVideoPath);
                      }
                      return shot.videoUrl || '';
                    })()}
                    className="w-full h-full object-contain"
                    controls
                    preload="metadata"
                    playsInline
                  />
                </div>
                <div className="flex items-center justify-end space-x-2 mt-2">
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const localPath = shot.localVideoPath;
                      if (localPath) {
                        try {
                          await invoke('open_local_file', { path: localPath });
                        } catch (err: any) {
                          alert('打开失败: ' + (err?.message || '未知错误'));
                        }
                      } else if (shot.videoUrl) {
                        window.open(shot.videoUrl, '_blank');
                      }
                    }}
                    className="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition"
                  >
                    外部播放器打开
                  </button>
                </div>
              </div>
            )}

            {/* 视频生成设置区域 */}
            <div className="mb-4 p-3 bg-slate-50 rounded-lg">
              {/* 模式选择和宽高比 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-medium text-slate-700">生成模式:</span>
                  <select
                    value={shot.videoGenMode || 'first-frame'}
                    onChange={(e) => {
                      e.stopPropagation();
                      onShotModeChange?.(index, e.target.value as VideoGenMode);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="text">文+角色+场景生视频</option>
                    <option value="first-frame">图生视频(首帧)</option>
                    <option value="first-last-frame">图生视频(首尾帧)</option>
                    <option value="reference-image">图生视频(参考图)</option>
                  </select>
                  
                  <span className="text-xs font-medium text-slate-700 ml-2">比例:</span>
                  <select
                    value={shot.aspectRatio || videoAspectRatio || '16:9'}
                    onChange={(e) => {
                      e.stopPropagation();
                      onAspectRatioChange?.(index, e.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="16:9">16:9 横版</option>
                    <option value="9:16">9:16 竖版</option>
                    <option value="1:1">1:1 方形</option>
                    <option value="4:3">4:3 标准</option>
                    <option value="3:4">3:4 竖版</option>
                  </select>
                </div>
              </div>
              
              {/* 根据模式显示不同的按钮和图片区域 */}
              {(shot.videoGenMode === 'first-frame' || shot.videoGenMode === 'first-last-frame' || !shot.videoGenMode) && (
                <>
                  {/* 模型选择和分辨率选择 */}
                  <div className="flex items-center space-x-2 mb-2">
                    <select
                      value={selectedImageModel || 'nano-banana-fast'}
                      onChange={(e) => {
                        e.stopPropagation();
                        onImageModelChange?.(e.target.value);
                        // 自动切换到该模型的第一个分辨率
                        const model = enabledImageModels.find(m => m.id === e.target.value);
                        if (model && model.resolutions && model.resolutions.length > 0) {
                          onImageSizeChange?.(model.resolutions[0]);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      {enabledImageModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {getModelDisplayText(model.provider, model.id)}
                        </option>
                      ))}
                    </select>
                    <div className="flex space-x-1">
                      {((enabledImageModels.find(m => m.id === (selectedImageModel || 'nano-banana-fast')) || enabledImageModels[0])?.resolutions || []).map((res) => (
                        <button
                          key={res}
                          onClick={(e) => {
                            e.stopPropagation();
                            onImageSizeChange?.(res);
                          }}
                          className={`px-2 py-1 text-xs rounded-lg transition ${
                            (selectedImageSize || '2K') === res
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* 帧图片按钮 */}
                  <div className="flex items-center space-x-2 mb-2">
                    {/* 首帧按钮 - 首帧模式和首尾帧模式都显示 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onGenerateFirstFrame?.(index);
                      }}
                      disabled={generatingFrameShotIndex === index && generatingFrameType === 'first'}
                      className={`px-2 py-1 text-xs rounded-lg transition flex items-center space-x-1 ${
                        generatingFrameShotIndex === index && generatingFrameType === 'first'
                          ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                          : hasFirstFrame 
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' 
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {generatingFrameShotIndex === index && generatingFrameType === 'first' ? (
                        <span>生成中...</span>
                      ) : hasFirstFrame ? (
                        <span>重新生成首帧</span>
                      ) : (
                        <span>生成首帧</span>
                      )}
                    </button>
                    
                    {/* 尾帧按钮 - 只有首尾帧模式才显示 */}
                    {shot.videoGenMode === 'first-last-frame' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onGenerateLastFrame?.(index);
                        }}
                        disabled={generatingFrameShotIndex === index && generatingFrameType === 'last'}
                        className={`px-2 py-1 text-xs rounded-lg transition flex items-center space-x-1 ${
                          generatingFrameShotIndex === index && generatingFrameType === 'last'
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            : hasLastFrame 
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' 
                              : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                      >
                        {generatingFrameShotIndex === index && generatingFrameType === 'last' ? (
                          <span>生成中...</span>
                        ) : hasLastFrame ? (
                          <span>重新生成尾帧</span>
                        ) : (
                          <span>生成尾帧</span>
                        )}
                      </button>
                    )}
                  </div>
                  
                  {/* 首帧补充提示词 */}
                  <div className="mb-2">
                    <input
                      type="text"
                      value={shot.firstFramePrompt || ''}
                      onChange={(e) => {
                        e.stopPropagation();
                        onFirstFramePromptChange?.(index, e.target.value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="首帧补充提示词（可选）"
                      className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  
                  {/* 首帧参考图上传 */}
                  <div className="mb-2 flex items-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUploadFirstFrameRef(index);
                      }}
                      className="px-2 py-1 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition"
                    >
                      上传首帧参考图
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setHistoryPickerShotIndex(index);
                        setHistoryPickerType('first');
                        setShowHistoryPicker(true);
                      }}
                      className="px-2 py-1 text-xs bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition"
                    >
                      选择历史图片
                    </button>
                    {shot.firstFrameRefImage && (
                      <span className="text-xs text-emerald-600">已上传 ✓</span>
                    )}
                  </div>
                  
                  {/* 首帧参考模式 */}
                  {shot.firstFrameRefImage && (
                    <div className="mb-2">
                      <select
                        value={shot.firstFrameRefMode || 'ref-with-scene-char'}
                        onChange={(e) => {
                          e.stopPropagation();
                          onFirstFrameRefModeChange?.(index, e.target.value as 'only-ref' | 'ref-with-scene-char');
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                      >
                        <option value="only-ref">只看参考图</option>
                        <option value="ref-with-scene-char">同时参考角色和场景</option>
                      </select>
                    </div>
                  )}
                  
                  {/* 尾帧补充提示词 - 只有首尾帧模式才显示 */}
                  {shot.videoGenMode === 'first-last-frame' && (
                    <>
                      <div className="mb-2">
                        <input
                          type="text"
                          value={shot.lastFramePrompt || ''}
                          onChange={(e) => {
                            e.stopPropagation();
                            onLastFramePromptChange?.(index, e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="尾帧补充提示词（可选）"
                          className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      
                      {/* 尾帧参考图上传 */}
                      <div className="mb-2 flex items-center space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUploadLastFrameRef(index);
                          }}
                          className="px-2 py-1 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition"
                        >
                          上传尾帧参考图
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setHistoryPickerShotIndex(index);
                            setHistoryPickerType('last');
                            setShowHistoryPicker(true);
                          }}
                          className="px-2 py-1 text-xs bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition"
                        >
                          选择历史图片
                        </button>
                        {shot.lastFrameRefImage && (
                          <span className="text-xs text-emerald-600">已上传 ✓</span>
                        )}
                      </div>
                      
                      {/* 尾帧参考模式 */}
                      {shot.lastFrameRefImage && (
                        <div className="mb-2">
                          <select
                            value={shot.lastFrameRefMode || 'ref-with-scene-char'}
                            onChange={(e) => {
                              e.stopPropagation();
                              onLastFrameRefModeChange?.(index, e.target.value as 'only-ref' | 'ref-with-scene-char');
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="only-ref">只看参考图</option>
                            <option value="ref-with-scene-char">同时参考角色和场景</option>
                          </select>
                        </div>
                      )}
                    </>
                  )}
                  
                  {/* 帧图片显示区域 */}
                  <div className={`flex items-start ${shot.videoGenMode === 'first-last-frame' ? 'space-x-3' : ''}`}>
                    {/* 首帧图片 */}
                    <div className={shot.videoGenMode === 'first-last-frame' ? 'flex-1' : 'w-full'}>
                      <p className="text-xs text-slate-500 mb-1">首帧图片</p>
                      {generatingFrameShotIndex === index && generatingFrameType === 'first' ? (
                        <div className="bg-slate-200 rounded-lg flex items-center justify-center" style={getAspectRatioStyle(shot.aspectRatio || videoAspectRatio)}>
                          <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent"></div>
                        </div>
                      ) : hasFirstFrame ? (
                        <div 
                          className="relative bg-slate-200 rounded-lg overflow-hidden cursor-pointer group"
                          style={getAspectRatioStyle(shot.aspectRatio || videoAspectRatio)}
                          onClick={() => openImagePreview(
                            localPathToSrc(shot.firstFrameLocalPath) || shot.firstFrameImage || '',
                            shot.firstFrameLocalPath || null,
                            '首帧',
                            index,
                            'first'
                          )}
                        >
                          <img 
                            src={localPathToSrc(shot.firstFrameLocalPath) || shot.firstFrameImage} 
                            alt="首帧"
                            className="w-full h-full object-contain"
                          />
                          <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/30 transition-all flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                            </svg>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-slate-200 rounded-lg flex flex-col items-center justify-center space-y-2" style={getAspectRatioStyle(shot.aspectRatio || videoAspectRatio)}>
                          <span className="text-xs text-slate-400">未生成</span>
                          <div className="flex space-x-2">
                            {onSelectFirstFrame && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectFirstFrame(index);
                                }}
                                className="px-2 py-1 text-xs bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition"
                              >
                                选择图片
                              </button>
                            )}
                            {onUploadFirstFrameImage && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUploadFirstFrameImage(index);
                                }}
                                className="px-2 py-1 text-xs bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition"
                              >
                                上传图片
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* 尾帧图片 - 只有首尾帧模式才显示 */}
                    {shot.videoGenMode === 'first-last-frame' && (
                      <div className="flex-1">
                        <p className="text-xs text-slate-500 mb-1">尾帧图片</p>
                        {generatingFrameShotIndex === index && generatingFrameType === 'last' ? (
                          <div className="bg-slate-200 rounded-lg flex items-center justify-center" style={getAspectRatioStyle(shot.aspectRatio || videoAspectRatio)}>
                            <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent"></div>
                          </div>
                        ) : hasLastFrame ? (
                          <div 
                            className="relative bg-slate-200 rounded-lg overflow-hidden cursor-pointer group"
                            style={getAspectRatioStyle(shot.aspectRatio || videoAspectRatio)}
                            onClick={() => openImagePreview(
                              localPathToSrc(shot.lastFrameLocalPath) || shot.lastFrameImage || '',
                              shot.lastFrameLocalPath || null,
                              '尾帧',
                              index,
                              'last'
                            )}
                          >
                            <img 
                              src={localPathToSrc(shot.lastFrameLocalPath) || shot.lastFrameImage} 
                              alt="尾帧"
                              className="w-full h-full object-contain"
                            />
                            <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/30 transition-all flex items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                              </svg>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-slate-200 rounded-lg flex flex-col items-center justify-center space-y-2" style={getAspectRatioStyle(shot.aspectRatio || videoAspectRatio)}>
                            <span className="text-xs text-slate-400">未生成</span>
                            <div className="flex space-x-2">
                              {onSelectLastFrame && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectLastFrame(index);
                                  }}
                                  className="px-2 py-1 text-xs bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition"
                                >
                                  选择图片
                                </button>
                              )}
                              {onUploadLastFrameImage && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUploadLastFrameImage(index);
                                  }}
                                  className="px-2 py-1 text-xs bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition"
                                >
                                  上传图片
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

              {/* 参考图模式 */}
              {shot.videoGenMode === 'reference-image' && (
                <>
                  {/* 模型选择和分辨率选择 */}
                  <div className="flex items-center space-x-2 mb-2">
                    <select
                      value={selectedImageModel || 'nano-banana-fast'}
                      onChange={(e) => {
                        e.stopPropagation();
                        onImageModelChange?.(e.target.value);
                        // 自动切换到该模型的第一个分辨率
                        const model = enabledImageModels.find(m => m.id === e.target.value);
                        if (model && model.resolutions && model.resolutions.length > 0) {
                          onImageSizeChange?.(model.resolutions[0]);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      {enabledImageModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {getModelDisplayText(model.provider, model.id)}
                        </option>
                      ))}
                    </select>
                    <div className="flex space-x-1">
                      {((enabledImageModels.find(m => m.id === (selectedImageModel || 'nano-banana-fast')) || enabledImageModels[0])?.resolutions || []).map((res) => (
                        <button
                          key={res}
                          onClick={(e) => {
                            e.stopPropagation();
                            onImageSizeChange?.(res);
                          }}
                          className={`px-2 py-1 text-xs rounded-lg transition ${
                            (selectedImageSize || '2K') === res
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>
                
                  <div className="flex items-center space-x-2 mb-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUploadReferenceImage(index);
                      }}
                      className="px-2 py-1 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition"
                    >
                      添加参考图 (1-4张)
                    </button>
                    {(shot.referenceImages?.length || 0) > 0 && (
                      <span className="text-xs text-green-600">已上传 {(shot.referenceImages?.length || 0)}/4 张</span>
                    )}
                  </div>

                  {shot.referenceImages && shot.referenceImages.length > 0 && (
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {shot.referenceImages.map((img: string, imgIdx: number) => (
                        <div key={imgIdx} className="relative bg-slate-200 rounded-lg overflow-hidden" style={getAspectRatioStyle(shot.aspectRatio || videoAspectRatio)}>
                          <img src={localPathToSrc(img) || ''} alt={`参考图${imgIdx + 1}`} className="w-full h-full object-contain" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveReferenceImage?.(index, imgIdx);
                            }}
                            className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 参考图补充提示词 */}
                  <div className="mb-2">
                    <input
                      type="text"
                      value={shot.referenceImagePrompt || ''}
                      onChange={(e) => {
                        e.stopPropagation();
                        onReferenceImagePromptChange?.(index, e.target.value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="参考图补充提示词（可选），例如：[图1]戴着眼镜的男生和[图2]的柯基小狗"
                      className="w-full px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </>
              )}


            {/* 生成视频按钮 */}
            {onGenerateShotVideo && (
              <div className="flex items-center justify-end space-x-2">
                {/* 视频生成模型选择 */}
                {availableVideoModels && availableVideoModels.length > 0 && (
                  <select
                    value={selectedVideoModel || availableVideoModels[0]?.id || ''}
                    onChange={(e) => {
                      e.stopPropagation();
                      onVideoModelChange?.(e.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="px-2 py-1.5 text-xs border border-indigo-200 rounded-lg bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    {availableVideoModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {getModelDisplayText(model.provider, model.id)}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onGenerateShotVideo(index);
                  }}
                  disabled={generatingShotIndex === index}
                  className={`px-4 py-2 text-sm rounded-lg transition flex items-center space-x-2 ${
                    generatingShotIndex === index
                      ? 'bg-slate-100 text-slate-400 cursor-wait'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {generatingShotIndex === index ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      <span>生成视频中...</span>
                    </>
                  ) : hasVideo ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                      </svg>
                      <span>重新生成视频</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                      </svg>
                      <span>生成视频</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
            )}
          </div>
        );
        } catch (err) {
          console.error('单个分镜渲染异常:', err, shot);
          return (
            <div key={shot?.id || index} className="border rounded-lg border-red-300 bg-red-50 p-3 mb-2">
              <div className="text-xs text-red-700">
                分镜 {index + 1} 数据异常：{err instanceof Error ? err.message : '未知错误'}
              </div>
            </div>
          );
        }
        })}
      </div>

      {isEditModalOpen && (
        <ScriptEditModal
          segment={segment}
          onClose={() => setIsEditModalOpen(false)}
          onSave={(updatedSegment) => {
            onSegmentUpdate?.(updatedSegment);
            setIsEditModalOpen(false);
          }}
        />
      )}

      {/* 图片预览模态框 */}
      {imagePreview.visible && imagePreview.url && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={closeImagePreview}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] bg-white rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* 标题栏 */}
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">{imagePreview.title}</h3>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleUploadImage}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition flex items-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>上传替换</span>
                </button>
                <button
                  onClick={handleSaveImage}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition flex items-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  <span>保存图片</span>
                </button>
                <button
                  onClick={closeImagePreview}
                  className="p-2 text-slate-400 hover:text-slate-600 transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {/* 图片内容 */}
            <div className="p-4">
              <img 
                src={imagePreview.url} 
                alt={imagePreview.title}
                className="max-w-full max-h-[70vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* 历史图片选择器模态框 */}
      {showHistoryPicker && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowHistoryPicker(false)}
        >
          <div 
            className="bg-white rounded-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold">
                选择{historyPickerType === 'first' ? '首帧' : '尾帧'}历史参考图
              </h3>
              <button
                onClick={() => setShowHistoryPicker(false)}
                className="p-2 text-slate-400 hover:text-slate-600 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {imageHistoryByDate && imageHistoryByDate.length > 0 ? (
                imageHistoryByDate.map(dateGroup => (
                  <div key={dateGroup.date} className="mb-6">
                    <div className="text-sm font-medium text-slate-600 mb-2 flex items-center">
                      <span className="bg-slate-100 px-2 py-1 rounded-lg">{safeValue(dateGroup.date)}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-3">
                      {dateGroup.images.map(img => (
                        <div
                          key={img.id}
                          onClick={() => {
                            if (historyPickerType === 'first' && historyPickerShotIndex !== null && onSelectFirstFrameHistoryRef) {
                              onSelectFirstFrameHistoryRef(historyPickerShotIndex, img.localPath);
                            } else if (historyPickerType === 'last' && historyPickerShotIndex !== null && onSelectLastFrameHistoryRef) {
                              onSelectLastFrameHistoryRef(historyPickerShotIndex, img.localPath);
                            }
                            setShowHistoryPicker(false);
                          }}
                          className="cursor-pointer border-2 border-transparent hover:border-purple-500 rounded-lg overflow-hidden transition"
                        >
                          <img 
                            src={localPathToSrc(img.localPath) || ''}
                            alt={img.prompt || '历史图片'}
                            className="w-full object-contain bg-slate-100"
                          />
                          <div className="p-2 text-xs text-center truncate">
                            {img.prompt ? safeValue(img.prompt) : '无提示词'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-slate-400 py-8">暂无历史生成图片</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 删除分镜确认弹窗 */}
      {deleteConfirmIndex !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">确认删除</h3>
            <p className="text-slate-600 mb-6">确定要删除分镜 {deleteConfirmIndex + 1} 吗？此操作不可撤销。</p>
            <div className="flex space-x-3">
              <button
                onClick={() => setDeleteConfirmIndex(null)}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition"
              >
                取消
              </button>
              <button
                onClick={() => {
                  onDeleteShot?.(deleteConfirmIndex);
                  setDeleteConfirmIndex(null);
                }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScriptEditor;
