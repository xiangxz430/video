import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import CharacterCard from '../components/CharacterCard';
import SceneCard from '../components/SceneCard';
import SceneEditModal from '../components/SceneEditModal';
import CharacterEditModal from '../components/CharacterEditModal';
import { generateImageWithVolcEngine, ImageGenParams, buildCharacterPrompt } from '../services/aiService';
import { saveUrlImage, localPathToSrc } from '../services/fileService';
import { getApiConfig, saveImageHistory, addGeneratedImageHistory } from '../services/database';
import type { Character, Scene } from '../types';

// 图片生成模式
type ImageGenMode = 'text' | 'image-ref';

const CharactersAndScenes: React.FC = () => {
  const navigate = useNavigate();
  const { 
    currentScript, 
    characters, 
    scenes, 
    loadCharacters, 
    loadScenes,
    updateCharacter,
    updateScene,
    createCharacter,
    createScene,
    isLoading 
  } = useApp();
  const [activeTab, setActiveTab] = useState<'characters' | 'scenes'>('characters');
  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [isAddingCharacter, setIsAddingCharacter] = useState(false);
  const [isAddingScene, setIsAddingScene] = useState(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchError, setBatchError] = useState('');
  const [imageGenMode, setImageGenMode] = useState<ImageGenMode>('text');

  // 加载数据
  useEffect(() => {
    if (currentScript?.id) {
      loadCharacters(currentScript.id);
      loadScenes(currentScript.id);
    }
  }, [currentScript, loadCharacters, loadScenes]);

  // 处理添加新角色
  const handleAddCharacter = () => {
    if (!currentScript?.id) {
      alert('请先选择一个剧本');
      return;
    }
    // 创建空角色对象
    const newCharacter: Character = {
      name: '',
      description: '',
      isMain: false,
      scriptId: currentScript.id,
      alternativeImages: []
    };
    setEditingCharacter(newCharacter);
    setIsAddingCharacter(true);
  };

  // 处理添加新场景
  const handleAddScene = () => {
    if (!currentScript?.id) {
      alert('请先选择一个剧本');
      return;
    }
    // 创建空场景对象
    const newScene: Scene = {
      name: '',
      description: '',
      scriptId: currentScript.id,
      episodes: '[]'
    };
    setEditingScene(newScene);
    setIsAddingScene(true);
  };

  const handleSaveCharacter = async (updatedCharacter: Character) => {
    console.log('handleSaveCharacter: 保存角色', updatedCharacter.id, 'imageUrl:', updatedCharacter.imageUrl);
    if (updatedCharacter.id) {
      await updateCharacter(updatedCharacter.id, updatedCharacter);
      // 刷新角色列表
      if (currentScript?.id) {
        await loadCharacters(currentScript.id);
      }
    } else if (isAddingCharacter) {
      // 新增角色
      const newId = await createCharacter(updatedCharacter);
      console.log('新角色创建成功，ID:', newId);
      // 刷新角色列表
      if (currentScript?.id) {
        await loadCharacters(currentScript.id);
      }
    }
    setEditingCharacter(null);
    setIsAddingCharacter(false);
  };

  const handleSaveScene = async (updatedScene: Scene) => {
    if (updatedScene.id) {
      await updateScene(updatedScene.id, updatedScene);
    } else if (isAddingScene) {
      // 新增场景
      const newId = await createScene(updatedScene);
      console.log('新场景创建成功，ID:', newId);
      // 刷新场景列表
      if (currentScript?.id) {
        await loadScenes(currentScript.id);
      }
    }
    setEditingScene(null);
    setIsAddingScene(false);
  };

  // AI 批量生成角色图片
  const handleBatchGenerateCharacters = async () => {
    const ungenerated = characters.filter(c => !c.imageUrl);
    if (ungenerated.length === 0) return;

    setBatchError('');
    setBatchGenerating(true);
    setBatchProgress({ current: 0, total: ungenerated.length });

    try {
      const imageConfig = await getApiConfig('imageGeneration');
      if (!imageConfig || !imageConfig.apiKey) {
        setBatchError('请先在设置页面配置图片生成 API Key');
        return;
      }

      for (let i = 0; i < ungenerated.length; i++) {
        const char = ungenerated[i];
        setBatchProgress({ current: i + 1, total: ungenerated.length });
        try {
          // 角色图提示词（使用统一构建函数）
          const characterPrompt = buildCharacterPrompt(char.description);
          
          const params: ImageGenParams = { 
            prompt: characterPrompt,
            size: '2K'  // 默认使用 2K 分辨率
          };
          if (imageGenMode === 'image-ref' && char.imageUrl) {
            params.referenceImage = char.imageUrl;
          }
          const imageUrl = await generateImageWithVolcEngine(params, imageConfig);
          console.log(`角色 ${char.name} 图片生成成功:`, imageUrl);
          
          try {
            const localPath = await saveUrlImage(imageUrl, 'characters');
            if (localPath && char.id) {
              await updateCharacter(char.id, { imageUrl: localPath });
              console.log(`角色 ${char.name} 图片保存成功:`, localPath);
              
              // 保存到图片历史
              try {
                await saveImageHistory('character', char.id, char.name, imageUrl, localPath, char.description);
                console.log(`角色 ${char.name} 图片已保存到历史`);
                // 也保存到统一历史
                await addGeneratedImageHistory(localPath, char.description, imageConfig.model, '2K', '16:9', 'character', char.id);
              } catch (historyError) {
                console.error(`角色 ${char.name} 保存图片历史失败:`, historyError);
              }
            }
          } catch (saveError: any) {
            console.error(`角色 ${char.name} 图片保存失败:`, saveError.message);
            // 保存失败但生成成功，继续处理下一个
          }
        } catch (err) {
          console.error(`Failed to generate image for ${char.name}:`, err);
        }
      }
      
      // 生成完成后刷新角色数据
      if (currentScript?.id) {
        await loadCharacters(currentScript.id);
      }
    } catch (err: any) {
      setBatchError(err.message || '批量生成失败');
    } finally {
      setBatchGenerating(false);
      setBatchProgress({ current: 0, total: 0 });
    }
  };

  // AI 批量生成场景图片
  const handleBatchGenerateScenes = async () => {
    const ungenerated = scenes.filter(s => !s.imageUrl);
    if (ungenerated.length === 0) return;

    setBatchError('');
    setBatchGenerating(true);
    setBatchProgress({ current: 0, total: ungenerated.length });

    try {
      const imageConfig = await getApiConfig('imageGeneration');
      if (!imageConfig || !imageConfig.apiKey) {
        setBatchError('请先在设置页面配置图片生成 API Key');
        return;
      }

      for (let i = 0; i < ungenerated.length; i++) {
        const scene = ungenerated[i];
        setBatchProgress({ current: i + 1, total: ungenerated.length });
        try {
          // 场景图专用提示词：专业电影级场景图（纯环境，无人物）
          const scenePrompt = `电影级场景概念图，${scene.description}。
画面要求：
1. 展现场景的全貌和空间层次感
2. 清晰呈现建筑结构、环境布局、主要物体位置
3. 光影效果自然，体现时间（白天/黄昏/夜晚）和天气特征
4. 色彩基调统一，营造符合剧情的氛围
5. 画面构图专业，具有电影画面的视觉张力
【重要】画面中绝对不能出现任何人物、角色、人形生物，只展示纯粹的环境、建筑、自然景观
风格：影视级场景概念图，高清细腻，透视准确，细节丰富，无人物`;
          
          const params: ImageGenParams = { 
            prompt: scenePrompt,
            size: '2K'  // 默认使用 2K 分辨率
          };
          if (imageGenMode === 'image-ref' && scene.imageUrl) {
            params.referenceImage = scene.imageUrl;
          }
          const imageUrl = await generateImageWithVolcEngine(params, imageConfig);
          console.log(`场景 ${scene.name} 图片生成成功:`, imageUrl);
          
          try {
            const localPath = await saveUrlImage(imageUrl, 'scenes');
            if (localPath && scene.id) {
              await updateScene(scene.id, { imageUrl: localPath });
              console.log(`场景 ${scene.name} 图片保存成功:`, localPath);
              
              // 保存到图片历史
              try {
                await saveImageHistory('scene', scene.id, scene.name, imageUrl, localPath, scene.description);
                console.log(`场景 ${scene.name} 图片已保存到历史`);
                // 也保存到统一历史
                await addGeneratedImageHistory(localPath, scene.description, imageConfig.model, '2K', '16:9', 'scene', scene.id);
              } catch (historyError) {
                console.error(`场景 ${scene.name} 保存图片历史失败:`, historyError);
              }
            }
          } catch (saveError: any) {
            console.error(`场景 ${scene.name} 图片保存失败:`, saveError.message);
            // 保存失败但生成成功，继续处理下一个
          }
        } catch (err) {
          console.error(`Failed to generate image for ${scene.name}:`, err);
        }
      }
      
      // 生成完成后刷新场景数据
      if (currentScript?.id) {
        await loadScenes(currentScript.id);
      }
    } catch (err: any) {
      setBatchError(err.message || '批量生成失败');
    } finally {
      setBatchGenerating(false);
      setBatchProgress({ current: 0, total: 0 });
    }
  };

  // 转换数据库数据为组件格式
  const formattedCharacters = characters.map(char => ({
    id: char.id || 0,
    name: char.name,
    image: char.imageUrl ? localPathToSrc(char.imageUrl) : null,
    imagePath: char.imageUrl || null, // 原始路径用于获取尺寸
    isGenerated: !!char.imageUrl,
    isMain: char.isMain,
    prompt: char.description,
    voiceDescription: char.voiceDescription
  }));

  const formattedScenes = scenes.map(scene => {
    let episodes: string[] = [];
    try {
      episodes = JSON.parse(scene.episodes || '[]');
    } catch {
      episodes = [];
    }
    return {
      id: scene.id || 0,
      name: scene.name,
      image: scene.imageUrl ? localPathToSrc(scene.imageUrl) : null,
      imagePath: scene.imageUrl || null, // 原始路径用于获取尺寸
      isGenerated: !!scene.imageUrl,
      shotCount: episodes.length,
      prompt: scene.description,
      episodes
    };
  });

  return (
    <div>
      <div className="flex items-center space-x-6 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('characters')}
          className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
            activeTab === 'characters'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          全部角色 <span className="ml-1">{characters.length}</span>
        </button>
        <button
          onClick={() => setActiveTab('scenes')}
          className={`pb-3 px-1 text-sm font-medium border-b-2 transition ${
            activeTab === 'scenes'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          全部场景 <span className="ml-1">{scenes.length}</span>
        </button>
      </div>

      {activeTab === 'characters' && (
        <>
          {batchError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
              {batchError}
            </div>
          )}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-600" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm text-yellow-800">
                    {batchGenerating
                      ? `正在生成第 ${batchProgress.current}/${batchProgress.total} 个...`
                      : `有 ${formattedCharacters.filter(c => !c.isGenerated).length} 个形象未生成`}
                  </span>
                </div>
                
                {/* 图片生成模式选择 */}
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-gray-500">生成模式:</span>
                  <select
                    value={imageGenMode}
                    onChange={(e) => setImageGenMode(e.target.value as ImageGenMode)}
                    className="px-2 py-1 border border-gray-300 rounded text-xs"
                  >
                    <option value="text">文生图</option>
                    <option value="image-ref">图+文生图</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={handleAddCharacter}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition flex items-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                  </svg>
                  <span>添加角色</span>
                </button>
                <button
                  onClick={handleBatchGenerateCharacters}
                  disabled={batchGenerating || formattedCharacters.filter(c => !c.isGenerated).length === 0}
                  className="px-4 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800 transition flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {batchGenerating ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      <span>生成中...</span>
                    </>
                  ) : (
                    <>
                      <span>AI 批量生成</span>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-4">
            {formattedCharacters.map(character => (
              <CharacterCard
                key={character.id}
                character={character}
                onClick={() => {
                  const originalChar = characters.find(c => c.id === character.id);
                  if (originalChar) setEditingCharacter(originalChar);
                }}
              />
            ))}
          </div>
        </>
      )}

      {activeTab === 'scenes' && (
        <>
          {batchError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
              {batchError}
            </div>
          )}
          <div className="flex items-center justify-between mb-4">
            {/* 图片生成模式选择 */}
            <div className="flex items-center space-x-2">
              <span className="text-xs text-gray-500">生成模式:</span>
              <select
                value={imageGenMode}
                onChange={(e) => setImageGenMode(e.target.value as ImageGenMode)}
                className="px-2 py-1 border border-gray-300 rounded text-xs"
              >
                <option value="text">文生图</option>
                <option value="image-ref">图+文生图</option>
              </select>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleAddScene}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                </svg>
                <span>添加场景</span>
              </button>
              <button
                onClick={handleBatchGenerateScenes}
                disabled={batchGenerating || scenes.filter(s => !s.imageUrl).length === 0}
                className="px-4 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800 transition flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {batchGenerating ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    <span>正在生成 {batchProgress.current}/{batchProgress.total}...</span>
                  </>
                ) : (
                  <>
                    <span>AI 批量生成场景图</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {formattedScenes.map(scene => (
              <SceneCard
                key={scene.id}
                scene={scene}
                onEdit={() => {
                  const originalScene = scenes.find(s => s.id === scene.id);
                  if (originalScene) setEditingScene(originalScene);
                }}
                onViewCollection={() => navigate(`/scene-collection/${scene.name}`)}
              />
            ))}
          </div>
        </>
      )}

      <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-200">
        <p className="text-sm text-gray-500">
          角色和场景设定会应用到整部剧集中，建议调整完毕后再继续
        </p>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/outline')}
            className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            上一步
          </button>
          <button
            onClick={() => navigate('/episodes')}
            className="px-6 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition"
          >
            下一步
          </button>
        </div>
      </div>

      {editingScene && (
        <SceneEditModal
          scene={editingScene}
          onClose={() => setEditingScene(null)}
          onSave={handleSaveScene}
        />
      )}

      {editingCharacter && (
        <CharacterEditModal
          character={editingCharacter}
          onClose={() => setEditingCharacter(null)}
          onSave={handleSaveCharacter}
        />
      )}
    </div>
  );
};

export default CharactersAndScenes;
