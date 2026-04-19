import React, { useState, useRef, useEffect } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, readFile } from '@tauri-apps/plugin-fs';

interface VideoPreviewProps {
  segment: any;
  selectedShotIndex?: number;
}

const VideoPreview: React.FC<VideoPreviewProps> = ({ segment, selectedShotIndex }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [viewMode, setViewMode] = useState<'shot' | 'segment'>('shot');
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number | null>(null);
  // 用于强制刷新组件
  const [refreshKey, setRefreshKey] = useState(0);

  // 安全地将任意值转换为字符串（用于 React 渲染）
  const safeValue = (value: any): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      try {
        if (value.name) return String(value.name);
        return JSON.stringify(value);
      } catch {
        return '[数据异常]';
      }
    }
    return String(value);
  };

  // 监听 segment 变化，强制刷新
  useEffect(() => {
    setRefreshKey(prev => prev + 1);
    setSelectedHistoryIndex(null);
  }, [segment, selectedShotIndex]);

  // 获取当前选中的分镜视频
  const currentShot = (() => {
    if (Array.isArray(segment?.shots) && segment.shots.length > 0) {
      const validIndex = Math.min(Math.max(selectedShotIndex ?? 0, 0), segment.shots.length - 1);
      return segment.shots[validIndex];
    }
    if (segment?.description && typeof segment.description === 'string') {
      return segment;
    }
    return { description: '无分镜数据' };
  })();
  
  // 获取当前显示的视频（可能是历史记录中的）
  const getCurrentVideo = () => {
    if (selectedHistoryIndex !== null && currentShot?.videoHistory && currentShot.videoHistory.length > 0) {
      const historyItem = currentShot.videoHistory[selectedHistoryIndex];
      if (historyItem) {
        return {
          videoUrl: historyItem.localVideoPath 
            ? convertFileSrc(historyItem.localVideoPath)
            : historyItem.videoUrl,
          generatedAt: historyItem.generatedAt
        };
      }
    }
    // 当前视频
    return {
      videoUrl: currentShot?.localVideoPath 
        ? convertFileSrc(currentShot.localVideoPath)
        : currentShot?.videoUrl,
      generatedAt: currentShot?.videoGeneratedAt
    };
  };
  
  const currentVideo = getCurrentVideo();
  const shotVideoUrl = currentVideo.videoUrl;
  const segmentVideoUrl = segment?.localVideoPath 
    ? convertFileSrc(segment.localVideoPath)
    : segment?.videoUrl;
  
  // 根据模式选择视频URL
  const videoUrl = viewMode === 'shot' ? shotVideoUrl : segmentVideoUrl;
  
  // 当视频 URL 变化时，重新加载视频
  useEffect(() => {
    if (videoRef.current && videoUrl) {
      videoRef.current.load();
      console.log('视频重新加载:', videoUrl);
    }
  }, [videoUrl]);
  
  // 分镜是否已生成
  const isShotGenerated = currentShot?.status === 'generated' && (currentShot?.videoUrl || currentShot?.localVideoPath);
  // 分集是否已生成
  const isSegmentGenerated = segment?.status === 'generated' && (segment?.videoUrl || segment?.localVideoPath);
  
  const isGenerated = viewMode === 'shot' ? isShotGenerated : isSegmentGenerated;
  const isGenerating = segment?.status === 'generating' || currentShot?.status === 'generating';

  // 获取当前显示视频的来源信息
  const getCurrentVideoSource = () => {
    if (selectedHistoryIndex !== null && currentShot?.videoHistory && currentShot.videoHistory.length > 0) {
      const historyItem = currentShot.videoHistory[selectedHistoryIndex];
      return {
        localPath: historyItem?.localVideoPath,
        remoteUrl: historyItem?.videoUrl,
        isHistory: true
      };
    }
    return {
      localPath: currentShot?.localVideoPath,
      remoteUrl: currentShot?.videoUrl,
      isHistory: false
    };
  };
  
  const currentSource = getCurrentVideoSource();

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 格式化日期时间
  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // 保存视频到用户选择的位置
  const handleSaveVideo = async () => {
    if (!currentSource.localPath && !currentSource.remoteUrl) {
      alert('没有可保存的视频');
      return;
    }
    
    try {
      let fileData: Uint8Array;
      let fileName = `分镜视频_${Date.now()}.mp4`;
      
      if (currentSource.localPath) {
        // 从本地文件读取
        fileData = await readFile(currentSource.localPath);
      } else if (currentSource.remoteUrl) {
        // 从远程URL下载
        const response = await fetch(currentSource.remoteUrl);
        if (!response.ok) {
          throw new Error(`下载失败: ${response.status}`);
        }
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        fileData = new Uint8Array(arrayBuffer);
      } else {
        return;
      }
      
      // 选择保存位置
      const savePath = await save({
        defaultPath: fileName,
        filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'webm'] }]
      });
      
      if (!savePath) return;
      
      // 写入文件
      await writeFile(savePath, fileData);
      alert(`视频已保存到: ${savePath}`);
    } catch (error: any) {
      console.error('保存视频失败:', error);
      alert(`保存失败: ${error.message}`);
    }
  };

  // 用系统默认播放器打开视频
  const handleOpenInExternalPlayer = async () => {
    if (!videoUrl) {
      alert('没有可播放的视频');
      return;
    }
    
    try {
      // 获取本地文件路径
      let localPath: string | undefined;
      if (viewMode === 'shot') {
        // 如果有选中的历史记录
        if (selectedHistoryIndex !== null && currentShot?.videoHistory?.[selectedHistoryIndex]) {
          localPath = currentShot.videoHistory[selectedHistoryIndex].localVideoPath;
        } else {
          localPath = currentShot?.localVideoPath;
        }
      } else {
        localPath = segment?.localVideoPath;
      }
      
      if (localPath) {
        // 本地文件用 Rust 命令打开
        await invoke('open_local_file', { path: localPath });
      } else {
        // 远程 URL 用浏览器打开
        window.open(videoUrl, '_blank');
      }
      console.log('已在默认播放器中打开视频');
    } catch (error: any) {
      console.error('打开视频失败:', error);
      const errorMsg = error?.message || error?.toString() || '未知错误';
      alert(`打开失败: ${errorMsg}`);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (videoRef.current) {
      const time = parseFloat(e.target.value);
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (videoRef.current) {
      videoRef.current.volume = vol;
    }
  };

  return (
    <div key={refreshKey} className="w-96 bg-gray-50 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-900">
            {isGenerating ? '生成中...' : isGenerated ? '视频预览' : '视频预览'}
          </h3>
          {/* 模式切换 */}
          <div className="flex items-center space-x-1 bg-gray-200 rounded p-0.5">
            <button
              onClick={() => setViewMode('shot')}
              className={`px-2 py-0.5 text-xs rounded transition ${
                viewMode === 'shot' 
                  ? 'bg-white text-gray-900 shadow' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              分镜
            </button>
            <button
              onClick={() => setViewMode('segment')}
              className={`px-2 py-0.5 text-xs rounded transition ${
                viewMode === 'segment' 
                  ? 'bg-white text-gray-900 shadow' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              分集
            </button>
          </div>
        </div>
        {isGenerated && (
          <p className="text-xs text-gray-500">
            {viewMode === 'shot' 
              ? `分镜 ${(selectedShotIndex ?? 0) + 1} - 视频时长: ${formatTime(duration)}`
              : `分集视频 - 视频时长: ${formatTime(duration)}`
            }
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isGenerating ? (
          // 生成中状态
          <div className="text-center py-12">
            <svg className="animate-spin h-12 w-12 mx-auto text-primary mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-sm text-gray-600 font-medium">正在生成视频...</p>
            <p className="text-xs text-gray-400 mt-2">预计需要 30-60 秒</p>
          </div>
        ) : isGenerated ? (
          // 已生成 - 显示视频播放器
          <div className="space-y-4">
            <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
              <video
                key={videoUrl}
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                preload="auto"
                playsInline
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onWaiting={() => console.log('视频缓冲中...')}
                onCanPlay={() => console.log('视频可以播放')}
                onError={(e) => {
                  console.error('视频播放错误:', e);
                  const video = videoRef.current;
                  if (video) {
                    console.error('视频错误详情:', {
                      error: video.error,
                      networkState: video.networkState,
                      readyState: video.readyState
                    });
                  }
                }}
              />
              
              {/* 播放/暂停按钮覆盖层 */}
              <button
                onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition"
              >
                {isPlaying ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-white" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-white" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </div>

            {/* 进度条 */}
            <div className="space-y-2">
              <input
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* 音量控制 */}
            <div className="flex items-center space-x-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                onChange={handleVolumeChange}
                className="w-20 h-1 bg-gray-300 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* 操作按钮 */}
            <div className="flex space-x-2 pt-2">
              <button
                onClick={handleSaveVideo}
                className="flex-1 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition"
              >
                保存视频
              </button>
              <button
                onClick={handleOpenInExternalPlayer}
                className="flex-1 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition"
              >
                播放器
              </button>
            </div>

            {/* 视频历史列表 */}
            {viewMode === 'shot' && currentShot?.videoHistory && currentShot.videoHistory.length > 1 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-gray-700">视频历史（共 {currentShot.videoHistory.length} 个）</h4>
                  <button
                    onClick={() => setSelectedHistoryIndex(null)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    查看最新
                  </button>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-2">
                  {[...currentShot.videoHistory].reverse().map((item: any, reverseIndex: number) => {
                    const actualIndex = currentShot.videoHistory.length - 1 - reverseIndex;
                    const isSelected = selectedHistoryIndex === actualIndex;
                    const hasLocal = !!item.localVideoPath;
                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedHistoryIndex(actualIndex)}
                        className={`text-xs rounded px-2 py-2 cursor-pointer transition ${
                          isSelected 
                            ? 'bg-blue-100 text-blue-700 border border-blue-300' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">版本 {reverseIndex + 1}</span>
                          <div className="flex items-center space-x-2">
                            {hasLocal ? (
                              <span className="text-green-600">✓ 本地</span>
                            ) : (
                              <span className="text-gray-400">仅远程</span>
                            )}
                            {reverseIndex === 0 && (
                              <span className="text-xs bg-blue-500 text-white px-1 rounded">最新</span>
                            )}
                          </div>
                        </div>
                        <p className="text-gray-500 mt-0.5">
                          {formatDateTime(safeValue(item.generatedAt))}
                        </p>
                        {hasLocal && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.localVideoPath) {
                                invoke('open_local_file', { path: item.localVideoPath })
                                  .catch((err: any) => {
                                    console.error('打开视频失败:', err);
                                    const errorMsg = err?.message || err?.toString() || '未知错误';
                                    alert(`打开失败: ${errorMsg}`);
                                  });
                              } else if (item.videoUrl) {
                                window.open(item.videoUrl, '_blank');
                              }
                            }}
                            className="mt-2 px-2 py-1 text-[10px] bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition"
                          >
                            ▶ 播放器
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          // 未生成状态
          <div className="text-center py-12">
            <div className="w-32 h-32 mx-auto mb-4 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-300" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v1H4v-1h1v-2a1 1 0 011-1h8a1 1 0 011 1z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">未生成内容</p>
            <p className="text-xs text-gray-400 mt-2">点击下方"生成"按钮开始生成视频</p>
          </div>
        )}
      </div>

      {/* 分镜信息 - 扁平结构：每个 segment 就是一个 shot */}
      {segment && (
        <div className="border-t border-gray-200 p-4">
          <h4 className="text-xs font-medium text-gray-700 mb-2">当前分镜信息</h4>
          <div className="text-xs space-y-1">
            <p className="text-gray-600"><span className="font-medium">场景:</span> {segment.scene ? safeValue(segment.scene) : '未命名'}</p>
            <p className="text-gray-600"><span className="font-medium">描述:</span></p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-gray-700">{safeValue(segment.description)}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPreview;
