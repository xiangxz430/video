import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import EpisodeCard from '../components/EpisodeCard';
import { generateStoryboardScript } from '../services/aiService';
import { splitScript } from '../services/serverApiClient';
import { getScript, updateEpisode as dbUpdateEpisode, getEpisodesByScript, setPageLogCallback, getSegmentsByEpisode as dbGetSegmentsByEpisode } from '../services/database';
import { getEnabledModels, getModelDisplayText, findApiConfigForModel, getBestConfig } from '../utils/modelConfig';
import { parseSegmentContent } from '../utils/segmentUtils';
import { DEFAULT_SHOT_DURATION } from '../constants';
import type { Episode, ApiConfig } from '../types';

const Episodes: React.FC = () => {
  const navigate = useNavigate();
  const { currentScript, episodes, characters, scenes, apiConfigs, loadEpisodes, createEpisode, updateEpisode, createSegment, deleteSegment } = useApp();
  const [generatingEpisodeId, setGeneratingEpisodeId] = useState<number | null>(null);
  const [generatingStep, setGeneratingStep] = useState(0); // 0=分析, 1=匹配, 2=生成
  const [generatingDetails, setGeneratingDetails] = useState<string[]>([]); // 详细步骤说明
  const [generateError, setGenerateError] = useState('');
  const [storyboardProgress, setStoryboardProgress] = useState(''); // 真实进度文本
  const [storyboardContent, setStoryboardContent] = useState(''); // 流式内容
  const [reSplitting, setReSplitting] = useState(false); // 重新分集状态
  const [reSplitProgress, setReSplitProgress] = useState(''); // 重新分集进度提示
  const [reSplitLogs, setReSplitLogs] = useState<string[]>([]); // 调试日志
  const [forceUpdate, setForceUpdate] = useState(0); // 强制更新计数器
  const [modelSelectEpisodeId, setModelSelectEpisodeId] = useState<number | null>(null); // 模型选择弹窗
  const [selectedModelKey, setSelectedModelKey] = useState<string>(''); // 选中的模型 key (provider_modelId)
  const [showAddEpisodeModal, setShowAddEpisodeModal] = useState(false); // 新增分集弹窗
  const [newEpisodeTitle, setNewEpisodeTitle] = useState(''); // 新分集标题
  const [newEpisodeContent, setNewEpisodeContent] = useState(''); // 新分集内容
  const [addingEpisode, setAddingEpisode] = useState(false); // 正在添加分集

  // 获取可用的分镜生成模型列表
  const availableModels = useMemo(() => {
    return getEnabledModels(apiConfigs, 'scriptGeneration');
  }, [apiConfigs]);

  useEffect(() => {
    if (currentScript?.id) {
      loadEpisodes(currentScript.id);
    }
  }, [currentScript, loadEpisodes]);

  // 如果没有选择剧本，显示提示
  if (!currentScript) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h2 className="text-xl font-semibold text-gray-700 mb-2">请先选择一个剧本</h2>
          <p className="text-gray-500 mb-6">在开始管理剧集之前，请先选择一个剧本或创建一个新剧本</p>
          <div className="flex items-center justify-center space-x-4">
            <button
              onClick={() => navigate('/scripts')}
              className="px-6 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition"
            >
              前往剧本列表
            </button>
            <button
              onClick={() => navigate('/outline')}
              className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              返回大纲设计
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleGenerateScript = async (episodeId: number, isRegenerate: boolean = false) => {
    setGeneratingEpisodeId(episodeId);
    setGeneratingStep(0);
    setGenerateError('');
    setStoryboardProgress('正在初始化...');
    setStoryboardContent('');

    try {
      // 如果是重新生成，先删除旧的分镜数据
      if (isRegenerate) {
        const episodeSegments = episodeSegmentsMap[episodeId] || (await dbGetSegmentsByEpisode(episodeId));
        for (const seg of episodeSegments) {
          if (seg.id) {
            await deleteSegment(seg.id);
          }
        }
      }

      // 使用统一配置获取（自动多级回退）
      let finalConfig: any = null;
      if (selectedModelKey) {
        const underscoreIdx = selectedModelKey.indexOf('_');
        const modelId = underscoreIdx >= 0 ? selectedModelKey.substring(underscoreIdx + 1) : selectedModelKey;
        finalConfig = findApiConfigForModel(apiConfigs, modelId);
      }
      if (!finalConfig?.apiKey) {
        // 统一 getBestConfig 自动处理 DeepSeek-Reasoner → DeepSeek-Chat → 旧配置 → 任何可用
        finalConfig = getBestConfig(apiConfigs, 'scriptGeneration');
      }
      
      if (!finalConfig) {
        const configCount = apiConfigs.length;
        setGenerateError(`未找到可用的 API 配置（共${configCount}个配置）。请在服务端管理后台检查 Provider 配置`);
        setGeneratingEpisodeId(null);
        return;
      }

      console.log(`[生成分镜] 使用配置: ${finalConfig.provider} - ${finalConfig.model}`);

      const episode = episodes.find(e => e.id === episodeId);
      if (!episode) {
        setGenerateError('未找到该集信息');
        setGeneratingEpisodeId(null);
        return;
      }

      // 准备角色和场景数据
      setStoryboardProgress('正在准备角色和场景数据...');

      const charData = characters.map(c => ({ name: c.name, description: c.description }));
      const sceneData = scenes.map(s => ({ name: s.name, description: s.description }));

      // 提取剧集内容
      setStoryboardProgress('正在读取剧集内容...');

      // 直接使用 episode.content（重新分集后已是原文，无需再调 AI 提取）
      const episodeContent = episode.content;
      if (!episodeContent) {
        setGenerateError('当前剧集内容为空，请先进行分集');
        setGeneratingEpisodeId(null);
        return;
      }

      // 定义进度回调函数
      const handleProgress = (message: string, step?: number, totalSteps?: number) => {
        console.log(`[分镜进度] ${message}`);
        setStoryboardProgress(message);
      };
      
      // 定义流式内容回调函数
      const handleContentStream = (chunk: string) => {
        setStoryboardContent(prev => prev + chunk);
      };

      // 调用 AI 生成分镜脚本
      setStoryboardProgress('🎯 步骤 1/2: 正在分析剧本并划分镜头结构...');
      const storyboard = await generateStoryboardScript(
        episodeContent, 
        charData, 
        sceneData, 
        finalConfig,
        handleProgress,
        handleContentStream
      );

      setStoryboardProgress(`AI 生成了 ${storyboard.length} 个镜头，正在保存到数据库...`);

      // 保存分镜到数据库（扁平结构：每个镜头一个 segment）
      let orderIndex = 0;
      for (const shot of storyboard) {
        await createSegment({
          episodeId,
          startTime: 0,
          endTime: shot.duration || DEFAULT_SHOT_DURATION,
          content: JSON.stringify(shot),
          order: orderIndex++
        });
      }

      // 更新集状态
      await updateEpisode(episodeId, { status: 'incomplete' });
      
      setStoryboardProgress('正在加载分集数据...');
      
      // 重新加载 segments 数据
      const freshSegments = await dbGetSegmentsByEpisode(episodeId);
      console.log(`[生成分镜] 重新加载了 ${freshSegments.length} 个分镜`);
      setEpisodeSegmentsMap(prev => ({ ...prev, [episodeId]: freshSegments }));

      setStoryboardProgress(`生成完成！共 ${freshSegments.length} 个镜头，即将跳转...`);

      // 关闭弹窗后跳转
      setTimeout(() => {
        setGeneratingEpisodeId(null);
        setStoryboardProgress('');
        setStoryboardContent('');
        console.log(`[生成分镜] 跳转到编辑页面: /episode/${episodeId}/edit`);
        navigate(`/episode/${episodeId}/edit`);
      }, 1500);
    } catch (err: any) {
      console.error('Failed to generate script:', err);
      const errMsg = err?.message || err?.toString() || '';
      if (errMsg.includes('API') || errMsg.includes('密钥') || errMsg.includes('Key') || errMsg.includes('配置') || errMsg.includes('超时') || errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('404') || errMsg.includes('500')) {
        setGenerateError(`API错误: ${errMsg}`);
      } else if (errMsg) {
        setGenerateError(`生成失败: ${errMsg}`);
      } else {
        setGenerateError('生成失败，请检查 API 配置是否正确、网络是否可用');
      }
      setGeneratingEpisodeId(null);
      setStoryboardProgress('');
      setStoryboardContent('');
    }
  };

  // 每个分集的 segments 缓存（从数据库直接查询）
  const [episodeSegmentsMap, setEpisodeSegmentsMap] = useState<Record<number, any[]>>({});

  // 加载所有分集的 segments
  useEffect(() => {
    const loadAllSegments = async () => {
      const map: Record<number, any[]> = {};
      for (const ep of episodes) {
        if (!ep.id) continue;
        try {
          map[ep.id] = await dbGetSegmentsByEpisode(ep.id);
        } catch (e) {
          map[ep.id] = [];
        }
      }
      setEpisodeSegmentsMap(map);
    };
    if (episodes.length > 0) {
      loadAllSegments();
    }
  }, [episodes]);

  // 转换数据为 EpisodeCard 期望的格式
  const formattedEpisodes = React.useMemo(() => {
    return episodes.map((ep: Episode) => {
      const episodeSegments = (ep.id ? episodeSegmentsMap[ep.id] : undefined) || [];
    
    // 统计分镜数量
    let shotCount = 0;
    const characterSet = new Set<string>();
    const sceneSet = new Set<string>();
    
    episodeSegments.forEach(seg => {
      try {
        // 新的扁平结构：每个 segment 就是一个 shot
        const shot = parseSegmentContent(seg.content);
        if (shot && shot.description) {
          shotCount += 1;  // 每个 segment 就是一个分镜
          if (shot.characters && Array.isArray(shot.characters)) {
            shot.characters.forEach((char: string) => characterSet.add(char));
          }
          if (shot.scene) {
            sceneSet.add(shot.scene);
          }
        }
      } catch (e) {
        // 解析失败，忽略
        console.warn(`[Episodes] 解析 segment ${seg.id} 失败:`, e);
      }
    });
    
    // 使用全局 characters/scenes 作为兜底（当 segment 中没有数据时）
    const characterCount = characterSet.size > 0 ? characterSet.size : (ep.status !== 'missing' ? characters.length : 0);
    const sceneCount = sceneSet.size > 0 ? sceneSet.size : (ep.status !== 'missing' ? scenes.length : 0);
    
    return {
      id: ep.id || 0,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      characterCount,
      sceneCount,
      shotCount,
      duration: ep.duration || null,
      status: ep.status,
      message: ep.status === 'missing' ? '尚未生成分镜脚本' : ep.status === 'incomplete' ? '分镜脚本未完成' : undefined,
      hasScript: ep.status !== 'missing'
    };
    });
  }, [episodes, episodeSegmentsMap, forceUpdate]);

  const stepLabels = ['匹配角色和场景', '生成初始分镜', '优化分镜内容', '质量评估与修复'];
  
  // 详细步骤说明（面向非技术用户）
  const stepDetails = [
    '正在将剧本人物与角色库匹配，确定场景设置...',
    '正在调用 AI 根据剧本生成专业分镜，每个镜头包含画面描述、动作、台词等...',
    '正在逐场景检查并优化分镜内容，确保每个镜头描述丰富（至少50-100字）...',
    '正在评估整体质量并修复关键问题，确保分镜达到专业标准...'
  ];

  // 新增分集
  const handleAddEpisode = async () => {
    if (!newEpisodeTitle.trim()) {
      alert('请输入分集标题');
      return;
    }
    if (!newEpisodeContent.trim()) {
      alert('请输入分集内容');
      return;
    }
    if (!currentScript?.id) {
      alert('请先选择一个剧本');
      return;
    }

    setAddingEpisode(true);
    setStoryboardProgress('正在创建新分集...');
    setStoryboardContent('');

    try {
      // 1. 计算新的 episodeNumber
      const maxEpNum = episodes.length > 0 
        ? Math.max(...episodes.map(e => e.episodeNumber)) 
        : 0;
      const newEpNum = maxEpNum + 1;

      // 2. 创建新的 episode
      const newEpisodeId = await createEpisode({
        title: newEpisodeTitle,
        episodeNumber: newEpNum,
        content: newEpisodeContent,
        status: 'missing',
        scriptId: currentScript.id
      });

      setStoryboardProgress(`✅ 分集创建成功！正在生成分镜...`);
      
      // 3. 刷新分集列表
      await loadEpisodes(currentScript.id);
      
      // 4. 关闭弹窗，清空输入
      setShowAddEpisodeModal(false);
      setNewEpisodeTitle('');
      setNewEpisodeContent('');
      
      // 5. 自动开始生成分镜
      setStoryboardProgress('正在初始化分镜生成...');
      setGeneratingEpisodeId(newEpisodeId);
      
      // 使用统一配置获取
      let finalConfig: any = null;
      if (selectedModelKey) {
        const underscoreIdx = selectedModelKey.indexOf('_');
        const modelId = underscoreIdx >= 0 ? selectedModelKey.substring(underscoreIdx + 1) : selectedModelKey;
        finalConfig = findApiConfigForModel(apiConfigs, modelId);
      }
      if (!finalConfig?.apiKey) {
        finalConfig = getBestConfig(apiConfigs, 'scriptGeneration');
      }
      
      if (!finalConfig) {
        setGenerateError('未找到可用的 API 配置。请在服务端管理后台检查 Provider 配置');
        setGeneratingEpisodeId(null);
        setAddingEpisode(false);
        return;
      }

      // 6. 生成分镜（复用 handleGenerateScript 的逻辑）
      const charData = characters.map(c => ({ name: c.name, description: c.description }));
      const sceneData = scenes.map(s => ({ name: s.name, description: s.description }));

      const handleProgress = (message: string, step?: number, totalSteps?: number) => {
        console.log(`[分镜进度] ${message}`);
        setStoryboardProgress(message);
      };
      
      const handleContentStream = (chunk: string) => {
        setStoryboardContent(prev => prev + chunk);
      };

      setStoryboardProgress('🎯 步骤 1/2: 正在分析剧本并划分镜头结构...');
      const storyboard = await generateStoryboardScript(
        newEpisodeContent, 
        charData, 
        sceneData, 
        finalConfig,
        handleProgress,
        handleContentStream
      );

      setStoryboardProgress(`AI 生成了 ${storyboard.length} 个镜头，正在保存到数据库...`);

      // 7. 保存分镜到数据库
      let orderIndex = 0;
      for (const shot of storyboard) {
        await createSegment({
          episodeId: newEpisodeId,
          startTime: 0,
          endTime: shot.duration || DEFAULT_SHOT_DURATION,
          content: JSON.stringify(shot),
          order: orderIndex++
        });
      }

      // 8. 更新集状态
      await updateEpisode(newEpisodeId, { status: 'incomplete' });
      
      setStoryboardProgress('正在加载分集数据...');
      
      // 9. 重新加载 segments 数据
      const freshSegments = await dbGetSegmentsByEpisode(newEpisodeId);
      console.log(`[新增分集] 重新加载了 ${freshSegments.length} 个分镜`);
      setEpisodeSegmentsMap(prev => ({ ...prev, [newEpisodeId]: freshSegments }));

      setStoryboardProgress(`生成完成！共 ${freshSegments.length} 个镜头，即将跳转...`);

      // 10. 关闭弹窗后跳转
      setTimeout(() => {
        setGeneratingEpisodeId(null);
        setAddingEpisode(false);
        setStoryboardProgress('');
        setStoryboardContent('');
        console.log(`[新增分集] 跳转到编辑页面: /episode/${newEpisodeId}/edit`);
        navigate(`/episode/${newEpisodeId}/edit`);
      }, 1500);
    } catch (err: any) {
      console.error('新增分集失败:', err);
      const errMsg = err?.message || err?.toString() || '';
      if (errMsg.includes('API') || errMsg.includes('密钥') || errMsg.includes('Key') || errMsg.includes('配置') || errMsg.includes('超时') || errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('404') || errMsg.includes('500')) {
        setGenerateError(`API错误: ${errMsg}`);
      } else if (errMsg) {
        setGenerateError(`新增失败: ${errMsg}`);
      } else {
        setGenerateError('新增失败，请检查 API 配置是否正确、网络是否可用');
      }
      setGeneratingEpisodeId(null);
      setAddingEpisode(false);
      setStoryboardProgress('');
      setStoryboardContent('');
    }
  };

  // 重新分集：用最新剧本原文重新切割，保留角色场景不变
  const handleReSplitEpisodes = async () => {
    // 设置数据库日志回调，让 [DB] 日志显示在页面上
    setPageLogCallback((log: string) => setReSplitLogs(prev => [...prev, log]));
    
    setReSplitLogs(['[重新分集] 点击了重新分集按钮']);
    
    if (!currentScript?.id) {
      setReSplitLogs(prev => [...prev, '[错误] 没有选择剧本！']);
      alert('请先选择一个剧本');
      return;
    }
    
    if (!confirm('重新分集将根据最新剧本原文重新切割分集内容，角色和场景信息将保留。\n\n注意：重新分集后需要重新生成分镜脚本，是否继续？')) {
      setReSplitLogs(prev => [...prev, '[取消] 用户取消了操作']);
      return;
    }

    setReSplitting(true);
    setReSplitProgress('正在读取最新剧本...');

    try {
      // 1. 获取最新剧本原文
      const scriptData = await getScript(currentScript.id);
      if (!scriptData || !scriptData.content) {
        setReSplitLogs(prev => [...prev, '[错误] 未找到剧本内容！']);
        alert('未找到剧本内容');
        setReSplitting(false);
        return;
      }
      
      setReSplitLogs(prev => [...prev, `[OK] 剧本长度: ${scriptData.content.length} 字符`]);
      setReSplitLogs(prev => [...prev, `[OK] 当前分集数: ${episodes.length}`]);

      setReSplitProgress('正在请求服务端重新分集...');

      setReSplitLogs(prev => [...prev, '[OK] 请求服务端拆分剧本']);
      
      // 先获取当前分集数量，作为参考
      const currentEpisodeCount = episodes.length || 3;
      setReSplitLogs(prev => [...prev, `[OK] 请求将剧本拆分为 ${currentEpisodeCount} 集`]);
      
      const splitResult = await splitScript({
        script: scriptData.content,
        episodeCount: currentEpisodeCount
      });
      const episodesWithContent = splitResult.episodes;

      if (!episodesWithContent || episodesWithContent.length === 0) {
        setReSplitLogs(prev => [...prev, '[错误] AI 返回为空！']);
        alert('AI 分集失败，请重试');
        setReSplitting(false);
        return;
      }
      
      setReSplitLogs(prev => [...prev, `[OK] AI 返回 ${episodesWithContent.length} 个分集`]);
      setReSplitLogs(prev => [...prev, `[调试] 当前 episodes 状态: ${JSON.stringify(episodes.map(e => ({id: e.id, epNum: e.episodeNumber, title: e.title?.substring(0,10)})))}`]);

      setReSplitProgress(`正在更新 ${episodesWithContent.length} 个分集...`);

      // 3. 更新每个 episode 的 content（使用顺序匹配，而非 episodeNumber）
      // 按 episodeNumber 排序后按索引匹配
      const sortedEpisodes = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
      setReSplitLogs(prev => [...prev, `[调试] 排序后 episodes 数量: ${sortedEpisodes.length}`]);
      
      let updatedCount = 0;
      
      for (let i = 0; i < episodesWithContent.length; i++) {
        const ep = episodesWithContent[i];
        const existingEp = sortedEpisodes[i]; // 按顺序匹配
        
        if (existingEp && existingEp.id) {
          try {
            await dbUpdateEpisode(existingEp.id, {
              title: ep.title,
              content: ep.content,
              status: existingEp.status
            });
            // 立即验证写入
            const verifyData = await getEpisodesByScript(currentScript.id);
            const verifyEp = verifyData.find((ve: any) => ve.id === existingEp.id);
            if (verifyEp && verifyEp.content === ep.content) {
              updatedCount++;
              setReSplitLogs(prev => [...prev, `[OK] ✅ 写入验证通过 第 ${i + 1} 集: ${ep.title} (${ep.content.length}字)`]);
            } else {
              setReSplitLogs(prev => [...prev, `[错误] ❌ 写入验证失败！数据库中content长度=${verifyEp?.content?.length || 0}，期望=${ep.content.length}`]);
            }
          } catch (dbError) {
            setReSplitLogs(prev => [...prev, `[错误] ❌ 数据库写入异常: ${dbError instanceof Error ? dbError.message : String(dbError)}`]);
          }
        } else {
          setReSplitLogs(prev => [...prev, `[错误] ❌ 第 ${i + 1} 集未找到对应 episode`]);
        }
      }

      setReSplitProgress(`✅ 成功更新 ${updatedCount} 个分集！`);
      setReSplitLogs(prev => [...prev, `[完成] 共更新 ${updatedCount} 个分集`]);
      
      // 刷新列表并强制重新渲染
      await loadEpisodes(currentScript.id);
      setForceUpdate(prev => prev + 1);
      
      // 关键验证：刷新后直接读取数据库显示内容
      setTimeout(() => {
        if (!currentScript?.id) return;
        getEpisodesByScript(currentScript.id).then(freshData => {
          const lens = freshData.map((e: any) => `第${e.episodeNumber}集=${e.content?.length || 0}字`);
          setReSplitLogs(prev => [...prev, `[最终验证] 刷新后数据库内容: ${lens.join(', ')}`]);
          
          // 对比：Context 中的 episodes 状态
          const contextLens = episodes.map(e => `第${e.episodeNumber}集=${e.content?.length || 0}字`);
          setReSplitLogs(prev => [...prev, `[对比] Context episodes 状态: ${contextLens.join(', ')}`]);
        }).catch(err => {
          console.error('验证数据库内容失败:', err);
        });
      }, 300);
      
    } catch (error) {
      console.error('重新分集失败:', error);
      setReSplitLogs(prev => [...prev, `[错误] ${error instanceof Error ? error.message : '未知错误'}`]);
      alert(`重新分集失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setTimeout(() => {
        setReSplitting(false);
        setReSplitProgress('');
      }, 5000);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">共 {episodes.length} 集</h2>
          <p className="text-sm text-gray-500">
            分镜脚本生成消耗 API 额度，以实际生成为准
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowAddEpisodeModal(true)}
            disabled={addingEpisode}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition flex items-center space-x-2 ${
              addingEpisode
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
            </svg>
            <span>{addingEpisode ? '添加中...' : '新增分集'}</span>
          </button>
          <button
            onClick={handleReSplitEpisodes}
            disabled={reSplitting || episodes.length === 0}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition flex items-center space-x-2 ${
              reSplitting
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-orange-50 text-orange-600 hover:bg-orange-100 border border-orange-200'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${reSplitting ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{reSplitting ? reSplitProgress : '重新分集'}</span>
          </button>
        </div>
      </div>

      {/* 调试日志显示 */}
      {reSplitLogs.length > 0 && (
        <div className="mb-4 p-4 bg-gray-900 text-gray-100 rounded-lg font-mono text-sm">
          <div className="text-xs text-gray-400 mb-2">🔍 调试日志：</div>
          {reSplitLogs.map((log, i) => (
            <div key={i} className={`py-0.5 ${log.includes('[错误]') ? 'text-red-400' : log.includes('[OK]') || log.includes('[完成]') ? 'text-green-400' : 'text-gray-300'}`}>
              {log}
            </div>
          ))}
        </div>
      )}

      {generateError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700 flex items-center space-x-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span>{generateError}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {formattedEpisodes.map(episode => (
          <EpisodeCard
            key={episode.id}
            episode={episode}
            onGenerateScript={(episodeId) => {
              if (availableModels.length > 0 && !selectedModelKey) {
                setSelectedModelKey(`${availableModels[0].provider}_${availableModels[0].id}`);
              }
              setModelSelectEpisodeId(episodeId);
            }}
            onRegenerateScript={(episodeId) => {
              if (availableModels.length > 0 && !selectedModelKey) {
                setSelectedModelKey(`${availableModels[0].provider}_${availableModels[0].id}`);
              }
              setModelSelectEpisodeId(episodeId);
            }}
          />
        ))}
      </div>

      {/* 模型选择弹窗 */}
      {modelSelectEpisodeId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">选择分镜生成模型</h3>
            
            {availableModels.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-gray-500 mb-2">未找到可用的分镜生成模型</p>
                <p className="text-sm text-gray-400">请在设置页面配置支持剧本生成的 API Key</p>
              </div>
            ) : (
              <select
                value={selectedModelKey}
                onChange={(e) => setSelectedModelKey(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black mb-4"
              >
                {availableModels.map(model => (
                  <option key={`${model.provider}_${model.id}`} value={`${model.provider}_${model.id}`}>
                    {getModelDisplayText(model.provider, model.id)}
                  </option>
                ))}
              </select>
            )}

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setModelSelectEpisodeId(null);
                  setSelectedModelKey('');
                }}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const eid = modelSelectEpisodeId;
                  setModelSelectEpisodeId(null);
                  if (eid) handleGenerateScript(eid);
                }}
                disabled={availableModels.length === 0}
                className="flex-1 px-4 py-2.5 bg-black text-white text-sm rounded-lg hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                开始生成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增分集弹窗 */}
      {showAddEpisodeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">新增分集</h3>
            
            <div className="space-y-4">
              {/* 标题输入 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  分集标题 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newEpisodeTitle}
                  onChange={(e) => setNewEpisodeTitle(e.target.value)}
                  placeholder="例如：第4集 - 新的冒险"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>

              {/* 内容输入 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  分集内容 <span className="text-red-500">*</span>
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  请输入完整的剧本原文内容，AI 将根据此内容自动生成分镜脚本
                </p>
                <textarea
                  value={newEpisodeContent}
                  onChange={(e) => setNewEpisodeContent(e.target.value)}
                  placeholder="粘贴或输入剧本原文..."
                  rows={12}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black resize-y font-mono"
                />
                <div className="text-xs text-gray-500 mt-1">
                  已输入 {newEpisodeContent.length} 字符
                </div>
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowAddEpisodeModal(false);
                  setNewEpisodeTitle('');
                  setNewEpisodeContent('');
                }}
                disabled={addingEpisode}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleAddEpisode}
                disabled={addingEpisode || !newEpisodeTitle.trim() || !newEpisodeContent.trim()}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
              >
                {addingEpisode ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    <span>创建并生成分镜中...</span>
                  </>
                ) : (
                  <span>创建分集并生成分镜</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {generatingEpisodeId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">
            {/* 标题和加载动画 */}
            <div className="text-center mb-6">
              <div className="mb-3">
                <svg className="animate-spin h-10 w-10 mx-auto text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">正在生成分镜脚本</h3>
              <p className="text-sm text-gray-600">AI 导演正在为您创建专业的分镜脚本</p>
            </div>

            {/* 步骤列表 */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4">
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
                      <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-gray-300"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${storyboardProgress?.includes('✅ 划分完成') || storyboardProgress?.includes('第 1') ? 'text-green-700' : 'text-gray-700'}`}>
                      划分镜头结构
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
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
                      <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-gray-300"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${storyboardProgress?.includes('✅ 所有镜头设计完成') || storyboardProgress?.includes('镜头设计完成') ? 'text-green-700' : 'text-gray-700'}`}>
                      完善镜头设计
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      正在逐个镜头完善设计(添加摄影参数、台词、声音等)...
                    </p>
                  </div>
                </div>

                {/* 当前进度文本 */}
                {storyboardProgress && !storyboardProgress.includes('保存到数据库') && !storyboardProgress.includes('加载分集') && !storyboardProgress.includes('生成完成') && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-primary font-medium">{storyboardProgress}</p>
                  </div>
                )}
              </div>
            </div>

            {/* 流式内容显示区 */}
            {storyboardContent && (
              <div className="bg-gray-900 rounded-lg p-3 mb-3 max-h-40 overflow-y-auto">
                <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap break-all">
                  {storyboardContent}
                </pre>
              </div>
            )}

            {/* 进度条 */}
            <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div 
                className="bg-primary h-2 rounded-full transition-all duration-500" 
                style={{
                  width: storyboardProgress?.includes('✅ 所有镜头') ? '100%' : 
                         storyboardProgress?.includes('✅ 划分完成') ? '50%' : 
                         storyboardProgress?.includes('步骤 2') || storyboardProgress?.includes('正在设计第') ? '75%' : '25%'
                }}
              ></div>
            </div>

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

      <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-200">
        <div className="flex items-center space-x-2">
          <button className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
            多选
          </button>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/characters-scenes')}
            className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            上一步
          </button>
        </div>
      </div>
    </div>
  );
};

export default Episodes;
