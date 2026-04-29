import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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
  // 使用 ref 跟踪 currentScript.id，避免回调依赖 currentScript 导致频繁重建
  const currentScriptIdRef = useRef<number | null>(null);
  const setCurrentScriptWithRef = (script: Script | null) => {
    currentScriptIdRef.current = script?.id ?? null;
    setCurrentScript(script);
  };
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
        setCurrentScriptWithRef(script);
        return;
      }
      
      const script = await db.getScript(id);
      setCurrentScriptWithRef(script);
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
      setCurrentScriptWithRef(script);
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
    // 使用函数式更新避免依赖 currentScript
    setCurrentScript(prev => prev?.id === id ? { ...prev, ...script } : prev);
  }, []);

  const deleteScript = useCallback(async (id: number) => {
    await db.deleteScript(id);
    const isCurrentScript = currentScriptIdRef.current === id;
    if (isCurrentScript) {
      currentScriptIdRef.current = null;
      setCurrentScript(null);
      setCharacters([]);
      setScenes([]);
      setEpisodes([]);
    }
  }, []);

  // ===== 角色操作 =====
  const loadCharacters = useCallback(async (scriptId: number) => {
    const data = await db.getCharactersByScript(scriptId);
    setCharacters(data);
  }, []);

  const createCharacter = useCallback(async (character: Character): Promise<number> => {
    const id = await db.createCharacter(character);
    const scriptId = currentScriptIdRef.current;
    if (scriptId) {
      await loadCharacters(scriptId);
    }
    return id;
  }, []);

  const updateCharacter = useCallback(async (id: number, character: Partial<Character>) => {
    await db.updateCharacter(id, character);
    const scriptId = currentScriptIdRef.current;
    if (scriptId) {
      await loadCharacters(scriptId);
    }
  }, []);

  const deleteCharacter = useCallback(async (id: number) => {
    await db.deleteCharacter(id);
    const scriptId = currentScriptIdRef.current;
    if (scriptId) {
      await loadCharacters(scriptId);
    }
  }, []);

  // ===== 场景操作 =====
  const loadScenes = useCallback(async (scriptId: number) => {
    const data = await db.getScenesByScript(scriptId);
    setScenes(data);
  }, []);

  const createScene = useCallback(async (scene: Scene): Promise<number> => {
    const id = await db.createScene(scene);
    const scriptId = currentScriptIdRef.current;
    if (scriptId) {
      await loadScenes(scriptId);
    }
    return id;
  }, []);

  const updateScene = useCallback(async (id: number, scene: Partial<Scene>) => {
    await db.updateScene(id, scene);
    const scriptId = currentScriptIdRef.current;
    if (scriptId) {
      await loadScenes(scriptId);
    }
  }, []);

  const deleteScene = useCallback(async (id: number) => {
    await db.deleteScene(id);
    const scriptId = currentScriptIdRef.current;
    if (scriptId) {
      await loadScenes(scriptId);
    }
  }, []);

  // ===== 分集操作 =====
  const loadEpisodes = useCallback(async (scriptId: number) => {
    const data = await db.getEpisodesByScript(scriptId);
    setEpisodes(data);
  }, []);

  const createEpisode = useCallback(async (episode: Episode): Promise<number> => {
    const id = await db.createEpisode(episode);
    const scriptId = currentScriptIdRef.current;
    if (scriptId) {
      await loadEpisodes(scriptId);
    }
    return id;
  }, []);

  const updateEpisode = useCallback(async (id: number, episode: Partial<Episode>) => {
    await db.updateEpisode(id, episode);
    const scriptId = currentScriptIdRef.current;
    if (scriptId) {
      await loadEpisodes(scriptId);
    }
  }, []);

  const deleteEpisode = useCallback(async (id: number) => {
    await db.deleteEpisode(id);
    const scriptId = currentScriptIdRef.current;
    if (scriptId) {
      await loadEpisodes(scriptId);
    }
  }, []);

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
    // 使用函数式更新从最新状态中查找 episodeId，然后重新加载该 episode 的 segments
    let targetEpisodeId: number | undefined;
    setSegments(prev => {
      const existing = prev.find(s => s.id === id);
      if (existing) targetEpisodeId = existing.episodeId;
      return prev;
    });
    if (targetEpisodeId) {
      const data = await db.getSegmentsByEpisode(targetEpisodeId);
      setSegments(data || []);
    }
  }, []);

  const deleteSegment = useCallback(async (id: number) => {
    // 使用 ref 记录 episodeId，避免在 setState 中执行副作用
    let targetEpisodeId: number | undefined;
    // 从当前 segments 中查找（读取最新 state）
    setSegments(prev => {
      const existing = prev.find(s => s.id === id);
      if (existing) targetEpisodeId = existing.episodeId;
      return prev;
    });
    await db.deleteSegment(id);
    if (targetEpisodeId) {
      const data = await db.getSegmentsByEpisode(targetEpisodeId);
      setSegments(data || []);
    }
  }, []);

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
    const scriptId = currentScriptIdRef.current;
    if (scriptId) {
      await Promise.all([
        loadCharacters(scriptId),
        loadScenes(scriptId),
        loadEpisodes(scriptId)
      ]);
    }
  }, []);

  // useMemo 避免每次渲染都创建新的 value 对象，导致所有消费者不必要的重渲染
  const value = React.useMemo<AppContextType>(() => ({
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
  }), [
    currentScript, characters, scenes, episodes, segments, apiConfigs, isLoading, isInitialized,
    loadScript, loadLatestScript, createScript, updateScript, deleteScript,
    loadCharacters, createCharacter, updateCharacter, deleteCharacter,
    loadScenes, createScene, updateScene, deleteScene,
    loadEpisodes, createEpisode, updateEpisode, deleteEpisode,
    loadSegments, createSegment, updateSegment, deleteSegment,
    loadApiConfigs, updateApiConfig, refreshData
  ]);

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
