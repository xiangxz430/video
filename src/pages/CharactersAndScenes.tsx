import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import CharacterCard from '../components/CharacterCard';
import SceneCard from '../components/SceneCard';
import SceneEditModal from '../components/SceneEditModal';
import CharacterEditModal from '../components/CharacterEditModal';
import { localPathToSrc } from '../services/fileService';
import type { Character, Scene } from '../types';

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
          <div className="flex items-center justify-end mb-4">
            <button
              onClick={handleAddCharacter}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition flex items-center space-x-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
              </svg>
              <span>添加角色</span>
            </button>
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
          <div className="flex items-center justify-end mb-4">
            <button
              onClick={handleAddScene}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition flex items-center space-x-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
              </svg>
              <span>添加场景</span>
            </button>
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
