import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { localPathToSrc } from '../services/fileService';

const SceneCollection: React.FC = () => {
  const { sceneName } = useParams();
  const navigate = useNavigate();
  const { scenes, characters, currentScript } = useApp();
  
  // 获取当前剧本的所有场景
  const allScenes = scenes.map(s => s.name);
  const uniqueScenes = [...new Set(allScenes)];
  
  // 获取当前场景的详细信息
  const currentSceneDetails = scenes.filter(s => s.name === sceneName);

  // 如果场景列表为空，显示示例数据提示
  if (allScenes.length === 0) {
    return (
      <div className="fixed inset-0 bg-white z-50 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => navigate('/characters-scenes')}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          
          <div className="text-center py-20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-gray-300" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
            </svg>
            <p className="text-gray-500 text-lg mb-2">暂无场景数据</p>
            <p className="text-gray-400 text-sm">请先在大纲页面生成场景</p>
            <button
              onClick={() => navigate('/characters-scenes')}
              className="mt-4 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition"
            >
              去生成场景
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-white z-50 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/characters-scenes')}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="flex items-center space-x-2 mb-6 overflow-x-auto pb-2">
          {allScenes.map((scene, index) => (
            <button
              key={index}
              onClick={() => navigate(`/scene-collection/${scene}`)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                scene === sceneName
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {scene}
            </button>
          ))}
        </div>

        <h2 className="text-2xl font-semibold text-gray-900 mb-6">{sceneName || '所有场景'}</h2>

        {/* 显示所有场景列表 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {uniqueScenes.map((scene, index) => (
            <div 
              key={index} 
              className="bg-white rounded-lg overflow-hidden border border-gray-200 card-hover cursor-pointer"
              onClick={() => navigate(`/scene-collection/${encodeURIComponent(scene)}`)}
            >
              <div className="aspect-video bg-gray-100">
                {scenes.find(s => s.name === scene)?.imageUrl ? (
                  <img
                    src={localPathToSrc(scenes.find(s => s.name === scene)?.imageUrl) || ''}
                    alt={scene}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="p-3">
                <h3 className="font-medium text-gray-900 text-sm truncate">{scene}</h3>
                <p className="text-xs text-gray-500">共 {scenes.filter(s => s.name === scene).length} 张</p>
              </div>
            </div>
          ))}
        </div>

        {/* 当前场景详情 */}
        {sceneName && currentSceneDetails.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">场景详情</h3>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-2">描述：{currentSceneDetails[0]?.description || '暂无描述'}</p>
              {currentSceneDetails[0]?.imageUrl && (
                <img 
                  src={localPathToSrc(currentSceneDetails[0].imageUrl) || ''} 
                  alt={sceneName}
                  className="w-full max-w-md rounded-lg mt-2"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SceneCollection;
