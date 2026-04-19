import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { splitScriptWithAI, generateScriptWithFallback, splitScriptWithConfig } from '../services/aiService';
import { getApiConfig, getApiConfigs, exportToJson, importFromJson, getScript } from '../services/database';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { getEnabledModels, getModelDisplayText } from '../utils/modelConfig';
import type { CustomCharacter, CustomScene, ApiConfig } from '../types';

const Outline: React.FC = () => {
  const navigate = useNavigate();
  const { currentScript, createScript, updateScript, createCharacter, createScene, createEpisode, isInitialized, loadScript, deleteCharacter, deleteScene, deleteEpisode, characters, scenes, episodes } = useApp();
  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');
  const [isSplitting, setIsSplitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [splitError, setSplitError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  // 自定义角色和场景
  const [customCharacters, setCustomCharacters] = useState<CustomCharacter[]>([]);
  const [customScenes, setCustomScenes] = useState<CustomScene[]>([]);
  const [showCustomSection, setShowCustomSection] = useState(false);
  
  // 新增角色/场景输入
  const [newCharName, setNewCharName] = useState('');
  const [newCharDesc, setNewCharDesc] = useState('');
  const [newCharIsMain, setNewCharIsMain] = useState(false);
  const [newSceneName, setNewSceneName] = useState('');
  const [newSceneDesc, setNewSceneDesc] = useState('');

  // 剧本拆分模型选择
  const [availableModels, setAvailableModels] = useState<ApiConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  
  // API 配置（用于脚本生成）
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);

  // 加载现有剧本
  useEffect(() => {
    if (currentScript) {
      setTitle(currentScript.title || '');
      setScript(currentScript.content || '');
      setCustomCharacters(currentScript.customCharacters || []);
      setCustomScenes(currentScript.customScenes || []);
    }
  }, [currentScript]);

  // 加载可用的剧本拆分模型
  useEffect(() => {
    const loadAvailableModels = async () => {
      setIsLoadingModels(true);
      try {
        const configs = await getApiConfigs();
        // 过滤出剧本拆分模型（name包含scriptGeneration或capability为scriptGeneration）
        const scriptModels = configs.filter(config => {
          const name = config.name.toLowerCase();
          return name.includes('scriptgeneration') || name.includes('script_generation');
        });
        
        // 去重：根据 provider + model 组合去重，保留第一个
        const uniqueModels = scriptModels.filter((model, index, self) => 
          index === self.findIndex((m) => 
            m.provider === model.provider && m.model === model.model
          )
        );
        
        setAvailableModels(uniqueModels);
        // 默认选择第一个
        if (uniqueModels.length > 0 && !selectedModelId) {
          setSelectedModelId(uniqueModels[0].id || null);
        }
        // 保存所有配置供脚本生成使用
        setApiConfigs(configs);
      } catch (error: any) {
        console.error('加载剧本拆分模型失败:', error);
        // 如果是数据库未初始化错误，不显示错误提示（等待初始化完成）
        if (error?.message?.includes('Database not initialized')) {
          console.log('数据库尚未初始化，等待重试...');
        }
      } finally {
        setIsLoadingModels(false);
      }
    };

    if (isInitialized) {
      loadAvailableModels();
    }
  }, [isInitialized, selectedModelId]);

  // 自动保存
  useEffect(() => {
    if (!isInitialized) return;
    
    const timeoutId = setTimeout(async () => {
      if (title || script) {
        setIsSaving(true);
        try {
          if (currentScript?.id) {
            await updateScript(currentScript.id, { 
              title, 
              content: script, 
              customCharacters, 
              customScenes 
            });
          } else {
            await createScript({ 
              title: title || '未命名剧本', 
              content: script,
              customCharacters,
              customScenes
            });
          }
        } catch (error) {
          console.error('Failed to save script:', error);
        } finally {
          setIsSaving(false);
        }
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [title, script, customCharacters, customScenes, currentScript, isInitialized, createScript, updateScript]);
  
  // 添加自定义角色
  const handleAddCustomCharacter = () => {
    if (!newCharName.trim() || !newCharDesc.trim()) return;
    
    setCustomCharacters([...customCharacters, {
      name: newCharName.trim(),
      description: newCharDesc.trim(),
      isMain: newCharIsMain
    }]);
    setNewCharName('');
    setNewCharDesc('');
    setNewCharIsMain(false);
  };
  
  // 删除自定义角色
  const handleRemoveCustomCharacter = (index: number) => {
    setCustomCharacters(customCharacters.filter((_, i) => i !== index));
  };
  
  // 添加自定义场景
  const handleAddCustomScene = () => {
    if (!newSceneName.trim() || !newSceneDesc.trim()) return;
    
    setCustomScenes([...customScenes, {
      name: newSceneName.trim(),
      description: newSceneDesc.trim()
    }]);
    setNewSceneName('');
    setNewSceneDesc('');
  };
  
  // 删除自定义场景
  const handleRemoveCustomScene = (index: number) => {
    setCustomScenes(customScenes.filter((_, i) => i !== index));
  };

  // 导出剧本到文件
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const jsonData = await exportToJson();
      const filePath = await save({
        defaultPath: `${title || '未命名剧本'}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      
      if (filePath) {
        await writeTextFile(filePath, jsonData);
        alert('导出成功！');
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert(`导出失败: ${error}`);
    } finally {
      setIsExporting(false);
    }
  };

  // 从文件导入剧本
  const handleImport = async () => {
    setIsImporting(true);
    try {
      const selected = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      
      if (selected && typeof selected === 'string') {
        const content = await readTextFile(selected);
        const result = await importFromJson(content);
        
        if (result.success && result.scriptId) {
          // 加载新导入的剧本
          await loadScript(result.scriptId);
          alert(result.message);
        } else {
          alert(result.message);
        }
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert(`导入失败: ${error}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleSplit = async () => {
    if (!script || !currentScript?.id) return;
    
    // 检查是否有已生成的图片
    const scriptId = currentScript.id;
    const existingCharacters = characters.filter(c => c.scriptId === scriptId);
    const existingScenes = scenes.filter(s => s.scriptId === scriptId);
    const charactersWithImages = existingCharacters.filter(c => c.imageUrl);
    const scenesWithImages = existingScenes.filter(s => s.imageUrl);
    
    // 如果有图片，弹出确认对话框
    if (charactersWithImages.length > 0 || scenesWithImages.length > 0) {
      const imageCount = charactersWithImages.length + scenesWithImages.length;
      const confirmed = window.confirm(
        `⚠️ 警告：重新拆分将删除现有的 ${charactersWithImages.length} 个角色图片和 ${scenesWithImages.length} 个场景图片（共 ${imageCount} 张）！\n\n点击"确定"继续拆分，点击"取消"保留现有数据。`
      );
      if (!confirmed) {
        return; // 用户取消
      }
    }
    
    setSplitError('');
    setIsSplitting(true);
    
    try {
      // 构建自定义角色和场景信息
      let customInfo = '';
      if (customCharacters.length > 0) {
        customInfo += '\n\n【用户自定义角色 - 必须优先使用这些角色，不要自己创造新角色】\n';
        customCharacters.forEach(char => {
          customInfo += `- ${char.name}${char.isMain ? '（主角）' : ''}: ${char.description}\n`;
        });
      }
      if (customScenes.length > 0) {
        customInfo += '\n\n【用户自定义场景 - 必须优先使用这些场景，不要自己创造新场景】\n';
        customScenes.forEach(scene => {
          customInfo += `- ${scene.name}: ${scene.description}\n`;
        });
      }
      
      // 获取用户选择的模型配置
      let result;
      if (selectedModelId && availableModels.length > 0) {
        // 使用用户选择的特定模型
        const selectedConfig = availableModels.find(m => m.id === selectedModelId);
        if (selectedConfig) {
          console.log(`使用选择的模型进行剧本拆分: ${selectedConfig.provider} - ${selectedConfig.model}`);
          result = await splitScriptWithConfig(script, selectedConfig, customInfo);
        } else {
          throw new Error('选择的模型配置无效');
        }
      } else {
        // 使用多 Provider 自动切换生成脚本（兼容旧逻辑）
        const systemPrompt = `你是一个专业的剧本分析助手和AI绘画提示词专家。请将以下剧本内容拆分为角色、场景和分集信息。
${customInfo}
请按以下 JSON 格式返回：
{
  "characters": [
    {
      "name": "角色名",
      "description": "【字数要求：必须150-250字】详细的外貌形象描述，用于AI图片生成。必须按以下结构完整描述：
1. 基本信息：年龄范围、性别、身高体型（如"约175cm的高挑身材"）
2. 面部特征：脸型、眼睛（形状、颜色）、眉毛、鼻子、嘴巴、肤色
3. 发型发色：长度、发型样式、发色
4. 服装穿着：款式、颜色、材质、图案、层次搭配
5. 配饰道具：首饰、武器、随身物品等
6. 气质神态：典型表情、眼神特点、举止习惯、整体气质
7. 姿态动作：常见站姿、坐姿、行走方式
示例：'一位约28岁的男性侠客，身高约178cm，身材修长健硕，肩宽腰细。面容俊朗刚毅，剑眉星目，鼻梁高挺，薄唇微抿，肤色古铜健康。一头乌黑长发高高束起，用青色发带系成马尾，几缕碎发垂在额前。身着墨蓝色劲装，衣襟和袖口绣有银色云纹，腰系黑色皮革腰带，悬挂一把古朴长剑。气质冷峻沉稳，眼神锐利如鹰，常微微眯眼观察四周，站姿挺拔如松，行走时步伐稳健无声，举手投足间尽显江湖侠客的凌厉与从容。'",
      "isMain": true/false,
      "voiceDescription": "声音特点描述（可选），包括音调高低、音色特点、语速、语气风格等"
    }
  ],
  "scenes": [
    {
      "name": "场景名称",
      "description": "【字数要求：必须150-250字】详细的场景环境描述，用于AI图片生成。必须按以下结构完整描述：
1. 场景类型：室内/室外、具体场所名称
2. 空间布局：整体大小、空间划分、各区域功能
3. 建筑结构：建筑风格、材质、形状、高度
4. 主要物体：家具、陈设、装饰品、植物等具体描述
5. 光线氛围：光源类型、光线方向、明暗对比、色温
6. 色彩基调：主色调、配色方案
7. 环境细节：地面材质、墙面纹理、天气状况（如适用）
8. 时间氛围：白天/黄昏/夜晚、季节特征
【绝对禁止】描述中不能出现任何人物、角色、人形生物！只能描述纯粹的环境、建筑、自然景观。
示例：'一座隐于深山的古老寺庙，坐北朝南，占地约千余平方米。寺庙依山而建，层层递进，由山门、天王殿、大雄宝殿和藏经阁组成。建筑为典型的唐代风格，飞檐翘角，青瓦红柱，雕梁画栋。山门两侧石狮威严，门前青石台阶蜿蜒而下，两侧古柏参天。大雄宝殿内金身佛像庄严肃穆，案前烛火摇曳，香烟袅袅。殿内光线昏暗而神圣，透过彩色窗棂洒下斑驳光影。地面铺设青砖，墙壁斑驳显岁月痕迹，角落摆放青铜香炉和木鱼。整体色调以暗红、金黄、青灰为主，营造出庄重肃穆、超凡脱俗的佛门圣地氛围。'",
      "episodes": ["1", "2"]
    }
  ],
  "episodes": [
    {
      "title": "集标题",
      "episodeNumber": 1,
      "content": "该集的剧情概要"
    }
  ]
}

【关键要求 - 必须严格遵守】：
1. 【非常重要】必须提取剧本中出现的所有角色，不能遗漏任何一个！包括主角、配角、群演角色
2. 【非常重要】必须提取剧本中出现的所有场景，不能遗漏任何一个！包括主要场景和临时场景
3. 每个角色的description必须150-250字，少于150字视为不合格
4. 每个场景的description必须150-250字，少于150字视为不合格
5. 描述必须具体详细，不能笼统模糊，要有画面感
6. 描述要符合剧本的时代背景和风格设定
7. 如果是古装剧，服装和建筑要符合历史背景
8. 如果是现代剧，要体现当代特色
9. 【非常重要】场景描述中绝对不能包含任何人物、角色、人形生物！只描述纯粹的环境、建筑、自然景观。不要写“某某人在此做什么”，只写环境本身
10. 【非常重要】提取角色时，必须遍历剧本全文，统计所有有名字或有台词的角色，确保一个不漏
11. 【非常重要】提取场景时，必须识别所有不同的地点和环境，确保一个不漏

【自定义角色/场景规则】
${customCharacters.length > 0 ? '- 用户已定义了自定义角色，你必须优先使用这些角色，不要创造新角色替代它们' : '- 根据剧本内容自动识别角色'}
${customScenes.length > 0 ? '- 用户已定义了自定义场景，你必须优先使用这些场景，不要创造新场景替代它们' : '- 根据剧本内容自动识别场景'}
- 如果剧本中出现了用户未定义的角色或场景，才需要补充创建`;

        const aiResult = await generateScriptWithFallback(script, systemPrompt, apiConfigs);
        
        // 解析 AI 返回的 JSON（带容错处理）
        try {
          const jsonMatch = aiResult.content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('AI 返回格式不正确');
          let rawJson = jsonMatch[0];
          try {
            result = JSON.parse(rawJson);
          } catch {
            rawJson = rawJson.replace(/,\s*([\]}])/g, '$1');
            try {
              result = JSON.parse(rawJson);
            } catch (e2) {
              const episodesMatch = rawJson.match(/"episodes"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
              if (episodesMatch) {
                const charactersMatch = rawJson.match(/"characters"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
                const scenesMatch = rawJson.match(/"scenes"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
                result = {
                  characters: charactersMatch ? JSON.parse(charactersMatch[1]) : [],
                  scenes: scenesMatch ? JSON.parse(scenesMatch[1]) : [],
                  episodes: JSON.parse(episodesMatch[1]),
                };
              } else {
                throw e2;
              }
            }
          }
          // description 统一转字符串
          if (Array.isArray(result.characters)) {
            result.characters = result.characters.map((c: any) => ({
              ...c,
              description: typeof c.description === 'object' ? JSON.stringify(c.description, null, 2) : (c.description || ''),
            }));
          }
          if (Array.isArray(result.scenes)) {
            result.scenes = result.scenes.map((s: any) => ({
              ...s,
              description: typeof s.description === 'object' ? JSON.stringify(s.description, null, 2) : (s.description || ''),
            }));
          }
        } catch (parseError) {
          console.error('Parse error:', parseError);
          throw new Error('AI 返回的内容无法解析为有效格式');
        }
      }
      
      // 先删除该剧本下所有现有的角色、场景和分集，避免重复
      console.log('删除现有角色、场景和分集...');
      for (const char of characters) {
        if (char.scriptId === scriptId) {
          await deleteCharacter(char.id!);
        }
      }
      for (const scene of scenes) {
        if (scene.scriptId === scriptId) {
          await deleteScene(scene.id!);
        }
      }
      for (const episode of episodes) {
        if (episode.scriptId === scriptId) {
          await deleteEpisode(episode.id!);
        }
      }
      console.log('现有数据已删除');
      
      // 保存角色
      for (const char of result.characters) {
        await createCharacter({
          name: char.name,
          description: char.description,
          isMain: char.isMain,
          voiceDescription: char.voiceDescription,
          scriptId
        });
      }
      
      // 保存场景
      for (const scene of result.scenes) {
        await createScene({
          name: scene.name,
          description: scene.description,
          episodes: JSON.stringify(scene.episodes),
          scriptId
        });
      }
      
      // 保存分集（每个剧本独立编号，从1开始）
      for (let i = 0; i < result.episodes.length; i++) {
        const episode = result.episodes[i];
        await createEpisode({
          title: episode.title,
          episodeNumber: i + 1, // 独立编号，从1开始
          content: episode.content,
          status: 'missing',
          scriptId
        });
      }
      
      navigate('/characters-scenes');
    } catch (error: any) {
      console.error('AI split failed:', error);
      const errorMsg = error?.message || error?.toString() || '未知错误';
      setSplitError(`AI 拆分失败: ${errorMsg}`);
    } finally {
      setIsSplitting(false);
    }
  };

  const exampleScript = `第一集：枯枝牢笼光明吸

场景1：意识空间-枯枝牢笼
李长歌被困在一个由枯枝编织成的巨大牢笼中，周围一片黑暗。突然，一道刺眼的光芒从牢笼外射入，开始吸取李长歌的生命力。李长歌痛苦地挣扎，但枯枝越缠越紧。

场景2：长城河堤
机位设置在河堤之上，呈开阔的全景。明媚的日光下，一条清澈的宽阔河流平缓流淌，水面倒映着蓝天。河岸上绿草茵茵，盛开着成片的花丛。远景是连绵起伏的山峦，宏伟的新建长城如巨龙般盘踞其上。

第二集：锥刺股少年抗光明

场景1：李长歌的书房
深夜，李长歌独自在书房中苦读。他用锥子刺自己的大腿，保持清醒。书桌上堆满了古籍，烛光摇曳。

场景2：开阔的原野
清晨，李长歌站在原野上，面对初升的太阳。他闭上眼睛，感受着光明的力量，试图与之抗衡。

第三集：时间收割者的警告

场景1：李长歌商行所在的闹市街道
繁华的街道上人来人往，李长歌的商行生意兴隆。突然，一个神秘的黑衣人出现在人群中，他就是时间收割者。

场景2：李长歌的营帐
夜晚，时间收割者出现在李长歌的营帐中，警告他不要试图改变时间的流向，否则将付出惨重的代价。

第四集：长歌不屈战至终息

场景1：边疆的战场
战场上硝烟弥漫，李长歌率领士兵与敌军激战。他身先士卒，即使身负重伤也不退缩。

场景2：奔腾入海的河边悬崖
战斗结束后，李长歌独自站在悬崖边，看着奔腾的河水汇入大海，思考着生命的意义。

第五集：光阴化堤老者坐化

场景1：古风美园
一位白发苍苍的老者坐在美丽的园林中，他就是掌管时间的守护者。他告诉李长歌，时间如同河堤，既能保护也能束缚。

场景2：长城河堤
老者带李长歌来到长城河堤，在这里完成了最后的传承，然后化作光芒消散在天地之间。`;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm p-8">
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            剧本名称
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-lg"
            placeholder="请输入剧本名称"
          />
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              剧本大纲
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="text-sm text-gray-600 hover:text-primary transition flex items-center disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                {isImporting ? '导入中...' : '导入'}
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="text-sm text-gray-600 hover:text-primary transition flex items-center disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                {isExporting ? '导出中...' : '导出'}
              </button>
              <button
                onClick={() => setScript(exampleScript)}
                className="text-sm text-primary hover:text-secondary transition flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
                </svg>
                加载示例
              </button>
            </div>
          </div>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={20}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent resize-none font-mono text-sm leading-relaxed"
            placeholder="请输入剧本大纲，包括场景描述、角色对话等内容...

示例格式：

第一集：标题

场景1：场景名称
场景描述内容...

角色名：对话内容

场景2：场景名称
场景描述内容..."
          />
        </div>

        {/* 自定义角色和场景区域 */}
        <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowCustomSection(!showCustomSection)}
            className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between text-left hover:bg-gray-100 transition"
          >
            <div className="flex items-center space-x-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-primary" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
              </svg>
              <span className="font-medium text-gray-700">自定义角色和场景</span>
              {(customCharacters.length > 0 || customScenes.length > 0) && (
                <span className="text-xs bg-primary text-white px-2 py-0.5 rounded-full">
                  {customCharacters.length + customScenes.length} 项
                </span>
              )}
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 text-gray-400 transition-transform ${showCustomSection ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          
          {showCustomSection && (
            <div className="p-4 space-y-4">
              {/* 说明文字 */}
              <p className="text-sm text-gray-500">
                如果 AI 自动拆分的角色或场景不准确，可以在这里手动定义。AI 拆分时会优先使用您定义的角色和场景。
              </p>
              
              {/* 自定义角色区域 */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 mb-3 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                  </svg>
                  自定义角色
                </h4>
                
                {/* 已添加的角色列表 */}
                {customCharacters.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {customCharacters.map((char, index) => (
                      <div key={index} className="flex items-start justify-between bg-blue-50 rounded-lg p-3">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-gray-800">{char.name}</span>
                            {char.isMain && (
                              <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">主角</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{char.description}</p>
                        </div>
                        <button
                          onClick={() => handleRemoveCustomCharacter(index)}
                          className="ml-2 text-red-500 hover:text-red-700 transition"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* 添加角色表单 */}
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={newCharName}
                      onChange={(e) => setNewCharName(e.target.value)}
                      placeholder="角色名称"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  <div className="col-span-6">
                    <input
                      type="text"
                      value={newCharDesc}
                      onChange={(e) => setNewCharDesc(e.target.value)}
                      placeholder="角色描述（外貌、性格、服装等）"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  <div className="col-span-1 flex items-center justify-center">
                    <label className="flex items-center cursor-pointer" title="是否为主角">
                      <input
                        type="checkbox"
                        checked={newCharIsMain}
                        onChange={(e) => setNewCharIsMain(e.target.checked)}
                        className="w-4 h-4 text-primary rounded border-gray-300 focus:ring-primary"
                      />
                      <span className="ml-1 text-xs text-gray-500">主角</span>
                    </label>
                  </div>
                  <div className="col-span-2">
                    <button
                      onClick={handleAddCustomCharacter}
                      disabled={!newCharName.trim() || !newCharDesc.trim()}
                      className="w-full px-3 py-2 bg-primary text-white rounded-lg text-sm hover:bg-secondary transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      添加
                    </button>
                  </div>
                </div>
              </div>
              
              {/* 自定义场景区域 */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 mb-3 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
                  </svg>
                  自定义场景
                </h4>
                
                {/* 已添加的场景列表 */}
                {customScenes.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {customScenes.map((scene, index) => (
                      <div key={index} className="flex items-start justify-between bg-green-50 rounded-lg p-3">
                        <div className="flex-1">
                          <span className="font-medium text-gray-800">{scene.name}</span>
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{scene.description}</p>
                        </div>
                        <button
                          onClick={() => handleRemoveCustomScene(index)}
                          className="ml-2 text-red-500 hover:text-red-700 transition"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* 添加场景表单 */}
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-3">
                    <input
                      type="text"
                      value={newSceneName}
                      onChange={(e) => setNewSceneName(e.target.value)}
                      placeholder="场景名称"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  <div className="col-span-7">
                    <input
                      type="text"
                      value={newSceneDesc}
                      onChange={(e) => setNewSceneDesc(e.target.value)}
                      placeholder="场景描述（环境、氛围、建筑风格等）"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>
                  <div className="col-span-2">
                    <button
                      onClick={handleAddCustomScene}
                      disabled={!newSceneName.trim() || !newSceneDesc.trim()}
                      className="w-full px-3 py-2 bg-primary text-white rounded-lg text-sm hover:bg-secondary transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      添加
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start space-x-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="flex-1 text-sm text-blue-800">
              <p className="font-medium mb-1">AI 智能拆分说明</p>
              <ul className="list-disc list-inside space-y-1 text-blue-700">
                <li>自动识别剧本中的角色和场景</li>
                <li>提取场景描述和角色形象特征</li>
                <li>生成结构化的角色和场景数据</li>
                <li>支持多集剧本批量处理</li>
              </ul>
            </div>
          </div>
        </div>

        {splitError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <div className="flex items-center space-x-2 text-red-700">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="text-sm">{splitError}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-6 border-t border-gray-200">
          <div className="text-sm text-gray-500 flex items-center space-x-4">
            {script.length > 0 && (
              <span>已输入 {script.length} 字符</span>
            )}
            {isSaving && (
              <span className="text-blue-600 flex items-center">
                <svg className="animate-spin h-4 w-4 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                保存中...
              </span>
            )}
            {!isSaving && currentScript?.id && (
              <span className="text-green-600">已保存</span>
            )}
          </div>
          <div className="flex items-center space-x-4">
            {/* 模型选择器 */}
            <div className="flex items-center space-x-2">
              <label className="text-sm text-gray-600">拆分模型:</label>
              <select
                value={selectedModelId || ''}
                onChange={(e) => setSelectedModelId(Number(e.target.value) || null)}
                disabled={isSplitting || isLoadingModels}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              >
                {isLoadingModels ? (
                  <option value="">加载中...</option>
                ) : availableModels.length === 0 ? (
                  <option value="">未配置模型</option>
                ) : (
                  availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {getModelDisplayText(model.provider, model.model || '')}
                    </option>
                  ))
                )}
              </select>
              {availableModels.length === 0 && !isLoadingModels && (
                <span className="text-xs text-orange-500">
                  请先在设置页面配置剧本拆分模型
                </span>
              )}
            </div>

            <div className="flex-1"></div>

            <button
              onClick={() => setScript('')}
              className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              disabled={!script}
            >
              清空
            </button>
            <button
              onClick={handleSplit}
              disabled={!script || isSplitting || availableModels.length === 0}
              className={`px-6 py-2 rounded-lg transition flex items-center space-x-2 ${
                script && !isSplitting && availableModels.length > 0
                  ? 'bg-black text-white hover:bg-gray-800'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isSplitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  <span>AI 拆分中...</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
                  </svg>
                  <span>AI 拆分角色和场景</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-6 border border-purple-100">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              AI 智能创作助手
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              使用 AI 技术自动分析剧本结构，智能提取角色特征和场景描述，为您的创作提供强大支持。
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-lg p-3">
                <div className="text-2xl font-bold text-primary mb-1">5+</div>
                <div className="text-xs text-gray-600">识别角色</div>
              </div>
              <div className="bg-white rounded-lg p-3">
                <div className="text-2xl font-bold text-primary mb-1">10+</div>
                <div className="text-xs text-gray-600">提取场景</div>
              </div>
              <div className="bg-white rounded-lg p-3">
                <div className="text-2xl font-bold text-primary mb-1">100%</div>
                <div className="text-xs text-gray-600">准确率</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Outline;
