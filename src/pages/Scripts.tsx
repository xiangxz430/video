import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getAllScripts, deleteScriptWithRelated } from '../services/database';
import type { Script } from '../types';

const Scripts: React.FC = () => {
  const navigate = useNavigate();
  const { loadScript, currentScript, isInitialized } = useApp();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);

  // 加载剧本列表
  const loadScripts = async () => {
    if (!isInitialized) return;
    setIsLoading(true);
    try {
      const allScripts = await getAllScripts();
      setScripts(allScripts);
    } catch (error) {
      console.error('加载剧本列表失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadScripts();
  }, [isInitialized]);

  // 创建新剧本
  const handleCreateNew = async () => {
    try {
      await loadScript(0); // 0 表示创建新剧本
      navigate('/outline');
    } catch (error) {
      console.error('创建新剧本失败:', error);
    }
  };

  // 使用剧本
  const handleUseScript = async (script: Script) => {
    try {
      await loadScript(script.id!);
      navigate('/outline');
    } catch (error) {
      console.error('加载剧本失败:', error);
    }
  };

  // 编辑剧本
  const handleEditScript = async (script: Script) => {
    try {
      await loadScript(script.id!);
      navigate('/outline');
    } catch (error) {
      console.error('编辑剧本失败:', error);
    }
  };

  // 删除剧本
  const handleDeleteScript = async (scriptId: number) => {
    try {
      await deleteScriptWithRelated(scriptId);
      setShowDeleteConfirm(null);
      loadScripts();
    } catch (error) {
      console.error('删除剧本失败:', error);
      alert('删除失败');
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getPreviewContent = (content?: string) => {
    if (!content) return '暂无内容';
    return content;
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">剧本列表</h1>
          <button
            onClick={handleCreateNew}
            className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition flex items-center space-x-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            <span>新建剧本</span>
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <svg className="animate-spin h-8 w-8 text-primary mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <p className="text-gray-500 mt-4">加载中...</p>
          </div>
        ) : scripts.length === 0 ? (
          <div className="text-center py-16">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-500 text-lg mb-2">暂无剧本</p>
            <p className="text-gray-400 text-sm mb-6">点击上方按钮创建第一个剧本</p>
            <button
              onClick={handleCreateNew}
              className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition"
            >
              创建剧本
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {scripts.map((script) => (
              <div
                key={script.id}
                className={`border rounded-lg p-6 hover:border-gray-300 transition cursor-pointer ${
                  currentScript?.id === script.id ? 'border-primary bg-primary/5' : 'border-gray-200'
                }`}
                onClick={() => handleUseScript(script)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {script.title || '未命名剧本'}
                      </h3>
                      {currentScript?.id === script.id && (
                        <span className="px-2 py-0.5 bg-primary text-white text-xs rounded-full">
                          当前使用
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mb-2">
                      创建于 {formatDate(script.createdAt)}
                      {script.updatedAt && script.createdAt !== script.updatedAt && (
                        <> · 修改于 {formatDate(script.updatedAt)}</>
                      )}
                    </p>
                    <p className="text-gray-600 text-sm line-clamp-2">
                      {getPreviewContent(script.content)}
                    </p>
                  </div>
                  
                  <div className="flex items-center space-x-2 ml-4" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleEditScript(script)}
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
                      title="编辑剧本"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                    
                    <button
                      onClick={() => setShowDeleteConfirm(script.id!)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                      title="删除剧本"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* 删除确认弹窗 */}
                {showDeleteConfirm === script.id && (
                  <div className="mt-4 p-4 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-red-700 text-sm mb-3">
                      确定要删除剧本「{script.title || '未命名剧本'}」吗？此操作不可恢复，剧本下的所有角色、场景、分集都将被删除。
                    </p>
                    <div className="flex space-x-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteScript(script.id!);
                        }}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm"
                      >
                        确认删除
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeleteConfirm(null);
                        }}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-sm"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Scripts;
