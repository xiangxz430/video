import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Script, Character, Scene, Episode, Segment, ApiConfig } from '../types';
import * as db from '../services/database';

interface AppContextType {
  // 数据状态
  currentScript: Script | null;
  characters: Character[];
  scenes: Scene[];
  episodes: Episode[];
  segments: Segment[];
  apiConfigs: ApiConfig[];
  
  // 加载状态
  isLoading: boolean;
  isInitialized: boolean;
  
  // 剧本操作
  loadScript: (id: number) => Promise<void>;
  loadLatestScript: () => Promise<void>;
  createScript: (script: Script) => Promise<number>;
  updateScript: (id: number, script: Partial<Script>) => Promise<void>;
  deleteScript: (id: number) => Promise<void>;
  
  // 角色操作
  loadCharacters: (scriptId: number) => Promise<void>;
  createCharacter: (character: Character) => Promise<number>;
  updateCharacter: (id: number, character: Partial<Character>) => Promise<void>;
  deleteCharacter: (id: number) => Promise<void>;
  
  // 场景操作
  loadScenes: (scriptId: number) => Promise<void>;
  createScene: (scene: Scene) => Promise<number>;
  updateScene: (id: number, scene: Partial<Scene>) => Promise<void>;
  deleteScene: (id: number) => Promise<void>;
  
  // 分集操作
  loadEpisodes: (scriptId: number) => Promise<void>;
  createEpisode: (episode: Episode) => Promise<number>;
  updateEpisode: (id: number, episode: Partial<Episode>) => Promise<void>;
  deleteEpisode: (id: number) => Promise<void>;
  
  // 分集操作
  loadSegments: (episodeId: number) => Promise<void>;
  createSegment: (segment: Segment) => Promise<number>;
  updateSegment: (id: number, segment: Partial<Segment>) => Promise<void>;
  deleteSegment: (id: number) => Promise<void>;
  
  // API 配置操作
  loadApiConfigs: () => Promise<void>;
  updateApiConfig: (name: string, config: Partial<ApiConfig>) => Promise<void>;
  
  // 刷新数据
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 状态
  const [currentScript, setCurrentScript] = useState<Script | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // 初始化数据库
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    let cancelled = false;
    
    const init = async (retryCount = 0) => {
      try {
        await db.initDatabase();
        if (cancelled) return;
        setIsInitialized(true);
        // 加载 API 配置
        await loadApiConfigs();
        if (cancelled) return;
        // 自动配置火山引擎凭证
        await db.setupVolcEngineCredentials();
        // 重新加载配置（确保最新）
        await loadApiConfigs();
        if (cancelled) return;
        // 预热网络连接（防止首次请求失败）
        warmupNetwork();
        // 尝试加载最新的剧本
        await loadLatestScript();
      } catch (error: any) {
        console.error('Failed to initialize database:', error);
        // 如果是开发环境热重载导致的数据库连接丢失，尝试重新初始化
        if (!cancelled && retryCount < 3 && error?.message?.includes('Database not initialized')) {
          console.log(`数据库初始化失败，${3 - retryCount}秒后重试...`);
          timeoutId = setTimeout(() => init(retryCount + 1), 1000);
        }
      }
    };
    init();
    
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // 预热网络连接（防止首次API请求失败）
  const warmupNetwork = async () => {
    try {
      // 预热火山方舟API连接（发送一个OPTIONS预检请求）
      const testUrl = 'https://ark.cn-beijing.volces.com/api/v3/';
      console.log('[预热网络] 开始预热API连接...');
      
      // 使用fetch预热连接，但不等待完成（后台执行）
      fetch(testUrl, { 
        method: 'HEAD',
        mode: 'no-cors' // 避免CORS问题
      }).then(() => {
        console.log('[预热网络] API连接预热成功');
      }).catch(() => {
        // 预热失败不影响应用运行
        console.log('[预热网络] API连接预热失败（不影响功能）');
      });
    } catch (error) {
      console.log('[预热网络] 预热过程中出现错误（不影响功能）');
    }
  };

