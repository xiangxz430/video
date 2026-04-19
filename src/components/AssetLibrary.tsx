import React, { useState, useEffect } from 'react';
import { getImageHistory, ImageHistory, updateCharacter as dbUpdateCharacter, updateScene as dbUpdateScene } from '../services/database';
import { localPathToSrc } from '../services/fileService';
import type { CharacterAlternativeImage } from '../types';

interface CharacterAsset {
  id: number;
  name: string;
  type: string;
  image: string | null;
  description?: string;
  alternativeImages?: CharacterAlternativeImage[];
}

interface AssetLibraryProps {
  assets: {
    characters: CharacterAsset[];
    scenes: Array<{ id: number; name: string; image: string | null; description?: string }>;
  };
  onGenerateCharacterImage?: (characterId: number, characterName: string) => void;
  onGenerateSceneImage?: (sceneId: number, sceneName: string) => void;
  generatingId?: number | null;
  generatingType?: 'character' | 'scene' | null;
  onImageSelect?: (assetType: 'character' | 'scene', assetId: number, imageUrl: string) => void;
  // 角色穿着切换回调
  onCharacterOutfitChange?: (characterId: number, outfitIndex: number | null) => void;
  // 当前选中的角色穿着（characterId -> outfitIndex，null表示主图）
  selectedOutfits?: { [characterId: number]: number | null };
  // context 级别的更新方法（会刷新全局 context state）
  onUpdateCharacter?: (id: number, data: Partial<{ imageUrl: string }>) => Promise<void>;
  onUpdateScene?: (id: number, data: Partial<{ imageUrl: string }>) => Promise<void>;
}

