import React, { useState, useEffect } from 'react';

interface VideoEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialVideoUrl?: string;  // 从已有视频触发时预填
  onSubmit: (params: {
    inputVideo: string;
    prompt: string;
    referenceImages?: string[];
    resolution: '720P' | '1080P';
    audioSetting: 'auto' | 'origin';
  }) => void;
  isGenerating?: boolean;  // 是否正在生成中
}

const VideoEditModal: React.FC<VideoEditModalProps> = ({
  isOpen,
  onClose,
  initialVideoUrl,
  onSubmit,
  isGenerating = false
}) => {
  const [inputVideo, setInputVideo] = useState(initialVideoUrl || '');
  const [prompt, setPrompt] = useState('');
  const [refImageUrlInput, setRefImageUrlInput] = useState('');
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [resolution, setResolution] = useState<'720P' | '1080P'>('1080P');
  const [audioSetting, setAudioSetting] = useState<'auto' | 'origin'>('auto');

  // 当 initialVideoUrl 变化时同步更新
  useEffect(() => {
    if (initialVideoUrl) {
      setInputVideo(initialVideoUrl);
    }
  }, [initialVideoUrl]);

  // 弹窗打开时重置部分状态
  useEffect(() => {
    if (isOpen) {
      setPrompt('');
      setRefImageUrlInput('');
      setReferenceImages([]);
      setResolution('1080P');
      setAudioSetting('auto');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // 添加参考图URL
  const handleAddRefImage = () => {
    if (!refImageUrlInput.trim()) return;
    if (referenceImages.length >= 5) {
      alert('最多只能添加5张参考图');
      return;
    }
    // 支持逗号或换行分隔多个URL
    const urls = refImageUrlInput
      .split(/[,，\n]+/)
      .map(u => u.trim())
      .filter(Boolean);
    const newImages = [...referenceImages, ...urls].slice(0, 5);
    setReferenceImages(newImages);
    setRefImageUrlInput('');
  };

  // 删除参考图
  const handleRemoveRefImage = (index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
  };

  // 提交
  const handleSubmit = () => {
    if (!inputVideo.trim()) {
      alert('请输入视频URL');
      return;
    }
    if (!prompt.trim()) {
      alert('请输入编辑指令');
      return;
    }
    onSubmit({
      inputVideo: inputVideo.trim(),
      prompt: prompt.trim(),
      referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      resolution,
      audioSetting
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">视频编辑</h2>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="p-2 text-gray-400 hover:text-gray-600 transition disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 视频预览/输入区域 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">输入视频</label>
            {inputVideo ? (
              <div className="space-y-2">
                <div className="relative bg-slate-900 rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
                  <video
                    src={inputVideo}
                    className="w-full h-full object-contain"
                    controls
                    preload="metadata"
                    playsInline
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={inputVideo}
                    onChange={(e) => setInputVideo(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="视频URL"
                  />
                  <button
                    onClick={() => setInputVideo('')}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
                  >
                    清除
                  </button>
                </div>
              </div>
            ) : (
              <input
                type="text"
                value={inputVideo}
                onChange={(e) => setInputVideo(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="请粘贴视频URL"
              />
            )}
          </div>

          {/* 编辑指令输入框 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">编辑指令</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="描述您想对视频做的编辑，例如：让视频中的人物穿上红色外套"
            />
          </div>

          {/* 参考图区域（可选） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              添加参考图
              <span className="text-gray-400 font-normal ml-1">（可选，最多5张）</span>
            </label>
            {/* 已添加的参考图缩略图 */}
            {referenceImages.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-2">
                {referenceImages.map((url, index) => (
                  <div key={index} className="relative w-16 h-16 bg-gray-100 rounded-lg overflow-hidden group">
                    <img
                      src={url}
                      alt={`参考图${index + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <button
                      onClick={() => handleRemoveRefImage(index)}
                      className="absolute top-0.5 right-0.5 p-0.5 bg-red-500 text-white rounded-full hover:bg-red-600 opacity-0 group-hover:opacity-100 transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs text-center py-0.5">
                      {index + 1}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* 输入图片URL */}
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={refImageUrlInput}
                onChange={(e) => setRefImageUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddRefImage();
                  }
                }}
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="输入图片URL（多个用逗号分隔）"
                disabled={referenceImages.length >= 5}
              />
              <button
                onClick={handleAddRefImage}
                disabled={!refImageUrlInput.trim() || referenceImages.length >= 5}
                className={`px-3 py-1.5 text-sm rounded-lg transition flex-shrink-0 ${
                  refImageUrlInput.trim() && referenceImages.length < 5
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                添加
              </button>
            </div>
          </div>

          {/* 参数设置区域（一行排列） */}
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">分辨率</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as '720P' | '1080P')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="1080P">1080P</option>
                <option value="720P">720P</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">声音控制</label>
              <select
                value={audioSetting}
                onChange={(e) => setAudioSetting(e.target.value as 'auto' | 'origin')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="auto">自动</option>
                <option value="origin">保留原声</option>
              </select>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end space-x-4 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="px-6 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!inputVideo.trim() || !prompt.trim() || isGenerating}
            className={`px-6 py-2 rounded-lg transition flex items-center space-x-2 ${
              inputVideo.trim() && prompt.trim() && !isGenerating
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <span>编辑中...</span>
              </>
            ) : (
              <span>开始编辑</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoEditModal;