  // ===== 剧本操作 =====
  const loadScript = useCallback(async (id: number) => {
    setIsLoading(true);
    try {
      if (id === 0) {
        // 新建剧本 - 创建新剧本并加载
        const newId = await db.createScript({
          title: '未命名剧本',
          content: ''
        });
        const script = await db.getScript(newId);
        setCurrentScript(script);
        return;
      }
      
      const script = await db.getScript(id);
      setCurrentScript(script);
      if (script?.id) {
        await Promise.all([
          loadCharacters(script.id),
          loadScenes(script.id),
          loadEpisodes(script.id)
        ]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadLatestScript = useCallback(async () => {
    setIsLoading(true);
    try {
      const script = await db.getLatestScript();
      setCurrentScript(script);
      if (script?.id) {
        await Promise.all([
          loadCharacters(script.id),
          loadScenes(script.id),
          loadEpisodes(script.id)
        ]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createScript = useCallback(async (script: Script): Promise<number> => {
    const id = await db.createScript(script);
    await loadLatestScript();
    return id;
  }, []);

  const updateScript = useCallback(async (id: number, script: Partial<Script>) => {
    await db.updateScript(id, script);
    if (currentScript?.id === id) {
      setCurrentScript(prev => prev ? { ...prev, ...script } : null);
    }
  }, [currentScript]);

  const deleteScript = useCallback(async (id: number) => {
    await db.deleteScript(id);
    if (currentScript?.id === id) {
      setCurrentScript(null);
      setCharacters([]);
      setScenes([]);
      setEpisodes([]);
    }
  }, [currentScript]);

  // ===== 角色操作 =====
  const loadCharacters = useCallback(async (scriptId: number) => {
    const data = await db.getCharactersByScript(scriptId);
    setCharacters(data);
  }, []);

  const createCharacter = useCallback(async (character: Character): Promise<number> => {
    const id = await db.createCharacter(character);
    if (currentScript?.id) {
      await loadCharacters(currentScript.id);
    }
    return id;
  }, [currentScript]);

  const updateCharacter = useCallback(async (id: number, character: Partial<Character>) => {
    await db.updateCharacter(id, character);
    if (currentScript?.id) {
      await loadCharacters(currentScript.id);
    }
  }, [currentScript]);

  const deleteCharacter = useCallback(async (id: number) => {
    await db.deleteCharacter(id);
    if (currentScript?.id) {
      await loadCharacters(currentScript.id);
    }
  }, [currentScript]);

  // ===== 场景操作 =====
  const loadScenes = useCallback(async (scriptId: number) => {
    const data = await db.getScenesByScript(scriptId);
    setScenes(data);
  }, []);

  const createScene = useCallback(async (scene: Scene): Promise<number> => {
    const id = await db.createScene(scene);
    if (currentScript?.id) {
      await loadScenes(currentScript.id);
    }
    return id;
  }, [currentScript]);

  const updateScene = useCallback(async (id: number, scene: Partial<Scene>) => {
    await db.updateScene(id, scene);
    if (currentScript?.id) {
      await loadScenes(currentScript.id);
    }
  }, [currentScript]);

  const deleteScene = useCallback(async (id: number) => {
    await db.deleteScene(id);
    if (currentScript?.id) {
      await loadScenes(currentScript.id);
    }
  }, [currentScript]);

  // ===== 分集操作 =====
  const loadEpisodes = useCallback(async (scriptId: number) => {
    const data = await db.getEpisodesByScript(scriptId);
    setEpisodes(data);
  }, []);

  const createEpisode = useCallback(async (episode: Episode): Promise<number> => {
    const id = await db.createEpisode(episode);
    if (currentScript?.id) {
      await loadEpisodes(currentScript.id);
    }
    return id;
  }, [currentScript]);

  const updateEpisode = useCallback(async (id: number, episode: Partial<Episode>) => {
    await db.updateEpisode(id, episode);
    if (currentScript?.id) {
      await loadEpisodes(currentScript.id);
    }
  }, [currentScript]);

  const deleteEpisode = useCallback(async (id: number) => {
    await db.deleteEpisode(id);
    if (currentScript?.id) {
      await loadEpisodes(currentScript.id);
    }
  }, [currentScript]);

  // ===== 分集操作 =====
  const loadSegments = useCallback(async (episodeId: number) => {
    if (!episodeId || isNaN(episodeId)) {
      setSegments([]);
      return;
    }
    try {
      const data = await db.getSegmentsByEpisode(episodeId);
      setSegments(data || []);
    } catch (error) {
      console.error('[loadSegments] 加载失败:', error);
      setSegments([]);
    }
  }, []);

  const createSegment = useCallback(async (segment: Segment): Promise<number> => {
    const id = await db.createSegment(segment);
    await loadSegments(segment.episodeId);
    return id;
  }, []);

  const updateSegment = useCallback(async (id: number, segment: Partial<Segment>) => {
    await db.updateSegment(id, segment);
    // 重新加载相关分集
    const existingSegment = segments.find(s => s.id === id);
    if (existingSegment) {
      await loadSegments(existingSegment.episodeId);
    }
  }, [segments]);

  const deleteSegment = useCallback(async (id: number) => {
    const existingSegment = segments.find(s => s.id === id);
    await db.deleteSegment(id);
    if (existingSegment) {
      await loadSegments(existingSegment.episodeId);
    }
  }, [segments]);

  // ===== API 配置操作 =====
  const loadApiConfigs = useCallback(async () => {
    const data = await db.getApiConfigs();
    setApiConfigs(data);
  }, []);

  const updateApiConfig = useCallback(async (name: string, config: Partial<ApiConfig>) => {
    await db.updateApiConfig(name, config);
    await loadApiConfigs();
  }, []);

  // 刷新所有数据
  const refreshData = useCallback(async () => {
    if (currentScript?.id) {
      await Promise.all([
        loadCharacters(currentScript.id),
        loadScenes(currentScript.id),
        loadEpisodes(currentScript.id)
      ]);
    }
  }, [currentScript]);

  const value: AppContextType = {
    currentScript,
    characters,
    scenes,
    episodes,
    segments,
    apiConfigs,
    isLoading,
    isInitialized,
    loadScript,
    loadLatestScript,
    createScript,
    updateScript,
    deleteScript,
    loadCharacters,
    createCharacter,
    updateCharacter,
    deleteCharacter,
    loadScenes,
    createScene,
    updateScene,
    deleteScene,
    loadEpisodes,
    createEpisode,
    updateEpisode,
    deleteEpisode,
    loadSegments,
    createSegment,
    updateSegment,
    deleteSegment,
    loadApiConfigs,
    updateApiConfig,
    refreshData
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