const AssetLibrary: React.FC<AssetLibraryProps> = ({ 
  assets, 
  onGenerateCharacterImage,
  onGenerateSceneImage,
  generatingId,
  generatingType,
  onImageSelect,
  onCharacterOutfitChange,
  selectedOutfits = {},
  onUpdateCharacter,
  onUpdateScene,
}) => {
  const [expandedSections, setExpandedSections] = useState<{ [key: string]: boolean }>({
    characters: true,
    books: false,
    scenes: true
  });
  
  // 图片历史状态
  const [imageHistory, setImageHistory] = useState<{ [key: string]: ImageHistory[] }>({});
  const [showHistoryFor, setShowHistoryFor] = useState<{ type: 'character' | 'scene', id: number, name: string } | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };
  
  // 加载某个素材的图片历史
  const loadImageHistory = async (assetType: 'character' | 'scene', assetId: number) => {
    const key = `${assetType}-${assetId}`;
    if (imageHistory[key]) return; // 已加载过
    
    try {
      const history = await getImageHistory(assetType, assetId);
      setImageHistory(prev => ({ ...prev, [key]: history }));
    } catch (error) {
      console.error('加载图片历史失败:', error);
    }
  };
  
  // 显示历史弹窗
  const handleShowHistory = (assetType: 'character' | 'scene', assetId: number, assetName: string) => {
    loadImageHistory(assetType, assetId);
    setShowHistoryFor({ type: assetType, id: assetId, name: assetName });
  };
  
  // 选择历史图片作为当前图片
  const handleSelectHistoryImage = async (item: ImageHistory) => {
    if (!showHistoryFor) return;
    
    const imageUrl = item.localPath || item.imageUrl;
    
    // 更新数据库，优先用 context 方法（会同步刷新 context state）
    if (showHistoryFor.type === 'character') {
      if (onUpdateCharacter) {
        await onUpdateCharacter(showHistoryFor.id, { imageUrl: item.localPath || item.imageUrl });
      } else {
        await dbUpdateCharacter(showHistoryFor.id, { imageUrl: item.localPath || item.imageUrl });
      }
    } else {
      if (onUpdateScene) {
        await onUpdateScene(showHistoryFor.id, { imageUrl: item.localPath || item.imageUrl });
      } else {
        await dbUpdateScene(showHistoryFor.id, { imageUrl: item.localPath || item.imageUrl });
      }
    }
    
    // 通知父组件刷新
    if (onImageSelect) {
      onImageSelect(showHistoryFor.type, showHistoryFor.id, imageUrl);
    }
    
    setShowHistoryFor(null);
  };

  // 获取历史图片的显示URL
  const getHistoryImageSrc = (item: ImageHistory): string => {
    if (item.localPath) {
      return localPathToSrc(item.localPath) || item.imageUrl;
    }
    return item.imageUrl;
  };
  
  // 获取某个素材的历史图片数量
  const getHistoryCount = (assetType: 'character' | 'scene', assetId: number) => {
    const key = `${assetType}-${assetId}`;
    return imageHistory[key]?.length || 0;
  };

  return (
    <div className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col">
      <div className="p-3 border-b border-slate-200 flex items-center">
        <h2 className="font-semibold text-slate-700">资产库</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-slate-200">
          <button
            onClick={() => toggleSection('characters')}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-100 transition"
          >
            <div className="flex items-center space-x-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
              <span className="font-medium text-slate-700">角色</span>
              <span className="text-sm text-slate-500">({assets.characters.length})</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 text-slate-400 transition-transform ${expandedSections.characters ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
          {expandedSections.characters && (
            <div className="px-3 pb-3 grid grid-cols-2 gap-2">
              {assets.characters.map(character => {
                // 获取当前选中的穿着索引（null表示主图）
                const selectedOutfitIndex = selectedOutfits[character.id] ?? null;
                // 获取当前显示的图片
                const currentImage = selectedOutfitIndex !== null && character.alternativeImages?.[selectedOutfitIndex]
                  ? localPathToSrc(character.alternativeImages[selectedOutfitIndex].imageUrl)
                  : character.image;
                const currentOutfitName = selectedOutfitIndex !== null && character.alternativeImages?.[selectedOutfitIndex]
                  ? character.alternativeImages[selectedOutfitIndex].name
                  : '主图';
                
                return (
                  <div
                    key={character.id}
                    className="cursor-pointer group"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('asset', JSON.stringify({
                        type: 'character',
                        name: character.name,
                        fullName: `${character.name}-${character.type}`,
                        outfitIndex: selectedOutfitIndex
                      }));
                    }}
                  >
                    <div className="aspect-[3/4] bg-slate-100 rounded-lg overflow-hidden mb-1.5 group-hover:ring-2 group-hover:ring-indigo-400 transition relative">
                      {currentImage ? (
                        <>
                          <img src={currentImage} alt={character.name} className="w-full h-full object-contain" />
                          {/* 悬停时显示操作按钮 */}
                          <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleShowHistory('character', character.id, character.name);
                              }}
                              className="px-3 py-1.5 text-xs bg-white/90 text-slate-700 rounded-lg hover:bg-white"
                            >
                              查看历史 ({getHistoryCount('character', character.id)})
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                          </svg>
                          {onGenerateCharacterImage && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onGenerateCharacterImage(character.id, character.name);
                              }}
                              disabled={generatingId === character.id && generatingType === 'character'}
                              className="mt-2 px-2 py-1 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-300"
                            >
                              {generatingId === character.id && generatingType === 'character' ? '生成中...' : '生成图片'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-800 font-medium truncate">{character.name}</p>
                        <p className="text-xs text-slate-500 truncate">{character.type}</p>
                      </div>
                      {/* 穿着切换下拉菜单 */}
                      {character.alternativeImages && character.alternativeImages.length > 0 && onCharacterOutfitChange && (
                        <select
                          value={selectedOutfitIndex ?? ''}
                          onChange={(e) => {
                            e.stopPropagation();
                            const value = e.target.value === '' ? null : parseInt(e.target.value);
                            onCharacterOutfitChange(character.id, value);
                          }}
                          className="text-xs border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-600 cursor-pointer hover:border-slate-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">主图</option>
                          {character.alternativeImages.map((alt, idx) => (
                            <option key={alt.id} value={idx}>{alt.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-b border-slate-200">
          <button
            onClick={() => toggleSection('scenes')}
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-100 transition"
          >
            <div className="flex items-center space-x-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
              </svg>
              <span className="font-medium text-slate-700">场景</span>
              <span className="text-sm text-slate-500">({assets.scenes.length})</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 text-slate-400 transition-transform ${expandedSections.scenes ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
          {expandedSections.scenes && (
            <div className="px-3 pb-3 grid grid-cols-2 gap-2">
              {assets.scenes.map(scene => (
                <div
                  key={scene.id}
                  className="cursor-pointer group"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('asset', JSON.stringify({
                      type: 'scene',
                      name: scene.name
                    }));
                  }}
                >
                  <div className="aspect-video bg-slate-100 rounded-lg overflow-hidden mb-1.5 group-hover:ring-2 group-hover:ring-indigo-400 transition relative">
                    {scene.image ? (
                      <>
                        <img src={scene.image} alt={scene.name} className="w-full h-full object-contain" />
                        {/* 悬停时显示操作按钮 */}
                        <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleShowHistory('scene', scene.id, scene.name);
                            }}
                            className="px-3 py-1.5 text-xs bg-white/90 text-slate-700 rounded-lg hover:bg-white"
                          >
                            查看历史 ({getHistoryCount('scene', scene.id)})
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                        </svg>
                        {onGenerateSceneImage && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onGenerateSceneImage(scene.id, scene.name);
                            }}
                            disabled={generatingId === scene.id && generatingType === 'scene'}
                            className="mt-2 px-2 py-1 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-300"
                          >
                            {generatingId === scene.id && generatingType === 'scene' ? '生成中...' : '生成图片'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-800 font-medium truncate">{scene.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* 图片历史弹窗 */}
      {showHistoryFor && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50" onClick={() => setShowHistoryFor(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">{showHistoryFor.name} - 图片历史</h3>
              <button
                onClick={() => setShowHistoryFor(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {imageHistory[`${showHistoryFor.type}-${showHistoryFor.id}`]?.length > 0 ? (
                <div className="grid grid-cols-3 gap-4">
                  {imageHistory[`${showHistoryFor.type}-${showHistoryFor.id}`].map(item => (
                    <div
                      key={item.id}
                      className="cursor-pointer group border border-slate-200 rounded-lg overflow-hidden hover:border-indigo-400 transition"
                      onClick={() => handleSelectHistoryImage(item)}
                    >
                      <div className="aspect-video bg-slate-100">
                        <img
                          src={getHistoryImageSrc(item)}
                          alt="历史图片"
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="p-2 text-xs text-slate-500">
                        {new Date(item.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-slate-400 py-8">
                  暂无历史图片
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetLibrary;
